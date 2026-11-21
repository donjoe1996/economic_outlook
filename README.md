# Indonesia Economic Outlook — local app

A local, full-stack version of the *Indonesia Economic Outlook* dashboard.
Google Sheets stays the single source of truth; the app reads it, keeps a
local copy so it opens offline, and writes new data back to it.

```
            ┌──────────── your computer ─────────────────────────────┐
            │                                                        │
 Google  ◄──┼── backend (Python, FastAPI)  ◄── frontend (HTML + D3)  │
 Sheet   ──►│     • reads ranges listed in      • the prototype's    │
            │       config/datasets.yaml          charts, unchanged  │
            │     • local copy in data/cache    • toolbar: refresh,  │
 FRED   ───►│     • writes rows you confirm       add data, updaters │
 (auto)     │                                                        │
            └────────────────────────────────────────────────────────┘
```

## Three layers, three questions

| Layer | Question it answers | Where |
|---|---|---|
| **Data source** | Which tab and cells hold each indicator? May the app write there? | `config/datasets.yaml` |
| **Data shape** | How do raw Sheet rows become named columns (`month`, `pmi`, …)? | `frontend/js/data/loaders.js` |
| **Drawing** | How is a dataset shown (chart, KPI, verdict)? | `frontend/js/sections/*.js` |

The layers only meet through `dash.data('<id>')`. That's what makes the app
easy to extend: a change in one layer doesn't ripple into the others.

## Run it

Needs Python 3.10 or newer.

- **Windows:** double-click `start.bat`
- **macOS / Linux:** `./start.sh`

On the first run this creates `.venv` and installs the packages. It then opens
http://127.0.0.1:8000. The server listens on your computer only, not on the
network.

## Connect Google Sheets (one time, about 10 minutes)

The app signs in **as you** (OAuth). Google needs an "OAuth client" that
identifies this app. Steps (from Google's official
[Sheets API Python quickstart](https://developers.google.com/workspace/sheets/api/quickstart/python)):

1. Go to https://console.cloud.google.com/ and create a project (any name).
2. *APIs & Services → Library*: enable the **Google Sheets API**.
3. *APIs & Services → OAuth consent screen*: choose **External**, fill in the
   app name and your email, and add yourself under **Test users**.
4. *APIs & Services → Credentials → Create credentials → OAuth client ID*,
   with application type **Desktop app**. Download the JSON file.
5. Save it as `secrets/credentials.json` in this folder.
6. In the app, click **Hubungkan Google**. A browser tab asks you to allow
   access. The app saves `secrets/token.json` and pulls the data.

`secrets/` is git-ignored, so never commit it. Delete `token.json` to sign out.

**No Google yet?** Download the Sheet (*File → Download → .xlsx*) and run
`.venv/bin/python scripts/import_xlsx.py <file>.xlsx`. On Windows, use
`.venv\Scripts\python` instead of `.venv/bin/python`.

## Updating data

| Toolbar button | What happens |
|---|---|
| **Tarik dari Sheet** | Reads every dataset from the Sheet into `data/cache/` |
| **Tambah / perbarui data** | Form built from the Sheet's own headers. A new period is added at the bottom; an existing period gets only the cells you filled in |
| **Cek data baru otomatis** | Asks the official sources (FRED for now) for periods newer than the Sheet's. Shows them first and writes only the rows you tick |
| **Sumber data** | Every dataset, its range, its write mode, and when it was pulled |

Each dataset has a **write mode** in `datasets.yaml`:

- `append`: the tab holds one table, so new periods go below the last row.
- `fill`: the tab stacks several tables, so the app only fills rows that
  already exist (e.g. the empty Apr'26 foreign flow), or it would overwrite
  the next table.
- `none`: read-only. Use it for formula-driven tabs (the `GOOGLEFINANCE`
  stock tabs) and one-off snapshots.

The app writes only the cells you filled in, one by one. A formula in another
column of the same row (e.g. column H in the SBN table) is never overwritten.

## Adding a new indicator

1. **Sheet:** add a tab with a header row and one row per period
   (`Periode | Nilai | Unit | Penerbit | URL sumber | Tingkat kepercayaan | Catatan`).
2. **Source:** add an entry to `config/datasets.yaml`, e.g.
   `range: "'Ekspor'!A2:G"` and `write: append`.
3. **Shape:** add a `dash.loader('ekspor', …)` in `js/data/loaders.js` that names the columns.
4. **Drawing:** draw it in a section script, or reuse the helpers in `01-core.js`
   (`drawLine`, `drawBar`).
5. Click **Tarik dari Sheet**.

**Automatic updaters** live in `backend/updaters/`. Each one is a function
that *proposes* rows. `fred.py` is the worked example (Fed Funds, US GDP).
A new source (BPS, the World Bank Pink Sheet, …) means a new file plus one line
in `REGISTRY`.

## Tests

```
.venv/bin/python -m pytest -q
```

The tests use a fake in-memory Sheet, so they never touch your real one.

## Known limits, worth thinking about

- **Narrative text is fixed.** The paragraphs in *Ringkasan narasi* and some
  chart hints ("Okt'25 = 100", fixed y-axis ranges such as `yMin: 44, yMax: 56`)
  are written into the HTML. Numbers and charts update from data; prose does not.
- **Rupiah** stops at row 13 on purpose, because row 14 is a single day's rate
  rather than a monthly average.
- **Paywalled sources** (S&P Global PMI, ISM) have no free API, so they stay
  manual.
