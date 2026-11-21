"""Adding a stock to the shared Saham sheet, against a fake Google Sheets.

Run:  python -m pytest -q
"""
import json

import pytest

from backend import stocks
from backend.store import Store
from backend.config import load_config
from backend.service import Service, UserError
from test_service import FakeSheet


class FakeGoogle(FakeSheet):
    """FakeSheet plus spreadsheets, tabs, and a GOOGLEFINANCE that answers on write."""

    def __init__(self, unknown=()):
        super().__init__()
        self.created = []
        self.tabs = {}
        self.unknown = set(unknown)

    def create_spreadsheet(self, title, tabs):
        sid = f"sheet{len(self.created) + 1}"
        self.created.append(title)
        self.tabs[sid] = list(tabs)
        return sid

    def tab_ids(self, sid):
        return {t: i for i, t in enumerate(self.tabs.get(sid, []))}

    def add_tabs(self, sid, titles):
        self.tabs.setdefault(sid, []).extend(titles)

    def write_cells(self, sid, cells):
        super().write_cells(sid, cells)
        for a1, v in cells.items():
            if str(v).startswith("=GOOGLEFINANCE"):
                code = v.split('"IDX:')[1].split('"')[0]
                tab = a1.rsplit("!", 1)[0].strip("'")
                if code in self.unknown:
                    self.set_rows(tab, 1, [["#N/A"]])
                else:
                    self.set_rows(tab, 1, [["Date", "Close"]] + [[f"1/{d}/2026 16:00:00", str(1000 + d)] for d in range(1, 29)])


@pytest.fixture
def env(tmp_path):
    store = Store(tmp_path / "store")
    # whole-market flow rows the first stock copies (as if BMRI's data was migrated)
    store.put("bmri_flow", header=[], source="migration", values=[
        ["2026-10-20", "2026-10-24", "stk_week", "-100", "", "", "", ""],
        ["2026-10-20", "2026-10-24", "mkt_week", "-6670", "all", "reported", "IDX", ""],
        ["2026-10-16", "2026-10-16", "event", "", "", "", "MSCI", "Konsultasi MSCI"],
    ])
    local = tmp_path / "spreadsheets.local.json"
    sheet = FakeGoogle(unknown={"ZZZZ"})

    def make():
        cfg = stocks.with_stock_datasets(load_config(local_path=local), store)
        return Service(cfg, store, sheet)

    return make, sheet, store, local


def add(env, *a, **k):
    make, sheet, store, local = env
    return stocks.add_stock(make(), *a, sleep=lambda s: None, local_path=local, **k)


def test_first_stock_puts_data_in_the_store_and_prices_in_one_feed_sheet(env):
    make, sheet, store, local = env
    out = add(env, "bbri", "Bank Rakyat Indonesia", "bank", ["BMRI", "BBCA"])
    sid = out["spreadsheet"]
    assert sheet.created == ["IEO Price Feed"] and json.loads(local.read_text())["saham"] == sid
    # the feed sheet holds only price tabs: the stock and its non-legacy peer (BMRI has its own data)
    assert sheet.tabs[sid] == ["Harga BBRI", "Harga BBCA"]
    assert out["warnings"] == []
    assert len(store.get("harga_bbri")["values"]) == 28
    assert store.typed("harga_bbri")["rows"][0] == ["2026-01-01", 1001]       # typed: ISO date, number
    # Daftar, Fundamental template and PASAR flows are in the store, not in a Sheet
    assert store.get("saham_daftar")["values"][0][:4] == ["BBRI", "Bank Rakyat Indonesia", "bank", "BMRI, BBCA"]
    assert store.get("saham_daftar")["header"][0] == "Kode"
    fund = store.get("saham_fund")["values"]
    keys_bbri = [r[1] for r in fund if r[0] == "BBRI"]
    assert "nim" in keys_bbri and "casa" in keys_bbri and "net_margin" not in keys_bbri
    assert "casa" not in [r[1] for r in fund if r[0] == "BBCA"]
    flow = store.get("saham_flow")["values"]
    assert [r[0] for r in flow] == ["PASAR", "PASAR"] and flow[0][3] == "mkt_week"
    assert not any("Fundamental" in a1 or "Daftar" in a1 for w in sheet.writes for a1 in w)
    svc = make()
    assert stocks.datasets_for(svc.cfg, store, "BBRI") == ["harga_bbri", "bmri_price", "bmri_fund", "harga_bbca"]
    listed = {s["code"]: s for s in stocks.summary(svc.cfg, store)}
    assert listed["BBRI"]["last"] == 1028 and listed["BBRI"]["fund_filled"] == 0 and listed["BMRI"]["legacy"]


def test_adding_again_is_safe_and_shares_tabs(env):
    make, sheet, store, local = env
    add(env, "BBRI", "BRI", "bank", ["BBCA"])
    n_fund = len(store.get("saham_fund")["values"])
    out = add(env, "BBRI", "Bank Rakyat Indonesia", "bank", ["BBCA"])   # repeat: renames only
    assert out["price_tabs"] == [] and out["template_rows"] == 0
    assert len(store.get("saham_fund")["values"]) == n_fund
    assert [r[1] for r in store.get("saham_daftar")["values"]] == ["Bank Rakyat Indonesia"]
    out = add(env, "ADRO", "Alamtri", "umum", ["BBCA", "PTBA"])          # BBCA's tab exists already
    assert out["price_tabs"] == ["Harga ADRO", "Harga PTBA"]
    assert sheet.created == ["IEO Price Feed"]
    assert len([r for r in store.get("saham_flow")["values"] if r[0] == "PASAR"]) == 2   # copied once
    assert "net_margin" in [r[1] for r in store.get("saham_fund")["values"] if r[0] == "ADRO"]


def test_unknown_ticker_warns_instead_of_waiting_forever(env):
    out = add(env, "ZZZZ", "", "umum", [])
    assert out["warnings"] and "#N/A" in out["warnings"][0]


def test_bad_codes_are_refused(env):
    with pytest.raises(UserError):
        add(env, "BR1", "", "bank", [])
    with pytest.raises(UserError):
        add(env, "BMRI", "", "bank", [])   # has its own page already


def test_upsert_many_saves_once_and_keeps_labels(env):
    make, sheet, store, local = env
    add(env, "BBRI", "BRI", "bank", [])
    svc = make()
    out = svc.upsert_many("saham_fund", [["BBRI", "roe", "", "18.8", "", "H1 2026"], ["BBRI", "nim", "", "7.6", "", ""],
                                         ["BBRI", "roe", "", "18.9", "", ""]])   # same key twice: last wins
    assert out["cells_written"] == 4
    rows = {r[1]: r for r in store.get("saham_fund")["values"] if r[0] == "BBRI"}
    assert rows["roe"][3] == "18.9" and rows["roe"][5] == "H1 2026"
    assert rows["roe"][2].startswith("Return on equity") and rows["roe"][4] == "%"   # labels untouched
