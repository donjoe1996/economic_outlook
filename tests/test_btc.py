"""Bitcoin: the API feeds (Coin Metrics, FRED/ECB M2) and the analysis.

No network: every HTTP call goes to a fake fetch that answers from recorded
shapes of the real APIs.
"""
import json
import urllib.error
import urllib.parse
from datetime import date, timedelta

import pytest

from backend import btc, compute
from backend.config import AppConfig, Dataset, SheetRange, load_config
from backend.service import Service
from backend.store import Store
from backend.updaters import coinmetrics, liquidity

from btc_fixture import make_store
from test_service import FakeSheet


def chain_ds(metrics=("PriceUSD", "CapMVRVCur", "HashRate")):
    specs = [{"metric": m, "sig": 6} for m in metrics]
    for s in specs:
        if s["metric"] == "HashRate":
            s["scale"] = 0.000001
    cols = ("Tanggal",) + tuple(metrics)
    return Dataset("btc_chain", "Chain", range=SheetRange(tab="btc_chain", first_col=0, last_col=len(cols) - 1, first_row=2, last_row=None),
                   columns=cols, updater={"type": "coinmetrics", "auto": True, "asset": "btc", "start": "2026-11-01", "overlap_days": 2,
                                          "metrics": specs})


class FakeCM:
    """Coin Metrics: one record per day from 2026-11-01, two pages, PaidMetric refused."""

    def __init__(self, last=date(2026, 11, 10), refuse=("PaidMetric",)):
        self.last, self.refuse, self.urls = last, set(refuse), []

    def __call__(self, url):
        self.urls.append(url)
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
        metrics = q["metrics"].split(",")
        if self.refuse & set(metrics):
            raise urllib.error.HTTPError(url, 403, "Forbidden: requested metric is not available with supplied credentials", {}, None)
        d0 = date.fromisoformat(q["start_time"])
        days = [d0 + timedelta(days=i) for i in range((self.last - d0).days + 1)]
        page = int(q.get("page", "0"))
        chunk = days[page * 5:(page + 1) * 5]
        data = [{"asset": "btc", "time": d.isoformat() + "T00:00:00.000000000Z",
                 **{m: str({"PriceUSD": 90000 + d.day, "CapMVRVCur": 1.5, "HashRate": 1.0e9}.get(m, 7)) for m in metrics}} for d in chunk]
        body = {"data": data}
        if (page + 1) * 5 < len(days):
            body["next_page_url"] = url.split("&page=")[0] + f"&page={page + 1}"
        return json.dumps(body)


def test_fmt_sig_never_writes_exponents():
    assert coinmetrics.fmt_sig(0.0858123, 6) == "0.0858123"
    assert coinmetrics.fmt_sig(0.00000947, 3) == "0.00000947"
    assert coinmetrics.fmt_sig(1834512345678.9, 7) == "1834512000000"
    assert coinmetrics.fmt_sig(86512.34, 6) == "86512.3"
    assert "e" not in coinmetrics.fmt_sig(1e-9, 6)


def test_coinmetrics_full_then_incremental_with_paging():
    ds, fetch = chain_ds(), FakeCM()
    header, rows, note = coinmetrics.pull(ds, None, fetch)
    assert header == ["Tanggal", "PriceUSD", "CapMVRVCur", "HashRate"]
    assert [r[0] for r in rows][:2] == ["2026-11-01", "2026-11-02"] and rows[-1][0] == "2026-11-10"
    assert rows[0][1:] == ["90001", "1.5", "1000"]          # TH/s -> EH/s
    assert len(fetch.urls) == 2                            # followed next_page_url
    # next pull asks only for the newest days (minus the overlap) and keeps the rest
    fetch2 = FakeCM(last=date(2026, 11, 12))
    _, rows2, _ = coinmetrics.pull(ds, {"values": rows}, fetch2)
    assert "start_time=2026-11-08" in fetch2.urls[0]
    assert len(rows2) == 12 and rows2[-1][0] == "2026-11-12"


def test_coinmetrics_paid_metric_is_skipped_not_fatal():
    ds = chain_ds(("PriceUSD", "PaidMetric"))
    header, rows, note = coinmetrics.pull(ds, None, FakeCM())
    assert rows[0][1] == "90001" and rows[0][2] == ""
    assert "PaidMetric" in note


def test_liquidity_keeps_china_and_adds_new_months():
    ds = Dataset("btc_m2", "M2", columns=("Tanggal", "US", "CN", "FXC", "EU", "FXE"),
                 range=SheetRange(tab="btc_m2", first_col=0, last_col=5, first_row=2, last_row=None),
                 updater={"type": "liquidity", "auto": True, "start": "2026-08"})
    existing = {"values": [["2026-08-01", "22000", "330000", "7.1", "16000", "1.16"]]}
    fred_csv = {
        "M2SL": "observation_date,M2SL\n2026-08-01,22100.5\n2026-09-01,22200\n",
        "EXCHUS": "observation_date,EXCHUS\n2026-08-01,7.12\n2026-09-01,7.10\n",
        "EXUSEU": "observation_date,EXUSEU\n2026-08-01,1.17\n2026-09-01,.\n",
    }
    ecb = "KEY,FREQ,TIME_PERIOD,OBS_VALUE\nBSI.M,M,2026-08,16100000\nBSI.M,M,2026-09,16200000\n"

    def fetch(url):
        if "ecb.europa.eu" in url:
            return ecb
        sid = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["id"][0]
        return fred_csv[sid]

    header, rows, note = liquidity.pull(ds, existing, fetch)
    assert rows[0] == ["2026-08-01", "22100.5", "330000", "7.12", "16100", "1.17"]   # China untouched, others revised
    assert rows[1] == ["2026-09-01", "22200", "", "7.1", "16200", ""]
    assert "M2 China belum diisi" in note and "2026-09" in note


