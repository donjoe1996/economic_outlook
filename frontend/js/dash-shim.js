/*
 * dash — the small data API the dashboard scripts are written against.
 *
 * The prototype ran inside a hosted dashboard that provided `dash`. This file
 * re-creates the part it used, on top of the local backend:
 *
 *   dash.loader(id, {fn})          raw answer -> rows       (js/data/loaders.js)
 *   dash.calc(id, {inputs, fn})    rows of other datasets -> derived value
 *   dash.data(id)                  -> {status, data, message, ...}
 *   dash.onData(fn)                run fn now and whenever data or width changes
 *   dash.reload()                  fetch /api/data again and redraw
 *
 * status is 'loading' until /api/data answers, then 'ok', 'missing' or 'error'.
 * Drawing code only ever sees clean rows; it never knows about Google Sheets.
 */
(function () {
  const loaders = {};
  const calcs = {};
  const listeners = [];
  let sources = null;      // id -> item from /api/data, null while loading
  let loadError = null;
  let memo = {};
  window.EO_META = {};     // sheet_url, google status — for admin.js

  function res(status, data, message, extra) {
    return Object.assign({ status, data, message: message || null, refreshing: false, truncated: false, meta: null, columns: [] }, extra || {});
  }

  function rowsOf(answer) {
    if (Array.isArray(answer)) return answer;
    if (answer && typeof answer === 'object') {
      for (const k of ['rows', 'data', 'results']) if (Array.isArray(answer[k])) return answer[k];
    }
    return answer;
  }

  function columnsOf(data) {
    return Array.isArray(data) && data[0] && typeof data[0] === 'object' ? Object.keys(data[0]) : [];
  }

  function computeSource(id) {
    if (loadError) return res('error', [], loadError);
    if (!sources) return res('loading', []);
    const s = sources[id];
    if (!s) return res('missing', [], 'Dataset "' + id + '" tidak ada di config/datasets.yaml');
    if (s.status !== 'ok') return res(s.status, [], s.message);
    try {
      const data = loaders[id] ? loaders[id].fn({ answer: s.answer }) : rowsOf(s.answer);
      return res('ok', data, null, { columns: columnsOf(data), meta: { fetched_at: s.fetched_at, source: s.source } });
    } catch (e) {
      console.error('loader ' + id, e);
      return res('error', [], 'Loader gagal: ' + (e && e.message));
    }
  }

  function computeCalc(id, stack) {
    const c = calcs[id];
    const args = [];
    for (const input of c.inputs || []) {
      const r = get(input, stack);
      if (r.status !== 'ok') return res(r.status, null, r.message);
      args.push(r.data);
    }
    try {
      const data = c.fn.apply(null, args);
      return res('ok', data, null, { columns: columnsOf(data) });
    } catch (e) {
      console.error('calc ' + id, e);
      return res('error', null, 'Perhitungan gagal: ' + (e && e.message));
    }
  }

  function get(id, stack) {
    if (memo[id]) return memo[id];
    stack = stack || [];
    if (stack.includes(id)) return res('error', null, 'Lingkaran calc: ' + stack.concat(id).join(' → '));
    const r = calcs[id] ? computeCalc(id, stack.concat(id)) : computeSource(id);
    memo[id] = r;
    return r;
  }

  function notify() {
    memo = {};
    listeners.slice().forEach((fn) => { try { fn(); } catch (e) { console.error('onData', e); } });
  }

  function load() {
    return fetch('/api/data', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((j) => { sources = j.datasets; loadError = null; window.EO_META = { sheet_url: j.sheet_url, google: j.google, datasets: j.datasets }; })
      .catch((e) => { loadError = 'Server tidak bisa dihubungi (' + e.message + ')'; })
      .then(() => { notify(); window.dispatchEvent(new CustomEvent('eo:data')); });
  }

  const dash = {
    loader(id, def) { loaders[id] = def; memo = {}; },
    calc(id, def) { calcs[id] = def; memo = {}; },
    data(id) { return get(id); },
    onData(fn) { listeners.push(fn); try { fn(); } catch (e) { console.error('onData', e); } },
    reload: load,
    refresh: load,
    // Present in the hosted API; the prototype does not use filters or links.
    params() { return {}; },
    setParams() {},
    resetParams() {},
    setLink() {},
    colors: ['#2a78d6', '#1baf7a', '#eda100', '#e34948', '#8a5cd6', '#0f9aa8'],
  };
  window.dash = dash;

  // Redraw when the width changes (charts size themselves from clientWidth).
  let lastW = window.innerWidth, t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; notify(); } }, 150);
  });

  // Load once every script has registered its loaders, calcs and listeners.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
