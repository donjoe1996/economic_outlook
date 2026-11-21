(function () {
function ok(v) { return v !== null && v !== undefined && !isNaN(v); }
function rows(id, f) { try { const d = dash.data(id); return (d.status === 'ok' && d.data) ? d.data.filter((r) => ok(r[f])) : []; } catch (e) { return []; } }
const fmt = (v, n) => Number(v).toLocaleString('id-ID', { minimumFractionDigits: n, maximumFractionDigits: n });
const sg = (v, n) => (v >= 0 ? '+' : '−') + fmt(Math.abs(v), n);
function render() {
const el = document.getElementById('eo-tanya-conds'); if (!el) return;
const fl = rows('flow', 'flow_idr_t'), fx = rows('rupiah', 'usd_idr'), pm = rows('pmi', 'pmi'), bi = rows('birate', 'bi_rate'), fd = rows('fed', 'fed_upper');
const C = [];
if (fl.length >= 2) { const a = fl[fl.length - 1], b = fl[fl.length - 2]; C.push(['Asing beli bersih 2 bulan berturut-turut', a.flow_idr_t > 0 && b.flow_idr_t > 0, b.month + ' ' + sg(b.flow_idr_t, 1) + ' T · ' + a.month + ' ' + sg(a.flow_idr_t, 1) + ' T']); }
if (fx.length >= 2) { const a = fx[fx.length - 1], b = fx[fx.length - 2]; C.push(['USD/IDR berhenti naik', a.usd_idr <= b.usd_idr, b.month + ' ' + fmt(b.usd_idr, 0) + ' → ' + a.month + ' ' + fmt(a.usd_idr, 0)]); }
if (pm.length >= 3) { const t = pm.slice(-3); C.push(['PMI Indonesia di atas 50 selama 3 bulan', t.every((r) => r.pmi > 50), t.map((r) => r.month + ' ' + fmt(r.pmi, 1)).join(' · ')]); }
if (bi.length >= 2 && fd.length >= 2) { const sp = (r) => { const f = fd.find((x) => x.month === r.month); return f ? r.bi_rate - f.fed_upper : null; }; const a = bi[bi.length - 1], b = bi[bi.length - 2], sa = sp(a), sb = sp(b); if (ok(sa) && ok(sb)) C.push(['Selisih BI Rate − Fed Funds menyempit', sa < sb || a.bi_rate < b.bi_rate, b.month + ' ' + sg(sb, 2) + ' → ' + a.month + ' ' + sg(sa, 2) + ' poin']); }
if (!C.length) { el.innerHTML = '<div class="eo-q-line">Belum ada data.</div>'; return; }
const sb = rows('sbn', 'sbn'); if (sb.length >= 2) { const a = sb[sb.length - 1], ms = (x) => Date.parse(x.iso); let b = sb[sb.length - 2]; sb.forEach((x) => { if (ms(x) <= ms(a) - 25 * 864e5) b = x; }); C.push(['Yield SBN 10 tahun tidak naik dibanding sebulan lalu', a.sbn <= b.sbn, b.date + ' ' + fmt(b.sbn, 2) + '% → ' + a.date + ' ' + fmt(a.sbn, 2) + '%']); }
const vl = rows('valuasi', 'per'); if (vl.length && sb.length) { const p = vl[vl.length - 1].per, y = sb[sb.length - 1].sbn; C.push(['Imbal laba IHSG (1 ÷ PER) di atas yield SBN 10 tahun', 100 / p > y, 'PER ' + fmt(p, 2) + 'x → ' + fmt(100 / p, 1) + '% vs SBN ' + fmt(y, 2) + '% (tanggal berbeda, kasar)']); }
const n = C.filter((c) => c[1]).length;
const rd = document.getElementById('eo-q1-read'); if (rd) rd.textContent = n + ' dari ' + C.length + ' syarat terpenuhi: ' + (n <= C.length * 0.4 ? 'kondisi belum mendukung risiko saham Indonesia.' : n < C.length * 0.8 ? 'kondisi campuran, belum jelas mendukung.' : 'kondisi mulai mendukung.');
el.innerHTML = C.map((c) => '<div class="eo-q-cond"><div>' + c[0] + '<small>' + c[2] + '</small></div><span class="eo-conf-badge ' + (c[1] ? 'conf-tinggi' : 'conf-rendah') + '">' + (c[1] ? 'Terpenuhi' : 'Belum') + '</span></div>').join('') + '<div class="eo-q-line" style="margin-top:8px"><b>' + n + ' dari ' + C.length + ' terpenuhi.</b> Semakin banyak terpenuhi, semakin kecil tekanan pada multiple saham domestik, terutama bank.</div>';
}
try { render(); if (typeof dash !== 'undefined' && dash.onData) dash.onData(render); } catch (e) { console.warn('tanya', e && e.message); }
})();
