"""Individual stocks: the registry, their datasets, and adding a new one.

Where the data lives
--------------------
In the data store (JSON files in the Drive folder, see backend/store.py),
one shared dataset per kind, each starting with a Kode column:

    saham_daftar  one row per stock: Kode, Nama, Sektor, Pembanding
    saham_fund    Kode, Kunci, Keterangan, Nilai, Satuan, Catatan
    saham_fh      Kode, Tanggal, BVPS, EPS, DPS, Sumber
    saham_dv      Kode, Tanggal bayar, Tahun buku, Jenis, Per saham, Catatan
    saham_flow    Kode, Mulai, Selesai, Jenis, Net, Basis, Kualitas, Sumber, Catatan
                  (Kode PASAR = whole-market rows, shown for every stock)

Prices are the one thing a Sheet still does: the price-feed spreadsheet
(alias ``saham``; created by the app the first time, id kept in
data/spreadsheets.local.json) has one "Harga KODE" tab per stock and peer
with a GOOGLEFINANCE formula. Each becomes a feed dataset harga_<kode>,
copied into the store on every pull.

Stocks that predate this (BMRI) keep their own datasets and are listed under
``stocks_legacy:`` in the YAML.
"""
from __future__ import annotations

import json
import re
import time
from datetime import date
from pathlib import Path

from .store import Store as Cache   # the data store (formerly a cache of the Sheets)
from .config import LOCAL_SPREADSHEETS_PATH, AppConfig, Dataset, SheetRange
from .jobs import NO_PROGRESS, Progress
from .retry import short_error

ALIAS = "saham"
CODE_RE = re.compile(r"^[A-Z]{4}$")          # IDX tickers are four letters
MARKET = "PASAR"                             # Kode for whole-market flow rows
SECTORS = ("bank", "umum")

TABS: dict[str, list[str]] = {
    "Daftar": ["Kode", "Nama", "Sektor (bank/umum)", "Pembanding (kode, dipisah koma)", "Catatan"],
    "Fundamental": ["Kode", "Kunci", "Keterangan", "Nilai", "Satuan", "Catatan (periode, sumber)"],
    "Riwayat fundamental": ["Kode", "Tanggal (akhir tahun)", "BVPS (Rp)", "EPS (Rp)", "DPS (Rp)", "Sumber"],
    "Dividen": ["Kode", "Tanggal bayar", "Tahun buku", "Jenis (interim/final)", "Per saham (Rp)", "Catatan"],
    "Arus asing": ["Kode", "Mulai", "Selesai", "Jenis", "Net (Rp miliar)", "Basis", "Kualitas", "Sumber", "Catatan"],
}
SHARED_IDS = {"Daftar": "saham_daftar", "Fundamental": "saham_fund", "Riwayat fundamental": "saham_fh",
              "Dividen": "saham_dv", "Arus asing": "saham_flow"}


def price_tab(code: str) -> str:
    return f"Harga {code}"


def price_id(code: str) -> str:
    return f"harga_{code.lower()}"


def price_formula(code: str) -> str:
    # Header row (Date, Close) lands in row 1, prices from row 2: the dataset reads A2:B.
    # The Saham sheet is created with the en_US locale, so arguments are
    # separated by commas and numbers come back with a decimal point.
    return f'=GOOGLEFINANCE("IDX:{code}","close",DATE(2016,1,1),TODAY(),"DAILY")'


# ------------------------------------------------------------- templates
def _fy_last(today: date | None = None) -> int:
    """Last full financial year with a published annual report (out by ~April)."""
    t = today or date.today()
    return t.year - 1 if t.month >= 4 else t.year - 2


