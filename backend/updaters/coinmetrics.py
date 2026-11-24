"""Auto feed: Coin Metrics Community API (free, no key), daily asset metrics.

    https://community-api.coinmetrics.io/v4/timeseries/asset-metrics
        ?assets=btc&metrics=PriceUSD,CapMVRVCur&frequency=1d
        &start_time=2010-07-18&page_size=10000&paging_from=start

Answer: {"data": [{"asset": "btc", "time": "2026-11-23T00:00:00.000000000Z",
"PriceUSD": "86512.3", ...}], "next_page_url": "..."}; values are strings,
and a page may carry a next_page_url to follow.

Runs on every "Tarik" (no confirmation, like the price feeds): it asks only
for the days since the newest stored day (minus a small overlap, because the
newest day can be revised), merges them in and returns the whole table.

Some metrics are paid-only and the API refuses a request that names one. So
if the combined request is refused, each metric is asked for on its own and
the refused ones are reported and left blank; the rest still update.

Config (config/datasets.yaml, under the dataset):

    updater:
      type: coinmetrics
      auto: true
      asset: btc
      start: "2010-07-18"
      overlap_days: 7
      metrics:                      # in column order after the date column
        - {metric: PriceUSD, sig: 6}
        - {metric: HashRate, scale: 0.000001, sig: 6}   # TH/s -> EH/s
"""
from __future__ import annotations

import json
import math
import urllib.error
import urllib.parse
from datetime import date, timedelta
from typing import Callable

from ..retry import short_error, with_retry

API = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"


def fmt_sig(v: float, sig: int = 6) -> str:
    """Round to significant figures and write it plainly (never 1e-05):
    the store reads '0.0858' as a number but '8.58e-02' as text."""
    if v == 0 or not math.isfinite(v):
        return "0" if v == 0 else ""
    decimals = sig - 1 - int(math.floor(math.log10(abs(v))))   # negative: round left of the point
    t = f"{round(v, decimals):.{max(0, decimals)}f}"
    return t.rstrip("0").rstrip(".") if "." in t else t


def url_for(asset: str, metrics: list[str], start: str) -> str:
    q = {"assets": asset, "metrics": ",".join(metrics), "frequency": "1d", "start_time": start,
         "page_size": "10000", "paging_from": "start"}
    return API + "?" + urllib.parse.urlencode(q)


def fetch_rows(asset: str, metrics: list[str], start: str, fetch: Callable[[str], str], progress=None) -> dict[str, dict[str, float]]:
    """{ 'YYYY-MM-DD': {metric: value} } for every page of one request."""
    out: dict[str, dict[str, float]] = {}
    url, pages = url_for(asset, metrics, start), 0

    def note(attempt, exc, delay):
        if progress:
            progress.step(f"Coin Metrics: percobaan {attempt} gagal ({short_error(exc)}); coba lagi dalam {delay:.0f} dtk")

    while url and pages < 50:
        body = json.loads(with_retry(lambda u=url: fetch(u), on_retry=note))
        for rec in body.get("data", []):
            day = str(rec.get("time", ""))[:10]
            if len(day) != 10:
                continue
            vals = out.setdefault(day, {})
            for m in metrics:
                try:
                    v = float(rec[m])
                except (KeyError, TypeError, ValueError):
                    continue
                if math.isfinite(v):
                    vals[m] = v
        url = body.get("next_page_url") or None
        pages += 1
    return out


def _refused(exc: Exception) -> bool:
    """A 4xx answer (unknown or paid-only metric), as opposed to a network fault."""
    return isinstance(exc, urllib.error.HTTPError) and 400 <= exc.code < 500


def pull(ds, existing: dict | None, fetch: Callable[[str], str], progress=None, today: date | None = None):
    """Return (header, rows, note): the whole table with the new days merged in."""
    conf = ds.updater or {}
    asset = conf.get("asset", "btc")
    specs = conf.get("metrics") or []
    names = [s["metric"] for s in specs]
    header = list(ds.columns) if ds.columns else ["Tanggal"] + names
    width = 1 + len(specs)

    rows: dict[str, list[str]] = {}
    for r in (existing or {}).get("values", []):
        if r and len(str(r[0])) >= 10:
            rows[str(r[0])[:10]] = (list(r) + [""] * width)[:width]

    first = str(conf.get("start", "2010-07-18"))
    if rows:
        newest = date.fromisoformat(max(rows))
        start = (newest - timedelta(days=int(conf.get("overlap_days", 7)))).isoformat()
    else:
        start = first
    if progress:
        progress.step(f"Coin Metrics: {asset.upper()} {len(names)} metrik sejak {start}")

    refused: list[str] = []
    try:
        got = fetch_rows(asset, names, start, fetch, progress)
    except Exception as exc:
        if not _refused(exc):
            raise
        # one metric is not on the free tier: ask one by one, keep the rest
        got = {}
        for m in names:
            try:
                for day, vals in fetch_rows(asset, [m], start, fetch, progress).items():
                    got.setdefault(day, {}).update(vals)
            except Exception as exc2:
                if not _refused(exc2):
                    raise
                refused.append(m)
        if len(refused) == len(names):
            raise RuntimeError(f"Coin Metrics menolak semua metrik ({short_error(exc)})") from exc

    changed = 0
    for day, vals in got.items():
        row = rows.get(day) or [day] + [""] * len(specs)
        for i, s in enumerate(specs, start=1):
            v = vals.get(s["metric"])
            if v is None:
                continue
            txt = fmt_sig(v * float(s.get("scale", 1)), int(s.get("sig", 6)))
            if row[i] != txt:
                row[i] = txt
                changed += 1
        rows[day] = row
    out = [rows[d] for d in sorted(rows)]
    note = f"{len(got)} hari diterima, {changed} sel berubah"
    if refused:
        note += f"; tidak tersedia di tier gratis: {', '.join(refused)}"
        if progress:
            progress.warn("Coin Metrics: metrik " + ", ".join(refused) + " tidak tersedia gratis; kolomnya dibiarkan kosong.")
    return header, out, note
