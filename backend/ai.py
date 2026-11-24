"""Claude, called from the app's buttons, through Claude Code on this computer.

The buttons run the `claude` command line in headless mode (claude -p), with
your own Claude Code login: no API key, nothing billed separately from your
Claude Code plan. The project folder is the working directory, so its
CLAUDE.md and skills apply.

1. Insights   Python builds the fact sheet (scripts/digest.py), Claude Code
              writes the insights as JSON that must match a schema, Python
              checks every number (scripts/insights.py); one repair round if
              a number is not in the facts; then it is published.
2. Stock data Claude Code researches with its WebSearch and WebFetch tools
              (no other tool is allowed) and returns rows that must match a
              schema. The rows come back to the page as a proposal; nothing
              is saved until you press Simpan (Service.upsert_many).

Claude Code's permission mode is "dontAsk": any tool not listed is refused,
so a button can never run commands or edit files.
"""
from __future__ import annotations

import atexit
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import date
from pathlib import Path

from .config import ROOT
from .jobs import NO_PROGRESS, Progress


class AIUnavailable(RuntimeError):
    """Claude Code is missing or not logged in. Shown to the user as-is."""


def claude_bin() -> str:
    """The claude executable: $CLAUDE_BIN, the PATH, or the usual install places."""
    cands = [os.environ.get("CLAUDE_BIN"), shutil.which("claude"),
             str(Path.home() / ".claude" / "local" / "claude"), str(Path.home() / ".local" / "bin" / "claude"),
             "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]
    for c in cands:
        if c and Path(c).exists():
            return c
    raise AIUnavailable(
        "Claude Code tidak ditemukan di komputer ini. Pasang Claude Code (perintah 'claude'), login sekali di "
        "terminal, lalu jalankan start.sh dari terminal yang sama. Atau setel CLAUDE_BIN ke lokasi 'claude'.")


def _describe_tool(block: dict) -> str | None:
    name, inp = block.get("name"), block.get("input") or {}
    if name == "Read":
        return f"Claude membaca {Path(str(inp.get('file_path', ''))).name}"
    if name == "WebSearch":
        return f"Claude Code mencari: {str(inp.get('query', ''))[:90]}"
    if name == "WebFetch":
        return f"Claude Code membaca: {str(inp.get('url', ''))[:90]}"
    return None


def _run(args: list[str], prompt: str, cwd: Path, progress: Progress, timeout: int,
         show: tuple[str, ...] = ("Read", "WebSearch", "WebFetch")) -> dict:
    """Start `claude -p` with args, feed the prompt, report tool use as progress
    steps, and return the final result event."""
    cmd = [claude_bin(), "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "dontAsk"] + args
    try:
        proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8", errors="replace")
    except OSError as exc:
        raise AIUnavailable(f"Claude Code tidak bisa dijalankan: {exc}") from None
    timer = threading.Timer(timeout, proc.kill)
    timer.start()
    result, last_text = None, ""
    try:
        proc.stdin.write(prompt)
        proc.stdin.close()
        for line in proc.stdout:
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if ev.get("type") == "assistant":
                for block in (ev.get("message") or {}).get("content", []):
                    # only tools the run may use: a refused attempt is not progress
                    if block.get("type") == "tool_use" and block.get("name") in show and (step := _describe_tool(block)):
                        progress.step(step)
                    elif block.get("type") == "text" and block.get("text"):
                        last_text = block["text"]
            elif ev.get("type") == "result":
                result = ev
        proc.wait()
    finally:
        timer.cancel()
    err = (proc.stderr.read() or "").strip() if proc.stderr else ""
    if result is None:
        if proc.returncode and proc.returncode < 0:
            raise RuntimeError(f"Claude Code dihentikan setelah {timeout // 60} menit.")
        raise RuntimeError("Claude Code berhenti tanpa hasil. " + (err or last_text)[:300])
    if result.get("is_error") or result.get("subtype") != "success":
        msg = str(result.get("result") or result.get("subtype") or err)
        if any(w in msg.lower() for w in ("login", "api key", "authenticat", "/login")):
            raise AIUnavailable("Claude Code belum login di komputer ini. Jalankan 'claude' sekali di terminal, login, "
                                "lalu coba lagi. (" + msg[:160] + ")")
        raise RuntimeError("Claude Code gagal: " + msg[:300])
    return result


# Tools a one-shot run may never use: it works only from what the prompt gives
# it (and, for research, the web). Running in an empty folder adds a second wall,
# so web content can never steer it into reading files on this computer.
NO_LOCAL = ("Read", "Glob", "Grep", "Bash", "Write", "Edit", "NotebookEdit", "Task", "Agent")


def run_claude(prompt: str, schema: dict, tools: tuple[str, ...] = (), progress: Progress = NO_PROGRESS,
               timeout: int = 600, runner=None) -> dict:
    """One headless Claude Code run in an empty folder; returns its structured
    output (validated against schema by Claude Code). runner replaces the
    subprocess in tests."""
    if runner is not None:
        return runner(prompt, schema, tools)
    args = ["--no-session-persistence", "--json-schema", json.dumps(schema), "--disallowedTools", " ".join(NO_LOCAL)]
    if tools:
        args += ["--allowedTools", " ".join(tools)]
    with tempfile.TemporaryDirectory(prefix="ieo-claude-") as empty:
        result = _run(args, prompt, Path(empty), progress, timeout, show=tools)
    out = result.get("structured_output")
    if not isinstance(out, dict):
        raise RuntimeError("Claude Code tidak mengembalikan JSON yang diminta.")
    return out


# =================================================================== insights
INSIGHT_SCHEMA = {
    "type": "object",
    "properties": {
        "data_as_of": {"type": "string"},
        "insights": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "layer": {"type": "string", "enum": ["dunia", "as", "indonesia", "uang", "pasar", "kredit", "btc", "bank"]},
                "title": {"type": "string"},
                "body": {"type": "string"},
                "evidence": {"type": "string"},
            },
            "required": ["layer", "title", "body", "evidence"],
            "additionalProperties": False,
        }},
        "data_gaps": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["data_as_of", "insights", "data_gaps"],
    "additionalProperties": False,
}