def template_keys(sector: str, full: bool = True, today: date | None = None) -> list[tuple[str, str, str]]:
    """(Kunci, Keterangan, Satuan) rows the page reads. Peers (full=False) need fewer."""
    y = _fy_last(today)
    core = [
        ("fy_last", "Tahun buku lengkap terakhir (angka dividen dan rasio pembayaran di bawah merujuk tahun ini)", "tahun"),
        ("net_profit_ttm", "Laba bersih 12 bulan terakhir, entitas induk", "Rp T"),
        ("equity_parent", "Ekuitas entitas induk, laporan terakhir", "Rp T"),
        ("shares_out", "Jumlah saham beredar", "miliar"),
        (f"dps_fy{y}", f"Dividen per saham untuk FY{y}", "Rp"),
        (f"payout_fy{y}", f"Rasio pembayaran FY{y} (dividen ÷ laba)", "%"),
        ("roe", "Return on equity, disetahunkan", "%"),
        ("profit_growth", "Pertumbuhan laba periode terakhir vs periode sama tahun lalu (tulis periodenya di Catatan, mis. H1 2026)", "%"),
    ]
    extra_full = [
        ("dps_ttm_paid", "Dividen per saham yang dibayar dalam 12 bulan terakhir", "Rp"),
        (f"dps_fy{y - 1}", f"Dividen per saham untuk FY{y - 1}", "Rp"),
        (f"dps_fy{y - 2}", f"Dividen per saham untuk FY{y - 2}", "Rp"),
        (f"payout_fy{y - 1}", f"Rasio pembayaran FY{y - 1}", "%"),
    ]
    bank = [
        ("nim", "Net interest margin", "%"), ("npl", "Kredit bermasalah (NPL) bruto", "%"),
        ("car", "Rasio kecukupan modal (CAR)", "%"), ("loan_growth", "Pertumbuhan kredit, tahunan", "%"),
    ]
    bank_full = [
        ("lar", "Loan at risk", "%"), ("ldr", "Kredit terhadap simpanan (LDR)", "%"),
        ("cir", "Biaya terhadap pendapatan (CIR)", "%"), ("casa", "Dana murah (CASA) terhadap simpanan", "%"),
        ("deposit_growth", "Pertumbuhan simpanan, tahunan", "%"),
    ]
    umum = [
        ("net_margin", "Margin laba bersih", "%"), ("der", "Utang berbunga terhadap ekuitas", "%"),
        ("revenue_growth", "Pertumbuhan pendapatan, periode sama dengan profit_growth", "%"),
    ]
    umum_full = [("ocf_ttm", "Arus kas operasi 12 bulan terakhir", "Rp T"), ("net_cash", "Kas bersih (kas − utang berbunga); negatif bila utang lebih besar", "Rp T")]
    keys = core + (extra_full if full else [])
    if sector == "bank":
        keys += bank + (bank_full if full else [])
    else:
        keys += umum + (umum_full if full else [])
    return keys


# ------------------------------------------------------------- registry
def _cache_rows(cache: Cache, ds_id: str) -> list[list[str]]:
    doc = cache.get(ds_id)
    return [list(r) for r in (doc or {}).get("values", [])]


def parse_codes(text: str) -> list[str]:
    return [c for c in (x.strip().upper() for x in re.split(r"[,\s;/]+", str(text or ""))) if CODE_RE.match(c)]


def registry(cfg: AppConfig, cache: Cache) -> dict[str, dict]:
    """code -> {code, name, sector, peers, legacy, price_ds, fund_ds}. Legacy first."""
    out: dict[str, dict] = {}
    for code, d in (cfg.stocks_legacy or {}).items():
        out[code] = {"code": code, "name": d.get("name", code), "sector": d.get("sector", "umum"),
                     "peers": parse_codes(d.get("peers", "")), "legacy": True,
                     "price_ds": d.get("price"), "fund_ds": d.get("fund")}
    for r in _cache_rows(cache, "saham_daftar"):
        code = (r[0] if r else "").strip().upper()
        if not CODE_RE.match(code) or code in out:
            continue
        sector = (r[2] if len(r) > 2 else "").strip().lower()
        out[code] = {"code": code, "name": (r[1] if len(r) > 1 else "").strip() or code,
                     "sector": sector if sector in SECTORS else "umum",
                     "peers": [p for p in parse_codes(r[3] if len(r) > 3 else "") if p != code][:5],
                     "legacy": False, "price_ds": price_id(code), "fund_ds": "saham_fund"}
    return out


def price_codes(reg: dict[str, dict]) -> list[str]:
    """Codes that need a price tab in the Saham sheet: new stocks and their non-legacy peers."""
    codes: list[str] = []
    for s in reg.values():
        if s["legacy"]:
            continue
        for c in [s["code"]] + s["peers"]:
            if c not in codes and not (c in reg and reg[c]["legacy"]):
                codes.append(c)
    return codes


def price_dataset(cfg: AppConfig, code: str) -> Dataset:
    return Dataset(
        id=price_id(code), title=f"Harga harian {code}",
        description=f"Penutupan harian {code} dari Google Finance (IDX:{code}), tab '{price_tab(code)}' di sheet price feed.",
        range=SheetRange.parse(f"'{price_tab(code)}'!A2:B"), write="none",
        spreadsheet=cfg.spreadsheets.get(ALIAS, ""), alias=ALIAS, group="harga", source="sheet",
        frequency="irregular", stale_after_days=5,
        release="Google Finance, setiap hari bursa (formula GOOGLEFINANCE di Sheet).",
    )


