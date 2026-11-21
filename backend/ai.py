"""Claude, called from the app's buttons (the same work the project skills do).

1. Insights   facts sheet (scripts/digest.py) -> one call with a JSON schema
              -> number check (scripts/insights.py) -> one repair call if a
              number is not in the facts -> publish to data/insights/.
2. Stock data research with web search/fetch (Anthropic-hosted tools), then
              one call that turns the notes into rows with a JSON schema.
              The rows come back to the page as a proposal; nothing is saved
              until you press Simpan (backend: Service.upsert_many).

Credentials: the Anthropic SDK finds them itself, from ANTHROPIC_API_KEY or a
profile made with `ant auth login`. Each run is billed to that account.
"""
from __future__ import annotations

import json
import sys
from datetime import date

from .config import ROOT
from .jobs import NO_PROGRESS, Progress

MODEL = "claude-opus-5-5"
# If a safety classifier declines, the API re-runs the request on a fallback
# model inside the same call ("default" picks it by category).
FALLBACK = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}


class AIUnavailable(RuntimeError):
    """No Anthropic credentials, or the SDK is missing. Shown to the user as-is."""


def client():
    try:
        import anthropic
    except ImportError:  # pragma: no cover - depends on the install
        raise AIUnavailable("Paket 'anthropic' belum terpasang. Jalankan: pip install -r requirements.txt") from None
    try:
        return anthropic.Anthropic()
    except anthropic.AnthropicError as exc:
        raise AIUnavailable(
            "Kunci Claude belum ada. Di terminal jalankan 'ant auth login', atau setel ANTHROPIC_API_KEY "
            f"sebelum start.sh, lalu mulai ulang aplikasi. ({exc})") from None


def _call(cli, **kw):
    """One request; a refusal or a cut-off answer becomes a clear error."""
    import anthropic

    try:
        msg = cli.beta.messages.create(model=MODEL, **FALLBACK, **kw)
    except TypeError as exc:
        if "authentication" not in str(exc).lower():
            raise
        raise AIUnavailable(
            "Kunci Claude belum ada di komputer ini. Di terminal jalankan 'ant auth login', atau setel "
            "ANTHROPIC_API_KEY sebelum menjalankan start.sh, lalu mulai ulang aplikasi.") from None
    except anthropic.AuthenticationError:
        raise AIUnavailable("Kunci Claude ditolak (401). Periksa ANTHROPIC_API_KEY atau jalankan 'ant auth login'.") from None
    except anthropic.PermissionDeniedError as exc:
        raise AIUnavailable(f"Akun Claude tidak punya izin untuk ini: {exc.message}") from None
    if msg.stop_reason == "refusal":
        cat = getattr(getattr(msg, "stop_details", None), "category", None)
        raise RuntimeError(f"Claude menolak permintaan ini ({cat or 'tanpa kategori'}).")
    if msg.stop_reason == "max_tokens":
        raise RuntimeError("Jawaban Claude terpotong (batas token). Coba lagi.")
    return msg


def _text(msg) -> str:
    return "".join(b.text for b in msg.content if b.type == "text")


def _json(msg) -> dict:
    # output_config.format guarantees the text is valid JSON for the schema
    return json.loads(_text(msg))