INSIGHT_RULES = """You write the "Insight dari Claude" panel of an Indonesian economic dashboard for one investor.
You get a fact sheet in which every number is already computed. Read it top-down, the way the dashboard is built:
world -> United States -> Indonesia -> money (rates, Rupiah, foreign flows) -> stock markets (IHSG vs Asia and global) -> bank credit -> Bitcoin -> what it means for bank stocks.
Bitcoin (layer "btc", at most one insight, only if the facts have a Bitcoin section): say whether any indicator beat "always up" in the honest test, and what the trend and drawdown are. A rule that did not beat "always up" is context, not a signal; never present it as a forecast.
Look for contrast (the world rises, Indonesia falls), a change of direction, tension (higher rates yet money still leaves), and data that is missing or overdue.

Write 6 to 8 insights in plain Indonesian, one idea each, and make the last one layer "bank".
- title: at most 8 words and states the finding.
- body: 1-2 sentences, at most 45 words.
- evidence: a correlation with r and n, or a note on source or limits; may be empty.
Use only numbers that appear in the fact sheet (rounding is fine); never compute new ones.
Correlation is not causation: write "sejalan" or "berlawanan", never "menyebabkan", and give n with every r.
Say how sure you are when the data is thin. No buy or sell advice.
data_as_of: the periods the facts cover, e.g. "Sep'26 (makro), Okt'26 (pasar)". data_gaps: important data that is missing and would change the reading.
Do not use any tool and do not read files: everything you need is below. Answer only with the structured output."""


