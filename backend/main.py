"""Web layer: a thin FastAPI app over Service, plus the static page.

Fast reads answer directly:
    GET  /api/data                 every dataset, from the local cache
    GET  /api/datasets             datasets + columns (for the form)
    GET  /api/auth/status          is Google connected? (no network)

Slow actions start a background job and answer at once with the job
({id, state, current, done, total, steps, ...}); the page then follows it:
    POST /api/auth/login           sign in to Google, then pull the Sheet
    POST /api/refresh              pull from Google Sheets into the cache
    POST /api/datasets/{id}/rows   add or update one row in the Sheet
    POST /api/updaters/preview     ask FRED etc. for new periods
    POST /api/updaters/apply       write the rows you confirmed
    GET  /api/jobs/{id}            progress of one job
    GET  /api/jobs                 recent jobs (the activity log)

    /                              the dashboard (frontend/)
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .cache import Cache
from .config import FRONTEND_DIR, load_config
from .jobs import Job, JobRunner
from .service import Service
from .sheets import GoogleSheets
from .updaters import REGISTRY, http_get

app = FastAPI(title="Indonesia Economic Outlook", docs_url="/api/docs", redoc_url=None)

google = GoogleSheets()
jobs = JobRunner()


def service() -> Service:
    # Re-read the YAML on every request, so edits to config/datasets.yaml
    # show up without restarting the server.
    return Service(load_config(), Cache(), google)


class RefreshBody(BaseModel):
    ids: list[str] | None = None


class RowBody(BaseModel):
    values: list[str]


class ApplyBody(BaseModel):
    dataset: str
    rows: list[list[str]]


# ------------------------------------------------------------------ reads
@app.get("/api/data")
def get_data():
    svc = service()
    return {"sheet_url": svc.cfg.sheet_url, "google": google.status(), "datasets": svc.snapshot()}


@app.get("/api/datasets")
def get_datasets():
    return service().describe()


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
        rows = service().refresh(progress=p)
        return {"rows": rows}

    return jobs.start("login", "Menghubungkan Google", work).view()


@app.post("/api/refresh")
def refresh(body: RefreshBody | None = None):
    ids = body.ids if body else None

    def work(p: Job):
        google.ensure_signed_in(progress=p)
        return {"rows": service().refresh(ids, progress=p)}

    return jobs.start("refresh", "Menarik data dari Google Sheet", work).view()


@app.post("/api/datasets/{ds_id}/rows")
def add_row(ds_id: str, body: RowBody):
    def work(p: Job):
        google.ensure_signed_in(progress=p)
        return service().upsert(ds_id, body.values, progress=p)

    return jobs.start("write", "Menyimpan ke Google Sheet", work).view()


@app.post("/api/updaters/preview")
def updaters_preview():
    def work(p: Job):
        svc = service()
        targets = [ds for ds in svc.cfg.datasets.values() if ds.updater]
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
            except Exception as exc:  # network down, source changed format, ...
                out[ds.id] = {"title": ds.title, "error": f"{type(exc).__name__}: {exc}"}
        p.count(len(targets), len(targets))
        return out

    return jobs.start("preview", "Mengecek sumber resmi untuk periode baru", work).view()


@app.post("/api/updaters/apply")
def updaters_apply(body: ApplyBody):
    def work(p: Job):
        google.ensure_signed_in(progress=p)
        svc = service()
        results = []
        for i, row in enumerate(body.rows):
            p.count(i, len(body.rows))
            results.append(svc.upsert(body.dataset, row, progress=p))
        p.count(len(body.rows), len(body.rows))
        return {"results": results}

    return jobs.start("apply", "Menulis periode baru ke Google Sheet", work).view()


# Mounted last so /api/* wins.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
