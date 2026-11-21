"""Check and publish the insights Claude wrote (used by the economic-insights skill).

    python scripts/insights.py check   data/insights/draft.json
    python scripts/insights.py publish data/insights/draft.json

check    Every number in the insights must appear in the fact sheet
         (scripts/digest.py), allowing for rounding and Indonesian number
         style (1,75 = 1.75; 17.716 = 17716). Unmatched numbers are listed:
         fix them or remove them. Exit code 1 if any are unmatched.
publish  Runs the check, stores its result in the file, and writes
         data/insights/latest.json (shown on the dashboard) plus a dated copy.

Schema of the draft:
{
  "data_as_of": "Sep'26 (makro), Okt'26 (pasar)",
  "insights": [{"layer": "dunia|as|indonesia|uang|pasar|kredit|bank",
                "title": "...", "body": "...", "evidence": "..."}],
  "data_gaps": ["..."]
}
"""
from __future__ import annotations

import io
import json
import re
import shutil
import sys
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
OUT_DIR = ROOT / "data" / "insights"
LAYERS = {"dunia", "as", "indonesia", "uang", "pasar", "kredit", "bank"}

_NUM = re.compile(r"(?<![\w'’])[-−+]?\d[\d.,]*")
# Numbers that are part of a name, not data: "S&P 500", "FTSE 100", "10 tahun".
_NAMES = re.compile(r"(S&P|FTSE|CAC|Nikkei|CSI|ASX|Nifty|KOSPI|LQ|IDX)\s?\d+|\b10\s?(tahun|th)\b|\bMSCI World\b", re.I)


def digest_text() -> str:
    import digest  # scripts/digest.py

    buf = io.StringIO()
    with redirect_stdout(buf):
        digest.main()
    return buf.getvalue()


def _readings(token: str) -> list[tuple[float, float]]:
    """Possible values of a written number, each with its rounding tolerance."""
    t = token.replace("−", "-").lstrip("+").rstrip(".,")
    out = []
    for dec, thou in ((",", "."), (".", ",")):
        s = t.replace(thou, "") if t.count(thou) and (t.count(dec) or len(t.split(thou)[-1]) == 3) else t
        if s.count(dec) > 1:
            continue
        s = s.replace(dec, ".")
        try:
            v = float(s)
        except ValueError:
            continue
        decimals = len(s.split(".")[1]) if "." in s else 0
        out.append((v, 0.5 * 10 ** -decimals + 1e-9))
    return out


def numbers_in(text: str) -> list[str]:
    toks = []
    text = _NAMES.sub(" ", text)
    for m in _NUM.finditer(text):
        tok = m.group(0)
        plain = tok.lstrip("+-−").rstrip(".,")
        if not plain or not plain[0].isdigit():
            continue
        if re.fullmatch(r"(19|20)\d\d", plain):
            continue  # a year
        toks.append(tok)
    return toks


def check(doc: dict, facts: str) -> dict:
    known = []
    for tok in numbers_in(facts):
        known += [v for v, _ in _readings(tok)]
    texts = []
    for i, it in enumerate(doc.get("insights", [])):
        for field in ("title", "body", "evidence"):
            texts.append((f"insights[{i}].{field}", it.get(field, "")))
    for i, g in enumerate(doc.get("data_gaps", [])):
        texts.append((f"data_gaps[{i}]", g))
    total, unmatched = 0, []
    for where, text in texts:
        for tok in numbers_in(text):
            total += 1
            ok = any(abs(abs(v) - abs(k)) <= tol for v, tol in _readings(tok) for k in known)
            if not ok:
                unmatched.append(f"{where}: {tok}")
    problems = []
    for i, it in enumerate(doc.get("insights", [])):
        if it.get("layer") not in LAYERS:
            problems.append(f"insights[{i}].layer must be one of {sorted(LAYERS)}")
        if len(it.get("body", "").split()) > 60:
            problems.append(f"insights[{i}].body has more than 60 words")
    return {"numbers": total, "unmatched": unmatched, "problems": problems}


def publish(doc: dict, res: dict, by: str = "Claude Code (skill economic-insights)") -> Path:
    """Write a checked draft as data/insights/latest.json plus a dated copy."""
    doc["generated_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    doc["generated_by"] = by
    doc["check"] = {"numbers": res["numbers"], "unmatched": 0, "method": "setiap angka dicocokkan dengan scripts/digest.py"}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    latest = OUT_DIR / "latest.json"
    latest.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    shutil.copy(latest, OUT_DIR / f"{doc['generated_at'][:10]}.json")
    return latest


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in ("check", "publish"):
        sys.exit(__doc__)
    path = Path(sys.argv[2])
    doc = json.loads(path.read_text(encoding="utf-8"))
    res = check(doc, digest_text())
    print(f"{res['numbers']} angka diperiksa, {len(res['unmatched'])} tidak ditemukan di fakta.")
    for u in res["unmatched"]:
        print("  TIDAK DITEMUKAN", u)
    for p in res["problems"]:
        print("  MASALAH", p)
    bad = bool(res["unmatched"] or res["problems"])
    if sys.argv[1] == "publish":
        if bad:
            sys.exit("Tidak dipublikasikan: perbaiki dulu.")
        latest = publish(doc, res)
        print(f"Dipublikasikan: {latest.relative_to(ROOT)} (tampil di dashboard setelah halaman dimuat ulang)")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
