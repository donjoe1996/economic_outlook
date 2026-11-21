---
name: stock-data
description: Research and fill an Indonesian stock's rows in the app's data store (JSON in Google Drive; fundamentals, year-end history, dividends, foreign flows) so its stock page (stock.html?tk=CODE) can show valuation and dividend analysis. Use when the user asks to fill, complete, update or research data for a stock code (e.g. "isi data saham BBRI", "lengkapi fundamental TLKM", "update dividen ADRO").
---

# Stock data (fill the data store from credible sources)

The same research also runs from the app: the **Isi dengan Claude** button on a stock's Valuasi or Dividen tab (backend/ai.py), which proposes rows for review. Use this skill when the user asks in Claude Code, or wants foreign-flow rows (the button does not research flows).

The page reads only the data store (data/store/, mirrored to the Drive folder). Your job is to put **verified numbers with their source** into it. Never invent a number: a blank cell is honest, a guessed one is not.

Python: `.venv/bin/python` (Windows: `.venv\Scripts\python`); if there's no `.venv`, use `python3`.

## Steps

1. **What's missing:** `<python> scripts/stock_rows.py todo CODE`. It lists blank Fundamental keys (with unit), and how many history, dividend and flow rows exist, plus the peers' gaps. If the stock isn't registered, tell the user to open `stock.html?tk=CODE` and press **Tambahkan** first.
2. **Research, in this order of trust:**
   1. The issuer's own filings: audited financial statements and annual reports on **idx.co.id** (Laporan Keuangan & Tahunan, Keterbukaan Informasi) or the company's investor-relations site.
   2. Regulators and market infrastructure: **OJK** (bank statistics), **BEI/IDX** statistics (foreign net flow, corporate actions), **KSEI**.
   3. Established financial press (Kontan, Bisnis Indonesia, CNBC Indonesia, Katadata) **only** to locate a figure or when no primary source publishes it (typically daily or weekly foreign flows). Name the outlet and its cited source.

   Never use Wikipedia. Avoid aggregator sites and AI-written pages. If two sources disagree, prefer the filing and note the other in Catatan.
3. **Units, exactly as the template says:**
   - `Rp T` = trillions, `miliar` = billions of shares, `%` as a number (18.8, not 0.188), `Rp` per share.
   - Use a dot for decimals and no thousands separators.
   - Profit and equity are **attributable to the parent**.
   - Per-share figures must be restated for stock splits, so older years match today's share count. Say so in the source.
   - `fy_last` is the last full year with an annual report; the per-year keys (`dps_fy2025`, `payout_fy2025`) refer to it.
   - `profit_growth`: put the **period first** in Catatan, e.g. `H1 2026; Laporan keuangan H1 2026 (idx.co.id)`. The page shows that label.
4. **Write the draft** to `data/stocks/CODE.json` (shape in the docstring of `scripts/stock_rows.py`):
   - `fund`: `[kunci, nilai, catatan]`
   - `fh`: `[tanggal, bvps, eps, dps, sumber]`, one row per year end, `YYYY-12-31`, 2016 onwards when available.
   - `dv`: `[tanggal bayar, tahun buku, interim|final, per saham, catatan]`
   - `flow`: `[mulai, selesai, stk_day|stk_week, net Rp miliar, basis, reported|derived, sumber, catatan]`. Basis is `regular`, `all` or `unspecified`. Negative means net selling.
   - Every row carries its source. Fill the peers' core keys too if the user asked, with the same rules.
5. **Check, then write:**
   - `<python> scripts/stock_rows.py write data/stocks/CODE.json --dry-run`: read the printout and fix units that look wrong (e.g. ROE 0.19, equity in billions).
   - Then run it without `--dry-run`. It saves to data/store/ and uploads the changed files to Drive (needs the app's Google sign-in with Drive access; otherwise they upload on the next Tarik).
   - Rows are matched by key (Kode + Kunci / Tanggal / Jenis), so running it again updates instead of duplicating.
6. **Reply in ≤ 6 lines:**
   - what you filled (counts per tab);
   - what stayed blank and why (not published, sources disagree);
   - the 2–3 main sources;
   - a reminder to press **⟳ Tarik** on the stock page.

   No buy/sell opinion.
