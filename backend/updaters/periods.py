"""Period labels used in the Sheet: monthly "Okt'25", quarterly "Q3'26"."""
from __future__ import annotations

import re

ID_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
_MONTH_RE = re.compile(r"^(%s)'(\d{2})" % "|".join(ID_MONTHS))
_QUARTER_RE = re.compile(r"^Q([1-4])'(\d{2})")


def label(frequency: str, year: int, n: int) -> str:
    """n is the month (1-12) or the quarter (1-4)."""
    yy = f"{year % 100:02d}"
    if frequency == "monthly":
        return f"{ID_MONTHS[n - 1]}'{yy}"
    if frequency == "quarterly":
        return f"Q{n}'{yy}"
    raise ValueError(f"Unknown frequency {frequency}")


def parse(frequency: str, text: str) -> tuple[int, int] | None:
    """"Okt'25" -> (2025, 10). Labels it cannot read return None."""
    text = str(text).strip()
    if frequency == "monthly":
        m = _MONTH_RE.match(text)
        return (2000 + int(m[2]), ID_MONTHS.index(m[1]) + 1) if m else None
    if frequency == "quarterly":
        m = _QUARTER_RE.match(text)
        return (2000 + int(m[2]), int(m[1])) if m else None
    raise ValueError(f"Unknown frequency {frequency}")
