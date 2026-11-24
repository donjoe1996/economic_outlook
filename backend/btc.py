"""Bitcoin analysis: character, context indicators, direction, decision signal.

Ported from the "Bitcoin Monte Carlo Lab" prototype, without the Monte Carlo
simulation. Everything is computed here, once, from the data store:

    btc_chain  daily on-chain metrics, Coin Metrics (price, MVRV, supply, ...)
    btc_live   daily close from Google Finance (the latest day, if newer)
    btc_m2     monthly M2 of the US, China and the euro area
    btc_etf    daily net flows of the US spot Bitcoin ETFs
    btc_spx    daily S&P 500 close

The page (frontend/js/sections/08-bitcoin.js) only draws the result, and the
Claude fact sheet (scripts/digest.py) prints from the same result, so a number
on the page and a number Claude writes come from one calculation.

The method, from first principles
---------------------------------
An indicator is only worth watching for direction if it has told us more than
the dumbest rule that works: "Bitcoin goes up". Over its history Bitcoin was
higher a year later on roughly two days in three, so any rule that mostly
says "up" scores well without knowing anything. So for every indicator:

1. State: put each past day in a state using only what was known that day
   (e.g. MVRV Z below 0 = "Murah").
2. What followed: the price change over the next 3 and 12 months, per state.
3. Walk-forward test (no peeking): once a month, call up or down
     - textbook rule: the direction the indicator's own theory predicts,
       fixed before looking at the data (e.g. "up unless MVRV Z >= 3");
     - learned rule: whatever that state did before, using only outcomes
       already known on the test date;
   and compare the hit rate with "always up" on the same dates.
4. Honesty about sample size: monthly tests with a 12-month horizon overlap,
   so 120 tests behave like about 120 * 30 / 365 = 10 independent ones. The
   noise band is sqrt(0.25 / n_eff), about +/-16 points for 10. A rule only
   counts as "teruji" (tested) if it beats "always up" by more than that.

The decision signal combines only indicators whose textbook rule passed. If
none passed, it says so: that is a finding, not a failure.
"""
from __future__ import annotations

import bisect
import math
from collections import deque
from datetime import date, timedelta

H3, H12 = 91, 365
STEP = 30                     # days between walk-forward test dates
MIN_PAST = 60                 # past outcomes needed before the learned rule may vote
HALVINGS = [date(2012, 11, 28), date(2016, 7, 9), date(2020, 5, 11), date(2024, 4, 20)]
NEXT_HALVING = date(2028, 4, 17)   # estimate: depends on how fast blocks are mined
S2F_A, S2F_B = 14.6227, 3.31954    # PlanB (2019): market cap = exp(A) * S2F^B


# ------------------------------------------------------------------ data
def _rows(store, ds_id: str) -> list[list]:
    doc = store.typed(ds_id) if store is not None else None
    return (doc or {}).get("rows", []) if doc else []


