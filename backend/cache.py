"""Local copy of every dataset, one JSON file each in data/cache/.

The page always reads from here, so it opens instantly and works offline.
"Tarik dari Sheet" (refresh) overwrites these files with what the Sheet holds.

Besides the values, the cache keeps two kinds of bookkeeping for the
metadata page:
  * fetched_at / changed_at  - when it was last pulled, and when its content
    last actually changed (a pull that brings the same numbers keeps the
    old changed_at);
  * _status.json             - the outcome of the last pull and the last
    automatic check per dataset, including errors. A failed pull never
    overwrites the previous good copy.
"""
from __future__ import annotations

import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path

from .config import CACHE_DIR

_STATUS_LOCK = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _fingerprint(header: list, values: list) -> str:
    raw = json.dumps([header, values], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _write_json(path: Path, doc: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)  # atomic: readers see the old file or the new one, never half


class Cache:
    def __init__(self, directory: Path = CACHE_DIR):
        self.dir = directory
        self.dir.mkdir(parents=True, exist_ok=True)

    def _path(self, ds_id: str) -> Path:
        return self.dir / f"{ds_id}.json"

    def get(self, ds_id: str) -> dict | None:
        p = self._path(ds_id)
        if not p.exists():
            return None
        return json.loads(p.read_text(encoding="utf-8"))

    def put(self, ds_id: str, *, range_a1: str, header: list[str], values: list[list[str]], source: str) -> dict:
        old = self.get(ds_id) or {}
        fp = _fingerprint(header, values)
        now = now_iso()
        doc = {
            "id": ds_id,
            "range": range_a1,
            "header": header,
            "values": values,
            "fetched_at": now,
            "changed_at": old.get("changed_at") if old.get("fingerprint") == fp else now,
            "fingerprint": fp,
            "source": source,  # "sheet" or "xlsx-import"
        }
        _write_json(self._path(ds_id), doc)
        return doc

    # ---- outcome of the last pull / automatic check ----------------------
    def _status_path(self) -> Path:
        return self.dir / "_status.json"

    def status(self) -> dict:
        p = self._status_path()
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}

    def record(self, ds_id: str, what: str, ok: bool, message: str = "") -> None:
        """what = 'pull' (from the Sheet) or 'check' (automatic updater)."""
        with _STATUS_LOCK:
            st = self.status()
            st.setdefault(ds_id, {})[what] = {"ok": ok, "at": now_iso(), "message": message}
            _write_json(self._status_path(), st)

    # ---- spreadsheet-level facts (tab ids for deep links) ---------------
    def put_meta(self, doc: dict) -> None:
        _write_json(self.dir / "_sheet.json", doc)

    def meta(self) -> dict:
        p = self.dir / "_sheet.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
