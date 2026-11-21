"""Tests for the write path, against a fake in-memory Sheet (no Google needed).

Run:  python -m pytest -q
"""
import json
from datetime import date

import pytest

from backend.store import Store
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
    """A store as after migration: manual datasets in JSON, one Sheet feed."""
    sheet = FakeSheet()
    sheet.set_rows("Feed", 1, [["Periode", "Harga"], ["Agu'26", "100"], ["Sep'26", "101"]])
    cfg = AppConfig(spreadsheet_id="x", datasets={
        "pmi": Dataset("pmi", "PMI", range=SheetRange.parse("PMI!A2:C"), write="append"),
        "flow": Dataset("flow", "Arus saham", range=SheetRange.parse("Arus!A17:B19"), write="fill"),
        # rot column E = the stock flow of the same month (was a Sheet formula)
        "rot": Dataset("rot", "Rotasi", range=SheetRange.parse("Arus!A2:E4"), write="fill",
                       derived=({"col": 4, "op": "lookup", "args": [0], "dataset": "flow", "key": 0, "value": 1, "round": None},)),
        "ro": Dataset("ro", "Feed harga", range=SheetRange.parse("Feed!A2:B"), write="none", source="sheet"),
    })
    store = Store(tmp_path)
    store.put("pmi", header=["Periode", "PMI", "Unit"], values=[["Agu'26", "49.8", "indeks"], ["Sep'26", "52.4", "indeks"]], source="migration")
    store.put("flow", header=["Periode", "Saham"], values=[["Okt'25", "12.96"], ["Nov'25", "12.2"], ["Des'25", "12.24"]], source="migration")
    store.put("rot", header=["Periode", "SBN", "Unit", "Catatan", "Saham"],
              values=[["Okt'25", "", "Rp T", "BELUM DIISI", "12.96"], ["Nov'25", "", "Rp T", "BELUM DIISI", "12.2"],
                      ["Des'25", "", "Rp T", "BELUM DIISI", "12.24"]], source="migration")
    svc = Service(cfg, store, sheet)
    svc.refresh()
    return svc, sheet


def test_append_new_period_goes_below_last_row(setup):
    svc, sheet = setup
    r = svc.upsert("pmi", ["Okt'26", "51.1", "indeks"])
    assert r == {"action": "append", "sheet_row": 3, "cells_written": 3}
    assert svc.store.get("pmi")["values"][-1] == ["Okt'26", "51.1", "indeks"]
    assert svc.store.typed("pmi")["rows"][-1] == ["Okt'26", 51.1, "indeks"]   # stored as a number
    assert sheet.writes == []                                                  # Sheets never written


def test_existing_period_updates_only_changed_cells(setup):
    svc, _ = setup
    r = svc.upsert("pmi", ["sep'26 ", "52.5", ""])  # key match ignores case/spaces; blank = keep
    assert r["action"] == "update" and r["cells_written"] == 1
    assert svc.store.get("pmi")["values"][1] == ["Sep'26", "52.5", "indeks"]


def test_same_value_is_not_rewritten(setup):
    svc, _ = setup
    before = svc.store.path("pmi.json").read_bytes()
    assert svc.upsert("pmi", ["Sep'26", "52.40"])["action"] == "unchanged"
    assert svc.store.path("pmi.json").read_bytes() == before


def test_fill_updates_row_and_derived_column_follows_its_source(setup):
    svc, _ = setup
    svc.upsert("rot", ["Nov'25", "3.5", "", "OJK", "999"])     # the 999 for the derived column is ignored
    assert svc.store.get("rot")["values"][1] == ["Nov'25", "3.5", "Rp T", "OJK", "12.2"]
    svc.upsert("flow", ["Nov'25", "13"])                       # source changes -> derived column follows
    assert svc.store.get("rot")["values"][1][4] == "13"


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


def test_feed_is_pulled_from_the_sheet_into_the_store(setup):
    svc, _ = setup
    assert svc.store.typed("ro")["rows"] == [["Agu'26", 100], ["Sep'26", 101]]
    assert svc.snapshot(None, ["ro"])["ro"]["answer"]["values"] == [["Agu'26", 100], ["Sep'26", 101]]


