/*
 * "Insight dari Claude" panel. Shows data/insights/latest.json, written by
 * the project skill .claude/skills/economic-insights (see README). Text is
 * set with textContent only.
 */
(function () {
  const LAYER = { dunia: 'Dunia', as: 'AS', indonesia: 'Indonesia', uang: 'Uang', pasar: 'Pasar saham', kredit: 'Kredit', bank: 'Untuk saham bank' };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  function render() {
    const box = document.getElementById('eo-ci-body'); if (!box) return;
    const d = dash.data('insights');
    if (d.status === 'loading') return;
    if (d.status !== 'ok' || !d.data || !Array.isArray(d.data.insights)) {
      box.replaceChildren(el('div', 'eo-q-line', 'Belum ada insight. Di Claude Code, di folder proyek ini, minta: "buat insight dari data dashboard" (skill economic-insights), lalu muat ulang halaman ini.'));
      return;
    }
    const doc = d.data;
    const when = doc.generated_at ? new Date(doc.generated_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
    const head = el('div', 'eo-ci-meta', 'Ditulis ' + when + ' · data per ' + (doc.data_as_of || '–') + (doc.check ? ' · ' + doc.check.numbers + ' angka dicek terhadap ringkasan data, semua cocok' : ''));
    const grid = el('div', 'eo-ci-grid');
    doc.insights.forEach((it) => {
      const card = el('div', 'eo-ci-item' + (it.layer === 'bank' ? ' eo-ci-bank' : ''));
      card.append(el('div', 'eo-ci-layer', LAYER[it.layer] || it.layer || ''), el('h3', 'eo-ci-title', it.title || ''), el('p', 'eo-ci-body', it.body || ''));
      if (it.evidence) card.append(el('p', 'eo-ci-ev', it.evidence));
      grid.append(card);
    });
    const parts = [head, grid];
    if (Array.isArray(doc.data_gaps) && doc.data_gaps.length) {
      const g = el('div', 'eo-ci-gaps'); g.append(el('b', null, 'Data yang belum masuk: '), document.createTextNode(doc.data_gaps.join(' · ')));
      parts.push(g);
    }
    parts.push(el('div', 'eo-note-s', 'Ditulis model AI dari angka yang dihitung skrip, bukan dari data mentah. Bacaan data, bukan rekomendasi investasi.'));
    box.replaceChildren(...parts);
  }
  try { render(); dash.onData(render); } catch (e) { console.warn('claude-insights', e && e.message); }
})();
