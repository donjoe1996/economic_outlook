"""Web layer: a thin FastAPI app over Service, plus the static page.

    GET  /api/data                 every dataset, from the local cache
    GET  /api/datasets             datasets + columns (for the form)
    POST /api/refresh              pull from Google Sheets into the cache
    POST /api/datasets/{id}/rows   add or update one row in the Sheet
    GET  /api/updaters/preview     rows the automatic updaters would add
    POST /api/updaters/apply       write the rows you confirmed
    GET  /api/auth/status          is Google connected?
    POST /api/auth/login           open the browser to sign in to Google
    /                              the dashboard (frontend/)
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .cache import Cache
from .config import FRONTEND_DIR, load_config
from .service import Service, UserError
from .sheets import GoogleSheets, SheetsNotAuthorized
from .updaters import REGISTRY, http_get

app = FastAPI(title="Indonesia Economic Outlook", docs_url="/api/docs", redoc_url=None)

google = GoogleSheets()


def service() -> Service:
    # Re-read the YAML on every request, so edits to config/datasets.yaml
    # show up without restarting the server.
    return Service(load_config(), Cache(), google)


@app.exception_handler(UserError)
async def _user_error(_, exc: UserError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(SheetsNotAuthorized)
async def _not_authorized(_, exc: SheetsNotAuthorized):
    return JSONResponse(status_code=401, content={"detail": str(exc)})


class RefreshBody(BaseModel):
    ids: list[str] | None = None


class RowBody(BaseModel):
    values: list[str]


class ApplyBody(BaseModel):
    dataset: str
    rows: list[list[str]]


@app.get("/api/data")
def get_data():
    svc = service()
    return {"sheet_url": svc.cfg.sheet_url, "google": google.status(), "datasets": svc.snapshot()}


@app.get("/api/datasets")
def get_datasets():
    return service().describe()


@app.post("/api/refresh")
def refresh(body: RefreshBody | None = None):
    return {"rows": service().refresh(body.ids if body else None)}


@app.post("/api/datasets/{ds_id}/rows")
def add_row(ds_id: str, body: RowBody):
    return service().upsert(ds_id, body.values)


@app.get("/api/updaters/preview")
def updaters_preview():
    svc = service()
    out = {}
    for ds in svc.cfg.datasets.values():
        if not ds.updater:
            continue
        fn = REGISTRY.get(ds.updater.get("type"))
        if fn is None:
            out[ds.id] = {"title": ds.title, "error": f"Updater '{ds.updater.get('type')}' tidak dikenal"}
            continue
        try:
            existing = (svc.cache.get(ds.id) or {}).get("values", [])
            out[ds.id] = {"title": ds.title, "rows": fn(ds, existing, http_get)}
        except Exception as exc:  # network down, source changed format, ...
            out[ds.id] = {"title": ds.title, "error": f"{type(exc).__name__}: {exc}"}
    return out


@app.post("/api/updaters/apply")
def updaters_apply(body: ApplyBody):
    svc = service()
    return {"results": [svc.upsert(body.dataset, row) for row in body.rows]}


@app.get("/api/auth/status")
def auth_status():
    return google.status()


@app.post("/api/auth/login")
def auth_login():
    try:
        google.sign_in()
    except SheetsNotAuthorized as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return google.status()


# Mounted last so /api/* wins.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