def generate_insights(progress: Progress = NO_PROGRESS, runner=None) -> dict:
    sys.path.insert(0, str(ROOT / "scripts"))
    import insights as ins  # scripts/insights.py

    progress.step("Menghitung fakta dari data (scripts/digest.py)")
    facts = ins.digest_text()
    progress.step("Claude Code membaca fakta dan menulis insight")
    doc = run_claude(INSIGHT_RULES + "\n\nFAKTA:\n\n" + facts, INSIGHT_SCHEMA, progress=progress, timeout=420, runner=runner)
    res = ins.check(doc, facts)
    if res["unmatched"] or res["problems"]:
        # one repair round: Claude Code gets its draft and exactly which numbers are not in the facts
        progress.step(f"{len(res['unmatched'])} angka tidak ada di fakta; Claude Code memperbaikinya")
        doc = run_claude(INSIGHT_RULES + "\n\nFAKTA:\n\n" + facts + "\n\nDRAF SEBELUMNYA:\n" + json.dumps(doc, ensure_ascii=False)
                         + "\n\nPemeriksa angka menemukan masalah. Perbaiki hanya bagian ini, pakai angka yang ada di fakta "
                         "atau hapus angkanya, lalu tulis ulang JSON lengkap:\n" + "\n".join(res["unmatched"] + res["problems"]),
                         INSIGHT_SCHEMA, progress=progress, timeout=420, runner=runner)
        res = ins.check(doc, facts)
    if res["unmatched"] or res["problems"]:
        raise RuntimeError("Insight tidak dipublikasikan: masih ada angka yang tidak ditemukan di fakta ("
                           + "; ".join((res["unmatched"] + res["problems"])[:4]) + ").")
    ins.publish(doc, res, by="tombol di aplikasi (Claude Code)")
    progress.step(f"Dipublikasikan: {len(doc['insights'])} insight, {res['numbers']} angka cocok dengan fakta")
    return {"insights": len(doc["insights"]), "numbers": res["numbers"], "data_as_of": doc["data_as_of"]}


# ================================================================ stock data
NUM_OR_NULL = {"anyOf": [{"type": "number"}, {"type": "null"}]}
ROW_SCHEMA = {
    "type": "object",
    "properties": {
        "fund": {"type": "array", "items": {"type": "object", "properties": {
            "key": {"type": "string"}, "value": {"type": "number"},
            "period": {"type": "string"}, "source": {"type": "string"}},
            "required": ["key", "value", "period", "source"], "additionalProperties": False}},
        "history": {"type": "array", "items": {"type": "object", "properties": {
            "year": {"type": "integer"}, "bvps": NUM_OR_NULL, "eps": NUM_OR_NULL, "dps": NUM_OR_NULL, "source": {"type": "string"}},
            "required": ["year", "bvps", "eps", "dps", "source"], "additionalProperties": False}},
        "dividends": {"type": "array", "items": {"type": "object", "properties": {
            "paid_on": {"type": "string", "format": "date"}, "fiscal_year": {"type": "integer"},
            "kind": {"type": "string", "enum": ["interim", "final"]}, "per_share": {"type": "number"},
            "source": {"type": "string"}},
            "required": ["paid_on", "fiscal_year", "kind", "per_share", "source"], "additionalProperties": False}},
        "not_found": {"type": "array", "items": {"type": "string"}},
        "notes": {"type": "string"},
    },
    "required": ["fund", "history", "dividends", "not_found", "notes"],
    "additionalProperties": False,
}

RESEARCH_RULES = """You research one Indonesian listed company's financial figures for an investor's valuation sheet.
Trust sources in this order:
1. the issuer's own filings: audited financial statements and annual reports on idx.co.id or the company's investor-relations site;
2. regulators and market infrastructure: OJK, Bursa Efek Indonesia (IDX/BEI), KSEI;
3. established financial press (Kontan, Bisnis Indonesia, CNBC Indonesia, Katadata) only to locate a figure, or when no primary source publishes it.
Never use Wikipedia, personal blogs, stock-tip sites, forums, aggregators (stockanalysis, investing.com, marketscreener and the like) or AI-written pages. If two sources disagree, prefer the filing and mention the other.
Never guess: a figure you cannot find stays missing. You may derive a figure from reported ones (for example last-12-month profit = 9M this year + full prior year - 9M prior year; ROE = annualised profit / average equity); then start the period field with "derived:" and give the formula.

Priority: the valuation cannot run without net_profit_ttm, equity_parent and shares_out, so find those first, then roe and the dividend figures, then the sector ratios, then history.
For these, open the issuer's latest financial statements (the quarterly report on idx.co.id or the investor-relations site, often a PDF) rather than stopping at news articles. Do not give up on them after one search.

Units: Rp T means trillions of rupiah, miliar means billions of shares, % as a number (18.8, not 0.188), Rp per share.
Profit and equity are attributable to owners of the parent. Restate per-share figures for stock splits so older years match today's share count, and say so.
fy_last is the last full year with an annual report; dps_fyYYYY and payout_fyYYYY refer to that year and the ones before it.
For profit_growth, the period goes first in the note, e.g. "H1 2026; Laporan keuangan H1 2026 (idx.co.id)".

Work efficiently: prefer the latest financial statements and the latest annual report, which hold most figures at once.
Every figure needs its source: the publisher plus the URL, in the source field."""