def with_stock_datasets(cfg: AppConfig, cache: Cache) -> AppConfig:
    """Add one price dataset per code in the Daftar tab (and their peers)."""
    for code in price_codes(registry(cfg, cache)):
        cfg.datasets.setdefault(price_id(code), price_dataset(cfg, code))
    return cfg


def datasets_for(cfg: AppConfig, cache: Cache, code: str) -> list[str]:
    """Extra dataset ids a stock page needs beyond group=stock: its own and its peers' prices."""
    reg = registry(cfg, cache)
    s = reg.get(code.upper())
    if not s:
        return []
    out = []
    for c in [s["code"]] + s["peers"]:
        if c in reg and reg[c]["legacy"]:
            out += [x for x in (reg[c]["price_ds"], reg[c]["fund_ds"]) if x]
        else:
            out.append(price_id(c))
    return out


def summary(cfg: AppConfig, cache: Cache) -> list[dict]:
    """For menus: each stock with its latest close and how complete its data is."""
    reg = registry(cfg, cache)
    fund = _cache_rows(cache, "saham_fund")
    counts = {k: {} for k in ("saham_fh", "saham_dv", "saham_flow")}
    for ds_id in counts:
        for r in _cache_rows(cache, ds_id):
            if r:
                counts[ds_id][r[0].strip().upper()] = counts[ds_id].get(r[0].strip().upper(), 0) + 1
    out = []
    for s in reg.values():
        prices = []
        for r in _cache_rows(cache, s["price_ds"] or ""):
            try:
                prices.append((r[0], float(str(r[1]).replace(",", ""))))
            except (IndexError, ValueError):
                continue
        item = dict(s)
        if len(prices) >= 2:
            item.update(last=prices[-1][1], prev=prices[-2][1], last_date=prices[-1][0])
        if not s["legacy"]:
            mine = [r for r in fund if r and r[0].strip().upper() == s["code"]]
            item["fund_filled"] = sum(1 for r in mine if len(r) > 3 and str(r[3]).strip())
            item["fund_total"] = len(mine)
            item["fh_rows"] = counts["saham_fh"].get(s["code"], 0)
            item["dv_rows"] = counts["saham_dv"].get(s["code"], 0)
            item["flow_rows"] = counts["saham_flow"].get(s["code"], 0)
        out.append(item)
    return out


# ------------------------------------------------------------- local ids
def save_local_spreadsheet(alias: str, sid: str, path: Path = LOCAL_SPREADSHEETS_PATH) -> None:
    data = {}
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8") or "{}")
    data[alias] = sid
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


# ------------------------------------------------------------- add a stock
FEED_TITLE = "IEO Price Feed"


def ensure_tables(svc) -> None:
    """The shared stock tables, with their column names, even before any row."""
    for tab, ds_id in SHARED_IDS.items():
        ds = svc.cfg.datasets.get(ds_id)
        if ds is not None and svc.store.doc(ds_id) is None:
            svc.store.put(ds_id, header=TABS[tab], values=[], source="app", title=ds.title, key=ds.key)


