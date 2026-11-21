/*
 * "Tanya Claude" chat, under the insight panel (POST /api/chat).
 * The backend picks the data the question is about (backend/chat_context.py),
 * Claude Code answers in one turn without tools, and every number in the
 * answer is checked against that data: numbers it can't find are listed
 * under the answer. The last three exchanges go along, so follow-ups work.
 *
 * The conversation is kept in sessionStorage (this tab only). Answers are
 * escaped first and then given a little Markdown (bold, code, lists,
 * headings), so nothing in an answer can inject HTML.
 */
(function () {
  const KEY = 'eo-chat-v2';
  // The model switch: Haiku answers fast and cheap; Sonnet and Opus reason more carefully, slower.
  const MODELS = [
    ['haiku', 'Haiku', 'Cepat dan paling hemat (±10–15 dtk). Cukup untuk sebagian besar pertanyaan.'],
    ['sonnet', 'Sonnet', 'Lebih teliti merangkai beberapa data; sedikit lebih lambat.'],
    ['opus', 'Opus', 'Paling teliti untuk pertanyaan yang rumit; paling lambat dan paling banyak memakai kuota.'],
  ];
  const MKEY = 'eo-chat-model';
  let model = 'haiku';
  try { model = localStorage.getItem(MKEY) || 'haiku'; } catch (e) { /* private mode */ }
  if (!MODELS.some((m) => m[0] === model)) model = 'haiku';
  const SUGGEST = [
    'Kenapa IHSG tertinggal dari bursa Asia tahun ini?',
    'Apa arti kenaikan BI Rate untuk saham bank?',
    'Data mana yang paling mendesak diperbarui, dan kenapa penting?',
  ];
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  let state = { msgs: [] };
  try { state = JSON.parse(sessionStorage.getItem(KEY)) || state; } catch (e) { /* private mode */ }
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } };

  // --- tiny, safe Markdown: escape everything, then add a few tags -------------
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function inline(t) {
    return esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  }
  function md(text) {
    const out = []; let list = null;
    const close = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    String(text || '').split('\n').forEach((line) => {
      const t = line.trim();
      let m;
      if (!t) { close(); return; }
      if ((m = t.match(/^#{1,4}\s+(.*)$/))) { close(); out.push('<h4>' + inline(m[1]) + '</h4>'); return; }
      if ((m = t.match(/^[-*•]\s+(.*)$/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); return; }
      if ((m = t.match(/^\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); return; }
      close(); out.push('<p>' + inline(t) + '</p>');
    });
    close();
    return out.join('');
  }

  // --- view --------------------------------------------------------------------
  function bubble(m) {
    const b = el('div', 'eo-chat-msg ' + (m.role === 'user' ? 'me' : m.error ? 'err' : 'ai'));
    if (m.role === 'user') { b.textContent = m.text; return b; }
    b.innerHTML = md(m.text);   // safe: md() escapes before adding tags
    if (m.used && m.used.length) {
      const label = (MODELS.find((x) => x[0] === m.model) || [])[1];
      b.append(el('div', 'eo-chat-used', (label ? 'Claude ' + label + ' · ' : '') + 'Data: ' + m.used.join(' · ')));
    }
    if (m.unverified && m.unverified.length) {
      b.append(el('div', 'eo-chat-warn', '⚠ Angka tidak ditemukan di data yang dikirim: ' + m.unverified.join(', ') + '. Cek sebelum dipakai.'));
    }
    return b;
  }
  // the last three question/answer pairs, for follow-up questions
  function history() {
    const out = [];
    for (let i = 0; i + 1 < state.msgs.length; i++) {
      const u = state.msgs[i], a = state.msgs[i + 1];
      if (u.role === 'user' && a.role === 'ai' && !a.error) out.push({ q: u.text, a: a.text });
    }
    return out.slice(-3);
  }

  function render(busyText) {
    const box = document.getElementById('eo-chat-body'); if (!box) return;
    const log = $('#eo-chat-log', box);
    log.replaceChildren(...state.msgs.map(bubble));
    if (!state.msgs.length) {
      const intro = el('div', 'eo-chat-empty');
      intro.append(el('p', null, 'Tanya apa saja tentang data di dashboard ini. Aplikasi memilih data yang relevan, Claude menjawab dari data itu saja, lalu setiap angkanya dicek.'));
      const chips = el('div', 'eo-chat-chips');
      SUGGEST.forEach((q) => { const c = el('button', 'eo-chat-chip', q); c.type = 'button'; c.addEventListener('click', () => ask(q)); chips.append(c); });
      intro.append(chips);
      log.append(intro);
    }
    if (busyText) log.append(el('div', 'eo-chat-msg ai busy', busyText));
    $('#eo-chat-new', box).hidden = !state.msgs.length;
    log.scrollTop = log.scrollHeight;
  }

  let busy = false;
  async function ask(q) {
    q = (q || '').trim();
    if (!q || busy) return;
    busy = true;
    const input = $('#eo-chat-input'), send = $('#eo-chat-send');
    input.value = ''; autosize(input); send.disabled = true;
    const hist = history();
    state.msgs.push({ role: 'user', text: q }); save();
    render('Claude sedang menjawab…');
    try {
      const out = await EOJobs.run('/api/chat', { question: q, history: hist, model });
      const r = out.result || {};
      state.msgs.push({ role: 'ai', text: r.answer || '(tanpa jawaban)', used: r.used || [], unverified: r.unverified || [], model: r.model });
    } catch (e) {
      state.msgs.push({ role: 'ai', error: true, text: e.message });
    }
    save(); busy = false; send.disabled = false; render(); input.focus();
  }

  function autosize(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 180) + 'px'; }

  function mount() {
    const box = document.getElementById('eo-chat-body'); if (!box) return;
    const form = el('form', 'eo-chat-form');
    const input = el('textarea', 'eo-chat-input'); input.id = 'eo-chat-input'; input.rows = 1;
    input.placeholder = 'Tanya Claude tentang data ini…';
    input.title = 'Enter untuk kirim, Shift+Enter untuk baris baru';
    input.setAttribute('aria-label', 'Pertanyaan untuk Claude');
    const send = el('button', 'eo-chat-send', '↑'); send.id = 'eo-chat-send'; send.type = 'submit'; send.title = 'Kirim'; send.setAttribute('aria-label', 'Kirim');
    form.append(input, send);
    form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); } });
    input.addEventListener('input', () => autosize(input));
    const head = el('div', 'eo-chat-head');
    head.append(el('span', 'eo-chat-note', 'Claude Code di komputer ini · menjawab hanya dari data dashboard · bacaan data, bukan rekomendasi investasi'));
    const fresh = el('button', 'adm-btn eo-chat-newbtn', 'Percakapan baru'); fresh.id = 'eo-chat-new'; fresh.type = 'button';
    fresh.addEventListener('click', () => { state = { msgs: [] }; save(); render(); input.focus(); });
    // model switch (a segmented control, remembered in this browser)
    const sw = el('div', 'eo-chat-models'); sw.setAttribute('role', 'radiogroup'); sw.setAttribute('aria-label', 'Model Claude');
    MODELS.forEach(([id, label, hint]) => {
      const bt = el('button', 'eo-chat-model', label); bt.type = 'button'; bt.title = hint;
      bt.setAttribute('role', 'radio'); bt.setAttribute('aria-checked', String(id === model));
      bt.addEventListener('click', () => {
        model = id;
        try { localStorage.setItem(MKEY, id); } catch (e) { /* ignore */ }
        sw.querySelectorAll('.eo-chat-model').forEach((x) => x.setAttribute('aria-checked', String(x === bt)));
      });
      sw.append(bt);
    });
    const right = el('div', 'eo-chat-tools'); right.append(sw, fresh);
    head.append(right);
    box.replaceChildren(head, el('div', 'eo-chat-log'), form);
    $('.eo-chat-log', box).id = 'eo-chat-log';
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
