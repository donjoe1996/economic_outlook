"""Tests for the write path, against a fake in-memory Sheet (no Google needed).

Run:  python -m pytest -q
"""
import json
from datetime import date

import pytest

from backend.cache import Cache
from backend.config import AppConfig, Dataset, SheetRange, load_config
from backend.service import Service, UserError, parse_number
from backend.updaters import fred, periods


class FakeSheet:
    """A grid of strings keyed by (tab, row, col) with the two calls the app uses."""

    def __init__(self):
        self.cells = {}
        self.writes = []

    def set_rows(self, tab, first_row, rows):
        for i, row in enumerate(rows):
            for j, v in enumerate(row):
                self.cells[(tab, first_row + i, j)] = v

    def _read(self, a1):
        r = SheetRange.parse(a1)
        last = r.last_row or max([k[1] for k in self.cells if k[0] == r.tab] + [r.first_row])
        out = []
        for row in range(r.first_row, last + 1):
            vals = [self.cells.get((r.tab, row, c), "") for c in range(r.first_col, r.last_col + 1)]
            while vals and vals[-1] == "":
                vals.pop()
            out.append(vals)
        while out and not out[-1]:
            out.pop()
        return out

    def batch_get(self, spreadsheet_id, ranges):
        return [self._read(a1) for a1 in ranges]

    def write_cells(self, spreadsheet_id, cells):
        self.writes.append(dict(cells))
        for a1, v in cells.items():
            tab, ref = a1.rsplit("!", 1)
            tab = tab.strip("'")
            col = "".join(ch for ch in ref if ch.isalpha())
            row = int("".join(ch for ch in ref if ch.isdigit()))
            self.cells[(tab, row, ord(col) - 65)] = v


@pytest.fixture
def setup(tmp_path):
    sheet = FakeSheet()
    sheet.set_rows("PMI", 1, [["Periode", "PMI", "Unit"], ["Agu'26", "49.8", "indeks"], ["Sep'26", "52.4", "indeks"]])
    sheet.set_rows("Arus", 1, [["Periode", "SBN", "Unit", "Catatan", "Saham (rumus)"],
                               ["Okt'25", "", "Rp T", "BELUM DIISI", "12.96"],
                               ["Nov'25", "", "Rp T", "BELUM DIISI", "12.2"],
                               ["Des'25", "", "Rp T", "BELUM DIISI", "12.24"]])
    cfg = AppConfig(spreadsheet_id="x", datasets={
        "pmi": Dataset("pmi", "PMI", range=SheetRange.parse("PMI!A2:C"), write="append"),
        "rot": Dataset("rot", "Rotasi", range=SheetRange.parse("Arus!A2:E4"), write="fill"),
        "ro": Dataset("ro", "Read only", range=SheetRange.parse("PMI!A2:C"), write="none"),
    })
    svc = Service(cfg, Cache(tmp_path), sheet)
    svc.refresh()
    return svc, sheet


def test_append_new_period_goes_below_last_row(setup):
    svc, sheet = setup
    r = svc.upsert("pmi", ["Okt'26", "51.1", "indeks"])
    assert r == {"action": "append", "sheet_row": 4, "cells_written": 3}
    assert svc.cache.get("pmi")["values"][-1] == ["Okt'26", "51.1", "indeks"]


def test_existing_period_updates_only_changed_cells(setup):
    svc, sheet = setup
    r = svc.upsert("pmi", ["sep'26 ", "52.5", ""])  # key match ignores case/spaces
    assert r["action"] == "update" and r["cells_written"] == 1
    assert sheet.writes[-1] == {"'PMI'!B3": "52.5"}


def test_same_value_is_not_rewritten(setup):
    svc, sheet = setup
    assert svc.upsert("pmi", ["Sep'26", "52.40"])["action"] == "unchanged"
    assert sheet.writes == []


def test_fill_writes_blank_cell_and_keeps_formula_column(setup):
    svc, sheet = setup
    svc.upsert("rot", ["Nov'25", "3.5", "", "OJK", ""])
    written = sheet.writes[-1]
    assert written == {"'Arus'!B3": "3.5", "'Arus'!D3": "OJK"}  # column E (formula) untouched


def test_fill_refuses_unknown_period(setup):
    svc, _ = setup
    with pytest.raises(UserError, match="belum ada di tabel"):
        svc.upsert("rot", ["Jan'26", "1"])


def test_read_only_and_missing_key_and_bad_numbers(setup):
    svc, _ = setup
    with pytest.raises(UserError, match="hanya-baca"):
        svc.upsert("ro", ["Okt'26", "1"])
    with pytest.raises(UserError, match="kunci"):
        svc.upsert("pmi", ["", "1"])
    with pytest.raises(UserError, match="bukan angka"):
        svc.upsert("pmi", ["Okt'26", "naik"])
    with pytest.raises(UserError, match="titik untuk desimal"):
        svc.upsert("pmi", ["Okt'26", "51,2"])


def test_parse_number():
    assert parse_number("16,520.03") == 16520.03
    assert parse_number("-10.24") == -10.24
    assert parse_number("") is None


def test_append_requires_open_range(tmp_path):
    p = tmp_path / "d.yaml"
    p.write_text("spreadsheet_id: x\ndatasets:\n  a: {range: 'PMI!A2:G13', write: append}\n")
    with pytest.raises(ValueError, match="open-ended"):
        load_config(p)


def test_project_config_loads():
    cfg = load_config()
    assert "pmi" in cfg.datasets and cfg.datasets["geo"].kind == "file"
    assert cfg.datasets["valuasi"].key == (0, 4)


# ---------------------------------------------------------------- updaters
FEDU = "observation_date,DFEDTARU\n2026-08-31,3.75\n2026-09-17,4.00\n2026-09-30,4.00\n2026-10-31,4.00\n2026-11-20,4.00\n"
FEDL = "observation_date,DFEDTARL\n2026-08-31,3.50\n2026-09-30,3.75\n2026-10-31,3.75\n2026-11-20,3.75\n"


def test_fred_proposes_only_new_finished_months():
    cfg = load_config()
    ds = cfg.datasets["fed"]
    existing = [["Agu'26", "3.75"], ["Sep'26", "4"]]
    fetch = lambda url: FEDU if "DFEDTARU" in url else FEDL
    rows = fred.propose(ds, existing, fetch, today=date(2026, 11, 21))
    assert len(rows) == 1  # Okt'26 only; Nov'26 is not over yet
    row = rows[0]
    assert row[0] == "Okt'26" and row[1] == "4" and row[7] == "3.75" and row[8] == "3.875"
    assert row[5] == "Tinggi"


def test_period_labels_round_trip():
    assert periods.label("monthly", 2026, 5) == "Mei'26"
    assert periods.parse("monthly", "Okt'26 (sampai 29 Okt)") == (2026, 10)
    assert periods.parse("quarterly", "Q3'26") == (2026, 3)
