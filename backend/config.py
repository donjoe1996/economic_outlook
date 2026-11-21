"""Load config/datasets.yaml into small typed objects.

The YAML file is the single place that says *what* the app reads: one entry
per dataset, naming a Google Sheet tab and range (or a local file), plus how
the app may write to it. Everything else (API, cache, page) is generic.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config" / "datasets.yaml"
CACHE_DIR = ROOT / "data" / "cache"
SECRETS_DIR = ROOT / "secrets"
CREDENTIALS_PATH = SECRETS_DIR / "credentials.json"
TOKEN_PATH = SECRETS_DIR / "token.json"
FRONTEND_DIR = ROOT / "frontend"

WRITE_MODES = ("append", "fill", "none")

_RANGE_RE = re.compile(
    r"^(?P<tab>'(?:[^']|'')+'|[^!]+)!(?P<c1>[A-Z]+)(?P<r1>\d+):(?P<c2>[A-Z]+)(?P<r2>\d*)$"
)


def col_to_index(col: str) -> int:
    """'A' -> 0, 'B' -> 1, 'AA' -> 26."""
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def index_to_col(i: int) -> str:
    """0 -> 'A', 26 -> 'AA'."""
    s = ""
    i += 1
    while i:
        i, rem = divmod(i - 1, 26)
        s = chr(65 + rem) + s
    return s


@dataclass(frozen=True)
class SheetRange:
    """A1 range such as 'PMI'!A2:G (open-ended) or 'Arus Modal Asing'!A17:G28."""

    tab: str          # tab name without quotes
    first_col: int    # 0-based
    last_col: int     # 0-based, inclusive
    first_row: int    # 1-based sheet row
    last_row: int | None  # 1-based inclusive, None = to the bottom of the tab

    @classmethod
    def parse(cls, text: str) -> "SheetRange":
        m = _RANGE_RE.match(text.strip())
        if not m:
            raise ValueError(f"Range '{text}' must look like Tab!A2:G or 'My Tab'!A2:G13")
        tab = m["tab"]
        if tab.startswith("'"):
            tab = tab[1:-1].replace("''", "'")
        return cls(
            tab=tab,
            first_col=col_to_index(m["c1"]),
            last_col=col_to_index(m["c2"]),
            first_row=int(m["r1"]),
            last_row=int(m["r2"]) if m["r2"] else None,
        )

    @property
    def width(self) -> int:
        return self.last_col - self.first_col + 1

    @property
    def quoted_tab(self) -> str:
        return "'" + self.tab.replace("'", "''") + "'"

    def a1(self) -> str:
        end = f"{index_to_col(self.last_col)}{self.last_row or ''}"
        return f"{self.quoted_tab}!{index_to_col(self.first_col)}{self.first_row}:{end}"

    def header_a1(self) -> str | None:
        """The row just above the data, which holds the column names."""
        if self.first_row <= 1:
            return None
        r = self.first_row - 1
        return f"{self.quoted_tab}!{index_to_col(self.first_col)}{r}:{index_to_col(self.last_col)}{r}"

    def cell_a1(self, row: int, col_offset: int) -> str:
        return f"{self.quoted_tab}!{index_to_col(self.first_col + col_offset)}{row}"


@dataclass
class Dataset:
    id: str
    title: str
    description: str = ""
    range: SheetRange | None = None   # Google Sheet source
    file: Path | None = None          # local file source (e.g. map shapes)
    write: str = "none"               # append | fill | none
    key: tuple[int, ...] = (0,)       # column offset(s) in the range that identify a row, e.g. the period
    updater: dict[str, Any] | None = None

    @property
    def kind(self) -> str:
        return "sheet" if self.range else "file"

    @property
    def writable(self) -> bool:
        return self.kind == "sheet" and self.write != "none"


@dataclass
class AppConfig:
    spreadsheet_id: str
    datasets: dict[str, Dataset] = field(default_factory=dict)

    @property
    def sheet_url(self) -> str:
        return f"https://docs.google.com/spreadsheets/d/{self.spreadsheet_id}/edit"


def _parse_key(value: Any) -> tuple[int, ...]:
    if isinstance(value, list):
        return tuple(int(v) for v in value)
    return (int(value),)


def load_config(path: Path = CONFIG_PATH) -> AppConfig:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    cfg = AppConfig(spreadsheet_id=str(raw["spreadsheet_id"]))
    for ds_id, d in (raw.get("datasets") or {}).items():
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", ds_id):
            raise ValueError(f"Dataset id '{ds_id}' may only use letters, digits, _ and -")
        write = d.get("write", "none")
        if write not in WRITE_MODES:
            raise ValueError(f"{ds_id}: write must be one of {WRITE_MODES}")
        rng = SheetRange.parse(d["range"]) if d.get("range") else None
        if write == "append" and rng and rng.last_row is not None:
            raise ValueError(
                f"{ds_id}: write: append needs an open-ended range (e.g. PMI!A2:G), "
                "otherwise new rows would fall outside it"
            )
        file = (ROOT / d["file"]) if d.get("file") else None
        if not rng and not file:
            raise ValueError(f"{ds_id}: give either range or file")
        cfg.datasets[ds_id] = Dataset(
            id=ds_id,
            title=d.get("title", ds_id),
            description=d.get("description", ""),
            range=rng,
            file=file,
            write=write,
            key=_parse_key(d.get("key", 0)),
            updater=d.get("updater"),
        )
    return cfg
