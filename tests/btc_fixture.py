"""Synthetic Bitcoin-like data for tests (and a local demo store).

Not real prices: a random walk with fat tails, volatility streaks and a
fading growth rate, plus on-chain series that roughly behave like the real
ones. Good enough to exercise every calculation in backend/btc.py.
"""
from __future__ import annotations

import math
import random
from datetime import date, timedelta

from backend import btc


def make_store(store, start=date(2010, 7, 18), end=date(2026, 11, 22), seed=7, with_live=True):
    rnd = random.Random(seed)
    days = (end - start).days + 1
    price, vol = 0.06, 0.06
    supply = 3_400_000.0
    chain, live, spx_rows = [], [], []
    hr = 1e-6
    exch_share = 0.02
    adr = 5_000.0
    mvrv = 1.0
    spx = 1100.0
    for k in range(days):
        d = start + timedelta(days=k)
        yrs = k / 365.25
        drift = 0.0105 * math.exp(-yrs / 4.5)
        vol = max(0.015, min(0.12, vol * 0.97 + 0.03 * abs(rnd.gauss(0, 0.06)) + (0.002 if rnd.random() < 0.01 else 0)))
        shock = rnd.gauss(0, 1) * (1.8 if rnd.random() < 0.03 else 1)
        sig = vol * 0.6
        price *= math.exp(drift - sig * sig / 2 + sig * shock)
        supply += btc.subsidy_per_day(d)
        mvrv = max(0.5, min(5.0, mvrv * math.exp(0.6 * vol * shock * 0.6) ** 0.5 * (1 - 0.002 * (mvrv - 1.6))))
        hr *= math.exp(0.004 + rnd.gauss(0, 0.01))
        exch_share = max(0.01, min(0.16, exch_share + 0.00004 * (1 if yrs < 7 else -1) + rnd.gauss(0, 0.0004)))
        adr = max(1000.0, adr * math.exp(0.0012 * math.exp(-yrs / 6) + rnd.gauss(0, 0.02)))
        fee = price * (10 + 40 * rnd.random())
        chain.append([d.isoformat(), f"{price:.6g}", f"{price * supply:.0f}", f"{mvrv:.4f}", f"{supply:.0f}",
                      f"{supply * exch_share:.0f}", f"{hr:.6f}", f"{fee:.2f}", f"{adr:.0f}"])
        if d.weekday() < 5 and d >= date(2015, 1, 1):
            spx *= math.exp(0.0003 + rnd.gauss(0, 0.01))
            spx_rows.append([d.isoformat(), f"{spx:.2f}"])
    if with_live:
        last = float(chain[-1][1])
        live = [[(end + timedelta(days=i)).isoformat(), f"{last * (1 + 0.01 * i):.2f}"] for i in range(-3, 3)]
    m2 = []
    us, cn, eu = 7500.0, 41000.0, 7400.0
    for y in range(2008, 2027):
        for m in range(1, 13):
            if (y, m) > (end.year, end.month - 1):
                break
            us *= 1 + 0.005 + rnd.gauss(0, 0.002) + (0.02 if (y == 2020 and 3 <= m <= 8) else 0) - (0.006 if y == 2022 else 0)
            cn *= 1 + 0.009 + rnd.gauss(0, 0.002)
            eu *= 1 + 0.004 + rnd.gauss(0, 0.002)
            m2.append([f"{y}-{m:02d}-01", f"{us:.1f}", "" if (y, m) == (end.year, end.month - 1) else f"{cn:.1f}",
                       f"{7.0 + 0.3 * math.sin(y + m / 12):.4f}", f"{eu:.1f}", f"{1.2 + 0.1 * math.cos(y):.4f}"])
    etf = []
    d = date(2024, 1, 11)
    while d <= end:
        if d.weekday() < 5:
            etf.append([d.isoformat(), f"{rnd.gauss(150, 400):.1f}", f"{rnd.gauss(-20, 50):.1f}", ""])
        d += timedelta(days=1)

    hdr = ["Tanggal", "Harga (USD)", "Nilai pasar (USD)", "MVRV", "Pasokan (BTC)", "Di bursa (BTC)", "Hash rate (EH/s)",
           "Biaya transaksi (USD)", "Alamat aktif"]
    store.put("btc_chain", header=hdr, values=chain, source="api", key=(0,))
    store.put("btc_m2", header=["Tanggal", "US M2 (USD bn)", "China M2 (CNY bn)", "CNY per USD", "Euro M2 (EUR bn)", "USD per EUR"],
              values=m2, source="api", key=(0,))
    store.put("btc_etf", header=["Date", "Net flow ($m)", "GBTC flow ($m)", "Total net assets ($bn)"], values=etf, source="sheet")
    store.put("btc_spx", header=["Date", "Close"], values=spx_rows, source="sheet")
    if with_live:
        store.put("btc_live", header=["Date", "Close"], values=live, source="sheet")
    return store
