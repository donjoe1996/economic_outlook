/*
 * Toolbar above the dashboard: connect Google, pull from the Sheet, add or
 * update a row, run automatic updaters, see where each dataset comes from,
 * and see what the app is doing right now (progress) or did (activity log).
 *
 * Slow actions run as server-side jobs. runJob() starts one, then asks the
 * server for its progress every 400 ms and draws the progress panel.
 *
 * Every value from the Sheet is shown with textContent (never innerHTML),
 * so text in a cell can't inject code into the page.
 */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const ACTION_BUTTONS = ['#adm-login', '#adm-refresh', '#adm-add', '#adm-auto'];

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
      cache: 'no-store',
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

  function fmtTime(iso) {
    if (!iso) return '–';
    return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  const secs = (s) => (s < 60 ? s.toFixed(1) + ' dtk' : Math.floor(s / 60) + ' mnt ' + Math.round(s % 60) + ' dtk');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------ progress panel
  let activeJob = null;

  function setBusy(on) {
    ACTION_BUTTONS.forEach((s) => { const b = $(s); if (b) b.disabled = on; });
  }

  function drawProgress(job) {
    const box = $('#adm-prog');
    box.hidden = false;
    box.className = 'adm-prog ' + job.state;
    $('#adm-prog-title').textContent = job.title;
    $('#adm-prog-now').textContent = job.state === 'error' ? job.error : job.current;
    const count = job.total ? job.done + '/' + job.total + ' · ' : '';
    $('#adm-prog-meta').textContent = count + secs(job.elapsed);
    const bar = $('#adm-prog-bar');
    const known = job.total > 0;
    bar.classList.toggle('indeterminate', job.state === 'running' && !known);
    bar.style.width = job.state !== 'running' ? '100%' : known ? Math.max(4, 100 * job.done / job.total) + '%' : '35%';
    $('#adm-prog-steps').replaceChildren(...job.steps.map((s) => el('li', { class: s.open ? 'open' : '' }, [
      el('span', { text: s.text }), el('small', { text: s.open && job.state === 'running' ? 'berjalan… ' + secs(s.seconds) : secs(s.seconds) }),
    ])));
  }

  // Start a job (POST) and follow it to the end. Resolves with its result.
  async function runJob(path, body) {
    setBusy(true);
    try {
      let job = await api('POST', path, body || {});
      activeJob = job.id;
      drawProgress(job);
      while (job.state === 'running') {
        await sleep(400);
        job = await api('GET', '/api/jobs/' + job.id);
        drawProgress(job);
      }
      if (job.state === 'error') throw new Error(job.error);
      setTimeout(() => { if (activeJob === job.id) $('#adm-prog').hidden = true; }, 4000);
      return job.result;
    } finally {
      setBusy(false);
    }
  }

  // If a job is still running (e.g. the page was reloaded mid-pull), follow it.
  async function resumeRunning() {
    try {
      const running = (await api('GET', '/api/jobs')).find((j) => j.state === 'running');
      if (!running) return;
      setBusy(true);
      let job = running;
      while (job.state === 'running') { drawProgress(job); await sleep(400); job = await api('GET', '/api/jobs/' + job.id); }
      drawProgress(job);
      setBusy(false);
      if (job.state === 'done') await dash.reload();
    } catch (e) { setBusy(false); }
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
  // Page-load phases reported by dash-shim.js
  window.addEventListener('eo:phase', (e) => { $('#adm-status').textContent = e.detail; });

  // ------------------------------------------------------------ actions
  async function login() {
    try {
      const r = await runJob('/api/auth/login');
      await dash.reload();
      toast('Terhubung ke Google. ' + Object.keys(r.rows).length + ' dataset ditarik.', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  }

  async function refresh() {
    try {
      const r = await runJob('/api/refresh');
      await dash.reload();
      toast(Object.keys(r.rows).length + ' dataset ditarik dari Google Sheet.', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
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
    $('#adm-form-dlg').close();
    try {
      const r = await runJob('/api/datasets/' + encodeURIComponent(d.id) + '/rows', { values });
      const what = { append: 'Baris baru ditambahkan', update: 'Baris diperbarui', unchanged: 'Tidak ada yang berubah' }[r.action];
      toast(what + ' (baris ' + r.sheet_row + ' di Sheet, ' + r.cells_written + ' sel).', 'ok');
      await dash.reload();
    } catch (err) {
      toast(err.message, 'bad');
      $('#adm-form-dlg').showModal();  // keep what was typed, so it can be fixed
    }
  }

  // ------------------------------------------------------------ updaters
  let preview = {};

  async function openUpdaters() {
    try { preview = await runJob('/api/updaters/preview'); } catch (err) { toast(err.message, 'bad'); return; }
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
    $('#adm-upd-dlg').close();
    try {
      let n = 0;
      for (const [ds, rows] of Object.entries(picked)) { const r = await runJob('/api/updaters/apply', { dataset: ds, rows }); n += r.results.length; }
      toast(n + ' baris ditulis ke Sheet.', 'ok');
      await dash.reload();
    } catch (err) { toast(err.message, 'bad'); }
  }

  // ------------------------------------------------------------ activity log
  async function openActivity() {
    let list = [];
    try { list = await api('GET', '/api/jobs'); } catch (err) { toast(err.message, 'bad'); return; }
    const label = { running: 'berjalan', done: 'selesai', error: 'gagal' };
    $('#adm-act').replaceChildren(...(list.length ? list.map((j) => el('details', { class: 'adm-act-job ' + j.state, open: j === list[0] }, [
      el('summary', {}, [el('b', { text: j.title }), ' · ', el('span', { text: label[j.state] + ' · ' + secs(j.elapsed) })]),
      j.error ? el('p', { class: 'adm-bad', text: j.error }) : null,
      el('ol', { class: 'adm-steps' }, j.steps.map((s) => el('li', {}, [el('span', { text: s.text }), el('small', { text: secs(s.seconds) })]))),
    ])) : [el('p', { class: 'adm-help', text: 'Belum ada aktivitas sejak server dimulai.' })]));
    $('#adm-act-dlg').showModal();
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
    $('#adm-activity').addEventListener('click', openActivity);
    $('#adm-prog-toggle').addEventListener('click', () => {
      const s = $('#adm-prog-steps'); s.hidden = !s.hidden;
      $('#adm-prog-toggle').textContent = s.hidden ? 'Rincian' : 'Sembunyikan';
    });
    $('#adm-prog-close').addEventListener('click', () => { $('#adm-prog').hidden = true; });
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
    resumeRunning();
  });
})();
