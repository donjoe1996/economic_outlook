# Indonesia Economic Outlook — local app

A local, full-stack version of the *Indonesia Economic Outlook* dashboard.
The data lives as **typed JSON files in a Google Drive folder** (one file per
dataset). The app keeps a local mirror so it opens instantly and works
offline, edits data in the app, and syncs both ways. Google Sheets are used
only for what they are good at: `GOOGLEFINANCE` price feeds.

```
              ┌──────────── your computer ───────────────────────────────┐
 Google   ◄──►│ backend (Python, FastAPI)        frontend (HTML + D3)    │
 Drive        │  • data/store/: one JSON per  ──► • dashboard, stock     │
 (JSON files) │    dataset, synced by md5         pages, metadata page   │
              │  • edits from forms, the table  ◄─ • table editor, forms │
 Google   ───►│    editor, updaters, Claude       • Claude buttons       │
 Sheets       │  • price feeds copied on pull                            │
 (prices)     │                                                          │
 FRED     ───►│  • Claude Code (headless): insights, research, chat      │
              └──────────────────────────────────────────────────────────┘
```

## Three layers, three questions

| Layer | Question it answers | Where |
|---|---|---|
| **Data source** | Which datasets exist, which are price feeds, how they may be edited | `config/datasets.yaml` |
| **Data shape** | How do stored rows become named columns (`month`, `pmi`, …)? | `frontend/js/data/loaders.js` |
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
| **Insight dari Claude** | Why? The current written reading, refreshed with the ✦ button (see *Claude in the app*) |
| **Tanya Claude** | Your own question, answered from the same data (chat) |
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

## Where the data lives

| What | Where | Edited by |
|---|---|---|
| Every dataset (PMI, BI Rate, flows, stock fundamentals, dividends, …) | one JSON file each in the Drive folder set under `store: drive_folder:` in `config/datasets.yaml`, mirrored in `data/store/` | the app: **＋ Data** form, **Edit tabel** on the Metadata page, FRED updater, Claude buttons |
| Prices (IHSG, sectors, global indices, every stock) | Google Sheets with `GOOGLEFINANCE` formulas (`source: sheet` in the YAML) | Google, automatically; copied into the store on every **⟳ Tarik** |
| Map shapes | `data/files/` in this repo | nobody (static) |

