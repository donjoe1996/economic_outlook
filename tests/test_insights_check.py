"""The insights checker must catch invented numbers and accept honest rounding."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import insights  # noqa: E402

FACTS = """- IHSG: Okt'26 5057 | -38.1% sejak Okt'25
- USD/IDR: Sep'26 17716 | +7.2% sejak Okt'25
- Batu bara: +36.8% sejak Okt'25
- Selisih BI Rate − Fed: Sep'26 1.75 poin (n=11)"""


def doc(body, layer="pasar"):
    return {"insights": [{"layer": layer, "title": "t", "body": body, "evidence": ""}]}


def test_accepts_indonesian_style_and_rounding():
    r = insights.check(doc("IHSG −38,1% sejak Okt'25, Rupiah 17.716, batu bara naik 37%, selisih 1,75 poin (n=11)."), FACTS)
    assert r["unmatched"] == [] and r["numbers"] == 5


def test_catches_invented_number():
    r = insights.check(doc("IHSG turun 40,5%."), FACTS)
    assert r["unmatched"] == ["insights[0].body: 40,5"]


def test_ignores_names_years_and_period_labels():
    r = insights.check(doc("S&P 500 dan FTSE 100 pada 2026, yield 10 tahun, Okt'26 dan Q3'26: IHSG −38,1%."), FACTS)
    assert r["unmatched"] == [] and r["numbers"] == 1


def test_rejects_unknown_layer_and_long_body():
    r = insights.check(doc(" ".join(["kata"] * 61), layer="lain"), FACTS)
    assert len(r["problems"]) == 2
