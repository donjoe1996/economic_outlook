"""Retry what is worth retrying, give up quickly on what is not.

Transient: timeouts, dropped connections, "too many requests" (429) and
server errors (5xx). These often succeed a few seconds later, so we wait
1 s, 2 s, 4 s ... between attempts (exponential backoff, so a struggling
server gets breathing room).

Permanent: bad input, missing permission, a 404. Retrying only wastes time,
so they are raised at once.
"""
from __future__ import annotations

import socket
import time
import urllib.error
from typing import Callable, TypeVar

T = TypeVar("T")


def is_transient(exc: BaseException) -> bool:
    if isinstance(exc, (TimeoutError, socket.timeout, ConnectionError)):
        return True
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code == 429 or exc.code >= 500
    if isinstance(exc, urllib.error.URLError):
        return True  # DNS hiccup, refused connection, timeout inside urlopen
    status = getattr(getattr(exc, "resp", None), "status", None)  # googleapiclient HttpError
    if status is not None:
        return int(status) == 429 or int(status) >= 500
    return "timed out" in str(exc).lower()


def with_retry(
    fn: Callable[[], T],
    *,
    attempts: int = 3,
    base_delay: float = 1.0,
    on_retry: Callable[[int, BaseException, float], None] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> T:
    for i in range(1, attempts + 1):
        try:
            return fn()
        except Exception as exc:
            if i == attempts or not is_transient(exc):
                raise
            delay = base_delay * 2 ** (i - 1)
            if on_retry:
                on_retry(i, exc, delay)
            sleep(delay)
    raise AssertionError("unreachable")


def short_error(exc: BaseException) -> str:
    """'TimeoutError: The read operation timed out' -> readable one-liner."""
    msg = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    return f"{type(exc).__name__}: {msg}"[:300] if msg else type(exc).__name__