**The file format.** Each `<id>.json` holds a schema (column names and types:
`number`, `date`, `string`) and the rows as arrays, in the open
[Table Schema / Data Package](https://specs.frictionlessdata.io/) layout.
`datapackage.json` indexes every file with its row count and md5 hash.
Compared with reading Sheets, this changes three things:

- Values are **typed**: `16520.03` is a number, Google Finance's `11/20/2026
  16:00:00` is stored as `2026-11-20`, and an empty cell is `null`. No more
  guessing whether `93.333` means 93 or 93 thousand.
- **Calculated columns are rules, not formulas.** For example, the SBN spread
  (`= SBN − UST`) and the rotation table's stock-flow column (copied from the
  flow table) are declared under `derived:` in the YAML and recomputed on
  every save.
- **It's fast.** The page's data request dropped from ~1 MB to ~22 KB
  (compressed, about 40 ms locally). Map shapes are served once and then
  cached by the browser.

**Sync.** **⟳ Tarik** does three things in order:

1. **Download from Drive.** One folder listing, then only the files whose md5
   differs from the last sync.
2. **Pull the price feeds.** The current prices come from the Sheets into the
   store.
3. **Upload to Drive.** Only what changed here is uploaded.

Saves upload right away. The Metadata page shows *"Sama dengan Drive"* (in
sync) or which files still need uploading, and has a **Sinkron sekarang**
(sync now) button.

If a file changed both on Drive and here since the last sync, Drive wins. The
local version is kept next to it as `<id>.local-<time>.json`, so nothing is
lost. Downloads and uploads are checked against Drive's md5 before they
replace anything.

**Moving from the Sheet-based version (once):**

1. In the old version, click **⟳ Tarik** once, so the local copy has your
   latest Sheet edits.
2. In Google Cloud, enable the **Google Drive API** too (Part A, step 2
   below).
3. Update the code and restart. The first start converts the old
   `data/cache/` into `data/store/` (offline; nothing is overwritten).
4. Click **Hubungkan Google** again and approve **Drive** access. The toolbar
   says *"Google: perlu izin Drive"* (Drive permission needed) until you do.
5. Click **⟳ Tarik**. The first sync uploads every file to the Drive folder.

Your Sheets stay as they were. The price tabs keep feeding the app; the
manual tabs become a read-only archive.

## Connect Google (one time, about 10 minutes)

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
2. **Sheets and Drive APIs.** Go to Menu ☰ → *APIs & Services* →
   **Library**. Search for **Google Sheets API** and click **Enable**. Then
   do the same for **Google Drive API** (the data store is a Drive folder).
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
4. On the permissions screen, **tick both the Google Sheets and the Google
   Drive checkboxes**, then click **Continue**. If one stays unticked,
   sign-in "succeeds" but reads fail with a permission error. Google asks
   for access to your whole Drive because that is how its permissions are
   cut, but the app only reads and writes inside the data folder named in
   the YAML.
5. The progress panel shows the sync with Drive and the price feeds, and the
   charts fill in.

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
| **⟳ Tarik** | Syncs with the Drive folder and copies the latest prices from the feed Sheets (see *Where the data lives*) |
| **＋ Data** | Form built from each dataset's columns. A new period is added at the bottom; an existing period gets only the cells you filled in |
| **Edit tabel** (Metadata page) | The whole dataset as an editable table: change cells, add or delete rows, with type checks. Price feeds open read-only |
| **Cek data baru otomatis** | Asks the official sources (FRED for now) for periods newer than the stored ones. Shows them first and saves only the rows you tick |
| **Sumber data** | Every dataset, its range, its write mode, and when it was pulled |
| **Aktivitas** | Recent jobs with every step and how long it took |
| **Metadata** | Opens the Metadata page (below) |

Slow actions run as **background jobs** on the server (`backend/jobs.py`).
The page shows a progress bar under the toolbar: the current step, how many
files or feeds are done, and the elapsed time.
*Rincian* lists every step. If you reload the page mid-job, the progress
panel picks the job back up.

Each dataset has a **write mode** in `datasets.yaml`:

- `append`: new periods may be added.
- `fill`: only existing periods may be filled (a fixed table, e.g. the
  Okt'25–Sep'26 foreign-flow months). New rows go in through **Edit tabel**.
- `none`: read-only (one-off snapshots).

Price feeds (`source: sheet`) are always read-only in the app. Every save
checks the key columns (present, not duplicated) and that number columns get
numbers, then recomputes the `derived:` columns.

## Metadata page: what is current, what needs updating

`metadata.html` (toolbar: **Metadata**) lists every dataset with:

- the **newest stored period** vs the **newest period that should be
  published by now**;
- **blank periods** (e.g. Apr'26 foreign flow);
- when its content **last changed**, when it was **last pulled**, and whether
  the last pull or automatic check **failed**;
- links to the Drive folder (or, for price feeds, the exact Sheet tab) and to
  the publisher's release page;
- **Edit tabel** to edit the dataset in place (**Lihat**, view only, for
  price feeds);
- at the top, whether this computer and Drive agree, with a **Sinkron
  sekarang** (sync now) button.

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
It is reached from the **Saham individu** cards at the top of the rail (each shows
the latest close; type any code in the box below them), the BMRI tile in the monitor, the
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

BMRI's tables came from its own spreadsheets and now live in the data store
like everything else. To add a dividend, a flow figure or a fundamental row,
use **Edit tabel** on the Metadata page (or **＋ Data**); the stock page shows
it on the next load.

### Any other stock: type its code

Type a code in the **Ketik kode** box under the stock cards (or in the command
bar, e.g. `tlkm`). A stock that isn't on the list yet opens a short form:
name, sector (bank or other) and up to five peers. **Tambahkan** then:

1. writes the stock in the **Daftar** table (data store);
2. adds a **Harga KODE** tab for it and each peer to the price-feed
   spreadsheet, with a daily `GOOGLEFINANCE("IDX:KODE", ...)` formula since
   2016. The spreadsheet is created in your Drive the first time; its id is
   kept in `data/spreadsheets.local.json`, or set it under
   `spreadsheets: saham:` in the YAML. An existing *IEO Saham* sheet keeps
   serving its price tabs;
3. adds labelled, empty rows for it in **Fundamental** (bank and other sectors
   get different keys);
4. copies the whole-market foreign-flow rows (Kode `PASAR`) once from BMRI's
   flow data, so every stock has the market context.

The **Profil** tab works as soon as the prices arrive. Each other tab names
the rows it still needs, with two buttons:

- **✦ Isi dengan Claude**: Claude searches the web and proposes the missing
  figures, each with its source. You untick what you don't trust and save.
  Nothing is stored before you press **Simpan**.
- **Edit tabel**: type the figures yourself.

Every shared table starts with a **Kode** column, so one table holds all
stocks:

| Table | One row per | Columns after Kode |
| --- | --- | --- |
| Daftar | stock | Nama, Sektor (bank/umum), Pembanding, Catatan |
| Fundamental | stock × key | Kunci, Keterangan, Nilai, Satuan, Catatan (period; source) |
| Riwayat fundamental | stock × year end | Tanggal, BVPS, EPS, DPS, Sumber |
| Dividen | payment | Tanggal bayar, Tahun buku, interim/final, Per saham, Catatan |
| Arus asing | flow figure or event | Mulai, Selesai, Jenis, Net (Rp miliar), Basis, Kualitas, Sumber, Catatan |

**Let Claude fill it, from the page or from Claude Code.** The button runs
Claude Code headless (see *Claude in the app* below). In
Claude Code, ask `isi data saham BBRI`; the project skill
`.claude/skills/stock-data` follows the same source rules in three steps:

1. Run `python scripts/stock_rows.py todo BBRI` to see what is blank.
2. Research the figures from the issuer's filings (IDX, investor relations),
   then regulators (OJK, BEI, KSEI), then established press only where needed.
   It never uses Wikipedia or aggregators.
3. Write a draft to `data/stocks/BBRI.json`, check it with
   `python scripts/stock_rows.py write data/stocks/BBRI.json --dry-run`, and
   save it to the store (and Drive). Every value carries its source in
   Catatan/Sumber.

A batch of rows is one save and one upload per table.

**Hand-written commentary** is optional. A stock with its own
`frontend/js/stock/<CODE>.js` (like BMRI) uses that file's names and
narrative; every other stock gets number-driven text from
`js/stock/generic.js`. The engine (`js/stock/engine.js`) is shared.

Notes on this port from the prototype:

- The Monte Carlo simulation is not included yet.
- The prototype read the payout input and a stats panel from the same id
  (`vPay`), so the dividend-discount model silently used a 72% payout. The
  page now uses the payout you type (default: FY2025 payout from the
  `Fundamental` tab), so its DDM value is higher than the prototype's.
- A market event sourced only from Wikipedia was left out of the flow tab.

## Claude in the app: buttons and chat (through Claude Code)

The app uses **Claude Code on your computer** (the `claude` command, in
headless mode: `claude -p`), signed in with your own Claude Code login. There
is no API key, and nothing is billed beyond your Claude Code plan.
`backend/ai.py` starts it, reads its progress, and checks what comes back.

| Where | What it does | What Claude Code may use |
|---|---|---|
| **✦ Buat / Perbarui insight** (Insight panel) | Python builds the fact sheet; Claude writes the insights as JSON that must match a schema; Python checks every number. If a number is not in the facts, Claude gets one fix round; otherwise nothing is published | nothing: the facts are in the prompt |
| **✦ Isi dengan Claude** (a stock's Valuasi or Dividen tab) | Claude researches the missing figures (the issuer's reports first, then OJK and BEI, then established financial press; never blogs, forums, aggregators or Wikipedia), labels derived figures with their formula, and returns rows with sources. You untick what you don't trust; nothing is saved before **Simpan** | WebSearch and WebFetch only |
| **Tanya Claude** (chat under the Insight panel) | Ask anything about the data. Python picks the data the question is about; Claude answers in one turn, naming dataset and period; every number in the answer is checked against what was sent | nothing: the data is in the prompt |

**Setup:** install Claude Code, run `claude` once in a terminal and sign in,
then start the app from a terminal (`./start.sh`), so it can find `claude`.
If `claude` is somewhere unusual, set `CLAUDE_BIN=/path/to/claude`. Without
it, the buttons say what is missing instead of failing.

**Safety.** Claude Code runs with permission mode `dontAsk`: any tool not
listed above is refused, so it cannot run commands or edit files.

- **The buttons** run in an empty temporary folder with file reading denied.
  Text on a web page therefore can't steer the research into reading your
  files (for example `secrets/token.json`).
- **The chat** has no tools at all: it sees only the data Python put in its
  prompt.

**How the chat stays fast, cheap and accurate** (`backend/chat_context.py`):

- **Python picks the data, not the model.** Every question gets the fact sheet
  (levels, changes and correlations already computed). On top of that it
  gets only the datasets the question is about, found by keyword: "bunga" →
  BI Rate, "asingnya" → foreign flows. Each comes as its last rows. A stock
  code such as BMRI adds its price summary, fundamentals, foreign flows, and
  P/BV and P/E computed in Python. The previous question's stock carries
  over, so "lalu arus asingnya?" (and its foreign flows?) works.
- **One turn, no tools.** It uses a short system prompt instead of Claude
  Code's default prompt, a fast model (`haiku`; set `IEO_CHAT_MODEL=sonnet`
  for longer reasoning), and answers of about 120 words. The last three
  exchanges go along for context.
- **Checked numbers.** Every number in the answer is matched against the data
  that was sent (allowing rounding and Indonesian number style). Any that
  isn't found is shown under the answer as unverified, together with the
  list of datasets used.
- **Result:** about 7–9k tokens and 13–20 s per answer, against tens of
  thousands of tokens when Claude Code explored the files itself.

**Timing:** an insight run takes about 30–60 s, and a stock research run 1–3
minutes.

## Insights written by Claude (project skill)

The same insights can also come from Claude Code:
`.claude/skills/economic-insights/` is a project-level skill. In Claude Code,
inside this folder, ask for example *"buat insight dari data dashboard"*
("write insights from the dashboard data"). The skill:

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

1. **Source:** add an entry to `config/datasets.yaml` with its columns, e.g.
   `columns: [Periode, Nilai, Unit, Penerbit, URL sumber, Tingkat kepercayaan, Catatan]`,
   `write: append`, `frequency: monthly`, `lag_days: 30`.
2. **Data:** on the Metadata page, **Edit tabel** → **+ Baris**, fill in the
   rows, then **Simpan**. The first save creates `<id>.json` in the Drive folder.
3. **Shape:** add a `dash.loader('ekspor', …)` in `js/data/loaders.js` that names the columns.
4. **Drawing:** draw it in a section script, or reuse the helpers in `01-core.js`
   (`drawLine`, `drawBar`).

A price series instead? Put a `GOOGLEFINANCE` formula in a Sheet tab and
declare it with `range:` and `source: sheet`; it is copied into the store on
every **⟳ Tarik**.

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
the insights number check, adding a stock (price-feed tabs, GOOGLEFINANCE
formulas, store tables), the JSON store and its Drive sync (fake Drive), and
the Claude buttons (fake client). They use fakes for Google and Claude, so they
never touch your real Sheets, Drive or Claude account.

## Known limits, worth thinking about

- **Some chart hints are fixed.** Hints such as "Okt'25 = 100" and fixed y-axis
  ranges (`yMin: 44, yMax: 56`) are written into the HTML. Numbers and charts
  update from data; written readings come from the Insight panel and the chat.
- **Rupiah** stops at row 13 on purpose, because row 14 is a single day's rate
  rather than a monthly average.
- **Paywalled sources** (S&P Global PMI, ISM) have no free API, so they stay
  manual.
