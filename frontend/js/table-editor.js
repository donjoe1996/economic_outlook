/*
 * Table editor: view and edit one dataset of the data store in the app.
 *
 *   EOTable.open('pmi', { onSaved })     editable store dataset
 *   EOTable.open('saham', {})            a feed (GOOGLEFINANCE) opens read-only
 *   EOTable.open('saham_fund', { filter: 'BBCA' })   start with rows matching a text
 *
 * Reads rows, column names and types from GET /api/data?ids=<id>; saves the
 * whole table with POST /api/datasets/<id>/table (a job). The server checks
 * every row again (keys present and unique, numbers in number columns) and
 * recomputes derived columns, so the checks here are only for quick feedback.
 * Every value is set with .value / textContent, never as HTML.
 */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach((c) => c != null && n.append(c));
    return n;
  }
  const NUM = /^-?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/;

  let dlg = null;
  function dialog() {
    if (dlg) return dlg;
    dlg = el('dialog', { class: 'adm-dlg te-dlg', 'aria-labelledby': 'te-title' }, [
      el('div', { class: 'te-head' }, [
        el('h2', { id: 'te-title' }),
        el('input', { type: 'search', id: 'te-filter', placeholder: 'Saring baris…', 'aria-label': 'Saring baris' }),
      ]),
      el('p', { class: 'adm-help', id: 'te-help' }),
      el('div', { class: 'te-scroll' }, [el('table', { class: 'te-tb', id: 'te-tb' })]),
      el('p', { class: 'adm-bad', id: 'te-err', role: 'alert' }),
      el('div', { class: 'adm-actions' }, [
        el('button', { type: 'button', class: 'adm-btn', id: 'te-add' }, ['+ Baris']),
        el('span', { class: 'adm-grow' }),
        el('button', { type: 'button', class: 'adm-btn', id: 'te-close' }, ['Tutup']),
        el('button', { type: 'button', class: 'adm-btn primary', id: 'te-save' }, ['Simpan']),
      ]),
    ]);
    document.body.append(dlg);
    $('#te-close', dlg).addEventListener('click', () => close());
    dlg.addEventListener('cancel', (e) => { if (dirty() && !confirm('Buang perubahan yang belum disimpan?')) e.preventDefault(); });
    $('#te-filter', dlg).addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      $('#te-tb', dlg).querySelectorAll('tbody tr').forEach((tr) => {
        tr.hidden = !!q && ![...tr.querySelectorAll('input')].some((i) => i.value.toLowerCase().includes(q));
      });
    });
    return dlg;
  }

  let state = null;   // {id, header, types, keys, derived, readonly, original, onSaved}
  const dirty = () => !!state && !state.readonly && JSON.stringify(current()) !== JSON.stringify(state.original);
  function close() { if (!dirty() || confirm('Buang perubahan yang belum disimpan?')) dlg.close(); }

  function current() {
    return [...$('#te-tb', dlg).querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('input')].map((i) => i.value.trim()));
  }

  function cellInput(v, c) {
    const typ = state.types[c], ro = state.readonly || state.derived.includes(c);
    const inp = el('input', {
      type: 'text', value: v == null ? '' : String(v), 'aria-label': state.header[c] || 'Kolom ' + (c + 1),
      readonly: ro, inputmode: typ === 'number' ? 'decimal' : null,
      class: 'te-in' + (typ === 'number' ? ' num' : '') + (state.keys.includes(c) ? ' key' : '') + (ro ? ' ro' : ''),
      title: state.derived.includes(c) ? 'Dihitung otomatis saat disimpan' : null,
    });
    inp.addEventListener('input', () => {
      const bad = typ === 'number' && inp.value.trim() !== '' && !NUM.test(inp.value.trim());
      inp.classList.toggle('bad', bad);
    });
    return inp;
  }

  function rowEl(r) {
    const tds = state.header.map((_, c) => el('td', {}, [cellInput(r[c], c)]));
    const del = state.readonly ? null : el('button', { type: 'button', class: 'te-del', title: 'Hapus baris', 'aria-label': 'Hapus baris' }, ['×']);
    if (del) del.addEventListener('click', () => del.closest('tr').remove());
    return el('tr', {}, [...tds, el('td', { class: 'te-x' }, [del])]);
  }

  async function open(id, opts) {
    opts = opts || {};
    const d = dialog();
    $('#te-err', d).textContent = '';
    $('#te-filter', d).value = '';
    $('#te-title', d).textContent = 'Memuat…';
    $('#te-tb', d).replaceChildren();
    d.showModal();
    let j, meta;
    try {
      [j, meta] = await Promise.all([
        EOJobs.api('GET', '/api/data?ids=' + encodeURIComponent(id)),
        EOJobs.api('GET', '/api/datasets'),
      ]);
    } catch (e) { $('#te-err', d).textContent = 'Gagal memuat: ' + e.message; return; }
    const item = j.datasets[id] || {}, m = (meta || []).find((x) => x.id === id) || {};
    const rows = (item.answer && item.answer.values) || [];
    const width = Math.max((item.header || []).length, ...rows.map((r) => r.length), (m.columns || []).length);
    const header = Array.from({ length: width }, (_, c) => (item.header || [])[c] || ((m.columns || [])[c] || {}).name || 'Kolom ' + (c + 1));
    state = {
      id, header, types: Array.from({ length: width }, (_, c) => (item.types || [])[c] || 'string'),
      keys: (m.columns || []).filter((c) => c.key).map((c) => c.index),
      derived: m.derived || [], readonly: !m.editable, onSaved: opts.onSaved,
      original: rows.map((r) => header.map((_, c) => (r[c] == null ? '' : String(r[c])))),
    };
    $('#te-title', d).textContent = (m.title || id) + (state.readonly ? ' (hanya-baca)' : '');
    $('#te-help', d).textContent = state.readonly
      ? (m.source === 'sheet' ? 'Diisi rumus GOOGLEFINANCE di Google Sheet (feed harga). Ubah di Sheet-nya; aplikasi menyalinnya setiap kali Tarik.' : 'Dataset ini hanya-baca.')
      : rows.length + ' baris. Kolom tebal adalah kunci (wajib, tidak boleh dobel). ' +
        (state.derived.length ? 'Kolom abu-abu dihitung otomatis. ' : '') + 'Angka pakai titik untuk desimal. Disimpan ke file JSON di Drive.';
    const head = el('thead', {}, [el('tr', {}, [...header.map((h, c) => el('th', {
      class: (state.keys.includes(c) ? 'key' : '') + (state.types[c] === 'number' ? ' num' : ''), title: state.types[c],
    }, [h])), el('th', {})])]);
    $('#te-tb', d).replaceChildren(head, el('tbody', {}, rows.map(rowEl)));
    $('#te-add', d).hidden = state.readonly;
    $('#te-save', d).hidden = state.readonly;
    if (opts.filter) { const f = $('#te-filter', d); f.value = opts.filter; f.dispatchEvent(new Event('input')); }
  }

  async function save() {
    const d = dialog(), err = $('#te-err', d), btn = $('#te-save', d);
    err.textContent = '';
    if ($('#te-tb', d).querySelector('input.bad')) { err.textContent = 'Ada isian bukan angka di kolom angka (ditandai merah).'; return; }
    btn.disabled = true;
    try {
      const out = await EOJobs.run('/api/datasets/' + encodeURIComponent(state.id) + '/table', { rows: current() });
      state.original = current();
      d.close();
      if (state.onSaved) state.onSaved(out);
    } catch (e) { err.textContent = e.message; }
    btn.disabled = false;
  }

  document.addEventListener('click', (e) => {
    if (!dlg || !dlg.open) return;
    if (e.target.id === 'te-save') save();
    if (e.target.id === 'te-add') {
      const tb = $('#te-tb tbody', dlg), tr = rowEl([]);
      tb.append(tr); tr.querySelector('input:not([readonly])').focus();
      tr.scrollIntoView({ block: 'nearest' });
    }
  });

  window.EOTable = { open };
})();