def _day(v) -> date | None:
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _num(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
        return float(v)
    try:
        x = float(str(v).replace(",", ""))
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _col(store, ds_id: str, col: int) -> dict[date, float]:
    out = {}
    for r in _rows(store, ds_id):
        d = _day(r[0]) if r else None
        v = _num(r[col]) if d and len(r) > col else None
        if d and v is not None:
            out[d] = v
    return out


def load(store) -> dict | None:
    """Daily series on one calendar, from the store. None without prices."""
    chain = {d: v for d, v in _col(store, "btc_chain", 1).items() if v > 0}
    live = {d: v for d, v in _col(store, "btc_live", 1).items() if v > 0}
    price = dict(chain)
    newest = max(chain) if chain else None
    for d, v in live.items():                # Google Finance adds the days Coin Metrics has not published yet
        if newest is None or d > newest:
            price[d] = v
    if len(price) < 400:
        return None
    days = sorted(price)
    # one row per calendar day; carry the last close over a missing day
    cal, p = [], []
    d, end, last = days[0], days[-1], None
    while d <= end:
        last = price.get(d, last)
        cal.append(d)
        p.append(last)
        d += timedelta(days=1)
    idx = {d: i for i, d in enumerate(cal)}

    def on_cal(series: dict[date, float]) -> list:
        out = [None] * len(cal)
        for d, v in series.items():
            i = idx.get(d)
            if i is not None:
                out[i] = v
        return out

    return {
        "t": cal, "p": p, "idx": idx, "src_last": "Coin Metrics" if days[-1] in chain else "Google Finance",
        "mcap": on_cal(_col(store, "btc_chain", 2)), "mvrv": on_cal(_col(store, "btc_chain", 3)),
        "sply": on_cal(_col(store, "btc_chain", 4)), "exch": on_cal(_col(store, "btc_chain", 5)),
        "hash": on_cal(_col(store, "btc_chain", 6)), "fee": on_cal(_col(store, "btc_chain", 7)),
        "adr": on_cal(_col(store, "btc_chain", 8)),
        "chain_last": newest,
        "m2": [r for r in _rows(store, "btc_m2") if r and _day(r[0])],
        "etf": sorted((_day(r[0]), _num(r[1])) for r in _rows(store, "btc_etf") if r and _day(r[0]) and len(r) > 1 and _num(r[1]) is not None),
        "spx": sorted((_day(r[0]), _num(r[1])) for r in _rows(store, "btc_spx") if r and _day(r[0]) and len(r) > 1 and (_num(r[1]) or 0) > 0),
    }


# ------------------------------------------------------------------ statistics
def quant(sorted_vals: list[float], q: float) -> float:
    pos = q * (len(sorted_vals) - 1)
    lo, hi = math.floor(pos), math.ceil(pos)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def moments(r: list[float]) -> dict:
    n = len(r)
    m = sum(r) / n
    s2 = sum((x - m) ** 2 for x in r)
    s3 = sum((x - m) ** 3 for x in r)
    s4 = sum((x - m) ** 4 for x in r)
    pv = s2 / n
    return {"n": n, "mean": m, "sd": math.sqrt(s2 / (n - 1)), "skew": (s3 / n) / pv ** 1.5, "exk": (s4 / n) / pv ** 2 - 3}


def acf1(x: list[float]) -> float:
    n = len(x)
    m = sum(x) / n
    den = sum((v - m) ** 2 for v in x)
    num = sum((x[i] - m) * (x[i - 1] - m) for i in range(1, n))
    return num / den if den else float("nan")


def sma(x: list, k: int) -> list:
    """Moving average over k days; blank while fewer than 80% of them have a value."""
    out, s, cnt = [None] * len(x), 0.0, 0
    q: deque = deque()
    for i, v in enumerate(x):
        q.append(v)
        if v is not None:
            s += v
            cnt += 1
        if len(q) > k:
            old = q.popleft()
            if old is not None:
                s -= old
                cnt -= 1
        if len(q) == k and cnt >= k * 0.8:
            out[i] = s / cnt
    return out


def pearson(a: list[float], b: list[float]) -> float:
    n = len(a)
    if n < 3:
        return float("nan")
    ma, mb = sum(a) / n, sum(b) / n
    sab = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    saa = sum((x - ma) ** 2 for x in a)
    sbb = sum((y - mb) ** 2 for y in b)
    return sab / math.sqrt(saa * sbb) if saa and sbb else float("nan")


def fwd(p: list[float], h: int) -> list:
    """Price h days later divided by price today (calendar is daily)."""
    n = len(p)
    return [p[i + h] / p[i] if i + h < n else None for i in range(n)]


def subsidy_per_day(d: date) -> float:
    if d < HALVINGS[0]:
        r = 50
    elif d < HALVINGS[1]:
        r = 25
    elif d < HALVINGS[2]:
        r = 12.5
    elif d < HALVINGS[3]:
        r = 6.25
    else:
        r = 3.125
    return r * 144


def _id(v: float, d: int = 0, sign: bool = False) -> str:
    """Indonesian number style for display text: 1.234,5 (the page is in Indonesian)."""
    t = f"{v:{'+' if sign else ''},.{d}f}"
    return t.replace(",", "_").replace(".", ",").replace("_", ".")


def _r(v, d=4):
    return None if v is None or (isinstance(v, float) and not math.isfinite(v)) else round(v, d)


# ------------------------------------------------------------------ the honesty test
def evaluate(D: dict, state: list, order: list[str], thesis_up: set[str], f3: list, f12: list) -> dict:
    """What followed each state, and the walk-forward test against 'always up'."""
    n = len(state)
    groups = {}
    for s in order + ["__all"]:
        a3, a12, eps, prev = [], [], 0, False
        for i in range(n):
            ok = (state[i] == s if s != "__all" else state[i] is not None) and f3[i] is not None
            if ok and not prev:
                eps += 1
            prev = ok
            if ok:
                a3.append(f3[i])
                if f12[i] is not None:
                    a12.append(f12[i])

        def st(v):
            if not v:
                return None
            x = sorted(v)
            return {"n": len(v), "med": _r(quant(x, .5) - 1), "lo": _r(quant(x, .1) - 1), "hi": _r(quant(x, .9) - 1),
                    "up": _r(sum(1 for z in v if z > 1) / len(v))}
        groups[s] = {"days": sum(1 for v in state if v == s) if s != "__all" else sum(1 for v in state if v), "eps": eps,
                     "s3": st(a3), "s12": st(a12)}
    groups["Semua hari"] = groups.pop("__all")

    def test(h: int, f: list) -> dict:
        past: dict[str, list[float]] = {s: [] for s in order}
        T = []
        k = 0
        for q in range(0, n, STEP):
            while k < q and k + h <= q:          # outcome of day k is known by day q
                if state[k] in past and f[k] is not None:
                    bisect.insort(past[state[k]], f[k])
                k += 1
            s = state[q]
            if s is None or f[q] is None:
                continue
            pl = past.get(s, [])
            learned = (quant(pl, .5) > 1) if len(pl) >= MIN_PAST else None
            T.append({"up": f[q] > 1, "book": s in thesis_up, "learned": learned})
        if len(T) < 8:
            return {"n": len(T)}
        L = [x for x in T if x["learned"] is not None]
        neff = max(1, round(len(T) * STEP / h))
        marg = math.sqrt(0.25 / neff)
        always = sum(x["up"] for x in T) / len(T)
        book = sum(x["book"] == x["up"] for x in T) / len(T)
        out = {"n": len(T), "neff": neff, "marg": _r(marg), "always": _r(always), "book": _r(book),
               "book_down": sum(1 for x in T if not x["book"]),
               "book_down_hit": sum(1 for x in T if not x["book"] and not x["up"]),
               "beats": book - always > marg, "worse": book - always < -marg}
        if len(L) >= 8:
            out["learned"] = _r(sum(x["learned"] == x["up"] for x in L) / len(L))
            out["learned_always"] = _r(sum(x["up"] for x in L) / len(L))
            out["learned_n"] = len(L)
        return out

    return {"groups": groups, "t3": test(H3, f3), "t12": test(H12, f12)}


def _indicator(D, ind_id, name, state, order, thesis_up, f3, f12, now_value, now_text, extra=None):
    last = next((i for i in range(len(state) - 1, -1, -1) if state[i] is not None), None)
    ev = evaluate(D, state, order, thesis_up, f3, f12)
    now = state[last] if last is not None else None
    beats = any(ev[k].get("beats") for k in ("t3", "t12"))
    out = {"id": ind_id, "name": name, "order": order, "thesis_up": sorted(thesis_up),
           "state": now, "state_date": D["t"][last].isoformat() if last is not None else None,
           "call": ("naik" if now in thesis_up else "turun") if now else None,
           "value": now_value, "value_text": now_text, "tested": beats, **ev}
    if extra:
        out.update(extra)
    return out


# ------------------------------------------------------------------ weekly series for charts
def _weekly_idx(n: int) -> list[int]:
    idx = list(range(n - 1, -1, -7))[::-1]
    return idx


def _pick(series: list, W: list[int], d: int = 4) -> list:
    return [_r(series[i], d) if series[i] is not None else None for i in W]


# ------------------------------------------------------------------ the analysis
def analysis(store) -> dict | None:
    D = load(store)
    if D is None:
        return None
    t, p = D["t"], D["p"]
    n = len(p)
    last = n - 1
    f3, f12 = fwd(p, H3), fwd(p, H12)
    W = _weekly_idx(n)
    out = {"as_of": t[last].isoformat(), "price": p[last], "price_src": D["src_last"],
           "chain_last": D["chain_last"].isoformat() if D["chain_last"] else None,
           "w": [t[i].isoformat() for i in W], "wp": _pick(p, W, 2)}

    # ---------------- 1. character
    out["char"] = {k: _character(t, p, yrs) for k, yrs in (("all", 0), ("y4", 4))}
    peak, dd = 0.0, []
    for v in p:
        peak = max(peak, v)
        dd.append(v / peak - 1)
    lr = [math.log(p[i] / p[i - 1]) for i in range(1, n)]
    vol30 = [None] * n
    s = s2 = 0.0
    for i in range(1, n):
        x = lr[i - 1]
        s += x
        s2 += x * x
        if i > 30:
            y = lr[i - 31]
            s -= y
            s2 -= y * y
        if i >= 30:
            m = s / 30
            vol30[i] = math.sqrt(max(0.0, (s2 - 30 * m * m) / 29)) * math.sqrt(365)
    out["wdd"] = _pick(dd, W)
    out["wvol"] = _pick(vol30, W)

    # ---------------- 2. indicators
    inds = []
    ma200, ma50 = sma(p, 200), sma(p, 50)
    trend = [None] * n
    for i in range(230, n):
        if ma200[i] is None or ma200[i - 30] is None:
            continue
        above, rising = p[i] > ma200[i], ma200[i] > ma200[i - 30]
        trend[i] = ("Naik" if rising else "Pulih") if above else ("Koreksi" if rising else "Turun")
    vs200 = p[last] / ma200[last] - 1
    inds.append(_indicator(D, "trend", "Tren harga (rata-rata 200 hari)", trend, ["Naik", "Pulih", "Koreksi", "Turun"],
                           {"Naik", "Pulih"}, f3, f12, _r(vs200), f"{_id(vs200 * 100, 0, True)}% dari rata-rata 200 hari",
                           {"series": {"ma200": _pick(ma200, W, 2), "ma50": _pick(ma50, W, 2)}}))

    # MVRV Z: (market value - realized value) / sd(market value up to that day, from 2011)
    z = [None] * n
    cnt, mean, m2 = 0, 0.0, 0.0
    rp = [None] * n
    for i in range(n):
        mc, mv = D["mcap"][i], D["mvrv"][i]
        if mc is None or mv is None or mv <= 0:
            continue
        if t[i] >= date(2011, 1, 1):
            cnt += 1
            dlt = mc - mean
            mean += dlt / cnt
            m2 += dlt * (mc - mean)
        if cnt >= 30:
            sd = math.sqrt(m2 / (cnt - 1))
            z[i] = (mc - mc / mv) / sd
        if D["sply"][i]:
            rp[i] = (mc / mv) / D["sply"][i]
    zone = [None if v is None else "Murah" if v < 0 else "Normal" if v < 3 else "Tinggi" if v < 7 else "Panas" for v in z]
    zi = next((i for i in range(n - 1, -1, -1) if z[i] is not None), None)
    if zi is not None:
        hi2 = max((z[i] for i in range(max(0, zi - 730), zi + 1) if z[i] is not None), default=None)
        peaks = []
        for a, b in ((2011, 2014), (2015, 2018), (2019, 2022), (2023, 2031)):
            cand = [(z[i], t[i]) for i in range(n) if z[i] is not None and a <= t[i].year <= b]
            if cand:
                zz, tt = max(cand)
                peaks.append({"z": _r(zz, 2), "t": tt.isoformat()})
        inds.append(_indicator(D, "mvrv", "Valuasi on-chain (MVRV Z)", zone, ["Murah", "Normal", "Tinggi", "Panas"],
                               {"Murah", "Normal"}, f3, f12, _r(z[zi], 2), f"Z {_id(z[zi], 2)}",
                               {"mvrv": _r(D["mvrv"][zi], 3), "realized_price": _r(rp[zi], 0), "hi2": _r(hi2, 2), "peaks": peaks,
                                "series": {"z": _pick(z, W, 2), "rp": _pick(rp, W, 0)}}))

    # Coins on exchanges: 13-week change in the share of all coins held there
    share = [(D["exch"][i] / D["sply"][i]) if D["exch"][i] and D["sply"][i] else None for i in range(n)]
    exs = [None] * n
    for i in range(91, n):
        if share[i] is not None and share[i - 91] is not None:
            d13 = share[i] - share[i - 91]
            exs[i] = "Keluar" if d13 <= -0.0025 else "Masuk" if d13 >= 0.0025 else "Stabil"
    ei = next((i for i in range(n - 1, -1, -1) if exs[i] is not None), None)
    if ei is not None:
        d13 = share[ei] - share[ei - 91]
        pk = max(range(ei + 1), key=lambda i: share[i] or 0)
        f28 = D["exch"][ei] - D["exch"][ei - 28] if D["exch"][ei - 28] is not None else None
        inds.append(_indicator(D, "exchange", "Koin di bursa (13 minggu)", exs, ["Keluar", "Stabil", "Masuk"], {"Keluar", "Stabil"},
                               f3, f12, _r(d13 * 100, 2), f"{_id(d13 * 100, 2, True)} poin persen dalam 13 minggu",
                               {"share": _r(share[ei] * 100, 2), "btc": _r(D["exch"][ei], 0), "f28": _r(f28, 0),
                                "peak_share": _r(share[pk] * 100, 2), "peak_date": t[pk].isoformat(),
                                "series": {"share": _pick([None if v is None else v * 100 for v in share], W, 3)}}))

    # ETF flows: net flow over the last 20 trading days, $ million
    if len(D["etf"]) >= 25:
        E = D["etf"]
        et = [d for d, _ in E]
        s20 = []
        for k in range(len(E)):
            s20.append(sum(v for _, v in E[k - 19:k + 1]) if k >= 19 else None)
        etf_state = [None] * n
        j = -1
        for i in range(n):
            while j + 1 < len(et) and et[j + 1] <= t[i]:
                j += 1
            if j >= 0 and s20[j] is not None and (t[i] - et[j]).days <= 5:
                v = s20[j]
                etf_state[i] = "Masuk kuat" if v >= 1000 else "Keluar kuat" if v <= -1000 else "Campuran"
        L = len(E) - 1
        streak, sg = 0, (E[L][1] > 0) - (E[L][1] < 0)
        for k in range(L, -1, -1):
            if sg and ((E[k][1] > 0) - (E[k][1] < 0)) == sg:
                streak += 1
            else:
                break
        months = {}
        for d, v in E:
            months[d.strftime("%Y-%m")] = months.get(d.strftime("%Y-%m"), 0) + v
        inds.append(_indicator(D, "etf", "Arus ETF spot AS (20 hari bursa)", etf_state, ["Masuk kuat", "Campuran", "Keluar kuat"],
                               {"Masuk kuat", "Campuran"}, f3, f12, _r(s20[L], 0), f"US${_id(s20[L], 0, True)} juta",
                               {"last_day": E[L][0].isoformat(), "last": _r(E[L][1], 1), "s5": _r(sum(v for _, v in E[-5:]), 0),
                                "cum": _r(sum(v for _, v in E), 0), "streak": streak * (sg or 1),
                                "monthly": [{"m": k, "v": _r(v, 0)} for k, v in sorted(months.items())[-12:]],
                                "daily": {"t": [d.isoformat() for d in et], "s20": [_r(v, 0) for v in s20]}}))

    # Global liquidity: combined M2 (US + China + euro area) in dollars, growth vs a year ago
    liq = _liquidity(D, t, p, n)
    if liq:
        inds.append(_indicator(D, "liquidity", "Likuiditas global (M2 AS+China+euro)", liq["state"], ["Meluas", "Datar", "Menyusut"],
                               {"Meluas", "Datar"}, f3, f12, liq["g_now"], liq["text"], liq["extra"]))

    # Stock-to-flow (PlanB): supply / coins mined in the last 365 days
    sf_ratio, sf_model, sf_now = [None] * n, [None] * n, None
    for i in range(365, n):
        s_now, s_then = D["sply"][i], D["sply"][i - 365]
        if not s_now or not s_then or s_now <= s_then:
            continue
        sf = s_now / (s_now - s_then)
        model = math.exp(S2F_A) * sf ** S2F_B / s_now
        sf_model[i], sf_ratio[i], sf_now = model, p[i] / model, (sf, model)
    sfs = [None if v is None else "Jauh di bawah" if v < 0.25 else "Di bawah" if v < 1 else "Di atas" for v in sf_ratio]
    si = next((i for i in range(n - 1, -1, -1) if sf_ratio[i] is not None), None)
    if si is not None:
        inds.append(_indicator(D, "s2f", "Kelangkaan (stock-to-flow, PlanB)", sfs, ["Jauh di bawah", "Di bawah", "Di atas"],
                               {"Jauh di bawah", "Di bawah"}, f3, f12, _r(sf_ratio[si], 3), f"harga {_id(sf_ratio[si], 2)}× model",
                               {"sf": _r(sf_now[0], 1), "model": _r(sf_now[1], 0), "next_halving": NEXT_HALVING.isoformat(),
                                "series": {"model": _pick(sf_model, W, 2)}}))

    # Hash rate: 30-day average vs six months earlier
    hr30 = sma(D["hash"], 30)
    hrs = [None] * n
    for i in range(182, n):
        if hr30[i] and hr30[i - 182]:
            g = hr30[i] / hr30[i - 182]
            hrs[i] = "Tumbuh" if g > 1.1 else "Menyusut" if g < 0.9 else "Datar"
    hi_ = next((i for i in range(n - 1, -1, -1) if hrs[i] is not None), None)
    if hi_ is not None:
        g6 = hr30[hi_] / hr30[hi_ - 182]
        hp = [p[i] * subsidy_per_day(t[i]) / hr30[i] if hr30[i] else None for i in range(n)]
        hist = sorted(v for i, v in enumerate(hp) if v is not None and t[i] >= date(2016, 1, 1))
        rank = sum(1 for v in hist if v <= hp[hi_]) / len(hist) if hist and hp[hi_] else None
        peak = max(v for v in hr30 if v)
        inds.append(_indicator(D, "hashrate", "Hash rate penambang (6 bulan)", hrs, ["Tumbuh", "Datar", "Menyusut"], {"Tumbuh", "Datar"},
                               f3, f12, _r(g6 - 1), f"{_id((g6 - 1) * 100, 0, True)}% dalam 6 bulan",
                               {"eh": _r(hr30[hi_], 1), "peak": _r(peak, 1), "hashprice": _r(hp[hi_], 0), "hashprice_rank": _r(rank, 3),
                                "series": {"hr": _pick(hr30, W, 2)}}))

    # Puell multiple: miners' daily issuance in dollars vs its one-year average
    iss = [p[i] * subsidy_per_day(t[i]) for i in range(n)]
    avg365 = sma(iss, 365)
    puell = [iss[i] / avg365[i] if avg365[i] else None for i in range(n)]
    pst = [None if v is None else "Rendah" if v < 0.5 else "Tinggi" if v > 4 else "Normal" for v in puell]
    inds.append(_indicator(D, "puell", "Pendapatan penambang (Puell multiple)", pst, ["Rendah", "Normal", "Tinggi"], {"Rendah", "Normal"},
                           f3, f12, _r(puell[last], 2), f"Puell {_id(puell[last], 2)}",
                           {"series": {"puell": _pick(puell, W, 3)},
                            "fee_share": _fee_share(D, p, t, n)}))

    # Network use: active addresses, 30-day average vs a year earlier
    adr30 = sma(D["adr"], 30)
    ads = [None] * n
    for i in range(365, n):
        if adr30[i] and adr30[i - 365]:
            g = adr30[i] / adr30[i - 365]
            ads[i] = "Tumbuh" if g > 1.1 else "Menyusut" if g < 0.9 else "Datar"
    ai = next((i for i in range(n - 1, -1, -1) if ads[i] is not None), None)
    if ai is not None:
        g = adr30[ai] / adr30[ai - 365]
        inds.append(_indicator(D, "activity", "Pemakaian jaringan (alamat aktif)", ads, ["Tumbuh", "Datar", "Menyusut"], {"Tumbuh", "Datar"},
                               f3, f12, _r(g - 1), f"{_id((g - 1) * 100, 0, True)}% dibanding setahun lalu",
                               {"adr": _r(adr30[ai], 0), "series": {"adr": _pick(adr30, W, 0)}}))

    # US stock market mood: S&P 500 trend, and how closely Bitcoin moves with it
    spx = _spx(D, t, p, n, W)
    if spx:
        inds.append(_indicator(D, "spx", "Suasana saham AS (S&P 500)", spx["state"], ["Naik", "Pulih", "Koreksi", "Turun"], {"Naik", "Pulih"},
                               f3, f12, spx["corr_now"], spx["text"], spx["extra"]))

    out["indicators"] = inds
    out["direction"] = _direction(t, p, dd, trend, ma50, ma200, f3, f12)
    out["verdict"] = _verdict(inds, out["direction"])
    return out


def _character(t, p, yrs):
    n = len(p)
    i0 = 0
    if yrs:
        cut = t[-1] - timedelta(days=round(yrs * 365.25))
        i0 = next(i for i in range(n) if t[i] >= cut)
    pp, tt = p[i0:], t[i0:]
    r = [math.log(pp[i] / pp[i - 1]) for i in range(1, len(pp))]
    m = moments(r)
    ext = sum(1 for x in r if abs(x - m["mean"]) > 3 * m["sd"])
    peak, pk_i, mdd, longest, cur = pp[0], 0, 0.0, 0, 0.0
    for i, v in enumerate(pp):
        if v >= peak:
            longest = max(longest, i - pk_i)
            peak, pk_i = v, i
            cur = 0.0
        else:
            cur = v / peak - 1
            mdd = min(mdd, cur)
    longest = max(longest, len(pp) - 1 - pk_i)
    # histogram of daily log returns, and what a bell curve with the same mean and sd expects
    lo, hi = m["mean"] - 6 * m["sd"], m["mean"] + 6 * m["sd"]
    bins = 48
    w = (hi - lo) / bins
    cnt = [0] * bins
    clipped = 0
    for x in r:
        k = int((x - lo) / w)
        if 0 <= k < bins:
            cnt[k] += 1
        else:
            clipped += 1
    normal = []
    for k in range(bins):
        mid = lo + (k + .5) * w
        zz = (mid - m["mean"]) / m["sd"]
        normal.append(round(len(r) * w * math.exp(-zz * zz / 2) / (m["sd"] * math.sqrt(2 * math.pi)), 2))
    years = []
    by: dict[int, list[int]] = {}
    for i, d in enumerate(tt):
        by.setdefault(d.year, []).append(i)
    for y, ix in sorted(by.items()):
        if len(ix) < 20:
            continue
        a, b = ix[0], ix[-1]
        base = pp[a - 1] if a > 0 else pp[a]
        rr = [math.log(pp[i] / pp[i - 1]) for i in range(max(a, 1), b + 1)]
        if len(rr) < 10:
            continue
        years.append({"y": y, "chg": _r(pp[b] / base - 1), "vol": _r(moments(rr)["sd"] * math.sqrt(365)), "partial": len(ix) < 300})
    return {
        "from": tt[0].isoformat(), "to": tt[-1].isoformat(), "days": len(pp),
        "sd": _r(m["sd"], 5), "ann_vol": _r(m["sd"] * math.sqrt(365)), "growth": _r(math.exp(m["mean"] * 365) - 1),
        "exk": _r(m["exk"], 2), "skew": _r(m["skew"], 2), "ext": ext, "ext_ratio": _r((ext / m["n"]) / 0.0027, 2),
        "ext_expected": _r(m["n"] * 0.0027, 1), "worst": _r(math.exp(min(r)) - 1), "best": _r(math.exp(max(r)) - 1),
        "mdd": _r(mdd), "longest": longest, "cur_dd": _r(cur), "ac_abs": _r(acf1([abs(x) for x in r]), 3), "ac_r": _r(acf1(r), 3),
        "hist": {"lo": _r(lo, 5), "w": _r(w, 6), "cnt": cnt, "normal": normal, "clipped": clipped}, "years": years,
    }


def _fee_share(D, p, t, n):
    """Share of miners' income from fees, last 30 days (the network's future security budget)."""
    fees = [(D["fee"][i], p[i] * subsidy_per_day(t[i])) for i in range(max(0, n - 30), n) if D["fee"][i] is not None]
    if len(fees) < 10:
        return None
    f = sum(a for a, _ in fees)
    return _r(f / (f + sum(b for _, b in fees)), 4)


def _liquidity(D, t, p, n):
    rows = D["m2"]
    # a month counts only with all five numbers: one missing part would fake a drop
    mk = {}
    for r in rows:
        d = _day(r[0])
        us, cn, fxc, eu, fxe = [_num(r[i]) if len(r) > i else None for i in range(1, 6)]
        if us and cn and fxc and eu and fxe:
            mk[(d.year, d.month)] = us + cn / fxc + eu * fxe
    if len(mk) < 40:
        return None
    keys = sorted(mk)
    g = {}
    for y, m in keys:
        prev = mk.get((y - 1, m))
        if prev:
            g[(y, m)] = mk[(y, m)] / prev - 1
    gk = sorted(g)
    reg = {}
    for i, k in enumerate(gk):
        win = [g[x] for x in gk[max(0, i - 119):i + 1]]
        if len(win) < 36:
            continue
        avg = sum(win) / len(win)
        y, m = k
        back = (y, m - 3) if m > 3 else (y - 1, m + 9)
        if back not in g:
            continue
        dl = g[k] - g[back]
        gv = g[k]
        if gv < 0:
            reg[k] = "Menyusut"
        elif abs(dl) < 0.005 and (abs(gv - avg) <= 0.01 or gv < 0.01):
            reg[k] = "Datar"
        elif dl > 0 or gv > avg:
            reg[k] = "Meluas"
        else:
            reg[k] = "Menyusut"
    if not reg:
        return None
    # known on a day = the newest month that ended at least 30 days earlier (publication lag)
    state = [None] * n
    rk = sorted(reg)
    j = -1
    for i in range(n):
        while j + 1 < len(rk):
            y, m = rk[j + 1]
            end = date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)
            if end + timedelta(days=30) <= t[i]:
                j += 1
            else:
                break
        if j >= 0:
            state[i] = reg[rk[j]]
    # lead-lag: monthly M2 growth vs Bitcoin's yearly log return, M2 shifted -12..+12 months
    month_close = {}
    for i in range(n):
        month_close[(t[i].year, t[i].month)] = p[i]
    by = {}
    for (y, m), v in month_close.items():
        prev = month_close.get((y - 1, m))
        if prev:
            by[(y, m)] = math.log(v / prev)
    lags = []
    for L in range(-12, 13):
        a, b = [], []
        for k in gk:
            y, m = k
            idx = y * 12 + m - 1 + L
            kk = (idx // 12, idx % 12 + 1)
            if kk in by:
                a.append(g[k])
                b.append(by[kk])
        lags.append({"lag": L, "r": _r(pearson(a, b), 3), "n": len(a)})
    last_k = rk[-1]
    gl = g[last_k]
    return {"state": state, "g_now": _r(gl), "text": f"{_id(gl * 100, 1, True)}% setahun (per {last_k[0]}-{last_k[1]:02d})",
            "extra": {"month": f"{last_k[0]}-{last_k[1]:02d}",
                      "monthly": {"t": [f"{y}-{m:02d}" for y, m in gk], "g": [_r(g[k]) for k in gk],
                                  "reg": [reg.get(k) for k in gk]},
                      "lags": lags, "last_full": f"{keys[-1][0]}-{keys[-1][1]:02d}"}}


def _spx(D, t, p, n, W):
    S = D["spx"]
    if len(S) < 260:
        return None
    sd, sp = [d for d, _ in S], [v for _, v in S]
    ma = sma(sp, 200)
    st_s = [None] * len(sp)
    for k in range(221, len(sp)):
        if ma[k] and ma[k - 21]:
            above, rising = sp[k] > ma[k], ma[k] > ma[k - 21]
            st_s[k] = ("Naik" if rising else "Pulih") if above else ("Koreksi" if rising else "Turun")
    state = [None] * n
    j = -1
    for i in range(n):
        while j + 1 < len(sd) and sd[j + 1] <= t[i]:
            j += 1
        if j >= 0 and (t[i] - sd[j]).days <= 5:
            state[i] = st_s[j]
    # rolling 90-trading-day correlation of daily log returns (Bitcoin on S&P trading days)
    idx = {d: i for i, d in enumerate(t)}
    rb, rs, ts = [], [], []
    for k in range(1, len(sd)):
        a, b = idx.get(sd[k - 1]), idx.get(sd[k])
        if a is None or b is None:
            continue
        rb.append(math.log(p[b] / p[a]))
        rs.append(math.log(sp[k] / sp[k - 1]))
        ts.append(sd[k])
    cx, cy = [], []
    for e in range(90, len(rb) + 1, 5):
        cx.append(ts[e - 1].isoformat())
        cy.append(_r(pearson(rb[e - 90:e], rs[e - 90:e]), 3))
    if not cy:
        return None
    now = pearson(rb[-90:], rs[-90:])
    avg = sum(v for v in cy if v is not None) / len([v for v in cy if v is not None])
    k = len(sp) - 1
    r6 = sp[k] / sp[max(0, k - 126)] - 1
    return {"state": state, "corr_now": _r(now, 2), "text": f"korelasi 90 hari {_id(now, 2)}",
            "extra": {"spx": _r(sp[k], 2), "spx_date": sd[k].isoformat(), "r6": _r(r6), "corr_avg": _r(avg, 2),
                      "corr": {"t": cx, "v": cy}, "spx_state": st_s[k]}}


def _direction(t, p, dd, trend, ma50, ma200, f3, f12):
    n = len(p)
    last = n - 1

    def back(days):
        return p[last] / p[last - days] - 1 if last - days >= 0 else None

    ath_i = max(range(n), key=lambda i: p[i])
    out = {"state": trend[last], "vs200": _r(p[last] / ma200[last] - 1) if ma200[last] else None,
           "slope": _r(ma200[last] / ma200[last - 30] - 1) if ma200[last] and ma200[last - 30] else None,
           "cross": bool(ma50[last] and ma200[last] and ma50[last] > ma200[last]),
           "r1": _r(back(30)), "r3": _r(back(91)), "r6": _r(back(182)), "r12": _r(back(365)),
           "ath": _r(p[ath_i], 2), "ath_date": t[ath_i].isoformat(), "dd": _r(dd[last])}
    # drawdown analogs: past days within 10 points of today's distance from the peak
    sim = {}
    for h, f in ((H3, f3), (H12, f12)):
        vals, eps, prev = [], 0, False
        for i in range(n):
            ok = abs(dd[i] - dd[last]) <= 0.10 and f[i] is not None
            if ok and not prev:
                eps += 1
            prev = ok
            if ok:
                vals.append(f[i])
        if vals:
            x = sorted(vals)
            sim[str(h)] = {"n": len(x), "eps": eps, "med": _r(quant(x, .5) - 1), "up": _r(sum(1 for v in x if v > 1) / len(x))}
    out["dd_analog"] = sim
    # four-year cycle: the same day after earlier halvings
    since = max(h for h in HALVINGS if h <= t[last])
    day = (t[last] - since).days
    idx = {d: i for i, d in enumerate(t)}
    cyc = []
    for h in HALVINGS:
        if h >= since:
            continue
        a = idx.get(h + timedelta(days=day))
        res = {"halving": h.isoformat()}
        for hh in (H3, H12):
            b = idx.get(h + timedelta(days=day + hh))
            res[str(hh)] = _r(p[b] / p[a] - 1) if a is not None and b is not None else None
        if a is not None:
            cyc.append(res)
    out["cycle"] = {"since": since.isoformat(), "day": day, "next": NEXT_HALVING.isoformat(), "earlier": cyc}
    return out


def _verdict(inds, direction):
    tested = [x for x in inds if x["tested"]]
    total = len([x for x in inds if x["t3"].get("n", 0) >= 8 or x["t12"].get("n", 0) >= 8])
    trend = direction.get("state") or "–"
    if not tested:
        return {"status": "warn", "statusText": "Tidak ada sinyal arah yang teruji",
                "detail": f"0 dari {total} indikator mengalahkan tebakan 'selalu naik'; tren sekarang: {trend}",
                "tested": [], "ups": 0, "downs": 0, "total": total}
    ups = [x["id"] for x in tested if x["call"] == "naik"]
    downs = [x["id"] for x in tested if x["call"] == "turun"]
    if len(ups) > len(downs):
        st, txt = "ok", "Condong naik (dari sinyal teruji)"
    elif len(downs) > len(ups):
        st, txt = "bad", "Condong turun (dari sinyal teruji)"
    else:
        st, txt = "warn", "Sinyal teruji berbeda arah"
    return {"status": st, "statusText": txt,
            "detail": f"{len(tested)} dari {total} indikator teruji: {len(ups)} bilang naik, {len(downs)} bilang turun; tren: {trend}",
            "tested": [x["id"] for x in tested], "ups": len(ups), "downs": len(downs), "total": total}


# ------------------------------------------------------------------ text for Claude (scripts/digest.py, chat)
def _p(x, d=0):
    return "–" if x is None else f"{x * 100:+.{d}f}%"


def _t(t: dict) -> str:
    if not t or t.get("n", 0) < 8:
        return "belum cukup data"
    tag = " TERUJI" if t.get("beats") else " lebih buruk" if t.get("worse") else ""
    return f"teori {t['book'] * 100:.0f}% vs selalu naik {t['always'] * 100:.0f}% (derau ±{t['marg'] * 100:.0f}, n_eff {t['neff']}){tag}"


def facts_lines(a: dict | None) -> list[str]:
    """The Bitcoin part of the fact sheet: every number already computed."""
    if not a:
        return ["- Bitcoin: belum ada data (tarik dulu)."]
    d, c, c4, v = a["direction"], a["char"]["all"], a["char"]["y4"], a["verdict"]
    out = [
        f"- Harga BTC {a['as_of']} US${a['price']:.0f} ({a['price_src']}); {d['dd'] * 100:.0f}% dari puncak US${d['ath']:.0f} ({d['ath_date']}); "
        f"tren {d['state']}, {_p(d['vs200'])} vs rata-rata 200 hari; perubahan 1/3/6/12 bln {_p(d['r1'])}/{_p(d['r3'])}/{_p(d['r6'])}/{_p(d['r12'])}",
        f"- Karakter semua sejarah ({c['from']}→): gerak harian ±{c['sd'] * 100:.2f}%, volatilitas setahun {c['ann_vol'] * 100:.0f}%, "
        f"hari ekstrem {c['ext_ratio']:.1f}x kurva lonceng, penurunan terdalam {c['mdd'] * 100:.0f}%; 4 tahun terakhir: ±{c4['sd'] * 100:.2f}%, "
        f"volatilitas {c4['ann_vol'] * 100:.0f}%, penurunan terdalam {c4['mdd'] * 100:.0f}%",
        f"- Sinyal keputusan BTC: {v['statusText']} ({v['detail']})",
    ]
    for x in a["indicators"]:
        g = x["groups"].get(x["state"]) or {}
        s12 = g.get("s12") or {}
        follow = f"; sesudah keadaan ini 12 bln median {_p(s12.get('med'))}, naik {s12.get('up', 0) * 100:.0f}% ({g.get('eps', 0)} episode)" if s12 else ""
        out.append(f"- {x['name']}: {x['value_text']}, keadaan {x['state']} (teori: {x['call']}){follow}; uji 12 bln: {_t(x['t12'])}; 3 bln: {_t(x['t3'])}")
    cyc = d["cycle"]
    out.append(f"- Siklus halving: hari ke-{cyc['day']} sejak {cyc['since']}; halving berikutnya sekitar {cyc['next']} (perkiraan)")
    return out


def chat_block(a: dict | None) -> str:
    """Detail for a chat question about Bitcoin: what followed every state of every indicator."""
    if not a:
        return ""
    lines = ["## Bitcoin rinci: apa yang terjadi sesudah tiap keadaan (median perubahan harga, % naik, jumlah episode)"]
    for x in a["indicators"]:
        parts = []
        for s in x["order"] + ["Semua hari"]:
            g = x["groups"].get(s) or {}
            s3, s12 = g.get("s3"), g.get("s12")
            if not s3:
                continue
            p12 = f", 12 bln {_p(s12['med'])} naik {s12['up'] * 100:.0f}%" if s12 else ""
            parts.append(f"{s}{' (sekarang)' if s == x['state'] else ''}: 3 bln {_p(s3['med'])} naik {s3['up'] * 100:.0f}%{p12}, {g.get('eps', 0)} ep")
        lines.append(f"- {x['name']}: " + "; ".join(parts))
    cyc = a["direction"]["cycle"]
    if cyc["earlier"]:
        lines.append("- Hari yang sama setelah halving sebelumnya (12 bln sesudahnya): " +
                     "; ".join(f"{c['halving'][:4]} {_p(c.get('365'))}" for c in cyc["earlier"]))
    return "\n".join(lines)
