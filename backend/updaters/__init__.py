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


def http_get(url: str, timeout: float = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "economic-outlook-local/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")