# =================================================================== insights
INSIGHT_SCHEMA = {
    "type": "object",
    "properties": {
        "data_as_of": {"type": "string"},
        "insights": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "layer": {"type": "string", "enum": ["dunia", "as", "indonesia", "uang", "pasar", "kredit", "bank"]},
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

INSIGHT_SYSTEM = """You write the "Insight dari Claude" panel of an Indonesian economic dashboard for one investor.
You get a fact sheet in which every number is already computed. Read it top-down, the way the dashboard is built:
world -> United States -> Indonesia -> money (rates, Rupiah, foreign flows) -> stock markets (IHSG vs Asia and global) -> bank credit -> what it means for bank stocks.
Look for contrast (the world rises, Indonesia falls), a change of direction, tension (higher rates yet money still leaves), and data that is missing or overdue.

Write 6 to 8 insights in plain Indonesian, one idea each, and make the last one layer "bank".
- title: at most 8 words and states the finding.
- body: 1-2 sentences, at most 45 words.
- evidence: a correlation with r and n, or a note on source or limits; may be empty.
Use only numbers that appear in the fact sheet (rounding is fine); never compute new ones.
Correlation is not causation: write "sejalan" or "berlawanan", never "menyebabkan", and give n with every r.
Say how sure you are when the data is thin. No buy or sell advice.
data_as_of: the periods the facts cover, e.g. "Sep'26 (makro), Okt'26 (pasar)". data_gaps: important data that is missing and would change the reading."""


def generate_insights(progress: Progress = NO_PROGRESS) -> dict:
    sys.path.insert(0, str(ROOT / "scripts"))
    import insights as ins  # scripts/insights.py

    progress.step("Menghitung fakta dari data (scripts/digest.py)")
    facts = ins.digest_text()
    cli = client()
    messages = [{"role": "user", "content": "Fakta:\n\n" + facts}]
    common = dict(max_tokens=16000, system=INSIGHT_SYSTEM, output_config={
        "effort": "high", "format": {"type": "json_schema", "schema": INSIGHT_SCHEMA}})
    progress.step(f"Claude ({MODEL}) membaca fakta dan menulis insight")
    msg = _call(cli, messages=messages, **common)
    doc = _json(msg)
    res = ins.check(doc, facts)
    if res["unmatched"] or res["problems"]:
        # one repair turn: tell Claude exactly which numbers are not in the facts
        progress.step(f"{len(res['unmatched'])} angka tidak ada di fakta; Claude memperbaikinya")
        messages += [{"role": "assistant", "content": msg.content},
                     {"role": "user", "content": "Pemeriksa angka menemukan masalah. Perbaiki hanya bagian ini, pakai angka yang ada di fakta "
                      "atau hapus angkanya, lalu tulis ulang JSON lengkap:\n" + "\n".join(res["unmatched"] + res["problems"])}]
        msg = _call(cli, messages=messages, **common)
        doc = _json(msg)
        res = ins.check(doc, facts)
    if res["unmatched"] or res["problems"]:
        raise RuntimeError("Insight tidak dipublikasikan: masih ada angka yang tidak ditemukan di fakta ("
                           + "; ".join((res["unmatched"] + res["problems"])[:4]) + ").")
    ins.publish(doc, res, by=f"tombol di aplikasi ({MODEL})")
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

RESEARCH_SYSTEM = """You research one Indonesian listed company's financial figures for an investor's valuation sheet.
Trust sources in this order:
1. the issuer's own filings: audited financial statements and annual reports on idx.co.id or the company's investor-relations site;
2. regulators and market infrastructure: OJK, Bursa Efek Indonesia (IDX/BEI), KSEI;
3. established financial press (Kontan, Bisnis Indonesia, CNBC Indonesia, Katadata) only to locate a figure, or when no primary source publishes it.
Never use Wikipedia, aggregator sites or AI-written pages. If two sources disagree, prefer the filing and mention the other.
Never guess: a figure you cannot find stays missing.

Units: Rp T means trillions of rupiah, miliar means billions of shares, % as a number (18.8, not 0.188), Rp per share.
Profit and equity are attributable to owners of the parent. Restate per-share figures for stock splits so older years match today's share count, and say so.
fy_last is the last full year with an annual report; dps_fyYYYY and payout_fyYYYY refer to that year and the ones before it.
For profit_growth, the period goes first in the note, e.g. "H1 2026; Laporan keuangan H1 2026 (idx.co.id)".

Work efficiently: prefer the latest financial statements and the latest annual report, which hold most figures at once.
End with research notes that list, for every figure you found: key or year, value with unit, period, and the source (publisher plus URL)."""


def research_stock(code: str, name: str, sector: str, keys: list[tuple[str, str, str]],
                   have_history: list[str], have_dividends: int, progress: Progress = NO_PROGRESS,
                   max_rounds: int = 12) -> dict:
    """Ask Claude to find a stock's figures on the web. Returns proposed rows."""
    cli = client()
    today = date.today().isoformat()
    want = "\n".join(f"- {k} [{u}]: {d}" for k, d, u in keys)
    task = (f"Company: {code} ({name}), sector {'bank' if sector == 'bank' else 'non-bank'}. Today is {today}.\n\n"
            f"Fundamental keys to find (latest report):\n{want}\n\n"
            f"Year-end history 2016 onwards (book value, EPS, DPS per share). Years already in the sheet: {', '.join(have_history) or 'none'}.\n"
            f"Every dividend payment since 2016 (date paid, fiscal year, interim or final, per share). Payments already in the sheet: {have_dividends}.")
    tools = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 15},
             {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 15}]
    messages = [{"role": "user", "content": task}]
    progress.step(f"Claude mencari angka {code} di laporan keuangan, BEI dan OJK")
    for rnd in range(max_rounds):
        msg = _call(cli, max_tokens=32000, system=RESEARCH_SYSTEM, tools=tools, messages=messages,
                    output_config={"effort": "high"})
        searches = sum(1 for b in msg.content if b.type == "server_tool_use")
        if searches:
            progress.step(f"Putaran {rnd + 1}: {searches} pencarian/bacaan halaman")
        if msg.stop_reason == "pause_turn":   # the server-side loop paused; re-send to resume
            messages.append({"role": "assistant", "content": msg.content})
            continue
        break
    else:
        raise RuntimeError("Riset terlalu panjang; coba lagi atau isi sebagian lewat editor.")
    notes = _text(msg)
    progress.step("Claude merapikan temuan menjadi baris data")
    out = _call(cli, max_tokens=16000, messages=[{"role": "user", "content":
        f"Turn these research notes on {code} into rows. Keep only figures the notes give with a source; "
        f"list every requested fundamental key that has no figure in not_found. Allowed fundamental keys: "
        f"{', '.join(k for k, _, _ in keys)}.\n\nNOTES:\n{notes}"}],
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": ROW_SCHEMA}})
    data = _json(out)
    allowed = {k for k, _, _ in keys}
    data["fund"] = [f for f in data["fund"] if f["key"] in allowed]
    return {"code": code, "proposal": data, "notes": notes}


def proposal_rows(code: str, proposal: dict) -> dict[str, list[list[str]]]:
    """The proposal as rows for saham_fund / saham_fh / saham_dv (Kode first)."""
    def n(x):
        return "" if x is None else (str(int(x)) if float(x).is_integer() else repr(float(x)))

    fund = [[code, f["key"], "", n(f["value"]), "", f"{f['period']}; {f['source']}".strip("; ")] for f in proposal.get("fund", [])]
    fh = [[code, f"{h['year']}-12-31", n(h["bvps"]), n(h["eps"]), n(h["dps"]), h["source"]] for h in proposal.get("history", [])]
    dv = [[code, d["paid_on"], str(d["fiscal_year"]), d["kind"], n(d["per_share"]), d["source"]] for d in proposal.get("dividends", [])]
    return {"saham_fund": fund, "saham_fh": fh, "saham_dv": dv}
