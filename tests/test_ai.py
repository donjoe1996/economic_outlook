"""The Claude buttons, driven through Claude Code (claude -p). Tests use a fake
runner or a fake `claude` script, so no login and no network are needed."""
import json
import os
import stat
import sys

import pytest

from backend import ai
from backend.config import ROOT


@pytest.fixture
def insights_mod(tmp_path, monkeypatch):
    sys.path.insert(0, str(ROOT / "scripts"))
    import insights
    monkeypatch.setattr(insights, "OUT_DIR", tmp_path)
    monkeypatch.setattr(insights, "digest_text", lambda: "PMI global 53.0 (Sep'26); BI Rate 5.75")
    return insights


def doc(body):
    return {"data_as_of": "Sep'26", "data_gaps": [],
            "insights": [{"layer": "dunia", "title": "Pabrik dunia menguat", "body": body, "evidence": ""}]}


class Runner:
    """Stands in for one claude -p run per call."""

    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = []

    def __call__(self, prompt, schema, tools):
        self.calls.append({"prompt": prompt, "schema": schema, "tools": tools})
        return self.outputs.pop(0)


def test_insights_are_checked_repaired_once_and_published(insights_mod, tmp_path):
    run = Runner([doc("PMI global naik ke 54.2."), doc("PMI global 53,0 pada Sep'26.")])
    out = ai.generate_insights(runner=run)
    assert out["insights"] == 1
    assert run.calls[0]["tools"] == () and "FAKTA" in run.calls[0]["prompt"]      # no tools for insights
    assert run.calls[0]["schema"]["required"] == ["data_as_of", "insights", "data_gaps"]
    assert "54.2" in run.calls[1]["prompt"]                                       # the repair names the bad number
    published = json.loads((tmp_path / "latest.json").read_text())
    assert published["generated_by"] == "tombol di aplikasi (Claude Code)" and published["check"]["unmatched"] == 0


def test_insights_not_published_when_still_wrong(insights_mod, tmp_path):
    with pytest.raises(RuntimeError, match="tidak dipublikasikan"):
        ai.generate_insights(runner=Runner([doc("Naik ke 54.2."), doc("Tetap 54.2.")]))
    assert not (tmp_path / "latest.json").exists()


def test_research_allows_only_web_tools_and_keeps_asked_keys():
    rows = {"fund": [{"key": "roe", "value": 18.8, "period": "H1 2026", "source": "LK H1 2026, idx.co.id"},
                     {"key": "made_up", "value": 1, "period": "x", "source": "y"}],
            "history": [{"year": 2025, "bvps": 2201.5, "eps": 406.7, "dps": None, "source": "LT 2025"}],
            "dividends": [{"paid_on": "2026-04-15", "fiscal_year": 2025, "kind": "final", "per_share": 208.4, "source": "BEI"}],
            "not_found": ["nim"], "notes": "sumber: LK H1 2026"}
    run = Runner([rows])
    out = ai.research_stock("BBRI", "BRI", "bank", [("roe", "ROE", "%"), ("nim", "NIM", "%")], [], 0, runner=run)
    assert run.calls[0]["tools"] == ("WebSearch", "WebFetch")
    assert [f["key"] for f in out["proposal"]["fund"]] == ["roe"]                 # keys not asked for are dropped
    assert out["notes"] == "sumber: LK H1 2026"
    r = ai.proposal_rows("BBRI", out["proposal"])
    assert r["saham_fund"] == [["BBRI", "roe", "", "18.8", "", "H1 2026; LK H1 2026, idx.co.id"]]
    assert r["saham_fh"] == [["BBRI", "2025-12-31", "2201.5", "406.7", "", "LT 2025"]]
    assert r["saham_dv"] == [["BBRI", "2026-04-15", "2025", "final", "208.4", "BEI"]]


def _fake_claude(tmp_path, events):
    """An executable that prints stream-json events like `claude -p` does."""
    script = tmp_path / "claude"
    lines = "\n".join(json.dumps(e) for e in events)
    script.write_text(f"#!{sys.executable}\nimport sys\nsys.stdin.read()\nprint('''{lines}''')\n")
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    return str(script)


@pytest.mark.skipif(os.name == "nt", reason="uses a POSIX script as the fake claude")
def test_run_claude_streams_progress_and_returns_structured_output(tmp_path, monkeypatch):
    monkeypatch.setenv("CLAUDE_BIN", _fake_claude(tmp_path, [
        {"type": "system", "subtype": "init"},
        {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "WebSearch", "input": {"query": "BBRI laporan keuangan H1 2026"}}]}},
        {"type": "result", "subtype": "success", "is_error": False, "structured_output": {"greeting": "halo"}},
    ]))
    from backend.jobs import Job
    job = Job(id="1", kind="ai", title="t")
    out = ai.run_claude("hi", {"type": "object"}, tools=("WebSearch",), progress=job)
    assert out == {"greeting": "halo"}
    assert any("BBRI laporan keuangan" in s["text"] for s in job.steps)


@pytest.mark.skipif(os.name == "nt", reason="uses a POSIX script as the fake claude")
def test_not_logged_in_gives_a_clear_message(tmp_path, monkeypatch):
    monkeypatch.setenv("CLAUDE_BIN", _fake_claude(tmp_path, [
        {"type": "result", "subtype": "success", "is_error": True, "result": "Invalid API key · Please run /login"}]))
    with pytest.raises(ai.AIUnavailable, match="belum login"):
        ai.run_claude("hi", {"type": "object"})


