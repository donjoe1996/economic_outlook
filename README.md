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

## The interface

The layout borrows a market terminal's discipline and Apple's typography.
Read it top-down:

| Zone | What it answers |
|---|---|
| **Monitor** (top strip) | What moved? 13 key series, each with its latest value, change and a 12-month line. Click a tile to jump to its section |
| **Sinyal keputusan** | What does it mean? The verdict each section already computes, side by side (world, US, Indonesia, BI, market, mining, readiness) |
| **Insight dari Claude** | Why? The current written reading (see the Claude skill below) |
| **Function rail** (left) | Where is it? Function codes such as MAP, WRLD, BI, CRED and MKT; the active one is highlighted |

- **Colour means one thing only.** Green or red means *good or bad for
  Indonesian equities*, not up or down. A weaker Rupiah (USD/IDR ▲) is red; a
  lower BI Rate (▼) is green. The arrow still shows the raw direction.
- **Jump anywhere:** press `/` or ⌘K/Ctrl+K and type a code (`CRED`) or an
  indicator (`pmi`, `batu bara`, `sbn`), then Enter.
- **Theme:** ☀/☾ in the toolbar switches between dark (default) and light.
  The choice is remembered.
- The look lives in `frontend/css/terminal.css` (tokens at the top) and the
  behaviour in `frontend/js/terminal.js`. Chart code is unchanged.

## Connect Google Sheets (one time, about 10 minutes)

The app signs in **as you** (OAuth). That needs two files:

| File | What it is | Who makes it |
|---|---|---|
| `secrets/credentials.json` | The app's identity ("I am the economic-outlook desktop app") | You, once, in Google Cloud Console (Part A) |
| `secrets/token.json` | Your permission ("this account allows the app to edit its Sheets") | The app, when you click **Hubungkan Google** (Part B) |

The menu names below match Google Cloud Console as of November 2026, where
the OAuth settings live under **Google Auth Platform**. Older layouts put the
same settings under *APIs & Services → OAuth consent screen / Credentials*.

### Part A: register the app in Google Cloud

1. **Project.** At https://console.cloud.google.com/, sign in with the Gmail
   account that owns the Sheet. Open the project picker (top bar), click
   **New project**, name it e.g. `economic-outlook`, and click **Create**.
   Check that the top bar shows this project.
2. **Sheets API.** Go to Menu ☰ → *APIs & Services* → **Library**. Search
   for **Google Sheets API** and click **Enable**.
3. **Google Auth Platform.** Search for "Google Auth Platform" in the top
   bar, or find it under *APIs & Services*. The left menu shows
   *Overview, Branding, Audience, Clients, Data Access, Verification Center, Settings*.
   - **Get started / Branding:** app name `economic-outlook` and your
     email as the support and contact address.
   - **Audience:** user type **External**. "Internal" only exists for
     company Workspace accounts.
4. **Add yourself as a test user (easy to miss).** Go to **Audience** →
   **Test users** → **+ Add users**, type your Gmail address, press Enter,
   and click **Save**.
   While the app is in *Testing*, Google lets in **only** the accounts on
   this list. Being the project owner does not count. Skip this step and
   sign-in fails with *"Access blocked … Error 403: access_denied"*.
5. **Clients.** Click **+ Create client**. Choose application type
   **Desktop app**, give it any name, and click **Create**. Then click
   **Download JSON**.
6. Put the file in this project as `secrets/credentials.json`. Create the
   `secrets` folder next to `run.py`, and rename the downloaded
   `client_secret_….json`. If you see `credentials.json.json`, the name is
   wrong (macOS hides `.json` endings).

### Part B: sign in from the app

1. Restart the app (Ctrl+C, then `./start.sh`). The toolbar should say
   **Google: belum masuk** (not signed in), not *belum disiapkan* (not set up).
2. Click **Hubungkan Google**. A browser tab opens.
3. *"Google hasn't verified this app"* is expected for a personal app that
   nobody has reviewed. Click **Advanced** →
   **Go to economic-outlook (unsafe)**.
