"""Web layer: a thin FastAPI app over Service, plus the static page.

Data lives in a typed JSON store mirrored to a Google Drive folder
(backend/store.py, sync.py); Google Sheets are only read-only price feeds.

Fast reads answer directly:
    GET  /api/data?group=macro     datasets for one page, from the local cache
         &stock=BBRI               ...plus that stock's (and its peers') price datasets
    GET  /api/datasets             datasets + columns (for the form)
    GET  /api/auth/status          is Google connected? (no network)
    GET  /api/metadata             per dataset: newest period, what is due, blanks, last pull

Slow actions start a background job and answer at once with the job
({id, state, current, done, total, steps, ...}); the page then follows it:
    POST /api/auth/login           sign in to Google, then pull the Sheet
    POST /api/refresh              sync with Drive, pull the price feeds and API feeds, sync back
    POST /api/sync                 sync with Drive only
    GET  /api/store                Drive folder, unsynced files, last sync
    POST /api/datasets/{id}/table  save a table edited in the app
    POST /api/insights/generate    Claude Code writes the insight panel (button)
    POST /api/stocks/{code}/research   Claude Code proposes a stock's figures (button)
    POST /api/chat                 ask Claude Code about the data (chat box)
    POST /api/datasets/{id}/rows   add or update one row in the Sheet
    POST /api/updaters/preview     ask FRED etc. for new periods
    POST /api/updaters/apply       write the rows you confirmed
    POST /api/stocks               add a stock (creates its tabs in the Saham sheet)
    GET  /api/stocks               the stocks with a page, latest close, how complete
    GET  /api/jobs/{id}            progress of one job
    GET  /api/jobs                 recent jobs (the activity log)

    /                              the dashboard (frontend/)
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import ai
from .config import CACHE_DIR, FRONTEND_DIR, load_config
from .drive import GoogleDrive
from .store import Store, import_legacy_cache
from .jobs import Job, JobRunner
from .service import Service
from .retry import short_error
from .sheets import GoogleSheets, SheetsNotAuthorized
from . import stocks
from .updaters import REGISTRY, http_get

app = FastAPI(title="Indonesia Economic Outlook", docs_url="/api/docs", redoc_url=None)
# JSON compresses ~70-85%: the dashboard's data goes from ~1 MB to ~0.3 MB.
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def revalidate(request: Request, call_next):
    """Ask the browser to check for a newer file on every load (a quick 304 when
    unchanged), so an update to the app shows up without a forced refresh."""
    resp = await call_next(request)
    resp.headers.setdefault("Cache-Control", "no-cache")
    return resp

google = GoogleSheets()
jobs = JobRunner()


def service(with_drive: bool = False) -> Service:
    # Re-read the YAML on every request, so edits to config/datasets.yaml
    # show up without restarting the server.
    cfg = load_config()
    store = Store()
    svc = Service(cfg, store, google)
    # First start after the move to the JSON store: convert the old local copy
    # of the Sheets once (offline; nothing is overwritten).
    if not store.ids():
        import_legacy_cache(cfg, store, CACHE_DIR, derive=svc.derive)
    # Price datasets of stocks in the Daftar table are added here.
    stocks.with_stock_datasets(cfg, store)
    # Drive only inside jobs (network), and only with the Drive permission.
    if with_drive and cfg.drive_folder and google.status().get("drive"):
        svc.drive = GoogleDrive(google)
    return svc


def pull_all(p: Job, ids: list[str] | None = None) -> dict:
    """The "Tarik" button: newest data from Drive, newest prices from the feed
    Sheets, then local changes back to Drive."""
    google.ensure_signed_in(progress=p)
    svc = service(with_drive=True)
    out = {}
    if svc.drive:
        out["drive_pull"] = svc.sync_pull(p)
        svc = service(with_drive=True)   # the Daftar table may have changed: new price feeds
    else:
        p.warn("Google Drive belum diizinkan: data hanya disimpan di komputer ini. Klik 'Hubungkan Google' sekali lagi untuk menyetujui akses Drive.")
    out.update(svc.refresh(ids, progress=p))
    # API feeds (Coin Metrics, FRED/ECB M2): no sign-in needed, merged into the store
    out["auto"] = svc.auto_update(http_get, ids, progress=p)
    out["drive_push"] = svc.sync_push(p)
    return out


class RefreshBody(BaseModel):
    ids: list[str] | None = None


class RowBody(BaseModel):
    values: list[str]


class StockBody(BaseModel):
    code: str
    name: str = ""
    sector: str = "umum"
    peers: list[str] = []


class TableBody(BaseModel):
    rows: list[list[str | int | float | None]]


class SaveRowsBody(BaseModel):
    rows: dict[str, list[list[str]]]


class ChatTurn(BaseModel):
    q: str
    a: str


class ChatBody(BaseModel):
    question: str
    history: list[ChatTurn] = []
    model: str | None = None      # haiku | sonnet | opus (the chat's model switch)


class ApplyBody(BaseModel):
    dataset: str
    rows: list[list[str]]


# ------------------------------------------------------------------ reads
@app.get("/api/data")
def get_data(group: str | None = None, ids: str | None = None, stock: str | None = None):
    """group=macro (dashboard) or group=stock (stock pages), plus ids=a,b,c
    for single extra datasets and stock=CODE for that stock's prices; omit
    all for everything."""
    svc = service()
    extra = [i for i in (ids or "").split(",") if i]
    if stock:
        extra += stocks.datasets_for(svc.cfg, svc.cache, stock)
    return {"sheet_url": svc.cfg.sheet_url, "folder_url": svc.folder_url, "google": google.status(),
            "datasets": svc.snapshot(group, extra)}


@app.get("/api/files/{ds_id}")
def get_file(ds_id: str):
    """A file dataset (map shapes). The ?v= in its URL changes when the file
    does, so the browser may keep it for a long time."""
    from fastapi.responses import FileResponse

    ds = load_config().datasets.get(ds_id)
    if ds is None or ds.kind != "file" or not ds.file.exists():
        raise HTTPException(status_code=404, detail="File tidak ada")
    return FileResponse(ds.file, media_type="application/json",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.get("/api/datasets")
def get_datasets():
    return service().describe()


@app.get("/api/metadata")
def get_metadata():
    return service().metadata()


@app.get("/api/stocks")
def get_stocks():
    svc = service()
    return {"stocks": stocks.summary(svc.cfg, svc.cache), "saham_sheet": svc.cfg.spreadsheets.get(stocks.ALIAS) or None}


@app.get("/api/store")
def store_status():
    return service().store_status()


@app.get("/api/auth/status")
def auth_status():
    return google.status()


# ------------------------------------------------------------------ jobs
@app.get("/api/jobs")
def list_jobs():
    return jobs.recent()


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job tidak ditemukan (server mungkin dimulai ulang)")
    return job.view()


@app.post("/api/auth/login")
def auth_login():
    def work(p: Job):
        google.sign_in(progress=p)
        return pull_all(p)

    return jobs.start("login", "Menghubungkan Google", work).view()


@app.post("/api/refresh")
def refresh(body: RefreshBody | None = None):
    ids = body.ids if body else None

    def work(p: Job):
        return pull_all(p, ids)

    return jobs.start("refresh", "Menarik data (Drive dan feed harga)", work).view()


@app.post("/api/sync")
def sync_now():
    def work(p: Job):
        google.ensure_drive(progress=p)
        svc = service(with_drive=True)
        return {"pull": svc.sync_pull(p), "push": svc.sync_push(p)}

    return jobs.start("sync", "Sinkron dengan Google Drive", work).view()


@app.post("/api/datasets/{ds_id}/table")
def save_table(ds_id: str, body: TableBody):
    rows = [["" if v is None else str(v) for v in r] for r in body.rows]

    def work(p: Job):
        return service(with_drive=True).save_table(ds_id, rows, progress=p)

    return jobs.start("write", "Menyimpan tabel", work).view()


@app.post("/api/insights/generate")
def insights_generate():
    def work(p: Job):
        return ai.generate_insights(progress=p)

    return jobs.start("ai", "Claude menulis insight", work).view()


@app.post("/api/chat")
def chat(body: ChatBody):
    """One question about the dashboard's data: Python picks the data, Claude
    Code answers in one turn without tools, the numbers are checked."""
    hist = [{"q": t.q, "a": t.a} for t in body.history[-3:]]

    def work(p: Job):
        svc = service()   # also makes sure data/store exists (first start converts the old copy)
        return ai.chat(body.question, hist, progress=p, cfg=svc.cfg, store=svc.store, model=body.model)

    return jobs.start("chat", "Claude menjawab pertanyaan", work).view()


@app.post("/api/chat/warm")
def chat_warm(body: dict):
    """Start a Claude Code process for this model ahead of time (no tokens are
    used until a question arrives), so the first answer comes faster."""
    return {"warm": ai.warm(str(body.get("model") or ai.CHAT_MODEL))}


@app.post("/api/stocks/{code}/research")
def stock_research(code: str):
    code = code.strip().upper()

    def work(p: Job):
        svc = service()
        s = stocks.registry(svc.cfg, svc.store).get(code)
        if not s or s["legacy"]:
            raise ai.AIUnavailable(f"{code} belum terdaftar di daftar saham (atau punya sheet sendiri).")
        fund = [r for r in (svc.store.get("saham_fund") or {}).get("values", []) if r and r[0].strip().upper() == code]
        blank = {r[1] for r in fund if len(r) > 3 and not r[3].strip()}
        keys = [k for k in stocks.template_keys(s["sector"], True) if k[0] in blank or not fund]
        fh = [r[1] for r in (svc.store.get("saham_fh") or {}).get("values", []) if r and r[0].strip().upper() == code]
        dv = [r for r in (svc.store.get("saham_dv") or {}).get("values", []) if r and r[0].strip().upper() == code]
        out = ai.research_stock(code, s["name"], s["sector"], keys, fh, len(dv), progress=p)
        out["rows"] = ai.proposal_rows(code, out["proposal"])
        return out

    return jobs.start("ai", f"Claude mencari data {code}", work).view()


@app.post("/api/stocks/{code}/research/save")
def stock_research_save(code: str, body: SaveRowsBody):
    allowed = {"saham_fund", "saham_fh", "saham_dv"}
    code = code.strip().upper()

    def work(p: Job):
        svc = service(with_drive=True)
        out = {}
        for ds_id, rows in body.rows.items():
            if ds_id not in allowed:
                continue
            rows = [r for r in rows if r and str(r[0]).strip().upper() == code]
            if rows:
                out[ds_id] = svc.upsert_many(ds_id, rows, progress=p, push=False)["cells_written"]
        svc.sync_push(p)
        return out

    return jobs.start("write", f"Menyimpan data {code}", work).view()


@app.post("/api/datasets/{ds_id}/rows")
def add_row(ds_id: str, body: RowBody):
    def work(p: Job):
        return service(with_drive=True).upsert(ds_id, body.values, progress=p)

    return jobs.start("write", "Menyimpan ke Google Sheet", work).view()


@app.post("/api/stocks")
def add_stock(body: StockBody):
    def work(p: Job):
        google.ensure_signed_in(progress=p)
        return stocks.add_stock(service(with_drive=True), body.code, body.name, body.sector,
                                stocks.parse_codes(",".join(body.peers)), progress=p)

    return jobs.start("stock", f"Menambahkan saham {body.code.strip().upper()}", work).view()


@app.post("/api/updaters/preview")
def updaters_preview():
    def work(p: Job):
        svc = service()
        # auto feeds update themselves on every pull; only proposers are checked here
        targets = [ds for ds in svc.cfg.datasets.values() if ds.updater and not ds.is_auto]
        out = {}
        for i, ds in enumerate(targets):
            p.count(i, len(targets))
            fn = REGISTRY.get(ds.updater.get("type"))
            if fn is None:
                out[ds.id] = {"title": ds.title, "error": f"Updater '{ds.updater.get('type')}' tidak dikenal"}
                continue
            try:
                existing = (svc.cache.get(ds.id) or {}).get("values", [])
                out[ds.id] = {"title": ds.title, "rows": fn(ds, existing, http_get, progress=p)}
                svc.cache.record(ds.id, "check", True, f"{len(out[ds.id]['rows'])} periode baru")
            except Exception as exc:  # network down, source changed format, ...
                # one source failing must not stop the others
                msg = short_error(exc)
                out[ds.id] = {"title": ds.title, "error": msg}
                svc.cache.record(ds.id, "check", False, msg)
                p.warn(f"{ds.title}: {msg}")
        p.count(len(targets), len(targets))
        return out

    return jobs.start("preview", "Mengecek sumber resmi untuk periode baru", work).view()


@app.post("/api/updaters/apply")
def updaters_apply(body: ApplyBody):
    def work(p: Job):
        svc = service(with_drive=True)
        results = []
        for i, row in enumerate(body.rows):
            p.count(i, len(body.rows))
            try:
                results.append(svc.upsert(body.dataset, row, progress=p))
            except SheetsNotAuthorized:
                raise
            except Exception as exc:  # keep going with the other rows
                p.warn(f"Baris {row[0] if row else '?'}: {short_error(exc)}")
                results.append({"action": "failed", "error": short_error(exc)})
        p.count(len(body.rows), len(body.rows))
        return {"results": results}

    return jobs.start("apply", "Menulis periode baru ke Google Sheet", work).view()


# Mounted last so /api/* wins.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
