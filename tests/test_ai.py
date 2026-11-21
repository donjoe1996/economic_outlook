"""The Claude buttons, against a fake client (no network, no key needed)."""
import json
import sys
from types import SimpleNamespace as NS

import pytest

from backend import ai
from backend.config import ROOT


def msg(text="", stop="end_turn", blocks=None):
    content = (blocks or []) + ([NS(type="text", text=text)] if text else [])
    return NS(content=content, stop_reason=stop, stop_details=None)


class FakeClient:
    def __init__(self, replies):
        self.replies = list(replies)
        self.requests = []
        self.beta = NS(messages=NS(create=self.create))

    def create(self, **kw):
        self.requests.append(kw)
        return self.replies.pop(0)


@pytest.fixture
def insights_mod(tmp_path, monkeypatch):
    sys.path.insert(0, str(ROOT / "scripts"))
    import insights
    monkeypatch.setattr(insights, "OUT_DIR", tmp_path)
    monkeypatch.setattr(insights, "digest_text", lambda: "PMI global 53.0 (Sep'26); BI Rate 5.75")
    return insights


def doc(body):
    return json.dumps({"data_as_of": "Sep'26", "data_gaps": [],
                       "insights": [{"layer": "dunia", "title": "Pabrik dunia menguat", "body": body, "evidence": ""}]})


def test_insights_are_checked_repaired_once_and_published(insights_mod, tmp_path, monkeypatch):
    fake = FakeClient([msg(doc("PMI global naik ke 54.2.")), msg(doc("PMI global 53,0 pada Sep'26."))])
    monkeypatch.setattr(ai, "client", lambda: fake)
    out = ai.generate_insights()
    assert out["insights"] == 1
    req = fake.requests[0]
    assert req["model"] == "claude-opus-5-5" and req["fallbacks"] == "default"
    assert req["output_config"]["format"]["schema"]["required"] == ["data_as_of", "insights", "data_gaps"]
    assert "54.2" in fake.requests[1]["messages"][-1]["content"]          # the repair names the bad number
    published = json.loads((tmp_path / "latest.json").read_text())
    assert published["generated_by"].startswith("tombol") and published["check"]["unmatched"] == 0


def test_insights_not_published_when_still_wrong(insights_mod, tmp_path, monkeypatch):
    monkeypatch.setattr(ai, "client", lambda: FakeClient([msg(doc("Naik ke 54.2.")), msg(doc("Tetap 54.2."))]))
    with pytest.raises(RuntimeError, match="tidak dipublikasikan"):
        ai.generate_insights()
    assert not (tmp_path / "latest.json").exists()


def test_refusal_is_reported(insights_mod, monkeypatch):
    monkeypatch.setattr(ai, "client", lambda: FakeClient([msg(stop="refusal")]))
    with pytest.raises(RuntimeError, match="menolak"):
        ai.generate_insights()


def test_research_resumes_paused_turns_then_extracts_rows(monkeypatch):
    rows = {"fund": [{"key": "roe", "value": 18.8, "period": "H1 2026", "source": "LK H1 2026, idx.co.id"},
                     {"key": "made_up", "value": 1, "period": "x", "source": "y"}],
            "history": [{"year": 2025, "bvps": 2201.5, "eps": 406.7, "dps": None, "source": "LT 2025"}],
            "dividends": [{"paid_on": "2026-04-15", "fiscal_year": 2025, "kind": "final", "per_share": 208.4, "source": "BEI"}],
            "not_found": ["nim"], "notes": ""}
    paused = msg(stop="pause_turn", blocks=[NS(type="server_tool_use")])
    fake = FakeClient([paused, msg("notes with sources"), msg(json.dumps(rows))])
    monkeypatch.setattr(ai, "client", lambda: fake)
    keys = [("roe", "ROE", "%"), ("nim", "NIM", "%")]
    out = ai.research_stock("BBRI", "BRI", "bank", keys, [], 0)
    assert len(fake.requests) == 3
    assert fake.requests[1]["messages"][-1]["role"] == "assistant"         # paused turn re-sent as is
    assert {t["type"] for t in fake.requests[0]["tools"]} == {"web_search_20260209", "web_fetch_20260209"}
    assert [f["key"] for f in out["proposal"]["fund"]] == ["roe"]          # keys not asked for are dropped
    r = ai.proposal_rows("BBRI", out["proposal"])
    assert r["saham_fund"] == [["BBRI", "roe", "", "18.8", "", "H1 2026; LK H1 2026, idx.co.id"]]
    assert r["saham_fh"] == [["BBRI", "2025-12-31", "2201.5", "406.7", "", "LT 2025"]]
    assert r["saham_dv"] == [["BBRI", "2026-04-15", "2025", "final", "208.4", "BEI"]]


def test_missing_key_gives_a_clear_message(insights_mod, monkeypatch):
    class NoKey(FakeClient):
        def create(self, **kw):
            raise TypeError("Could not resolve authentication method. Expected one of api_key, auth_token")
    monkeypatch.setattr(ai, "client", lambda: NoKey([]))
    with pytest.raises(ai.AIUnavailable, match="ant auth login"):
        ai.generate_insights()