4. On the permissions screen, **tick the Google Sheets checkbox**, then
   click **Continue**. If it stays unticked, sign-in "succeeds" but every
   read fails with a permission error.
5. The progress panel shows *Membaca dari Google Sheet … 0/27 → 27/27*
   (reading from Google Sheet), and the charts fill in.

`secrets/` is git-ignored, so it never goes to GitHub. To sign out, delete
`secrets/token.json`.

### If something goes wrong

| What you see | Cause | Fix |
|---|---|---|
| Red message: *credentials.json belum ada* | Part A not done, or the file is misnamed or in the wrong folder | Check `secrets/credentials.json` |
| Google page: *Access blocked … Error 403: access_denied* | Your Gmail isn't a test user | Part A step 4, then restart the app and try again |
| Progress keeps waiting on *Menunggu persetujuan Anda di tab browser* | You closed the Google tab, or Google blocked you on its own page. Google never reports back to the app | It gives up by itself after 5 minutes, or restart the app |
| Pull fails with a permission error right after signing in | The Sheets checkbox wasn't ticked | Delete `secrets/token.json`, then sign in again and tick it |
| You have to sign in again about every 7 days | In *Testing* mode, Google expires sign-ins after 7 days | Click **Hubungkan Google** again, or Audience → **Publish app**. For a personal app you don't need Google's review; you'll just keep seeing the "unverified" warning |
| *Error 400: redirect_uri_mismatch* | The client is not a **Desktop app** | Create a new client of type Desktop app and replace `credentials.json` |

**Where the project lives matters.** `credentials.json` and especially
`token.json` are keys to *all* your Google Sheets. Git keeps them off GitHub,
but a Google Drive or Dropbox–synced folder uploads them anyway. A normal
local folder (e.g. `~/Projects/economic_outlook`) is safer.

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
| **Aktivitas** | Recent jobs with every step and how long it took |
| **Metadata** | Opens the Metadata page (below) |

Slow actions run as **background jobs** on the server (`backend/jobs.py`).
The page shows a progress bar under the toolbar: the current step, how many
datasets are done (the Sheet is read in batches of 4), and the elapsed time.
*Rincian* lists every step. If you reload the page mid-job, the progress
panel picks the job back up.

Each dataset has a **write mode** in `datasets.yaml`:

