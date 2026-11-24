"""What the chat sends to Claude, and how its answer is checked.

Fast, cheap and accurate comes from doing the data work in Python:

1. Always: the fact sheet (scripts/digest.py, ~1.5k tokens), where every
   level, change, range and correlation is already computed.
2. Only what the question is about: up to 4 datasets matched by keywords
   (their last rows, period plus number columns), and for each stock code
   named, its price summary and fundamentals (with P/BV and P/E computed
   here, not by the model).
3. The last few exchanges, so follow-up questions work.

Claude then answers in one turn with no tools. Every number in the answer is
looked up in what was sent (allowing rounding and Indonesian number style);
numbers that are not there are returned as "unverified" and shown on the page.
"""
from __future__ import annotations

import re
import sys

from .config import ROOT

# question words -> datasets (ids). Titles and ids match as well.
SYNONYMS = {
    "birate": ["bi rate", "suku bunga", "bunga acuan", "bunga bi", "bunga"],
    "fed": ["fed", "fomc", "bunga as", "the fed"],
    "rupiah": ["rupiah", "kurs", "usd/idr", "dolar", "nilai tukar"],
    "inflation": ["inflasi"],
    "cpi": ["ihk", "harga konsumen"],
    "flow": ["asing", "arus asing", "dana asing", "foreign"],
    "sbn": ["sbn", "yield", "obligasi", "surat utang", "ust"],
    "pmi": ["pmi", "manufaktur", "pabrik"],
    "gpmi": ["pmi global", "global"],
    "cpmi": ["china", "tiongkok"],
    "ism": ["ism", "amerika", "as"],
    "gdp": ["pdb", "gdp", "pertumbuhan ekonomi", "ekonomi tumbuh"],
    "gdpus": ["pdb as", "ekonomi as"],
    "retail": ["ritel", "penjualan", "konsumsi"],
    "ikk": ["keyakinan konsumen", "ikk", "konsumen"],
    "saham": ["ihsg", "idxfinance", "saham bank", "bank", "indeks"],
    "sahamasia": ["asia", "regional"],
    "sahamglobal": ["global", "s&p", "wall street", "dunia", "london", "nikkei"],
    "kredit": ["kredit", "provinsi", "pinjaman", "daerah"],
    "komoditas": ["batu bara", "batubara", "nikel", "komoditas", "cpo", "coal"],
    "tambang": ["tambang", "energi"],
    "valuasi": ["valuasi", "murah", "mahal", "per ihsg"],
    "srbi": ["srbi"],
    "asingksei": ["ksei", "kepemilikan asing"],
    "rotation": ["rotasi"],
    "sektor": ["sektor", "bobot", "kapitalisasi"],
}
MAX_DATASETS = 4
LAST_ROWS = 8
CODE = re.compile(r"\b[A-Z]{4}\b")
BTC_WORDS = re.compile(r"\b(bitcoin|btc|kripto|crypto|mvrv|halving|etf bitcoin|on-?chain|stock-to-flow|s2f|puell|hash ?rate)\b", re.I)


_FACTS: dict = {}


def _facts(store=None) -> str:
    """The fact sheet, cached until the data changes (the store's index is
    rewritten on every save or pull)."""
    sys.path.insert(0, str(ROOT / "scripts"))
    import insights as ins  # scripts/insights.py (wraps scripts/digest.py)

    idx = (store.path("datapackage.json") if store is not None else None)
    stamp = idx.stat().st_mtime_ns if idx is not None and idx.exists() else None
    if stamp is not None and _FACTS.get("stamp") == stamp:
        return _FACTS["text"]
    text = ins.digest_text()
    if stamp is not None:
        _FACTS.update(stamp=stamp, text=text)
    return text


def match_datasets(question: str, cfg, available: set[str]) -> list[str]:
    q = question.lower()
    # whole words only, allowing Indonesian suffixes (asingnya, bungalah, ...)
    has = lambda w: re.search(r"(?<![\w/])" + re.escape(w.strip()) + r"(?:nya|kah|lah|pun)?(?![\w/])", q) is not None
    scored = []
    for ds_id, ds in cfg.datasets.items():
        if ds_id not in available or ds.kind != "sheet" or ds_id.startswith(("harga_", "saham_", "bmri_", "bank_peers")):
            continue
        words = SYNONYMS.get(ds_id, []) + [ds.title.lower()]
        score = sum(len(w) for w in words if w.strip() and has(w))
        if has(ds_id):
            score += 10
        if score:
            scored.append((score, ds_id))
    return [d for _, d in sorted(scored, reverse=True)[:MAX_DATASETS]]