def test_missing_claude_code_is_explained(monkeypatch):
    monkeypatch.setenv("CLAUDE_BIN", "/nonexistent/claude")
    monkeypatch.setattr(ai.shutil, "which", lambda name: None)
    monkeypatch.setattr(ai.Path, "home", lambda: ROOT / "no-home")
    monkeypatch.setattr(ai, "Path", type(ai.Path()))
    real_exists = ai.Path.exists
    monkeypatch.setattr(ai.Path, "exists", lambda self: False if "claude" in str(self) else real_exists(self))
    with pytest.raises(ai.AIUnavailable, match="tidak ditemukan"):
        ai.claude_bin()


@pytest.fixture
def chat_env(tmp_path):
    from backend.config import AppConfig, Dataset, SheetRange
    from backend.store import Store
    st = Store(tmp_path / "store")
    st.put("birate", header=["Periode", "BI Rate", "Unit", "Penerbit"], source="t",
           values=[["Jul'26", "5.5", "%", "BI"], ["Agu'26", "5.75", "%", "BI"], ["Sep'26", "5.75", "%", "BI"]])
    st.put("ikk", header=["Periode", "IKK"], source="t", values=[["Sep'26", "118.1"]])
    cfg = AppConfig("x", {
        "birate": Dataset("birate", "BI Rate bulanan", range=SheetRange.parse("'BI Rate'!A2:D")),
        "ikk": Dataset("ikk", "Indeks Keyakinan Konsumen", range=SheetRange.parse("IKK!A2:B")),
    })
    return cfg, st


def test_chat_sends_only_the_data_the_question_is_about(chat_env):
    cfg, st = chat_env
    seen = {}

    def runner(prompt):
        seen["prompt"] = prompt
        return "BI Rate naik ke 5,75% pada Agu'26 (BI Rate bulanan) dan sekarang 6,25%."
    out = ai.chat("Kenapa BI menaikkan suku bunga?", [{"q": "Halo", "a": "Hai"}], cfg=cfg, store=st,
                  facts="PMI global 53.0", runner=runner)
    assert out["used"] == ["Ringkasan fakta", "BI Rate bulanan"]           # "menaIKKan" does not pull in ikk
    assert "Sep'26 | 5.75" in seen["prompt"] and "118.1" not in seen["prompt"]
    assert "Pengguna: Halo" in seen["prompt"] and seen["prompt"].rstrip().endswith("Kenapa BI menaikkan suku bunga?")
    assert out["unverified"] == ["6,25"]                                   # 5,75 is in the data, 6,25 is not


@pytest.mark.skipif(os.name == "nt", reason="uses a POSIX script as the fake claude")
def test_chat_is_one_turn_without_tools(chat_env, tmp_path, monkeypatch):
    cfg, st = chat_env
    log = tmp_path / "call.json"
    script = tmp_path / "claude"
    script.write_text(f"""#!{sys.executable}
import json, os, sys
prompt = sys.stdin.read()
json.dump({{"argv": sys.argv[1:], "cwd": os.getcwd()}}, open({str(log)!r}, "w"))
print(json.dumps({{"type": "result", "subtype": "success", "is_error": False, "result": "BI Rate 5,75% (Sep'26)."}}))
""")
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("CLAUDE_BIN", str(script))
    out = ai.chat("BI rate sekarang?", None, cfg=cfg, store=st, facts="")
    assert out["answer"] == "BI Rate 5,75% (Sep'26)." and out["unverified"] == []
    call = json.loads(log.read_text())
    argv = call["argv"]
    assert argv[argv.index("--tools") + 1] == "" and "--system-prompt" in argv and "--model" in argv
    assert "--resume" not in argv and "--no-session-persistence" in argv
    assert os.path.realpath(call["cwd"]) != os.path.realpath(st.dir)      # an empty folder, not the data


def test_chat_refuses_empty_and_huge_questions(chat_env):
    cfg, st = chat_env
    with pytest.raises(ValueError):
        ai.chat("  ", cfg=cfg, store=st, facts="", runner=lambda p: "")
    with pytest.raises(ValueError):
        ai.chat("x" * 2001, cfg=cfg, store=st, facts="", runner=lambda p: "")


def test_one_shot_runs_deny_local_files():
    assert {"Read", "Bash", "Glob", "Grep"} <= set(ai.NO_LOCAL)


def test_chat_follow_up_keeps_the_stock_and_reads_suffixes():
    from backend import chat_context
    from backend.config import load_config
    cfg = load_config()
    q = "Lalu bagaimana arus asingnya?"
    assert "flow" in chat_context.match_datasets(q, cfg, {"flow", "birate"})          # asingnya -> asing
    assert chat_context.match_datasets("Kenapa BI menaikkan suku bunga?", cfg, {"ikk", "birate"}) == ["birate"]


@pytest.mark.skipif(os.name == "nt", reason="uses a POSIX script as the fake claude")
def test_chat_uses_the_chosen_model_and_refuses_others(chat_env, tmp_path, monkeypatch):
    cfg, st = chat_env
    log = tmp_path / "argv.json"
    script = tmp_path / "claude"
    script.write_text(f"""#!{sys.executable}
import json, sys
sys.stdin.read()
json.dump(sys.argv[1:], open({str(log)!r}, "w"))
print(json.dumps({{"type": "result", "subtype": "success", "is_error": False, "result": "ok"}}))
""")
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("CLAUDE_BIN", str(script))
    out = ai.chat("BI rate?", None, cfg=cfg, store=st, facts="", model="Opus")
    argv = json.loads(log.read_text())
    assert argv[argv.index("--model") + 1] == "opus" and out["model"] == "opus"
    with pytest.raises(ValueError, match="tidak dikenal"):
        ai.chat("BI rate?", None, cfg=cfg, store=st, facts="", model="gpt-x")