def test_auto_update_seeds_from_sheet_then_merges(tmp_path, monkeypatch):
    sheet = FakeSheet()
    sheet.set_rows("Untitled", 2, [["2026-08-01", "22000", "330000", "7.1", "16000", "1.16"]])
    ds = Dataset("btc_m2", "M2", columns=("Tanggal", "US", "CN", "FXC", "EU", "FXE"), write="append",
                 range=SheetRange(tab="btc_m2", first_col=0, last_col=5, first_row=2, last_row=None),
                 updater={"type": "liquidity", "auto": True, "start": "2026-08"},
                 seed={"spreadsheet": "s1", "range": "Untitled!A2:F"})
    svc = Service(AppConfig(spreadsheet_id="x", datasets={"btc_m2": ds}), Store(tmp_path), sheet)

    def fetch(url):
        if "ecb" in url:
            return "TIME_PERIOD,OBS_VALUE\n2026-09,16200000\n"
        sid = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["id"][0]
        return {"M2SL": "d,v\n2026-09-01,22200\n", "EXCHUS": "d,v\n2026-09-01,7.1\n", "EXUSEU": "d,v\n2026-09-01,1.17\n"}[sid]

    out = svc.auto_update(fetch)
    assert out["rows"] == {"btc_m2": 2} and not out["failed"]
    doc = svc.store.typed("btc_m2")
    assert doc["rows"][0][2] == 330000 and doc["rows"][1][0] == "2026-09-01"
    assert doc["schema"]["fields"][0]["type"] == "date" and doc["source"] == "api"
    assert svc.store.status()["btc_m2"]["pull"]["ok"]

    def broken(url):
        raise ValueError("source changed its format")   # permanent: no retry waits
    out = svc.auto_update(broken)
    assert "btc_m2" in out["failed"]
    assert len(svc.store.typed("btc_m2")["rows"]) == 2     # old copy kept


@pytest.fixture(scope="module")
def analysis(tmp_path_factory):
    st = make_store(Store(tmp_path_factory.mktemp("btc")), seed=23)
    return btc.analysis(st), st


def test_analysis_shape(analysis):
    a, _ = analysis
    assert a["as_of"] == "2026-11-24" and a["price_src"] == "Google Finance"   # live sheet adds the newest days
    ids = [x["id"] for x in a["indicators"]]
    assert ids == ["trend", "mvrv", "exchange", "etf", "liquidity", "s2f", "hashrate", "puell", "activity", "spx"]
    for x in a["indicators"]:
        assert x["state"] in x["order"]
        assert x["call"] in ("naik", "turun")
        assert x["groups"]["Semua hari"]["days"] > 0
    assert a["verdict"]["status"] in ("ok", "warn", "bad")
    assert len(a["w"]) == len(a["wp"]) == len(a["wdd"])
    c = a["char"]["all"]
    assert sum(c["hist"]["cnt"]) + c["hist"]["clipped"] == c["days"] - 1
    json.dumps(a)                                     # the page receives it as JSON


def test_walk_forward_does_not_peek():
    """Up for two years, then down for two: a rule that learns only from outcomes
    known at the time keeps saying 'up' into the fall and must be mostly wrong there."""
    n = 1460
    p = [100 * (1.003 ** i if i < 730 else 1.003 ** 730 * 0.997 ** (i - 730)) for i in range(n)]
    f3, f12 = btc.fwd(p, btc.H3), btc.fwd(p, btc.H12)
    state = ["A"] * n
    ev = btc.evaluate({"t": None}, state, ["A"], {"A"}, f3, f12)
    assert ev["t3"]["learned"] < 0.75          # peeking would score ~1.0


def test_snapshot_serves_the_analysis_not_the_raw_tables(tmp_path):
    cfg = load_config()
    st = make_store(Store(tmp_path), seed=23)
    compute._CACHE.clear()
    snap = Service(cfg, st, None).snapshot("macro")
    assert snap["btc_analysis"]["status"] == "ok"
    assert snap["btc_analysis"]["answer"]["indicators"]
    assert "btc_chain" not in snap
    meta = {d["id"]: d for d in Service(cfg, st, None).metadata()["datasets"]}
    assert meta["btc_analysis"]["status"] == "static"
    assert meta["btc_chain"]["status"] in ("ok", "stale")


def test_claude_sees_the_same_numbers(tmp_path):
    """The fact sheet and the chat block print from the analysis the page draws."""
    from backend import chat_context

    st = make_store(Store(tmp_path), seed=23)
    compute._CACHE.clear()
    a = compute.run("btc", st)
    facts = "\n".join(btc.facts_lines(a))
    assert "Sinyal keputusan BTC" in facts and a["verdict"]["statusText"] in facts
    for x in a["indicators"]:
        assert x["name"] in facts
    out = chat_context.build("Bagaimana MVRV bitcoin sekarang?", load_config(), st, facts=facts)
    assert "Bitcoin rinci" in out["used"] and "(sekarang)" in out["prompt"]
    assert "Bitcoin rinci" not in chat_context.build("Bagaimana BI Rate?", load_config(), st, facts=facts)["used"]