def research_stock(code: str, name: str, sector: str, keys: list[tuple[str, str, str]],
                   have_history: list[str], have_dividends: int, progress: Progress = NO_PROGRESS,
                   runner=None) -> dict:
    """Claude Code finds a stock's figures on the web. Returns proposed rows."""
    today = date.today().isoformat()
    want = "\n".join(f"- {k} [{u}]: {d}" for k, d, u in keys)
    task = (f"Company: {code} ({name}), sector {'bank' if sector == 'bank' else 'non-bank'}. Today is {today}.\n\n"
            f"Fundamental keys to find (latest report):\n{want}\n\n"
            f"Year-end history 2016 onwards (book value, EPS, DPS per share). Years already in the sheet: {', '.join(have_history) or 'none'}.\n"
            f"Every dividend payment since 2016 (date paid, fiscal year, interim or final, per share). Payments already in the sheet: {have_dividends}.\n\n"
            "Use WebSearch and WebFetch. Return the figures in the structured output: fund (only the keys listed above), "
            "history, dividends, not_found (requested keys with no sourced figure) and notes (a short summary of your sources).")
    progress.step(f"Claude Code mencari angka {code} di laporan keuangan, BEI dan OJK")
    data = run_claude(RESEARCH_RULES + "\n\n" + task, ROW_SCHEMA, tools=("WebSearch", "WebFetch"),
                      progress=progress, timeout=1200, runner=runner)
    allowed = {k for k, _, _ in keys}
    data["fund"] = [f for f in data.get("fund", []) if f.get("key") in allowed]
    return {"code": code, "proposal": data, "notes": data.get("notes", "")}


def proposal_rows(code: str, proposal: dict) -> dict[str, list[list[str]]]:
    """The proposal as rows for saham_fund / saham_fh / saham_dv (Kode first)."""
    def n(x):
        return "" if x is None else (str(int(x)) if float(x).is_integer() else repr(float(x)))

    fund = [[code, f["key"], "", n(f["value"]), "", f"{f['period']}; {f['source']}".strip("; ")] for f in proposal.get("fund", [])]
    fh = [[code, f"{h['year']}-12-31", n(h["bvps"]), n(h["eps"]), n(h["dps"]), h["source"]] for h in proposal.get("history", [])]
    dv = [[code, d["paid_on"], str(d["fiscal_year"]), d["kind"], n(d["per_share"]), d["source"]] for d in proposal.get("dividends", [])]
    return {"saham_fund": fund, "saham_fh": fh, "saham_dv": dv}


# ======================================================================= chat
CHAT_RULES = """Anda analis di dalam dashboard ekonomi Indonesia, berbicara dengan satu pengguna: investor yang ingin memahami, bukan diberi tahu apa yang harus dibeli.
Jawab dalam bahasa Indonesia, singkat: maksimal 120 kata kecuali pengguna minta detail. Mulai dari gambaran besar, lalu ke jawabannya; tunjukkan alasannya supaya pengguna belajar membaca datanya sendiri.
Pakai HANYA angka yang ada di FAKTA dan DATA TERKAIT di bawah. Jangan menghitung angka baru dan jangan memakai pengetahuan umum untuk angka. Setiap angka disertai dataset dan periodenya.
Bila data yang dibutuhkan tidak ada atau sudah lama, katakan terus terang.
Korelasi bukan sebab-akibat. Tidak ada rekomendasi beli atau jual. Paragraf pendek dan daftar berpoin; tanpa tabel."""