def test_save_table_checks_keys_and_types_and_drops_blank_rows(setup):
    svc, _ = setup
    out = svc.save_table("pmi", [["Jul'26", "48", "indeks"], ["Agu'26", "49.8", "indeks"], ["", "", ""]])
    assert out == {"rows": 2, "before": 2}
    assert [r[0] for r in svc.store.get("pmi")["values"]] == ["Jul'26", "Agu'26"]   # Sep'26 deleted
    with pytest.raises(UserError, match="dua kali"):
        svc.save_table("pmi", [["Jul'26", "48"], ["jul'26", "49"]])
    with pytest.raises(UserError, match="Baris 1: .*bukan angka"):
        svc.save_table("pmi", [["Jul'26", "tinggi"]])
    with pytest.raises(UserError, match="hanya-baca"):
        svc.save_table("ro", [["Okt'26", "1"]])


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
    assert "pmi" in cfg.datasets and cfg.datasets["provinces"].kind == "file" and cfg.datasets["world"].file.exists()
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


# ---------------------------------------------------------------- progress
def test_refresh_reports_batches(tmp_path):
    sheet = FakeSheet()
    cfg = AppConfig(spreadsheet_id="x", datasets={
        k: Dataset(k, t, range=SheetRange.parse(f"{k}!A2:B"), source="sheet")
        for k, t in (("a", "PMI"), ("b", "Rotasi"), ("c", "Read only"))})
    svc = Service(cfg, Store(tmp_path), sheet)
    from backend.jobs import Job
    job = Job(id="1", kind="refresh", title="t")
    svc.refresh(progress=job, batch=2)
    assert (job.done, job.total) == (3, 3)
    assert [s["text"].split(": ")[1] for s in job.steps] == ["PMI, Rotasi", "Read only"]


def test_job_runner_success_error_and_single_flight():
    import time
    from backend.jobs import JobRunner

    runner = JobRunner()

    def slow(p):
        p.step("langkah 1")
        time.sleep(0.2)
        return 42

    a = runner.start("refresh", "A", slow)
    b = runner.start("refresh", "B", slow)  # same kind while running -> same job
    assert a is b
    bad = runner.start("write", "C", lambda p: (_ for _ in ()).throw(UserError("salah isi")))
    for _ in range(50):
        if a.state != "running" and bad.state != "running":
            break
        time.sleep(0.05)
    assert a.view()["result"] == 42 and a.view()["steps"][-1]["text"] == "Selesai"
    assert bad.state == "error" and bad.error == "salah isi"


class TwoBookSheet(FakeSheet):
    """Two spreadsheets: records which spreadsheet each read and write went to."""

    def __init__(self):
        super().__init__()
        self.calls = []

    def batch_get(self, spreadsheet_id, ranges):
        self.calls.append((spreadsheet_id, tuple(ranges)))
        return super().batch_get(spreadsheet_id, ranges)

    def write_cells(self, spreadsheet_id, cells):
        self.calls.append((spreadsheet_id, "write"))
        return super().write_cells(spreadsheet_id, cells)


@pytest.fixture
def two_books(tmp_path):
    sheet = TwoBookSheet()
    sheet.set_rows("PMI", 1, [["Periode", "PMI"], ["Sep'26", "52.4"]])
    sheet.set_rows("Dividen", 1, [["Tanggal", "FY", "Jenis", "DPS"], ["2026-05-11", "2025", "final", "376.96"]])
    cfg = AppConfig(spreadsheet_id="main", datasets={
        "pmi": Dataset("pmi", "PMI", range=SheetRange.parse("PMI!A2:B"), spreadsheet="main", source="sheet"),
        "dv": Dataset("dv", "Dividen", range=SheetRange.parse("Dividen!A2:D"),
                      key=(0, 2), value_col=3, spreadsheet="stockbook", group="stock", source="sheet"),
    })
    svc = Service(cfg, Store(tmp_path), sheet)
    svc.refresh()
    return svc, sheet


def test_refresh_reads_each_spreadsheet_separately(two_books):
    svc, sheet = two_books
    reads = [c for c in sheet.calls if c[1] != "write"]
    assert any(c[0] == "main" and "PMI" in c[1][0] for c in reads)
    assert any(c[0] == "stockbook" and "Dividen" in c[1][0] for c in reads)
    assert not any(c[0] == "main" and "Dividen" in r for c in reads for r in c[1])


def test_snapshot_filters_by_group_and_extra_ids(two_books):
    svc, _ = two_books
    assert set(svc.snapshot()) == {"pmi", "dv"}
    assert set(svc.snapshot("stock")) == {"dv"}
    assert set(svc.snapshot("stock", ["pmi"])) == {"dv", "pmi"}
    assert set(svc.snapshot("macro")) == {"pmi"}
    assert "stockbook" in svc.snapshot("stock")["dv"]["sheet_url"]
