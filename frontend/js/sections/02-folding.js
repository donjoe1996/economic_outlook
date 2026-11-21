(function () {
function wire(h, targets, onSet) {
const set = (open) => { h.setAttribute('aria-expanded', open ? 'true' : 'false'); targets.forEach((t) => t.classList.toggle('eo-collapsed', !open)); if (onSet) onSet(open); if (open) { try { window.dispatchEvent(new Event('resize')); } catch (e) {} } };
h.setAttribute('role', 'button'); h.tabIndex = 0; h.classList.add('eo-fold-h');
h.addEventListener('click', () => set(h.getAttribute('aria-expanded') !== 'true'));
h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set(h.getAttribute('aria-expanded') !== 'true'); } });
set(true);  // open by default: a decision dashboard should not hide its content
}
document.querySelectorAll('section.eo-panel').forEach((sec) => { const h = sec.querySelector(':scope > h2.eo-panel-title'); if (!h) return; sec.classList.add('eo-fold'); wire(h, [sec]); });
[['section.eo-kpis:not(.eo-derived)', 'Indikator ekonomi utama', '5 · Indikator'], ['section.eo-kpis.eo-derived', 'Indikator turunan', '7 · Turunan'], ['section.eo-note', 'Ringkasan narasi', ''], ['section.eo-charts', 'Grafik detail indikator', '6 · Grafik']].forEach((d) => {
const sec = document.querySelector(d[0]); if (!sec) return;
const bar = document.createElement('div'); bar.className = 'eo-panel eo-fold-bar'; const h = document.createElement('h2'); h.className = 'eo-panel-title'; if (d[2]) { const sp = document.createElement('span'); sp.className = 'eo-layer'; sp.textContent = d[2]; h.appendChild(sp); h.appendChild(document.createTextNode(' ')); } h.appendChild(document.createTextNode(d[1])); bar.appendChild(h);
sec.parentNode.insertBefore(bar, sec); sec.classList.add('eo-fold-t'); wire(h, [sec], (open) => bar.classList.toggle('eo-open', open));
});
})();