def add_stock(svc, code: str, name: str = "", sector: str = "umum", peers: list[str] | None = None,
              progress: Progress = NO_PROGRESS, sleep=time.sleep, local_path: Path = LOCAL_SPREADSHEETS_PATH) -> dict:
    """Register a stock and give it everything the page reads. Safe to repeat.

    The data goes to the store (Drive JSON); only prices need a Sheet:
    1. write or update its Daftar row (store);
    2. add a "Harga KODE" tab with a GOOGLEFINANCE formula for it and each peer
       to the price-feed spreadsheet (created in your Drive the first time);
    3. add labelled, empty Fundamental rows (store), to be filled by you,
       the editor, or the "Isi dengan Claude" button;
    4. copy the whole-market foreign-flow rows (Kode PASAR) the first time;
    5. pull the prices, waiting for Google Finance to answer, and sync to Drive.
    """
    from .service import UserError  # local import: service imports nothing from here

    code = code.strip().upper()
    if not CODE_RE.match(code):
        raise UserError(f"'{code}' bukan kode saham BEI (empat huruf, mis. BBRI).")
    cfg, store, sheets = svc.cfg, svc.store, svc.sheets
    reg = registry(cfg, store)
    if code in reg and reg[code]["legacy"]:
        raise UserError(f"{code} sudah punya halaman sendiri (sheet lama). Buka stock.html?tk={code}.")
    sector = sector if sector in SECTORS else "umum"
    peers = [p for p in (peers or []) if CODE_RE.match(p) and p != code][:5]
    warnings: list[str] = []

    ensure_tables(svc)

    # 1. Daftar row
    progress.step(f"Mendaftarkan {code}")
    svc.upsert_many("saham_daftar", [[code, name.strip(), sector, ", ".join(peers), ""]], progress=progress, push=False)

    # 2. price tabs for the stock and peers that have no page of their own
    reg = registry(cfg, store)
    need = [c for c in [code] + peers if not (c in reg and reg[c]["legacy"])]
    sid = cfg.spreadsheets.get(ALIAS, "")
    new_tabs: list[str] = []
    if not sid:
        progress.step(f"Membuat spreadsheet '{FEED_TITLE}' (hanya rumus harga) di Google Drive Anda")
        new_tabs = [price_tab(c) for c in need]
        sid = sheets.create_spreadsheet(FEED_TITLE, new_tabs)
        save_local_spreadsheet(ALIAS, sid, local_path)
        cfg.set_spreadsheet(ALIAS, sid)
    else:
        tabs = sheets.tab_ids(sid)
        new_tabs = [price_tab(c) for c in need if price_tab(c) not in tabs]
        if new_tabs:
            progress.step("Menambah tab harga: " + ", ".join(new_tabs))
            sheets.add_tabs(sid, new_tabs)
    if new_tabs:
        sheets.write_cells(sid, {f"'{t}'!A1": price_formula(t[len('Harga '):]) for t in new_tabs})

    # 3. Fundamental template rows: the stock (full) and its peers (core keys)
    have = {(r[0].strip().upper(), r[1].strip()) for r in _cache_rows(store, "saham_fund") if len(r) > 1}
    rows = []
    for c, full in [(code, True)] + [(p, False) for p in need if p != code]:
        p_sector = reg.get(c, {}).get("sector", sector)
        for k, desc, unit in template_keys(p_sector, full):
            if (c, k) not in have:
                rows.append([c, k, desc, "", unit, ""])
    if rows:
        progress.step(f"Menyiapkan {len(rows)} baris Fundamental kosong untuk diisi")
        svc.upsert_many("saham_fund", rows, progress=progress, push=False)

    # 4. whole-market flows, copied once from the oldest stock page's flow data
    if not any(r and r[0].strip().upper() == MARKET for r in _cache_rows(store, "saham_flow")):
        src = [r for r in _cache_rows(store, "bmri_flow") if len(r) > 2 and not r[2].startswith(("stk_", "bmri_", "bbca_"))]
        if src:
            progress.step(f"Menyalin {len(src)} baris arus asing seluruh pasar (Kode {MARKET})")
            svc.upsert_many("saham_flow", [[MARKET] + r[:8] for r in src], progress=progress, push=False)

    # 5. prices (GOOGLEFINANCE needs a few seconds), then one sync to Drive
    with_stock_datasets(cfg, store)
    ids = [price_id(c) for c in need]
    for attempt in range(8):
        svc.refresh(ids, progress=progress)
        pending = [c for c in need if not _has_prices(store, price_id(c))]
        if not pending or any(_price_error(store, price_id(c)) for c in pending):
            break
        progress.step("Menunggu Google Finance mengisi harga: " + ", ".join(pending))
        sleep(2 + attempt)
    for c in need:
        if not _has_prices(store, price_id(c)):
            err = _price_error(store, price_id(c))
            warnings.append(f"Harga {c} belum terbaca" + (f" ({err}): Google Finance mungkin tidak mengenal IDX:{c}." if err else "; coba ⟳ Tarik sebentar lagi."))
    svc.sync_push(progress)
    for w in warnings:
        progress.warn(w)
    return {"code": code, "spreadsheet": sid, "price_tabs": new_tabs, "template_rows": len(rows), "warnings": warnings}


def _has_prices(cache: Cache, ds_id: str) -> bool:
    n = 0
    for r in _cache_rows(cache, ds_id):
        try:
            float(str(r[1]).replace(",", ""))
            n += 1
        except (IndexError, ValueError):
            pass
    return n >= 20


def _price_error(cache: Cache, ds_id: str) -> str:
    doc = cache.get(ds_id) or {}
    for r in doc.get("values", [])[:2] + [doc.get("header", [])]:
        for v in r:
            if str(v).startswith("#"):
                return str(v)
    return ""


__all__ = ["add_stock", "registry", "summary", "datasets_for", "with_stock_datasets", "template_keys",
           "price_formula", "price_id", "price_tab", "TABS", "MARKET", "short_error"]
