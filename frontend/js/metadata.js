/*
 * Metadata page: which datasets are current, which need an update, and why.
 * Everything comes from GET /api/metadata (backend/service.py: metadata()).
 * Values are set with textContent only.
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const STATUS = {
    error:    { label: 'Gagal ditarik',    cls: 'bad',  group: 'act' },
    late:     { label: 'Tertinggal',       cls: 'bad',  group: 'act' },
    due:      { label: 'Perlu diperbarui', cls: 'warn', group: 'act' },
    stale:    { label: 'Lewat batas umur', cls: 'warn', group: 'act' },
    gaps:     { label: 'Ada yang kosong',  cls: 'warn', group: 'act' },
    unknown:  { label: 'Tidak terbaca',    cls: 'muted', group: 'act' },
    ok:       { label: 'Terbaru',          cls: 'ok',   group: 'ok' },
    snapshot: { label: 'Potret',           cls: 'muted', group: 'fixed' },
    static:   { label: 'Tetap',            cls: 'muted', group: 'fixed' },
  };
  const FILTERS = [['all', 'Semua'], ['act', 'Perlu tindakan'], ['ok', 'Terbaru'], ['fixed', 'Potret dan tetap']];
  const FREQ = { monthly: 'bulanan', quarterly: 'kuartalan', irregular: 'tidak terjadwal', snapshot: 'potret', static: 'tetap' };
  let data = null, filter = 'act';

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    (children || []).forEach((c) => c && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }
  const safeUrl = (u) => (/^https?:\/\//.test(u || '') ? u : null);
  const when = (iso) => iso ? new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–';
  const day = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  function toast(msg, kind) {
    const t = $('#adm-toast'); t.textContent = msg; t.className = 'adm-toast show ' + (kind || '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'adm-toast'; }, kind === 'bad' ? 9000 : 4500);
  }

  function tiles() {
    const c = data.counts, n = (...k) => k.reduce((s, x) => s + (c[x] || 0), 0);
    const T = [
      ['Perlu diperbarui', n('due', 'late'), 'warn', 'Periode baru seharusnya sudah rilis'],
      ['Ada yang kosong', data.datasets.filter((d) => d.gaps.length).length, 'warn', 'Dataset dengan periode yang belum diisi'],
      ['Lewat batas umur', n('stale'), 'warn', 'Data tak terjadwal yang sudah lama'],
      ['Gagal ditarik', n('error'), 'bad', 'Memakai salinan lama'],
      ['Terbaru', n('ok'), 'ok', 'Sesuai jadwal rilis'],
      ['Potret dan tetap', n('snapshot', 'static'), 'muted', 'Tidak punya jadwal'],
    ];
    $('#md-tiles').replaceChildren(...T.map(([lab, v, cls, sub]) => el('div', { class: 'md-tile ' + cls }, [
      el('div', { class: 'md-tile-v', text: String(v) }), el('div', { class: 'md-tile-l', text: lab }), el('div', { class: 'md-tile-s', text: sub }),
    ])));
  }

  function filters() {
    $('#md-filters').replaceChildren(...FILTERS.map(([k, lab]) => {
      const cnt = k === 'all' ? data.datasets.length : data.datasets.filter((d) => (STATUS[d.status] || {}).group === k).length;
      return el('button', { type: 'button', class: 'adm-btn md-chip', 'aria-pressed': String(filter === k), onclick: () => { filter = k; render(); } }, [lab + ' (' + cnt + ')']);
    }));
  }

  function lastOutcome(label, o) {
    if (!o) return null;
    return el('div', { class: 'md-small ' + (o.ok ? '' : 'md-badtext') }, [label + ': ' + (o.ok ? 'berhasil' : 'gagal') + ', ' + when(o.at) + (o.message ? ' (' + o.message + ')' : '')]);
  }

  async function pullOne(d, btn) {
    btn.disabled = true;
    try {
      const out = await EOJobs.run('/api/refresh', { ids: [d.id] });
      toast(out.warnings.length ? d.title + ': ' + out.warnings[0] : d.title + ' ditarik ulang.', out.warnings.length ? 'warn' : 'ok');
    } catch (e) { toast(e.message, 'bad'); }
    btn.disabled = false;
    load();
  }

  function row(d) {
    const st = STATUS[d.status] || STATUS.unknown;
    const sheetLink = safeUrl(d.sheet_link);
    const rel = safeUrl(d.release_url);
    const actions = [];
    const reload = () => { toast(d.title + ' disimpan.', 'ok'); load(); };
    if (d.kind === 'sheet' && d.editable) actions.push(el('button', { type: 'button', class: 'adm-btn md-act primary', onclick: () => EOTable.open(d.id, { onSaved: reload }) }, ['Edit tabel']));
    else if (d.kind === 'sheet') actions.push(el('button', { type: 'button', class: 'adm-btn md-act', onclick: () => EOTable.open(d.id) }, ['Lihat']));
    if (d.source === 'sheet') actions.push(el('button', { type: 'button', class: 'adm-btn md-act', onclick: (e) => pullOne(d, e.currentTarget) }, ['Tarik harga']));
    return el('tr', { class: 'md-row st-' + d.status }, [
      el('td', { 'data-h': 'Status' }, [el('span', { class: 'md-badge ' + st.cls, text: st.label })]),
      el('td', { 'data-h': 'Dataset' }, [
        el('b', { text: d.title }),
        el('div', { class: 'md-small' }, [el('code', { text: d.id + (d.kind === 'sheet' ? '.json' : '') }), ' · ', FREQ[d.frequency] || d.frequency, ' · ',
          d.source === 'sheet' ? (sheetLink ? el('a', { href: sheetLink, target: '_blank', rel: 'noopener', text: 'feed: ' + d.range }) : 'feed: ' + d.range)
            : d.kind === 'sheet' ? (sheetLink ? el('a', { href: sheetLink, target: '_blank', rel: 'noopener', text: 'Drive' }) : 'lokal') : 'file']),
      ]),
      el('td', { 'data-h': 'Data terakhir', text: d.latest || '–' }),
      el('td', { 'data-h': 'Seharusnya ada', text: d.expected || (d.stale_after_days ? 'maks. ' + d.stale_after_days + ' hari' : '–') }),
      el('td', { 'data-h': 'Keterangan' }, [
        el('div', { text: d.status_text }),
        d.note ? el('div', { class: 'md-small', text: d.note }) : null,
        d.next_release && d.status === 'ok' ? el('div', { class: 'md-small', text: 'Rilis berikutnya sekitar ' + day(d.next_release) }) : null,
      ]),
      el('td', { 'data-h': 'Diperbarui' }, [
        el('div', { text: d.changed_at ? 'Isi berubah ' + when(d.changed_at) : '–' }),
        el('div', { class: 'md-small', text: d.fetched_at ? 'Disimpan ' + when(d.fetched_at) : '' }),
      ]),
      el('td', { 'data-h': 'Sumber rilis' }, [
        el('div', { text: d.release || '–' }),
        rel ? el('a', { class: 'md-small', href: rel, target: '_blank', rel: 'noopener', text: 'halaman rilis ↗' }) : null,
        d.updater ? el('div', { class: 'md-small', text: 'Cek otomatis: ' + d.updater.toUpperCase() }) : null,
        lastOutcome('Cek terakhir', d.last_check),
      ]),
      el('td', { class: 'md-actions' }, actions),
    ]);
  }

  // Where the data lives, and whether this computer and Drive agree.
  function storeBar() {
    const s = data.store || {}, url = safeUrl(s.folder_url), n = (s.dirty || []).length;
    const state = !s.synced_at ? ['warn', 'Belum pernah sinkron dengan Drive'] : n ? ['warn', n + ' file belum diunggah ke Drive'] : ['ok', 'Sama dengan Drive'];
    $('#md-store').replaceChildren(
      el('div', { class: 'md-store-main' }, [
        el('span', { class: 'md-badge ' + state[0], text: state[1] }),
        el('span', { text: ' ' + s.files + ' file JSON' + (s.synced_at ? ' · sinkron terakhir ' + when(s.synced_at) : '') }),
        url ? el('a', { href: url, target: '_blank', rel: 'noopener', class: 'md-small', text: ' · buka folder Drive ↗' }) : null,
      ]),
      el('button', { type: 'button', class: 'adm-btn', id: 'md-sync', onclick: syncNow }, ['Sinkron sekarang']),
    );
    if (url) $('#md-sheet').href = url;
  }

  async function syncNow(e) {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const out = await EOJobs.run('/api/sync');
      const r = out.result || {}, up = ((r.push || {}).uploaded || []).length, down = ((r.pull || {}).downloaded || []).length;
      toast('Sinkron selesai: ' + down + ' diunduh, ' + up + ' diunggah.', out.warnings.length ? 'warn' : 'ok');
    } catch (err) { toast(err.message, 'bad'); }
    btn.disabled = false;
    load();
  }

  function render() {
    storeBar();
    tiles();
    filters();
    const list = data.datasets.filter((d) => filter === 'all' || (STATUS[d.status] || {}).group === filter);
    $('#md-body').replaceChildren(...(list.length ? list.map(row) : [el('tr', {}, [el('td', { colspan: '8', class: 'md-empty', text: 'Tidak ada dataset di kelompok ini.' })])]));
  }

  async function load() {
    try {
      data = await EOJobs.api('GET', '/api/metadata');
      $('#md-asof').textContent = 'Dihitung per ' + day(data.today) + ' dari salinan lokal';

      render();
    } catch (e) {
      $('#md-body').replaceChildren(el('tr', {}, [el('td', { colspan: '8', class: 'md-empty', text: 'Gagal memuat: ' + e.message })]));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    EOJobs.onBusy((on) => { $('#md-refresh').disabled = on; });
    $('#md-refresh').addEventListener('click', async () => {
      try {
        const out = await EOJobs.run('/api/refresh');
        toast(Object.keys(out.result.rows || {}).length + ' feed harga ditarik, data disinkron dengan Drive' + (out.warnings.length ? '; ' + out.warnings.length + ' catatan.' : '.'), out.warnings.length ? 'warn' : 'ok');
      } catch (e) { toast(e.message, 'bad'); }
      load();
    });
    load();
    EOJobs.resume(load);
  });
})();