- `append`: the tab holds one table, so new periods go below the last row.
- `fill`: the tab stacks several tables, so the app only fills rows that
  already exist (e.g. the empty Apr'26 foreign flow), or it would overwrite
  the next table.
- `none`: read-only. Use it for formula-driven tabs (the `GOOGLEFINANCE`
  stock tabs) and one-off snapshots.

The app writes only the cells you filled in, one by one. A formula in another
column of the same row (e.g. column H in the SBN table) is never overwritten.

## Metadata page: what is current, what needs updating

`metadata.html` (toolbar: **Metadata**) lists every dataset with:

- the **newest period in your Sheet** vs the **newest period that should be
  published by now**;
- **blank periods** (e.g. Apr'26 foreign flow);
- when its content **last changed**, when it was **last pulled**, and whether
  the last pull or automatic check **failed**;
- links to the exact Sheet tab and to the publisher's release page.

The idea behind "should be published by now": a figure for period P can only
exist after P ends *and* the publisher has had time to release it. So each
dataset has a `frequency` and a `lag_days` in `config/datasets.yaml`:

> expected = newest P with end(P) + lag_days ≤ today

Irregular data (yields quoted on random dates) uses `stale_after_days`
instead; one-off tables are marked as snapshots. **The lags are approximate
assumptions:** check them against the BPS, BI and OJK release calendars and
adjust them in the YAML.

## When something fails

One failing source must not sink the whole run:

| Failure | What the app does |
|---|---|
| Timeout, dropped connection, 429/5xx | Retries 3 times, waiting 1 s, then 2 s |
| Bad input, missing permission | Stops at once (retrying can't help) |
| One tab in a batch keeps failing | Tries the batch's datasets one by one, so the neighbours still load |
| A dataset still fails | Keeps its **previous copy** and records the error on the Metadata page |
| Result | The job ends **"Selesai dengan N peringatan"** (done with N warnings): amber bar plus the list of what was skipped |

**FRED timeouts.** FRED's CSV download (used without a key) can be slow or
throttled for scripts. The official API is more reliable:

1. Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html.
2. Save it as `secrets/fred_api_key.txt` (one line), or set the environment
   variable `FRED_API_KEY`.

With a key, the app uses the API first and falls back to the CSV download.

## Stock markets: IHSG vs Asia and IHSG vs Global

Both map views come from tabs with `GOOGLEFINANCE` formulas, filled with
each month's last close. **Saham Global** holds S&P 500 (New York),
FTSE 100 (London), DAX (Frankfurt), CAC 40 (Paris), Nikkei 225 (Tokyo),
Hang Seng, CSI 300 (Shanghai + Shenzhen), and the USD ETFs URTH (MSCI World)
and EIDO (Indonesia in dollars). To add a month, copy the last formula row
down; the open-ended range picks it up.

The views share one implementation (`EO_MKT` in `01-core.js`). A new view,
say "IHSG vs Emerging", is one more entry: a country list, a dataset, a zoom
box and a benchmark.

Things to keep in mind when reading it:

- Indices are in local currency, the ETFs in USD.
- DAX counts dividends (total return); the others don't.
- CSI 300 has no Okt'25 close in Google Finance, so it's measured from
  Nov'25 and marked with "*".

## Single-stock pages (BMRI first)

The macro dashboard asks "is the environment good for Indonesian equities?".
`stock.html?tk=BMRI` asks the next question for one stock: **at this price,
with these fundamentals, flows and dividends, what am I actually buying?**
It is reached from the rail (SAHAM → BMRI), the BMRI tile in the monitor, the
link in the "Pasar saham" panel, or by typing `bmri` in the command bar. Its
own strip of macro tiles links back to the matching dashboard section.

Four tabs, in the order an analysis should run:

| Tab | Question it answers | Main inputs |
| --- | --- | --- |
| 1. Profil | How does this stock really move? Fat tails, drawdowns, volatility clusters | daily prices |
| 2. Valuasi | Cheap or dear against its own history, its peers, and three valuation models? | fundamentals, history, peer sheet, CPI |
| 3. Arus asing | Is foreign selling exhausting? Six tests, each green/amber/red | flow tab, prices |
| 4. Dividen | Will the dividend continue, and grow? Six tests plus editable scenarios | dividend tab, EPS history |

The three valuation models (justified P/B, dividend discount, residual income
with ROE fading to a target) are deliberately simple. They exist to show which
assumption the price is sensitive to, so the sensitivity grid and "implied by
the price" cards matter more than the single average.

**Where the data lives.** Every number comes from Google Sheet tabs, read
like the macro datasets (`group: stock` in `config/datasets.yaml`):

| Dataset | Spreadsheet → tab | Holds |
| --- | --- | --- |
| `bmri_price` | BMRI → `Untitled` | daily close (GOOGLEFINANCE) |
| `bmri_fund` | BMRI → `Fundamental` | key / description / value / unit / note (ROE, NIM, CAR, shares…) |
| `bmri_fh` | BMRI → `Riwayat fundamental` | year-end BVPS, EPS, DPS |
| `bmri_dv` | BMRI → `Dividen` | every payment: date, fiscal year, interim/final, per share |
| `bmri_flow` | BMRI → `Arus asing` | foreign net flow rows (stock/market, day/week/YTD) and events |
| `bank_peers_price` | bank peers → `Untitled` | BBCA, BBRI, BMRI, BBNI closes in that column order |
| `bank_peers_fund` | bank peers → `Fundamental` | one row per bank |
| `cpi` | main → `IHK` | BPS consumer price index, for "in today's rupiah" |

New tabs were added *after* the existing first tab in each stock spreadsheet,
so anything that exports only the first tab keeps working. Add a dividend,
a flow figure or a new fundamental row in the Sheet (or through **+ Data**),
then press **⟳ Tarik** on the stock page.

**Adding another stock** (say BBRI): copy `frontend/js/stock/BMRI.js` to
`BBRI.js` and edit its names, dataset ids, valuation defaults, dividend
scenarios and narrative; add its five datasets (and its spreadsheet alias)
to `config/datasets.yaml`; add the `<script>` tag to `stock.html`; add it to
`STOCKS` in `terminal.js`. The engine (`js/stock/engine.js`) is shared; the
peer group comes from `SECT` in the engine (only `bank` so far).

Notes on this port from the prototype:

- The Monte Carlo simulation is not included yet.
- The prototype read the payout input and a stats panel from the same id
  (`vPay`), so the dividend-discount model silently used a 72% payout. The
  page now uses the payout you type (default: FY2025 payout from the
  `Fundamental` tab), so its DDM value is higher than the prototype's.
- A market event sourced only from Wikipedia was left out of the flow tab.

## Insights written by Claude (project skill)

`.claude/skills/economic-insights/` is a project-level Claude Code skill.
In Claude Code, inside this folder, ask for example *"buat insight dari data
dashboard"* ("write insights from the dashboard data"). The skill:

1. runs `scripts/digest.py`, a ~60-line fact sheet (about 2k tokens) with
   every number precomputed: levels, changes, ranges, correlations, rankings,
   overdue data. Claude never reads the raw tables;
2. writes 6–8 short insights (world → US → Indonesia → money → markets →
   credit → banks) into `data/insights/draft.json`;
3. runs `scripts/insights.py check`, which confirms that **every number in
   the text appears in the fact sheet** (allowing rounding and Indonesian
   number style). An invented number blocks publishing;
4. publishes to `data/insights/latest.json`, shown in the dashboard's
   **Insight dari Claude** panel.

The split is deliberate: Python does the arithmetic (exact and cheap), and
Claude does the interpretation (what matters, what connects).

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

## Maps

| Map | Boundaries | Source |
|---|---|---|
| Peta koneksi (world, Asia) | Countries and land, 1:50m | [Natural Earth](https://www.naturalearthdata.com/), public domain |
| Peta kredit (Indonesia) | 34 provinces | [geoBoundaries](https://www.geoboundaries.org/) IDN ADM1 (William & Mary geoLab), data © OpenStreetMap contributors, ODbL |

Both live in `data/files/` as TopoJSON. TopoJSON stores each border shared
by two neighbours once, which keeps the files small and leaves no gaps. Run
`./scripts/build_geo.sh` to rebuild them; it needs Node.js.

The credit map uses two symbols for two kinds of number:

- **Growth (a rate)** colours the province area.
- **Credit position (an amount)** sets the circle's area.

Each circle sits at the province's point from the Sheet, if that point lies
inside the province. Otherwise it moves to the province's island nearest to
that point. Three Sheet points currently fall in the sea: Bangka Belitung,
Kepulauan Riau, and NTT.

## Tests

```
.venv/bin/python -m pytest -q
```

They cover the write path, the freshness rules, the retry/skip behaviour,
and the insights number check. They use a fake in-memory Sheet, so they never
touch your real one.

## Known limits, worth thinking about

- **Narrative text is fixed.** The paragraphs in *Ringkasan narasi* and some
  chart hints ("Okt'25 = 100", fixed y-axis ranges such as `yMin: 44, yMax: 56`)
  are written into the HTML. Numbers and charts update from data; prose does not.
- **Rupiah** stops at row 13 on purpose, because row 14 is a single day's rate
  rather than a monthly average.
- **Paywalled sources** (S&P Global PMI, ISM) have no free API, so they stay
  manual.
