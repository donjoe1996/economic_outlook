(function () {
const fmt = (v, n) => Number(v).toLocaleString('id-ID', { minimumFractionDigits: n, maximumFractionDigits: n });
const get = (id) => { try { const d = dash.data(id); return (d.status === 'ok' && d.data) ? d.data : []; } catch (e) { return []; } };
function render() {
const el = document.getElementById('eo-sek-b'); if (!el) return;
const A = get('sektor'), T = A.find((r) => /^Total/.test(r.label)), R = A.filter((r) => !/^Total/.test(r.label)).sort((a, b) => b.cap - a.cap);
if (!R.length || !T) { el.innerHTML = '<div class="eo-q-line">Belum ada data.</div>'; return; }
const lows = R.filter((r) => r.confidence === 'Rendah').length, c = document.getElementById('eo-sek-c'), lo = lows / R.length >= 0.25;
if (c) { c.textContent = 'Kepercayaan: ' + (lo ? 'Rendah (sebagian turunan)' : 'Sedang'); c.className = 'eo-conf-badge conf-' + (lo ? 'rendah' : 'sedang'); }
const mx = R[0].w, top4 = R.slice(0, 4).reduce((s, r) => s + r.w, 0), st = [], now = 9379;
R.forEach((r) => (r.top || '').replace(/([A-Z]{4}) (\d+)/g, (m, k, v) => st.push([k, +v])));
st.sort((a, b) => b[1] - a[1]); const t10 = st.slice(0, 10), s10 = t10.reduce((s, x) => s + x[1], 0), fin = R.find((r) => /Keuangan/.test(r.label));
el.innerHTML = '<table class="eo-tb"><tr><th>Sektor</th><th>Bobot</th><th class="n">%</th><th class="n">Rp T</th><th>Saham terbesar (Rp T)</th></tr>' + R.map((r) => '<tr><td>' + r.label + (r.confidence === 'Rendah' ? ' <span class="eo-note-s" style="display:inline;margin:0">(turunan)</span>' : '') + '</td><td style="width:26%"><div style="height:10px;border-radius:3px;background:var(--eo-c-out);width:' + (100 * r.w / mx).toFixed(0) + '%"></div></td><td class="n">' + fmt(r.w, 1) + '</td><td class="n">' + fmt(r.cap, 0) + '</td><td>' + (r.top || '') + '</td></tr>').join('') + '<tr><td><b>Total BEI</b></td><td></td><td class="n"><b>100</b></td><td class="n"><b>' + fmt(T.cap, 0) + '</b></td><td></td></tr></table>'
+ '<div class="eo-q-line"><span>Bacaan</span> Empat sektor teratas (' + R.slice(0, 4).map((r) => r.label).join(', ') + ') memegang ' + fmt(top4, 0) + '% IHSG. ' + R[0].label + ' terbesar dengan ' + fmt(R[0].w, 1) + '%. Sepuluh saham terbesar yang tercantum (' + t10.map((x) => x[0]).join(', ') + ') saja sekitar ' + fmt(100 * s10 / T.cap, 0) + '% dari seluruh kapitalisasi, jadi indeks sangat bergantung pada segelintir saham.</div>'
+ '<div class="eo-q-line"><span>Artinya</span> Bobot = kapitalisasi sektor ÷ kapitalisasi seluruh BEI. IHSG dihitung dari kapitalisasi, jadi sektor dan saham besar paling menggerakkan indeks. Bank (Keuangan ' + (fin ? fmt(fin.w, 0) : '') + '%) turun lebih kecil dari IHSG tahun ini, jadi penurunan indeks banyak datang dari sektor lain.</div>'
+ '<div class="eo-q-line"><span>Hati-hati</span> Potret akhir Maret 2026. Total kapitalisasi sejak itu turun dari Rp ' + fmt(T.cap, 0) + ' T ke sekitar Rp ' + fmt(now, 0) + ' T (21 Okt), dan DSSA, BREN, CUAN kena sanksi OJK 16 Okt, jadi bobot Energi dan Infrastruktur kini kemungkinan lebih kecil. Data sektor terbaru belum ada. "Turunan" = dihitung dari porsi saham terbesar sektornya (jumlahnya cocok dengan total dalam 0,1%).</div>'
+ (R[0].url ? '<div class="eo-note-s">Sumber: <a href="' + R[0].url + '" target="_blank" rel="noopener">idxchannel.com</a></div>' : '');
}
try { render(); if (typeof dash !== 'undefined' && dash.onData) dash.onData(render); } catch (e) { console.warn('sektor', e && e.message); }
})();
