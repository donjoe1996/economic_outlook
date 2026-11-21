"""Local copy of every dataset, one JSON file each in data/cache/.

The page always reads from here, so it opens instantly and works offline.
"Tarik dari Sheet" (refresh) overwrites these files with what the Sheet holds.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .config import CACHE_DIR


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


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
        doc = {
            "id": ds_id,
            "range": range_a1,
            "header": header,
            "values": values,
            "fetched_at": now_iso(),
            "source": source,  # "sheet" or "xlsx-import"
        }
        tmp = self._path(ds_id).with_suffix(".tmp")
        tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self._path(ds_id))
        return doc