# The chat's model, chosen per question on the page. Claude Code resolves the
# alias to the latest model of that family. Haiku is the default: fast and cheap;
# Sonnet and Opus reason more carefully and take longer. IEO_CHAT_MODEL sets the default.
CHAT_MODELS = ("haiku", "sonnet", "opus")
CHAT_MODEL = os.environ.get("IEO_CHAT_MODEL", "haiku") if os.environ.get("IEO_CHAT_MODEL", "haiku") in CHAT_MODELS else "haiku"


# ---------------------------------------------------------------- speed
# Starting Claude Code costs ~2-4 s before the model even sees the question.
# So one process per model is started ahead of time, waiting (streaming JSON
# input) with no tokens used, and replaced right after it is used. Thinking is
# capped for the chat: the data work is already done in Python.
# No thinking for the chat: the data work is done in Python, and thinking was
# up to 5 s before the first word. (Older Claude Code versions read only the
# token cap; unknown variables are ignored.)
CHAT_ENV = {"CLAUDE_CODE_DISABLE_THINKING": "1", "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING": "1", "MAX_THINKING_TOKENS": "0"}
WARM_MAX_AGE = 600          # seconds a waiting process is kept before it is replaced
_warm: dict[str, tuple] = {}   # model -> (process, started, folder, command)
_warm_lock = threading.Lock()


def _chat_cmd(model: str) -> list[str]:
    return [claude_bin(), "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
            "--include-partial-messages", "--no-session-persistence", "--permission-mode", "dontAsk",
            "--settings", '{"alwaysThinkingEnabled": false}',
            "--system-prompt", CHAT_RULES, "--tools", "", "--model", model]


def _spawn(model: str) -> tuple:
    cmd = _chat_cmd(model)
    cwd = tempfile.mkdtemp(prefix="ieo-chat-")          # empty: the chat has no tools anyway
    env = dict(os.environ, **CHAT_ENV)
    try:
        proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    except OSError:
        shutil.rmtree(cwd, ignore_errors=True)
        raise
    return proc, time.time(), cwd, cmd


def _usable(entry, model: str) -> bool:
    """Still running, not too old, and started with today's command (same
    claude, same rules)."""
    try:
        cmd = _chat_cmd(model)
    except AIUnavailable:
        return False
    return entry[0].poll() is None and time.time() - entry[1] < WARM_MAX_AGE and entry[3] == cmd


def _discard(entry) -> None:
    proc, _, cwd, _ = entry
    if proc.poll() is None:
        proc.kill()
        try:
            proc.wait(timeout=3)         # reap it: no zombies left behind
        except subprocess.TimeoutExpired:
            pass
    shutil.rmtree(cwd, ignore_errors=True)


def warm(model: str) -> bool:
    """Have a Claude Code process for this model ready (called when the chat is shown)."""
    if model not in CHAT_MODELS:
        return False
    with _warm_lock:
        entry = _warm.get(model)
        if entry and _usable(entry, model):
            return True
        if entry:
            _discard(entry)
        try:
            _warm[model] = _spawn(model)
        except (OSError, AIUnavailable):
            _warm.pop(model, None)
            return False
    return True


def _take(model: str) -> tuple:
    with _warm_lock:
        entry = _warm.pop(model, None)
    if entry and _usable(entry, model):
        return entry
    if entry:
        _discard(entry)
    try:
        return _spawn(model)
    except OSError as exc:
        raise AIUnavailable(f"Claude Code tidak bisa dijalankan: {exc}") from None


@atexit.register
def _stop_warm() -> None:
    with _warm_lock:
        for entry in _warm.values():
            _discard(entry)
        _warm.clear()


