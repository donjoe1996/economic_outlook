"""The data store: one typed JSON file per dataset, mirrored to a Google Drive folder.

Layout (identical locally in data/store/ and in the Drive folder):

    datapackage.json     index of every dataset: rows, columns, hash, updated
    <dataset id>.json    {"id", "title", "schema": {"fields", "primaryKey"},
                          "rows": [[...], ...], "updated_at", "changed_at", ...}

Rows are arrays in schema order (about 40% smaller than an array of objects).
Values are typed: numbers are JSON numbers, empty cells are null, Google
Finance date-times become ISO dates ("2016-01-04"). The layout follows the
Frictionless Data "Data Package" and "Table Schema" conventions, so any tool
that knows those can read the folder.

Local-only bookkeeping lives in data/store/_local/ and is never uploaded:
    status.json   outcome of the last pull/check per dataset (metadata page)
    meta.json     spreadsheet tab ids, for deep links to feed tabs
    sync.json     per file: its Drive id and the hash at the last sync

The interface matches the old Cache (get/put/record/status/meta), and get()
returns rows as text, so the write path and tests stay unchanged. typed()
gives the typed rows for the API.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

from .config import STORE_DIR

FORMAT_VERSION = 1
_LOCK = threading.RLock()
_US_DATE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$")
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_NUMBER = re.compile(r"^-?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def md5_bytes(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()   # what Google Drive reports as md5Checksum


def _dumps(doc) -> bytes:
    # compact but line-per-row, so a diff of two versions stays readable
    if isinstance(doc, dict) and isinstance(doc.get("rows"), list):
        head = {k: v for k, v in doc.items() if k != "rows"}
        body = json.dumps(head, ensure_ascii=False, separators=(",", ":"))[:-1]
        rows = ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in doc["rows"])
        return (body + ',"rows":[\n' + rows + "\n]}\n").encode("utf-8")
    return (json.dumps(doc, ensure_ascii=False, indent=1) + "\n").encode("utf-8")


def _write(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)   # atomic: readers see the old file or the new one, never half


# ------------------------------------------------------------------ typing
def _num(text: str):
    t = text.strip()
    if not _NUMBER.match(t):
        return None
    v = float(t.replace(",", ""))
    return int(v) if v.is_integer() and "." not in t and abs(v) < 2**53 else v


def _us_to_iso(text: str) -> str | None:
    m = _US_DATE.match(text.strip())
    return f"{int(m[3]):04d}-{int(m[1]):02d}-{int(m[2]):02d}" if m else None


def infer_type(cells: list[str]) -> str:
    """number | date | string, from the non-empty cells. Lossless: one cell that
    is not a number keeps the whole column as text."""
    vals = [c.strip() for c in cells if c is not None and str(c).strip() != ""]
    if not vals:
        return "string"
    if all(_num(v) is not None for v in vals):
        return "number"
    if all(_us_to_iso(v) or _ISO_DATE.match(v) for v in vals):
        return "date"
    return "string"


def to_typed(value: str, typ: str):
    v = "" if value is None else str(value).strip()
    if v == "":
        return None
    if typ == "number":
        n = _num(v)
        return n if n is not None else v
    if typ == "date":
        return _us_to_iso(v) or v
    return v


def to_text(value) -> str:
    """Typed value back to the text the write path compares against."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float):
        return repr(value) if not value.is_integer() else str(int(value)) if abs(value) < 1e15 else repr(value)
    return str(value)


