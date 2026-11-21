/*
 * Toolbar above the dashboard: connect Google, pull from the Sheet, add or
 * update a row, run automatic updaters, see where each dataset comes from.
 *
 * Every value from the Sheet is shown with textContent (never innerHTML),
 * so text in a cell can't inject code into the page.
 */
(function () {
  const $ = (sel) => document.querySelector(sel);

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v === true ? '' : v);
    }
    (children || []).forEach((c) => c && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }

  async function api(method, path, body) {
    const r = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || ('HTTP ' + r.status));
    return j;
  }

  function toast(msg, kind) {
    const t = $('#adm-toast');
    t.textContent = msg;
    t.className = 'adm-toast show ' + (kind || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = 'adm-toast'; }, kind === 'bad' ? 9000 : 4500);
  }

  function busy(btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Memproses…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label; btn.disabled = false; }
  }

  function fmtTime(iso) {
    if (!iso) return '–';
    const d = new Date(iso);
    return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ------------------------------------------------------------ status line
  function renderStatus() {
    const m = window.EO_META || {};
    const g = m.google || {};
    const ds = m.datasets || {};
    const times = Object.values(ds).map((d) => d.fetched_at).filter(Boolean).sort();
    const srcs = new Set(Object.values(ds).map((d) => d.source).filter(Boolean));
    const from = srcs.has('sheet') ? 'Google Sheet' : srcs.has('xlsx-import') ? 'salinan .xlsx' : '–';
    $('#adm-status').textContent = times.length
      ? 'Data lokal dari ' + from + ', terakhir ditarik ' + fmtTime(times[times.length - 1])
      : 'Belum ada data lokal. Hubungkan Google lalu klik "Tarik dari Sheet" (atau impor .xlsx, lihat README).';
    const gs = $('#adm-google');
    gs.textContent = g.signed_in ? 'Google: terhubung' : (g.has_credentials_file ? 'Google: belum masuk' : 'Google: belum disiapkan');
    gs.className = 'adm-pill ' + (g.signed_in ? 'ok' : 'warn');
    $('#adm-login').hidden = !!g.signed_in;
    if (m.sheet_url) $('#adm-sheet').href = m.sheet_url;
  }
  window.addEventListener('eo:data', renderStatus);

  // ------------------------------------------------------------ actions
  async function login(e) {
    const b = e.currentTarget;
    busy(b, true, 'Lanjutkan di browser…');
    try {
      await api('POST', '/api/auth/login');
      busy(b, false); busy(b, true, 'Menarik data…');
      await api('POST', '/api/refresh', {});  // first sign-in: fill the local copy right away
      await dash.reload();
      toast('Terhubung ke Google dan data ditarik dari Sheet.', 'ok');
    }
    catch (err) { toast(err.message, 'bad'); }
    finally { busy(b, false); }
  }

  async function refresh(e) {
    const b = e.currentTarget;
    busy(b, true, 'Menarik…');
    try {
      const r = await api('POST', '/api/refresh', {});
      await dash.reload();
      toast(Object.keys(r.rows).length + ' dataset ditarik dari Google Sheet.', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
    finally { busy(b, false); }
  }

  // ------------------------------------------------------------ add / update row
  let described = [];

  async function openForm() {
    try { described = await api('GET', '/api/datasets'); } catch (err) { toast(err.message, 'bad'); return; }
    const sel = $('#adm-ds');
    sel.replaceChildren(...described.filter((d) => d.write === 'append' || d.write === 'fill')
      .map((d) => el('option', { value: d.id, text: d.title + (d.write === 'fill' ? ' (isi baris yang ada)' : '') })));
    buildFields();
    $('#adm-form-dlg').showModal();
  }

  function buildFields() {
    const d = described.find((x) => x.id === $('#adm-ds').value);
    const box = $('#adm-fields');
    box.replaceChildren();
    if (!d) return;
    $('#adm-ds-help').textContent = (d.description || '') + ' · ' + d.range + ' · mode: ' +
      (d.write === 'append' ? 'tambah periode baru, atau perbarui periode yang sudah ada' : 'hanya mengisi/memperbaiki baris yang sudah ada');

    // last rows, for orientation
    const t = el('table', { class: 'adm-tb' }, [
      el('tr', {}, d.columns.map((c) => el('th', { text: c.name }))),
      ...d.last_rows.map((r) => el('tr', {}, r.map((v) => el('td', { text: v })))),
    ]);
    box.appendChild(el('div', { class: 'adm-scroll' }, [el('div', { class: 'adm-cap', text: 'Baris terakhir di Sheet' }), t]));

    d.columns.forEach((c) => {
      const listId = 'adm-dl-' + c.index;
      const input = el('input', {
        name: 'c' + c.index, list: c.suggestions.length ? listId : null, required: c.key,
        inputmode: c.numeric ? 'decimal' : null, placeholder: c.numeric ? 'angka, titik untuk desimal' : '',
      });
      box.appendChild(el('label', { class: 'adm-field' + (c.key ? ' key' : '') }, [
        el('span', { text: c.name + (c.key ? ' *' : '') + (c.numeric ? ' (angka)' : '') }),
        input,
        c.suggestions.length ? el('datalist', { id: listId }, c.suggestions.map((s) => el('option', { value: s }))) : null,
      ]));
    });
    box.appendChild(el('p', { class: 'adm-help', text: 'Kolom kosong tidak ditulis, jadi rumus dan catatan yang sudah ada di Sheet tetap aman. Kalau periodenya sudah ada, hanya sel yang Anda isi yang diperbarui.' }));
  }

  async function submitForm(e) {
    e.preventDefault();
    const d = described.find((x) => x.id === $('#adm-ds').value);
    const form = e.currentTarget;
    const values = d.columns.map((c) => form.elements['c' + c.index].value);
    const b = $('#adm-submit');
    busy(b, true, 'Menyimpan ke Sheet…');
    try {
      const r = await api('POST', '/api/datasets/' + encodeURIComponent(d.id) + '/rows', { values });
      const what = { append: 'Baris baru ditambahkan', update: 'Baris diperbarui', unchanged: 'Tidak ada yang berubah' }[r.action];
      toast(what + ' (baris ' + r.sheet_row + ' di Sheet, ' + r.cells_written + ' sel).', 'ok');
      $('#adm-form-dlg').close();
      await dash.reload();
    } catch (err) { toast(err.message, 'bad'); }
    finally { busy(b, false); }
  }

  // ------------------------------------------------------------ updaters
  let preview = {};

  async function openUpdaters(e) {
    const b = e.currentTarget;
    busy(b, true, 'Mengecek sumber…');
    try { preview = await api('GET', '/api/updaters/preview'); }
    catch (err) { toast(err.message, 'bad'); busy(b, false); return; }
    busy(b, false);
    const box = $('#adm-upd');
    box.replaceChildren();
    for (const [id, p] of Object.entries(preview)) {
      const sec = el('div', { class: 'adm-upd-ds' }, [el('h3', { text: p.title })]);
      if (p.error) sec.appendChild(el('p', { class: 'adm-bad', text: 'Gagal: ' + p.error }));
      else if (!p.rows.length) sec.appendChild(el('p', { class: 'adm-help', text: 'Tidak ada periode baru.' }));
      else p.rows.forEach((row, i) => {
        sec.appendChild(el('label', { class: 'adm-upd-row' }, [
          el('input', { type: 'checkbox', checked: true, 'data-ds': id, 'data-i': String(i) }),
          el('code', { text: row.filter((v) => v !== '').slice(0, 4).join(' · ') }),
        ]));
      });
      box.appendChild(sec);
    }
    if (!Object.keys(preview).length) box.appendChild(el('p', { class: 'adm-help', text: 'Belum ada dataset dengan updater di config/datasets.yaml.' }));
    $('#adm-upd-dlg').showModal();
  }

  async function applyUpdaters(e) {
    e.preventDefault();
    const picked = {};
    document.querySelectorAll('#adm-upd input[type=checkbox]:checked').forEach((c) => {
      (picked[c.dataset.ds] = picked[c.dataset.ds] || []).push(preview[c.dataset.ds].rows[+c.dataset.i]);
    });
    const b = $('#adm-upd-apply');
    busy(b, true, 'Menulis ke Sheet…');
    try {
      let n = 0;
      for (const [ds, rows] of Object.entries(picked)) { const r = await api('POST', '/api/updaters/apply', { dataset: ds, rows }); n += r.results.length; }
      toast(n + ' baris ditulis ke Sheet.', 'ok');
      $('#adm-upd-dlg').close();
      await dash.reload();
    } catch (err) { toast(err.message, 'bad'); }
    finally { busy(b, false); }
  }

  // ------------------------------------------------------------ sources
  function openSources() {
    const ds = (window.EO_META || {}).datasets || {};
    const mode = { append: 'tambah', fill: 'isi', none: 'baca' };
    $('#adm-src').replaceChildren(el('table', { class: 'adm-tb' }, [
      el('tr', {}, ['Dataset', 'id', 'Sumber', 'Tulis', 'Baris', 'Ditarik'].map((h) => el('th', { text: h }))),
      ...Object.entries(ds).map(([id, d]) => el('tr', {}, [
        el('td', {}, [el('b', { text: d.title }), el('div', { class: 'adm-help', text: d.description || '' })]),
        el('td', {}, [el('code', { text: id })]),
        el('td', { text: d.kind === 'file' ? 'file lokal' : (d.range || '–') }),
        el('td', { text: mode[d.write] || '–' }),
        el('td', { text: d.answer && d.answer.values ? String(d.answer.values.length) : (d.status === 'ok' ? '✓' : d.status) }),
        el('td', { text: fmtTime(d.fetched_at) }),
      ])),
    ]));
    $('#adm-src-dlg').showModal();
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#adm-login').addEventListener('click', login);
    $('#adm-refresh').addEventListener('click', refresh);
    $('#adm-add').addEventListener('click', openForm);
    $('#adm-ds').addEventListener('change', buildFields);
    $('#adm-form').addEventListener('submit', submitForm);
    $('#adm-auto').addEventListener('click', openUpdaters);
    $('#adm-upd-form').addEventListener('submit', applyUpdaters);
    $('#adm-sources').addEventListener('click', openSources);
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  });
})();
