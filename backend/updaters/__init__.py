"""Automatic updaters: small plugins that fetch new periods from official sources.

An updater is a function

    propose(dataset, existing_rows, fetch) -> list of new Sheet rows

It only *proposes* rows. Nothing is written until you confirm them on the
page, which then goes through the same Service.upsert as the manual form.

To add a source (e.g. BPS, World Bank), write backend/updaters/<name>.py with
a propose() function and register it in REGISTRY below.
"""
from __future__ import annotations

import urllib.request
from typing import Callable

from . import fred

REGISTRY: dict[str, Callable] = {
    "fred": fred.propose,
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
