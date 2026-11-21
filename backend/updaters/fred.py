"""Updater: FRED (Federal Reserve Bank of St. Louis).

Two ways in, tried in this order:
  1. the official FRED API (needs a free key: put it in the environment
     variable FRED_API_KEY or in secrets/fred_api_key.txt). Made for
     programs, so it is the more reliable route;
  2. the CSV download behind FRED's web pages
     (fredgraph.csv?id=<SERIES>), no key, but it can be slow or throttled
     for scripts.
Each is retried on timeouts/server errors (backend/retry.py).

The observations are grouped by month or quarter, and one Sheet row is
proposed per period newer than the last period already in the Sheet.

Config (in config/datasets.yaml, under a dataset):

    updater:
      type: fred
      frequency: monthly | quarterly
      aggregate: last | mean        # how daily values become one per period
      columns: {B: SERIES_ID, ...}  # Sheet column -> series
      mean:    {I: [B, H]}          # optional derived columns
      static:  {C: "text", ...}     # fixed text in every new row
"""
from __future__ import annotations

import csv
import io
import json
import os
from collections import defaultdict
from datetime import date
from typing import Callable

from ..config import SECRETS_DIR, Dataset, col_to_index
from ..retry import short_error, with_retry
from . import periods

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}"
FRED_API = "https://api.stlouisfed.org/fred/series/observations?series_id={series}&api_key={key}&file_type=json"


def _api_key() -> str | None:
    key = os.environ.get("FRED_API_KEY", "").strip()
    if not key:
        f = SECRETS_DIR / "fred_api_key.txt"
        key = f.read_text(encoding="utf-8").strip() if f.exists() else ""
    return key or None


def _parse_api(text: str) -> list[tuple[date, float]]:
    out = []
    for o in json.loads(text).get("observations", []):
        if o.get("value") not in (None, "", "."):
            out.append((date.fromisoformat(o["date"]), float(o["value"])))
    return out


def fetch_series(series: str, fetch: Callable[[str], str], progress=None) -> list[tuple[date, float]]:
    def note(attempt, exc, delay):
        if progress:
            progress.step(f"{series}: percobaan {attempt} gagal ({short_error(exc)}); coba lagi dalam {delay:.0f} dtk")

    key = _api_key()
    if key:
        try:
            return _parse_api(with_retry(lambda: fetch(FRED_API.format(series=series, key=key)), on_retry=note))
        except Exception as exc:
            if progress:
                progress.step(f"{series}: FRED API gagal ({short_error(exc)}); mencoba unduhan CSV")
    return _parse_csv(with_retry(lambda: fetch(FRED_CSV.format(series=series)), on_retry=note))


def _parse_csv(text: str) -> list[tuple[date, float]]:
    out = []
    reader = csv.reader(io.StringIO(text))
    next(reader, None)  # header: observation_date,<SERIES>
    for row in reader:
        if len(row) < 2 or row[1] in ("", "."):
            continue  # FRED writes "." for a missing value
        out.append((date.fromisoformat(row[0]), float(row[1])))
    return out


def _period_of(frequency: str, d: date) -> tuple[int, int]:
    return (d.year, d.month) if frequency == "monthly" else (d.year, (d.month - 1) // 3 + 1)


def _period_is_over(frequency: str, p: tuple[int, int], today: date) -> bool:
    y, n = p
    if frequency == "monthly":
        nxt = (y + 1, 1) if n == 12 else (y, n + 1)
    else:
        nxt = (y + 1, 1) if n == 4 else (y, n + 1)
        nxt = (nxt[0], (nxt[1] - 1) * 3 + 1)
    return today >= date(nxt[0], nxt[1], 1)


def _fmt(v: float) -> str:
    return f"{v:.4f}".rstrip("0").rstrip(".")


def propose(ds: Dataset, existing: list[list[str]], fetch: Callable[[str], str], today: date | None = None, progress=None) -> list[list[str]]:
    conf = ds.updater or {}
    freq = conf.get("frequency", "monthly")
    agg = conf.get("aggregate", "last")
    today = today or date.today()
    first_col = ds.range.first_col
    width = ds.range.width

    def offset(letter: str) -> int:
        i = col_to_index(letter) - first_col
        if not 0 <= i < width:
            raise ValueError(f"{ds.id}: column {letter} is outside range {ds.range.a1()}")
        return i

    # 1. one value per period for each series
    per_col: dict[int, dict[tuple[int, int], float]] = {}
    for letter, series in (conf.get("columns") or {}).items():
        if progress:
            progress.step(f"{ds.title}: mengambil seri {series} dari FRED")
        groups: dict[tuple[int, int], list[tuple[date, float]]] = defaultdict(list)
        for d, v in fetch_series(series, fetch, progress):
            groups[_period_of(freq, d)].append((d, v))
        per_col[offset(letter)] = {
            p: (max(obs)[1] if agg == "last" else sum(v for _, v in obs) / len(obs)) for p, obs in groups.items()
        }

    # 2. periods newer than the newest one in the Sheet, and already finished
    known = [periods.parse(freq, r[ds.key[0]]) for r in existing if len(r) > ds.key[0]]
    known = [p for p in known if p]
    last = max(known) if known else None
    common = set.intersection(*(set(v) for v in per_col.values())) if per_col else set()
    todo = sorted(p for p in common if (last is None or p > last))
    if freq == "monthly":
        todo = [p for p in todo if _period_is_over(freq, p, today)]

    # 3. build rows
    rows = []
    for p in todo:
        row = [""] * width
        row[ds.key[0]] = periods.label(freq, *p)
        for c, values in per_col.items():
            row[c] = _fmt(values[p])
        for letter, parts in (conf.get("mean") or {}).items():
            nums = [float(row[offset(x)]) for x in parts]
            row[offset(letter)] = _fmt(sum(nums) / len(nums))
        for letter, text in (conf.get("static") or {}).items():
            row[offset(letter)] = str(text)
        rows.append(row)
    return rows
