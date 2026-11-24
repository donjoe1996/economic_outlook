/*
 * 14 · Bitcoin: character, context indicators, direction, decision signal.
 *
 * Draws only. Every number comes from dash.data('btc_analysis'), which the
 * server computes in backend/btc.py from the btc_* datasets; the Claude fact
 * sheet prints from the same calculation. Ported from the "Bitcoin Monte Carlo
 * Lab" prototype without the simulation.
 *
 * Also registers two calcs the terminal shell reads:
 *   btc_s  [{id:'btc_verdict', status, statusText, detail}]  -> Sinyal keputusan
 *   btc_m  month-end closes {month, btc}                     -> Monitor tile
 */
(function () {
'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const isNum = (v) => v !== null && v !== undefined && isFinite(v);
const nf = (v, d) => isNum(v) ? (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : Number(v)).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }) : 'n/a';
const pct = (x, d) => isNum(x) ? nf(x * 100, d === undefined ? 0 : d) + '%' : 'n/a';
const spct = (x, d) => isNum(x) ? (x > 0 ? '+' : x < 0 ? '−' : '±') + nf(Math.abs(x * 100), d === undefined ? 0 : d) + '%' : 'n/a';
const sgn = (x, d) => isNum(x) ? (x > 0 ? '+' : x < 0 ? '−' : '±') + nf(Math.abs(x), d) : 'n/a';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function usd(v) {
  if (!isNum(v)) return 'n/a';
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e12) return s + 'US$' + nf(a / 1e12, 2) + ' T';
  if (a >= 1e9) return s + 'US$' + nf(a / 1e9, 1) + ' M';
  if (a >= 1e6) return s + 'US$' + nf(a / 1e6, 1) + ' jt';
  return s + 'US$' + nf(a, a >= 100 ? 0 : a >= 1 ? 2 : 4);
}
const usdTick = (v) => 'US$' + (v >= 1 ? nf(v, 0) : String(+v.toPrecision(2)).replace('.', ','));
const usdM = (v) => isNum(v) ? (v >= 0 ? '+' : '−') + 'US$' + nf(Math.abs(v) >= 1000 ? Math.abs(v) / 1000 : Math.abs(v), Math.abs(v) >= 1000 ? 1 : 0) + (Math.abs(v) >= 1000 ? ' M' : ' jt') : 'n/a';
const dt = (iso) => { if (!iso) return '–'; const p = String(iso).split('-'); return (p[2] ? +p[2] + ' ' : '') + MON[+p[1] - 1] + ' ' + p[0]; };
const mt = (iso) => { if (!iso) return '–'; const p = String(iso).split('-'); return MON[+p[1] - 1] + ' ' + p[0]; };
const days = (n) => n >= 730 ? nf(n / 365.25, 1) + ' tahun' : n >= 60 ? Math.round(n / 30.44) + ' bulan' : n + ' hari';
const get = (id) => { const d = dash.data(id); return d.status === 'ok' ? d.data : null; };

/* ------------------------------------------------------------ calcs for the shell */
dash.calc('btc_s', {
  inputs: ['btc_analysis'],
  fn: (a) => (a && a.verdict ? [Object.assign({ id: 'btc_verdict' }, a.verdict)] : []),
});
dash.calc('btc_m', {
  inputs: ['btc_analysis'],
  fn: (a) => {
    if (!a || !a.w) return [];
    const by = {};
    a.w.forEach((d, i) => { if (isNum(a.wp[i])) by[d.slice(0, 7)] = a.wp[i]; });
    by[a.as_of.slice(0, 7)] = a.price;
    return Object.keys(by).sort().slice(-13).map((k) => ({ month: MON[+k.slice(5, 7) - 1] + "'" + k.slice(2, 4), btc: by[k] }));
  },
});

/* ------------------------------------------------------------ charts (SVG + hover) */
function niceStep(span, n) { const r = span / n, p = Math.pow(10, Math.floor(Math.log10(r))), m = r / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }
function linTicks(lo, hi, n) { const s = niceStep(hi - lo || 1, n), out = []; for (let v = Math.ceil(lo / s) * s; v <= hi + 1e-12; v += s) out.push(+v.toFixed(10)); return out; }
function logTicks(lo, hi) {
  const out = [], a = Math.floor(Math.log10(lo)), b = Math.ceil(Math.log10(hi));
  const mult = b - a <= 2 ? [1, 2, 5] : [1];
  for (let e = a; e <= b; e++) mult.forEach((m) => { const v = m * Math.pow(10, e); if (v >= lo && v <= hi) out.push(v); });
  return out;
}
function yearTicks(t0, t1) {
  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear(), span = y1 - y0, step = span > 10 ? 2 : 1, out = [];
  if (span < 2) { for (let k = 0; k < 24; k++) { const t = Date.UTC(y0, k * 3, 1); if (t >= t0 && t <= t1) out.push([t, MON[(k * 3) % 12] + " '" + String(new Date(t).getUTCFullYear()).slice(2)]); } return out; }
  for (let y = y0 + 1; y <= y1; y += step) out.push([Date.UTC(y, 0, 1), String(y)]);
  return out;
}
const T = (iso) => Date.parse(iso + 'T00:00:00Z');
const bisect = (xs, x) => { let lo = 0, hi = xs.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < x) lo = m + 1; else hi = m; } return lo; };

/* o = {t:[iso], series:[{v, color, label, w, dash, fmt}], log, ymin, ymax, bands:[{y0,y1,color,label}],
        hlines:[{y,label}], yfmt, H, aria, area:true (fill first series to its baseline)} */
