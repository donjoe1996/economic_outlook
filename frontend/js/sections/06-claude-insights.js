/*
 * "Insight dari Claude" panel. Shows data/insights/latest.json, written either
 * by the button here (POST /api/insights/generate, backend/ai.py) or by the
 * project skill .claude/skills/economic-insights in Claude Code. Both check
 * every number against the fact sheet before publishing. Text is set with
 * textContent only.
 */
(function () {
  const LAYER = { dunia: 'Dunia', as: 'AS', indonesia: 'Indonesia', uang: 'Uang', pasar: 'Pasar saham', kredit: 'Kredit', bank: 'Untuk saham bank' };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // The button: Claude reads the fact sheet and writes the panel (about a minute).
  function button(label) {
    const b = el('button', 'adm-btn eo-ci-go', label);
    b.type = 'button';
    b.title = 'Claude membaca ringkasan data dan menulis insight; setiap angka dicek sebelum tampil. Memakai kunci Claude di komputer ini.';
    b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Claude sedang menulis…';
      try {
        const out = await EOJobs.run('/api/insights/generate');
        await dash.reload();
        flash('Insight baru: ' + out.result.insights + ' bacaan, ' + out.result.numbers + ' angka cocok dengan data.', 'ok');
      } catch (e) {
        flash(e.message, 'bad');
        b.disabled = false; b.textContent = label;
      }
    });
    return b;
  }
  function flash(msg, kind) {
    const t = document.getElementById('adm-toast'); if (!t) return;
    t.textContent = msg; t.className = 'adm-toast show ' + (kind || '');
    clearTimeout(flash._t); flash._t = setTimeout(() => { t.className = 'adm-toast'; }, kind === 'bad' ? 12000 : 5000);
  }

  function render() {
    const box = document.getElementById('eo-ci-body'); if (!box) return;
    const d = dash.data('insights');
    if (d.status === 'loading') return;
    if (d.status !== 'ok' || !d.data || !Array.isArray(d.data.insights)) {
      const bar = el('div', 'eo-ci-bar');
      bar.append(button('✦ Buat insight dengan Claude'), el('span', 'eo-ci-meta', 'Belum ada insight. Claude membaca ringkasan angka (bukan data mentah) dan setiap angka yang ditulisnya dicek dulu.'));
      box.replaceChildren(bar);
      return;
    }
    const doc = d.data;
    const when = doc.generated_at ? new Date(doc.generated_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
    const head = el('div', 'eo-ci-bar');
    head.append(el('span', 'eo-ci-meta', 'Ditulis ' + when + ' · data per ' + (doc.data_as_of || '–') + (doc.check ? ' · ' + doc.check.numbers + ' angka dicek terhadap ringkasan data, semua cocok' : '')), button('✦ Perbarui insight'));
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
