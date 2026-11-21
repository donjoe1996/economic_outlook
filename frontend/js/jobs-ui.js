/*
 * Shared by every page: run a server job and show its progress.
 *
 *   const result = await EOJobs.run('/api/refresh');   // throws on failure
 *
 * A job ends in one of three states:
 *   done     everything worked                      (green bar)
 *   partial  finished, but some parts were skipped  (amber bar + warning list)
 *   error    stopped                                (red bar + message)
 * The panel is inserted at the end of the element with class "adm-top".
 */
(function () {
  const PANEL = `
<div class="adm-prog" id="adm-prog" hidden role="status" aria-live="polite">
  <div class="adm-prog-head">
    <b id="adm-prog-title"></b>
    <span class="adm-prog-meta" id="adm-prog-meta"></span>
    <button type="button" class="adm-link" id="adm-prog-toggle">Rincian</button>
    <button type="button" class="adm-link" id="adm-prog-close" aria-label="Tutup">✕</button>
  </div>
  <div class="adm-prog-track"><div class="adm-prog-bar" id="adm-prog-bar"></div></div>
  <div class="adm-prog-now" id="adm-prog-now"></div>
  <ul class="adm-warn" id="adm-prog-warn" hidden></ul>
  <ol class="adm-steps" id="adm-prog-steps" hidden></ol>
</div>`;
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const secs = (s) => (s < 60 ? s.toFixed(1) + ' dtk' : Math.floor(s / 60) + ' mnt ' + Math.round(s % 60) + ' dtk');
  let active = null;
  const busyListeners = [];

  function li(text, small, cls) {
    const n = document.createElement('li');
    if (cls) n.className = cls;
    const a = document.createElement('span'); a.textContent = text; n.appendChild(a);
    if (small) { const b = document.createElement('small'); b.textContent = small; n.appendChild(b); }
    return n;
  }

  function draw(job) {
    const box = $('#adm-prog');
    box.hidden = false;
    box.className = 'adm-prog ' + job.state;
    $('#adm-prog-title').textContent = job.title;
    $('#adm-prog-now').textContent = job.state === 'error' ? job.error : job.current;
    $('#adm-prog-meta').textContent = (job.total ? job.done + '/' + job.total + ' · ' : '') + secs(job.elapsed);
    const bar = $('#adm-prog-bar');
    bar.classList.toggle('indeterminate', job.state === 'running' && !job.total);
    bar.style.width = job.state !== 'running' ? '100%' : job.total ? Math.max(4, 100 * job.done / job.total) + '%' : '35%';
    const warn = $('#adm-prog-warn');
    warn.hidden = !job.warnings.length;
    warn.replaceChildren(...job.warnings.map((w) => li(w)));
    $('#adm-prog-steps').replaceChildren(...job.steps.map((s) => li(s.text, s.open && job.state === 'running' ? 'berjalan… ' + secs(s.seconds) : secs(s.seconds), s.open ? 'open' : '')));
  }

  async function api(method, path, body) {
    const r = await fetch(path, { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || ('HTTP ' + r.status));
    return j;
  }

  function setBusy(on) { busyListeners.forEach((f) => f(on)); }

  async function follow(job) {
    active = job.id;
    draw(job);
    while (job.state === 'running') {
      await sleep(400);
      job = await api('GET', '/api/jobs/' + job.id);
      draw(job);
    }
    // keep a partial/error result on screen; a clean success fades away
    if (job.state === 'done') setTimeout(() => { if (active === job.id) $('#adm-prog').hidden = true; }, 4000);
    return job;
  }

  // Start a job and follow it. Resolves with {result, warnings}; throws on error.
  async function run(path, body) {
    setBusy(true);
    try {
      const job = await follow(await api('POST', path, body || {}));
      if (job.state === 'error') throw new Error(job.error);
      return { result: job.result, warnings: job.warnings, state: job.state };
    } finally { setBusy(false); }
  }

  // After a reload, pick up a job that is still running.
  async function resume(onDone) {
    try {
      const running = (await api('GET', '/api/jobs')).find((j) => j.state === 'running');
      if (!running) return;
      setBusy(true);
      const job = await follow(running);
      if (job.state !== 'error' && onDone) await onDone(job);
    } catch (e) { /* server restarted: nothing to resume */ } finally { setBusy(false); }
  }

  function mount() {
    const top = $('.adm-top');
    if (!top || $('#adm-prog')) return;
    top.insertAdjacentHTML('beforeend', PANEL);
    $('#adm-prog-toggle').addEventListener('click', () => {
      const s = $('#adm-prog-steps'); s.hidden = !s.hidden;
      $('#adm-prog-toggle').textContent = s.hidden ? 'Rincian' : 'Sembunyikan';
    });
    $('#adm-prog-close').addEventListener('click', () => { $('#adm-prog').hidden = true; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

  window.EOJobs = { run, resume, api, secs, onBusy: (f) => busyListeners.push(f) };
})();
