"""Automatic updaters: small plugins that fetch new data from official sources.

Two kinds:

1. Proposers (REGISTRY), for curated monthly tables:

       propose(dataset, existing_rows, fetch) -> list of new rows

   They only *propose* rows. Nothing is written until you confirm them on the
   page ("Cek baru"), which then goes through the same Service.upsert as the
   manual form.

2. Auto feeds (AUTO, `auto: true` in the YAML), for machine data that is
   published as an API (daily on-chain metrics, M2 series):

       pull(dataset, existing_doc, fetch, progress) -> (header, rows, note)

   They run on every "Tarik", like the GOOGLEFINANCE price feeds, and return
   the whole table with the new periods merged in (Service.auto_update).

To add a source (e.g. BPS, World Bank), write backend/updaters/<name>.py and
register it below.
"""
from __future__ import annotations

import urllib.request
from typing import Callable

from . import coinmetrics, fred, liquidity

REGISTRY: dict[str, Callable] = {
    "fred": fred.propose,
}

AUTO: dict[str, Callable] = {
    "coinmetrics": coinmetrics.pull,
    "liquidity": liquidity.pull,
}


def http_get(url: str, timeout: float = 60) -> str:
    # Standard "compatible" form, still naming this app honestly; some servers
    # stall requests whose User-Agent doesn't follow the usual format.
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; economic-outlook-local/1.0)",
        "Accept": "text/csv,application/json;q=0.9,*/*;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")
