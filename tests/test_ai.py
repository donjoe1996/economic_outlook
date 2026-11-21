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


@pytest.mark.skipif(os.name == "nt", reason="uses a POSIX script as the fake claude")
def test_chat_runs_in_the_data_folder_and_resumes_the_conversation(tmp_path, monkeypatch):
    store = tmp_path / "store"
    store.mkdir()
    (store / "datapackage.json").write_text("{}")
    log = tmp_path / "calls.jsonl"
    script = tmp_path / "claude"
    script.write_text(f"""#!{sys.executable}
import json, os, sys
prompt = sys.stdin.read()
with open({str(log)!r}, "a") as f:
    f.write(json.dumps({{"argv": sys.argv[1:], "cwd": os.getcwd(), "prompt": prompt}}) + "\\n")
print(json.dumps({{"type": "assistant", "message": {{"content": [{{"type": "tool_use", "name": "Read", "input": {{"file_path": os.getcwd() + "/pmi.json"}}}}]}}}}))
print(json.dumps({{"type": "result", "subtype": "success", "is_error": False, "result": "PMI **53,0** (Sep'26).", "session_id": "abc-123"}}))
""")
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("CLAUDE_BIN", str(script))
    from backend.jobs import Job
    job = Job(id="1", kind="chat", title="t")
    out = ai.chat("Bagaimana PMI?", None, progress=job, store_dir=store, facts="FAKTA X")
    assert out == {"answer": "PMI **53,0** (Sep'26).", "session_id": "abc-123"}
    assert any("pmi.json" in s["text"] for s in job.steps)
    ai.chat("Dan bulan lalu?", "abc-123", store_dir=store)
    first, second = [json.loads(l) for l in log.read_text().splitlines()]
    assert os.path.realpath(first["cwd"]) == os.path.realpath(store)          # only the data folder is readable
    assert "FAKTA X" in first["prompt"] and "--resume" not in first["argv"]
    assert second["argv"][second["argv"].index("--resume") + 1] == "abc-123" and second["prompt"] == "Dan bulan lalu?"
    deny = first["argv"][first["argv"].index("--disallowedTools") + 1]
    assert "WebFetch" in deny and "Bash" in deny                              # nothing can leave the computer
    with pytest.raises(ValueError):
        ai.chat("x", "abc; rm -rf /", store_dir=store)


def test_one_shot_runs_deny_local_files():
    assert {"Read", "Bash", "Glob", "Grep"} <= set(ai.NO_LOCAL)