def _fingerprint(fields: list, rows: list) -> str:
    raw = json.dumps([fields, rows], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


# ------------------------------------------------------------------ store
class Store:
    def __init__(self, directory: Path = STORE_DIR):
        self.dir = directory
        self.local = directory / "_local"
        self.local.mkdir(parents=True, exist_ok=True)

    # ---- files ------------------------------------------------------------
    def path(self, name: str) -> Path:
        return self.dir / name

    def files(self) -> list[str]:
        """Every file that belongs in the Drive folder."""
        return sorted(p.name for p in self.dir.glob("*.json"))

    def ids(self) -> list[str]:
        return [n[:-5] for n in self.files() if n != "datapackage.json"]

    def doc(self, ds_id: str) -> dict | None:
        p = self.path(f"{ds_id}.json")
        if not p.exists():
            return None
        return json.loads(p.read_text(encoding="utf-8"))

    # ---- the Cache interface ------------------------------------------------
    def get(self, ds_id: str) -> dict | None:
        """Rows as text (empty = ""), in the shape the old cache had."""
        d = self.doc(ds_id)
        if d is None:
            return None
        fields = d.get("schema", {}).get("fields", [])
        return {
            "id": ds_id, "range": d.get("origin"),
            "header": [f.get("name", "") for f in fields],
            "values": [[to_text(v) for v in r] for r in d.get("rows", [])],
            "fetched_at": d.get("updated_at"), "changed_at": d.get("changed_at"),
            "fingerprint": d.get("fingerprint"), "source": d.get("source"),
        }

    def typed(self, ds_id: str) -> dict | None:
        return self.doc(ds_id)

    def put(self, ds_id: str, *, header: list[str], values: list[list[str]], source: str,
            range_a1: str | None = None, title: str = "", key: tuple[int, ...] = (),
            types: dict[int, str] | None = None) -> dict:
        """Store text rows as a typed dataset. Column types are inferred from the
        content unless given (types: {column: number|date|string})."""
        width = max([len(header)] + [len(r) for r in values]) if (header or values) else 0
        rows = [["" if v is None else str(v) for v in r] + [""] * (width - len(r)) for r in values]
        names = [(header[i] if i < len(header) and header[i] else f"Kolom {i + 1}") for i in range(width)]
        ftypes = [(types or {}).get(i) or infer_type([r[i] for r in rows]) for i in range(width)]
        typed_rows = []
        for r in rows:
            t = [to_typed(r[i], ftypes[i]) for i in range(width)]
            while t and t[-1] is None:      # trailing blanks, like the Sheets API
                t.pop()
            typed_rows.append(t)
        fields = [{"name": n, "type": t} for n, t in zip(names, ftypes)]
        with _LOCK:
            old = self.doc(ds_id) or {}
            fp = _fingerprint(fields, typed_rows)
            now = now_iso()
            doc = {
                "format": FORMAT_VERSION, "id": ds_id, "title": title or old.get("title") or ds_id,
                "schema": {"fields": fields, "primaryKey": [names[k] for k in key if k < width]},
                "updated_at": now,
                "changed_at": old.get("changed_at") if old.get("fingerprint") == fp else now,
                "fingerprint": fp, "source": source, "origin": range_a1 or old.get("origin"),
                "rows": typed_rows,
            }
            if old.get("fingerprint") == fp and old.get("title") == doc["title"]:
                return old          # nothing changed: keep the file (and its hash) as it is
            _write(self.path(f"{ds_id}.json"), _dumps(doc))
            self._write_index()
        return doc

    def _write_index(self) -> None:
        resources = []
        for ds_id in self.ids():
            d = self.doc(ds_id) or {}
            raw = self.path(f"{ds_id}.json").read_bytes()
            resources.append({
                "name": ds_id, "path": f"{ds_id}.json", "title": d.get("title", ds_id), "format": "json",
                "hash": "md5:" + md5_bytes(raw), "rows": len(d.get("rows", [])),
                "fields": len(d.get("schema", {}).get("fields", [])),
                "updated_at": d.get("updated_at"), "changed_at": d.get("changed_at"), "source": d.get("source"),
            })
        pkg = {"name": "indonesia-economic-outlook", "profile": "tabular-data-package",
               "format": FORMAT_VERSION, "updated_at": now_iso(), "resources": resources}
        _write(self.path("datapackage.json"), _dumps(pkg))

    def delete(self, ds_id: str) -> None:
        with _LOCK:
            p = self.path(f"{ds_id}.json")
            if p.exists():
                p.unlink()
                self._write_index()

    # ---- bookkeeping, local only --------------------------------------------
    def _read_local(self, name: str) -> dict:
        p = self.local / name
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}

    def _write_local(self, name: str, doc: dict) -> None:
        _write(self.local / name, _dumps(doc))

    def status(self) -> dict:
        return self._read_local("status.json")

    def record(self, ds_id: str, what: str, ok: bool, message: str = "") -> None:
        """what = 'pull' (from a feed Sheet), 'check' (updater) or 'sync' (Drive)."""
        with _LOCK:
            st = self.status()
            st.setdefault(ds_id, {})[what] = {"ok": ok, "at": now_iso(), "message": message}
            self._write_local("status.json", st)

    def meta(self) -> dict:
        return self._read_local("meta.json")

    def put_meta(self, doc: dict) -> None:
        self._write_local("meta.json", doc)

    # ---- sync state ---------------------------------------------------------
    def sync_state(self) -> dict:
        return self._read_local("sync.json")

    def set_sync(self, name: str, drive_id: str, md5: str) -> None:
        with _LOCK:
            st = self.sync_state()
            st.setdefault("files", {})[name] = {"drive_id": drive_id, "md5": md5}
            st["synced_at"] = now_iso()
            self._write_local("sync.json", st)

    def dirty(self) -> list[str]:
        """Files changed here since the last sync (or never uploaded)."""
        known = self.sync_state().get("files", {})
        out = []
        for name in self.files():
            if known.get(name, {}).get("md5") != md5_bytes(self.path(name).read_bytes()):
                out.append(name)
        return out


# ------------------------------------------------------------------ migration
def import_legacy_cache(cfg, store: Store, cache_dir: Path, derive=None) -> list[str]:
    """One-time: turn the old data/cache/*.json (text copies of the Sheets) into
    the typed store. Only runs for datasets the store does not have yet, so it
    never overwrites anything; the old folder is left as it was."""
    if not cache_dir.exists():
        return []
    done = []
    for path in sorted(cache_dir.glob("*.json")):
        ds_id = path.stem
        if ds_id.startswith("_") or store.doc(ds_id) is not None:
            continue
        try:
            old = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            continue
        ds = cfg.datasets.get(ds_id)
        values = old.get("values", [])
        if derive and ds is not None:
            values = derive(ds, values)
        store.put(ds_id, header=old.get("header") or [], values=values,
                  source="sheet" if (ds is None or ds.is_feed or ds_id.startswith("harga_")) else "migration",
                  range_a1=old.get("range"), title=ds.title if ds else ds_id, key=ds.key if ds else ())
        done.append(ds_id)
    st = cache_dir / "_status.json"
    if done and st.exists() and not store.status():
        store._write_local("status.json", json.loads(st.read_text(encoding="utf-8")))
    return done
