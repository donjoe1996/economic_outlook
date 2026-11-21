"""Updater: FRED (Federal Reserve Bank of St. Louis), no API key needed.

Reads https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES>, groups the
observations by month or quarter, and proposes one Sheet row per period that
is newer than the last period already in the Sheet.

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
from collections import defaultdict
from datetime import date
from typing import Callable

from ..config import Dataset, col_to_index
from . import periods

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}"


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
        for d, v in _parse_csv(fetch(FRED_CSV.format(series=series))):
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
