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
CACHE_DIR = ROOT / "data" / "cache"          # the old local copy (before the JSON store)
STORE_DIR = ROOT / "data" / "store"          # local mirror of the Drive data folder
SECRETS_DIR = ROOT / "secrets"
CREDENTIALS_PATH = SECRETS_DIR / "credentials.json"
TOKEN_PATH = SECRETS_DIR / "token.json"
# Spreadsheets the app created itself (e.g. the shared Saham sheet): alias -> id.
# Kept out of git, like the cache; an id set in the YAML wins.
LOCAL_SPREADSHEETS_PATH = ROOT / "data" / "spreadsheets.local.json"
FRONTEND_DIR = ROOT / "frontend"

WRITE_MODES = ("append", "fill", "none")
FREQUENCIES = ("monthly", "quarterly", "irregular", "snapshot", "static")

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
    spreadsheet: str = ""             # Google spreadsheet id this dataset lives in
    group: str = "macro"              # which page loads it: macro (dashboard), stock, harga (one stock's prices)
    alias: str = ""                   # the spreadsheet alias it was declared with, if any
    # Where the data lives:
    #   store - a JSON file in the data store (Drive folder); edited in the app
    #   sheet - a feed: read from a Google Sheet tab (GOOGLEFINANCE formulas) on
    #           each pull and saved into the store; read-only in the app
    source: str = "store"
    # Columns the app computes on every write, instead of Sheet formulas:
    #   {col: I, op: diff, args: [B, C], round: 2}       I = B - C
    #   {col: J, op: iso_date, args: [A]}                J = date in A as YYYY-MM-DD
    #   {col: H, op: lookup, args: [A], dataset: flow, key: A, value: B}
    derived: tuple = ()
    columns: tuple = ()               # column names for a dataset that never lived in a Sheet
    # ---- publishing schedule, for the metadata page (backend/freshness.py)
    frequency: str = "snapshot"       # monthly | quarterly | irregular | snapshot | static
    lag_days: int = 0                 # days after a period ends until it is usually published
    stale_after_days: int | None = None  # irregular data: older than this = needs an update
    value_col: int = 1                # column (offset) whose blanks count as missing data
    period_col: int | None = None     # column with the period/date, default: first key column
    release: str = ""                 # who publishes it and when, in words
    release_url: str = ""             # where to find new releases
    note: str = ""

    @property
    def kind(self) -> str:
        return "sheet" if self.range else "file"

    @property
    def writable(self) -> bool:
        return self.kind == "sheet" and self.write != "none" and self.source == "store"

    @property
    def is_feed(self) -> bool:
        return self.kind == "sheet" and self.source == "sheet"


@dataclass
class AppConfig:
    spreadsheet_id: str                                   # the default (main) spreadsheet
    datasets: dict[str, Dataset] = field(default_factory=dict)
    spreadsheets: dict[str, str] = field(default_factory=dict)  # alias -> id
    stocks_legacy: dict[str, dict] = field(default_factory=dict)  # stocks with their own sheets (BMRI)
    drive_folder: str = ""                                # Google Drive folder that holds the data store

    def set_spreadsheet(self, alias: str, sid: str) -> None:
        """Point an alias at a spreadsheet, e.g. right after the app created it."""
        self.spreadsheets[alias] = sid
        for ds in self.datasets.values():
            if ds.alias == alias:
                ds.spreadsheet = sid

    @property
    def sheet_url(self) -> str:
        return f"https://docs.google.com/spreadsheets/d/{self.spreadsheet_id}/edit"

    @staticmethod
    def url_of(spreadsheet_id: str) -> str:
        return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"


def _parse_key(value: Any) -> tuple[int, ...]:
    if isinstance(value, list):
        return tuple(int(v) for v in value)
    return (int(value),)


DERIVED_OPS = ("diff", "iso_date", "lookup", "pct_change")


def _letter(x) -> int:
    return col_to_index(str(x).strip().upper()) if not str(x).isdigit() else int(x)


