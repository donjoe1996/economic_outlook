"""Compact fact sheet of the dashboard's data, for Claude to interpret.

    python scripts/digest.py            # print the fact sheet (~60 lines)

Why: the raw data is ~28 tables. Reading them costs many tokens and invites
arithmetic mistakes. This script does all the arithmetic (levels, changes,
ranges, correlations, rankings, what is overdue) from the local cache and
prints only the results. Claude then interprets; scripts/insights.py checks
that every number Claude writes appears here.

No network: it reads the local data store, data/store/ (pull first to be current).
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.store import Store  # noqa: E402
from backend.config import load_config  # noqa: E402
from backend.service import Service, parse_number  # noqa: E402

# dataset -> [(column, label, unit, decimals, kind)]
#   kind "level": change shown in % ; "rate": change shown in points
SERIES = {
    "gpmi": [(1, "PMI global (JPM)", "", 1, "rate")],
    "cpmi": [(1, "PMI China (NBS)", "", 1, "rate")],
    "ism": [(1, "ISM manufaktur AS", "", 1, "rate")],
    "gdpus": [(1, "PDB riil AS (QoQ SAAR)", "%", 1, "rate")],
    "fed": [(1, "Fed Funds batas atas", "%", 2, "rate")],
    "pmi": [(1, "PMI manufaktur Indonesia", "", 1, "rate")],
    "gdp": [(1, "PDB riil Indonesia YoY", "%", 2, "rate")],
    "retail": [(1, "Penjualan ritel riil YoY", "%", 1, "rate")],
    "ikk": [(1, "Indeks Keyakinan Konsumen", "", 1, "rate")],
    "inflation": [(1, "Inflasi YoY", "%", 2, "rate")],
    "birate": [(1, "BI Rate", "%", 2, "rate")],
    "rupiah": [(1, "USD/IDR rata-rata bulanan", "", 0, "level")],
    "flow": [(1, "Arus asing di saham", "Rp T", 2, "flow")],
    "rotation": [(1, "Arus asing di SBN", "Rp T", 2, "flow")],
    "srbi": [(1, "Kepemilikan asing SRBI", "Rp T", 1, "level")],
    "komoditas": [(1, "Batu bara", "USD/t", 1, "level"), (2, "CPO", "USD/t", 0, "level"), (3, "Nikel", "USD/t", 0, "level")],
    "saham": [(1, "IHSG", "", 0, "level"), (2, "IDXFINANCE", "", 0, "level"), (8, "BBCA", "", 0, "level"),
              (9, "BBRI", "", 0, "level"), (10, "BMRI", "", 0, "level"), (11, "BBNI", "", 0, "level")],
    "sbn": [(1, "Yield SBN 10 th", "%", 2, "rate"), (2, "Yield UST 10 th", "%", 2, "rate")],
}
THRESHOLDS = {"PMI": 50, "ISM": 50, "Keyakinan": 100}
MARKETS = {
    "sahamglobal": [(1, "IHSG"), (2, "S&P500"), (8, "FTSE100"), (9, "DAX"), (10, "CAC40"), (11, "Nikkei"),
                    (12, "HangSeng"), (13, "CSI300"), (14, "Dunia-URTH(USD)"), (15, "IHSG-EIDO(USD)")],
    "sahamasia": [(9, "KOSPI"), (12, "TAIEX"), (8, "Nifty"), (13, "ASX200"), (14, "Shenzhen"),
                  (15, "THD(USD)"), (16, "EWM(USD)"), (17, "EPHE(USD)"), (18, "EWS(USD)"), (19, "VNM(USD)"), (21, "EEM(USD)")],
}


def num(x):
    try:
        return parse_number(x)
    except Exception:
        return None


def f(v, d):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "–"
    return f"{v:.{d}f}"


def sg(v, d):
    return "–" if v is None else f"{v:+.{d}f}"


def corr(a, b):
    p = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if len(p) < 4:
        return None, len(p)
    mx = sum(x for x, _ in p) / len(p)
    my = sum(y for _, y in p) / len(p)
    sxy = sum((x - mx) * (y - my) for x, y in p)
    sx = math.sqrt(sum((x - mx) ** 2 for x, _ in p))
    sy = math.sqrt(sum((y - my) ** 2 for _, y in p))
    return (sxy / (sx * sy) if sx and sy else None), len(p)


def main() -> None:
    cfg = load_config()
    cache = Store()
    rows = {k: (cache.get(k) or {}).get("values", []) for k in cfg.datasets if cfg.datasets[k].kind == "sheet"}
    meta = Service(cfg, cache, None).metadata()
    out: list[str] = []
    w = out.append
    w(f"# Fakta data (dihitung {meta['today']}, dari salinan lokal). Angka = hasil hitung; jangan hitung ulang.")

    # ---- per series -------------------------------------------------------
    by_month: dict[str, dict[str, float]] = {}
    w("\n## Seri (terakhir | vs periode sebelumnya | sejak awal jendela | rentang)")
    for ds, cols in SERIES.items():
        data = [r for r in rows.get(ds, []) if r and r[0]]
        for col, label, unit, d, kind in cols:
            pts = [(r[0], num(r[col]) if len(r) > col else None) for r in data]
            vals = [(p, v) for p, v in pts if v is not None]
            if not vals:
                w(f"- {label}: belum ada data")
                continue
            by_month[label] = {p: v for p, v in pts}
            (p0, v0), (pl, vl) = vals[0], vals[-1]
            prev = vals[-2] if len(vals) > 1 else None
            lo = min(vals, key=lambda t: t[1])
            hi = max(vals, key=lambda t: t[1])
            u = f" {unit}" if unit else ""
            if kind == "level":
                since = f"{sg((vl / v0 - 1) * 100, 1)}% sejak {p0}"
                chg = f"{sg((vl / prev[1] - 1) * 100, 1)}% vs {prev[0]}" if prev else ""
            elif kind == "flow":
                tot = sum(v for _, v in vals)
                miss = sum(1 for _, v in pts if v is None)
                since = f"jumlah {sg(tot, 2)}{u} ({len(vals)} periode terisi, {miss} kosong)"
                chg = f"sebelumnya {sg(prev[1], 2)} ({prev[0]})" if prev else ""
            else:
                since = f"{sg(vl - v0, d)} poin sejak {p0} ({f(v0, d)})"
                chg = f"{sg(vl - prev[1], d)} vs {prev[0]}" if prev else ""
            extra = ""
            for key, t in THRESHOLDS.items():
                if key in label:
                    below = sum(1 for _, v in vals if v < t)
                    extra = f" | di bawah {t}: {below} dari {len(vals)}"
            w(f"- {label}: {pl} {f(vl, d)}{u} | {chg} | {since} | min {f(lo[1], d)} ({lo[0]}), maks {f(hi[1], d)} ({hi[0]}){extra}")

    # ---- derived -----------------------------------------------------------
    w("\n## Turunan")
    bi, fed, inf = by_month.get("BI Rate", {}), by_month.get("Fed Funds batas atas", {}), by_month.get("Inflasi YoY", {})
    months = [m for m in bi if m in fed and bi[m] is not None and fed[m] is not None]
    if months:
        spread = [(m, bi[m] - fed[m]) for m in months]
        lo = min(spread, key=lambda t: t[1]); hi = max(spread, key=lambda t: t[1])
        w(f"- Selisih BI Rate − Fed: {spread[-1][0]} {spread[-1][1]:.2f} poin | min {lo[1]:.2f} ({lo[0]}), maks {hi[1]:.2f} ({hi[0]})")
    if bi and inf:
        m = [k for k in bi if bi[k] is not None and inf.get(k) is not None]
        if m:
            w(f"- Suku bunga riil (BI Rate − inflasi): {m[-1]} {bi[m[-1]] - inf[m[-1]]:.2f} poin")
    fl = by_month.get("Arus asing di saham", {})
    ytd = [(m, v) for m, v in fl.items() if v is not None and m.endswith("'26")]
    if ytd:
        w(f"- Arus asing saham sejak Jan'26: {sum(v for _, v in ytd):+.2f} Rp T ({len(ytd)} bulan terisi)")

    # ---- correlations (monthly, aligned by period) -------------------------
    w("\n## Korelasi bulanan (Pearson; sampel kecil, bukan sebab-akibat)")
    def series(label):
        return by_month.get(label, {})
    pairs = [("PMI manufaktur Indonesia", "PMI global (JPM)"), ("PMI China (NBS)", "PMI manufaktur Indonesia"),
             ("ISM manufaktur AS", "PMI global (JPM)"), ("Inflasi YoY", "BI Rate")]
    for a, b in pairs:
        A, B = series(a), series(b)
        ks = [k for k in A if k in B]
        r, n = corr([A[k] for k in ks], [B[k] for k in ks])
        if r is not None:
            w(f"- {a} vs {b}: r={r:.2f} (n={n})")
    if months and fl:
        ks = [m for m in months if fl.get(m) is not None]
        r, n = corr([bi[m] - fed[m] for m in ks], [fl[m] for m in ks])
        if r is not None:
            w(f"- Selisih BI−Fed vs arus asing saham: r={r:.2f} (n={n})")

    # ---- stock markets -----------------------------------------------------
    w("\n## Pasar saham (perubahan harga penutupan, awal → akhir jendela; indeks mata uang lokal kecuali (USD))")
    for ds, cols in MARKETS.items():
        data = [r for r in rows.get(ds, []) if r and r[0]]
        if not data:
            continue
        res = []
        for col, name in cols:
            pts = [(r[0], num(r[col]) if len(r) > col else None) for r in data]
            v = [(p, x) for p, x in pts if x is not None]
            if len(v) > 1:
                tag = "" if v[0][0] == data[0][0] else f" sejak {v[0][0]}"
                res.append((name, (v[-1][1] / v[0][1] - 1) * 100, tag))
        res.sort(key=lambda t: -t[1])
        w(f"- {data[0][0]}→{data[-1][0]}: " + ", ".join(f"{n} {p:+.1f}%{t}" for n, p, t in res))

    # ---- credit and trade --------------------------------------------------
    kr = [r for r in rows.get("kredit", []) if len(r) > 3]
    if kr:
        g = []
        t0 = t1 = 0.0
        for r in kr:
            a, b = num(r[2]), num(r[3])
            if a and b:
                t0 += a; t1 += b
                if b >= 1000:
                    g.append((r[1], (b / a - 1) * 100, b / 1000))
        g.sort(key=lambda t: -t[1])
        w("\n## Kredit bank per provinsi (Agu 2025 → Agu 2026, posisi ≥ Rp 1 T)")
        w(f"- Nasional: {(t1 / t0 - 1) * 100:+.1f}%")
        w("- Tercepat: " + ", ".join(f"{n} {p:+.1f}%" for n, p, _ in g[:3]))
        w("- Terlambat: " + ", ".join(f"{n} {p:+.1f}%" for n, p, _ in g[-3:]))
    tr = [r for r in rows.get("trade", []) if len(r) > 2 and num(r[1]) is not None]
    if tr:
        tr.sort(key=lambda r: -num(r[1]))
        w("\n## Perdagangan nonmigas per mitra (kumulatif Jan–Agu 2026, USD miliar: ekspor/impor)")
        w("- " + ", ".join(f"{r[0]} {num(r[1]):.1f}/{num(r[2]) if num(r[2]) is not None else 0:.1f}" for r in tr[:5]))

    # ---- what is missing / overdue -----------------------------------------
    w("\n## Kesegaran data (lihat halaman Metadata)")
    late = [d for d in meta["datasets"] if d["status"] in ("error", "late", "due", "stale")]
    groups: dict[str, list[str]] = {}
    for d in late:  # group "Sep'26 -> Okt'26" so the line stays short
        key = f"{d.get('latest') or '–'} → {d.get('expected') or 'lewat batas umur'}"
        groups.setdefault(key, []).append(d["id"])
    w(f"- Perlu diperbarui ({len(late)}): " + ("; ".join(f"{k}: {', '.join(v)}" for k, v in groups.items()) or "tidak ada"))
    gaps = [d for d in meta["datasets"] if d["gaps"]]
    if gaps:
        w("- Periode kosong: " + "; ".join(f"{d['title']}: {', '.join(d['gaps'][:4])}" for d in gaps))

    print("\n".join(out))


if __name__ == "__main__":
    main()
