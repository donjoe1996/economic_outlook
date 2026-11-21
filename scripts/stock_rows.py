"""What a stock still needs, and writing a researched block of rows to the Saham sheet.

Used by the stock-data Claude skill (.claude/skills/stock-data), and by hand:

    python scripts/stock_rows.py todo BBRI
        Which Fundamental keys are still blank, and how many history,
        dividend and flow rows exist. Reads the local copy only.

    python scripts/stock_rows.py write data/stocks/BBRI.json [--dry-run]
        Saves a draft to the data store (one save per table, see
        Service.upsert_many) and uploads the changed files to Google Drive.
        --dry-run only prints what would change.

The app does the same from the stock page: "Isi dengan Claude" proposes the
rows, you review them, then Simpan (backend/ai.py).

The draft file (data/ is not committed):

    {"code": "BBRI",
     "fund": [["roe", "18.8", "H1 2026; Laporan keuangan H1 2026, idx.co.id"]],
     "fh":   [["2025-12-31", "2201.5", "406.7", "345.98", "Laporan tahunan 2025"]],
     "dv":   [["2026-04-15", "2025", "final", "208.4", "RUPS 2026; keterbukaan BEI"]],
     "flow": [["2026-11-10", "2026-11-14", "stk_week", "-512.3", "regular", "reported", "BEI via Kontan", ""]]}

Values are written exactly as given: dot for decimals, no thousands separators.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import stocks  # noqa: E402
from backend.store import Store as Cache  # noqa: E402
from backend.config import load_config  # noqa: E402

TABS = {"fund": "saham_fund", "fh": "saham_fh", "dv": "saham_dv", "flow": "saham_flow"}
WIDTH = {"fund": 3, "fh": 5, "dv": 5, "flow": 8}   # columns after Kode in each draft row


def _rows(cache: Cache, ds_id: str, code: str) -> list[list[str]]:
    doc = cache.get(ds_id) or {}
    return [r[1:] for r in doc.get("values", []) if r and str(r[0]).strip().upper() == code]


def todo(code: str) -> int:
    code = code.upper()
    cfg, cache = load_config(), Cache()
    reg = stocks.registry(cfg, cache)
    s = reg.get(code)
    if not s:
        print(f"{code} belum terdaftar. Tambahkan dulu di aplikasi: stock.html?tk={code}")
        return 1
    if s["legacy"]:
        print(f"{code} punya sheet sendiri (lama); skrip ini hanya untuk sheet Saham.")
        return 1
    print(f"{code} · {s['name']} · sektor {s['sector']} · pembanding {', '.join(s['peers']) or '-'}")
    fund = _rows(cache, "saham_fund", code)
    blank = [r for r in fund if len(r) < 3 or not str(r[2]).strip()]
    print(f"Fundamental: {len(fund) - len(blank)}/{len(fund)} terisi. Kosong:")
    for r in blank:
        unit = r[3] if len(r) > 3 else ""
        print(f"  {r[0]:<16} [{unit}] {r[1] if len(r) > 1 else ''}")
    for kind, ds_id, need in [("Riwayat fundamental", "saham_fh", "akhir tahun 2016 sampai terbaru: BVPS, EPS, DPS"),
                              ("Dividen", "saham_dv", "setiap pembayaran: tanggal bayar, tahun buku, interim/final, per saham"),
                              ("Arus asing", "saham_flow", "arus asing bersih harian/mingguan saham ini (Kode PASAR sudah ada)")]:
        rows = _rows(cache, ds_id, code)
        last = max((r[0] for r in rows if r), default="-")
        print(f"{kind}: {len(rows)} baris (terakhir {last}). Butuh: {need}")
    for p in s["peers"]:
        ps = reg.get(p)
        if ps and ps["legacy"]:
            continue
        pf = _rows(cache, "saham_fund", p)
        filled = sum(1 for r in pf if len(r) > 2 and str(r[2]).strip())
        print(f"Pembanding {p}: Fundamental {filled}/{len(pf)} terisi")
    return 0


def write(path: Path, dry_run: bool) -> int:
    draft = json.loads(path.read_text(encoding="utf-8"))
    code = str(draft.get("code", "")).strip().upper()
    if not stocks.CODE_RE.match(code):
        print("Draft harus punya \"code\" (empat huruf).")
        return 1
    blocks = {}
    for kind, ds_id in TABS.items():
        rows = draft.get(kind) or []
        out = []
        for r in rows:
            r = ["" if v is None else str(v).strip() for v in r]
            if len(r) != WIDTH[kind]:
                print(f"{kind}: setiap baris butuh {WIDTH[kind]} kolom, ini {len(r)}: {r}")
                return 1
            if kind == "fund":   # Kode, Kunci, (Keterangan kept), Nilai, (Satuan kept), Catatan
                out.append([code, r[0], "", r[1], "", r[2]])
            else:
                out.append([code] + r)
        if out:
            blocks[ds_id] = out
    for ds_id, rows in blocks.items():
        print(f"{ds_id}: {len(rows)} baris")
        for r in rows[:40]:
            print("   ", " | ".join(r))
    if dry_run or not blocks:
        print("(dry run: tidak ada yang ditulis)" if dry_run else "Draft kosong.")
        return 0

    from backend.service import Service
    from backend.sheets import GoogleSheets

    class Print:
        def step(self, t): print("·", t)
        def warn(self, t): print("!", t)
        def count(self, *a): pass

    from backend.drive import GoogleDrive

    cache = Cache()
    google = GoogleSheets()
    cfg = stocks.with_stock_datasets(load_config(), cache)
    drive = GoogleDrive(google) if (cfg.drive_folder and google.status().get("drive")) else None
    if drive is None:
        print("! Google Drive belum terhubung: disimpan lokal saja, diunggah saat Tarik/Sinkron berikutnya.")
    svc = Service(cfg, cache, google, drive)
    for ds_id, rows in blocks.items():
        out = svc.upsert_many(ds_id, rows, progress=Print(), push=False)
        acts = {}
        for r in out["results"]:
            acts[r["action"]] = acts.get(r["action"], 0) + 1
        print(f"{ds_id}: {out['cells_written']} sel ditulis {acts}")
    svc.sync_push(Print())
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("todo"); t.add_argument("code")
    w = sub.add_parser("write"); w.add_argument("path", type=Path); w.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    return todo(a.code) if a.cmd == "todo" else write(a.path, a.dry_run)


if __name__ == "__main__":
    sys.exit(main())