def _parse_derived(ds_id: str, d: dict) -> dict:
    op = d.get("op")
    if op not in DERIVED_OPS:
        raise ValueError(f"{ds_id}: derived op must be one of {DERIVED_OPS}")
    out = {"col": _letter(d["col"]), "op": op, "args": [_letter(a) for a in d.get("args", [])], "round": d.get("round")}
    if op == "lookup":
        out.update(dataset=str(d["dataset"]), key=_letter(d.get("key", "A")), value=_letter(d["value"]))
    return out


def load_config(path: Path = CONFIG_PATH, local_path: Path = LOCAL_SPREADSHEETS_PATH) -> AppConfig:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    sheets = {k: str(v or "") for k, v in (raw.get("spreadsheets") or {}).items()}
    if local_path.exists():
        import json
        for k, v in json.loads(local_path.read_text(encoding="utf-8") or "{}").items():
            if not sheets.get(k):
                sheets[k] = str(v)
    cfg = AppConfig(spreadsheet_id=str(raw["spreadsheet_id"]), spreadsheets=sheets,
                    stocks_legacy={str(k).upper(): dict(v or {}) for k, v in (raw.get("stocks_legacy") or {}).items()},
                    drive_folder=str((raw.get("store") or {}).get("drive_folder") or ""))
    for ds_id, d in (raw.get("datasets") or {}).items():
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", ds_id):
            raise ValueError(f"Dataset id '{ds_id}' may only use letters, digits, _ and -")
        write = d.get("write", "none")
        if write not in WRITE_MODES:
            raise ValueError(f"{ds_id}: write must be one of {WRITE_MODES}")
        columns = tuple(str(c) for c in (d.get("columns") or []))
        # A dataset born in the store has no Sheet range: describe its columns instead.
        rng = SheetRange.parse(d["range"]) if d.get("range") else (
            SheetRange(tab=ds_id, first_col=0, last_col=len(columns) - 1, first_row=2, last_row=None) if columns else None)
        if write == "append" and rng and rng.last_row is not None:
            raise ValueError(
                f"{ds_id}: write: append needs an open-ended range (e.g. PMI!A2:G), "
                "otherwise new rows would fall outside it"
            )
        file = (ROOT / d["file"]) if d.get("file") else None
        freq = d.get("frequency", "static" if file else "snapshot")
        if freq not in FREQUENCIES:
            raise ValueError(f"{ds_id}: frequency must be one of {FREQUENCIES}")
        if not rng and not file:
            raise ValueError(f"{ds_id}: give range, columns or file")
        source = str(d.get("source", "store"))
        if source not in ("store", "sheet"):
            raise ValueError(f"{ds_id}: source must be store or sheet")
        derived = tuple(_parse_derived(ds_id, x) for x in (d.get("derived") or []))
        cfg.datasets[ds_id] = Dataset(
            id=ds_id,
            title=d.get("title", ds_id),
            description=d.get("description", ""),
            range=rng,
            file=file,
            write=write,
            key=_parse_key(d.get("key", 0)),
            updater=d.get("updater"),
            # "spreadsheet:" may be an alias from the spreadsheets: list or a raw id
            spreadsheet=cfg.spreadsheets.get(str(d.get("spreadsheet", "")), str(d.get("spreadsheet") or cfg.spreadsheet_id)),
            alias=str(d.get("spreadsheet", "")) if str(d.get("spreadsheet", "")) in cfg.spreadsheets else "",
            source=source,
            derived=derived,
            columns=columns,
            group=str(d.get("group", "macro")),
            frequency=freq,
            lag_days=int(d.get("lag_days", 0)),
            stale_after_days=d.get("stale_after_days"),
            value_col=int(d.get("value_col", 1)),
            period_col=d.get("period_col"),
            release=d.get("release", ""),
            release_url=d.get("release_url", ""),
            note=d.get("note", ""),
        )
    return cfg
