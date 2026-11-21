"""Is a dataset up to date? Compare what the Sheet has with what should exist.

First principles: a statistic for period P can only exist after P has ended
*and* the publisher has had time to release it (the publication lag). So

    expected latest period = the newest P with  end(P) + lag_days <= today
    behind                 = periods between the Sheet's newest P and that

Datasets without a calendar (yields quoted on random dates, one-off tables)
use an age limit instead (stale_after_days), or are marked as snapshots.

The schedule per dataset lives in config/datasets.yaml (frequency, lag_days,
stale_after_days). The lags are approximate: check the publisher's release
calendar and adjust them there.
"""
from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date, timedelta

# Indonesian and English month abbreviations (the Sheet mixes both).
_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "mei": 5, "may": 5, "jun": 6, "jul": 7,
    "agu": 8, "agt": 8, "aug": 8, "sep": 9, "okt": 10, "oct": 10, "nov": 11, "des": 12, "dec": 12,
}
_ID_MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
_MON = "|".join(_MONTHS)

_RE_MONTH_YY = re.compile(rf"^({_MON})[a-z]*'(\d{{2}})\b", re.I)            # Okt'25
_RE_QUARTER = re.compile(r"^Q([1-4])'(\d{2})\b", re.I)                         # Q3'26
_RE_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")                              # 2026-10-30
_RE_DAY = re.compile(rf"^(\d{{1,2}})\s+({_MON})[a-z]*\.?\s+(\d{{4}})\b", re.I)  # 30 Okt 2026
_RE_MONTH_YYYY = re.compile(rf"^({_MON})[a-z]*\s+(\d{{4}})\b", re.I)          # Des 2025
_RE_US = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})")                          # 11/20/2026 16:00:00 (Google Finance)


def month_end(y: int, m: int) -> date:
    return date(y, m, calendar.monthrange(y, m)[1])


def parse_period(text: str) -> date | None:
    """The last day covered by a period label, or None if it is not a period.

    "Okt'25" -> 2025-10-31, "Q3'26" -> 2026-09-30, "30 Okt 2026 (turunan)"
    -> 2026-10-30, "Des 2025" -> 2025-12-31.
    """
    t = str(text or "").strip()
    if m := _RE_MONTH_YY.match(t):
        return month_end(2000 + int(m[2]), _MONTHS[m[1].lower()[:3]])
    if m := _RE_QUARTER.match(t):
        return month_end(2000 + int(m[2]), int(m[1]) * 3)
    if m := _RE_ISO.match(t):
        try:
            return date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            return None
    if m := _RE_DAY.match(t):
        try:
            return date(int(m[3]), _MONTHS[m[2].lower()[:3]], int(m[1]))
        except ValueError:
            return None
    if m := _RE_US.match(t):
        try:
            return date(int(m[3]), int(m[1]), int(m[2]))
        except ValueError:
            return None
    if m := _RE_MONTH_YYYY.match(t):
        return month_end(int(m[2]), _MONTHS[m[1].lower()[:3]])
    return None


def label(frequency: str, end: date) -> str:
    if frequency == "quarterly":
        return f"Q{(end.month - 1) // 3 + 1}'{end.year % 100:02d}"
    if frequency == "monthly":
        return f"{_ID_MON[end.month - 1]}'{end.year % 100:02d}"
    return f"{end.day} {_ID_MON[end.month - 1]} {end.year}"


def _step(frequency: str, end: date, n: int) -> date:
    """Move a period end n periods forward (or back, if n < 0)."""
    months = 3 if frequency == "quarterly" else 1
    idx = end.year * 12 + (end.month - 1) + n * months
    return month_end(idx // 12, idx % 12 + 1)


def _periods_between(frequency: str, a: date, b: date) -> int:
    months = 3 if frequency == "quarterly" else 1
    return ((b.year * 12 + b.month) - (a.year * 12 + a.month)) // months


@dataclass
class Freshness:
    status: str            # ok | due | late | stale | snapshot | static | unknown
    text: str              # one plain sentence for the page
    latest: str | None = None        # newest period in the Sheet (with a value)
    expected: str | None = None      # newest period that should be out by now
    behind: int = 0
    next_release: str | None = None  # when the next period should appear


def assess(frequency: str, latest_end: date | None, today: date, lag_days: int = 0, stale_after_days: int | None = None) -> Freshness:
    if frequency == "static":
        return Freshness("static", "Data tetap (tidak berubah per periode).")
    if latest_end is None:
        return Freshness("unknown", "Periode di kolom kunci tidak terbaca.")
    latest_txt = label(frequency if frequency in ("monthly", "quarterly") else "date", latest_end)

    if frequency in ("monthly", "quarterly"):
        # newest period whose release date has passed
        # start at the end of the current month/quarter, step back until released
        last_month = ((today.month - 1) // 3 + 1) * 3 if frequency == "quarterly" else today.month
        expected = month_end(today.year, last_month)
        while expected + timedelta(days=lag_days) > today:
            expected = _step(frequency, expected, -1)
        behind = max(0, _periods_between(frequency, latest_end, expected))
        nxt = _step(frequency, max(latest_end, expected), 1)
        next_release = (nxt + timedelta(days=lag_days)).isoformat()
        exp_txt = label(frequency, expected)
        if behind == 0:
            return Freshness("ok", f"Terbaru. Periode berikutnya ({label(frequency, nxt)}) biasanya rilis sekitar {next_release}.",
                             latest_txt, exp_txt, 0, next_release)
        status = "due" if behind == 1 else "late"
        return Freshness(status, f"Tertinggal {behind} periode: {exp_txt} seharusnya sudah rilis, data terakhir {latest_txt}.",
                         latest_txt, exp_txt, behind, next_release)

    age = (today - latest_end).days
    if frequency == "snapshot":
        return Freshness("snapshot", f"Potret satu waktu ({latest_txt}, {age} hari lalu). Perbarui bila ada rilis baru.", latest_txt)
    # irregular: quoted on arbitrary dates, judged by age
    limit = stale_after_days or 30
    if age <= limit:
        return Freshness("ok", f"Titik terakhir {latest_txt} ({age} hari lalu), masih dalam batas {limit} hari.", latest_txt)
    return Freshness("stale", f"Titik terakhir {latest_txt} sudah {age} hari, lewat batas {limit} hari.", latest_txt)