def _chat_stream(model: str, prompt: str, progress: Progress, timeout: int = 300) -> dict:
    """Send the prompt to a (pre-started) process, stream the answer into
    progress.partial(), and return {"result": answer, "usage": tokens}.

    The answer is complete at the model's message_stop. Claude Code may then
    spend a few more seconds on its own bookkeeping (a post-turn summary)
    before its "result" event, so the process is not waited for."""
    entry = _take(model)
    threading.Thread(target=warm, args=(model,), daemon=True).start()   # the next question's process
    proc = entry[0]
    timer = threading.Timer(timeout, proc.kill)
    timer.start()
    result, text, last_push, usage, finished = None, "", 0.0, {}, False
    try:
        proc.stdin.write(json.dumps({"type": "user", "message": {"role": "user", "content": prompt}}) + "\n")
        proc.stdin.close()
        for line in proc.stdout:
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if ev.get("type") == "stream_event":
                se = ev.get("event") or {}
                d = se.get("delta") or {}
                if d.get("type") == "text_delta":
                    text += d.get("text", "")
                    if time.time() - last_push > 0.12:
                        progress.partial(text)
                        last_push = time.time()
                elif se.get("type") == "message_start":
                    usage.update(((se.get("message") or {}).get("usage")) or {})
                elif se.get("type") == "message_delta":
                    usage.update({k: v for k, v in (se.get("usage") or {}).items() if v is not None})
                elif se.get("type") == "message_stop" and text.strip():
                    finished = True
                    break                    # the answer is complete; don't wait for the bookkeeping
            elif ev.get("type") == "result":
                result = ev
                break
    finally:
        timer.cancel()
        _discard(entry)
    if finished:
        progress.partial(text)
        return {"result": text, "usage": usage}
    if result is None:
        err = (proc.stderr.read() or "").strip() if proc.stderr else ""
        raise RuntimeError("Claude Code berhenti tanpa jawaban. " + err[:300])
    if result.get("is_error") or result.get("subtype") != "success":
        msg = str(result.get("result") or result.get("subtype"))
        if any(w in msg.lower() for w in ("login", "api key", "authenticat", "/login")):
            raise AIUnavailable("Claude Code belum login di komputer ini. Jalankan 'claude' sekali di terminal, login, "
                                "lalu coba lagi. (" + msg[:160] + ")")
        raise RuntimeError("Claude Code gagal: " + msg[:300])
    progress.partial(str(result.get("result") or text))
    return {"result": result.get("result") or text, "usage": result.get("usage") or usage}


def chat(question: str, history: list[dict] | None = None, progress: Progress = NO_PROGRESS,
         cfg=None, store=None, facts: str | None = None, runner=None, model: str | None = None) -> dict:
    """One chat turn: Python picks the data, Claude Code answers in one go
    (no tools, short system prompt), Python checks the numbers."""
    from . import chat_context
    from .config import load_config
    from .store import Store

    question = (question or "").strip()
    if not question:
        raise ValueError("Pertanyaannya kosong.")
    if len(question) > 2000:
        raise ValueError("Pertanyaannya terlalu panjang (maks. 2000 karakter).")
    model = (model or CHAT_MODEL).strip().lower()
    if model not in CHAT_MODELS:
        raise ValueError(f"Model '{model}' tidak dikenal; pilih {', '.join(CHAT_MODELS)}.")
    cfg = cfg or load_config()
    store = store or Store()
    if not store.ids():
        raise AIUnavailable("Belum ada data di penyimpanan (data/store). Klik ⟳ Tarik dulu.")
    progress.step("Memilih data yang relevan")
    pack = chat_context.build(question, cfg, store, history, facts=facts)
    progress.step(f"Claude {model.capitalize()} menjawab dari: " + ", ".join(pack["used"]))
    if runner is not None:
        answer = runner(pack["prompt"])
    else:
        result = _chat_stream(model, pack["prompt"], progress)
        answer = str(result.get("result") or "").strip()
        u = result.get("usage") or {}
        tokens = sum(int(u.get(k) or 0) for k in ("input_tokens", "cache_creation_input_tokens",
                                                 "cache_read_input_tokens", "output_tokens"))
    return {"answer": answer, "used": pack["used"], "model": model, "tokens": tokens if runner is None else None,
            "unverified": chat_context.unverified_numbers(answer, pack["context"], question)}
