---
name: economic-insights
description: Write the dashboard's "Insight dari Claude" panel, a short data reading of the Indonesia Economic Outlook data (world, US, Indonesia, money flows, markets, bank credit, Bitcoin). Use when the user asks for insights, a summary or interpretation of the dashboard data, or to refresh the insight panel after new data was pulled.
---

# Economic insights (token-lean)

The dashboard's **✦ Buat insight / Perbarui insight** button does the same thing by running Claude Code headless (backend/ai.py, same rules, same number check). Use this skill when the user asks in Claude Code.

Never read `data/store/*.json` or the dashboard code. All numbers come from one compact fact sheet.

Python: `.venv/bin/python` (Windows: `.venv\Scripts\python`); if there's no `.venv`, use `python3`.

## Steps

1. **Facts:** run `<python> scripts/digest.py`. It prints ~60 lines of precomputed facts. Read only that output.
2. **Think (don't write yet).** Go top-down, as the dashboard does: world → US → Indonesia → money (rates, Rupiah, foreign flows) → stock markets (IHSG vs Asia and Global) → bank credit → Bitcoin → what it means for bank stocks. Look for:
   - **contrast** (the world rises, Indonesia falls);
   - **direction change** (a series that turned);
   - **tension** (higher rates, yet money still leaves);
   - **what is missing or overdue** (the "Kesegaran data" section).
3. **Write** `data/insights/draft.json`:
   ```json
   {"data_as_of": "Sep'26 (makro), Okt'26 (pasar)",
    "insights": [{"layer": "dunia|as|indonesia|uang|pasar|kredit|btc|bank",
                  "title": "≤ 8 kata, berisi temuan",
                  "body": "1–2 kalimat, ≤ 45 kata, angka dari fakta",
                  "evidence": "korelasi (r, n) atau catatan sumber/keterbatasan; boleh kosong"}],
    "data_gaps": ["data penting yang belum masuk dan mengubah bacaan"]}
   ```
   - 6–8 insights, in Indonesian, plain language. One idea per insight. The last one has layer `bank` (what it means for bank stocks).
   - **Use only numbers that appear in the facts.** Rounding is fine (36.8 → 37). Don't compute new numbers.
   - Bitcoin (layer `btc`, at most one insight): say whether any indicator beat "selalu naik" in the honest test (the fact sheet marks those TERUJI). An indicator that did not is context, not a signal.
   - Correlation is not causation: write "sejalan" or "berlawanan", never "menyebabkan". Mention n when you cite r.
   - Say how sure you are when the data is thin (few points, articles, partial months).
   - No buy/sell advice. The panel already says "bukan rekomendasi".
4. **Check:** `<python> scripts/insights.py check data/insights/draft.json`. Fix every TIDAK DITEMUKAN (a number not in the facts) and every MASALAH (a problem). Repeat until 0.
5. **Publish:** `<python> scripts/insights.py publish data/insights/draft.json`. The dashboard shows it after a page reload.
6. **Reply to the user in ≤ 5 lines:** the 2–3 most important findings and which data is overdue. Don't repeat the whole panel.
