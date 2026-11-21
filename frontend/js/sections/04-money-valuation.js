(function () {
const ok = (v) => v !== null && v !== undefined && !isNaN(v);
const fmt = (v, n) => Number(v).toLocaleString('id-ID', { minimumFractionDigits: n, maximumFractionDigits: n });
const sg = (v, n) => (v >= 0 ? '+' : '−') + fmt(Math.abs(v), n);
const get = (id) => { try { const d = dash.data(id); return (d.status === 'ok' && d.data) ? d.data : []; } catch (e) { return []; } };
const badge = (el, rows) => { if (!el) return; const L = rows.map((r) => r.confidence); const lab = !L.length ? 'Belum ada' : L.includes('Rendah') && L.filter((x) => x === 'Rendah').length / L.length >= 0.25 ? 'Rendah' : L.every((x) => x === 'Tinggi') ? 'Tinggi' : 'Sedang'; el.textContent = 'Kepercayaan: ' + lab; el.className = 'eo-conf-badge conf-' + lab.toLowerCase().replace(' ', ''); };
const src = (rows) => { const u = rows.map((r) => r.url).filter((x, i, a) => x && /^https?:/.test(x) && a.indexOf(x) === i).slice(0, 4); return u.length ? '<div class="eo-note-s">Sumber: ' + u.map((x) => '<a href="' + x + '" target="_blank" rel="noopener">' + x.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] + '</a>').join(' · ') + '</div>' : ''; };
const isoMs = (x) => { const t = Date.parse(x); return isNaN(t) ? null : t; };
function yieldChart(R) {
const P = R.filter((r) => isoMs(r.iso) !== null); if (P.length < 3) return '';
const W = 640, H = 170, ml = 40, mr = 14, mt = 14, mb = 26, t0 = isoMs(P[0].iso), t1 = isoMs(P[P.length - 1].iso);
const vals = P.map((r) => r.sbn).concat(P.filter((r) => ok(r.ust)).map((r) => r.ust)), lo = Math.floor(Math.min.apply(null, vals) - 0.3), hi = Math.ceil(Math.max.apply(null, vals) + 0.3);
const x = (r) => ml + (W - ml - mr) * (isoMs(r.iso) - t0) / ((t1 - t0) || 1), y = (v) => mt + (H - mt - mb) * (1 - (v - lo) / ((hi - lo) || 1));
let g = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto" role="img" aria-label="Yield SBN 10 tahun dan UST 10 tahun">';
for (let v = lo; v <= hi; v += 1) g += '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--eo-grid)"/><text x="' + (ml - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11" fill="var(--color-fg-muted)">' + v + '%</text>';
const line = (rows, f, col) => { const d = rows.map((r, i) => (i ? 'L' : 'M') + x(r).toFixed(1) + ',' + y(r[f]).toFixed(1)).join(''); return '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2"/>' + rows.map((r) => '<circle cx="' + x(r).toFixed(1) + '" cy="' + y(r[f]).toFixed(1) + '" r="3" fill="' + col + '"/>').join(''); };
g += line(P, 'sbn', 'var(--eo-c-out)') + line(P.filter((r) => ok(r.ust)), 'ust', 'var(--eo-c-us)');
[P[0], P[P.length - 1]].forEach((r, i) => { g += '<text x="' + x(r) + '" y="' + (H - 8) + '" text-anchor="' + (i ? 'end' : 'start') + '" font-size="11" fill="var(--color-fg-muted)">' + r.date.replace(' (turunan)', '') + '</text>'; });
g += '<text x="' + x(P[P.length - 1]) + '" y="' + (y(P[P.length - 1].sbn) - 8) + '" text-anchor="end" font-size="12" fill="var(--color-fg)">' + fmt(P[P.length - 1].sbn, 2) + '%</text></svg>';
return '<div class="eo-note-s">Yield 10 tahun pada tanggal yang tercatat (jarak antar titik tidak sama)</div>' + g + '<div class="eo-map-leg"><span style="--k:var(--eo-c-out)">SBN Indonesia</span><span style="--k:var(--eo-c-us)">US Treasury</span></div>';
}
function b1() {
const R = get('sbn'), el = document.getElementById('eo-uang-b1'); if (!el) return; badge(document.getElementById('eo-uang-c1'), R);
if (!R.length) { el.innerHTML = '<div class="eo-q-line">Belum ada data.</div>'; return; }
const a = R[R.length - 1], f = R[0], sp = R.filter((r) => ok(r.spread)), s0 = sp[0], s1 = sp[sp.length - 1], hi = R.reduce((m, r) => r.sbn > m.sbn ? r : m, R[0]);
el.innerHTML = yieldChart(R) + '<table class="eo-tb"><tr><th>Tanggal</th><th class="n">SBN 10 th</th><th class="n">UST 10 th</th><th class="n">Selisih</th></tr>' + R.map((r) => '<tr><td>' + r.date + '</td><td class="n">' + fmt(r.sbn, 2) + '%</td><td class="n">' + (ok(r.ust) ? fmt(r.ust, 2) + '%' : '–') + '</td><td class="n">' + (ok(r.spread) ? fmt(r.spread, 2) + ' poin' : '–') + '</td></tr>').join('') + '</table>'
+ '<div class="eo-q-line"><span>Bacaan</span> Yield SBN 10 tahun naik dari sekitar ' + fmt(f.sbn, 2) + '% (Okt 2025, angka turunan, kepercayaan rendah) ke ' + fmt(a.sbn, 2) + '% pada ' + a.date + '; tertinggi yang tercatat ' + fmt(hi.sbn, 2) + '% pada ' + hi.date + '. Naiknya bertahap sejak April, lalu menanjak di Oktober. Selisih dengan obligasi AS ' + fmt(s1.spread, 2) + ' poin (' + s1.date + '), dibanding ' + fmt(s0.spread, 2) + ' poin di ' + s0.date + '.</div>'
+ '<div class="eo-q-line"><span>Artinya</span> Yield adalah imbal hasil yang diminta investor untuk memegang obligasi. Kalau naik, obligasi makin menarik dibanding saham, jadi saham harus lebih murah untuk bersaing. Selisih dengan UST adalah tambahan imbal hasil yang diminta untuk risiko Indonesia.</div>'
+ '<div class="eo-note-s">Ini ' + R.length + ' titik tanggal dari beberapa sumber, bukan deret bulanan resmi. Data harian lengkap (Kemenkeu atau BI) bisa menggantikannya. UST hanya ada di sebagian tanggal.</div>' + src(R);
}
function b2() {
const R = get('asingksei'), C = get('asingnegara'), el = document.getElementById('eo-uang-b2'); if (!el) return; badge(document.getElementById('eo-uang-c2'), R.concat(C));
if (!R.length) { el.innerHTML = '<div class="eo-q-line">Belum ada data.</div>'; return; }
const W = 640, H = 150, ml = 8, mb = 22, mt = 18, bw = (W - ml * 2) / R.length, mx = Math.max.apply(null, R.map((r) => r.value));
let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto" role="img" aria-label="Nilai saham dipegang asing, Rp triliun">';
R.forEach((r, i) => { const h = (H - mt - mb) * r.value / mx, x = ml + i * bw + bw * 0.16, w = bw * 0.68; svg += '<rect x="' + x + '" y="' + (H - mb - h) + '" width="' + w + '" height="' + h + '" fill="var(--eo-c-out)" fill-opacity="0.75"/><text x="' + (x + w / 2) + '" y="' + (H - mb - h - 4) + '" text-anchor="middle" font-size="11" fill="var(--color-fg)">' + fmt(r.value, 0) + '</text><text x="' + (x + w / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" fill="var(--color-fg-muted)">' + r.month + '</text>'; });
svg += '</svg>';
const jan = R.find((r) => /^Jan/.test(r.month)) || R[0], last = R[R.length - 1];
let h = '<div class="eo-note-s">Nilai saham yang dipegang investor asing (Rp triliun, data KSEI)</div>' + svg
+ '<div class="eo-q-line"><span>Bacaan</span> Dari ' + fmt(jan.value, 0) + ' T (' + jan.month + ') ke ' + fmt(last.value, 0) + ' T (' + last.month + '), turun ' + fmt(Math.abs(last.value / jan.value - 1) * 100, 1) + '%.' + (ok(jan.share) && ok(last.share) ? ' Porsi asing dari total saham turun dari ' + fmt(jan.share, 1) + '% ke ' + fmt(last.share, 1) + '%.' : '') + '</div>'
+ '<div class="eo-q-line"><span>Hati-hati</span> Nilai kepemilikan ikut turun saat harga saham turun. Penurunan ini bukan sepenuhnya penjualan oleh asing, dan titik datanya tidak bulanan penuh.</div>';
if (C.length) h += '<table class="eo-tb"><tr><th>Negara asal manajer investasi asing</th><th class="n">Emiten dipegang (>1%)</th></tr>' + C.map((r) => '<tr><td>' + r.country + '</td><td class="n">' + fmt(r.n, 0) + ' dari 60</td></tr>').join('') + '</table><div class="eo-note-s">Arus asing menurut negara asal tidak diterbitkan publik secara berkala. Tabel ini hitungan emiten per 31 Jul 2026, bukan nilai rupiah dan bukan arus, dan hanya 60 catatan manajer investasi. Gunakan sebagai gambaran siapa pemainnya saja.</div>';
const K = get('asingrisiko');
if (K.length) h += '<table class="eo-tb"><tr><th>Konsentrasi dan risiko</th><th class="n">Nilai</th></tr>' + K.filter((r) => ok(r.value)).map((r) => '<tr><td>' + r.label + '<div class="eo-note-s" style="margin:0">' + (r.notes || '') + '</div></td><td class="n">' + fmt(r.value, r.unit && /miliar/.test(r.unit) ? 1 : 1) + ' ' + (r.unit || '') + '</td></tr>').join('') + '</table>' + (K.some((r) => !ok(r.value)) ? '<div class="eo-q-line"><span>Tidak ada</span> Arus asing menurut negara asal tidak diterbitkan secara berkala oleh KSEI atau BEI, jadi tidak bisa ditampilkan. Dua tabel di atas adalah pendekatan terdekat: siapa pemegang besar (per negara manajer investasi) dan ke saham mana arus keluar terkonsentrasi.</div>' : '');
const kv = (re) => { const r = K.find((x) => re.test(x.label) && ok(x.value)); return r ? r.value : null; };
const ns = kv(/seluruh pasar/), mc = kv(/21 Okt/), m0 = kv(/akhir 2025/);
if (ns && mc && m0) h += '<table class="eo-tb"><tr><th>Net sell asing (Rp ' + fmt(ns, 1) + ' T) dibanding</th><th class="n">Ukuran</th><th class="n">Setara</th></tr><tr><td>Kapitalisasi pasar sekarang</td><td class="n">Rp ' + fmt(mc, 0) + ' T</td><td class="n">' + fmt(100 * ns / mc, 1) + '%</td></tr><tr><td>Kapitalisasi akhir 2025</td><td class="n">Rp ' + fmt(m0, 0) + ' T</td><td class="n">' + fmt(100 * ns / m0, 1) + '%</td></tr><tr><td>Nilai pasar yang hilang sejak akhir 2025</td><td class="n">Rp ' + fmt(m0 - mc, 0) + ' T</td><td class="n">' + fmt(100 * ns / (m0 - mc), 1) + '%</td></tr></table><div class="eo-q-line"><span>Bacaan</span> Net sell hanya sekitar ' + fmt(100 * ns / mc, 0) + '% dari nilai pasar, jauh lebih kecil dari penurunan nilai pasar (' + fmt(100 * (m0 - mc) / m0, 0) + '%). Penurunan terutama dari harga yang turun, bukan dari volume yang keluar. Arus asing tetap sinyal: yang menjual biasanya pemegang saham besar yang likuid, dan setiap net sell harus diserap pembeli domestik.</div>';
el.innerHTML = h + src(R.concat(C, K));
}
function b3() {
const R = get('valuasi'), el = document.getElementById('eo-uang-b3'); if (!el) return; badge(document.getElementById('eo-uang-c3'), R);
if (!R.length) { el.innerHTML = '<div class="eo-q-line">Belum ada data.</div>'; return; }
const sb = get('sbn'), y = sb.length ? sb[sb.length - 1] : null, cmp = R.filter((r) => r.avg || r.pos), l = R[R.length - 1];
el.innerHTML = '<table class="eo-tb"><tr><th>Tanggal</th><th class="n">PER</th><th class="n">PBV</th><th>Jenis</th><th>Dibanding rata-rata historis</th><th>Sumber</th></tr>' + R.map((r) => '<tr><td>' + r.date + '</td><td class="n">' + fmt(r.per, 2) + 'x</td><td class="n">' + (ok(r.pbv) ? fmt(r.pbv, 2) + 'x' : '–') + '</td><td>' + (r.kind || '') + '</td><td>' + [r.avg ? 'rata-rata ' + r.avg : '', r.pos || ''].filter(Boolean).join(' · ') + '</td><td>' + (r.source || '') + '</td></tr>').join('') + '</table>'
+ '<div class="eo-q-line"><span>Bacaan</span> ' + cmp.length + ' dari ' + R.length + ' sumber menyebut posisi IHSG terhadap rata-rata historisnya, dan semuanya menempatkannya jauh di bawah: PER sekitar 40–44% di bawah rata-rata 10 tahun (IPOT dan Stockbit), serta 2 sampai 3 standar deviasi di bawah (CNBC, Bibit, Rikopedia). Perbankan menurut IPOT: PER 8,1x dibanding rata-rata 14,3x, PBV sekitar 1,5x dibanding 2,2x.</div>'
+ '<div class="eo-q-line"><span>Artinya</span> PER = harga saham ÷ laba per saham. PER ' + fmt(l.per, 2) + 'x berarti investor membayar Rp ' + fmt(l.per, 2) + ' untuk tiap Rp 1 laba tahunan; kebalikannya (1 ÷ PER) adalah imbal laba ' + fmt(100 / l.per, 1) + '% per tahun' + (y ? ', yang bisa dibandingkan dengan yield SBN 10 tahun ' + fmt(y.sbn, 2) + '% (' + y.date + ')' : '') + '. Tanggalnya berbeda, hanya indikasi kasar.</div>'
+ '<div class="eo-q-line"><span>Hati-hati</span> Murah secara historis belum tentu dasar. PER maju (forward) memakai proyeksi laba analis yang bisa dipangkas, dan sumber-sumbernya memakai metode berbeda (angka PER berkisar 7,5x sampai 12,7x pada Okt 2026), jadi baca sebagai kisaran. Sumber juga menyebut risiko reklasifikasi MSCI sebagai tekanan tambahan. Rata-rata historis dikutip dari blog yang merujuk IPOT dan Stockbit, bukan dari laporan aslinya.</div>' + src(R);
}
function render() { try { b1(); b2(); b3(); } catch (e) { console.warn('uang', e && e.message); } }
render(); try { if (typeof dash !== 'undefined' && dash.onData) dash.onData(render); } catch (e) {}
})();