def _fmt(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        return f"{v:.4f}".rstrip("0").rstrip(".")
    return str(v)


def dataset_block(store, cfg, ds_id: str) -> str:
    doc = store.typed(ds_id) or {}
    fields = doc.get("schema", {}).get("fields", [])
    rows = doc.get("rows", [])
    if not fields or not rows:
        return ""
    cols = [0] + [i for i, f in enumerate(fields) if f["type"] == "number" and i > 0][:6]
    src_i = next((i for i, f in enumerate(fields) if f["name"].lower() in ("penerbit", "sumber")), None)
    lines = [f"## {cfg.datasets[ds_id].title} ({ds_id})", " | ".join(fields[i]["name"] for i in cols)]
    for r in rows[-LAST_ROWS:]:
        lines.append(" | ".join(_fmt(r[i]) if i < len(r) else "" for i in cols))
    if src_i is not None and src_i < len(rows[-1]) and rows[-1][src_i]:
        lines.append(f"Sumber baris terakhir: {rows[-1][src_i]}")
    return "\n".join(lines)


def stock_block(store, cfg, code: str) -> str:
    from . import stocks

    reg = stocks.registry(cfg, store)
    s = reg.get(code)
    if not s:
        return ""
    lines = [f"## Saham {code} ({s['name']}, sektor {s['sector']})"]
    prices = []
    for r in (store.typed(s["price_ds"]) or {}).get("rows", []):
        if len(r) > 1 and isinstance(r[1], (int, float)):
            prices.append((str(r[0])[:10], float(r[1])))
    last = None
    if prices:
        prices.sort()
        d, last = prices[-1]
        def chg(n):
            return f"{(last / prices[-1 - n][1] - 1) * 100:+.1f}%" if len(prices) > n else "n/a"
        window = [p for _, p in prices[-245:]]
        lines.append(f"Penutupan terakhir {last:g} ({d}); perubahan 1 bulan {chg(21)}, 3 bulan {chg(63)}, 12 bulan {chg(245)}; "
                     f"rentang 52 minggu {min(window):g} sampai {max(window):g}")
    fund_rows = [r for r in (store.get(s["fund_ds"]) or {}).get("values", [])]
    if not s["legacy"]:
        fund_rows = [r[1:] for r in fund_rows if r and r[0].strip().upper() == code]
    f = {}
    for r in fund_rows:
        if len(r) > 2 and r[2].strip():
            try:
                f[r[0].strip()] = float(r[2].replace(",", ""))
            except ValueError:
                continue
            note = (r[4] if len(r) > 4 else "").strip()
            lines.append(f"{r[0].strip()} = {r[2].strip()} {r[3].strip() if len(r) > 3 else ''}" + (f" ({note[:60]})" if note else ""))
    if last and all(k in f for k in ("shares_out", "equity_parent", "net_profit_ttm")) and f["shares_out"]:
        bv = f["equity_parent"] * 1e12 / (f["shares_out"] * 1e9)
        eps = f["net_profit_ttm"] * 1e12 / (f["shares_out"] * 1e9)
        lines.append(f"Dihitung: nilai buku per saham {bv:.0f}, laba per saham 12 bulan {eps:.0f}, "
                     f"PBV {last / bv:.2f}x, PER {last / eps:.1f}x")
    # the stock's own foreign flow (weekly/daily rows), newest last
    flow = (store.get("bmri_flow") or {}).get("values", []) if s["legacy"] and code == "BMRI" else \
        [r[1:] for r in (store.get("saham_flow") or {}).get("values", []) if r and r[0].strip().upper() == code]
    sf = [r for r in flow if len(r) > 3 and r[2].startswith(("stk_", "bmri_")) and r[3].strip()]
    if sf:
        lines.append("Arus asing bersih saham ini (Rp miliar, negatif = jual bersih): " +
                     "; ".join(f"{r[0]} s.d. {r[1]} {r[3]}" for r in sf[-5:]))
    if len(lines) == 1:
        lines.append("Belum ada harga atau fundamental tersimpan untuk saham ini.")
    return "\n".join(lines)


def build(question: str, cfg, store, history: list[dict] | None = None, facts: str | None = None) -> dict:
    """The prompt for one chat turn, plus what was used (for the page)."""
    from . import stocks

    available = set(store.ids())
    used, blocks = ["Ringkasan fakta"], []
    for ds_id in match_datasets(question, cfg, available):
        b = dataset_block(store, cfg, ds_id)
        if b:
            blocks.append(b)
            used.append(cfg.datasets[ds_id].title)
    if BTC_WORDS.search(question + " " + " ".join(str(t.get("q", "")) for t in (history or [])[-1:])):
        from . import btc, compute
        try:
            b = btc.chat_block(compute.run("btc", store))
        except Exception:
            b = ""
        if b:
            blocks.append(b)
            used.append("Bitcoin rinci")
    known = set(stocks.registry(cfg, store))
    # stock codes in this question, or in the previous one ("lalu arus asingnya?")
    recent = question + " " + " ".join(str(t.get("q", "")) for t in (history or [])[-1:])
    for code in dict.fromkeys(CODE.findall(recent.upper())):
        if code in known:
            b = stock_block(store, cfg, code)
            if b:
                blocks.append(b)
                used.append(f"Saham {code}")
    facts = facts if facts is not None else _facts(store)
    hist = ""
    for t in (history or [])[-3:]:
        q, a = str(t.get("q", ""))[:600], str(t.get("a", ""))[:900]
        if q and a:
            hist += f"\nPengguna: {q}\nAnda: {a}\n"
    context = "FAKTA (sudah dihitung dari data dashboard):\n" + facts + ("\n\nDATA TERKAIT PERTANYAAN:\n" + "\n\n".join(blocks) if blocks else "")
    prompt = context + (("\n\nPERCAKAPAN SEBELUMNYA:" + hist) if hist else "") + "\n\nPERTANYAAN:\n" + question.strip()
    return {"prompt": prompt, "context": context + hist, "used": used}


def unverified_numbers(answer: str, context: str, question: str = "") -> list[str]:
    """Numbers in the answer that appear nowhere in what was sent (or asked)."""
    sys.path.insert(0, str(ROOT / "scripts"))
    import insights as ins

    known = []
    for tok in ins.numbers_in(context + "\n" + question):
        known += [v for v, _ in ins._readings(tok)]
    out = []
    for tok in ins.numbers_in(answer):
        if not any(abs(abs(v) - abs(k)) <= tol for v, tol in ins._readings(tok) for k in known):
            if tok not in out:
                out.append(tok)
    return out