function lineChart(el, o) {
  if (!el) return;
  const W = Math.max(300, Math.min(980, el.clientWidth || 640)), H = o.H || 220, Tp = 10, B = 24, narrow = W < 560;
  const named = o.series.length > 1 && !narrow, R = o.R || (named ? 70 : (o.hlines || []).some((h) => h.label) ? 58 : 14);
  const xs = o.t.map(T), x0 = xs[0], x1 = xs[xs.length - 1];
  let lo = Infinity, hi = -Infinity;
  o.series.forEach((s) => s.v.forEach((v) => { if (isNum(v) && (!o.log || v > 0)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
  (o.hlines || []).forEach((h) => { if (!o.log || h.y > 0) { lo = Math.min(lo, h.y); hi = Math.max(hi, h.y); } });
  if (isNum(o.ymin)) lo = o.ymin; if (isNum(o.ymax)) hi = o.ymax;
  if (!isFinite(lo)) { el.innerHTML = '<div class="btc-miss">Belum ada data untuk grafik ini.</div>'; return; }
  if (o.log) { lo /= 1.15; hi *= 1.15; } else { const pad = (hi - lo) * 0.06 || 1; if (!isNum(o.ymin)) lo -= pad; if (!isNum(o.ymax)) hi += pad; }
  const yf = o.yfmt || ((v) => nf(v, 0)), ticks = o.log ? logTicks(lo, hi) : linTicks(lo, hi, 4);
  const L = o.L || Math.max(34, 10 + 6.4 * Math.max(...ticks.map((v) => String(yf(v)).length)));
  const fx = (t) => L + (W - L - R) * (t - x0) / ((x1 - x0) || 1);
  const fy = o.log ? (v) => Tp + (H - Tp - B) * (1 - (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)))
    : (v) => Tp + (H - Tp - B) * (1 - (v - lo) / ((hi - lo) || 1));
  let g = '';
  (o.bands || []).forEach((b) => {
    const a = Math.max(lo, b.y0), c = Math.min(hi, b.y1); if (a >= c) return;
    g += `<rect x="${L}" y="${fy(c).toFixed(1)}" width="${W - L - R}" height="${(fy(a) - fy(c)).toFixed(1)}" fill="${b.color}" opacity=".12"/>`;
    if (b.label) g += `<text class="lab" x="${L + 4}" y="${(fy(c) + 12).toFixed(1)}">${esc(b.label)}</text>`;
  });
  ticks.forEach((v) => {
    g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${fy(v).toFixed(1)}" y2="${fy(v).toFixed(1)}"/><text class="tk" x="${L - 6}" y="${(fy(v) + 4).toFixed(1)}" text-anchor="end">${esc(yf(v))}</text>`;
  });
  yearTicks(x0, x1).forEach(([t, lab]) => { g += `<text class="tk" x="${fx(t).toFixed(1)}" y="${H - 6}" text-anchor="middle">${lab}</text>`; });
  (o.hlines || []).forEach((h) => { g += `<line x1="${L}" x2="${W - R}" y1="${fy(h.y).toFixed(1)}" y2="${fy(h.y).toFixed(1)}" stroke="var(--color-fg-muted)" stroke-dasharray="4 4"/>` + (h.label ? `<text class="lab" x="${W - R + 4}" y="${(fy(h.y) + 4).toFixed(1)}">${esc(h.label)}</text>` : ''); });
  const labels = [];
  o.series.forEach((s, k) => {
    let d = '', pen = false, last = null;
    s.v.forEach((v, i) => {
      if (!isNum(v) || (o.log && v <= 0)) { pen = false; return; }
      d += (pen ? 'L' : 'M') + fx(xs[i]).toFixed(1) + ',' + fy(v).toFixed(1); pen = true; last = i;
    });
    if (o.area && k === 0 && d) {
      const base = fy(isNum(o.areaBase) ? o.areaBase : lo);
      g += `<path d="${d}L${fx(xs[last]).toFixed(1)},${base.toFixed(1)}L${fx(xs[s.v.findIndex(isNum)]).toFixed(1)},${base.toFixed(1)}Z" fill="${s.color}" opacity=".16"/>`;
    }
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2}" stroke-linejoin="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`;
    if (last !== null && s.label && named) labels.push({ y: fy(s.v[last]), text: s.short || s.label, x: fx(xs[last]) });
  });
  // direct labels at the right edge, nudged apart so they never overlap
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
  labels.forEach((l) => { g += `<text class="lab" x="${(l.x + 6).toFixed(1)}" y="${(l.y + 4).toFixed(1)}">${esc(l.text)}</text>`; });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || '')}">${g}<line class="hov" x1="0" x2="0" y1="${Tp}" y2="${H - B}" visibility="hidden"/><g class="dots"></g><rect x="${L}" y="${Tp}" width="${W - L - R}" height="${H - Tp - B}" fill="transparent"/></svg><div class="btc-tip"></div>`;
  const svg = el.querySelector('svg'), tip = el.querySelector('.btc-tip'), hov = svg.querySelector('.hov'), dots = svg.querySelector('.dots');
  const show = (e) => {
    const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) * (W / r.width), t = x0 + (sx - L) / (W - L - R) * (x1 - x0);
    let i = bisect(xs, t); if (i > 0 && Math.abs(xs[i - 1] - t) < Math.abs(xs[i] - t)) i--;
    const X = fx(xs[i]);
    hov.setAttribute('x1', X); hov.setAttribute('x2', X); hov.setAttribute('visibility', 'visible');
    let rows = '', dd = '';
    o.series.forEach((s) => {
      const v = s.v[i]; if (!isNum(v)) return;
      dd += `<circle class="dotr" cx="${X}" cy="${fy(v)}" r="4" fill="${s.color}"/>`;
      rows += `<div><span class="sw" style="background:${s.color}"></span>${esc(s.label || '')} <b>${esc((s.fmt || yf)(v))}</b></div>`;
    });
    dots.innerHTML = dd;
    tip.innerHTML = `<div>${dt(o.t[i])}</div>` + rows;
    tip.style.opacity = 1;
    const px = (X / W) * r.width;
    tip.style.left = Math.min(Math.max(0, px + 12), r.width - tip.offsetWidth - 4) + 'px';
    tip.style.top = '4px';
  };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', () => { tip.style.opacity = 0; hov.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; });
}

/* o = {labels:[], values:[], color(i,v), tip(i), yfmt, H, overlay:[] (line on top), zero:true} */
function barChart(el, o) {
  if (!el) return;
  const W = Math.max(320, Math.min(980, el.clientWidth || 640)), H = o.H || 200, L = o.L || 48, R = 12, Tp = 10, B = 24, n = o.values.length;
  const all = o.values.concat(o.overlay || []).filter(isNum);
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  if (isNum(o.ymin)) lo = o.ymin; if (isNum(o.ymax)) hi = o.ymax;
  const pad = (hi - lo) * 0.06 || 1; if (hi > 0) hi += pad; if (lo < 0) lo -= pad;
  const bw = (W - L - R) / n, fy = (v) => Tp + (H - Tp - B) * (1 - (v - lo) / ((hi - lo) || 1)), yf = o.yfmt || ((v) => nf(v, 0));
  let g = '';
  linTicks(lo, hi, 4).forEach((v) => { g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${fy(v).toFixed(1)}" y2="${fy(v).toFixed(1)}"/><text class="tk" x="${L - 6}" y="${(fy(v) + 4).toFixed(1)}" text-anchor="end">${esc(yf(v))}</text>`; });
  o.values.forEach((v, i) => {
    if (!isNum(v)) return;
    const y0 = fy(0), y1 = fy(v), x = L + i * bw + Math.min(1, bw * 0.1), w = Math.max(1, bw - Math.min(2, bw * 0.2));
    g += `<rect data-i="${i}" x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1, Math.abs(y1 - y0)).toFixed(1)}" rx="${Math.min(3, w / 3).toFixed(1)}" fill="${o.color(i, v)}"/>`;
  });
  g += `<line class="base" x1="${L}" x2="${W - R}" y1="${fy(0).toFixed(1)}" y2="${fy(0).toFixed(1)}"/>`;
  if (o.overlay) {
    let d = ''; o.overlay.forEach((v, i) => { if (isNum(v)) d += (d ? 'L' : 'M') + (L + (i + 0.5) * bw).toFixed(1) + ',' + fy(v).toFixed(1); });
    g += `<path d="${d}" fill="none" stroke="var(--color-fg)" stroke-width="1.6"/>`;
  }
  const every = Math.max(1, Math.ceil(n / Math.floor((W - L - R) / 46)));
  o.labels.forEach((lab, i) => { if (i % every === 0 && lab !== '') g += `<text class="tk" x="${(L + (i + 0.5) * bw).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(lab)}</text>`; });
  for (let i = 0; i < n; i++) g += `<rect class="hit" data-i="${i}" x="${(L + i * bw).toFixed(1)}" y="${Tp}" width="${bw.toFixed(1)}" height="${H - Tp - B}" fill="transparent"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || '')}">${g}</svg><div class="btc-tip"></div>`;
  const svg = el.querySelector('svg'), tip = el.querySelector('.btc-tip');
  const show = (e) => {
    const t = e.target.closest('rect.hit'); if (!t) return;
    const i = +t.dataset.i, r = svg.getBoundingClientRect();
    tip.innerHTML = o.tip(i); tip.style.opacity = 1;
    const px = ((L + (i + 0.5) * bw) / W) * r.width;
    tip.style.left = Math.min(Math.max(0, px + 10), r.width - tip.offsetWidth - 4) + 'px'; tip.style.top = '4px';
  };
  svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', () => { tip.style.opacity = 0; });
}

const card = (l, v, d, tone) => `<div class="btc-card ${tone || ''}"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d || ''}</div></div>`;
const line = (k, html) => `<div class="eo-q-line"><span>${k}</span> ${html}</div>`;
const ICON = { ok: '✓', warn: '!', bad: '✕' };
const pill = (status, text) => `<span class="btc-pill ${status}">${ICON[status] || ''} ${esc(text)}</span>`;

/* ------------------------------------------------------------ indicator texts (first principles) */
const ABOUT = {
  trend: {
    what: 'Rata-rata harga 200 hari kira-kira harga rata-rata tujuh bulan terakhir. Harga di atasnya dan rata-ratanya sendiri naik = tren naik; di bawah dan rata-ratanya turun = tren turun. "Pulih" dan "Koreksi" adalah dua keadaan di tengah.',
    thesis: 'Pengikut tren: naik selama harga di atas rata-rata 200 hari (Naik, Pulih), turun bila di bawah (Koreksi, Turun).',
    care: 'Ini deskripsi apa yang sudah terjadi. Tren berlanjut sampai berhenti, dan tidak ada yang tahu kapan.',
  },
  mvrv: {
    what: 'Nilai realisasi menilai setiap koin pada harga saat terakhir berpindah, jadi kira-kira modal rata-rata para pemegang. MVRV = nilai pasar ÷ nilai realisasi. Z-score mengukur jarak keduanya dalam satuan simpangan baku nilai pasar (dihitung hanya dari data sampai hari itu). Di bawah 0: rata-rata pemegang sedang rugi.',
    thesis: 'Valuasi: naik kecuali Z ≥ 3 (Tinggi) atau ≥ 7 (Panas), saat untung di atas kertas sudah besar.',
    care: 'Batas 0, 3 dan 7 dipilih orang dengan melihat puncak dan dasar masa lalu, jadi cocok dengan masa lalu karena dibuat begitu. Puncak tiap siklus makin rendah, sehingga alarm "di atas 7" mungkin tidak berbunyi lagi.',
  },
  exchange: {
    what: 'Koin yang disimpan di alamat bursa siap dijual; koin yang ditarik ke dompet sendiri cenderung disimpan. Yang dilihat: perubahan porsi semua bitcoin yang ada di bursa selama 13 minggu.',
    thesis: 'Arus: naik kecuali koin mengalir masuk ke bursa (≥ +0,25 poin persen dalam 13 minggu).',
    care: 'Penandaan alamat bursa oleh Coin Metrics tidak lengkap dan bisa berubah. Kustodian ETF dan perpindahan dompet internal bursa ikut menggeser angka ini tanpa ada jual-beli.',
  },
  etf: {
    what: 'Arus bersih ETF Bitcoin spot AS = uang institusi dan ritel AS yang masuk dikurangi yang keluar. Dijumlah 20 hari bursa (sekitar sebulan) supaya satu hari besar tidak mendominasi.',
    thesis: 'Permintaan: naik kecuali arus keluar kuat (≤ −US$1 M dalam 20 hari).',
    care: 'ETF baru ada sejak Januari 2024, jadi sejarahnya terlalu pendek untuk uji 12 bulan yang berarti. Arus juga bisa mengikuti harga, bukan mendahuluinya.',
  },
  liquidity: {
    what: 'M2 = uang tunai plus simpanan yang mudah dipakai. Jumlah M2 AS, China dan kawasan euro dalam dolar, lalu pertumbuhannya dibanding setahun lalu. Gagasannya: saat uang beredar tumbuh cepat, lebih banyak uang mengejar aset langka.',
    thesis: 'Likuiditas: naik kecuali M2 gabungan menyusut.',
    care: 'Konversi ke dolar membuat kurs ikut menggerakkan angka. M2 terbit sekitar sebulan kemudian (diperhitungkan di sini), M2 China diisi manual. Siklus likuiditas panjang, jadi episodenya sedikit.',
  },
  s2f: {
    what: 'Stock-to-flow = jumlah koin yang ada ÷ koin baru setahun. Halving memotong pasokan baru, sehingga rasio ini naik bertahap. Model PlanB (2019) mengubah rasio itu menjadi "harga seharusnya".',
    thesis: 'Kelangkaan: harga kembali ke model, jadi naik bila harga di bawah model.',
    care: 'Model ini dipasang pada data sampai 2019. Jarak harga dan model melebar sejak 2021; uji di bawah menunjukkan seberapa jauh. Satu angka dari jadwal pasokan tidak bisa menangkap permintaan.',
  },
  hashrate: {
    what: 'Hash rate = daya komputasi penambang. Penambang membeli mesin bila pendapatan menarik, jadi hash rate sering mengikuti harga yang sudah naik. Yang dilihat: rata-rata 30 hari dibanding enam bulan sebelumnya.',
    thesis: 'Keyakinan penambang: naik kecuali hash rate menyusut lebih dari 10%.',
    care: 'Hash rate diperkirakan dari tingkat kesulitan dan waktu blok, bukan dihitung langsung. Ia juga bergantung pada listrik, pasokan mesin dan larangan menambang di negara tertentu.',
  },
  puell: {
    what: 'Puell multiple = pendapatan penambang dari koin baru hari ini (dalam dolar) ÷ rata-rata setahunnya. Karena jumlah koin baru per hari ditetapkan jadwal, angka ini pada dasarnya harga ÷ rata-rata harga setahun, yang diatur ulang tiap halving. Rendah = penambang tertekan dan mungkin menjual.',
    thesis: 'Tekanan penambang: naik kecuali Puell > 4 (pendapatan jauh di atas biasanya).',
    care: 'Ambang 0,5 dan 4 berasal dari siklus awal; puncak makin rendah. Biaya transaksi tidak dihitung di sini (lihat porsi biaya di kartu).',
  },
  activity: {
    what: 'Alamat aktif = alamat yang mengirim atau menerima dalam sehari, perkiraan kasar pemakaian jaringan. Dibandingkan dengan setahun lalu (rata-rata 30 hari).',
    thesis: 'Adopsi: naik kecuali pemakaian menyusut lebih dari 10% dibanding setahun lalu.',
    care: 'Satu orang bisa memakai banyak alamat, dan bursa menggabungkan transaksi. Alamat bukan orang.',
  },
  spx: {
    what: 'Tren S&P 500 (rata-rata 200 hari) menunjukkan suasana pasar saham AS. Korelasi 90 hari menunjukkan seberapa dekat Bitcoin bergerak bersama saham saat ini: 0 tidak terkait, 1 bergerak bersama.',
    thesis: 'Selera risiko: Bitcoin naik saat saham AS dalam tren naik (Naik, Pulih).',
    care: 'Kaitan Bitcoin dengan saham berubah-ubah dan biasanya melonjak saat krisis, ketika semua turun bersama.',
  },
};

/* ------------------------------------------------------------ render */
let tab = 'ctx', pick = null, win = 'all';
try { tab = localStorage.getItem('eo-btc-tab') || 'ctx'; win = localStorage.getItem('eo-btc-win') || 'all'; } catch (e) { /* private mode */ }

function testCell(t, key) {
  if (!t || !(t.n >= 8)) return '<span class="btc-test na">belum cukup data</span>';
  const v = key === 'learned' ? t.learned : t.book, base = key === 'learned' ? t.learned_always : t.always;
  if (!isNum(v)) return '<span class="btc-test na">belum cukup data</span>';
  const gap = v - base, cls = gap > t.marg ? 'ok' : gap < -t.marg ? 'bad' : '';
  return `<span class="btc-test ${cls}">${cls ? `<i>${cls === 'ok' ? '✓' : '✕'}</i>` : ''}${pct(v)} vs ${pct(base)}</span>`;
}

function summary(a) {
  let h = '<div class="btc-scroll"><table class="btc-sum"><thead><tr><th>Indikator</th><th>Sekarang</th><th>Keadaan</th><th>Teori bilang</th><th class="n">Benar 3 bln vs selalu naik</th><th class="n">Benar 12 bln vs selalu naik</th></tr></thead><tbody>';
  a.indicators.forEach((x) => {
    const st = x.tested ? 'ok' : '';
    h += `<tr class="btc-row" data-ind="${x.id}" tabindex="0" title="Buka rincian ${esc(x.name)}"><td>${esc(x.name)}${x.tested ? ' <span class="btc-pill ok">✓ teruji</span>' : ''}<span class="sub">${esc(dt(x.state_date))}</span></td>`
      + `<td>${esc(x.value_text)}</td><td>${esc(x.state)}</td><td>${x.call === 'naik' ? '▲ naik' : '▼ turun'}</td>`
      + `<td class="n">${testCell(x.t3)}</td><td class="n">${testCell(x.t12)}</td></tr>`;
    void st;
  });
  h += '</tbody></table></div>';
  return h;
}

function render() {
  const root = $('#eo-btc-body'); if (!root) return;
  const res = dash.data('btc_analysis');
  if (res.status === 'loading') { root.innerHTML = '<div class="eo-q-line">Memuat…</div>'; return; }
  if (res.status !== 'ok' || !res.data || !res.data.indicators) {
    root.innerHTML = '<div class="btc-miss">' + esc(res.message || 'Belum ada data Bitcoin.') + ' Klik <b>⟳ Tarik</b>: harga dan data on-chain diambil otomatis dari Coin Metrics, M2 dari FRED dan ECB, harga terbaru dan S&amp;P 500 dari Google Finance.</div>';
    return;
  }
  const a = res.data, v = a.verdict;
  if (!pick || !a.indicators.some((x) => x.id === pick)) pick = (a.indicators.find((x) => x.tested) || a.indicators[0]).id;
  const stale = a.chain_last && (T(a.as_of) - T(a.chain_last)) / 864e5 > 4;
  let h = `<div class="eo-verdict"><span class="eo-verdict-label eo-st st-${v.status}">${esc(v.statusText)}</span><span class="eo-verdict-detail">${esc(v.detail)}</span></div>`
    + `<div class="eo-rg-line" style="margin-bottom:8px">Harga terakhir <b>${usd(a.price)}</b> (${dt(a.as_of)}, ${esc(a.price_src)})${stale ? ' · data on-chain terakhir ' + dt(a.chain_last) : ''}</div>`
    + `<p class="btc-how"><b>Cara membaca, dari prinsip dasar.</b> Tanyakan tiga hal berurutan: (1) bagaimana Bitcoin biasanya bergerak (Karakter), (2) dalam suasana apa ia diperdagangkan sekarang (Konteks), (3) apakah ada petunjuk arah yang <i>pernah terbukti</i> lebih baik daripada aturan paling bodoh yang tetap jalan, yaitu "selalu tebak naik" (Arah). Tabel di bawah menjawab yang ketiga untuk setiap indikator: ✓ berarti aturan teorinya mengalahkan "selalu naik" lebih dari derau sampelnya.</p>`
    + summary(a)
    + `<div class="eo-rg-rule">${esc(ruleText(a))}</div>`
    + '<div class="eo-tabs" role="tablist">'
    + [['char', 'Karakter'], ['ctx', 'Konteks per indikator'], ['dir', 'Arah']].map(([k, l]) => `<button class="eo-tab" role="tab" data-btab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')
    + '</div><div id="eo-btc-tab"></div>';
  root.innerHTML = h;
  root.querySelectorAll('[data-btab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.btab; try { localStorage.setItem('eo-btc-tab', tab); } catch (e) { /* ignore */ } render(); }));
  root.querySelectorAll('tr[data-ind]').forEach((r) => {
    const open = () => { pick = r.dataset.ind; tab = 'ctx'; render(); const t = $('#eo-btc-tab'); if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
    r.addEventListener('click', open);
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
  const body = $('#eo-btc-tab');
  if (tab === 'char') renderChar(body, a); else if (tab === 'dir') renderDir(body, a); else renderCtx(body, a);
}

function ruleText(a) {
  const v = a.verdict, any = a.indicators.find((x) => x.t12 && x.t12.n >= 8) || a.indicators[0], t = any.t12 && any.t12.n >= 8 ? any.t12 : any.t3;
  return `Aturan sinyal: hanya indikator yang aturan teorinya (ditetapkan sebelum melihat data) mengalahkan "selalu naik" lebih dari derau yang ikut memberi suara. `
    + `Uji dilakukan sebulan sekali tanpa mengintip masa depan; tes 12 bulan saling tumpang tindih, jadi ${t.n || 0} tes hanya setara sekitar ${t.neff || 0} tes yang independen (derau ±${pct(t.marg || 0)}). `
    + `${v.total} indikator cukup datanya untuk diuji. Bukan rekomendasi.`;
}

/* ---------------- Karakter */
function renderChar(el, a) {
  const c = a.char[win] || a.char.all;
  const ratio = c.ext_ratio;
  let h = `<p class="btc-cap">Jendela: <span class="btc-win">${[['all', 'Semua sejarah'], ['y4', '4 tahun terakhir']].map(([k, l]) => `<button class="btc-chip" data-win="${k}" aria-pressed="${win === k}">${l}</button>`).join('')}</span> · ${dt(c.from)} sampai ${dt(c.to)}, ${nf(c.days, 0)} hari. Bitcoin sebelum dan sesudah ETF dan institusi bisa jadi "hewan" yang berbeda; ganti jendelanya dan lihat angkanya bergeser.</p>`;
  h += '<div class="btc-cards">'
    + card('Gerak harian biasa', '±' + pct(c.sd, 2), 'Satu simpangan baku. Indeks saham besar biasanya sekitar 1%.')
    + card('Volatilitas setahun', pct(c.ann_vol), 'Sebaran harian diskalakan ke setahun. Saham lama berkisar 15–20%.', c.ann_vol > 0.6 ? 'warn' : '')
    + card('Pertumbuhan rata-rata setahun', spct(c.growth), 'Sangat dibentuk tahun-tahun awal. Angka inilah yang paling mudah menyesatkan.', 'warn')
    + card('Ekor gemuk (excess kurtosis)', nf(c.exk, 1), '0 = kurva lonceng sempurna. Makin tinggi, makin banyak hari ekstrem.', c.exk > 2 ? 'bad' : '')
    + card('Hari ekstrem', nf(ratio, 1) + '×', `${nf(c.ext, 0)} hari di luar 3 simpangan baku, dibanding sekitar ${nf(c.ext_expected, 1)} menurut kurva lonceng.`, ratio > 2 ? 'bad' : '')
    + card('Hari terburuk / terbaik', spct(c.worst) + ' / ' + spct(c.best), 'Penurunan dan kenaikan satu hari terbesar.')
    + card('Penurunan terdalam', pct(c.mdd), 'Jatuh terdalam dari puncak ke titik terendah sesudahnya.', 'bad')
    + card('Terlama di bawah puncak', days(c.longest), 'Waktu terlama menunggu harga kembali ke puncak sebelumnya.')
    + card('Sekarang', pct(c.cur_dd) + ' dari puncak', c.cur_dd === 0 ? 'Di puncak tertinggi jendela ini.' : 'Jarak dari harga tertinggi di jendela ini.')
    + card('Volatilitas berkelompok', nf(c.ac_abs, 2), 'Kaitan besar gerak hari ini dengan kemarin. Di atas ~0,15 = hari liar datang beruntun.', c.ac_abs > 0.15 ? 'warn' : '')
    + card('Ingatan arah', nf(c.ac_r, 2), 'Kaitan arah hari ini dengan kemarin. Dekat 0 = arah kemarin hampir tidak memberi tahu arah hari ini.')
    + '</div>';
  h += line('Artinya', `Gerak harian biasa sekitar ±${pct(c.sd, 1)}, tetapi hari ekstrem muncul ${nf(ratio, 1)}× lebih sering daripada yang diizinkan kurva lonceng. Besar gerak punya ingatan (volatilitas berkelompok ${nf(c.ac_abs, 2)}), arahnya hampir tidak (${nf(c.ac_r, 2)}). Karena itu yang bisa dikatakan dengan jujur adalah <i>seberapa lebar</i> kemungkinan gerak, jauh lebih banyak daripada <i>ke mana</i>.`);
  h += '<div class="btc-h3">Harga (skala log)</div><p class="btc-cap">Pada skala log, jarak yang sama = persentase yang sama, jadi tahun-tahun awal tidak tergencet rata.</p><div class="btc-chart" id="btc-ch-price"></div>';
  h += '<div class="btc-h3">Sebaran gerak harian</div><p class="btc-cap">Batang = hari nyata, garis = kurva lonceng dengan rata-rata dan sebaran yang sama. Batang yang melampaui garis di kedua ujung adalah ekor gemuk.</p><div class="btc-chart" id="btc-ch-hist"></div>';
  h += '<div class="btc-h3">Volatilitas datang beruntun</div><p class="btc-cap">Volatilitas 30 hari, disetahunkan. Kalau volatilitas konstan, garis ini datar.</p><div class="btc-chart" id="btc-ch-vol"></div>';
  h += '<div class="btc-h3">Jarak dari puncak sebelumnya</div><p class="btc-cap">Seberapa jauh di bawah harga tertinggi pada setiap hari: seperti inilah "buruk" yang sebenarnya, dan selama inilah ia berlangsung.</p><div class="btc-chart" id="btc-ch-dd"></div>';
  h += '<div class="btc-h3">Tahun per tahun</div><div class="btc-scroll"><table class="eo-tb"><tr><th>Tahun</th><th class="n">Perubahan harga</th><th class="n">Volatilitas</th></tr>'
    + c.years.slice().reverse().map((y) => `<tr><td>${y.y}${y.partial ? ' (sebagian)' : ''}</td><td class="n">${spct(y.chg)}</td><td class="n">${pct(y.vol)}</td></tr>`).join('') + '</table></div>';
  h += line('Hati-hati', 'Rata-rata satu angka menyembunyikan banyak hal: tahun-tahun dengan kepribadian yang sangat berbeda tergabung di dalamnya. Pertumbuhan masa lalu mencerminkan adopsi sekali jalan yang tidak bisa terulang dengan cara yang sama.');
  el.innerHTML = h;
  el.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => { win = b.dataset.win; try { localStorage.setItem('eo-btc-win', win); } catch (e) { /* ignore */ } render(); }));
  const i0 = win === 'y4' ? Math.max(0, a.w.findIndex((d) => d >= c.from)) : 0, sl = (arr) => arr.slice(i0);
  lineChart($('#btc-ch-price'), { t: sl(a.w), series: [{ v: sl(a.wp), color: 'var(--btc-ink)', label: 'Harga', w: 1.6, fmt: usd }], log: true, yfmt: usdTick, aria: 'Harga Bitcoin skala log' });
  const hs = c.hist, labels = hs.cnt.map((_, k) => { const mid = hs.lo + (k + 0.5) * hs.w; return k % 8 === 4 ? spct(Math.exp(mid) - 1) : ''; });
  barChart($('#btc-ch-hist'), {
    values: hs.cnt, overlay: hs.normal, labels, aria: 'Sebaran gerak harian dan kurva lonceng',
    color: (k) => { const mid = hs.lo + (k + 0.5) * hs.w, z = Math.abs(mid - (hs.lo + 24 * hs.w)) / (hs.w * 4); return z > 3 ? 'var(--btc-s2)' : 'var(--btc-s1)'; },
    tip: (k) => { const a0 = Math.exp(hs.lo + k * hs.w) - 1, a1 = Math.exp(hs.lo + (k + 1) * hs.w) - 1; return `<div>${spct(a0, 1)} sampai ${spct(a1, 1)}</div><div>Hari nyata <b>${nf(hs.cnt[k], 0)}</b></div><div>Kurva lonceng <b>${nf(hs.normal[k], 1)}</b></div>`; },
  });
  lineChart($('#btc-ch-vol'), { t: sl(a.w), series: [{ v: sl(a.wvol), color: 'var(--btc-s1)', label: 'Volatilitas 30 hari', fmt: (x) => pct(x) }], ymin: 0, yfmt: (x) => pct(x), hlines: [{ y: c.ann_vol, label: 'rata-rata' }], aria: 'Volatilitas 30 hari disetahunkan' });
  lineChart($('#btc-ch-dd'), { t: sl(a.w), series: [{ v: sl(a.wdd), color: 'var(--btc-s2)', label: 'Dari puncak', fmt: (x) => pct(x) }], ymax: 0, area: true, areaBase: 0, yfmt: (x) => pct(x), aria: 'Jarak harga dari puncak sebelumnya' });
}

/* ---------------- Konteks */
function groupsTable(x) {
  const row = (name, g, all) => {
    if (!g || !g.s3) return `<tr><td>${esc(name)}</td><td colspan="5" class="n">tidak ada hari</td></tr>`;
    const s12 = g.s12;
    return `<tr${all ? ' style="font-weight:600"' : ''}${name === x.state ? ' style="background:color-mix(in srgb,var(--color-fg) 6%,transparent)"' : ''}><td>${esc(name)}${name === x.state ? ' (sekarang)' : ''}</td><td class="n">${nf(g.days, 0)}${all ? '' : ' / ' + g.eps}</td>`
      + `<td class="n">${spct(g.s3.med)}</td><td class="n">${pct(g.s3.up)}</td>`
      + (s12 ? `<td class="n">${spct(s12.med)} <span class="sub" style="display:inline;color:var(--color-fg-muted)">(${spct(s12.lo)} s.d. ${spct(s12.hi)})</span></td><td class="n">${pct(s12.up)}</td>` : '<td colspan="2" class="n">terlalu baru</td>') + '</tr>';
  };
  return '<div class="btc-scroll"><table class="eo-tb"><tr><th>Keadaan (diketahui hari itu)</th><th class="n">Hari / episode</th><th class="n">3 bln, median</th><th class="n">Naik setelah 3 bln</th><th class="n">12 bln, median (8 dari 10)</th><th class="n">Naik setelah 12 bln</th></tr>'
    + x.order.map((s) => row(s, x.groups[s])).join('') + row('Semua hari', x.groups['Semua hari'], true) + '</table></div>';
}

function testTable(x) {
  const r = (label, key) => `<tr><td>${label}</td><td class="n">${testCell(x.t3, key)}</td><td class="n">${testCell(x.t12, key)}</td></tr>`;
  const ok = (t) => t && t.n >= 8;
  return '<div class="btc-scroll"><table class="eo-tb"><tr><th>Aturan</th><th class="n">Benar setelah 3 bln</th><th class="n">Benar setelah 12 bln</th></tr>'
    + r('Teori (buku teks), ditetapkan sebelum melihat data', 'book')
    + r('Belajar: apa yang terjadi sebelumnya pada keadaan yang sama', 'learned')
    + `<tr><td><b>Selalu tebak naik</b> (patokan)</td><td class="n">${ok(x.t3) ? pct(x.t3.always) : 'n/a'}</td><td class="n">${ok(x.t12) ? pct(x.t12.always) : 'n/a'}</td></tr></table></div>`;
}

function testReading(x) {
  const t = x.t12 && x.t12.n >= 8 ? x.t12 : x.t3, hz = t === x.t12 ? '12' : '3';
  if (!t || !(t.n >= 8)) return line('Uji', 'Sejarahnya belum cukup panjang untuk diuji. Anggap ini konteks, bukan sinyal.');
  const verdict = x.tested ? 'Aturan teorinya mengalahkan "selalu naik" lebih dari derau. Sinyal lemah yang layak dipantau, bukan bukti.'
    : (x.t3.worse || x.t12.worse) ? 'Aturan teorinya malah lebih buruk daripada "selalu naik".'
      : 'Aturan teorinya tidak mengalahkan tebakan sederhana bahwa Bitcoin naik. Indikator ini menggambarkan suasana, tetapi belum terbukti menunjuk arah.';
  return line('Uji', verdict + ` ${t.n} tes bulanan untuk ${hz} bulan saling tumpang tindih, jadi setara sekitar ${t.neff} tes independen: baca setiap persentase ± ${pct(t.marg)}. `
    + (t.book_down ? `Aturan teori bilang "turun" ${t.book_down} kali dan benar ${t.book_down_hit} kali; di situlah nilai tambahnya diuji.` : 'Aturan teori tidak pernah bilang "turun" pada tanggal uji, jadi ia tidak menambah apa pun di atas "selalu naik".'));
}

function renderCtx(el, a) {
  const x = a.indicators.find((i) => i.id === pick), ab = ABOUT[x.id] || {};
  let h = '<div class="btc-chips" role="group" aria-label="Pilih indikator">'
    + a.indicators.map((i) => `<button class="btc-chip" data-pick="${i.id}" aria-pressed="${i.id === x.id}"><span class="dot ${i.tested ? 'ok' : ''}"></span>${esc(i.name.split(' (')[0])}</button>`).join('') + '</div>';
  h += `<div class="btc-h3">${esc(x.name)}</div>`;
  h += line('Apa ini', esc(ab.what || ''));
  h += '<div class="btc-cards">' + cardsFor(x, a) + '</div>';
  h += '<div class="btc-chart" id="btc-ch-ind"></div><div id="btc-ch-ind2"></div>';
  h += `<div class="btc-h3">Apa yang terjadi sesudahnya, per keadaan</div><p class="btc-cap">Setiap hari di masa lalu diberi keadaan dengan data yang diketahui hari itu, lalu dicatat perubahan harga 3 dan 12 bulan sesudahnya. Bandingkan dengan baris "Semua hari". Kolom episode penting: hari-hari berurutan berbagi masa depan yang hampir sama.</p>` + groupsTable(x);
  h += `<div class="btc-h3">Apakah condongnya pernah berhasil?</div><p class="btc-cap">${esc(ab.thesis || '')}</p>` + testTable(x) + testReading(x);
  h += line('Hati-hati', esc(ab.care || ''));
  el.innerHTML = h;
  el.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => { pick = b.dataset.pick; render(); }));
  drawIndicator(x, a);
}

function cardsFor(x, a) {
  const st = card('Keadaan sekarang', esc(x.state), 'Per ' + dt(x.state_date) + '. Teori: ' + (x.call === 'naik' ? 'condong naik.' : 'condong turun.'));
  switch (x.id) {
    case 'trend': { const d = a.direction; return st + card('Harga vs rata-rata 200 hari', spct(d.vs200), d.vs200 >= 0 ? 'Di atas: tren panjang naik.' : 'Di bawah: tren panjang turun.', d.vs200 >= 0 ? 'ok' : 'bad') + card('Rata-rata 200 hari', d.slope >= 0 ? 'Naik' : 'Turun', spct(d.slope, 1) + ' sebulan terakhir.', d.slope >= 0 ? 'ok' : 'bad') + card('50 hari vs 200 hari', d.cross ? 'Di atas' : 'Di bawah', d.cross ? 'Tren pendek di atas tren panjang ("golden cross").' : 'Tren pendek di bawah tren panjang ("death cross").', d.cross ? 'ok' : 'bad'); }
    case 'mvrv': return st + card('MVRV Z-score', nf(x.value, 2), 'Seberapa jauh nilai pasar di atas modal pemegang.', x.state === 'Panas' ? 'bad' : x.state === 'Tinggi' ? 'warn' : '') + card('MVRV', nf(x.mvrv, 2) + '×', 'Koin bernilai ' + nf(x.mvrv, 2) + '× harga saat terakhir berpindah.') + card('Harga realisasi', usd(x.realized_price), 'Modal rata-rata per koin. Harga di bawahnya = rata-rata pemegang rugi.') + card('Tertinggi 2 tahun', nf(x.hi2, 2), 'Puncak per siklus: ' + (x.peaks || []).map((p) => nf(p.z, 1) + ' (' + mt(p.t) + ')').join(', ') + '.');
    case 'exchange': return st + card('Di bursa', nf(x.btc / 1e6, 2) + ' jt BTC', nf(x.share, 1) + '% dari semua bitcoin.') + card('13 minggu', sgn(x.value, 2) + ' poin', x.state === 'Keluar' ? 'Koin meninggalkan bursa.' : x.state === 'Masuk' ? 'Koin masuk ke bursa.' : 'Tidak ada arah jelas.', x.state === 'Masuk' ? 'warn' : '') + card('4 minggu', sgn(x.f28, 0) + ' BTC', x.f28 < 0 ? 'Penarikan lebih banyak dari setoran.' : 'Setoran lebih banyak dari penarikan.') + card('Porsi tertinggi', nf(x.peak_share, 1) + '%', 'Pada ' + mt(x.peak_date) + '.');
    case 'etf': return st + card('Hari terakhir', usdM(x.last), dt(x.last_day) + '.', x.last < 0 ? 'warn' : '') + card('5 hari', usdM(x.s5), 'Arus bersih sepekan.') + card('20 hari', usdM(x.value), esc(x.state) + '.', x.state === 'Keluar kuat' ? 'bad' : '') + card('Sejak peluncuran', usdM(x.cum), 'Sejak 11 Jan 2024.') + card('Beruntun', Math.abs(x.streak) + ' hari', x.streak > 0 ? 'arus masuk berturut-turut.' : 'arus keluar berturut-turut.');
    case 'liquidity': return st + card('Pertumbuhan M2 gabungan', spct(x.value, 1), 'Dibanding setahun lalu, dalam dolar, per ' + mt(x.month + '-01') + '.') + card('Data lengkap terakhir', mt(x.month + '-01'), 'Bulan terakhir dengan M2 AS, China dan euro serta kurs yang lengkap.');
    case 's2f': return st + card('Stock-to-flow', nf(x.sf, 0), 'Koin yang ada ÷ koin baru 365 hari terakhir.') + card('Harga model', usd(x.model), 'Yang dikatakan model pada hari ini.') + card('Harga vs model', nf(x.value, 2) + '×', x.value < 1 ? 'Harga ' + pct(1 - x.value) + ' di bawah model.' : 'Harga di atas model.', x.value < 0.25 ? 'bad' : x.value < 1 ? 'warn' : '') + card('Halving berikutnya', mt(x.next_halving), 'Perkiraan; tergantung kecepatan blok ditambang.');
    case 'hashrate': return st + card('Hash rate (rata-rata 30 hari)', nf(x.eh, 0) + ' EH/s', 'Exahash per detik.') + card('6 bulan', spct(x.value), x.state === 'Menyusut' ? 'Menyusut.' : x.state === 'Tumbuh' ? 'Tumbuh.' : 'Kurang lebih datar.', x.state === 'Menyusut' ? 'warn' : '') + card('Dari puncak', spct(x.eh / x.peak - 1), 'Puncak ' + nf(x.peak, 0) + ' EH/s.') + card('Pendapatan per EH/s per hari', usd(x.hashprice), isNum(x.hashprice_rank) ? 'Hanya koin baru, tanpa biaya. Lebih tinggi dari ' + pct(x.hashprice_rank) + ' hari sejak 2016.' : '');
    case 'puell': return st + card('Puell multiple', nf(x.value, 2), 'Pendapatan koin baru hari ini ÷ rata-rata setahunnya.', x.state === 'Tinggi' ? 'bad' : x.state === 'Rendah' ? 'ok' : '') + card('Porsi biaya di pendapatan penambang', isNum(x.fee_share) ? pct(x.fee_share, 1) : 'n/a', '30 hari terakhir. Setelah tiap halving, biaya transaksi harus makin menanggung keamanan jaringan.');
    case 'activity': return st + card('Alamat aktif (rata-rata 30 hari)', nf(x.adr, 0), 'Per hari.') + card('vs setahun lalu', spct(x.value), x.state + '.', x.state === 'Menyusut' ? 'warn' : '');
    case 'spx': return st + card('S&P 500', nf(x.spx, 0), 'Penutupan ' + dt(x.spx_date) + '; 6 bulan ' + spct(x.r6) + '.') + card('Kaitan Bitcoin–saham sekarang', nf(x.value, 2), '90 hari bursa terakhir. 0 = tidak terkait, 1 = bergerak bersama.', x.value > 0.4 ? 'warn' : '') + card('Kaitan rata-rata', nf(x.corr_avg, 2), 'Rata-rata angka 90 hari sejak datanya ada.');
    default: return st;
  }
}

function drawIndicator(x, a) {
  const el = $('#btc-ch-ind'), el2 = $('#btc-ch-ind2'), S = x.series || {};
  const tone = { ok: 'var(--color-ok)', warn: 'var(--color-warn)', bad: 'var(--color-bad)' };
  const leg = (items) => '<div class="btc-leg">' + items.map(([c, l, blk]) => `<span><i class="${blk ? 'blk' : ''}" style="background:${c}"></i>${esc(l)}</span>`).join('') + '</div>';
  switch (x.id) {
    case 'trend': {
      const i0 = Math.max(0, a.w.length - 105);
      lineChart(el, { t: a.w.slice(i0), log: true, yfmt: usdTick, aria: 'Harga dengan rata-rata 50 dan 200 hari, dua tahun terakhir',
        series: [{ v: a.wp.slice(i0), color: 'var(--btc-ink)', label: 'Harga', w: 1.5, fmt: usd }, { v: S.ma50.slice(i0), color: 'var(--btc-s1)', label: 'Rata-rata 50 hari', short: 'MA 50', fmt: usd }, { v: S.ma200.slice(i0), color: 'var(--btc-s2)', label: 'Rata-rata 200 hari', short: 'MA 200', fmt: usd }] });
      el2.innerHTML = leg([['var(--btc-ink)', 'Harga'], ['var(--btc-s1)', 'Rata-rata 50 hari'], ['var(--btc-s2)', 'Rata-rata 200 hari']]);
      break;
    }
    case 'mvrv':
      lineChart(el, { t: a.w, series: [{ v: S.z, color: 'var(--btc-s1)', label: 'MVRV Z', fmt: (v) => nf(v, 2) }], yfmt: (v) => nf(v, 0), aria: 'MVRV Z-score',
        bands: [{ y0: -10, y1: 0, color: tone.ok, label: 'Murah (< 0)' }, { y0: 3, y1: 7, color: tone.warn, label: 'Tinggi (3–7)' }, { y0: 7, y1: 99, color: tone.bad, label: 'Panas (≥ 7)' }], hlines: [{ y: 0 }] });
      el2.innerHTML = '<div class="btc-h3">Harga dan harga realisasi (modal rata-rata)</div><div class="btc-chart" id="btc-ch-rp"></div>' + leg([['var(--btc-ink)', 'Harga'], ['var(--btc-s2)', 'Harga realisasi']]);
      lineChart($('#btc-ch-rp'), { t: a.w, log: true, yfmt: usdTick, aria: 'Harga dan harga realisasi', series: [{ v: a.wp, color: 'var(--btc-ink)', label: 'Harga', w: 1.5, fmt: usd }, { v: S.rp, color: 'var(--btc-s2)', label: 'Harga realisasi', short: 'Realisasi', fmt: usd }] });
      break;
    case 'exchange':
      lineChart(el, { t: a.w, series: [{ v: S.share, color: 'var(--btc-s1)', label: 'Porsi di bursa', fmt: (v) => nf(v, 2) + '%' }], yfmt: (v) => nf(v, 0) + '%', aria: 'Porsi semua bitcoin yang ada di bursa' });
      break;
    case 'etf': {
      const D = x.daily, i0 = Math.max(0, D.t.length - 260);
      lineChart(el, { t: D.t.slice(i0), series: [{ v: D.s20.slice(i0), color: 'var(--btc-s1)', label: 'Arus 20 hari', fmt: usdM }], yfmt: (v) => usdM(v), aria: 'Arus bersih ETF 20 hari bursa',
        hlines: [{ y: 1000, label: '+1 M' }, { y: -1000, label: '−1 M' }, { y: 0 }] });
      el2.innerHTML = '<div class="btc-h3">Arus bersih per bulan, 12 bulan terakhir</div><div class="btc-chart" id="btc-ch-etfm"></div>';
      barChart($('#btc-ch-etfm'), { values: x.monthly.map((m) => m.v), labels: x.monthly.map((m) => mt(m.m + '-01').replace(' 20', " '")), yfmt: (v) => usdM(v), aria: 'Arus bersih ETF per bulan',
        color: (i, v) => v >= 0 ? 'var(--btc-s1)' : 'var(--btc-s2)', tip: (i) => `<div>${mt(x.monthly[i].m + '-01')}</div><div><b>${usdM(x.monthly[i].v)}</b></div>` });
      break;
    }
    case 'liquidity': {
      const M = x.monthly;
      lineChart(el, { t: M.t.map((m) => m + '-15'), series: [{ v: M.g, color: 'var(--btc-s1)', label: 'M2 gabungan, YoY', fmt: (v) => spct(v, 1) }], yfmt: (v) => pct(v), hlines: [{ y: 0 }], aria: 'Pertumbuhan M2 gabungan dibanding setahun lalu' });
      const lags = x.lags.filter((l) => isNum(l.r)), n = Math.min(...lags.map((l) => l.n)), band = 2 / Math.sqrt(Math.max(4, n / 12));
      el2.innerHTML = '<div class="btc-h3">Apakah Bitcoin mengikuti likuiditas, dan dengan jeda berapa?</div><p class="btc-cap">Korelasi pertumbuhan M2 dengan kenaikan Bitcoin setahun. Batang kanan: M2 bergerak lebih dulu sekian bulan. Batang kiri: Bitcoin lebih dulu. Data bulanan yang tumpang tindih membuat korelasi acak pun bisa tampak besar; garis putus-putus memberi gambaran kasar batas derau (±' + nf(band, 2) + ').</p><div class="btc-chart" id="btc-ch-lag"></div>';
      barChart($('#btc-ch-lag'), { values: lags.map((l) => l.r), labels: lags.map((l) => l.lag % 3 === 0 ? (l.lag > 0 ? '+' : '') + l.lag : ''), ymin: -1, ymax: 1, yfmt: (v) => nf(v, 1), aria: 'Korelasi M2 dan Bitcoin pada berbagai jeda',
        color: (i, v) => Math.abs(v) > band ? 'var(--btc-s1)' : 'color-mix(in srgb, var(--btc-s1) 40%, transparent)', tip: (i) => `<div>${lags[i].lag > 0 ? 'M2 lebih dulu ' + lags[i].lag + ' bln' : lags[i].lag < 0 ? 'Bitcoin lebih dulu ' + (-lags[i].lag) + ' bln' : 'Bulan yang sama'}</div><div>r <b>${nf(lags[i].r, 2)}</b> (n ${lags[i].n})</div>` });
      break;
    }
    case 's2f':
      lineChart(el, { t: a.w, log: true, yfmt: usdTick, aria: 'Harga Bitcoin dan harga model stock-to-flow', series: [{ v: a.wp, color: 'var(--btc-ink)', label: 'Harga', w: 1.5, fmt: usd }, { v: S.model, color: 'var(--btc-s2)', label: 'Model S2F', short: 'Model', fmt: usd }] });
      el2.innerHTML = leg([['var(--btc-ink)', 'Harga'], ['var(--btc-s2)', 'Model stock-to-flow']]);
      break;
    case 'hashrate':
      lineChart(el, { t: a.w, log: true, series: [{ v: S.hr, color: 'var(--btc-s1)', label: 'Hash rate', fmt: (v) => nf(v, v < 10 ? 2 : 0) + ' EH/s' }], yfmt: (v) => nf(v, v < 1 ? 3 : 0), aria: 'Hash rate rata-rata 30 hari, EH/s, skala log' });
      break;
    case 'puell':
      lineChart(el, { t: a.w, log: true, series: [{ v: S.puell, color: 'var(--btc-s1)', label: 'Puell', fmt: (v) => nf(v, 2) }], yfmt: (v) => nf(v, v < 1 ? 1 : 0), aria: 'Puell multiple, skala log',
        bands: [{ y0: 0.01, y1: 0.5, color: tone.ok, label: 'Rendah (< 0,5)' }, { y0: 4, y1: 100, color: tone.bad, label: 'Tinggi (> 4)' }], hlines: [{ y: 1 }] });
      break;
    case 'activity':
      lineChart(el, { t: a.w, log: true, series: [{ v: S.adr, color: 'var(--btc-s1)', label: 'Alamat aktif', fmt: (v) => nf(v, 0) }], yfmt: (v) => nf(v, 0), aria: 'Alamat aktif per hari, rata-rata 30 hari' });
      break;
    case 'spx':
      lineChart(el, { t: x.corr.t, series: [{ v: x.corr.v, color: 'var(--btc-s1)', label: 'Korelasi 90 hari', fmt: (v) => nf(v, 2) }], ymin: -0.5, ymax: 1, yfmt: (v) => nf(v, 1), hlines: [{ y: 0 }, { y: x.corr_avg, label: 'rata-rata' }], aria: 'Korelasi 90 hari Bitcoin dan S&P 500' });
      break;
    default: el.innerHTML = '';
  }
}

/* ---------------- Arah */
function renderDir(el, a) {
  const d = a.direction, tr = a.indicators.find((x) => x.id === 'trend'), cyc = d.cycle;
  let h = `<div class="btc-h3">1. Tren sekarang: ${esc(d.state || '–')}</div>`;
  h += '<div class="btc-cards">'
    + card('Harga vs rata-rata 200 hari', spct(d.vs200), d.vs200 >= 0 ? 'Di atas: tren panjang naik.' : 'Di bawah: tren panjang turun.', d.vs200 >= 0 ? 'ok' : 'bad')
    + card('Momentum 6 bulan', spct(d.r6), `1 bulan ${spct(d.r1)}, 3 bulan ${spct(d.r3)}, 12 bulan ${spct(d.r12)}.`, isNum(d.r6) ? (d.r6 >= 0 ? 'ok' : 'bad') : '')
    + card('Dari puncak tertinggi', pct(d.dd), `Puncak ${usd(d.ath)} pada ${dt(d.ath_date)}.`, d.dd < -0.3 ? 'bad' : '')
    + card('Siklus empat tahun', 'Hari ke-' + nf(cyc.day, 0), `Sejak halving ${dt(cyc.since)}. Berikutnya sekitar ${mt(cyc.next)}.`)
    + '</div>';
  h += '<div class="btc-h3">2. Apa yang terjadi sesudahnya, per keadaan tren</div>' + (tr ? groupsTable(tr) : '');
  const an = d.dd_analog || {};
  h += '<div class="btc-h3">3. Dua petunjuk lain</div><div class="btc-scroll"><table class="eo-tb"><tr><th>Petunjuk</th><th>Hari ini</th><th class="n">3 bln sesudahnya</th><th class="n">12 bln sesudahnya</th><th>Dasar</th></tr>';
  const cell = (s) => s ? `median ${spct(s.med)}, naik ${pct(s.up)}` : 'n/a';
  h += `<tr><td>Kedalaman dari puncak</td><td>${pct(d.dd)}</td><td class="n">${cell(an['91'])}</td><td class="n">${cell(an['365'])}</td><td>${an['365'] ? an['365'].eps + ' episode dalam ±10 poin dari hari ini' : '–'}</td></tr>`;
  const e3 = cyc.earlier.filter((c) => isNum(c['91'])), e12 = cyc.earlier.filter((c) => isNum(c['365']));
  h += `<tr><td>Siklus empat tahun</td><td>hari ke-${nf(cyc.day, 0)}</td><td class="n">${e3.map((c) => c.halving.slice(0, 4) + ': ' + spct(c['91'])).join('; ') || 'n/a'}</td><td class="n">${e12.map((c) => c.halving.slice(0, 4) + ': ' + spct(c['365'])).join('; ') || 'n/a'}</td><td>${cyc.earlier.length} siklus sebelumnya</td></tr></table></div>`;
  h += line('Hati-hati', 'Dua petunjuk ini lemah dan tidak independen: penurunan dalam biasanya datang bersama tren turun, jadi keduanya sering mengatakan hal yang sama dua kali. Siklus empat tahun bertumpu pada sekitar tiga contoh dalam seluruh sejarah Bitcoin. Harga yang sudah turun jauh bisa terus turun.');
  h += '<div class="btc-h3">4. Menyatukan semuanya</div>' + line('Kesimpulan', esc(conclusion(a)));
  h += '<div class="btc-h3">Pertanyaan untuk dipikirkan sendiri</div><ol class="btc-q">' + questions(a).map((q) => '<li>' + esc(q) + '</li>').join('') + '</ol>';
  el.innerHTML = h;
}

function conclusion(a) {
  const v = a.verdict, tested = a.indicators.filter((x) => x.tested), d = a.direction;
  let s = `Tren sekarang ${d.state || '–'} (${spct(d.vs200)} dari rata-rata 200 hari), ${pct(d.dd)} dari puncak. `;
  if (!tested.length) s += `Tidak satu pun dari ${v.total} indikator yang aturan teorinya mengalahkan "selalu naik" lebih dari derau. Bacaan yang jujur: tidak ada keunggulan arah yang teruji; yang bisa diukur adalah lebar gerak (tab Karakter), jadi besarnya posisi lebih penting daripada menebak arah.`;
  else s += `${tested.length} dari ${v.total} indikator lolos uji (${tested.map((x) => x.name.split(' (')[0] + ': ' + x.call).join('; ')}). ` + (v.ups > v.downs ? 'Mayoritasnya condong naik.' : v.downs > v.ups ? 'Mayoritasnya condong turun.' : 'Suaranya terbelah.') + ' Ini condong yang lemah, bukan ramalan: keunggulannya kecil dan bertumpu pada sedikit episode independen.';
  return s;
}

function questions(a) {
  const t = a.indicators.find((x) => x.t12 && x.t12.n >= 8), al = t ? pct(t.t12.always) : 'n/a';
  return [
    `"Selalu tebak naik" benar sekitar ${al} untuk 12 bulan dalam sejarah ini. Mengapa angka setinggi itu membuat hampir semua indikator tampak bagus bila tidak dibandingkan dengannya?`,
    'Tes bulanan dengan horizon 12 bulan saling tumpang tindih. Mengapa 120 tes seperti itu hanya setara sekitar 10 tes independen, dan apa akibatnya bagi keyakinan Anda?',
    'Indikator mana yang menurut Anda mengukur penyebab, dan mana yang hanya mengikuti harga (misalnya hash rate atau Puell multiple)? Bagaimana Anda bisa mengujinya?',
    'Jika suatu indikator benar-benar bisa menebak arah, apa yang akan dilakukan pedagang lain, dan apa yang terjadi pada keunggulannya?',
  ];
}

render();
dash.onData(render);
})();
