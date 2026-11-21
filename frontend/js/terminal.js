/*
 * Terminal shell: theme, market monitor, decision signals, function rail,
 * command bar. Reads only what the dashboard already computes (dash.data),
 * so the shell and the panels can never disagree.
 *
 * Colour rule (the decision-support twist on a market terminal): green/red
 * mean GOOD/BAD FOR INDONESIAN EQUITIES, not up/down. A weaker Rupiah
 * (USD/IDR up) is red; a lower BI Rate is green. The arrow still shows the
 * raw direction, so both readings are visible.
 */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const nf = (v, d) => Number(v).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sgn = (v, d) => (v > 0 ? '+' : v < 0 ? '−' : '±') + nf(Math.abs(v), d);

  // ------------------------------------------------------------------ theme
  const themeBtn = $('#t-theme');
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('eo-theme', t); } catch (e) { /* private mode */ }
    if (themeBtn) { themeBtn.textContent = t === 'light' ? '☾' : '☀'; themeBtn.title = t === 'light' ? 'Tema gelap' : 'Tema terang'; }
  }
  if (themeBtn) {
    setTheme(document.documentElement.dataset.theme || 'dark');
    themeBtn.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
  }

  if (!window.dash) return; // pages without data (e.g. metadata) only get the theme

  // ------------------------------------------------------------------ sections
  // [code, label, element finder]. Folded groups are reached through their bar.
  const bar = (sel) => () => { const s = $(sel); return s && s.previousElementSibling && s.previousElementSibling.classList.contains('eo-fold-bar') ? s.previousElementSibling : s; };
  const SECTIONS = [
    ['AI', 'Insight Claude', () => $('#eo-claude')],
    ['BRF', 'Ringkasan narasi', bar('section.eo-note')],
    ['MAP', 'Peta koneksi', () => $('#eo-map')],
    ['WRLD', 'Ekonomi global', () => $('#eo-global')],
    ['US', 'Ekonomi AS', () => $('#eo-us')],
    ['IDN', 'Ekonomi Indonesia', () => $('#eo-regime')],
    ['BI', 'Syarat BI turunkan bunga', () => $('#eo-checklist')],
    ['IND', 'Indikator utama', bar('section.eo-kpis:not(.eo-derived)')],
    ['CHRT', 'Grafik indikator', bar('section.eo-charts')],
    ['DRV', 'Indikator turunan', bar('section.eo-kpis.eo-derived')],
    ['CRED', 'Kredit per provinsi', () => $('#eo-kredit')],
    ['MKT', 'Pasar saham', () => $('#eo-market')],
    ['SECT', 'Komposisi IHSG', () => $('#eo-sektor')],
    ['MINE', 'Saham tambang', () => $('#eo-tambang')],
    ['RATE', 'Uang & valuasi', () => $('#eo-uang')],
    ['Q&A', 'Pertanyaan sebelum membeli', () => $('#eo-tanya')],
  ];

  // Indicator words people actually type -> the section where they live.
  const KEYWORDS = {
    WRLD: 'pmi global jp morgan dunia', US: 'fed ism amerika as treasury ust pdb as', IDN: 'pdb gdp ikk keyakinan konsumen ritel rupiah kurs idr regime',
    BI: 'bi rate suku bunga pemotongan', IND: 'indikator kpi', CHRT: 'pmi inflasi cpi grafik chart', DRV: 'riil spread turunan',
    CRED: 'kredit provinsi sekda daerah', MKT: 'ihsg bank bbca bbri bmri bbni idxfinance asing flow', SECT: 'sektor bobot kapitalisasi',
    MINE: 'tambang batu bara coal nikel nickel cpo komoditas adro ptba antm inco', RATE: 'sbn yield obligasi valuasi per pbv srbi ksei',
    MAP: 'peta map asia global perdagangan ekspor', AI: 'insight claude ringkasan ai', 'Q&A': 'pertanyaan syarat beli',
  };
  // Single-stock pages (stock.html?tk=CODE). Add a code here when a new
  // js/stock/<CODE>.js exists, so the rail, command bar and monitor link to it.
  const STOCKS = [['BMRI', 'Bank Mandiri']];
  const stockUrl = (code) => 'stock.html?tk=' + code;

  function go(find) {
    const t = typeof find === 'string' ? $('#' + find) : find();
    if (!t) return;
    const top = t.getBoundingClientRect().top + window.scrollY - ($('.t-top') ? $('.t-top').offsetHeight : 0) - 10;
    window.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  // rail
  const nav = $('#t-nav');
  const navLinks = [];
  if (nav) {
    nav.append(el('div', 't-nav-h', 'Fungsi'));
    SECTIONS.forEach(([code, label, find]) => {
      const a = el('a', 't-nav-a');
      a.href = '#';
      a.append(el('span', 't-code', code), el('span', 't-nav-l', label));
      a.addEventListener('click', (e) => { e.preventDefault(); go(find); });
      nav.append(a);
      navLinks.push([a, find]);
    });
    nav.append(el('div', 't-nav-h t-nav-h2', 'Saham'));
    STOCKS.forEach(([code, label]) => {
      const a = el('a', 't-nav-a');
      a.href = stockUrl(code); a.title = 'Halaman saham ' + code + ': profil, valuasi, arus asing, dividen';
      a.append(el('span', 't-code', code), el('span', 't-nav-l', label + ' ↗'));
      nav.append(a);
    });
    nav.append(el('div', 't-nav-foot', '/ atau ⌘K untuk lompat'));
  }

  // scroll-spy: highlight the section nearest the top
  function spy() {
    const off = ($('.t-top') ? $('.t-top').offsetHeight : 0) + 40;
    let cur = null, curTop = null;
    navLinks.forEach(([a, find]) => {
      const t = find(); if (!t) return;
      const top = Math.round(t.getBoundingClientRect().top);
      // side-by-side panels share a top edge: keep the first (left) one
      if (top - off <= 0 && top !== curTop) { cur = a; curTop = top; }
    });
    navLinks.forEach(([a]) => a.classList.toggle('on', a === cur));
  }
  let spyT; window.addEventListener('scroll', () => { cancelAnimationFrame(spyT); spyT = requestAnimationFrame(spy); }, { passive: true });

  // command bar
  const cmd = $('#t-cmd');
  if (cmd) {
    $('#t-cmd-list').replaceChildren(...SECTIONS.concat(STOCKS.map(([c, l]) => [c, 'Saham ' + l])).map(([c, l]) => { const o = el('option'); o.value = c; o.label = l; return o; }));
    cmd.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { cmd.value = ''; cmd.blur(); return; }
      if (e.key !== 'Enter') return;
      const q = cmd.value.trim().toLowerCase();
      const stock = STOCKS.find(([c]) => c.toLowerCase() === q);
      if (stock) { location.href = stockUrl(stock[0]); return; }
      const hit = SECTIONS.find(([c]) => c.toLowerCase() === q)
        || SECTIONS.find(([c, l]) => c.toLowerCase().startsWith(q) || l.toLowerCase().includes(q))
        || SECTIONS.find(([c]) => (KEYWORDS[c] || '').split(' ').some((w) => w.startsWith(q) || q.split(' ').includes(w)));
      if (hit) { go(hit[2]); cmd.value = ''; cmd.blur(); } else { cmd.classList.add('t-miss'); setTimeout(() => cmd.classList.remove('t-miss'), 600); }
    });
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); cmd.focus(); cmd.select(); }
    });
  }

  // ------------------------------------------------------------------ monitor
  // good: +1 = rising is good for Indonesian equities, -1 = rising is bad
  const MON = [
    { code: 'IHSG', name: 'IHSG', ds: 'saham', f: 'ihsg', d: 0, chg: 'pct', good: 1, go: 'eo-market' },
    { code: 'FIN', name: 'IDX Finance', ds: 'saham', f: 'fin', d: 0, chg: 'pct', good: 1, go: 'eo-market' },
    { code: 'BMRI', name: 'Bank Mandiri', ds: 'saham', f: 'bmri', d: 0, chg: 'pct', good: 1, href: stockUrl('BMRI') },
    { code: 'SPX', name: 'S&P 500', ds: 'sahamglobal', f: 'spx', d: 0, chg: 'pct', good: 1, go: 'eo-map' },
    { code: 'IDR', name: 'USD/IDR', ds: 'rupiah', f: 'usd_idr', d: 0, chg: 'pct', good: -1, go: 'eo-regime' },
    { code: 'BI', name: 'BI Rate', ds: 'birate', f: 'bi_rate', d: 2, unit: '%', chg: 'bp', good: -1, go: 'eo-checklist' },
    { code: 'FED', name: 'Fed Funds', ds: 'fed', f: 'fed_upper', d: 2, unit: '%', chg: 'bp', good: -1, go: 'eo-us' },
    { code: 'SPRD', name: 'BI − Fed', ds: 'ratespread', f: 'spread', d: 2, unit: ' pt', chg: 'bp', good: 1, go: 'eo-us' },
    { code: 'CPI', name: 'Inflasi YoY', ds: 'inflation', f: 'inflation_yoy', d: 2, unit: '%', chg: 'pt', good: -1, go: 'eo-regime' },
    { code: 'PMI', name: 'PMI Indonesia', ds: 'pmi', f: 'pmi', d: 1, chg: 'pt', good: 1, go: 'eo-regime' },
    { code: 'SBN', name: 'SBN 10 th', ds: 'sbn', f: 'sbn', per: 'date', d: 2, unit: '%', chg: 'bp', good: -1, go: 'eo-uang' },
    { code: 'FLOW', name: 'Asing saham', ds: 'flow', f: 'flow_idr_t', d: 1, unit: ' T', chg: 'flow', good: 1, go: 'eo-market' },
    { code: 'COAL', name: 'Batu bara', ds: 'komoditas', f: 'coal', d: 0, chg: 'pct', good: 1, go: 'eo-tambang' },
    { code: 'NI', name: 'Nikel', ds: 'komoditas', f: 'nickel', d: 0, chg: 'pct', good: 1, go: 'eo-tambang' },
  ];

  function spark(vals, kind, tone) {
    const W = 84, H = 22, ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 't-spark'); svg.setAttribute('aria-hidden', 'true');
    const v = vals.filter((x) => x != null);
    if (v.length < 2) return svg;
    if (kind === 'flow') {
      const m = Math.max(...v.map(Math.abs)) || 1, bw = W / vals.length;
      vals.forEach((x, i) => {
        if (x == null) return;
        const h = Math.max(1, (Math.abs(x) / m) * (H / 2 - 1)), r = document.createElementNS(ns, 'rect');
        r.setAttribute('x', i * bw + 1); r.setAttribute('width', Math.max(1, bw - 2));
        r.setAttribute('y', x >= 0 ? H / 2 - h : H / 2); r.setAttribute('height', h);
        r.setAttribute('class', x >= 0 ? 't-up' : 't-dn');
        svg.append(r);
      });
      return svg;
    }
    const lo = Math.min(...v), hi = Math.max(...v), sx = W / (vals.length - 1), sy = (x) => H - 2 - ((x - lo) / ((hi - lo) || 1)) * (H - 4);
    let d = '', last = null;
    vals.forEach((x, i) => { if (x == null) return; d += (d ? 'L' : 'M') + (i * sx).toFixed(1) + ',' + sy(x).toFixed(1); last = [i * sx, sy(x)]; });
    const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('class', 't-spark-line'); svg.append(p);
    const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', last[0]); c.setAttribute('cy', last[1]); c.setAttribute('r', 2.2); c.setAttribute('class', 't-' + tone); svg.append(c);
    return svg;
  }

  function monitor() {
    const box = $('#t-monitor'); if (!box) return;
    const tiles = [];
    MON.forEach((m) => {
      const d = dash.data(m.ds);
      if (d.status !== 'ok' || !Array.isArray(d.data)) return;
      const rows = d.data.filter((r) => r[m.f] != null && !isNaN(r[m.f]));
      if (!rows.length) return;
      const last = rows[rows.length - 1], prev = rows[rows.length - 2], v = last[m.f];
      let chg = '', raw = 0;
      if (m.chg === 'flow') { raw = v; chg = 'bulan ini'; }
      else if (prev) {
        const p = prev[m.f];
        if (m.chg === 'pct') { raw = (v / p - 1) * 100; chg = sgn(raw, 1) + '%'; }
        else if (m.chg === 'bp') { raw = (v - p) * 100; chg = sgn(Math.round(raw), 0) + ' bp'; }
        else { raw = v - p; chg = sgn(raw, m.d); }
      }
      const tone = Math.abs(raw) < 1e-9 ? 'flat' : raw * m.good > 0 ? 'up' : 'dn';
      const arrow = m.chg === 'flow' ? '' : raw > 0 ? '▲ ' : raw < 0 ? '▼ ' : '■ ';
      const t = el('button', 't-tile t-' + tone);
      t.type = 'button';
      t.title = `${m.name}: ${last[m.per || 'month']} · ${m.href ? 'klik untuk membuka halaman sahamnya' : 'klik untuk ke bagiannya'}. Warna: hijau = baik untuk saham Indonesia, merah = buruk.`;
      const per = String(last[m.per || 'month']).replace(' (turunan)', '').replace(/ 20(\d\d)$/, " '$1");
      const head = el('div', 't-tile-h'); head.append(el('span', 't-code', m.code), el('span', 't-tile-n', m.name), el('span', 't-per', per));
      const val = el('div', 't-tile-v', (m.chg === 'flow' ? sgn(v, m.d) : nf(v, m.d)) + (m.unit || ''));
      t.append(head, val, spark(rows.slice(-12).map((r) => r[m.f]), m.chg === 'flow' ? 'flow' : 'line', tone), el('div', 't-chg', arrow + chg));
      t.addEventListener('click', () => { if (m.href) location.href = m.href; else go(m.go); });
      tiles.push(t);
    });
    if (tiles.length) box.replaceChildren(...tiles);
    else box.replaceChildren(el('div', 't-empty', 'Memuat monitor…'));
  }

  // ------------------------------------------------------------------ signals
  const ICON = { ok: '✓', warn: '!', bad: '✕' };
  function signals() {
    const box = $('#t-signals'); if (!box) return;
    const pick = (id, key) => { const d = dash.data(id); return d.status === 'ok' && Array.isArray(d.data) ? d.data.find((r) => r.id === key) : null; };
    const regime = dash.data('regime');
    const counts = regime.status === 'ok' ? regime.data.filter((r) => r.kind === 'regime').reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {}) : {};
    const q = $('#eo-q1-read');
    const S = [
      ['WRLD', 'Dunia', pick('global', 'gl_verdict'), 'eo-global'],
      ['US', 'Amerika Serikat', pick('us', 'us_verdict'), 'eo-us'],
      ['IDN', 'Indonesia', (() => { const v = pick('regime', 'verdict'); return v && Object.assign({}, v, { detail: (counts.ok || 0) + ' baik · ' + (counts.warn || 0) + ' waspada · ' + (counts.bad || 0) + ' tertekan' }); })(), 'eo-regime'],
      ['BI', 'Ruang BI turunkan bunga', (() => { const v = pick('regime', 'c_sum'); return v && { status: v.status, statusText: v.statusText, detail: 'syarat penurunan BI Rate' }; })(), 'eo-checklist'],
      ['MKT', 'Pasar saham', pick('market', 'mk_verdict'), 'eo-market'],
      ['MINE', 'Saham tambang', pick('tambang_s', 'tb_verdict'), 'eo-tambang'],
      ['Q&A', 'Kesiapan membeli', (() => {
        // same thresholds as the questions panel (03-questions.js): ≤40% red, <80% amber
        const m = q && q.textContent.match(/(\d+) dari (\d+)/); if (!m) return null;
        const r = +m[1] / +m[2];
        return { status: r <= 0.4 ? 'bad' : r < 0.8 ? 'warn' : 'ok', statusText: m[0] + ' syarat', detail: (q.textContent.split(':')[1] || '').trim() };
      })(), 'eo-tanya'],
    ];
    const cards = S.filter((s) => s[2]).map(([code, name, v, target]) => {
      const c = el('button', 't-sig t-sig-' + v.status); c.type = 'button';
      const h = el('div', 't-sig-h'); h.append(el('span', 't-code', code), el('span', 't-sig-n', name));
      const st = el('div', 't-sig-s'); st.append(el('span', 't-sig-i', ICON[v.status] || '·'), el('span', null, v.statusText));
      c.append(h, st, el('div', 't-sig-d', v.detail || ''));
      c.addEventListener('click', () => go(target));
      return c;
    });
    const head = el('div', 't-sig-title');
    head.append(el('span', null, 'Sinyal keputusan'), el('span', 't-sig-note', 'dari aturan tiap bagian · bukan rekomendasi'));
    box.replaceChildren(head, el('div', 't-sig-grid'));
    $('.t-sig-grid', box).append(...cards);
  }

  // Deep links from the stock page (index.html#eo-market): scroll there once the
  // panels have been drawn, since their height is unknown before that.
  let hashDone = false;
  function jumpToHash() {
    if (hashDone || !location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const code = SECTIONS.find(([c]) => c.toLowerCase() === id.toLowerCase());
    const find = code ? code[2] : () => document.getElementById(id);
    if (!find()) return;
    hashDone = true;
    setTimeout(() => go(find), 50);
  }
  window.addEventListener('hashchange', () => { hashDone = false; jumpToHash(); });
  function render() { try { monitor(); signals(); spy(); } catch (e) { console.warn('terminal', e && e.message); } }
  window.addEventListener('eo:data', jumpToHash);
  dash.onData(render);
})();
