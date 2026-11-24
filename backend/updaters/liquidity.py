"""Auto feed: money supply (M2) of the US, the euro area and China, monthly.

Columns (fixed order, the same as the Bitcoin Lab's money supply sheet):

    0 Tanggal            first day of the month, YYYY-MM-01
    1 US M2 (USD bn)     FRED M2SL (Federal Reserve H.6, seasonally adjusted)
    2 China M2 (CNY bn)  by hand: People's Bank of China monthly report.
                         There is no free official API, so this column is
                         never overwritten; new months stay blank until filled
                         in with the "+ Data" form.
    3 CNY per USD        FRED EXCHUS (Federal Reserve H.10, monthly average)
    4 Euro M2 (EUR bn)   ECB Data Portal, BSI.M.U2.Y.V.M20.X.1.U2.2300.Z01.E
                         (outstanding amounts, EUR millions / 1000)
    5 USD per EUR        FRED EXUSEU (Federal Reserve H.10, monthly average)

Every source is optional: if one fails, the others still update and the
failure is reported. Values already stored are kept unless a source gives a
new value for that month (official series get revised).

Config:
    updater: {type: liquidity, auto: true, start: "2008-01"}
"""
from __future__ import annotations

import csv
import io
from typing import Callable

from ..retry import short_error, with_retry
from .coinmetrics import fmt_sig
from .fred import fetch_series

ECB = ("https://data-api.ecb.europa.eu/service/data/BSI/M.U2.Y.V.M20.X.1.U2.2300.Z01.E"
       "?format=csvdata&startPeriod={start}")
FRED_COLS = {1: "M2SL", 3: "EXCHUS", 5: "EXUSEU"}
WIDTH = 6


def parse_ecb_csv(text: str) -> dict[str, float]:
    """ECB SDMX CSV -> {'YYYY-MM': value in EUR bn}."""
    out = {}
    rd = csv.DictReader(io.StringIO(text))
    for r in rd:
        p, v = (r.get("TIME_PERIOD") or "").strip(), (r.get("OBS_VALUE") or "").strip()
        if len(p) == 7 and v:
            try:
                out[p] = float(v) / 1000.0
            except ValueError:
                continue
    return out


def pull(ds, existing: dict | None, fetch: Callable[[str], str], progress=None, today=None):
    conf = ds.updater or {}
    start = str(conf.get("start", "2008-01"))
    header = list(ds.columns)
    rows: dict[str, list[str]] = {}
    for r in (existing or {}).get("values", []):
        if r and len(str(r[0])) >= 7:
            key = str(r[0])[:7]
            row = (list(r) + [""] * WIDTH)[:WIDTH]
            row[0] = key + "-01"
            rows[key] = row

    got: dict[int, dict[str, float]] = {}
    failed = []
    for col, series in FRED_COLS.items():
        try:
            if progress:
                progress.step(f"Likuiditas: mengambil {series} dari FRED")
            got[col] = {d.isoformat()[:7]: v for d, v in fetch_series(series, fetch, progress) if d.isoformat()[:7] >= start}
        except Exception as exc:
            failed.append(f"{series} ({short_error(exc)})")
    try:
        if progress:
            progress.step("Likuiditas: mengambil M2 kawasan euro dari ECB")
        got[4] = parse_ecb_csv(with_retry(lambda: fetch(ECB.format(start=start))))
    except Exception as exc:
        failed.append(f"ECB M2 ({short_error(exc)})")
    if not got:
        raise RuntimeError("Semua sumber likuiditas gagal: " + "; ".join(failed))

    changed = 0
    for col, values in got.items():
        sig = 6 if col in (3, 5) else 7
        for month, v in values.items():
            row = rows.get(month)
            if row is None:
                if col != 1:        # a new month starts with US M2, the anchor series
                    continue
                row = rows[month] = [month + "-01"] + [""] * (WIDTH - 1)
            txt = fmt_sig(v, sig)
            if row[col] != txt:
                row[col] = txt
                changed += 1
    out = [rows[k] for k in sorted(rows)]
    blank_cn = [r[0][:7] for r in out[-6:] if not r[2]]
    note = f"{changed} sel berubah"
    if blank_cn:
        note += "; M2 China belum diisi untuk " + ", ".join(blank_cn) + " (isi lewat + Data, sumber PBoC)"
    if failed:
        note += "; gagal: " + "; ".join(failed)
        if progress:
            progress.warn("Likuiditas: " + "; ".join(failed))
    return header, out, note
