"""Datasets computed on the server from other datasets (`compute:` in the YAML).

The page reads them with dash.data('<id>') like any dataset, and the Claude
fact sheet (scripts/digest.py) imports the same functions, so the numbers on
the page and the numbers Claude may cite can never disagree.

Results are cached until the store changes (its index, datapackage.json, is
rewritten on every save or pull) or the day changes.
"""
from __future__ import annotations

from datetime import date

_CACHE: dict[str, tuple] = {}


def _stamp(store) -> tuple:
    idx = store.path("datapackage.json")
    return (idx.stat().st_mtime_ns if idx.exists() else None, date.today().isoformat())


def run(name: str, store):
    if name == "btc":
        from . import btc
        fn = btc.analysis
    else:
        raise ValueError(f"compute '{name}' tidak dikenal")
    key = (name, str(store.dir))
    stamp = _stamp(store)
    hit = _CACHE.get(key)
    if hit and hit[0] == stamp:
        return hit[1]
    out = fn(store)
    _CACHE[key] = (stamp, out)
    return out
