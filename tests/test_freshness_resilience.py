"""Freshness rules (metadata page) and failure handling (retries, skipping)."""
from datetime import date

import pytest

from backend.store import Store as Cache
from backend.config import AppConfig, Dataset, SheetRange
from backend.freshness import assess, parse_period
from backend.jobs import Job
from backend.retry import is_transient, with_retry
from backend.service import Service

TODAY = date(2026, 11, 21)


@pytest.mark.parametrize("text,expected", [
    ("Okt'25", date(2025, 10, 31)),
    ("Q3'26", date(2026, 9, 30)),
    ("30 Okt 2025 (turunan)", date(2025, 10, 30)),
    ("31 Mar 2026", date(2026, 3, 31)),
    ("2026-10-23", date(2026, 10, 23)),
    ("Des 2025", date(2025, 12, 31)),
    ("Okt'26 (sampai 29 Okt)", date(2026, 10, 31)),
    ("Aceh", None),
])
def test_parse_period(text, expected):
    assert parse_period(text) == expected


def test_monthly_with_lag():
    # On 21 Nov, October data with a 3-day lag (out ~3 Nov) should exist.
    f = assess("monthly", date(2026, 9, 30), TODAY, lag_days=3)
    assert (f.status, f.expected, f.behind) == ("due", "Okt'26", 1)
    # A 25-day lag means October is not due yet, so September is current.
    assert assess("monthly", date(2026, 9, 30), TODAY, lag_days=25).status == "ok"
    assert assess("monthly", date(2026, 8, 31), TODAY, lag_days=3).status == "late"


def test_quarterly_with_lag():
    # Q3 ends 30 Sep; +40 days = 9 Nov, so on 21 Nov Q3 is expected.
    f = assess("quarterly", date(2026, 6, 30), TODAY, lag_days=40)
    assert (f.status, f.expected) == ("due", "Q3'26")
    assert assess("quarterly", date(2026, 9, 30), TODAY, lag_days=40).status == "ok"


def test_irregular_and_snapshot():
    assert assess("irregular", date(2026, 10, 30), TODAY, stale_after_days=14).status == "stale"
    assert assess("irregular", date(2026, 11, 15), TODAY, stale_after_days=14).status == "ok"
    assert assess("snapshot", date(2026, 3, 31), TODAY).status == "snapshot"


def test_retry_recovers_from_transient_and_stops_on_permanent():
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) < 3:
            raise TimeoutError("The read operation timed out")
        return "ok"

    assert with_retry(flaky, sleep=lambda s: None) == "ok" and len(calls) == 3

    def bad_input():
        calls.append(1)
        raise ValueError("bad range")

    calls.clear()
    with pytest.raises(ValueError):
        with_retry(bad_input, sleep=lambda s: None)
    assert len(calls) == 1  # not retried
    assert is_transient(TimeoutError()) and not is_transient(ValueError())


class FlakySheet:
    """Tab 'Bad' always times out; everything else answers."""

    def __init__(self):
        self.data = {"'A'!A2:B": [["Sep'26", "1"]], "'Bad'!A2:B": [["Sep'26", "2"]], "'C'!A2:B": [["Sep'26", "3"]]}

    def batch_get(self, sid, ranges):
        if any("Bad" in r for r in ranges):
            raise TimeoutError("The read operation timed out")
        return [self.data.get(r, [["h1", "h2"]]) for r in ranges]


def test_one_failing_tab_does_not_stop_the_pull(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.service.with_retry", lambda fn, **kw: fn())  # no waiting in tests
    cfg = AppConfig("x", {
        k: Dataset(k, k, range=SheetRange.parse(f"{k}!A2:B"), write="none", source="sheet") for k in ("A", "Bad", "C")
    })
    cache = Cache(tmp_path)
    cache.put("Bad", range_a1="'Bad'!A2:B", header=[], values=[["Agu'26", "old"]], source="sheet")
    job = Job(id="1", kind="refresh", title="t")
    out = Service(cfg, cache, FlakySheet()).refresh(progress=job, batch=3)
    assert set(out["rows"]) == {"A", "C"}                      # neighbours still pulled
    assert "TimeoutError" in out["failed"]["Bad"]
    assert cache.get("Bad")["values"] == [["Agu'26", "old"]]  # old copy kept
    assert cache.status()["Bad"]["pull"]["ok"] is False        # recorded for the metadata page
    assert len(job.warnings) == 1


def test_metadata_flags_due_and_gaps(tmp_path):
    cfg = AppConfig("x", {"pmi": Dataset("pmi", "PMI", range=SheetRange.parse("PMI!A2:B"), write="append", frequency="monthly", lag_days=3)})
    cache = Cache(tmp_path)
    cache.put("pmi", range_a1="x", header=[], values=[["Agu'26", "49.8"], ["Sep'26", ""]], source="sheet")
    item = Service(cfg, cache, None).metadata(TODAY)["datasets"][0]
    assert item["latest"] == "Agu'26" and item["expected"] == "Okt'26" and item["status"] == "late"
    assert item["gaps"] == ["Sep'26"]
