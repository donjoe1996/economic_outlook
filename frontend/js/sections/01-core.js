(function () {
window.EO_FS = (typeof window!=='undefined' && window.innerWidth<700) ? 10 : 11.5;
function fmt1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
function sheetRows(answer) { return (answer && answer.values) || []; }
function numOrNull(x) { return (x === undefined || x === null || x === '') ? null : Number(String(x).replace(/,/g, '')); }
dash.calc('ratespread', {
inputs: ['birate', 'fed'],
fn: (birate, fed) => birate.map((b) => {
const f = fed.find((x) => x.month === b.month);
return f ? { month: b.month, bi_rate: b.bi_rate, fed_upper: f.fed_upper, spread: Math.round((b.bi_rate - f.fed_upper) * 100) / 100 } : null;
}).filter((r) => r !== null),
title: 'Selisih BI Rate dan Fed Funds',
description: 'Per bulan: BI Rate, batas atas target Fed Funds, dan selisihnya (BI Rate − Fed Funds, poin persentase).'
});
dash.calc('pmiLatest', {
inputs: ['pmi'],
fn: (pmi) => {
if (!pmi || !pmi.length) return [];
const last = pmi[pmi.length - 1];
return [{ value: fmt1(last.pmi), status: last.pmi >= 50 ? 'Ekspansi' : 'Kontraksi', month: last.month }];
},
title: 'PMI terbaru',
description: 'Baris terakhir dataset pmi, dengan status ekspansi/kontraksi terhadap ambang 50.'
});
dash.calc('gdpLatest', {
inputs: ['gdp'],
fn: (gdp) => {
if (!gdp || !gdp.length) return [];
const last = gdp[gdp.length - 1];
return [{ value: fmt1(last.gdp_yoy) + '%', quarter: last.quarter }];
},
title: 'PDB YoY terbaru',
description: 'Baris terakhir dataset gdp (pertumbuhan PDB riil year-on-year).'
});
dash.calc('retailLatest', {
inputs: ['retail'],
fn: (retail) => {
if (!retail || !retail.length) return [];
const last = retail[retail.length - 1];
return [{ value: fmt1(last.retail_yoy) + '%', month: last.month }];
},
title: 'Penjualan ritel terbaru',
description: 'Baris terakhir dataset retail (pertumbuhan penjualan ritel riil year-on-year).'
});
dash.calc('ikkLatest', {
inputs: ['ikk'],
fn: (ikk) => {
if (!ikk || !ikk.length) return [];
const last = ikk[ikk.length - 1];
return [{ value: fmt1(last.ikk), status: last.ikk >= 100 ? 'Optimis' : 'Pesimis', month: last.month }];
},
title: 'Indeks Keyakinan Konsumen terbaru',
description: 'Baris terakhir dataset ikk, dengan status optimis/pesimis terhadap ambang 100.'
});
dash.calc('birateLatest', {
inputs: ['birate'],
fn: (birate) => {
if (!birate || !birate.length) return [];
const last = birate[birate.length - 1];
return [{ value: fmt1(last.bi_rate) + '%', month: last.month }];
},
title: 'BI Rate terbaru',
description: 'Baris terakhir dataset birate.'
});
dash.calc('infLatest', {
inputs: ['inflation'],
fn: (inflation) => {
if (!inflation || !inflation.length) return [];
const last = inflation[inflation.length - 1];
const status = last.inflation_yoy > 3.5 ? 'Di atas target' : last.inflation_yoy < 1.5 ? 'Di bawah target' : 'Dalam target';
return [{ value: fmt1(last.inflation_yoy) + '%', status: status, month: last.month }];
},
title: 'Inflasi terbaru',
description: 'Baris terakhir dataset inflation, dibandingkan dengan target BI 1,5–3,5%.'
});
dash.calc('idrLatest', {
inputs: ['rupiah'],
fn: (rupiah) => {
if (!rupiah || !rupiah.length) return [];
const last = rupiah[rupiah.length - 1];
const first = rupiah[0];
const pct = (last.usd_idr / first.usd_idr - 1) * 100;
return [{
value: Math.round(last.usd_idr).toLocaleString('en-US'),
change: (pct >= 0 ? '+' : '') + pct.toFixed(1) + '% vs ' + first.month,
month: last.month,
}];
},
title: 'Kurs USD/IDR terbaru',
description: 'Baris terakhir dataset rupiah (rata-rata bulanan), dan perubahannya dibanding bulan pertama dalam jendela 12 bulan.'
});
dash.calc('flowLatest', {
inputs: ['flow'],
fn: (flow) => {
const rows = (flow || []).filter((r) => r.flow_idr_t !== null);
if (!rows.length) return [];
const last = rows[rows.length - 1];
return [{
value: (last.flow_idr_t >= 0 ? '+' : '') + last.flow_idr_t.toFixed(1) + ' T',
status: last.flow_idr_t >= 0 ? 'Beli bersih' : 'Jual bersih',
month: last.month,
}];
},
title: 'Arus asing di saham terbaru',
description: 'Bulan terakhir yang terisi di dataset flow (Rp triliun; positif = asing beli bersih).'
});
dash.calc('confidence', {
inputs: ['pmi', 'gdp', 'retail', 'ikk', 'inflation', 'birate', 'rupiah', 'flow', 'rotation', 'srbi', 'fed', 'gpmi', 'ism', 'gdpus', 'trade', 'cpmi', 'komoditas', 'saham', 'kredit', 'tambang', 'sahamasia'],
fn: (pmi, gdp, retail, ikk, inflation, birate, rupiah, flow, rotation, srbi, fed, gpmi, ism, gdpus, trade, cpmi, komoditas, saham, kredit, tambang, sahamasia) => {
const sets = { pmi, gdp, retail, ikk, inflation, birate, rupiah, flow, rotation, srbi, fed, gpmi, ism, gdpus, trade, cpmi, komoditas, saham, kredit, tambang, sahamasia };
return Object.keys(sets).map((id) => {
const rows = sets[id] || [];
const c = { Tinggi: 0, Sedang: 0, Rendah: 0, kosong: 0 };
rows.forEach((r) => {
const k = r.confidence;
if (k === 'Tinggi' || k === 'Sedang' || k === 'Rendah') c[k] += 1; else c.kosong += 1;
});
const n = c.Tinggi + c.Sedang + c.Rendah;
let label = 'Belum ada';
if (n > 0) label = (c.Rendah / n >= 0.25) ? 'Rendah' : (c.Tinggi / n >= 0.75 && c.Rendah === 0) ? 'Tinggi' : 'Sedang';
const parts = [];
['Tinggi', 'Sedang', 'Rendah'].forEach((k) => { if (c[k]) parts.push(c[k] + ' ' + k); });
if (c.kosong) parts.push(c.kosong + ' kosong');
return { id: id, label: label, detail: parts.join(' · ') + ' (dari ' + rows.length + ' periode)' };
});
},
title: 'Ringkasan tingkat kepercayaan data',
description: 'Per dataset: jumlah baris Tinggi/Sedang/Rendah/kosong dari kolom Tingkat kepercayaan di spreadsheet. Rendah jika ≥25% baris Rendah; Tinggi jika ≥75% Tinggi dan tanpa Rendah; selain itu Sedang.'
});
dash.calc('regime', {
inputs: ['pmi', 'gdp', 'retail', 'ikk', 'inflation', 'birate', 'rupiah', 'flow', 'fed'],
fn: (pmi, gdp, retail, ikk, inflation, birate, rupiah, flow, fed) => {
const sets = [pmi, gdp, retail, ikk, inflation, birate, rupiah, flow, fed];
if (sets.some((s) => !s || s.length < 7 && s !== gdp)) return [];
if (!gdp || gdp.length < 2) return [];
const last = (a) => a[a.length - 1];
const back = (a, k) => a[a.length - 1 - k];
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sgn = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
const arrow = (diff, flat) => (Math.abs(diff) <= flat ? '→' : diff > 0 ? '↑' : '↓');
const word = { ok: 'Baik', warn: 'Waspada', bad: 'Tertekan' };
const out = [];
const add = (id, kind, status, statusText, value, delta, rule, detail) => out.push({ id, kind, status, statusText, value, delta, rule, detail });
const lvl = (st, v, d, r, dl) => add(null, null, st, word[st], v, d, r, dl);
const reg = [];
const g1 = last(gdp), g0 = back(gdp, 1);
reg.push(['pdb', g1.gdp_yoy >= 5 ? 'ok' : g1.gdp_yoy >= 4.5 ? 'warn' : 'bad', g1.gdp_yoy.toFixed(2) + '%',
arrow(g1.gdp_yoy - g0.gdp_yoy, 0.05) + ' ' + sgn(g1.gdp_yoy - g0.gdp_yoy, 2) + ' vs ' + g0.quarter,
'Baik ≥5% · Waspada 4,5–5% · Tertekan <4,5%']);
const p3 = mean(pmi.slice(-3).map((r) => r.pmi)), p3b = mean(pmi.slice(-6, -3).map((r) => r.pmi));
reg.push(['pmi', p3 >= 51 ? 'ok' : p3 >= 50 ? 'warn' : 'bad', p3.toFixed(1),
arrow(p3 - p3b, 0.3) + ' ' + sgn(p3 - p3b, 1) + ' vs 3 bulan sebelumnya',
'Baik ≥51 · Waspada 50–51 · Tertekan <50']);
const k1 = last(ikk).ikk, k0 = back(ikk, 3);
reg.push(['ikk', k1 >= 120 ? 'ok' : k1 >= 100 ? 'warn' : 'bad', k1.toFixed(1),
arrow(k1 - k0.ikk, 1) + ' ' + sgn(k1 - k0.ikk, 1) + ' vs ' + k0.month,
'Baik ≥120 · Waspada 100–120 · Tertekan <100']);
const r1 = last(retail).retail_yoy, r0 = back(retail, 3);
reg.push(['ritel', r1 >= 2 ? 'ok' : r1 >= 0 ? 'warn' : 'bad', sgn(r1, 1) + '%',
arrow(r1 - r0.retail_yoy, 0.5) + ' ' + sgn(r1 - r0.retail_yoy, 1) + ' poin vs ' + r0.month,
'Baik ≥2% · Waspada 0–2% · Tertekan <0%']);
const i1 = last(inflation).inflation_yoy, i0 = back(inflation, 3);
reg.push(['inflasi', (i1 >= 2 && i1 <= 3) ? 'ok' : (i1 >= 1.5 && i1 <= 3.5) ? 'warn' : 'bad', i1.toFixed(2) + '%',
arrow(i1 - i0.inflation_yoy, 0.1) + ' ' + sgn(i1 - i0.inflation_yoy, 2) + ' poin vs ' + i0.month,
'Baik 2–3% · Waspada 1,5–2% atau 3–3,5% · Tertekan di luar target BI 1,5–3,5%']);
const b1 = last(birate), b0 = back(birate, 3);
const real = b1.bi_rate - i1;
reg.push(['birate', (real >= 0.5 && real <= 2) ? 'ok' : (real >= 0 && real <= 3) ? 'warn' : 'bad', b1.bi_rate.toFixed(2) + '%',
arrow(b1.bi_rate - b0.bi_rate, 0.01) + ' ' + (b1.bi_rate === b0.bi_rate ? 'tidak berubah' : sgn(b1.bi_rate - b0.bi_rate, 2) + ' poin') + ' vs ' + b0.month + ' · bunga riil ' + sgn(real, 2) + ' poin',
'Dinilai dari bunga riil (BI Rate − inflasi): Baik 0,5–2 · Waspada 0–0,5 atau 2–3 · Tertekan <0 atau >3 (terlalu ketat)']);
const x1 = last(rupiah), x0 = back(rupiah, 3), xf = rupiah[0];
const sinceStart = (x1.usd_idr / xf.usd_idr - 1) * 100, d3 = (x1.usd_idr / x0.usd_idr - 1) * 100;
reg.push(['kurs', sinceStart < 2 ? 'ok' : sinceStart < 5 ? 'warn' : 'bad', Math.round(x1.usd_idr).toLocaleString('en-US'),
arrow(d3, 0.5) + ' ' + sgn(d3, 1) + '% vs ' + x0.month + (d3 > 0.5 ? ' (Rupiah melemah)' : d3 < -0.5 ? ' (Rupiah menguat)' : ' (stabil)') + ' · ' + sgn(sinceStart, 1) + '% vs ' + xf.month,
'Dinilai dari perubahan sejak awal jendela: Baik <2% · Waspada 2–5% · Tertekan >5% lebih lemah']);
const fl = flow.filter((r) => r.flow_idr_t !== null);
const f3 = flow.slice(-3), f3b = flow.slice(-6, -3);
const f3sum = f3.reduce((s, r) => s + (r.flow_idr_t || 0), 0);
const f3bFull = f3b.every((r) => r.flow_idr_t !== null);
const f3bsum = f3b.reduce((s, r) => s + (r.flow_idr_t || 0), 0);
reg.push(['asing', f3sum >= 0 ? 'ok' : f3sum >= -5 ? 'warn' : 'bad', sgn(f3sum, 1) + ' T',
f3bFull ? arrow(f3sum - f3bsum, 2) + ' ' + sgn(f3sum - f3bsum, 1) + ' T vs 3 bulan sebelumnya' : 'pembanding 3 bulan sebelumnya belum lengkap (ada bulan kosong)',
'Jumlah net beli/jual asing di saham 3 bulan terakhir, Rp triliun: Baik ≥0 · Waspada 0 s.d. −5 · Tertekan < −5']);
reg.forEach((r) => add(r[0], 'regime', r[1], word[r[1]], r[2], r[3], r[4], ''));
const score = reg.reduce((s, r) => s + (r[1] === 'ok' ? 1 : r[1] === 'bad' ? -1 : 0), 0) / reg.length;
const cnt = (k) => reg.filter((r) => r[1] === k).length;
const vs = score >= 0.4 ? 'ok' : score <= -0.4 ? 'bad' : 'warn';
add('verdict', 'verdict', vs, score >= 0.4 ? 'Ekspansi' : score <= -0.4 ? 'Tertekan' : 'Melambat / campuran', '',
'', 'Skor: Baik +1, Waspada 0, Tertekan −1, dirata-rata dari 8 indikator. ≥ +0,4 Ekspansi · ≤ −0,4 Tertekan · selain itu Melambat / campuran.',
cnt('ok') + ' Baik · ' + cnt('warn') + ' Waspada · ' + cnt('bad') + ' Tertekan dari ' + reg.length + ' indikator');
const chk = [];
const i3 = inflation.slice(-3), nIn = i3.filter((r) => r.inflation_yoy <= 3.0).length;
chk.push(['c_inf', nIn === 3 ? 'Terpenuhi' : nIn === 2 ? 'Sebagian' : 'Belum', nIn + ' dari 3 bulan terakhir inflasi ≤3,0% (terakhir ' + i1.toFixed(2) + '%)']);
const x3 = rupiah.slice(-4);
let weak = 0;
for (let k = 1; k < x3.length; k++) if (x3[k].usd_idr > x3[k - 1].usd_idr * 1.01) weak += 1;
const stable = weak === 0 && x1.usd_idr <= x0.usd_idr * 1.01;
chk.push(['c_idr', stable ? 'Terpenuhi' : weak <= 1 ? 'Sebagian' : 'Belum',
(weak === 0 ? 'Tidak ada pelemahan >1% per bulan dalam 3 bulan terakhir' : weak + ' dari 3 bulan terakhir melemah >1%') + '; tetap ' + sgn(sinceStart, 1) + '% lebih lemah dari ' + xf.month]);
const pos = f3.filter((r) => r.flow_idr_t !== null && r.flow_idr_t >= 0).length, lf = last(fl);
chk.push(['c_flow', pos === 3 ? 'Terpenuhi' : pos === 2 ? 'Sebagian' : 'Belum',
pos + ' dari 3 bulan terakhir asing beli bersih saham; ' + lf.month + ' ' + sgn(lf.flow_idr_t, 1) + ' T']);
const fL = last(fed), spNow = b1.bi_rate - fL.fed_upper, spBef = b0.bi_rate - back(fed, 3).fed_upper, spStart = birate[0].bi_rate - fed[0].fed_upper;
chk.push(['c_us', spNow >= spBef ? 'Terpenuhi' : spNow > spBef - 0.25 ? 'Sebagian' : 'Belum',
'Selisih BI Rate − Fed Funds (batas atas) ' + sgn(spNow, 2) + ' poin, vs ' + sgn(spBef, 2) + ' pada ' + b0.month + ' dan ' + sgn(spStart, 2) + ' pada ' + birate[0].month]);
chk.forEach((c) => add(c[0], 'check', c[1] === 'Terpenuhi' ? 'ok' : c[1] === 'Sebagian' ? 'warn' : 'bad', c[1], '', '', '', c[2]));
const nOk = chk.filter((c) => c[1] === 'Terpenuhi').length;
add('c_sum', 'check', nOk === 4 ? 'ok' : nOk === 3 ? 'warn' : 'bad', nOk + ' dari 4 syarat terpenuhi', '', '', 'Butuh keempatnya. 4 = pemotongan bunga mulai realistis · 3 = hampir · 0–2 = belum cukup.',
nOk === 4 ? 'Data mendukung pemotongan bunga' : nOk === 3 ? 'Tinggal satu syarat lagi' : 'Data belum cukup mendukung pemotongan bunga');
add('d_real', 'derived', 'ok', '', sgn(real, 2) + ' poin', '', '', 'BI Rate ' + b1.bi_rate.toFixed(2) + '% − inflasi ' + i1.toFixed(2) + '% (' + b1.month + ')');
add('d_kurs', 'derived', 'ok', '', sgn(sinceStart, 1) + '%', '', '', 'Rata-rata ' + xf.month + ' → ' + x1.month + ' (positif = Rupiah lebih lemah)');
const cum = fl.reduce((s, r) => s + r.flow_idr_t, 0);
add('d_flow', 'derived', 'ok', '', sgn(cum, 1) + ' T', '', '', 'Jumlah ' + fl.length + ' dari ' + flow.length + ' bulan terisi (Rp triliun, tanpa bulan kosong)');
add('d_spread', 'derived', 'ok', '', sgn(spNow, 2) + ' poin', '', '', 'BI Rate ' + b1.bi_rate.toFixed(2) + '% − Fed Funds ' + fL.fed_upper.toFixed(2) + '% (batas atas, ' + fL.month + '); ' + sgn(spNow - spBef, 2) + ' vs ' + b0.month);
const up = pmi.filter((r) => r.pmi > 50).length;
add('d_pmi', 'derived', 'ok', '', up + ' dari ' + pmi.length, '', '', 'Bulan dengan PMI di atas 50 (ekspansi)');
return out;
},
title: 'Status ekonomi, syarat BI, dan angka turunan',
description: 'Menilai 8 indikator dengan ambang tertulis (Baik/Waspada/Tertekan), memberi vonis dari skor rata-rata, mengecek 4 syarat penurunan bunga BI (inflasi, Rupiah, arus asing, selisih bunga dengan AS), dan menghitung suku bunga riil, selisih bunga BI–Fed, perubahan kurs, arus asing kumulatif, dan jumlah bulan PMI di atas 50.'
});
dash.calc('global', {
inputs: ['gpmi'],
fn: (gpmi) => {
const rows = (gpmi || []).filter((r) => r.gpmi !== null && r.gpmi !== undefined);
if (rows.length < 7) return [];
const last = (a) => a[a.length - 1];
const avg = (a) => a.reduce((s, r) => s + r.gpmi, 0) / a.length;
const sgn = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
const out = [];
const add = (id, status, statusText, value, delta, rule, detail) => out.push({ id, status, statusText, value, delta, rule, detail });
const sc = { ok: 1, warn: 0, bad: -1 };
const l = last(rows), prev = rows[rows.length - 2], first = rows[0];
const a1 = avg(rows.slice(-3)), a0 = avg(rows.slice(-6, -3));
const dT = a1 - a0, dW = l.gpmi - first.gpmi;
let streak = 0;
for (let k = rows.length - 1; k >= 0 && rows[k].gpmi > 50; k--) streak += 1;
const sLevel = l.gpmi >= 51 ? 'ok' : l.gpmi >= 50 ? 'warn' : 'bad';
const sTrend = dT >= 0.3 ? 'ok' : dT <= -0.3 ? 'bad' : 'warn';
const sWin = dW >= 1 ? 'ok' : dW <= -1 ? 'bad' : 'warn';
const sStreak = streak >= 6 ? 'ok' : streak >= 2 ? 'warn' : 'bad';
const mean = (sc[sLevel] + sc[sTrend] + sc[sWin] + sc[sStreak]) / 4;
const sV = mean >= 0.5 ? 'ok' : mean <= -0.5 ? 'bad' : 'warn';
const wV = sV === 'ok' ? 'Baik' : sV === 'bad' ? 'Tertekan' : 'Waspada';
add('gl_verdict', sV, wV, '',
sV === 'ok' ? 'Implikasi untuk Indonesia: permintaan global untuk barang mendukung ekspor dan harga komoditas.'
: sV === 'bad' ? 'Implikasi untuk Indonesia: permintaan global melemah, risiko bagi ekspor dan komoditas.'
: 'Implikasi untuk Indonesia: sinyal campuran dari luar; belum jadi angin pendorong yang jelas.',
'Skor rata-rata 4 baris di bawah (Baik=+1, Waspada=0, Tertekan=−1): ≥+0,5 Baik · ≤−0,5 Tertekan · selain itu Waspada.',
'PMI ' + l.month + ': ' + l.gpmi.toFixed(1) + ' (' + sgn(l.gpmi - prev.gpmi, 1) + ' vs ' + prev.month + ')');
add('gl_level', sLevel, sLevel === 'ok' ? 'Baik' : sLevel === 'warn' ? 'Waspada' : 'Tertekan', l.gpmi.toFixed(1),
sgn(l.gpmi - prev.gpmi, 1) + ' poin vs ' + prev.month + ' (' + prev.gpmi.toFixed(1) + ')',
'Level PMI: ≥51 Baik · 50–51 Waspada · <50 Tertekan (50 = batas antara ekspansi dan kontraksi)', '');
add('gl_trend', sTrend, sTrend === 'ok' ? 'Naik' : sTrend === 'bad' ? 'Turun' : 'Mendatar', a1.toFixed(2),
sgn(dT, 2) + ' poin vs 3 bulan sebelumnya (' + a0.toFixed(2) + ')',
'Rata-rata 3 bulan terakhir dibanding 3 bulan sebelumnya: naik ≥0,3 = Naik · turun ≥0,3 = Turun · selain itu Mendatar', '');
add('gl_window', sWin, sWin === 'ok' ? 'Membaik' : sWin === 'bad' ? 'Memburuk' : 'Datar', sgn(dW, 1) + ' poin',
first.month + ' ' + first.gpmi.toFixed(1) + ' → ' + l.month + ' ' + l.gpmi.toFixed(1),
'Perubahan dari awal jendela 12 bulan: naik ≥1 poin = Membaik · turun ≥1 = Memburuk · selain itu Datar', '');
add('gl_streak', sStreak, sStreak === 'ok' ? 'Konsisten' : sStreak === 'warn' ? 'Baru mulai' : 'Putus', streak + ' bulan',
streak >= rows.length ? 'Seluruh jendela ' + rows.length + ' bulan di atas 50' : 'Terakhir di bawah/di 50 sebelum rangkaian ini',
'Jumlah bulan beruntun (sampai bulan terakhir) dengan PMI di atas 50: ≥6 Konsisten · 2–5 Baru mulai · <2 Putus', '');
return out;
},
title: 'Status ekonomi global',
description: 'Menilai PMI Manufaktur Global (level, tren 3 bulan, perubahan 12 bulan, rangkaian bulan di atas 50) dengan ambang tertulis dan skor rata-rata.'
});
dash.calc('market', {
inputs: ['saham', 'flow', 'rupiah', 'pmi'],
fn: (saham, flow, rupiah, pmi) => {
const rows = (saham || []).filter((r) => r.ihsg !== null && r.ihsg !== undefined);
if (rows.length < 4) return [];
const last = (a) => a[a.length - 1];
const sgn = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
const pct = (a, b) => (a / b - 1) * 100;
const fmtN = (v) => Math.round(v).toLocaleString('id-ID');
const out = [];
const add = (id, status, statusText, value, delta, rule, detail) => out.push({ id, status, statusText, value, delta, rule, detail });
const r1 = last(rows), r0 = rows[rows.length - 2], r3 = rows[Math.max(0, rows.length - 4)], rF = rows[0];
const peak = rows.reduce((m, r) => (r.ihsg > m.ihsg ? r : m), rows[0]);
const dd = pct(r1.ihsg, peak.ihsg), ch3 = pct(r1.ihsg, r3.ihsg), ch12 = pct(r1.ihsg, rF.ihsg);
const st = (v, okT, badT) => v >= okT ? 'ok' : v <= badT ? 'bad' : 'warn';
const sV = ch3 >= 3 ? 'ok' : ch3 <= -3 ? 'bad' : 'warn';
add('mk_verdict', sV, sV === 'ok' ? 'Naik' : sV === 'bad' ? 'Tertekan' : 'Mendatar', '',
'IHSG ' + sgn(ch12, 1) + '% sejak ' + rF.month + ', ' + sgn(dd, 1) + '% dari puncak ' + fmtN(peak.ihsg) + ' (' + peak.month + ').',
'Tren 3 bulan IHSG: naik ≥3% = Naik · turun ≥3% = Tertekan · selain itu Mendatar. Harga sudah memasukkan ekspektasi pasar, jadi bisa berbeda arah dengan data ekonomi.',
'IHSG ' + fmtN(r1.ihsg) + ' (' + r1.month + '), ' + sgn(ch3, 1) + '% dalam 3 bulan');
add('mk_ihsg', st(ch3, 3, -3), sgn(ch3, 1) + '% 3 bln', fmtN(r1.ihsg), sgn(pct(r1.ihsg, r0.ihsg), 1) + '% vs ' + r0.month + ' · ' + sgn(ch12, 1) + '% vs ' + rF.month,
'Status = perubahan 3 bulan: ≥+3% hijau · ≤−3% merah', '');
if (r1.fin != null && rF.fin != null) {
const f3 = pct(r1.fin, r3.fin), f12 = pct(r1.fin, rF.fin);
add('mk_fin', st(f3, 3, -3), sgn(f3, 1) + '% 3 bln', fmtN(r1.fin), sgn(f12, 1) + '% vs ' + rF.month + ' · IHSG ' + sgn(ch12, 1) + '%',
f12 > ch12 ? 'Sektor keuangan turun lebih sedikit dari IHSG (lebih tahan)' : 'Sektor keuangan turun lebih dalam dari IHSG', '');
}
if (r1.bbca != null && rF.bbca != null) {
const b3 = pct(r1.bbca, r3.bbca), b12 = pct(r1.bbca, rF.bbca);
add('mk_bbca', st(b3, 3, -3), sgn(b3, 1) + '% 3 bln', 'Rp ' + fmtN(r1.bbca), sgn(b12, 1) + '% vs ' + rF.month + ' (Rp ' + fmtN(rF.bbca) + ')',
b12 < ch12 ? 'Turun lebih dalam dari IHSG dalam 12 bulan' : 'Lebih tahan dari IHSG dalam 12 bulan', '');
}
const corr = (xs, ys) => { const p = xs.map((x, i) => [x, ys[i]]).filter((q) => q[0] != null && q[1] != null && isFinite(q[0]) && isFinite(q[1])); const n = p.length; if (n < 5) return { r: NaN, n }; let mx = 0, my = 0; p.forEach((q) => { mx += q[0]; my += q[1]; }); mx /= n; my /= n; let a = 0, b = 0, c = 0; p.forEach((q) => { a += (q[0] - mx) * (q[1] - my); b += (q[0] - mx) ** 2; c += (q[1] - my) ** 2; }); return { r: a / Math.sqrt(b * c), n }; };
const ret = [], fl = [], fxr = [], dp = [];
const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(String(v).replace(/,/g, '')))) ? null : Number(String(v).replace(/,/g, ''));
for (let i = 1; i < rows.length; i++) {
const m = rows[i].month, mp = rows[i - 1].month;
ret.push(pct(rows[i].ihsg, rows[i - 1].ihsg));
const f = (flow || []).find((x) => x.month === m); fl.push(f ? num(f.flow_idr_t) : null);
const x1 = (rupiah || []).find((x) => x.month === m), x0 = (rupiah || []).find((x) => x.month === mp);
fxr.push(x1 && x0 && num(x1.usd_idr) && num(x0.usd_idr) ? pct(num(x1.usd_idr), num(x0.usd_idr)) : null);
const p1 = (pmi || []).find((x) => x.month === m), p0 = (pmi || []).find((x) => x.month === mp);
dp.push(p1 && p0 && num(p1.pmi) != null && num(p0.pmi) != null ? num(p1.pmi) - num(p0.pmi) : null);
}
const cs = [['arus asing', corr(ret, fl)], ['kurs USD/IDR', corr(ret, fxr)], ['perubahan PMI', corr(ret, dp)]].filter((c) => isFinite(c[1].r));
if (cs.length) {
cs.sort((a, b) => Math.abs(b[1].r) - Math.abs(a[1].r));
const top = cs[0], rr = top[1].r;
add('mk_link', Math.abs(rr) >= 0.6 ? 'ok' : Math.abs(rr) >= 0.3 ? 'warn' : 'bad', Math.abs(rr) >= 0.6 ? 'Kuat' : Math.abs(rr) >= 0.3 ? 'Sedang' : 'Lemah', top[0],
cs.map((c) => c[0] + ' ' + (c[1].r >= 0 ? '+' : '−') + Math.abs(c[1].r).toFixed(2) + ' (n=' + c[1].n + ')').join(' · '),
'Korelasi perubahan bulanan IHSG dengan tiap penggerak: |r| ≥0,6 Kuat · 0,3–0,6 Sedang · <0,3 Lemah. Tanda + berarti bergerak searah.', '');
}
return out;
},
title: 'Status pasar saham',
description: 'Tren IHSG, sektor keuangan, dan BBCA (3 dan 12 bulan, jarak dari puncak) serta korelasi perubahan bulanan IHSG dengan arus asing, kurs, dan PMI Indonesia.'
});
dash.calc('tambang_s', {
inputs: ['tambang', 'komoditas', 'saham', 'flow'],
fn: (tb, kom, sah, flw) => {
const rows = (tb || []).filter((r) => r.energy !== null && r.energy !== undefined);
if (rows.length < 4) return [];
const last = (a) => a[a.length - 1];
const sgn = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
const pct = (a, b) => (a / b - 1) * 100;
const fmtN = (v) => Math.round(v).toLocaleString('id-ID');
const out = [];
const add = (id, status, statusText, value, delta, rule, detail) => out.push({ id, status, statusText, value, delta, rule, detail });
const st = (v, okT, badT) => v >= okT ? 'ok' : v <= badT ? 'bad' : 'warn';
const r1 = last(rows), r3 = rows[Math.max(0, rows.length - 4)], rF = rows[0];
const ch3 = pct(r1.energy, r3.energy), ch12 = pct(r1.energy, rF.energy);
const sV = ch3 >= 3 ? 'ok' : ch3 <= -3 ? 'bad' : 'warn';
const coalK = ['adro', 'ptba', 'itmg', 'bumi'], metK = ['antm', 'inco', 'mdka', 'ammn'];
const basket = (keys) => rows.map((r) => { const v = keys.map((k) => { const b = rows.find((x) => x[k] != null); return r[k] == null || !b ? null : r[k] / b[k] * 100; }).filter((x) => x != null); return v.length === keys.length ? v.reduce((a, b) => a + b, 0) / v.length : null; });
const bc = basket(coalK), bm = basket(metK);
const bcL = last(bc), bmL = last(bm);
const b3 = (b) => (b[b.length - 1] != null && b[Math.max(0, b.length - 4)] != null) ? pct(b[b.length - 1], b[Math.max(0, b.length - 4)]) : null;
add('tb_verdict', sV, sV === 'ok' ? 'Naik' : sV === 'bad' ? 'Tertekan' : 'Mendatar', '',
'Indeks sektor energi ' + sgn(ch12, 1) + '% sejak ' + rF.month + ' · indeks bahan baku ' + sgn(pct(r1.basic, rF.basic), 1) + '%.',
'Tren 3 bulan indeks sektor energi: naik ≥3% = Naik · turun ≥3% = Tertekan · selain itu Mendatar. Harga sudah memasukkan ekspektasi, jadi bisa berbeda arah dengan harga komoditas.',
'IDXENERGY ' + fmtN(r1.energy) + ' (' + r1.month + '), ' + sgn(ch3, 1) + '% dalam 3 bulan');
const e3 = pct(r1.energy, r3.energy);
add('tb_energy', st(e3, 3, -3), sgn(e3, 1) + '% 3 bln', fmtN(r1.energy), sgn(ch12, 1) + '% vs ' + rF.month, 'Indeks sektor energi (batu bara, migas): status = perubahan 3 bulan', '');
const m3 = pct(r1.basic, r3.basic);
add('tb_basic', st(m3, 3, -3), sgn(m3, 1) + '% 3 bln', fmtN(r1.basic), sgn(pct(r1.basic, rF.basic), 1) + '% vs ' + rF.month, 'Indeks bahan baku (logam, nikel, emas, kimia): status = perubahan 3 bulan', '');
if (bcL != null) {
const c3 = b3(bc);
add('tb_coal', st(c3 == null ? 0 : c3, 3, -3), c3 == null ? '—' : sgn(c3, 1) + '% 3 bln', 'Batu bara ' + sgn(bcL - 100, 1) + '%',
'rata-rata ADRO, PTBA, ITMG, BUMI sejak ' + rF.month + ' · indeks energi ' + sgn(ch12, 1) + '%',
bcL - 100 > ch12 ? 'Empat saham batu bara ini lebih tahan dari indeks energi; indeks digerakkan saham lain di luar daftar.' : 'Empat saham batu bara ini ikut turun mengikuti indeks energi.', '');
}
if (bmL != null) {
const x3 = b3(bm);
add('tb_metal', st(x3 == null ? 0 : x3, 3, -3), x3 == null ? '—' : sgn(x3, 1) + '% 3 bln', 'Logam ' + sgn(bmL - 100, 1) + '%',
'rata-rata ANTM, INCO, MDKA, AMMN sejak ' + rF.month + ' · indeks bahan baku ' + sgn(pct(r1.basic, rF.basic), 1) + '%',
'Rata-rata sederhana harga yang dinormalkan (bulan pertama = 100), bukan indeks resmi.', '');
}
const corr = (xs, ys) => { const p = xs.map((x, i) => [x, ys[i]]).filter((q) => q[0] != null && q[1] != null && isFinite(q[0]) && isFinite(q[1])); const n = p.length; if (n < 5) return { r: NaN, n }; let mx = 0, my = 0; p.forEach((q) => { mx += q[0]; my += q[1]; }); mx /= n; my /= n; let sxy = 0, sxx = 0, syy = 0; p.forEach((q) => { sxy += (q[0] - mx) * (q[1] - my); sxx += (q[0] - mx) ** 2; syy += (q[1] - my) ** 2; }); return { r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN, n }; };
const kv = (m, k) => { const x = (kom || []).find((q) => q.month === m); return x && x[k] != null ? Number(x[k]) : null; };
const rets = (b) => rows.map((r, i) => (i > 0 && b[i] != null && b[i - 1] != null) ? pct(b[i], b[i - 1]) : null);
const kr = (k) => rows.map((r, i) => { if (i === 0) return null; const a = kv(r.month, k), p = kv(rows[i - 1].month, k); return a != null && p != null ? pct(a, p) : null; });
const cs = [['batu bara', corr(rets(bc), kr('coal'))], ['nikel', corr(rets(bm), kr('nickel'))]].filter((c) => isFinite(c[1].r));
if (cs.length) {
cs.sort((a, b) => Math.abs(b[1].r) - Math.abs(a[1].r));
const top = cs[0], rr = top[1].r;
add('tb_link', Math.abs(rr) >= 0.6 ? 'ok' : Math.abs(rr) >= 0.3 ? 'warn' : 'bad', Math.abs(rr) >= 0.6 ? 'Kuat' : Math.abs(rr) >= 0.3 ? 'Sedang' : 'Lemah', 'harga ' + top[0],
cs.map((c) => 'saham ' + (c[0] === 'nikel' ? 'logam' : c[0]) + ' vs harga ' + c[0] + ' ' + (c[1].r >= 0 ? '+' : '−') + Math.abs(c[1].r).toFixed(2) + ' (n=' + c[1].n + ')').join(' · '),
'Korelasi perubahan bulanan keranjang saham dengan perubahan harga komoditas dunia (World Bank): |r| ≥0,6 Kuat · 0,3–0,6 Sedang · <0,3 Lemah. Tanda + berarti bergerak searah. Sampel kecil, bukan sebab-akibat.', '');
}
const ihsgOf = (m) => { const x = (sah || []).find((q) => q.month === m); return x && x.ihsg != null ? Number(x.ihsg) : null; };
const ihsgRet = rows.map((r, i) => { if (i === 0) return null; const a = ihsgOf(r.month), p = ihsgOf(rows[i - 1].month); return a != null && p != null ? pct(a, p) : null; });
const flowRet = rows.map((r, i) => { if (i === 0) return null; const x = (flw || []).find((q) => q.month === r.month); return x && x.flow_idr_t != null ? Number(x.flow_idr_t) : null; });
const seriesR = [['indeks energi', rows.map((r) => r.energy)], ['indeks bahan baku', rows.map((r) => r.basic)], ['saham batu bara', bc], ['saham logam', bm]];
const vsI = seriesR.map((q) => [q[0], corr(rets(q[1]), ihsgRet), corr(rets(q[1]), flowRet)]).filter((q) => isFinite(q[1].r));
if (vsI.length) {
const avg = vsI.reduce((a, q) => a + q[1].r, 0) / vsI.length;
const lab = avg >= 0.6 ? 'Kuat' : avg >= 0.3 ? 'Sedang' : 'Lemah';
add('tb_ihsg', avg >= 0.6 ? 'ok' : avg >= 0.3 ? 'warn' : 'bad', lab, 'ikut IHSG ' + (avg >= 0 ? '+' : '−') + Math.abs(avg).toFixed(2),
vsI.map((q) => q[0] + ' vs IHSG ' + (q[1].r >= 0 ? '+' : '−') + Math.abs(q[1].r).toFixed(2) + ' (n=' + q[1].n + ')').join(' · ') +
(vsI.some((q) => isFinite(q[2].r)) ? ' · vs arus asing: ' + vsI.filter((q) => isFinite(q[2].r)).map((q) => q[0].replace('indeks ', '').replace('saham ', '') + ' ' + (q[2].r >= 0 ? '+' : '−') + Math.abs(q[2].r).toFixed(2)).join(', ') : ''),
'Korelasi perubahan bulanan tiap indeks atau keranjang dengan IHSG (nilai pertama), rata-rata |r| ≥0,6 Kuat · 0,3–0,6 Sedang · <0,3 Lemah. Tanda + berarti bergerak searah. Saham tambang adalah bagian dari IHSG, jadi sebagian searah memang otomatis. Sampel kecil, bukan sebab-akibat.', '');
}
return out;
},
title: 'Status saham tambang',
description: 'Tren indeks sektor energi dan bahan baku, keranjang saham batu bara dan logam (indeks 100 = bulan pertama), dan korelasi bulanan dengan harga komoditas dunia.'
});
dash.calc('us', {
inputs: ['fed', 'birate', 'ism', 'gdpus'],
fn: (fed, birate, ism, gdpus) => {
if (!fed || fed.length < 4 || !birate || birate.length < 4) return [];
const last = (a) => a[a.length - 1];
const back = (a, k) => a[a.length - 1 - k];
const sgn = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
const arrow = (diff, flat) => (Math.abs(diff) <= flat ? '→' : diff > 0 ? '↑' : '↓');
const rng = (f) => f.fed_lower.toFixed(2) + '–' + f.fed_upper.toFixed(2) + '%';
const out = [];
const add = (id, status, statusText, value, delta, rule, detail) => out.push({ id, status, statusText, value, delta, rule, detail });
const word = (d) => (d > 0 ? 'Mengetat' : d < 0 ? 'Melonggarkan' : 'Menahan');
const stat = (d) => (d > 0 ? 'bad' : d < 0 ? 'ok' : 'warn');
const f1 = last(fed), f0 = back(fed, 3), fFirst = fed[0];
const d3 = f1.fed_upper - f0.fed_upper;
const changes = [];
for (let k = 1; k < fed.length; k++) {
const diff = fed[k].fed_upper - fed[k - 1].fed_upper;
if (diff !== 0) changes.push({ month: fed[k].month, diff: diff, idx: k });
}
const cuts = changes.filter((c) => c.diff < 0).length, hikes = changes.filter((c) => c.diff > 0).length;
const lc = changes.length ? last(changes) : null;
const ago = lc ? fed.length - 1 - lc.idx : null;
const bp = (c) => Math.round(Math.abs(c.diff) * 100) + ' bp';
const ruleDir = 'Dinilai dari dampaknya ke aset negara berkembang: Melonggarkan (Baik) = target turun · Menahan (Waspada) = tetap · Mengetat (Tertekan) = naik';
add('us_verdict', stat(d3), word(d3), '',
d3 > 0 ? 'Implikasi untuk Indonesia: menambah tekanan pada Rupiah dan mempersempit ruang BI memotong bunga.'
: d3 < 0 ? 'Implikasi untuk Indonesia: memberi ruang bagi BI untuk melonggarkan bunga.'
: 'Implikasi untuk Indonesia: netral; arah bunga The Fed berikutnya jadi penentu.',
'Mengetat = target naik dalam 3 bulan terakhir · Menahan = tetap · Melonggarkan = turun. Warna dinilai dari dampaknya ke aset negara berkembang.',
(lc ? 'Perubahan terakhir: ' + (lc.diff > 0 ? 'naik ' : 'turun ') + bp(lc) + ' pada ' + lc.month + '; ' : 'Tidak ada perubahan; ') + 'target sekarang ' + rng(f1));
add('us_rate', stat(d3), word(d3), rng(f1),
arrow(d3, 0.01) + ' ' + (d3 === 0 ? 'tidak berubah' : sgn(d3, 2) + ' poin') + ' vs ' + f0.month + ' (' + rng(f0) + ')', ruleDir, '');
const net = f1.fed_upper - fFirst.fed_upper;
add('us_net', Math.abs(net) < 0.25 ? 'warn' : net < 0 ? 'ok' : 'bad', Math.abs(net) < 0.25 ? 'Menahan' : net < 0 ? 'Melonggarkan' : 'Mengetat',
(net === 0 ? '0.00' : sgn(net, 2)) + ' poin', cuts + '× pemotongan · ' + hikes + '× kenaikan sejak ' + fFirst.month + ' (' + rng(fFirst) + ')',
'Perubahan batas atas target dari awal jendela 12 bulan: <0,25 poin = Menahan · turun ≥0,25 = Melonggarkan · naik ≥0,25 = Mengetat', '');
add('us_last', lc && ago <= 2 ? (lc.diff > 0 ? 'bad' : 'ok') : 'warn', lc && ago <= 2 ? (lc.diff > 0 ? 'Mengetat' : 'Melonggarkan') : 'Menahan',
lc ? (lc.diff > 0 ? 'Naik ' : 'Turun ') + bp(lc) : 'Tidak ada',
lc ? lc.month + ' (' + (ago === 0 ? 'bulan terakhir' : ago + ' bulan lalu') + ')' : '',
'Perubahan target paling baru dalam 12 bulan; berpengaruh jika terjadi dalam 3 bulan terakhir', '');
const spNow = last(birate).bi_rate - f1.fed_upper, bB = back(birate, 3), spBef = bB.bi_rate - f0.fed_upper;
add('us_spread', spNow >= 2 ? 'ok' : spNow >= 1 ? 'warn' : 'bad', spNow >= 2 ? 'Lebar' : spNow >= 1 ? 'Sedang' : 'Sempit',
sgn(spNow, 2) + ' poin', arrow(spNow - spBef, 0.05) + ' ' + sgn(spNow - spBef, 2) + ' vs ' + bB.month,
'Selisih BI Rate − batas atas Fed Funds: Lebar ≥2 · Sedang 1–2 · Sempit <1 poin. Makin lebar, Rupiah makin menarik bagi investor asing', '');
const ismRows = (ism || []).filter((r) => r.ism !== null && r.ism !== undefined);
if (ismRows.length >= 3) {
const i1 = last(ismRows), i0 = ismRows[ismRows.length - 2];
let run = 0;
for (let k = ismRows.length - 1; k >= 0 && ismRows[k].ism > 50; k--) run += 1;
const sI = i1.ism >= 52 ? 'ok' : i1.ism >= 50 ? 'warn' : 'bad';
add('us_ism', sI, sI === 'ok' ? 'Kuat' : sI === 'warn' ? 'Tipis' : 'Kontraksi', i1.ism.toFixed(1),
sgn(i1.ism - i0.ism, 1) + ' vs ' + i0.month + ' (' + i0.ism.toFixed(1) + ') · ' + (run > 0 ? run + ' bulan ekspansi beruntun' : 'di bawah 50'),
'ISM manufaktur AS: ≥52 Kuat · 50–52 Tipis · <50 Kontraksi (50 = batas ekspansi)', '');
}
const gRows = (gdpus || []).filter((r) => r.gdp_us !== null && r.gdp_us !== undefined);
if (gRows.length >= 2) {
const q1 = last(gRows), q0 = gRows[gRows.length - 2];
const sG = q1.gdp_us >= 2 ? 'ok' : q1.gdp_us >= 0 ? 'warn' : 'bad';
add('us_gdp', sG, sG === 'ok' ? 'Tumbuh' : sG === 'warn' ? 'Lemah' : 'Kontraksi', sgn(q1.gdp_us, 1) + '%',
q1.quarter + ' (laju tahunan, estimasi awal bisa direvisi) · ' + q0.quarter + ' ' + q0.gdp_us.toFixed(1) + '%',
'PDB riil AS QoQ laju tahunan: ≥2% Tumbuh · 0–2% Lemah · <0 Kontraksi', '');
}
return out;
},
title: 'Status kebijakan moneter AS',
description: 'Menilai arah suku bunga The Fed (3 bulan terakhir, 12 bulan, perubahan terakhir) dan selisih bunga BI Rate dengan batas atas Fed Funds, dengan ambang tertulis.'
});
function fillMarks(sourceId) {
const info = dash.data(sourceId);
document.querySelectorAll('[data-source="' + sourceId + '"][data-field]').forEach((el) => {
if (el.closest('.eo-chart-wrap')) return; // charts handle their own container
const field = el.getAttribute('data-field');
if (info.status === 'ok' && info.data && info.data[0] && info.data[0][field] !== undefined) {
el.textContent = info.data[0][field];
} else if (info.status === 'loading') {
el.textContent = '…';
} else {
el.textContent = '—';
}
});
}
['pmiLatest', 'gdpLatest', 'retailLatest', 'ikkLatest', 'birateLatest', 'infLatest', 'idrLatest', 'flowLatest'].forEach((id) => {
dash.onData(() => fillMarks(id));
});
dash.onData(() => {
const info = dash.data('confidence');
document.querySelectorAll('[data-source="confidence"]').forEach((el) => {
const id = (el.getAttribute('data-where') || '').replace('id=', '');
const field = el.getAttribute('data-field');
const row = (info.status === 'ok' && info.data) ? info.data.find((r) => r.id === id) : null;
el.textContent = row ? row[field] : '—';
if (field === 'label') {
el.classList.remove('conf-tinggi', 'conf-sedang', 'conf-rendah');
if (row) el.classList.add('conf-' + String(row.label).toLowerCase().replace(/\s+/g, '-'));
}
});
});
dash.onData(() => {
const info = dash.data('regime');
document.querySelectorAll('[data-source="regime"]').forEach((el) => {
const id = (el.getAttribute('data-where') || '').replace('id=', '');
const field = el.getAttribute('data-field');
const row = (info.status === 'ok' && info.data) ? info.data.find((r) => r.id === id) : null;
el.textContent = (row && row[field] !== undefined && row[field] !== '') ? row[field] : '—';
if (field === 'statusText') {
el.classList.remove('st-ok', 'st-warn', 'st-bad');
if (row) el.classList.add('st-' + row.status);
}
});
});
dash.onData(() => {
const info = dash.data('us');
document.querySelectorAll('[data-source="us"]').forEach((el) => {
const id = (el.getAttribute('data-where') || '').replace('id=', '');
const field = el.getAttribute('data-field');
const row = (info.status === 'ok' && info.data) ? info.data.find((r) => r.id === id) : null;
el.textContent = (row && row[field] !== undefined && row[field] !== '') ? row[field] : '—';
if (field === 'statusText') {
el.classList.remove('st-ok', 'st-warn', 'st-bad');
if (row) el.classList.add('st-' + row.status);
}
});
});
dash.onData(() => {
const info = dash.data('global');
document.querySelectorAll('[data-source="global"]').forEach((el) => {
const id = (el.getAttribute('data-where') || '').replace('id=', '');
const field = el.getAttribute('data-field');
const row = (info.status === 'ok' && info.data) ? info.data.find((r) => r.id === id) : null;
el.textContent = (row && row[field] !== undefined && row[field] !== '') ? row[field] : '—';
if (field === 'statusText') {
el.classList.remove('st-ok', 'st-warn', 'st-bad');
if (row) el.classList.add('st-' + row.status);
}
});
});
dash.onData(() => {
const info = dash.data('market');
document.querySelectorAll('[data-source="market"]').forEach((el) => {
const id = (el.getAttribute('data-where') || '').replace('id=', '');
const field = el.getAttribute('data-field');
const row = (info.status === 'ok' && info.data) ? info.data.find((r) => r.id === id) : null;
el.textContent = (row && row[field] !== undefined && row[field] !== '') ? row[field] : '—';
if (field === 'statusText') {
el.classList.remove('st-ok', 'st-warn', 'st-bad');
if (row) el.classList.add('st-' + row.status);
}
});
});
dash.onData(() => {
const info = dash.data('tambang_s');
document.querySelectorAll('[data-source="tambang_s"]').forEach((el) => {
const id = (el.getAttribute('data-where') || '').replace('id=', '');
const field = el.getAttribute('data-field');
const row = (info.status === 'ok' && info.data) ? info.data.find((r) => r.id === id) : null;
el.textContent = (row && row[field] !== undefined && row[field] !== '') ? row[field] : '—';
if (field === 'statusText') {
el.classList.remove('st-ok', 'st-warn', 'st-bad');
if (row) el.classList.add('st-' + row.status);
}
});
});
function mkSize(svgId, h) {
const svg = d3.select('#' + svgId); const node = svg.node(); if (!node) return null;
const W = node.closest('.eo-chart-wrap').clientWidth || 320;
svg.attr('viewBox', '0 0 ' + W + ' ' + h).attr('height', h).style('height', h + 'px').style('max-height', h + 'px').selectAll('*').remove();
return { svg, W, H: h };
}
function mkAxisX(g, x, months, ih) {
const step = months.length > 8 ? 3 : 1;
months.forEach((m, i) => { if (i % step === 0 || i === months.length - 1) g.append('text').attr('x', x(m)).attr('y', ih + 14).attr('text-anchor', 'middle').attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)').text(m); });
}
function drawMkFlow(svgId) {
const sd = dash.data('saham'), fd = dash.data('flow'); if (sd.status !== 'ok' || !sd.data || !sd.data.length) return;
const c = mkSize(svgId || 'chart-mk-flow', 220); if (!c) return;
const rows = sd.data, months = rows.map((r) => r.month);
const fmap = {}; if (fd.status === 'ok' && fd.data) fd.data.forEach((r) => { fmap[r.month] = r.flow_idr_t; });
const m = { t: 10, r: 40, b: 22, l: 40 }, iw = c.W - m.l - m.r, ih = c.H - m.t - m.b;
const g = c.svg.append('g').attr('transform', 'translate(' + m.l + ',' + m.t + ')');
const x = d3.scalePoint().domain(months).range([0, iw]).padding(0.5);
const fv = months.map((mm) => (fmap[mm] === undefined ? null : fmap[mm]));
const fmax = d3.max(fv.filter((v) => v != null).map(Math.abs)) || 1;
const yf = d3.scaleLinear().domain([-fmax * 1.1, fmax * 1.1]).range([ih, 0]);
const yi = d3.scaleLinear().domain([d3.min(rows, (r) => r.ihsg) * 0.95, d3.max(rows, (r) => r.ihsg) * 1.03]).range([ih, 0]);
const bw = Math.max(4, iw / months.length * 0.55);
g.append('line').attr('x1', 0).attr('x2', iw).attr('y1', yf(0)).attr('y2', yf(0)).attr('stroke', 'var(--color-border-line)');
fv.forEach((v, i) => { if (v == null) return; g.append('rect').attr('x', x(months[i]) - bw / 2).attr('y', Math.min(yf(0), yf(v))).attr('width', bw).attr('height', Math.max(1, Math.abs(yf(v) - yf(0)))).attr('fill', v < 0 ? '#e34948' : '#1baf7a').attr('opacity', 0.55); });
g.append('path').datum(rows).attr('fill', 'none').attr('stroke', 'var(--color-fg)').attr('stroke-width', 2).attr('d', d3.line().x((r) => x(r.month)).y((r) => yi(r.ihsg)));
g.append('circle').attr('cx', x(months[months.length - 1])).attr('cy', yi(rows[rows.length - 1].ihsg)).attr('r', 3.5).attr('fill', 'var(--color-fg)');
yi.ticks(3).forEach((tk) => g.append('text').attr('x', -6).attr('y', yi(tk) + 3).attr('text-anchor', 'end').attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)').text(Math.round(tk).toLocaleString('id-ID')));
yf.ticks(3).forEach((tk) => g.append('text').attr('x', iw + 6).attr('y', yf(tk) + 3).attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)').text(tk));
mkAxisX(g, x, months, ih);
}
function drawMkBanks() {
const sd = dash.data('saham'); if (sd.status !== 'ok' || !sd.data || !sd.data.length) return;
const c = mkSize('chart-mk-banks', 220); if (!c) return;
const rows = sd.data, months = rows.map((r) => r.month);
const ser = [['IHSG', 'ihsg', 'var(--color-fg-muted)', true], ['BBCA', 'bbca', '#2a78d6'], ['BBRI', 'bbri', '#eda100'], ['BMRI', 'bmri', '#1baf7a'], ['BBNI', 'bbni', '#e34948']];
const idx = ser.map((s) => { const b = rows.find((r) => r[s[1]] != null); return rows.map((r) => (r[s[1]] == null || !b ? null : r[s[1]] / b[s[1]] * 100)); });
const all = idx.flat().filter((v) => v != null);
const m = { t: 10, r: 34, b: 22, l: 34 }, iw = c.W - m.l - m.r, ih = c.H - m.t - m.b;
const g = c.svg.append('g').attr('transform', 'translate(' + m.l + ',' + m.t + ')');
const x = d3.scalePoint().domain(months).range([0, iw]).padding(0.5);
const y = d3.scaleLinear().domain([Math.min(d3.min(all), 100) - 4, Math.max(d3.max(all), 100) + 4]).range([ih, 0]);
g.append('line').attr('x1', 0).attr('x2', iw).attr('y1', y(100)).attr('y2', y(100)).attr('stroke', 'var(--color-border-line)').attr('stroke-dasharray', '4 3');
y.ticks(4).forEach((tk) => g.append('text').attr('x', -6).attr('y', y(tk) + 3).attr('text-anchor', 'end').attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)').text(tk));
ser.forEach((s, k) => {
const p = g.append('path').datum(idx[k]).attr('fill', 'none').attr('stroke', s[2]).attr('stroke-width', s[3] ? 1.5 : 2).attr('d', d3.line().defined((v) => v != null).x((v, i) => x(months[i])).y((v) => y(v)));
if (s[3]) p.attr('stroke-dasharray', '4 3');
const lv = idx[k][idx[k].length - 1]; if (lv != null) g.append('text').attr('x', iw + 4).attr('y', y(lv) + 3).attr('font-size', window.EO_FS).attr('fill', s[2]).text(Math.round(lv));
});
mkAxisX(g, x, months, ih);
const leg = document.getElementById('eo-mk-leg'); if (leg) leg.innerHTML = ser.map((s) => '<span style="--k:' + s[2] + '">' + s[0] + '</span>').join('');
}
function drawMk() { try { drawMkFlow(); } catch (e) { console.warn('mk', e && e.message); } try { drawMkBanks(); } catch (e) { console.warn('mk', e && e.message); } }
dash.onData(drawMk);
let mkRT; window.addEventListener('resize', () => { clearTimeout(mkRT); mkRT = setTimeout(drawMk, 120); });
function tbSvg(id, h) {
const svg = d3.select('#' + id); const node = svg.node(); if (!node) return null;
const container = node.closest('.eo-chart-wrap');
const W = container.clientWidth || 300;
svg.attr('viewBox', '0 0 ' + W + ' ' + h).attr('height', h).style('height', h + 'px').style('max-height', h + 'px').selectAll('*').remove();
const m = { top: 10, right: 14, bottom: 36, left: 44 };
return { svg, container, W, H: h, m, iw: W - m.left - m.right, ih: h - m.top - m.bottom, g: svg.append('g').attr('transform', 'translate(' + m.left + ',' + m.top + ')') };
}
function tbTip(container) { container.querySelectorAll('.eo-tooltip').forEach((n) => n.remove()); return makeTooltip(container); }
function tbGrid(c, y, ticks) {
c.g.append('g').call(d3.axisLeft(y).ticks(ticks || 4).tickSize(-c.iw).tickFormat(''))
.call((sel) => sel.select('.domain').remove())
.call((sel) => sel.selectAll('line').attr('stroke', 'var(--color-border-line)').attr('stroke-opacity', 0.6));
}
function tbAxes(c, x, y, months, yFmt) {
c.g.append('g').attr('transform', 'translate(0,' + c.ih + ')').call(d3.axisBottom(x).tickSize(0))
.call((sel) => sel.select('.domain').attr('stroke', 'var(--color-border-line)'))
.selectAll('text').attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)').attr('transform', 'rotate(-35)').style('text-anchor', 'end');
c.g.append('g').call(d3.axisLeft(y).ticks(4).tickFormat(yFmt || null))
.call((sel) => sel.select('.domain').remove())
.selectAll('text').attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)');
}
function tbLines(c, x, y, months, ser, tip, fmtV) {
const line = d3.line().defined((v) => v != null).x((v, i) => x(months[i])).y((v) => y(v)).curve(d3.curveMonotoneX);
ser.forEach((q) => {
if (q.area) c.g.append('path').datum(q.vals).attr('fill', q.color).attr('fill-opacity', 0.08).attr('stroke', 'none').attr('d', d3.area().defined((v) => v != null).x((v, i) => x(months[i])).y0(c.ih).y1((v) => y(v)).curve(d3.curveMonotoneX));
const p = c.g.append('path').datum(q.vals).attr('fill', 'none').attr('stroke', q.color).attr('stroke-width', q.dash ? 1.8 : 2).attr('d', line); if (q.dash) p.attr('stroke-dasharray', '5 3');
c.g.selectAll(null).data(q.vals.map((v, i) => [v, i]).filter((d) => d[0] != null)).join('circle')
.attr('cx', (d) => x(months[d[1]])).attr('cy', (d) => y(d[0])).attr('r', q.dash ? 2.5 : 3.5).attr('fill', q.color).attr('stroke', 'var(--color-bg)').attr('stroke-width', 1.5).style('cursor', 'pointer')
.on('mouseenter', function (event, d) { const [mx, my] = d3.pointer(event, c.container); tip.show(months[d[1]] + ' · ' + q.label + ': <b>' + fmtV(d[0]) + '</b>', mx, my); })
.on('mouseleave', () => tip.hide());
});
}
function tbLegend(id, ser) { const leg = document.getElementById(id); if (leg) leg.innerHTML = ser.map((q) => '<span class="eo-lg" style="--k:' + q.color + '">' + q.label + '</span>').join(' · ') + ' ·'; }
function tbNorm(vals) { const b = vals.find((v) => v != null); return vals.map((v) => (v == null || !b ? null : v / b * 100)); }
function tbBask(rows, keys) { const ns = keys.map((k) => tbNorm(rows.map((r) => r[k]))); return rows.map((r, i) => { const v = ns.map((n) => n[i]); return v.every((q) => q != null) ? v.reduce((a, b) => a + b, 0) / v.length : null; }); }
function drawTbIndexed(svgId, legId, ser) {
const c = tbSvg(svgId, 200); if (!c) return;
const months = ser.months;
const flat = ser.list.map((q) => q.vals).flat().filter((v) => v != null);
const x = d3.scalePoint().domain(months).range([0, c.iw]).padding(0.5);
const y = d3.scaleLinear().domain([Math.min(d3.min(flat), 100) - 5, Math.max(d3.max(flat), 100) + 5]).range([c.ih, 0]);
tbGrid(c, y);
c.g.append('line').attr('x1', 0).attr('x2', c.iw).attr('y1', y(100)).attr('y2', y(100)).attr('stroke', 'var(--color-fg-muted)').attr('stroke-dasharray', '3,3');
tbLines(c, x, y, months, ser.list, tbTip(c.container), (v) => v.toFixed(0));
tbAxes(c, x, y, months);
tbLegend(legId, ser.list);
}
function drawTbFlow() {
const sd = dash.data('saham'), fd = dash.data('flow'); if (sd.status !== 'ok' || !sd.data || !sd.data.length) return;
const c = tbSvg('chart-tb-flow', 200); if (!c) return; c.m.right = 40; c.iw = c.W - c.m.left - c.m.right; c.g.attr('transform', 'translate(' + c.m.left + ',' + c.m.top + ')');
const rows = sd.data, months = rows.map((r) => r.month);
const fmap = {}; if (fd.status === 'ok' && fd.data) fd.data.forEach((r) => { fmap[r.month] = r.flow_idr_t; });
const fv = months.map((mm) => (fmap[mm] === undefined ? null : fmap[mm]));
const fmax = d3.max(fv.filter((v) => v != null).map(Math.abs)) || 1;
const x = d3.scalePoint().domain(months).range([0, c.iw]).padding(0.5);
const yf = d3.scaleLinear().domain([-fmax * 1.1, fmax * 1.1]).range([c.ih, 0]);
const ivals = rows.map((r) => r.ihsg);
const y = d3.scaleLinear().domain([d3.min(ivals) * 0.95, d3.max(ivals) * 1.03]).range([c.ih, 0]);
tbGrid(c, y);
const tip = tbTip(c.container); const bw = Math.max(4, c.iw / months.length * 0.5);
c.g.append('line').attr('x1', 0).attr('x2', c.iw).attr('y1', yf(0)).attr('y2', yf(0)).attr('stroke', 'var(--color-fg-muted)').attr('stroke-dasharray', '3,3');
fv.forEach((v, i) => { if (v == null) return;
c.g.append('rect').attr('x', x(months[i]) - bw / 2).attr('y', Math.min(yf(0), yf(v))).attr('width', bw).attr('height', Math.max(1, Math.abs(yf(v) - yf(0)))).attr('fill', v < 0 ? '#e34948' : '#1baf7a').attr('opacity', 0.6).style('cursor', 'pointer')
.on('mouseenter', function (event) { const [mx, my] = d3.pointer(event, c.container); tip.show(months[i] + ' · arus asing: <b>' + (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + ' T</b>', mx, my); }).on('mouseleave', () => tip.hide()); });
tbLines(c, x, y, months, [{ label: 'IHSG', vals: ivals, color: '#2a78d6', area: true }], tip, (v) => Math.round(v).toLocaleString('id-ID'));
yf.ticks(4).forEach((tk) => { c.g.append('line').attr('x1', c.iw).attr('x2', c.iw + 5).attr('y1', yf(tk)).attr('y2', yf(tk)).attr('stroke', 'var(--color-fg-muted)'); c.g.append('text').attr('x', c.iw + 8).attr('y', yf(tk) + 4).attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)').text(String(tk).replace('-', '−')); });
tbAxes(c, x, y, months, (v) => Math.round(v).toLocaleString('id-ID'));
const leg = document.getElementById('eo-tb-leg-flow'); if (leg) leg.innerHTML = '<span class="eo-lg" style="--k:#2a78d6">IHSG (kiri)</span> · <span class="eo-lg" style="--k:#1baf7a">net beli asing</span> · <span class="eo-lg" style="--k:#e34948">net jual asing (kanan, Rp T)</span> ·';
}
function tbData() {
const td = dash.data('tambang'); if (td.status !== 'ok' || !td.data || !td.data.length) return null;
const rows = td.data, months = rows.map((r) => r.month);
const kd = dash.data('komoditas'); const kom = (kd.status === 'ok' && kd.data) ? kd.data : [];
const price = (key) => { const kb = kom.find((k) => k.month === months[0] && k[key] != null) || kom.find((k) => k[key] != null); return kb ? rows.map((r) => { const k = kom.find((q) => q.month === r.month); return k && k[key] != null ? k[key] / kb[key] * 100 : null; }) : null; };
return { rows, months, price };
}
function drawTbIhsg() {
const d = tbData(), sd = dash.data('saham'); if (!d || sd.status !== 'ok' || !sd.data) return;
const ih = tbNorm(d.months.map((mm) => { const x = sd.data.find((q) => q.month === mm); return x ? x.ihsg : null; }));
drawTbIndexed('chart-tb-ihsg', 'eo-tb-leg-ihsg', { months: d.months, list: [
{ label: 'IHSG', vals: ih, color: 'var(--color-fg)', dash: true },
{ label: 'Indeks energi', vals: tbNorm(d.rows.map((r) => r.energy)), color: '#eda100' },
{ label: 'Indeks bahan baku', vals: tbNorm(d.rows.map((r) => r.basic)), color: '#8a5cd6' },
{ label: 'Saham batu bara', vals: tbBask(d.rows, ['adro', 'ptba', 'itmg', 'bumi']), color: '#2a78d6' },
{ label: 'Saham logam', vals: tbBask(d.rows, ['antm', 'inco', 'mdka', 'ammn']), color: '#e34948' }] });
}
function drawTbGroup(svgId, legId, names, priceKey, priceLabel) {
const d = tbData(); if (!d) return;
const list = names.map((n) => ({ label: n[0], vals: tbNorm(d.rows.map((r) => r[n[1]])), color: n[2] }));
const p = d.price(priceKey); if (p) list.push({ label: priceLabel, vals: p, color: 'var(--color-fg)', dash: true });
drawTbIndexed(svgId, legId, { months: d.months, list });
}
function drawTbRank() {
const td = dash.data('tambang'); const el = document.getElementById('eo-tb-rank'); if (!el || td.status !== 'ok' || !td.data || td.data.length < 4) return;
const rows = td.data, l = rows[rows.length - 1], f = rows[0], p3 = rows[rows.length - 4];
const names = [['adro', 'ADRO', 'batu bara'], ['ptba', 'PTBA', 'batu bara'], ['itmg', 'ITMG', 'batu bara'], ['bumi', 'BUMI', 'batu bara'], ['antm', 'ANTM', 'nikel/emas'], ['inco', 'INCO', 'nikel'], ['mdka', 'MDKA', 'emas/nikel'], ['ammn', 'AMMN', 'tembaga/emas']];
const list = names.filter((n) => l[n[0]] != null && f[n[0]] != null).map((n) => ({ t: n[1], seg: n[2], px: l[n[0]], c12: (l[n[0]] / f[n[0]] - 1) * 100, c3: p3[n[0]] != null ? (l[n[0]] / p3[n[0]] - 1) * 100 : null }));
list.sort((a, b) => b.c12 - a.c12);
const mx = Math.max.apply(null, list.map((r) => Math.abs(r.c12)).concat([1]));
const sg = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%';
el.innerHTML = '<div style="display:grid;grid-template-columns:auto 1fr auto auto;gap:6px 12px;align-items:center;margin-top:6px">' +
'<span class="eo-rg-rule">Saham</span><span class="eo-rg-rule">sejak ' + f.month + '</span><span class="eo-rg-rule" style="text-align:right">3 bulan</span><span class="eo-rg-rule" style="text-align:right">harga (Rp)</span>' +
list.map((r) => { const w = Math.round(Math.abs(r.c12) / mx * 100); const col = r.c12 >= 0 ? '#1baf7a' : '#e34948';
return '<span><b>' + r.t + '</b> <span class="eo-rg-rule" style="display:inline">' + r.seg + '</span></span>' +
'<span style="display:flex;align-items:center;gap:8px"><span style="display:inline-block;height:8px;width:' + Math.max(3, w * 0.55) + '%;background:' + col + ';opacity:.75;border-radius:2px"></span><span>' + sg(r.c12) + '</span></span>' +
'<span style="text-align:right;color:' + (r.c3 != null && r.c3 < 0 ? '#e34948' : '#1baf7a') + '">' + (r.c3 == null ? '—' : sg(r.c3)) + '</span>' +
'<span style="text-align:right" class="eo-rg-rule">' + Math.round(r.px).toLocaleString('id-ID') + '</span>'; }).join('') + '</div>' +
'<div class="eo-rg-rule">Urut dari yang naik paling tinggi sejak ' + f.month + '. Harga penutupan ' + l.month + '.</div>';
}
function drawTb() {
try { drawTbFlow(); } catch (e) { console.warn('tb', e && e.message); }
try { drawTbIhsg(); } catch (e) { console.warn('tb', e && e.message); }
try { drawTbGroup('chart-tb-coal', 'eo-tb-leg-coal', [['ADRO', 'adro', '#2a78d6'], ['PTBA', 'ptba', '#eda100'], ['ITMG', 'itmg', '#1baf7a'], ['BUMI', 'bumi', '#8a5cd6']], 'coal', 'Harga batu bara dunia'); } catch (e) { console.warn('tb', e && e.message); }
try { drawTbGroup('chart-tb-metal', 'eo-tb-leg-metal', [['ANTM', 'antm', '#2a78d6'], ['INCO', 'inco', '#eda100'], ['MDKA', 'mdka', '#1baf7a'], ['AMMN', 'ammn', '#8a5cd6']], 'nickel', 'Harga nikel dunia'); } catch (e) { console.warn('tb', e && e.message); }
try { drawTbRank(); } catch (e) { console.warn('tb', e && e.message); }
}
dash.onData(drawTb);
let tbRT; window.addEventListener('resize', () => { clearTimeout(tbRT); tbRT = setTimeout(drawTb, 120); });
function makeTooltip(container) {
const tip = document.createElement('div');
tip.className = 'eo-tooltip';
container.style.position = 'relative';
container.appendChild(tip);
return {
show(html, x, y) {
tip.innerHTML = html;
tip.style.opacity = '1';
const w = container.clientWidth;
const tw = tip.offsetWidth;
let left = x + 10;
if (left + tw > w) left = x - tw - 10;
tip.style.left = Math.max(0, left) + 'px';
tip.style.top = Math.max(0, y - 30) + 'px';
},
hide() { tip.style.opacity = '0'; }
};
}
function drawLine(svgId, containerClass, data, xField, yField, opts) {
const svg = d3.select('#' + svgId);
const container = svg.node().closest('.eo-chart-wrap');
const width = container.clientWidth || 300;
const height = opts.height || 180;
const margin = { top: 10, right: 12, bottom: 36, left: 36 };
const innerW = width - margin.left - margin.right;
const innerH = height - margin.top - margin.bottom;
svg.attr('viewBox', '0 0 ' + width + ' ' + height).attr('height', height).style('height', height + 'px').style('max-height', height + 'px');
svg.selectAll('*').remove();
if (!data || !data.length) {
svg.append('text').attr('x', width / 2).attr('y', height / 2).attr('text-anchor', 'middle')
.attr('fill', 'var(--color-fg-muted)').attr('font-size', 12).text('Memuat…');
return;
}
const g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
const x = d3.scalePoint().domain(data.map((d) => d[xField])).range([0, innerW]).padding(0.5);
const yMin = opts.yMin !== undefined ? opts.yMin : d3.min(data, (d) => d[yField]) - 1;
const yMax = opts.yMax !== undefined ? opts.yMax : d3.max(data, (d) => d[yField]) + 1;
const y = d3.scaleLinear().domain([yMin, yMax]).range([innerH, 0]);
g.append('g').attr('class', 'grid')
.call(d3.axisLeft(y).ticks(4).tickSize(-innerW).tickFormat(''))
.call((sel) => sel.select('.domain').remove())
.call((sel) => sel.selectAll('line').attr('stroke', 'var(--color-border-line)').attr('stroke-opacity', 0.6));
if (opts.threshold !== undefined) {
g.append('line')
.attr('x1', 0).attr('x2', innerW)
.attr('y1', y(opts.threshold)).attr('y2', y(opts.threshold))
.attr('stroke', 'var(--color-fg-muted)').attr('stroke-width', 1).attr('stroke-dasharray', '3,3');
}
const line = d3.line().x((d) => x(d[xField])).y((d) => y(d[yField])).curve(d3.curveMonotoneX);
g.append('path').datum(data).attr('fill', 'none').attr('stroke', opts.color)
.attr('stroke-width', 2).attr('d', line);
g.append('path').datum(data).attr('fill', opts.color).attr('fill-opacity', 0.08)
.attr('stroke', 'none')
.attr('d', d3.area().x((d) => x(d[xField])).y0(innerH).y1((d) => y(d[yField])).curve(d3.curveMonotoneX));
const tooltip = makeTooltip(container);
g.selectAll('.pt').data(data).join('circle').attr('class', 'pt')
.attr('cx', (d) => x(d[xField])).attr('cy', (d) => y(d[yField])).attr('r', 3.5)
.attr('fill', opts.color).attr('stroke', 'var(--color-bg)').attr('stroke-width', 1.5)
.style('cursor', 'pointer')
.on('mouseenter', function (event, d) {
const [mx, my] = d3.pointer(event, container);
tooltip.show(d[xField] + ': <b>' + fmt1(d[yField]) + (opts.unit || '') + '</b>', mx, my);
})
.on('mouseleave', () => tooltip.hide());
g.append('g').attr('transform', 'translate(0,' + innerH + ')')
.call(d3.axisBottom(x).tickSize(0))
.call((sel) => sel.select('.domain').attr('stroke', 'var(--color-border-line)'))
.selectAll('text').attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)')
.attr('transform', data.length > 6 ? 'rotate(-35)' : null)
.style('text-anchor', data.length > 6 ? 'end' : 'middle');
g.append('g').call(d3.axisLeft(y).ticks(4))
.call((sel) => sel.select('.domain').remove())
.selectAll('text').attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)');
}
function drawBar(svgId, data, xField, yField, opts) {
const svg = d3.select('#' + svgId);
const container = svg.node().closest('.eo-chart-wrap');
const width = container.clientWidth || 300;
const height = opts.height || 180;
const margin = { top: 10, right: 12, bottom: 36, left: 36 };
const innerW = width - margin.left - margin.right;
const innerH = height - margin.top - margin.bottom;
svg.attr('viewBox', '0 0 ' + width + ' ' + height).attr('height', height).style('height', height + 'px').style('max-height', height + 'px');
svg.selectAll('*').remove();
if (!data || !data.length) {
svg.append('text').attr('x', width / 2).attr('y', height / 2).attr('text-anchor', 'middle')
.attr('fill', 'var(--color-fg-muted)').attr('font-size', 12).text('Memuat…');
return;
}
const g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
const x = d3.scaleBand().domain(data.map((d) => d[xField])).range([0, innerW]).padding(0.35);
const yMin = opts.yMin !== undefined ? opts.yMin : Math.min(0, d3.min(data, (d) => d[yField]));
const yMax = opts.yMax !== undefined ? opts.yMax : d3.max(data, (d) => d[yField]) * 1.15;
const y = d3.scaleLinear().domain([yMin, yMax]).range([innerH, 0]);
g.append('g').attr('class', 'grid')
.call(d3.axisLeft(y).ticks(4).tickSize(-innerW).tickFormat(''))
.call((sel) => sel.select('.domain').remove())
.call((sel) => sel.selectAll('line').attr('stroke', 'var(--color-border-line)').attr('stroke-opacity', 0.6));
const tooltip = makeTooltip(container);
const baseline = Math.max(yMin, Math.min(0, yMax));
if (baseline !== yMin) {
g.append('line').attr('x1', 0).attr('x2', innerW)
.attr('y1', y(baseline)).attr('y2', y(baseline))
.attr('stroke', 'var(--color-fg-muted)').attr('stroke-width', 1);
}
g.selectAll('.bar').data(data).join('rect').attr('class', 'bar')
.attr('x', (d) => x(d[xField])).attr('width', x.bandwidth())
.attr('y', (d) => y(Math.max(d[yField], baseline)))
.attr('height', (d) => (d[yField] === null || d[yField] === undefined) ? 0 : Math.abs(y(d[yField]) - y(baseline)))
.attr('fill', (d) => (opts.negColor && d[yField] < 0) ? opts.negColor : opts.color).attr('rx', 3)
.style('cursor', 'pointer')
.on('mouseenter', function (event, d) {
const [mx, my] = d3.pointer(event, container);
tooltip.show(d[xField] + ': <b>' + (d[yField] === null || d[yField] === undefined ? 'belum ada data' : fmt1(d[yField]) + (opts.unit || '')) + '</b>', mx, my);
})
.on('mouseleave', () => tooltip.hide());
g.append('g').attr('transform', 'translate(0,' + innerH + ')')
.call(d3.axisBottom(x).tickSize(0))
.call((sel) => sel.select('.domain').attr('stroke', 'var(--color-border-line)'))
.selectAll('text').attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)')
.attr('transform', data.length > 6 ? 'rotate(-35)' : null)
.style('text-anchor', data.length > 6 ? 'end' : 'middle');
g.append('g').call(d3.axisLeft(y).ticks(4).tickFormat((d) => d + (opts.unit || '')))
.call((sel) => sel.select('.domain').remove())
.selectAll('text').attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)');
}
function drawGroupBar(svgId, data, xField, series, opts) {
const svg = d3.select('#' + svgId);
const container = svg.node().closest('.eo-chart-wrap');
const width = container.clientWidth || 300;
const height = opts.height || 200;
const margin = { top: 10, right: 12, bottom: 36, left: 36 };
const innerW = width - margin.left - margin.right;
const innerH = height - margin.top - margin.bottom;
svg.attr('viewBox', '0 0 ' + width + ' ' + height).attr('height', height).style('height', height + 'px').style('max-height', height + 'px');
svg.selectAll('*').remove();
if (!data || !data.length) return;
const g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
const x0 = d3.scaleBand().domain(data.map((d) => d[xField])).range([0, innerW]).padding(0.25);
const x1 = d3.scaleBand().domain(series.map((s) => s.field)).range([0, x0.bandwidth()]).padding(0.08);
const y = d3.scaleLinear().domain([opts.yMin, opts.yMax]).range([innerH, 0]);
const baseline = Math.max(opts.yMin, Math.min(0, opts.yMax));
g.append('g').call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(''))
.call((sel) => sel.select('.domain').remove())
.call((sel) => sel.selectAll('line').attr('stroke', 'var(--color-border-line)').attr('stroke-opacity', 0.6));
g.append('line').attr('x1', 0).attr('x2', innerW).attr('y1', y(baseline)).attr('y2', y(baseline))
.attr('stroke', 'var(--color-fg-muted)').attr('stroke-width', 1);
const tooltip = makeTooltip(container);
const fmtv = (v) => (v === null || v === undefined) ? 'belum ada data' : (v >= 0 ? '+' : '') + fmt1(v);
const groups = g.selectAll('.grp').data(data).join('g').attr('class', 'grp')
.attr('transform', (d) => 'translate(' + x0(d[xField]) + ',0)');
series.forEach((s) => {
groups.append('rect')
.attr('x', x1(s.field)).attr('width', x1.bandwidth()).attr('rx', 2)
.attr('y', (d) => d[s.field] === null ? y(baseline) : y(Math.max(d[s.field], baseline)))
.attr('height', (d) => d[s.field] === null ? 0 : Math.abs(y(d[s.field]) - y(baseline)))
.attr('fill', s.color)
.attr('opacity', (d) => (s.partialFlag && d[s.partialFlag]) ? 0.45 : 1);
});
groups.append('rect').attr('x', 0).attr('width', x0.bandwidth()).attr('y', 0).attr('height', innerH)
.attr('fill', 'transparent').style('cursor', 'pointer')
.on('mouseenter', function (event, d) {
const [mx, my] = d3.pointer(event, container);
tooltip.show(d[xField] + '<br>' + series.map((s) => s.label + ': <b>' + fmtv(d[s.field]) + '</b>' + ((s.partialFlag && d[s.partialFlag]) ? ' (parsial)' : '')).join('<br>') + ' Rp T', mx, my);
})
.on('mouseleave', () => tooltip.hide());
g.append('g').attr('transform', 'translate(0,' + innerH + ')')
.call(d3.axisBottom(x0).tickSize(0))
.call((sel) => sel.select('.domain').remove())
.selectAll('text').attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)')
.attr('transform', 'rotate(-35)').style('text-anchor', 'end');
g.append('g').call(d3.axisLeft(y).ticks(5))
.call((sel) => sel.select('.domain').remove())
.selectAll('text').attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)');
}
function drawRateSpread(svgId, data) {
const svg = d3.select('#' + svgId);
const container = svg.node().closest('.eo-chart-wrap');
const width = container.clientWidth || 300;
const height = 200;
const margin = { top: 10, right: 12, bottom: 36, left: 36 };
const innerW = width - margin.left - margin.right;
const innerH = height - margin.top - margin.bottom;
svg.attr('viewBox', '0 0 ' + width + ' ' + height).attr('height', height).style('height', height + 'px').style('max-height', height + 'px');
svg.selectAll('*').remove();
if (!data || !data.length) return;
const g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
const x = d3.scalePoint().domain(data.map((d) => d.month)).range([0, innerW]).padding(0.5);
const y = d3.scaleLinear().domain([3.5, 6.25]).range([innerH, 0]);
g.append('g').call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(''))
.call((sel) => sel.select('.domain').remove())
.call((sel) => sel.selectAll('line').attr('stroke', 'var(--color-border-line)').attr('stroke-opacity', 0.6));
g.append('path').datum(data).attr('fill', '#8a5cd6').attr('fill-opacity', 0.16)
.attr('d', d3.area().x((d) => x(d.month)).y0((d) => y(d.fed_upper)).y1((d) => y(d.bi_rate)).curve(d3.curveStepAfter));
[['bi_rate', '#e34948'], ['fed_upper', '#2a78d6']].forEach((s) => {
g.append('path').datum(data).attr('fill', 'none').attr('stroke', s[1]).attr('stroke-width', 2)
.attr('d', d3.line().x((d) => x(d.month)).y((d) => y(d[s[0]])).curve(d3.curveStepAfter));
g.selectAll('.pt-' + s[0]).data(data).join('circle').attr('class', 'pt-' + s[0])
.attr('cx', (d) => x(d.month)).attr('cy', (d) => y(d[s[0]])).attr('r', 3).attr('fill', s[1]);
});
const tooltip = makeTooltip(container);
g.selectAll('.hov').data(data).join('rect').attr('class', 'hov')
.attr('x', (d) => x(d.month) - x.step() / 2).attr('width', x.step()).attr('y', 0).attr('height', innerH)
.attr('fill', 'transparent').style('cursor', 'pointer')
.on('mouseenter', function (event, d) {
const [mx, my] = d3.pointer(event, container);
tooltip.show(d.month + '<br>BI Rate: <b>' + d.bi_rate.toFixed(2) + '%</b><br>Fed Funds: <b>' + d.fed_upper.toFixed(2) + '%</b><br>Selisih: <b>' + (d.spread >= 0 ? '+' : '−') + Math.abs(d.spread).toFixed(2) + ' poin</b>', mx, my);
})
.on('mouseleave', () => tooltip.hide());
g.append('g').attr('transform', 'translate(0,' + innerH + ')')
.call(d3.axisBottom(x).tickSize(0))
.call((sel) => sel.select('.domain').attr('stroke', 'var(--color-border-line)'))
.selectAll('text').attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)')
.attr('transform', 'rotate(-35)').style('text-anchor', 'end');
g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat((d) => d + '%'))
.call((sel) => sel.select('.domain').remove())
.selectAll('text').attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)');
}
function drawStep(svgId, data, xField, yField, opts) {
const svg = d3.select('#' + svgId);
const container = svg.node().closest('.eo-chart-wrap');
const width = container.clientWidth || 600;
const height = opts.height || 140;
const margin = { top: 10, right: 12, bottom: 36, left: 36 };
const innerW = width - margin.left - margin.right;
const innerH = height - margin.top - margin.bottom;
svg.attr('viewBox', '0 0 ' + width + ' ' + height).attr('height', height).style('height', height + 'px').style('max-height', height + 'px');
svg.selectAll('*').remove();
if (!data || !data.length) {
svg.append('text').attr('x', width / 2).attr('y', height / 2).attr('text-anchor', 'middle')
.attr('fill', 'var(--color-fg-muted)').attr('font-size', 12).text('Memuat…');
return;
}
const g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
const x = d3.scalePoint().domain(data.map((d) => d[xField])).range([0, innerW]).padding(0.5);
const yMin = (opts.yMin !== undefined ? opts.yMin : d3.min(data, (d) => d[yField]) - 0.5);
const yMax = (opts.yMax !== undefined ? opts.yMax : d3.max(data, (d) => d[yField]) + 0.5);
const y = d3.scaleLinear().domain([yMin, yMax]).range([innerH, 0]);
g.append('g').attr('class', 'grid')
.call(d3.axisLeft(y).ticks(3).tickSize(-innerW).tickFormat(''))
.call((sel) => sel.select('.domain').remove())
.call((sel) => sel.selectAll('line').attr('stroke', 'var(--color-border-line)').attr('stroke-opacity', 0.6));
const line = d3.line().x((d) => x(d[xField])).y((d) => y(d[yField])).curve(d3.curveStepAfter);
g.append('path').datum(data).attr('fill', 'none').attr('stroke', opts.color)
.attr('stroke-width', 2).attr('d', line);
const tooltip = makeTooltip(container);
g.selectAll('.pt').data(data).join('circle').attr('class', 'pt')
.attr('cx', (d) => x(d[xField])).attr('cy', (d) => y(d[yField])).attr('r', 3.5)
.attr('fill', opts.color).attr('stroke', 'var(--color-bg)').attr('stroke-width', 1.5)
.style('cursor', 'pointer')
.on('mouseenter', function (event, d) {
const [mx, my] = d3.pointer(event, container);
tooltip.show(d[xField] + ': <b>' + fmt1(d[yField]) + (opts.unit || '') + '</b>', mx, my);
})
.on('mouseleave', () => tooltip.hide());
g.append('g').attr('transform', 'translate(0,' + innerH + ')')
.call(d3.axisBottom(x).tickSize(0))
.call((sel) => sel.select('.domain').attr('stroke', 'var(--color-border-line)'))
.selectAll('text').attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)')
.attr('transform', data.length > 6 ? 'rotate(-35)' : null)
.style('text-anchor', data.length > 6 ? 'end' : 'middle');
g.append('g').call(d3.axisLeft(y).ticks(3).tickFormat((d) => d + (opts.unit || '')))
.call((sel) => sel.select('.domain').remove())
.selectAll('text').attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)');
}
dash.onData(() => {
const gpmi = dash.data('gpmi'); if (gpmi.status === 'ok') drawLine('chart-gpmi', '.eo-chart-wrap', gpmi.data, 'month', 'gpmi', { color: '#2a78d6', threshold: 50, yMin: 48, yMax: 55, unit: '' });
const pmi = dash.data('pmi');
if (pmi.status === 'ok') drawLine('chart-pmi', '.eo-chart-wrap', pmi.data, 'month', 'pmi', { color: '#2a78d6', threshold: 50, yMin: 44, yMax: 56, unit: '' });
const gdp = dash.data('gdp');
if (gdp.status === 'ok') drawBar('chart-gdp', gdp.data, 'quarter', 'gdp_yoy', { color: '#1baf7a', yMin: 4.5, yMax: 6, unit: '%' });
const retail = dash.data('retail');
if (retail.status === 'ok') drawBar('chart-retail', retail.data, 'month', 'retail_yoy', { color: '#1baf7a', yMin: -6, yMax: 7, unit: '%' });
const ikk = dash.data('ikk');
if (ikk.status === 'ok') drawLine('chart-ikk', '.eo-chart-wrap', ikk.data, 'month', 'ikk', { color: '#eda100', threshold: 100, yMin: 95, yMax: 130, unit: '' });
const inflation = dash.data('inflation');
if (inflation.status === 'ok') drawLine('chart-inflation', '.eo-chart-wrap', inflation.data, 'month', 'inflation_yoy', { color: '#8a5cd6', threshold: 3.5, yMin: 2, yMax: 5, unit: '%' });
const ratespread = dash.data('ratespread');
if (ratespread.status === 'ok') drawRateSpread('chart-ratespread', ratespread.data);
const rupiah = dash.data('rupiah');
if (rupiah.status === 'ok') drawLine('chart-rupiah', '.eo-chart-wrap', rupiah.data, 'month', 'usd_idr', { color: '#0f9aa8', yMin: 16000, yMax: 18500, unit: '' });
const flow = dash.data('flow');
if (flow.status === 'ok') drawBar('chart-flow', flow.data, 'month', 'flow_idr_t', { color: '#1baf7a', negColor: '#e34948', yMin: -26, yMax: 15, unit: '' });
const rotation = dash.data('rotation');
if (rotation.status === 'ok') drawGroupBar('chart-rotation', rotation.data, 'month', [{ field: 'stock_idr_t', color: '#2a78d6', label: 'Saham' }, { field: 'sbn_idr_t', color: '#eda100', label: 'SBN', partialFlag: 'partial' }], { yMin: -30, yMax: 26, height: 220 });
const srbi = dash.data('srbi');
if (srbi.status === 'ok') drawBar('chart-srbi', srbi.data, 'month', 'srbi_idr_t', { color: '#8a5cd6', yMin: 100, yMax: 320, unit: '' });
const birate = dash.data('birate');
if (birate.status === 'ok') drawStep('chart-birate', birate.data, 'month', 'bi_rate', { color: '#e34948', yMin: 4.5, yMax: 6.25, unit: '%', height: 160 });
});
window.addEventListener('resize', () => {
const gpmi = dash.data('gpmi'); if (gpmi.status === 'ok') drawLine('chart-gpmi', '.eo-chart-wrap', gpmi.data, 'month', 'gpmi', { color: '#2a78d6', threshold: 50, yMin: 48, yMax: 55, unit: '' });
const pmi = dash.data('pmi'); if (pmi.status === 'ok') drawLine('chart-pmi', '.eo-chart-wrap', pmi.data, 'month', 'pmi', { color: '#2a78d6', threshold: 50, yMin: 44, yMax: 56 });
const gdp = dash.data('gdp'); if (gdp.status === 'ok') drawBar('chart-gdp', gdp.data, 'quarter', 'gdp_yoy', { color: '#1baf7a', yMin: 4.5, yMax: 6, unit: '%' });
const retail = dash.data('retail'); if (retail.status === 'ok') drawBar('chart-retail', retail.data, 'month', 'retail_yoy', { color: '#1baf7a', yMin: -6, yMax: 7, unit: '%' });
const ikk = dash.data('ikk'); if (ikk.status === 'ok') drawLine('chart-ikk', '.eo-chart-wrap', ikk.data, 'month', 'ikk', { color: '#eda100', threshold: 100, yMin: 95, yMax: 130 });
const inflation = dash.data('inflation'); if (inflation.status === 'ok') drawLine('chart-inflation', '.eo-chart-wrap', inflation.data, 'month', 'inflation_yoy', { color: '#8a5cd6', threshold: 3.5, yMin: 2, yMax: 5, unit: '%' });
const ratespread = dash.data('ratespread'); if (ratespread.status === 'ok') drawRateSpread('chart-ratespread', ratespread.data);
const rupiah = dash.data('rupiah'); if (rupiah.status === 'ok') drawLine('chart-rupiah', '.eo-chart-wrap', rupiah.data, 'month', 'usd_idr', { color: '#0f9aa8', yMin: 16000, yMax: 18500, unit: '' });
const flow = dash.data('flow'); if (flow.status === 'ok') drawBar('chart-flow', flow.data, 'month', 'flow_idr_t', { color: '#1baf7a', negColor: '#e34948', yMin: -26, yMax: 15, unit: '' });
const rotation = dash.data('rotation'); if (rotation.status === 'ok') drawGroupBar('chart-rotation', rotation.data, 'month', [{ field: 'stock_idr_t', color: '#2a78d6', label: 'Saham' }, { field: 'sbn_idr_t', color: '#eda100', label: 'SBN', partialFlag: 'partial' }], { yMin: -30, yMax: 26, height: 220 });
const srbi = dash.data('srbi'); if (srbi.status === 'ok') drawBar('chart-srbi', srbi.data, 'month', 'srbi_idr_t', { color: '#8a5cd6', yMin: 100, yMax: 320, unit: '' });
const birate = dash.data('birate'); if (birate.status === 'ok') drawStep('chart-birate', birate.data, 'month', 'bi_rate', { color: '#e34948', yMin: 4.5, yMax: 6.25, unit: '%', height: 160 });
});
const eoDec = (str) => ({ type: 'FeatureCollection', features: str.split('#').map((f) => { let id = ''; const k = f.indexOf(':'); if (k >= 0) { id = f.slice(0, k); f = f.slice(k + 1); } return { type: 'Feature', properties: { i: id }, geometry: { type: 'MultiPolygon', coordinates: f.split('|').map((p) => p.split(';').map((r) => { const a = r.split(',').map(Number), o = []; let x = 0, y = 0; for (let q = 0; q < a.length; q += 2) { x += a[q]; y += a[q + 1]; o.push([x / 10, y / 10]); } return o; })) } }; }) });
let EO_LAND = { features: [] };
let EO_CTRY = { features: [] };
const EO_FIXED = { global: { name: 'Dunia (agregat)', c: [25, 8], symbolic: true }, id: { name: 'Indonesia', c: [106.85, -6.2], city: 'Jakarta' } };
const EO_REG = [
{ key: 'coal', name: 'Kalimantan · batu bara', c: [116.5, 0.5], col: '#5b6470' },
{ key: 'nickel', name: 'Sulawesi · nikel', c: [121.9, -2.8], col: '#0f9aa8' },
{ key: 'cpo', name: 'Riau · sawit', c: [101.5, 0.3], col: '#1baf7a' },
];
const EO_CH = [
{ id: 'trade', label: 'Perdagangan per mitra', conf: ['trade'] },
{ id: 'china', from: 'china', to: 'id', label: 'Pabrik China (pembeli terbesar)', curv: 0.22, conf: ['cpmi', 'pmi'] },
{ id: 'commodity', label: 'Harga komoditas ekspor', conf: ['komoditas'] },
{ id: 'demand', from: 'global', to: 'id', label: 'Permintaan global (PMI)', curv: -0.28, conf: ['gpmi', 'pmi'] },
{ id: 'usdemand', from: 'global', to: 'us', label: 'Pabrik AS vs dunia', curv: -0.22, conf: ['gpmi', 'ism', 'gdpus'] },
{ id: 'rate', from: 'us', to: 'id', label: 'Selisih suku bunga', curv: -0.34, conf: ['birate', 'fed'] },
{ id: 'fx', from: 'us', to: 'id', label: 'Kurs USD/IDR', curv: 0.30, conf: ['rupiah'] },
{ id: 'flow', from: 'global', to: 'id', label: 'Arus modal asing', curv: 0.28, conf: ['flow'] },
{ id: 'asia', label: 'IHSG vs Asia', conf: ['sahamasia'] },
];
let eoSel = 'trade', eoM = null;
const eoFmt = (v, d) => (v === null || v === undefined || isNaN(v)) ? '–' : Number(v).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
const eoSgn = (v, d) => (v >= 0 ? '+' : '−') + eoFmt(Math.abs(v), d);
const eoLast = (a) => a[a.length - 1];
const eoNN = (a) => a.filter((v) => v !== null && v !== undefined && !isNaN(v));
const eoNum = (v) => (v === null || v === undefined || v === '' || isNaN(Number(String(v).replace(/,/g, '')))) ? null : Number(String(v).replace(/,/g, ''));
function eoPearson(a, b) { const p = a.map((x, i) => [x, b[i]]).filter((r) => r[0] != null && r[1] != null && !isNaN(r[0]) && !isNaN(r[1])); const n = p.length; if (n < 3) return { r: NaN, n }; const mx = d3.mean(p, (r) => r[0]), my = d3.mean(p, (r) => r[1]); let sxy = 0, sx = 0, sy = 0; p.forEach((r) => { sxy += (r[0] - mx) * (r[1] - my); sx += (r[0] - mx) ** 2; sy += (r[1] - my) ** 2; }); return { r: sxy / Math.sqrt(sx * sy), n }; }
const EO_ASIA = [
{ k: 'ihsg', lab: 1, ct: 'id', n: 'Indonesia (IHSG)', s: 'IHSG', c: [106.85, -6.2], id: 1, dx: 0, dy: 24, a: 'middle' },
{ k: 'eido', n: 'Indonesia (EIDO, USD)', usd: 1, id: 1 },
{ k: 'spx', lab: 1, ct: 'us', n: 'AS (S&P 500)', s: 'AS', c: [-98, 39], dy: -12 },
{ k: 'nifty', lab: 1, ct: 'in', n: 'India (Nifty 50)', s: 'India', c: [78, 22], dy: -12 },
{ k: 'kospi', lab: 1, ct: 'kr', n: 'Korea (KOSPI)', s: 'Korea', c: [127.8, 36.5], dx: 0, dy: -10, a: 'middle' },
{ k: 'nikkei', lab: 1, ct: 'jp', n: 'Jepang (Nikkei 225)', s: 'Jepang', c: [138.5, 36.5], dx: 9, dy: 4, a: 'start' },
{ k: 'hsi', n: 'Hong Kong (Hang Seng)', s: 'HK', c: [114.2, 22.3], dx: -9, dy: 4, a: 'end' },
{ k: 'taiex', lab: 1, ct: 'tw', n: 'Taiwan (TAIEX)', s: 'Taiwan', c: [121.3, 24], dx: 9, dy: 4, a: 'start' },
{ k: 'asx', lab: 1, ct: 'au', n: 'Australia (ASX 200)', s: 'Australia', c: [134, -25], dy: -12 },
{ k: 'sz', lab: 1, ct: 'cn', n: 'China (Shenzhen)', s: 'China', c: [100, 33], dy: 0 },
{ k: 'thd', ct: 'th', n: 'Thailand (ETF THD, USD)', s: 'TH', c: [100.8, 15.5], usd: 1, dx: -9, dy: 4, a: 'end' },
{ k: 'vnm', ct: 'vn', n: 'Vietnam (ETF VNM, USD)', s: 'VN', c: [107.8, 14], usd: 1, dx: 9, dy: 0, a: 'start' },
{ k: 'ephe', ct: 'ph', n: 'Filipina (ETF EPHE, USD)', s: 'PH', c: [122.5, 12.5], usd: 1, dx: 9, dy: 4, a: 'start' },
{ k: 'ewm', ct: 'my', n: 'Malaysia (ETF EWM, USD)', s: 'MY', c: [102, 4.2], usd: 1, dx: -9, dy: 4, a: 'end' },
{ k: 'ews', n: 'Singapura (ETF EWS, USD)', s: 'SG', c: [104.2, 1.0], usd: 1, dx: 9, dy: -2, a: 'start' },
{ k: 'eem', n: 'Pasar berkembang (ETF EEM, USD)', usd: 1 },
];
function eoAsiaCol(p) { return p < 0 ? 'var(--eo-c-out)' : 'var(--eo-c-in)'; }
function eoAsiaModel(rows) {
if (!rows || rows.length < 3) return null;
const mo = rows.map((r) => r.month);
const pick = (k) => rows.map((r) => r[k]);
const ent = EO_ASIA.map((e) => { const v = eoNN(pick(e.k)); const a = pick(e.k); return Object.assign({}, e, { vals: a, p: v.length > 1 ? (eoLast(v) / v[0] - 1) * 100 : null, dd: v.length ? (eoLast(v) / d3.max(v) - 1) * 100 : null }); }).filter((e) => e.p !== null);
const ih = ent.find((e) => e.k === 'ihsg'), ei = ent.find((e) => e.k === 'eido');
if (!ih) return null;
const se = ent.find((e) => e.k === eoAsiaSel) || ih;
const others = ent.filter((e) => !e.id);
const worse = others.filter((e) => e.p < ih.p).length;
const idx = (a) => { const b = eoNN(a)[0]; return a.map((v) => v == null || !b ? null : Math.round(v / b * 1000) / 10); };
const sr = (k, n, col) => { const e = ent.find((x) => x.k === k); return e ? [n, idx(e.vals), col] : null; };
return {
mo, ent, ih, ei, se, col: eoAsiaCol(se.p), value: se.n.split(' (')[0] + ' ' + eoSgn(se.p, 1) + '%',
unit: mo[0] + ' → ' + eoLast(mo) + ' · ' + (se.usd ? 'ETF dalam USD' : 'indeks mata uang lokal') + ' · penutupan akhir bulan',
sub: 'Peringkat ' + (ent.slice().sort((a, b) => b.p - a.p).findIndex((x) => x.k === se.k) + 1) + ' dari ' + ent.length + ' · dari puncak ' + eoSgn(se.dd, 1) + '%' + (se.k === 'ihsg' && ei ? ' · versi USD (EIDO) ' + eoSgn(ei.p, 1) + '%' : ''),
series: (se.k === 'ihsg' ? [sr('ihsg', 'IHSG', 'var(--eo-c-out)'), sr('kospi', 'KOSPI Korea', 'var(--eo-c-in)'), sr('nifty', 'Nifty India', 'var(--eo-c-ikk)'), sr('eem', 'EEM (USD)', 'var(--color-fg)')] : [sr(se.k, se.n.split(' (')[0], 'var(--eo-c-ikk)'), sr('ihsg', 'IHSG', 'var(--eo-c-out)'), se.k === 'eem' ? null : sr('eem', 'EEM (USD)', 'var(--color-fg)')]).filter(Boolean), th: 100, dec: 0, rank: true, months: mo,
expl: 'Perubahan harga penutupan akhir bulan dari awal sampai akhir periode. Indeks Asia memakai mata uang lokal; ETF (berkode USD) memakai dolar sehingga ikut mencerminkan pelemahan mata uangnya. Jika semua pasar Asia turun bersama, penyebabnya regional; jika hanya Indonesia, penyebabnya lebih domestik. Ini perbandingan deskriptif, bukan bukti sebab-akibat.',
};
}
function eoBuild() {
const need = ['gpmi', 'pmi', 'ism', 'birate', 'fed', 'rupiah', 'flow'];
const ds = {}; for (const k of need) { const d = dash.data(k); if (d.status !== 'ok' || !d.data || !d.data.length) return null; ds[k] = d.data; }
const opt = (k) => { const d = dash.data(k); return (d.status === 'ok' && d.data) ? d.data : []; };
const gdpus = opt('gdpus').filter((r) => r.gdp_us != null);
const trade = opt('trade').filter((r) => r.lon != null && r.lat != null);
const months = ds.gpmi.map((r) => r.month);
const pick = (rows, f) => months.map((m) => { const r = rows.find((x) => x.month === m); return r ? eoNum(r[f]) : null; });
const kom = opt('komoditas'), cp = opt('cpmi');
const s = { months, g: pick(ds.gpmi, 'gpmi'), idp: pick(ds.pmi, 'pmi'), ism: pick(ds.ism, 'ism'), bi: pick(ds.birate, 'bi_rate'), fed: pick(ds.fed, 'fed_upper'), fx: pick(ds.rupiah, 'usd_idr'), fl: pick(ds.flow, 'flow_idr_t'), gdpus, trade,
cn: pick(cp, 'cpmi'), coal: pick(kom, 'coal'), cpo: pick(kom, 'cpo'), nickel: pick(kom, 'nickel') };
s.spread = s.bi.map((v, i) => (v != null && s.fed[i] != null) ? Math.round((v - s.fed[i]) * 100) / 100 : null);
s.nodes = { global: EO_FIXED.global, id: EO_FIXED.id };
trade.forEach((r) => { const key = /amerika/i.test(r.partner) ? 'us' : /china|tiongkok/i.test(r.partner) ? 'china' : r.partner; s.nodes[key] = { name: r.partner, c: [r.lon, r.lat], partner: r }; });
if (!s.nodes.us) s.nodes.us = { name: 'Amerika Serikat', c: [-77.04, 38.9] };
if (!s.nodes.china) s.nodes.china = { name: 'China', c: [116.4, 39.9] };
const lm = eoLast(months);
const flow3 = d3.sum(eoNN(s.fl.slice(-3)));
const gq = gdpus.length ? eoLast(gdpus) : null, gq0 = gdpus.length > 1 ? gdpus[gdpus.length - 2] : null;
const mag = (v, lo, hi) => Math.max(0.1, Math.min(1, (v - lo) / ((hi - lo) || 1)));
const idx = (a) => { const b = eoNN(a)[0]; return a.map((v) => v == null || !b ? null : Math.round(v / b * 1000) / 10); };
const pct = (a) => { const n = eoNN(a); return n.length > 1 ? (eoLast(n) / n[0] - 1) * 100 : NaN; };
const top = trade.filter((r) => r.exp != null).sort((a, b) => b.exp - a.exp);
const cnBelow = eoNN(s.cn).filter((v) => v < 50).length;
const asiaM = eoAsiaModel(opt('sahamasia'));
s.M = {
asia: asiaM || { value: '–', unit: 'Belum ada data Saham Asia', sub: '', col: 'var(--color-fg-muted)', series: [], expl: '' },
trade: { value: top.length ? top[0].partner + ' · ' + eoFmt(top[0].exp, 1) : '–', unit: 'ekspor nonmigas terbesar, USD miliar, Jan–Agu 2026', sub: 'Tebal garis = nilai ekspor ke mitra. Garis abu-abu = ekspor belum ada di data.', col: 'var(--eo-c-in)', bars: true,
expl: 'Jalur barang: ke mana Indonesia menjual produknya. Makin besar porsi ke satu mitra, makin besar ketergantungan pada kondisi ekonomi mitra itu. Batang tipis = impor dari mitra yang sama; selisihnya adalah surplus atau defisit dagang.' },
china: { value: eoFmt(eoLast(s.cn), 1), unit: 'PMI manufaktur China (NBS), ' + lm, sub: 'di bawah 50 pada ' + cnBelow + ' dari ' + eoNN(s.cn).length + ' bulan · PMI Indonesia ' + eoFmt(eoLast(s.idp), 1), mag: mag(eoLast(s.cn), 47, 52), col: 'var(--eo-c-out)',
series: [['PMI China', s.cn, 'var(--eo-c-out)'], ['PMI Indonesia', s.idp, 'var(--eo-c-pmi)']], th: 50,
expl: 'China adalah pasar ekspor terbesar Indonesia. PMI China menunjukkan apakah pabrik di sana sedang menambah atau mengurangi produksi, yang menentukan permintaan bahan baku seperti batu bara, nikel, dan baja.' },
commodity: { value: eoSgn(pct(s.coal), 0) + '%', unit: 'batu bara, ' + months[0] + ' → ' + lm, sub: 'CPO ' + eoSgn(pct(s.cpo), 0) + '% · nikel ' + eoSgn(pct(s.nickel), 0) + '% (harga dunia, USD)', col: 'var(--eo-c-ikk)',
series: [['Batu bara', idx(s.coal), '#5b6470'], ['CPO', idx(s.cpo), 'var(--eo-c-in)'], ['Nikel', idx(s.nickel), 'var(--eo-c-idr)']], th: 100, dec: 0,
expl: 'Harga dunia untuk tiga komoditas ekspor utama, diindeks (' + months[0] + ' = 100). Titik di peta menunjukkan wilayah penghasil utamanya. Harga naik berarti pendapatan ekspor dan daerah penghasil cenderung terbantu.' },
demand: { value: eoFmt(eoLast(s.g), 1), unit: 'PMI Global, ' + lm, sub: 'PMI Indonesia ' + eoFmt(eoLast(s.idp), 1) + ' · batas ekspansi = 50', mag: mag(eoLast(s.g), 45, d3.max(eoNN(s.g))), col: 'var(--eo-c-pmi)',
series: [['PMI Global', s.g, 'var(--eo-c-pmi)'], ['PMI Indonesia', s.idp, 'var(--eo-c-out)']], th: 50,
expl: 'PMI manufaktur adalah survei manajer pabrik: di atas 50 berarti produksi berekspansi. PMI Global menggambarkan permintaan dunia akan barang; PMI Indonesia menggambarkan pabrik dalam negeri.' },
usdemand: { value: eoFmt(eoLast(s.ism), 1), unit: 'ISM manufaktur AS, ' + lm, sub: gq ? 'PDB AS ' + gq.quarter + ' ' + eoSgn(gq.gdp_us, 1) + '% (laju tahunan)' + (gq0 ? ' · ' + gq0.quarter + ' ' + eoFmt(gq0.gdp_us, 1) + '%' : '') : '', mag: mag(eoLast(s.ism), 45, d3.max(eoNN(s.ism))), col: 'var(--eo-c-us)',
series: [['PMI Global', s.g, 'var(--eo-c-pmi)'], ['ISM AS', s.ism, 'var(--eo-c-us)']], th: 50,
expl: 'ISM adalah survei pabrik AS, setara PMI. Jalur ini menunjukkan apakah ekonomi AS lebih panas atau lebih dingin dari dunia, yang ikut menentukan arah bunga The Fed.' },
rate: { value: eoSgn(eoLast(s.spread), 2) + ' poin', unit: 'BI Rate − Fed Funds, ' + lm, sub: 'BI Rate ' + eoFmt(eoLast(s.bi), 2) + '% · Fed Funds (batas atas) ' + eoFmt(eoLast(s.fed), 2) + '%', mag: eoLast(s.spread) / (d3.max(eoNN(s.spread)) || 1), col: 'var(--eo-c-ikk)',
series: [['BI Rate', s.bi, 'var(--eo-c-ikk)'], ['Fed Funds (batas atas)', s.fed, 'var(--color-fg)']], step: true, zero: true,
expl: 'Selisih bunga adalah BI Rate dikurangi batas atas Fed Funds Rate. Makin lebar, makin besar imbal hasil tambahan dari menaruh dana di Rupiah dibanding Dolar.' },
fx: { value: eoFmt(eoLast(s.fx), 0), unit: 'Rp per USD, rata-rata ' + lm, sub: eoSgn((eoLast(s.fx) / s.fx[0] - 1) * 100, 1) + '% vs ' + months[0] + ' (naik = Rupiah melemah)', mag: 0.2 + 0.8 * mag(eoLast(s.fx), d3.min(eoNN(s.fx)), d3.max(eoNN(s.fx))), col: 'var(--eo-c-idr)',
series: [['USD/IDR', s.fx, 'var(--eo-c-idr)']], dec: 0,
expl: 'USD/IDR adalah jumlah Rupiah untuk 1 Dolar; naik berarti Rupiah melemah. Kurs memengaruhi biaya impor, utang berdolar, dan nilai investasi asing.' },
flow: { value: eoSgn(flow3, 1) + ' T', unit: 'net asing saham, 3 bulan terakhir (Rp)', sub: flow3 < 0 ? 'Dana keluar bersih dari saham Indonesia' : 'Dana masuk bersih ke saham Indonesia', mag: Math.min(1, Math.abs(flow3) / (d3.max(eoNN(s.fl).map(Math.abs)) || 1)), col: flow3 < 0 ? 'var(--eo-c-out)' : 'var(--eo-c-in)', rev: flow3 < 0,
series: [['Net asing saham', s.fl, 'var(--eo-c-out)']], flowbars: true, dec: 0,
expl: 'Net asing adalah pembelian dikurangi penjualan saham oleh investor asing. Positif = dana masuk, negatif = keluar. Angkanya agregat semua negara.' },
};
return s;
}
function eoChips() {
const el = document.getElementById('eo-map-chips'); if (!el || el.childElementCount) return;
EO_CH.forEach((c) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'eo-map-chip'; b.id = 'eo-chip-' + c.id; b.innerHTML = '<i></i>' + c.label; b.addEventListener('click', () => eoSelect(c.id)); el.appendChild(b); });
}
function eoSegments(c) {
const m = eoM.M[c.id];
if (c.id === 'trade') {
const mx = d3.max(eoM.trade, (r) => r.exp || 0) || 1;
return eoM.trade.map((r, k) => { const key = /amerika/i.test(r.partner) ? 'us' : /china|tiongkok/i.test(r.partner) ? 'china' : r.partner; return { from: 'id', to: key, w: r.exp != null ? 1.2 + 6 * r.exp / mx : 1, col: r.exp != null ? 'var(--eo-c-in)' : 'var(--color-fg-muted)', curv: k % 2 ? 0.18 : -0.18, dashed: r.exp == null, tip: r.partner + ': ekspor ' + (r.exp != null ? eoFmt(r.exp, 2) : '–') + ' · impor ' + (r.imp != null ? eoFmt(r.imp, 2) : '–') + ' (USD miliar)' }; });
}
if (c.id === 'asia') return [];
if (c.id === 'commodity') return EO_REG.map((g, k) => ({ from: 'global', toC: g.c, w: 2.5, col: g.col, curv: [0.12, -0.08, 0.2][k], tip: g.name }));
return [{ from: c.from, to: c.to, w: 1.5 + 5 * Math.max(0.1, Math.min(1, m.mag || 0.1)), col: m.col, curv: c.curv, rev: m.rev, tip: m.value + ' · ' + m.unit }];
}
function eoDrawMap() {
const box = document.getElementById('eo-map-box'); if (!box) return;
const svg = d3.select('#eo-map-svg'); const asiaV = eoSel === 'asia', W = box.clientWidth || 600, H = asiaV ? Math.round(Math.max(240, W * 0.66)) : Math.round(Math.max(220, W * 0.5)); const L0 = asiaV ? 66 : -180, L1 = asiaV ? 154 : 180, T0 = asiaV ? 46 : 85, T1 = asiaV ? -12 : -60;
svg.attr('viewBox', '0 0 ' + W + ' ' + H).attr('height', H).style('height', H + 'px').selectAll('*').remove();
const pf = d3.geoNaturalEarth1 || d3.geoEqualEarth || d3.geoEquirectangular || d3.geoMercator;
let proj, path;
if (pf && d3.geoPath) { proj = pf().fitExtent([[4, 4], [W - 4, H - 4]], asiaV ? { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[L0, T1], [L1, T1], [L1, T0], [L0, T0], [L0, T1]]] } } : { type: 'Sphere' }); path = d3.geoPath(proj); }
else {
proj = (c) => [W * (c[0] - L0) / (L1 - L0), H * (T0 - c[1]) / (T0 - T1)];
const ring = (r) => { let s = ''; for (let k = 0; k < r.length; k++) { const p = proj(r[k]); const jump = k > 0 && Math.abs(r[k][0] - r[k - 1][0]) > 180; s += (k === 0 || jump ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1); } return s + 'Z'; };
path = (o) => {
if (o.type === 'Sphere') return 'M0,0H' + W + 'V' + H + 'H0Z';
const polys = []; (o.features || [o]).forEach((f) => { const g = f.geometry || f; if (g.type === 'Polygon') polys.push(g.coordinates); else if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => polys.push(p)); });
return polys.map((p) => p.map(ring).join('')).join('');
};
}
svg.append('path').attr('class', 'eo-map-sea').attr('d', path({ type: 'Sphere' }));
if (d3.geoGraticule10 && d3.geoPath && pf) svg.append('path').attr('class', 'eo-map-grat').attr('d', path(d3.geoGraticule10()));
svg.append('path').attr('class', 'eo-map-land').attr('d', path(EO_LAND));
if (!eoM) { svg.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle').attr('fill', 'var(--color-fg-muted)').attr('font-size', 12).text('Memuat data koneksi…'); return; }
const P = (key) => proj((eoM.nodes[key] || EO_FIXED[key]).c);
const gA = svg.append('g'), gH = svg.append('g'), gN = svg.append('g');
const tip = document.getElementById('eo-map-tip');
EO_CH.forEach((c) => {
const segs = eoSegments(c);
segs.forEach((sg, j) => {
if (!sg.toC && !eoM.nodes[sg.to] && !EO_FIXED[sg.to]) return;
const a = P(sg.from), b = sg.toC ? proj(sg.toC) : P(sg.to);
const dx = b[0] - a[0], dy = b[1] - a[1], dist = Math.hypot(dx, dy) || 1, k = (sg.curv || 0.2) * dist;
const cx = (a[0] + b[0]) / 2 - dy / dist * k, cy = (a[1] + b[1]) / 2 + dx / dist * k;
const d = sg.rev ? 'M' + b[0] + ',' + b[1] + ' Q' + cx + ',' + cy + ' ' + a[0] + ',' + a[1] : 'M' + a[0] + ',' + a[1] + ' Q' + cx + ',' + cy + ' ' + b[0] + ',' + b[1];
const cls = 'eo-ch-' + c.id;
gA.append('path').attr('class', 'eo-map-arc ' + cls).attr('d', d).attr('stroke', sg.col).attr('stroke-width', Math.max(1, sg.w * 0.35)).attr('opacity', 0.35);
const p = gA.append('path').attr('class', 'eo-map-arc ' + cls + (sg.dashed ? '' : ' flowing') + (sg.rev ? ' rev' : '')).attr('d', d).attr('stroke', sg.col).attr('stroke-width', sg.w);
if (sg.dashed) p.attr('stroke-dasharray', '3 5');
gH.append('path').attr('class', 'eo-map-hit').attr('d', d).attr('tabindex', 0).attr('role', 'button').attr('aria-label', c.label)
.on('click', () => eoSelect(c.id)).on('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); eoSelect(c.id); } })
.on('mousemove', (e) => { const r = box.getBoundingClientRect(); tip.innerHTML = '<b>' + c.label + '</b><br>' + sg.tip; tip.style.left = Math.min(r.width - 220, Math.max(4, e.clientX - r.left + 12)) + 'px'; tip.style.top = Math.max(4, e.clientY - r.top - 36) + 'px'; tip.style.opacity = 1; })
.on('mouseleave', () => { tip.style.opacity = 0; });
});
});
const gR = gN.append('g').attr('id', 'eo-reg');
EO_REG.forEach((g, k) => { const [x, y] = proj(g.c); const n = gR.append('g').attr('class', 'eo-map-node').attr('transform', 'translate(' + x + ',' + y + ')'); n.append('circle').attr('r', 4.5).attr('fill', g.col).attr('stroke', 'var(--color-panel)').attr('stroke-width', 1.5); n.append('text').attr('class', 'small').attr('x', 7).attr('y', [-6, 12, -6][k]).attr('text-anchor', k === 2 ? 'end' : 'start').attr('dx', k === 2 ? -14 : 0).text(g.name); });
const gAs = gN.append('g').attr('id', 'eo-asia');
if (eoM.M.asia && eoM.M.asia.ent) {
const A = eoM.M.asia, showTip = (ev, e) => { const rr = box.getBoundingClientRect(); tip.innerHTML = '<b>' + e.n + '</b><br>' + eoSgn(e.p, 1) + '% sejak ' + A.mo[0] + (e.usd ? ' (USD)' : ' (mata uang lokal)') + '<br>dari puncak ' + eoSgn(e.dd, 1) + '% · klik untuk detail'; tip.style.left = Math.min(rr.width - 220, Math.max(4, ev.clientX - rr.left + 12)) + 'px'; tip.style.top = Math.max(4, ev.clientY - rr.top - 56) + 'px'; tip.style.opacity = 1; };
const hide = () => { tip.style.opacity = 0; };
const ordered = A.ent.filter((e) => e.ct || e.c).sort((a, b) => (a.k === A.se.k) - (b.k === A.se.k));
ordered.forEach((e) => {
const on = e.k === A.se.k, fo = 0.3 + 0.7 * Math.min(1, Math.abs(e.p) / 45), col = eoAsiaCol(e.p);
const ft = e.ct && EO_CTRY.features.find((f) => f.properties.i === e.ct);
let el;
if (ft) el = gAs.append('path').attr('d', path(ft));
else { const [x, y] = proj(e.c); el = gAs.append('circle').attr('cx', x).attr('cy', y).attr('r', 5); }
el.attr('fill', col).attr('fill-opacity', fo).attr('stroke', on ? 'var(--color-fg)' : 'var(--color-panel)').attr('stroke-width', on ? 1.6 : 0.8).attr('stroke-linejoin', 'round').attr('tabindex', 0).attr('role', 'button').attr('aria-label', e.n + ' ' + eoSgn(e.p, 1) + '%').style('cursor', 'pointer')
.on('click', () => eoAsiaPick(e.k)).on('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); eoAsiaPick(e.k); } });
});
['spx', 'asx'].forEach((pk, pi) => { const u = A.ent.find((e) => e.k === pk); if (!u) return; const gu = gAs.append('g').attr('class', 'eo-map-node').style('cursor', 'pointer').attr('transform', 'translate(10,' + (H - 12 - pi * 16) + ')').on('click', () => eoAsiaPick(pk)); gu.append('text').attr('class', 'small').attr('text-anchor', 'start').text(u.n.split(' (')[0] + ' (' + (pk === 'spx' ? 'S&P 500' : 'ASX 200') + ') ' + eoSgn(u.p, 0) + '% · klik untuk detail'); });
ordered.filter((e) => (e.lab && e.k !== 'spx' && e.k !== 'asx') || e.k === A.se.k).forEach((e) => { const [x, y] = proj(e.c); gAs.append('g').attr('class', 'eo-map-node').append('text').attr('class', 'small').attr('pointer-events', 'none').attr('x', x + (e.dx || 0)).attr('y', y + (e.dy === undefined ? -8 : e.dy)).attr('text-anchor', e.a || 'middle').attr('font-weight', e.k === A.se.k ? 700 : 600).text(eoSgn(e.p, 0) + '%'); });
}
Object.keys(eoM.nodes).forEach((key) => {
const n = eoM.nodes[key], [x, y] = proj(n.c), main = key === 'id' || key === 'us' || key === 'global';
const g = gN.append('g').attr('class', 'eo-map-node eo-base').attr('transform', 'translate(' + x + ',' + y + ')');
if (n.symbolic) g.append('circle').attr('r', 16).attr('fill', 'none').attr('stroke', 'var(--color-fg-muted)').attr('stroke-dasharray', '3 3');
g.append('circle').attr('r', key === 'id' ? 8 : main ? 6 : 4.5).attr('fill', key === 'id' ? 'var(--eo-c-out)' : 'var(--color-fg)').attr('stroke', 'var(--color-panel)').attr('stroke-width', 2);
const dy = key === 'us' ? -14 : key === 'global' ? -24 : key === 'id' ? 20 : -9;
g.append('text').attr('class', main ? '' : 'small').attr('y', dy).attr('text-anchor', 'middle').text(n.name);
});
eoApply();
}
function eoApply() {
EO_CH.forEach((c) => {
const on = c.id === eoSel;
d3.selectAll('.eo-ch-' + c.id).classed('eo-map-dim', !on).style('display', (on || c.id !== 'trade' && c.id !== 'commodity' && eoSel !== 'asia') ? null : 'none');
const b = document.getElementById('eo-chip-' + c.id);
if (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); const i = b.querySelector('i'); if (i && eoM) i.style.background = eoM.M[c.id].col; }
});
d3.select('#eo-reg').style('display', eoSel === 'commodity' ? null : 'none');
d3.select('#eo-asia').style('display', eoSel === 'asia' ? null : 'none');
d3.selectAll('.eo-base').style('display', eoSel === 'asia' ? 'none' : null);
d3.selectAll('.eo-map-hit').style('display', eoSel === 'asia' ? 'none' : null);
if (eoSel === 'asia') { const t = document.getElementById('eo-map-tip'); if (t) t.style.opacity = 0; }
}
function eoTradeBars() {
const rows = eoM.trade.slice().sort((a, b) => (b.exp || 0) - (a.exp || 0));
const W = 340, rh = 22, H = rows.length * rh + 8, l = 92, mx = d3.max(rows, (r) => Math.max(r.exp || 0, r.imp || 0)) || 1, sc = (v) => (W - l - 44) * v / mx;
let s = '<svg class="eo-map-spark" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Ekspor dan impor per mitra">';
rows.forEach((r, i) => { const y = 4 + i * rh;
s += '<text x="' + (l - 6) + '" y="' + (y + 12) + '" text-anchor="end">' + r.partner + '</text>';
if (r.exp != null) s += '<rect x="' + l + '" y="' + (y + 2) + '" width="' + sc(r.exp) + '" height="10" fill="var(--eo-c-in)"/><text x="' + (l + sc(r.exp) + 4) + '" y="' + (y + 11) + '">' + eoFmt(r.exp, 1) + '</text>';
else s += '<text x="' + l + '" y="' + (y + 11) + '">ekspor –</text>';
if (r.imp != null) s += '<rect x="' + l + '" y="' + (y + 14) + '" width="' + sc(r.imp) + '" height="4" fill="var(--color-fg-muted)"/>';
});
return s + '</svg><div class="eo-map-leg"><span style="--k:var(--eo-c-in)">Ekspor</span><span style="--k:var(--color-fg-muted)">Impor</span></div>';
}
function eoSpark(m, months) {
const W = 340, H = 130, mg = { l: 40, r: 10, t: 10, b: 22 }, iw = W - mg.l - mg.r, ih = H - mg.t - mg.b;
const all = m.series.flatMap((x) => eoNN(x[1])); if (!all.length) return '<div class="eo-map-sub">Belum ada data.</div>';
let lo = d3.min(all), hi = d3.max(all);
if (m.th) { lo = Math.min(lo, m.th); hi = Math.max(hi, m.th); } if (m.flowbars || m.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
const x = (i) => mg.l + iw * i / (months.length - 1), y = (v) => mg.t + ih * (1 - (v - lo) / (hi - lo)); const dec = m.dec !== undefined ? m.dec : 1;
let s = '<svg class="eo-map-spark" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Grafik 12 bulan">';
d3.ticks(lo, hi, 3).forEach((t) => { s += '<line x1="' + mg.l + '" x2="' + (W - mg.r) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="var(--eo-grid)"/><text x="' + (mg.l - 5) + '" y="' + (y(t) + 3) + '" text-anchor="end">' + eoFmt(t, dec) + '</text>'; });
if (m.th) s += '<line x1="' + mg.l + '" x2="' + (W - mg.r) + '" y1="' + y(m.th) + '" y2="' + y(m.th) + '" stroke="var(--color-fg-muted)" stroke-dasharray="4 3"/>';
if (m.flowbars) {
const bw = iw / months.length * 0.62;
m.series[0][1].forEach((v, i) => { if (v == null) return; const y0 = y(0), y1 = y(v); s += '<rect x="' + (x(i) - bw / 2) + '" y="' + Math.min(y0, y1) + '" width="' + bw + '" height="' + Math.max(0.5, Math.abs(y1 - y0)) + '" fill="' + (v < 0 ? 'var(--eo-c-out)' : 'var(--eo-c-in)') + '"/>'; });
s += '<line x1="' + mg.l + '" x2="' + (W - mg.r) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--color-fg-muted)"/>';
} else {
m.series.forEach((ser) => {
const ln = d3.line().defined((d) => d != null).x((d, i) => x(i)).y((d) => y(d)); if (m.step) ln.curve(d3.curveStepAfter);
s += '<path d="' + ln(ser[1]) + '" fill="none" stroke="' + ser[2] + '" stroke-width="2"/>';
const v = eoLast(ser[1]); if (v != null) s += '<circle cx="' + x(months.length - 1) + '" cy="' + y(v) + '" r="3" fill="' + ser[2] + '"/>';
});
}
[0, Math.floor(months.length / 2), months.length - 1].forEach((i) => { s += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === months.length - 1 ? 'end' : 'middle') + '">' + months[i] + '</text>'; });
s += '</svg>';
const leg = m.flowbars ? '<div class="eo-map-leg"><span style="--k:var(--eo-c-in)">Masuk</span><span style="--k:var(--eo-c-out)">Keluar</span></div>' : '<div class="eo-map-leg">' + m.series.map((ser) => '<span style="--k:' + ser[2] + '">' + ser[0] + '</span>').join('') + '</div>';
return s + leg;
}
function eoConf(ids) {
const info = dash.data('confidence'); if (info.status !== 'ok' || !info.data) return '—';
const labels = ids.map((id) => (info.data.find((r) => r.id === id) || {}).label).filter((l) => l && l !== 'Belum ada');
if (!labels.length) return '—';
return labels.includes('Rendah') ? 'Rendah' : labels.every((l) => l === 'Tinggi') ? 'Tinggi' : 'Sedang';
}
let eoAsiaTab = 'country', eoAsiaSel = 'ihsg';
function eoAsiaPick(k) { eoAsiaSel = k; eoAsiaTab = 'country'; eoSafe(() => { eoM = eoBuild(); }); eoSafe(eoDrawMap); eoSafe(eoDetail); }
function eoAsiaTabs(m) {
const T = [['country', 'Negara'], ['rank', 'Peringkat'], ['trend', 'Tren 12 bulan'], ['info', 'Cara membaca']];
let h = '<div class="eo-tabs" role="tablist">' + T.map((t) => '<button type="button" role="tab" class="eo-tab" data-asia-tab="' + t[0] + '" aria-selected="' + (eoAsiaTab === t[0]) + '">' + t[1] + '</button>').join('') + '</div>';
if (eoAsiaTab === 'country') h += eoAsiaCountry(m);
else if (eoAsiaTab === 'trend') h += eoSpark(m, m.months) + '<div class="eo-map-sub">Indeks 100 = ' + m.mo[0] + '. Garis di bawah 100 berarti lebih murah dari awal periode.</div>';
else if (eoAsiaTab === 'info') h += '<p class="eo-map-expl">' + m.expl + '</p><p class="eo-map-expl">Indeks Asia memakai mata uang lokal, ETF memakai dolar. Asia Tenggara hanya lewat ETF karena indeksnya tidak tersedia. Dengan 12 bulan data, korelasi hanya petunjuk. Warna China di peta mewakili indeks Shenzhen; Hong Kong (Hang Seng) dan Singapura adalah titik kecil karena batasnya terlalu kecil untuk peta ini.</p>';
else h += eoAsiaRank(m);
return h;
}
const EO_CTX = {"ihsg": "IHSG didominasi saham bank dan komoditas, dengan bobot teknologi yang kecil.", "eido": "ETF yang melacak saham Indonesia dalam dolar, jadi ikut menanggung pelemahan Rupiah.", "spx": "Indeks yang didominasi saham teknologi besar.", "nifty": "Banyak berisi bank, keuangan, dan konsumsi dalam negeri.", "kospi": "Bobot besar pada Samsung dan SK Hynix, jadi sangat peka pada siklus chip dan AI.", "nikkei": "Indeks berbobot harga yang berisi perusahaan industri dan teknologi Jepang.", "hsi": "Banyak berisi perusahaan China daratan yang tercatat di Hong Kong.", "taiex": "Sangat bergantung pada semikonduktor, terutama TSMC.", "asx": "Didominasi bank dan tambang, komposisinya paling mirip IHSG di antara pembanding.", "sz": "Berisi perusahaan manufaktur dan teknologi China, berbeda dari indeks Shanghai.", "eem": "ETF pasar berkembang (China, India, Taiwan, Korea, dll.), patokan pasar berkembang pada umumnya.", "thd": "ETF dalam USD untuk saham negara ini, jadi ikut mencerminkan kurs mata uangnya.", "ewm": "ETF dalam USD untuk saham negara ini, jadi ikut mencerminkan kurs mata uangnya.", "ephe": "ETF dalam USD untuk saham negara ini, jadi ikut mencerminkan kurs mata uangnya.", "ews": "ETF dalam USD untuk saham negara ini, jadi ikut mencerminkan kurs mata uangnya.", "vnm": "ETF dalam USD untuk saham negara ini, jadi ikut mencerminkan kurs mata uangnya."};
function eoAsiaCountry(m) {
const e = m.se, v = e.vals, n = v.length, last = n - 1, mm = (i) => (v[i] != null && v[i - 1] != null) ? (v[i] / v[i - 1] - 1) * 100 : null;
const rets = v.map((x, i) => i ? mm(i) : null), valid = rets.map((r, i) => r === null ? null : i).filter((i) => i !== null);
const bi = valid.reduce((a, i) => rets[i] > rets[a] ? i : a, valid[0]), wi = valid.reduce((a, i) => rets[i] < rets[a] ? i : a, valid[0]);
const pk = v.indexOf(d3.max(v)), r3 = v[last - 3] ? (v[last] / v[last - 3] - 1) * 100 : null;
const eem = m.ent.find((x) => x.k === 'eem'), cor = e.k !== 'ihsg' ? eoPearson(m.ih.vals.slice(1).map((x, i) => x / m.ih.vals[i] - 1), v.slice(1).map((x, i) => x / v[i] - 1)) : null;
const rows = [['Perubahan ' + (n - 1) + ' bulan', eoSgn(e.p, 1) + '%'], ['Dari puncak', eoSgn(e.dd, 1) + '%' + (pk === last ? ' (sedang di puncak)' : ' (puncak ' + m.mo[pk] + ')')], ['3 bulan terakhir', r3 === null ? '–' : eoSgn(r3, 1) + '%'],
['Bulan terbaik', eoSgn(rets[bi], 1) + '% (' + m.mo[bi] + ')'], ['Bulan terburuk', eoSgn(rets[wi], 1) + '% (' + m.mo[wi] + ')']];
if (e.k !== 'ihsg') rows.push(['Selisih dengan IHSG', eoSgn(e.p - m.ih.p, 1) + ' poin'], ['Korelasi bulanan dengan IHSG', eoFmt(cor.r, 2) + ' (n=' + cor.n + ')']);
if (eem && e.k !== 'eem') rows.push(['Selisih dengan EEM', eoSgn(e.p - eem.p, 1) + ' poin']);
return '<dl class="eo-dl">' + rows.map((r) => '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>').join('') + '</dl><p class="eo-map-expl">' + (EO_CTX[e.k] || '') + '</p><div class="eo-map-sub">Konteks umum di luar data dashboard. Korelasi dari sampel kecil, bukan sebab-akibat. Klik negara lain di peta untuk membandingkan.</div>';
}
function eoAsiaRank(m) {
const rows = m.ent.slice().sort((a, b) => b.p - a.p);
const W = 340, rh = 19, H = rows.length * rh + 6, l = 150, rEnd = W - 46, lo = Math.min(0, d3.min(rows, (r) => r.p)), hi = Math.max(0, d3.max(rows, (r) => r.p));
const x = (v) => l + (rEnd - l) * (v - lo) / ((hi - lo) || 1), x0 = x(0);
let s = '<svg class="eo-map-spark" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Peringkat perubahan harga pasar saham">';
rows.forEach((r, i) => { const y = 3 + i * rh, x1 = x(r.p);
s += '<text x="' + (l - 6) + '" y="' + (y + 12) + '" text-anchor="end"' + (r.k === eoAsiaSel ? ' font-weight="700"' : '') + '>' + r.n.replace(' (ETF ', ' (').replace(', USD)', ')') + '</text>'
+ '<rect x="' + Math.min(x0, x1) + '" y="' + (y + 2) + '" width="' + Math.max(1, Math.abs(x1 - x0)) + '" height="12" fill="' + eoAsiaCol(r.p) + '" fill-opacity="' + (r.usd ? 0.55 : 1) + '"' + (r.k === eoAsiaSel ? ' stroke="var(--color-fg)" stroke-width="1.5"' : '') + '/>'
+ '<text x="' + (W - 2) + '" y="' + (y + 12) + '" text-anchor="end"' + (r.k === eoAsiaSel ? ' font-weight="700"' : '') + '>' + eoSgn(r.p, 1) + '%</text><rect data-asia-pick="' + r.k + '" x="0" y="' + y + '" width="' + W + '" height="' + rh + '" fill="transparent" style="cursor:pointer"/>'; });
s += '<line x1="' + x0 + '" x2="' + x0 + '" y1="0" y2="' + H + '" stroke="var(--color-fg-muted)"/></svg>';
return s + '<div class="eo-map-leg"><span style="--k:var(--eo-c-in)">Naik</span><span style="--k:var(--eo-c-out)">Turun</span></div><div class="eo-map-sub">Batang pucat = ETF dalam USD, batang pekat = indeks mata uang lokal.</div>';
}
function eoDetail() {
const el = document.getElementById('eo-map-detail'); if (!el) return;
if (!eoM) { el.innerHTML = '<div class="eo-map-sub">Memuat…</div>'; return; }
const c = EO_CH.find((x) => x.id === eoSel), m = eoM.M[eoSel], conf = eoConf(c.conf);
const nm = (k) => k === 'global' ? 'Dunia' : k === 'us' ? 'Amerika Serikat' : k === 'id' ? 'Indonesia' : k === 'china' ? 'China' : k;
const kick = c.id === 'trade' ? 'Indonesia → mitra dagang' : c.id === 'commodity' ? 'Harga dunia → daerah penghasil' : c.id === 'asia' ? 'Klik negara di peta · pasar saham 12 bulan' : nm(c.from) + ' → ' + nm(c.to);
el.innerHTML = '<div class="eo-map-kick">' + kick + '</div><h3>' + c.label + '</h3>'
+ '<div class="eo-map-big">' + m.value + '</div><div class="eo-map-sub">' + m.unit + '</div><div class="eo-map-sub">' + m.sub + '</div>'
+ (m.rank ? eoAsiaTabs(m) : (m.bars ? eoTradeBars() : eoSpark(m, eoM.months)) + '<p class="eo-map-expl">' + m.expl + '</p>')
+ '<div class="eo-map-meta"><span>Kepercayaan data:</span><b class="eo-conf-badge conf-' + conf.toLowerCase() + '">' + conf + '</b></div>';
el.querySelectorAll('[data-asia-pick]').forEach((b) => { b.addEventListener('click', () => eoAsiaPick(b.getAttribute('data-asia-pick'))); });
el.querySelectorAll('[data-asia-tab]').forEach((b) => { b.addEventListener('click', () => { eoAsiaTab = b.getAttribute('data-asia-tab'); eoSafe(eoDetail); }); });
}
function eoInsights() {
const el = document.getElementById('eo-map-insights'); if (!el) return;
if (!eoM) { el.innerHTML = '<li>Memuat…</li>'; return; }
const s = eoM, mo = s.months;
const iJan = mo.findIndex((m) => /^Jan/.test(m)); const since = iJan >= 0 ? iJan : 0;
const cum = d3.sum(eoNN(s.fl.slice(since))), missing = s.fl.slice(since).some((v) => v == null);
const spMax = d3.max(eoNN(s.spread)), ixMax = s.spread.indexOf(spMax);
const rF = eoPearson(s.spread, s.fl), rG = eoPearson(s.g, s.idp), rU = eoPearson(s.ism, s.g), rUI = eoPearson(s.ism, s.idp), rC = eoPearson(s.cn, s.idp);
const below = (a) => eoNN(a).filter((v) => v < 50).length;
const ismBelow = s.ism.map((v, i) => v != null && v < 50 ? mo[i] : null).filter(Boolean);
const gq = s.gdpus.length ? eoLast(s.gdpus) : null;
const cn = s.trade.find((r) => /china|tiongkok/i.test(r.partner));
const pct = (a) => { const n = eoNN(a); return n.length > 1 ? (eoLast(n) / n[0] - 1) * 100 : NaN; };
const items = [
['Dunia: permintaan barang menguat', 'PMI Global di atas 50 pada ' + (eoNN(s.g).length - below(s.g)) + ' dari ' + eoNN(s.g).length + ' bulan dan kini ' + eoFmt(eoLast(s.g), 1) + '.', ''],
['Tapi pembeli terbesar Indonesia, China, lemah', (cn ? 'China menyerap ekspor nonmigas terbesar (USD ' + eoFmt(cn.exp, 1) + ' miliar Jan–Agu)' + (cn.imp != null ? ' dan Indonesia mengimpor lebih banyak darinya (USD ' + eoFmt(cn.imp, 1) + ' miliar), jadi defisit dengan China. ' : '. ') : '') + (eoNN(s.cn).length ? 'PMI China di bawah 50 pada ' + below(s.cn) + ' dari ' + eoNN(s.cn).length + ' bulan, kini ' + eoFmt(eoLast(s.cn), 1) + '. Kekuatan dunia sebagian besar tidak datang dari China.' : ''), eoNN(s.cn).length ? 'Korelasi PMI China vs PMI Indonesia ' + eoFmt(rC.r, 2) + ' (n=' + rC.n + ').' : ''],
['Harga komoditas ekspor naik', eoNN(s.coal).length ? 'Sejak ' + mo[0] + ': batu bara ' + eoSgn(pct(s.coal), 0) + '%, CPO ' + eoSgn(pct(s.cpo), 0) + '%, nikel ' + eoSgn(pct(s.nickel), 0) + '% (harga dunia). Ini menopang pendapatan ekspor dan daerah penghasil seperti Kalimantan, Riau, dan Sulawesi. Meski begitu Rupiah tetap melemah ' + eoFmt((eoLast(s.fx) / s.fx[0] - 1) * 100, 1) + '%, tanda tekanan dari jalur uang lebih besar.' : 'Belum ada data.', ''],
['AS: lebih panas dari dunia, The Fed kembali mengetat', 'ISM AS ' + (ismBelow.length ? 'kontraksi pada ' + ismBelow[0] + '–' + eoLast(ismBelow) + ', lalu ' : '') + 'naik ke ' + eoFmt(eoLast(s.ism), 1) + '.' + (gq ? ' PDB AS ' + gq.quarter + ' tumbuh ' + eoFmt(gq.gdp_us, 1) + '% (laju tahunan, estimasi awal).' : '') + ' Fed Funds kini ' + eoFmt(eoLast(s.fed), 2) + '%.', 'Korelasi ISM AS vs PMI Global ' + eoFmt(rU.r, 2) + ' (n=' + rU.n + ').'],
['Indonesia: tidak ikut menguat', 'PMI Indonesia di bawah 50 pada ' + below(s.idp) + ' bulan (terendah ' + eoFmt(d3.min(eoNN(s.idp)), 1) + ') dan kini ' + eoFmt(eoLast(s.idp), 1) + '.', 'Korelasi PMI Indonesia vs PMI Global ' + eoFmt(rG.r, 2) + ', vs ISM AS ' + eoFmt(rUI.r, 2) + ' (n=' + rG.n + '). Faktor dalam negeri tampaknya lebih menentukan.'],
['Bunga lebih tinggi belum menahan dana keluar', 'Selisih BI–Fed melebar dari ' + eoFmt(s.spread[0], 2) + ' ke ' + eoFmt(spMax, 2) + ' poin (sejak ' + mo[ixMax] + '), kini ' + eoFmt(eoLast(s.spread), 2) + '. Asing jual bersih saham sekitar Rp ' + eoFmt(Math.abs(cum), 1) + ' triliun sejak ' + mo[since] + (missing ? ' (ada bulan kosong)' : '') + '.', 'Korelasi selisih bunga vs arus asing ' + eoFmt(rF.r, 2) + ' (n=' + rF.n + '). Bukan bukti sebab-akibat.'],
(() => {
const A = s.M.asia; if (!A || !A.ent) return ['IHSG: masalah Indonesia atau Asia?', 'Belum ada data Saham Asia.', ''];
const g = (k) => { const e = A.ent.find((x) => x.k === k); return e ? e.p : null; }, f = (k) => eoSgn(g(k), 0) + '%';
const sea = ['thd', 'ewm', 'ephe', 'ews', 'vnm'].map(g).filter((v) => v !== null);
const cr = (k) => { const a = A.ent.find((x) => x.k === 'ihsg').vals, b = A.ent.find((x) => x.k === k).vals; const ra = a.slice(1).map((v, i) => v / a[i] - 1), rb = b.slice(1).map((v, i) => v / b[i] - 1); return eoPearson(ra, rb); };
const cH = cr('hsi'), cS = cr('ews');
return ['IHSG: lebih banyak masalah Indonesia daripada Asia', 'IHSG ' + eoSgn(A.ih.p, 1) + '% sejak ' + A.mo[0] + (A.ei ? ' (' + eoSgn(A.ei.p, 1) + '% dalam USD)' : '') + '. Pasar teknologi Asia naik: Taiwan ' + f('taiex') + ', Korea ' + f('kospi') + ', Jepang ' + f('nikkei') + '. India ' + f('nifty') + ', Hong Kong ' + f('hsi') + ', China (Shenzhen) ' + f('sz') + '. Asia Tenggara (ETF USD) ' + eoSgn(d3.min(sea), 0) + '% s.d. ' + eoSgn(d3.max(sea), 0) + '%. Guncangan Maret 2026 dirasakan bersama, tetapi hanya Indonesia yang tidak ikut pulih.', 'Korelasi bulanan IHSG vs Hong Kong ' + eoFmt(cH.r, 2) + ', vs Singapura ' + eoFmt(cS.r, 2) + ' (n=' + cH.n + '). Campuran mata uang dan ETF, sampel kecil, bukan sebab-akibat.'];
})(),
['Untuk saham perbankan', 'Jalur uang (arus asing, kurs) sedang tidak mendukung. Jalur barang campuran: harga komoditas naik, tapi China lemah. Bank dengan banyak kredit ke sektor komoditas atau daerah penghasil bisa lebih terbantu daripada bank yang bergantung pada konsumsi.', 'Bacaan data, bukan rekomendasi investasi.'],
];
el.innerHTML = items.map((i) => '<li><b class="t">' + i[0] + '</b>' + i[1] + (i[2] ? '<div class="n">' + i[2] + '</div>' : '') + '</li>').join('');
}
function eoSafe(f) { try { f(); } catch (e) { console.warn('peta:', e && e.message); } }
function eoSelect(id) { const was = eoSel; eoSel = id; if ((id === 'asia') !== (was === 'asia')) eoSafe(eoDrawMap); eoSafe(eoApply); eoSafe(eoDetail); }
function eoRender() { eoSafe(eoChips); eoSafe(() => { eoM = eoBuild(); }); eoSafe(eoDrawMap); eoSafe(eoDetail); eoSafe(eoInsights); }
eoRender();
dash.onData(eoRender);
dash.onData(() => { const g = dash.data('geo'); if (g.status === 'ok' && g.data && g.data.length && !EO_LAND.features.length) { g.data.forEach((r) => { if (r.kunci === 'land') EO_LAND = eoDec(r.data); else if (r.kunci === 'ctry') EO_CTRY = eoDec(r.data); }); eoSafe(eoRender); try { krRender(); } catch (e) {} } });
let eoRT; window.addEventListener('resize', () => { clearTimeout(eoRT); eoRT = setTimeout(() => eoSafe(eoDrawMap), 120); });
const KR_MODES = [
{ id: 'tot', label: 'Total kredit', a: 'tot0', b: 'tot1' },
{ id: 'min', label: 'Kredit pertambangan', a: 'min0', b: 'min1' },
{ id: 'agr', label: 'Kredit pertanian', a: 'agr0', b: 'agr1' },
{ id: 'ind', label: 'Kredit industri', a: 'ind0', b: 'ind1' },
];
let krMode = 'tot', krSel = null;
const krFmt = (v, d) => Number(v).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
function krData() { const d = dash.data('kredit'); return (d.status === 'ok' && d.data && d.data.length) ? d.data : null; }
function krStats(rows, m) {
const g = (r) => (r[m.a] > 0 && r[m.b] != null) ? (r[m.b] / r[m.a] - 1) * 100 : null;
const s0 = d3.sum(rows, (r) => r[m.a] || 0), s1 = d3.sum(rows, (r) => r[m.b] || 0);
return { g, nat: s0 ? (s1 / s0 - 1) * 100 : 0, s1 };
}
function krClass(v, nat) { if (v == null) return { c: 'var(--color-fg-muted)', k: 'n/a' }; if (v < 0) return { c: '#e34948', k: 'Menyusut' }; if (v < nat) return { c: '#eda100', k: 'Di bawah rata-rata' }; return { c: '#1baf7a', k: 'Di atas rata-rata' }; }
function krChips() {
const el = document.getElementById('eo-kr-chips'); if (!el || el.childElementCount) return;
KR_MODES.forEach((m) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'eo-map-chip'; b.id = 'eo-kr-' + m.id; b.textContent = m.label; b.addEventListener('click', () => { krMode = m.id; krRender(); }); el.appendChild(b); });
}
function krDraw() {
const rows = krData(); const box = document.getElementById('eo-kr-box'); if (!box) return;
const svg = d3.select('#eo-kr-svg'); const W = box.clientWidth || 600, H = Math.round(Math.max(200, W * 0.42));
svg.attr('viewBox', '0 0 ' + W + ' ' + H).attr('height', H).style('height', H + 'px').selectAll('*').remove();
const B = { x0: 94.5, x1: 141.5, y0: 6.8, y1: -11.2 };
const sc = Math.min(W / (B.x1 - B.x0), H / (B.y0 - B.y1)); const ox = (W - sc * (B.x1 - B.x0)) / 2, oy = (H - sc * (B.y0 - B.y1)) / 2;
const P = (c) => [ox + (c[0] - B.x0) * sc, oy + (B.y0 - c[1]) * sc];
svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'var(--eo-sea)');
const ring = (r) => { let s = ''; for (let k = 0; k < r.length; k++) { const p = P(r[k]); s += (k ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); } return s + 'Z'; };
const polys = []; (EO_LAND.features || []).forEach((f) => { const g = f.geometry; if (!g) return; const add = (p) => { if (p[0].some((c) => c[0] > 90 && c[0] < 150 && c[1] > -15 && c[1] < 12)) polys.push(p); }; if (g.type === 'Polygon') add(g.coordinates); else if (g.type === 'MultiPolygon') g.coordinates.forEach(add); });
svg.append('path').attr('d', polys.map((p) => p.map(ring).join('')).join('')).attr('fill', 'var(--eo-land)');
if (!rows) { svg.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle').attr('fill', 'var(--color-fg-muted)').attr('font-size', 12).text('Memuat data kredit…'); return; }
const m = KR_MODES.find((x) => x.id === krMode), st = krStats(rows, m);
const rS = d3.scaleSqrt().domain([0, d3.max(rows, (r) => r[m.b] || 0) || 1]).range([0, Math.max(12, W / 28)]);
const tip = document.getElementById('eo-kr-tip');
const g = svg.append('g');
rows.slice().sort((a, b) => (b[m.b] || 0) - (a[m.b] || 0)).forEach((r) => {
const [x, y] = P([r.lon, r.lat]), v = st.g(r), cl = krClass(v, st.nat);
g.append('circle').attr('cx', x).attr('cy', y).attr('r', Math.max(2.5, rS(r[m.b] || 0))).attr('fill', cl.c).attr('fill-opacity', 0.55).attr('stroke', krSel === r.code ? 'var(--color-fg)' : cl.c).attr('stroke-width', krSel === r.code ? 2 : 1).style('cursor', 'pointer')
.on('mousemove', (e) => { const bb = box.getBoundingClientRect(); tip.innerHTML = '<b>' + r.prov + '</b><br>' + m.label + ': Rp ' + krFmt((r[m.b] || 0) / 1000, 1) + ' T<br>YoY: ' + (v == null ? '–' : (v >= 0 ? '+' : '−') + krFmt(Math.abs(v), 1) + '%') + ' (nasional ' + krFmt(st.nat, 1) + '%)'; tip.style.left = Math.min(bb.width - 200, Math.max(4, e.clientX - bb.left + 12)) + 'px'; tip.style.top = Math.max(4, e.clientY - bb.top - 40) + 'px'; tip.style.opacity = 1; })
.on('mouseleave', () => { tip.style.opacity = 0; })
.on('click', () => { krSel = krSel === r.code ? null : r.code; krRender(); });
});
const ranked = rows.filter((r) => st.g(r) != null && (r[m.b] || 0) > 0).sort((a, b) => st.g(b) - st.g(a));
const narrow = W < 520; const lab = new Set((narrow ? [...ranked.slice(0, 2), ...ranked.slice(-1)] : [...ranked.slice(0, 3), ...ranked.slice(-2)]).map((r) => r.code)); if (krSel) lab.add(krSel);
rows.forEach((r) => { if (!lab.has(r.code)) return; const [x, y] = P([r.lon, r.lat]); const v = st.g(r);
g.append('text').attr('x', x).attr('y', y - Math.max(4, rS(r[m.b] || 0)) - 3).attr('text-anchor', 'middle').attr('font-size', narrow ? 9.5 : 12).attr('font-weight', 600).attr('fill', 'var(--color-fg)').attr('paint-order', 'stroke').attr('stroke', 'var(--eo-sea)').attr('stroke-width', 3).text(r.prov.replace('Kepulauan', 'Kep.').replace('Kalimantan', 'Kal.').replace('Sulawesi', 'Sul.').replace('Sumatera', 'Sum.') + ' ' + (v >= 0 ? '+' : '−') + krFmt(Math.abs(v), 0) + '%'); });
(typeof EO_REG !== 'undefined' ? EO_REG : []).forEach((rg) => { const [x, y] = P(rg.c); g.append('path').attr('d', 'M' + x + ',' + (y - 6) + 'L' + (x + 6) + ',' + y + 'L' + x + ',' + (y + 6) + 'L' + (x - 6) + ',' + y + 'Z').attr('fill', 'var(--color-fg)').attr('stroke', 'var(--color-panel)').attr('stroke-width', 1.5);
g.append('text').attr('x', x + 9).attr('y', y + 14).attr('font-size', window.EO_FS).attr('fill', 'var(--color-fg-muted)').attr('paint-order', 'stroke').attr('stroke', 'var(--eo-sea)').attr('stroke-width', 3).text(rg.name.split(' · ')[1]); });
const leg = document.getElementById('eo-kr-leg');
if (leg) leg.innerHTML = '<span style="--k:#1baf7a">Tumbuh di atas rata-rata nasional (' + krFmt(st.nat, 1) + '%)</span><span style="--k:#eda100">Tumbuh di bawah rata-rata</span><span style="--k:#e34948">Menyusut</span>';
}
function krSide() {
const rows = krData(); const el = document.getElementById('eo-kr-rank'), ins = document.getElementById('eo-kr-ins'); if (!el || !ins) return;
if (!rows) { el.innerHTML = '<div class="eo-map-sub">Memuat…</div>'; ins.innerHTML = ''; return; }
const m = KR_MODES.find((x) => x.id === krMode), st = krStats(rows, m);
const big = rows.filter((r) => (r[m.a] || 0) >= 1000 && st.g(r) != null).sort((a, b) => st.g(b) - st.g(a));
const line = (r) => { const v = st.g(r); return '<li><b>' + r.prov + '</b> ' + (v >= 0 ? '+' : '−') + krFmt(Math.abs(v), 1) + '% · Rp ' + krFmt((r[m.b] || 0) / 1000, 1) + ' T</li>'; };
const sel = krSel ? rows.find((r) => r.code === krSel) : null;
let selHtml = '';
if (sel) { const gg = (a, b) => (sel[a] > 0 ? (sel[b] / sel[a] - 1) * 100 : null); const f = (v) => v == null ? '–' : (v >= 0 ? '+' : '−') + krFmt(Math.abs(v), 1) + '%';
selHtml = '<div class="eo-map-kick">Provinsi dipilih</div><h3>' + sel.prov + '</h3><div class="eo-map-sub">Total ' + f(gg('tot0', 'tot1')) + ' · pertambangan ' + f(gg('min0', 'min1')) + ' · pertanian ' + f(gg('agr0', 'agr1')) + ' · industri ' + f(gg('ind0', 'ind1')) + '</div><div class="eo-map-sub">Posisi total Rp ' + krFmt(sel.tot1 / 1000, 1) + ' T (Agu 2026)</div><hr style="border:0;border-top:1px solid var(--color-border-line);margin:8px 0">'; }
el.innerHTML = selHtml + '<div class="eo-map-kick">' + m.label + ' · provinsi dengan posisi ≥ Rp 1 T</div><h3>Tumbuh paling cepat</h3><ol style="margin:0;padding-left:18px;font-size:14.5px;line-height:1.6">' + big.slice(0, 5).map(line).join('') + '</ol><h3 style="margin-top:8px">Paling lambat</h3><ol style="margin:0;padding-left:18px;font-size:14.5px;line-height:1.6">' + big.slice(-5).reverse().map(line).join('') + '</ol><div class="eo-map-sub" style="margin-top:6px">Nasional (jumlah 34 provinsi): ' + (st.nat >= 0 ? '+' : '−') + krFmt(Math.abs(st.nat), 1) + '% · klik lingkaran untuk rincian provinsi</div>';
const tS = krStats(rows, KR_MODES[0]), mS = krStats(rows, KR_MODES[1]), iS = krStats(rows, KR_MODES[3]);
const by = (name) => rows.find((r) => r.prov.toLowerCase() === name.toLowerCase());
const f1 = (r, S) => r ? ((S.g(r) >= 0 ? '+' : '−') + krFmt(Math.abs(S.g(r)), 1) + '%') : '–';
const kt = by('Kalimantan Timur'), ks = by('Kalimantan Selatan'), stg = by('Sulawesi Tengah'), mu = by('Maluku Utara'), ri = by('Riau'), jt = by('Jawa Timur'), jg = by('Jawa Tengah'), dki = by('DKI Jakarta');
const items = [
['Kredit mengikuti uang komoditas, tapi tidak merata', 'Kalimantan Timur (batu bara) tumbuh ' + f1(kt, tS) + ', dengan kredit pertambangan ' + f1(kt, mS) + '. Sulawesi Tengah (nikel, smelter) tumbuh ' + f1(stg, tS) + ', kredit industri ' + f1(stg, iS) + '. Tapi Kalimantan Selatan (juga batu bara) hanya ' + f1(ks, tS) + ' dan Maluku Utara (nikel) ' + f1(mu, tS) + '.'],
['Jawa, pusat konsumsi, tumbuh lambat', 'Jawa Timur ' + f1(jt, tS) + ' dan Jawa Tengah ' + f1(jg, tS) + ', jauh di bawah rata-rata nasional ' + f1(null, tS).replace('–', (tS.nat >= 0 ? '+' : '−') + krFmt(Math.abs(tS.nat), 1) + '%') + '. Sejalan dengan konsumsi yang lesu di lapisan Indonesia.'],
['Jakarta tetap mesin terbesar', 'DKI Jakarta (lokasi proyek banyak korporasi) tumbuh ' + f1(dki, tS) + ' dan menyumbang sekitar ' + krFmt(dki ? dki.tot1 / tS.s1 * 100 : 0, 0) + '% posisi kredit nasional, jadi angka nasional sangat dipengaruhi kredit korporasi.'],
['Artinya untuk saham bank', 'Pertumbuhan kredit nasional yang tinggi terutama datang dari korporasi dan daerah komoditas/hilirisasi, bukan dari konsumsi rumah tangga di Jawa. Bank dengan porsi kredit korporasi dan komoditas besar ikut menikmati, tapi juga ikut terpapar bila harga komoditas berbalik. Bacaan data, bukan rekomendasi.'],
];
ins.innerHTML = items.map((i) => '<li><b class="t">' + i[0] + '</b>' + i[1] + '</li>').join('');
}
function krRender() { try { krChips(); KR_MODES.forEach((m) => { const b = document.getElementById('eo-kr-' + m.id); if (b) b.setAttribute('aria-pressed', m.id === krMode ? 'true' : 'false'); }); krDraw(); krSide(); } catch (e) { console.warn('kredit', e && e.message); } }
krRender();
dash.onData(krRender);
let krRT; window.addEventListener('resize', () => { clearTimeout(krRT); krRT = setTimeout(krRender, 120); });
})();
