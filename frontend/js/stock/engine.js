/*
 * Stock page engine: profile, valuation, foreign flows, dividends.
 *
 * Ported from the "IDX Monte Carlo Lab" prototype. The computations are kept
 * as they were; the Monte Carlo simulation and backtest are left out for now.
 * Data comes from the Google Sheets through the app (dash.data), not from
 * numbers written into the code:
 *
 *   TK.ds.price  daily closes            TK.ds.fh    year-end book/earnings/dividend
 *   TK.ds.fund   latest fundamentals     TK.ds.dv    every dividend payment
 *   TK.ds.flow   foreign flows + events  cpi         consumer prices (real rupiah)
 *   SECT.<sector>.priceDs / fundDs       peers' prices and fundamentals
 *
 * Text is Indonesian, numbers use the Indonesian style (comma decimals).
 */
(function () {
"use strict";
var $ = function (s) { return document.querySelector(s); };
var TD = 245; /* hari bursa per tahun, kira-kira */
var DAY = 86400000, YR = 365.25 * DAY;
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
var TK = (window.EO_STOCKS || {})[window.EO_TK] || (window.EO_STOCKS || {}).BMRI;
var S = { dates: [], prices: [], hasDates: true, sample: false };
var A = null, curTab = "char";

/* ---------- formatting (Indonesian) ---------- */
function cm(t) { return String(t).replace(".", ","); }
function nd(v, d) { return cm((+v).toFixed(d)); }
function pct(x, d) { if (d === undefined) d = 1; return cm((x * 100).toFixed(d)) + "%"; }
function spct(x, d) { if (d === undefined) d = 1; var v = Math.abs(x * 100).toFixed(d); return (x >= 0 || +v === 0 ? "+" : "−") + cm(v) + "%"; }
function dec(x) { var d = x >= 100 ? 0 : x >= 10 ? 1 : 2, t = x.toFixed(d); if (t.indexOf(".") >= 0) t = t.replace(/0+$/, "").replace(/\.$/, ""); return cm(t); }
function idc(v) {
  var a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e12) return s + "Rp " + dec(a / 1e12) + " T";
  if (a >= 1e9) return s + "Rp " + dec(a / 1e9) + " M";
  if (a >= 1e6) return s + "Rp " + dec(a / 1e6) + " jt";
  return s + "Rp " + Math.round(a).toLocaleString("id-ID");
}
function px(v) { return "Rp " + Math.round(v).toLocaleString("id-ID"); }
function pxShort(v) { return Math.round(v).toLocaleString("id-ID"); }
function fmtDay(t) { var d = new Date(t); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear(); }
function monthsOf(days) { var m = days / (TD / 12); return m >= 24 ? nd(days / TD, 1) + " tahun" : Math.round(m) + " bulan"; }
function x2(v) { return nd(v, 2) + "×"; }
function x1(v) { return nd(v, 1) + "×"; }

/* ---------- parsing ---------- */
function numOf(s) {
  s = String(s == null ? "" : s).replace(/Rp|\s/gi, "");
  // Indonesian "1.234.567" or "1.234,5" -> 1234567 / 1234.5. A lone "93.333" is a
  // decimal (the Sheet is read with "." as the decimal point), not 93 thousand.
  if (/^-?\d{1,3}(\.\d{3}){2,}(,\d+)?$/.test(s) || /^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  return s === "" ? NaN : Number(s);
}
function toTime(s) {
  s = String(s == null ? "" : s);
  var mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (mdy) return Date.UTC(+mdy[3], +mdy[1] - 1, +mdy[2]);
  var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  return Date.parse(s);
}

/* ---------- statistics ---------- */
function moments(r) {
  var n = r.length, m = 0, i; for (i = 0; i < n; i++) m += r[i]; m /= n;
  var s2 = 0, s3 = 0, s4 = 0;
  for (i = 0; i < n; i++) { var d = r[i] - m; s2 += d * d; s3 += d * d * d; s4 += d * d * d * d; }
  var pv = s2 / n;
  return { n: n, mean: m, sd: Math.sqrt(s2 / (n - 1)), skew: (s3 / n) / Math.pow(pv, 1.5), exk: (s4 / n) / (pv * pv) - 3 };
}
function acf(x, lag) {
  var n = x.length, m = 0, i; for (i = 0; i < n; i++) m += x[i]; m /= n;
  var num = 0, den = 0;
  for (i = 0; i < n; i++) { var d = x[i] - m; den += d * d; if (i >= lag) num += d * (x[i - lag] - m); }
  return num / den;
}
function drawdowns(p) {
  var peak = p[0], peakIdx = 0, mdd = 0, longest = 0, dd = new Array(p.length);
  for (var i = 0; i < p.length; i++) {
    if (p[i] >= peak) { longest = Math.max(longest, i - peakIdx); peak = p[i]; peakIdx = i; dd[i] = 0; }
    else { dd[i] = p[i] / peak - 1; if (dd[i] < mdd) mdd = dd[i]; }
  }
  longest = Math.max(longest, p.length - 1 - peakIdx);
  return { dd: dd, mdd: mdd, longest: longest, cur: dd[p.length - 1] };
}
function rollSd(r, k) {
  var out = [], s = 0, s2 = 0;
  for (var i = 0; i < r.length; i++) {
    s += r[i]; s2 += r[i] * r[i];
    if (i >= k) { s -= r[i - k]; s2 -= r[i - k] * r[i - k]; }
    if (i >= k - 1) { var m = s / k; out.push(Math.sqrt(Math.max(0, (s2 - k * m * m) / (k - 1)))); } else out.push(NaN);
  }
  return out;
}
function quant(sorted, q) { var pos = q * (sorted.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos); return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo); }
function lowerIdx(arr, x) { var lo = 0, hi = arr.length - 1, ans = -1; while (lo <= hi) { var mid = (lo + hi) >> 1; if (arr[mid] <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1; } return ans; }
function getWindow() {
  var yrs = Number($("#win").value), n = S.prices.length, i = 0;
  if (yrs > 0) i = Math.max(0, n - 1 - Math.round(yrs * TD));
  if (n - i < 60) i = Math.max(0, n - 60);
  return { p: S.prices.slice(i), t: S.dates.slice(i) };
}
function analyze() {
  var w = getWindow(), p = w.p, r = [], i;
  for (i = 1; i < p.length; i++) r.push(Math.log(p[i] / p[i - 1]));
  var m = moments(r), dd = drawdowns(p), ar = r.map(Math.abs), ext = 0, mn = Infinity, mx = -Infinity, imn = 0, imx = 0;
  for (i = 0; i < r.length; i++) {
    if (Math.abs(r[i] - m.mean) > 3 * m.sd) ext++;
    if (r[i] < mn) { mn = r[i]; imn = i; }
    if (r[i] > mx) { mx = r[i]; imx = i; }
  }
  var k = Math.min(63, r.length), rec = moments(r.slice(r.length - k)), k2 = Math.min(21, r.length), s21 = 0;
  for (i = r.length - k2; i < r.length; i++) s21 += r[i];
  return { p: p, t: w.t, hasDates: true, r: r, m: m, dd: dd, acAbs: acf(ar, 1), acR: acf(r, 1), ext: ext,
    worst: Math.exp(mn) - 1, best: Math.exp(mx) - 1, iWorst: imn, iBest: imx,
    recSd: rec.sd, recRatio: rec.sd / m.sd, ret21: Math.exp(s21) - 1, last: p[p.length - 1] };
}

/* ---------- chart helpers ---------- */
function niceTicks(min, max, n) {
  var span = max - min; if (span <= 0) return [min];
  var step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0))), norm = step0 / mag;
  var step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag, out = [];
  for (var v = Math.ceil(min / step) * step; v <= max + 1e-9 * step; v += step) out.push(+v.toPrecision(12));
  return out;
}
function logTicks(min, max) {
  var out = [];
  for (var e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    [1, 1.5, 2, 3, 5, 7].forEach(function (m) { var v = m * Math.pow(10, e); if (v >= min * 0.999 && v <= max * 1.001) out.push(v); });
  }
  if (out.length > 8) out = out.filter(function (v, i) { return i % 2 === 0; });
  return out;
}
function timeTicks(t0, t1) {
  var yrs = (t1 - t0) / YR, out = [], d0 = new Date(t0);
  if (yrs >= 2.5) {
    var stepY = Math.ceil(yrs / 7);
    for (var y = d0.getUTCFullYear() + 1; ; y += stepY) { var v = Date.UTC(y, 0, 1); if (v > t1) break; out.push({ v: v, l: String(y) }); }
  } else {
    var stepM = yrs > 1 ? 3 : 1, m = d0.getUTCMonth() + 1, yy = d0.getUTCFullYear();
    for (; ; m += stepM) { var v2 = Date.UTC(yy, m, 1); if (v2 > t1) break; var dd = new Date(v2); out.push({ v: v2, l: MONTHS[dd.getUTCMonth()] + " ’" + String(dd.getUTCFullYear()).slice(2) }); }
  }
  return out;
}
function pathD(xs, ys, fx, fy) {
  var n = xs.length, step = Math.max(1, Math.floor(n / 800)), d = "", i;
  for (i = 0; i < n; i += step) { d += (d ? "L" : "M") + fx(xs[i]).toFixed(1) + " " + fy(ys[i]).toFixed(1); }
  if ((n - 1) % step !== 0) d += "L" + fx(xs[n - 1]).toFixed(1) + " " + fy(ys[n - 1]).toFixed(1);
  return d;
}
var chartId = 0;
function chart(el, o) {
  var cw = el.clientWidth || 720, W = o.W || Math.max(300, Math.min(760, Math.round(cw))), H = o.H || (W < 480 ? 220 : 260), L = o.L || (W < 480 ? 50 : 58), R = o.R || 12, T = 10, B = 28, id = "c" + (chartId++);
  var x0 = L, x1 = W - R, y0 = H - B, y1 = T;
  var fx = function (v) { return x0 + (v - o.xmin) / (o.xmax - o.xmin) * (x1 - x0); };
  var ty = o.logY ? Math.log : function (v) { return v; };
  var a = ty(o.ymin), b = ty(o.ymax);
  var fy = function (v) { return y0 - (ty(v) - a) / (b - a) * (y0 - y1); };
  var s = '<svg class="ch' + (o.cls ? ' ' + o.cls : '') + '" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + o.label + '">';
  s += '<defs><clipPath id="' + id + '"><rect x="' + x0 + '" y="' + (y1 - 2) + '" width="' + (x1 - x0) + '" height="' + (y0 - y1 + 4) + '"/></clipPath></defs>';
  var yt = o.yticks || (o.logY ? logTicks(o.ymin, o.ymax) : niceTicks(o.ymin, o.ymax, 5));
  yt.forEach(function (v) {
    var y = fy(v); if (y < y1 - 1 || y > y0 + 1) return;
    s += '<line class="grid" x1="' + x0 + '" x2="' + x1 + '" y1="' + y + '" y2="' + y + '"/><text class="tl" x="' + (x0 - 6) + '" y="' + (y + 3.5) + '" text-anchor="end">' + o.yfmt(v) + '</text>';
  });
  s += '<line class="grid" x1="' + x0 + '" x2="' + x1 + '" y1="' + y0 + '" y2="' + y0 + '" style="stroke:var(--muted)"/>';
  o.xticks.forEach(function (t) {
    var x = fx(t.v); if (x < x0 - 1 || x > x1 + 1) return;
    s += '<line class="grid" x1="' + x + '" x2="' + x + '" y1="' + y0 + '" y2="' + (y0 + 4) + '" style="stroke:var(--muted)"/><text class="tl" x="' + x + '" y="' + (y0 + 18) + '" text-anchor="middle">' + t.l + '</text>';
  });
  var k = { x0: x0, x1: x1, y0: y0, y1: y1, W: W, H: H };
  s += '<g clip-path="url(#' + id + ')">' + o.layers(fx, fy, k) + '</g>' + (o.overlay ? o.overlay(fx, fy, k) : '') + '</svg>';
  el.innerHTML = s;
  return { fx: fx, fy: fy, k: k, svg: el.querySelector("svg") };
}
function stat(l, v, n, tone) { return '<div class="stat ' + (tone || "") + '"><div class="cl">' + l + '</div><div class="cv">' + v + '</div><div class="cn">' + n + '</div></div>'; }
function note(sel, html) { var el = $(sel); if (el) el.innerHTML = html; }
function dateAt(i) { return fmtDay(A.t[i]); }

/* ---------- profile ---------- */
function renderProfile() {
  A = analyze();
  var m = A.m, n = A.r.length, ann = m.sd * Math.sqrt(TD), growth = Math.exp(m.mean * TD) - 1;
  var ratio = Math.abs(Math.log(1 + A.worst)) / m.sd, expExt = n * 0.0027;
  $("#verdict").textContent = "Pada hari biasa " + TK.code + " bergerak sekitar ±" + pct(m.sd, 2) + " (" + pct(ann, 0) + " setahun), tetapi hari terburuknya " + spct(A.worst) + ", kira-kira " + Math.round(ratio) + "× gerak biasa.";
  $("#verdictSub").textContent = n.toLocaleString("id-ID") + " hari bursa, " + fmtDay(A.t[0]) + " sampai " + fmtDay(A.t[A.t.length - 1]) + ". Kurva lonceng memperkirakan sekitar " + nd(expExt, 1) + " hari di luar tiga simpangan baku. " + TK.code + " mengalami " + A.ext + ".";
  var ddTone = A.dd.mdd < -0.35 ? "bad" : A.dd.mdd < -0.2 ? "warn" : "";
  var recTone = A.recRatio > 1.5 ? "bad" : A.recRatio > 1.2 ? "warn" : A.recRatio < 0.8 ? "ok" : "";
  $("#cards").innerHTML =
    stat("Gerak harian biasa", "±" + pct(m.sd, 2), "Hari normal, naik atau turun.") +
    stat("Volatilitas setahun", pct(ann, 0), "Gerak harian × √" + TD + " hari bursa.") +
    stat("Rata-rata pertumbuhan setahun", spct(growth, 0), realGrowthNote(growth), growth < 0 ? "warn" : "") +
    stat("Skor ekor tebal", nd(m.exk, 1), m.exk > 1 ? "Hari ekstrem lebih sering daripada yang diizinkan kurva lonceng." : "Mendekati kurva lonceng.", m.exk > 3 ? "bad" : m.exk > 1 ? "warn" : "") +
    stat("Hari ekstrem", A.ext + " dari " + n.toLocaleString("id-ID"), "Kurva lonceng memperkirakan sekitar " + nd(expExt, 1) + ".", A.ext > expExt * 2 ? "bad" : "") +
    stat("Hari terburuk", spct(A.worst), dateAt(A.iWorst + 1) + ". Hari terbaik " + spct(A.best) + ".", "bad") +
    stat("Penurunan terdalam dari puncak", spct(A.dd.mdd, 0), "Masa terlama di bawah puncak: " + monthsOf(A.dd.longest) + ".", ddTone) +
    stat("Hari ini vs puncak", spct(A.dd.cur, 0), "Posisi penutupan terakhir terhadap penutupan tertinggi.", A.dd.cur < -0.2 ? "warn" : "") +
    stat("3 bulan terakhir vs biasanya", x2(A.recRatio), (Math.abs(A.recRatio - 1) < 0.1 ? "Gerak harian terakhir kira-kira sama besar dengan rata-rata jendela." : "Gerak harian terakhir lebih " + (A.recRatio > 1 ? "besar" : "kecil") + " dari rata-rata jendela."), recTone) +
    stat("Kelompok volatilitas", nd(A.acAbs, 2), A.acAbs > 0.15 ? "Hari-hari liar datang berkelompok." : "Sedikit pengelompokan.", A.acAbs > 0.15 ? "warn" : "") +
    stat("Sebulan terakhir", spct(A.ret21), "Imbal hasil 21 hari bursa terakhir.", A.ret21 < -0.1 ? "bad" : "");
  note("#exHist", "<p><b>Artinya.</b> Sebagian besar hari berkumpul di tengah yang sempit, tetapi ekornya lebih tebal dari kurva lonceng. " +
    (A.ext > expExt ? TK.code + " mengalami " + A.ext + " hari ekstrem, sementara kurva lonceng memperkirakan " + nd(expExt, 1) + ". " : "Hari ekstrem " + TK.code + " mendekati perkiraan kurva lonceng. ") +
    "Karena itu model yang menganggap gerak harga mengikuti kurva lonceng akan meremehkan kemungkinan hari-hari buruk.</p>");
  renderHist(); renderPrice(); renderYears();
}
function renderHist() {
  var m = A.m, r = A.r, w = m.sd / 3, mxAbs = 0, i;
  for (i = 0; i < r.length; i++) mxAbs = Math.max(mxAbs, Math.abs(r[i] - m.mean));
  var half = Math.max(4, Math.ceil(mxAbs / w)), nb = half * 2 + 1, counts = new Array(nb).fill(0);
  for (i = 0; i < r.length; i++) { var k = Math.round((r[i] - m.mean) / w) + half; counts[Math.min(nb - 1, Math.max(0, k))]++; }
  function pdf(x) { var z = (x - m.mean) / m.sd; return Math.exp(-z * z / 2) / (m.sd * Math.sqrt(2 * Math.PI)); }
  var logY = $("#histLog").checked, tr = function (c) { return logY ? Math.log(1 + c) : c; };
  var exp = counts.map(function (_, j) { return r.length * w * pdf(m.mean + (j - half) * w); });
  var ymax = 0; counts.forEach(function (c, j) { ymax = Math.max(ymax, tr(c), tr(exp[j])); }); ymax *= 1.08;
  var xmin = m.mean - (half + .5) * w, xmax = m.mean + (half + .5) * w;
  var yt = logY ? [0, 1, 10, 100, 1000].filter(function (c) { return Math.log(1 + c) <= ymax; }).map(function (c) { return Math.log(1 + c); }) : null;
  chart($("#chHist"), { xmin: xmin, xmax: xmax, ymin: 0, ymax: ymax, yticks: yt || undefined,
    yfmt: function (v) { return String(Math.round(logY ? Math.exp(v) - 1 : v)); },
    xticks: niceTicks(xmin, xmax, 8).map(function (v) { return { v: v, l: (v * 100).toFixed(0) + "%" }; }),
    label: "Histogram imbal hasil harian " + TK.code + " dibanding kurva lonceng",
    layers: function (fx, fy) {
      var s = "";
      counts.forEach(function (c, j) {
        if (!c) return;
        var cx = m.mean + (j - half) * w, tail = Math.abs(cx - m.mean) > 3 * m.sd;
        var x = fx(cx - w / 2), xb = fx(cx + w / 2), y = fy(tr(c));
        s += '<rect x="' + (x + .5) + '" y="' + y + '" width="' + Math.max(1, xb - x - 1) + '" height="' + (fy(0) - y) + '" fill="' + (tail ? 'var(--tail)' : 'var(--accent-mid)') + '"/>';
      });
      var xs = [], ys = []; counts.forEach(function (_, j) { xs.push(m.mean + (j - half) * w); ys.push(tr(exp[j])); });
      s += '<path d="' + pathD(xs, ys, fx, fy) + '" fill="none" stroke="var(--fg)" stroke-width="1.6"/>';
      return s;
    } });
}
function realGrowthNote(g) {
  var yrs = (A.t[A.t.length - 1] - A.t[0]) / YR, f = cpiAt(A.t[A.t.length - 1]) / cpiAt(A.t[0]), pi = Math.pow(f, 1 / yrs) - 1;
  return "Sangat bergantung pada jendela. Setelah inflasi " + pct(pi, 1) + " setahun, kira-kira " + spct(realOf(g, pi), 0) + ".";
}
function renderPrice() {
  var p = A.p, t = A.t, r = A.r, m = A.m;
  var real = $("#priceReal").checked, pp = real ? p.map(function (v, i) { return v * rf(t[i]); }) : p;
  $("#priceCap").textContent = real ? "Setiap harga dinyatakan dalam rupiah hari ini dengan indeks harga konsumen Indonesia, jadi garis datar berarti saham hanya mengimbangi inflasi. Skala log." : "Skala log, jadi jarak yang sama berarti persentase gerak yang sama.";
  var lo = Math.min.apply(null, pp) * 0.95, hi = Math.max.apply(null, pp) * 1.05;
  chart($("#chPrice"), { xmin: t[0], xmax: t[t.length - 1], ymin: lo, ymax: hi, logY: true, yfmt: pxShort,
    xticks: timeTicks(t[0], t[t.length - 1]),
    label: "Riwayat harga " + TK.code, layers: function (fx, fy) { return '<path d="' + pathD(t, pp, fx, fy) + '" fill="none" stroke="var(--accent)" stroke-width="1.5"/>'; } });
  var rs = rollSd(r, 30), ann = rs.map(function (v) { return v * Math.sqrt(TD); }), tt = t.slice(1), avg = m.sd * Math.sqrt(TD);
  var okv = ann.filter(function (v) { return !isNaN(v); }), vmax = Math.max.apply(null, okv) * 1.1;
  chart($("#chVol"), { xmin: tt[0], xmax: tt[tt.length - 1], ymin: 0, ymax: vmax, yfmt: function (v) { return (v * 100).toFixed(0) + "%"; },
    xticks: timeTicks(tt[0], tt[tt.length - 1]), label: "Volatilitas tahunan 30 hari bergulir", H: 200,
    layers: function (fx, fy) {
      var xs = [], ys = []; ann.forEach(function (v, i) { if (!isNaN(v)) { xs.push(tt[i]); ys.push(v); } });
      return '<line x1="' + fx(tt[0]) + '" x2="' + fx(tt[tt.length - 1]) + '" y1="' + fy(avg) + '" y2="' + fy(avg) + '" stroke="var(--muted)" stroke-dasharray="4 4"/><path d="' + pathD(xs, ys, fx, fy) + '" fill="none" stroke="var(--warn)" stroke-width="1.5"/>';
    } });
  var lastV = okv[okv.length - 1], maxV = Math.max.apply(null, okv), minV = Math.min.apply(null, okv);
  note("#exVol", "<p><b>Artinya.</b> Volatilitas berkisar dari " + pct(minV, 0) + " sampai " + pct(maxV, 0) + " setahun, dan bacaan 30 hari terakhir " + pct(lastV, 0) + " dibanding rata-rata jendela " + pct(avg, 0) + ". " +
    (lastV > avg * 1.3 ? TK.code + " sedang dalam masa yang lebih liar dari biasanya. " : lastV < avg * 0.8 ? TK.code + " sedang dalam masa yang lebih tenang dari biasanya. " : TK.code + " mendekati volatilitas biasanya. ") +
    "Skor kelompok " + nd(A.acAbs, 2) + " " + (A.acAbs > 0.15 ? "menegaskan bahwa hari-hari liar datang berkelompok: setelah guncangan, guncangan berikutnya lebih mungkin." : "menunjukkan sedikit pengelompokan di jendela ini.") + "</p>");
  var dd = A.dd.dd, dmin = Math.min(A.dd.mdd * 1.1, -0.05);
  chart($("#chDD"), { xmin: t[0], xmax: t[t.length - 1], ymin: dmin, ymax: 0, yfmt: function (v) { return (v * 100).toFixed(0) + "%"; },
    xticks: timeTicks(t[0], t[t.length - 1]), label: "Penurunan dari puncak sebelumnya", H: 200,
    layers: function (fx, fy) {
      var d = pathD(t, dd, fx, fy);
      return '<path d="' + d + 'L' + fx(t[t.length - 1]) + ' ' + fy(0) + 'L' + fx(t[0]) + ' ' + fy(0) + 'Z" fill="var(--tail)" fill-opacity=".25"/><path d="' + d + '" fill="none" stroke="var(--tail)" stroke-width="1.2"/>';
    } });
  note("#exDD", "<p><b>Artinya.</b> Penurunan terdalam " + spct(A.dd.mdd, 0) + " dan masa terlama di bawah puncak sebelumnya " + monthsOf(A.dd.longest) + ". Hari ini " + TK.code + " berada " + pct(-A.dd.cur, 0) + " di bawah titik tertinggi jendela. Itulah ukuran seberapa dalam dan lama “masa buruk” bisa berlangsung untuk saham ini.</p>");
}
function yearRows() {
  var p = A.p, t = A.t, rows = [], cur = null, i;
  for (i = 1; i < p.length; i++) {
    var key = new Date(t[i]).getUTCFullYear();
    if (!cur || cur.y !== key) { cur = { y: key, i0: i - 1, i1: i, r: [] }; rows.push(cur); }
    cur.i1 = i; cur.r.push(Math.log(p[i] / p[i - 1]));
  }
  return rows.map(function (g, idx) {
    var seg = p.slice(g.i0, g.i1 + 1), mm = g.r.length >= 20 ? moments(g.r) : null, mn = Math.min.apply(null, g.r);
    return { label: g.y + (idx === rows.length - 1 && g.r.length < 200 ? " (berjalan)" : ""),
      ret: p[g.i1] / p[g.i0] - 1, vol: mm ? mm.sd * Math.sqrt(TD) : NaN, worst: Math.exp(mn) - 1, dd: drawdowns(seg).mdd, days: g.r.length };
  });
}
function renderYears() {
  var rows = yearRows();
  $("#yearTable").innerHTML = '<thead><tr><th>Tahun</th><th>Imbal hasil</th><th>Volatilitas</th><th>Hari terburuk</th><th>Penurunan terdalam</th></tr></thead><tbody>' +
    rows.map(function (r) { return '<tr><td>' + r.label + '</td><td class="' + (r.ret < 0 ? "bad" : "ok") + '">' + spct(r.ret, 0) + '</td><td>' + (isNaN(r.vol) ? "–" : pct(r.vol, 0)) + '</td><td>' + spct(r.worst) + '</td><td>' + spct(r.dd, 0) + '</td></tr>'; }).join("") + '</tbody>';
}

/* ---------- inflation (CPI from the IHK tab) ---------- */
var CPI = { rows: [], t: [], note: "" }, inflEdited = false;
function setCPI(rows) { CPI.rows = rows; CPI.t = rows.map(function (r) { return r.t; }); }
function cpiAt(t) {
  var r = CPI.rows, n = r.length;
  if (n < 2) return 1;
  if (t <= r[0].t) { var g0 = Math.pow(r[1].v / r[0].v, YR / (r[1].t - r[0].t)); return r[0].v * Math.pow(g0, (t - r[0].t) / YR); }
  if (t >= r[n - 1].t) { var i12 = Math.max(0, lowerIdx(CPI.t, r[n - 1].t - YR)), g = Math.pow(r[n - 1].v / r[i12].v, YR / (r[n - 1].t - r[i12].t)); return r[n - 1].v * Math.pow(g, (t - r[n - 1].t) / YR); }
  var k = lowerIdx(CPI.t, t), a = r[k], b = r[k + 1];
  return a.v * Math.pow(b.v / a.v, (t - a.t) / (b.t - a.t));
}
function nowT() { return S.dates.length ? S.dates[S.dates.length - 1] : CPI.rows[CPI.rows.length - 1].t; }
function rf(t) { return cpiAt(nowT()) / cpiAt(t); }
function yoyAt(t) { return cpiAt(t) / cpiAt(t - YR) - 1; }
function latestYoy() { var l = CPI.rows[CPI.rows.length - 1].t; return yoyAt(l); }
function inflNow() { var el = $("#vInf"), v = Number(el.value); return (el.value !== "" && isFinite(v)) ? v : latestYoy() * 100; }
function setInflDefaults() { if (!inflEdited && CPI.rows.length > 1) $("#vInf").value = +(latestYoy() * 100).toFixed(2); }
function realOf(x, inf) { return (1 + x) / (1 + inf) - 1; }
$("#vInf").addEventListener("input", function () { inflEdited = true; if (!$("#p-val").classList.contains("hidden")) renderVal(); });

/* ---------- fundamentals and valuation ---------- */
var F = { map: {}, note: "" };
var vEdited = {};
function fv(k) { var v = F.map[k]; return (v === undefined || !isFinite(v)) ? NaN : v; }
function applyDefaults() {
  function setv(id, v) { if (!vEdited[id] && isFinite(v)) $("#" + id).value = (+v.toFixed(2)); }
  setv("vRoe", fv("roe")); setv("vPay", fv("payout_fy2025"));
}
["vCoe", "vG", "vEg", "vPay", "vRoe", "vRoeT"].forEach(function (id) { $("#" + id).addEventListener("input", function () { vEdited[id] = true; renderVal(); }); });
function vPar() {
  function g(id, d) { var v = Number($("#" + id).value); return isFinite(v) && $("#" + id).value !== "" ? v / 100 : d; }
  return { coe: g("vCoe", TK.val.coe / 100), g: g("vG", TK.val.g / 100), eg: g("vEg", TK.val.eg / 100), pay: g("vPay", fv("payout_fy2025") / 100), roe: g("vRoe", fv("roe") / 100), roeT: g("vRoeT", TK.val.roeT / 100) };
}
function vA(p, bv) { return p.coe > p.g + 1e-9 ? bv * (p.roe - p.g) / (p.coe - p.g) : NaN; }
function vB(p, eps) { return p.coe > p.g + 1e-9 ? eps * (1 + p.eg) * p.pay / (p.coe - p.g) : NaN; }
function vC(p, bv) {
  if (!(p.coe > p.g + 1e-9)) return NaN;
  var B = bv, pv = 0, N = 10, t;
  for (t = 1; t <= N; t++) { var r = p.roe + (p.roeT - p.roe) * (t / N), ni = r * B, ri = ni - p.coe * B; pv += ri / Math.pow(1 + p.coe, t); B += ni * (1 - p.pay); }
  var tv = ((p.roeT - p.coe) * B) / (p.coe - p.g) / Math.pow(1 + p.coe, N);
  return bv + pv + tv;
}
function vAll(p, bv, eps) { var a = vA(p, bv), b = vB(p, eps), c = vC(p, bv), ok = [a, b, c].filter(isFinite); return { A: a, B: b, C: c, avg: ok.length === 3 ? (a + b + c) / 3 : NaN }; }
function shift(p, d) { return { coe: p.coe + d.coe, g: p.g + d.g, eg: p.eg + d.eg, pay: p.pay, roe: p.roe + d.roe, roeT: p.roeT + d.roe }; }
function vcol(v) { return isFinite(v) ? px(v) : "n/a"; }
function upTone(u) { return u > 0.15 ? "ok" : u < -0.15 ? "bad" : "warn"; }
function fmtShares(x) { return nd(x / 1e9, 2) + " miliar"; }

function renderVal() {
  if (!S.prices.length || !isFinite(fv("shares_out"))) return;
  var n = S.prices.length, price = S.prices[n - 1];
  var shares = fv("shares_out") * 1e9, bv = fv("equity_parent") * 1e12 / shares, eps = fv("net_profit_ttm") * 1e12 / shares, dpsT = fv("dps_ttm_paid");
  var p = vPar(), eps1 = eps * (1 + p.eg), dps1 = eps1 * p.pay, inf = inflNow() / 100;
  $("#vRealLine").textContent = "Dalam uang hari ini, dengan inflasi " + pct(inf, 1) + " setahun: biaya ekuitas " + pct(p.coe, 1) + " kira-kira " + pct(realOf(p.coe, inf), 1) + " di atas kenaikan harga, pertumbuhan jangka panjang " + pct(p.g, 1) + " kira-kira " + pct(realOf(p.g, inf), 1) + " riil, dan pertumbuhan laba tahun depan " + pct(p.eg, 1) + " kira-kira " + pct(realOf(p.eg, inf), 1) + " riil." + (realOf(p.g, inf) > 0.04 ? " Pertumbuhan riil jangka panjang di atas 4% adalah standar tinggi bagi perusahaan mana pun." : "");
  var pbv = price / bv, per = price / eps, perF = price / eps1, yT = dpsT / price, yF = dps1 / price, ey = eps / price, mcap = price * shares;
  var base = vAll(p, bv, eps), bear = vAll(shift(p, { coe: .01, g: -.01, roe: -.02, eg: -.03 }), bv, eps), bull = vAll(shift(p, { coe: -.01, g: .01, roe: .02, eg: .03 }), bv, eps);
  var up = isFinite(base.avg) ? base.avg / price - 1 : NaN;
  $("#vVerdict").textContent = "Di " + px(price) + ", " + TK.code + " diperdagangkan " + x2(pbv) + " nilai buku dan " + x1(per) + " laba 12 bulan terakhir, dengan imbal hasil dividen " + pct(yT, 1) + ".";
  $("#vSub").textContent = isFinite(up) ? "Dengan asumsi Anda, ketiga metode valuasi rata-rata " + px(base.avg) + ", yaitu " + (up >= 0 ? pct(up, 0) + " di atas" : pct(-up, 0) + " di bawah") + " harga. " + (up > 0.15 ? "Itu menunjukkan margin keamanan bila asumsinya bertahan." : up < -0.15 ? "Artinya harga sudah mengasumsikan lebih dari yang diizinkan masukan ini." : "Itu dekat nilai wajar, jadi jawabannya bergantung pada masukan.") : "Biaya ekuitas harus di atas pertumbuhan jangka panjang agar metode ini bekerja. Ubah asumsi di bawah.";
  $("#vSrc").innerHTML = F.note + " Harga: penutupan terakhir " + px(price) + " pada " + fmtDay(S.dates[n - 1]) + ".";

  $("#vPayStats").innerHTML =
    stat("Harga terhadap nilai buku", x2(pbv), "Harga ÷ nilai buku per saham " + px(bv) + ".", pbv > 3.5 ? "warn" : "") +
    stat("PER, 12 bulan terakhir", x1(per), "Harga ÷ laba per saham " + px(eps) + ".") +
    stat("PER, tahun depan", x1(perF), "Dengan pertumbuhan laba " + pct(p.eg, 1) + ": " + px(eps1) + " per saham.") +
    stat("Imbal hasil dividen, 12 bulan", pct(yT, 1), px(dpsT) + " per saham setahun terakhir. Dikurangi inflasi " + pct(inf, 1) + ": " + pct(yT - inf, 1) + ".", yT > 0.05 ? "ok" : "") +
    stat("Imbal hasil dividen, tahun depan", pct(yF, 1), "Rasio pembayaran " + pct(p.pay, 0) + " dari laba tahun depan.") +
    stat("Imbal laba", pct(ey, 1), "Laba ÷ harga. Setelah inflasi " + pct(inf, 1) + " menjadi " + pct(ey - inf, 1) + ". Bandingkan dengan biaya ekuitas Anda " + pct(p.coe, 1) + ".", ey > p.coe ? "ok" : "warn") +
    stat("Nilai pasar", idc(mcap), fmtShares(shares) + " saham beredar.");
  var lo52 = Infinity, hi52 = -Infinity, i0 = Math.max(0, n - TD), i;
  for (i = i0; i < n; i++) { lo52 = Math.min(lo52, S.prices[i]); hi52 = Math.max(hi52, S.prices[i]); }
  var i5 = Math.max(0, n - 5 * TD), below = 0, tot = 0; for (i = i5; i < n; i++) { tot++; if (S.prices[i] <= price) below++; }
  note("#exPay", "<p><b>Dalam bahasa sederhana.</b> PBV menanyakan berapa yang Anda bayar untuk setiap rupiah aset bersih bank. PER menanyakan berapa tahun laba saat ini yang setara dengan harga. Bank dengan imbal hasil ekuitas tinggi layak dihargai lebih tinggi terhadap nilai buku, jadi nilai " + x2(pbv) + " terhadap ROE " + pct(p.roe, 1) + " di bawah, bukan sendirian. Dalam 52 minggu terakhir saham diperdagangkan antara " + px(lo52) + " dan " + px(hi52) + ", atau " + x2(lo52 / bv) + " sampai " + x2(hi52 / bv) + " nilai buku hari ini. Harga hari ini lebih tinggi dari " + Math.round(below / tot * 100) + "% penutupan dalam " + nd(Math.min(5, Math.round(tot / TD * 10) / 10), 1) + " tahun terakhir.</p>");

  renderMultHist(price, bv, eps);
  renderPeers(price, bv, eps);

  var pg = fv("profit_growth_h1");
  $("#vGet").innerHTML =
    stat("Return on equity", pct(fv("roe") / 100, 1), "Laba disetahunkan ÷ ekuitas, H1 2026.", fv("roe") >= 15 ? "ok" : "warn") +
    stat("Laba per saham, 12 bulan", px(eps), "Laba Rp " + nd(fv("net_profit_ttm"), 1) + " T dalam 12 bulan terakhir.") +
    stat("Nilai buku per saham", px(bv), "Ekuitas Rp " + nd(fv("equity_parent"), 1) + " T ÷ jumlah saham.") +
    stat("Dividen per saham, FY2025", px(fv("dps_fy2025")), "Naik dari " + px(fv("dps_fy2024")) + " pada FY2024 dan " + px(fv("dps_fy2023")) + " pada FY2023.", "ok") +
    stat("Rasio pembayaran, FY2025", pct(fv("payout_fy2025") / 100, 0), "FY2024 " + pct(fv("payout_fy2024") / 100, 1) + ". Sisanya ditahan untuk menumbuhkan nilai buku.") +
    stat("Pertumbuhan laba, H1 2026", spct(pg / 100, 1), "Dibanding H1 2025.", pg < 3 ? "warn" : "");
  var sg = (fv("roe") / 100) * (1 - p.pay);
  note("#exGet", "<p><b>Dalam bahasa sederhana.</b> ROE adalah mesinnya: seberapa keras setiap rupiah uang pemegang saham bekerja. Dengan rasio pembayaran " + pct(p.pay, 0) + ", bank menahan " + pct(1 - p.pay, 0) + " laba, yang dengan ROE " + pct(fv("roe") / 100, 1) + " membuat nilai buku tumbuh sekitar " + pct(sg, 1) + " setahun tanpa menerbitkan saham baru." + TK.x.getNote(pg) + "</p>");

  $("#vSafe").innerHTML =
    stat("Net interest margin", pct(fv("nim") / 100, 1), "Selisih yang disimpan bank dari penyaluran kreditnya, penggerak laba utama.") +
    stat("Kredit bermasalah (NPL)", pct(fv("npl") / 100, 1), "Kredit yang sudah bermasalah.", fv("npl") > 2.5 ? "warn" : "ok") +
    stat("Loan at risk", pct(fv("lar") / 100, 1), "Termasuk kredit yang direstrukturisasi setelah Covid.", fv("lar") > 6 ? "warn" : "") +
    stat("Kecukupan modal (CAR)", pct(fv("car") / 100, 1), TK.x.carNote, fv("car") >= 20 ? "ok" : "warn") +
    stat("Dana murah (CASA)", pct(fv("casa") / 100, 1), "Giro dan tabungan sebagai bagian simpanan.", "ok") +
    stat("Kredit terhadap simpanan", pct(fv("ldr") / 100, 1), "Di bawah 100% berarti menyalurkan lebih sedikit dari yang dihimpun.") +
    stat("Biaya terhadap pendapatan", pct(fv("cir") / 100, 1), "Makin rendah makin efisien.", fv("cir") < 40 ? "ok" : "") +
    stat("Pertumbuhan kredit", spct(fv("loan_growth") / 100, 0), "Simpanan tumbuh " + spct(fv("deposit_growth") / 100, 1) + ".");
  note("#exSafe", "<p><b>Dalam bahasa sederhana.</b> " + TK.x.safeNote() + "</p>");

  function row(name, b1, b2, b3) { var u = isFinite(b2) ? b2 / price - 1 : NaN; return "<tr><td>" + name + "</td><td>" + vcol(b1) + "</td><td><b>" + vcol(b2) + "</b></td><td>" + vcol(b3) + "</td><td class=\"" + (isFinite(u) ? upTone(u) : "") + "\">" + (isFinite(u) ? spct(u, 0) : "n/a") + "</td></tr>"; }
  $("#vTable").innerHTML = "<thead><tr><th>Metode</th><th>Pesimis</th><th>Dasar</th><th>Optimis</th><th>Dasar vs harga</th></tr></thead><tbody>" +
    row("PBV yang dibenarkan", bear.A, base.A, bull.A) + row("Diskonto dividen", bear.B, base.B, bull.B) + row("Residual income, ROE memudar", bear.C, base.C, bull.C) + row("<b>Rata-rata ketiganya</b>", bear.avg, base.avg, bull.avg) + "</tbody>";
  drawFF([{ n: "PBV yang dibenarkan", lo: bear.A, mid: base.A, hi: bull.A }, { n: "Diskonto dividen", lo: bear.B, mid: base.B, hi: bull.B }, { n: "Residual income, ROE memudar", lo: bear.C, mid: base.C, hi: bull.C }, { n: "Rata-rata ketiganya", lo: bear.avg, mid: base.avg, hi: bull.avg, strong: true }, { n: "Rentang pasar 52 minggu", lo: lo52, mid: NaN, hi: hi52, market: true }], price);
  var spread = (isFinite(bull.avg) && isFinite(bear.avg)) ? bull.avg / bear.avg : NaN;
  note("#exFF", "<p><b>Yang bisa diambil.</b> " + (isFinite(spread) ? "Kasus hati-hati dan optimis, " + px(bear.avg) + " dan " + px(bull.avg) + ", berjarak faktor " + nd(spread, 1) + ", jadi anggap angka tunggal mana pun sebagai pusat sebuah rentang, bukan target. " : "") + "Metodenya juga saling berbeda: PBV yang dibenarkan mengasumsikan ROE hari ini tidak pernah memudar, residual income membiarkannya turun ke " + pct(p.roeT, 0) + ". Bila harga berada di bawah sebagian besar batang, pasar lebih pesimis dari masukan Anda; bila di atas, lebih optimis.</p>");

  var gImp = p.coe - dps1 / price, roeImp = pbv * (p.coe - p.g) + p.g;
  $("#vImp").innerHTML =
    stat("Pertumbuhan yang tersirat di harga", pct(gImp, 1), "Pertumbuhan jangka panjang yang membuat nilai diskonto dividen sama dengan harga hari ini. Asumsi Anda " + pct(p.g, 1) + ".", gImp < p.g - 0.005 ? "ok" : gImp > p.g + 0.005 ? "warn" : "") +
    stat("ROE yang tersirat di harga", pct(roeImp, 1), "ROE yang membenarkan " + x2(pbv) + " nilai buku pada pertumbuhan Anda. ROE yang dilaporkan " + pct(fv("roe") / 100, 1) + ".", roeImp < fv("roe") / 100 - 0.005 ? "ok" : roeImp > fv("roe") / 100 + 0.005 ? "warn" : "") +
    stat("Tahun dividen untuk menebus harga", nd(price / dps1, 1), "Harga ÷ dividen tahun depan, tanpa pertumbuhan sama sekali.");
  note("#exImp", "<p><b>Cara membaca.</b> " + (gImp < p.g ? "Harga hanya butuh " + TK.code + " tumbuh " + pct(gImp, 1) + " setahun selamanya, di bawah asumsi Anda " + pct(p.g, 1) + ", jadi ada ruang untuk kecewa sebelum harga tampak salah. " : "Harga butuh pertumbuhan " + pct(gImp, 1) + " selamanya, di atas asumsi Anda " + pct(p.g, 1) + ", jadi harga sudah mengasumsikan hal-hal berjalan lebih baik dari perkiraan Anda. ") + (roeImp < fv("roe") / 100 ? "Harga juga dihitung seolah ROE turun ke sekitar " + pct(roeImp, 0) + ", dibanding " + pct(fv("roe") / 100, 1) + " yang dilaporkan hari ini." : "Harga juga dihitung seolah ROE naik di atas " + pct(fv("roe") / 100, 1) + " hari ini.") + " Di sisi mana pun Anda berada, tanyakan apakah keyakinan itu lebih mudah atau lebih sulit dipertahankan daripada perkiraan Anda sendiri.</p>");

  var cs = [-.02, -.01, 0, .01, .02], gs = [-.02, -.01, 0, .01, .02], h = "<thead><tr><th>Biaya ekuitas</th>" + gs.map(function (d) { return "<th>Pertumbuhan " + pct(p.g + d, 1) + "</th>"; }).join("") + "</tr></thead><tbody>";
  cs.forEach(function (dc) {
    h += "<tr><th>" + pct(p.coe + dc, 1) + "</th>";
    gs.forEach(function (dg) {
      var q = { coe: p.coe + dc, g: p.g + dg, eg: p.eg, pay: p.pay, roe: p.roe, roeT: p.roeT }, v = vAll(q, bv, eps).avg, u = v / price - 1, bg = !isFinite(v) ? "" : u > 0.15 ? "background:color-mix(in srgb,var(--ok) 22%,transparent)" : u < -0.15 ? "background:color-mix(in srgb,var(--tail) 22%,transparent)" : "";
      h += "<td class=\"" + ((dc === 0 && dg === 0) ? "base" : "") + "\" style=\"" + bg + "\">" + (isFinite(v) ? pxShort(v) + "<small>" + spct(u, 0) + "</small>" : "n/a") + "</td>";
    });
    h += "</tr>";
  });
  $("#vSens").innerHTML = h + "</tbody>";
  var corner = vAll({ coe: p.coe - .02, g: p.g + .02, eg: p.eg, pay: p.pay, roe: p.roe, roeT: p.roeT }, bv, eps).avg, corner2 = vAll({ coe: p.coe + .02, g: p.g - .02, eg: p.eg, pay: p.pay, roe: p.roe, roeT: p.roeT }, bv, eps).avg;
  note("#exSens", "<p><b>Maksud tabel ini.</b> Menggeser biaya ekuitas dan pertumbuhan dua poin ke tiap arah mengayunkan nilai rata-rata dari sekitar " + (isFinite(corner2) ? px(corner2) : "n/a") + " sampai " + (isFinite(corner) ? px(corner) : "n/a") + ". Saham seperti ini dinilai dari selisih kecil asumsi jangka panjang, jadi keputusan yang hanya berhasil di satu sudut tabel itu rapuh. Sel berbingkai adalah kasus dasar Anda.</p>");
}

/* ---------- own multiple history ---------- */
var FH = { rows: [] };
function multSeries() {
  var rows = FH.rows; if (rows.length < 2) return null;
  var rt = rows.map(function (r) { return r.t; }), n = S.prices.length, out = [], last = rows[rows.length - 1], i;
  for (i = 0; i < n; i++) {
    var t = S.dates[i]; if (t < rt[0]) continue;
    var bv, eps;
    if (t >= last.t) { bv = last.bv; eps = last.eps; }
    else { var k = lowerIdx(rt, t), a = rows[k], b = rows[k + 1], w = (t - a.t) / (b.t - a.t); bv = a.bv + (b.bv - a.bv) * w; eps = a.eps + (b.eps - a.eps) * w; }
    out.push({ t: t, i: i, pbv: S.prices[i] / bv, per: S.prices[i] / eps, rey: eps / S.prices[i] - yoyAt(t) });
  }
  return out;
}
function drawMult(sel, ser, key, cur, q, title, opt) {
  opt = opt || {};
  var t0 = ser[0].t, t1 = ser[ser.length - 1].t, lo = Infinity, hi = -Infinity, i;
  for (i = 0; i < ser.length; i++) { lo = Math.min(lo, ser[i][key]); hi = Math.max(hi, ser[i][key]); }
  lo = Math.min(lo, cur); hi = Math.max(hi, cur); var pad = (hi - lo) * 0.08, ymin = opt.neg ? lo - pad : Math.max(0, lo - pad), ymax = hi + pad, xs = ser.map(function (r) { return r.t; }), ys = ser.map(function (r) { return r[key]; });
  return chart($(sel), { xmin: t0, xmax: t1 + (t1 - t0) * 0.02, ymin: ymin, ymax: ymax, yfmt: opt.fmt || function (v) { return nd(v, 1) + "×"; }, xticks: timeTicks(t0, t1), H: (($(sel).clientWidth || 720) < 480 ? 210 : 230), label: title,
    layers: function (fx, fy) {
      var x0 = fx(t0), x1 = fx(t1 + (t1 - t0) * 0.02), s2 = '';
      s2 += '<rect x="' + x0 + '" y="' + fy(q.p90) + '" width="' + (x1 - x0) + '" height="' + (fy(q.p10) - fy(q.p90)) + '" fill="var(--accent)" fill-opacity=".12"/>';
      s2 += '<rect x="' + x0 + '" y="' + fy(q.p75) + '" width="' + (x1 - x0) + '" height="' + (fy(q.p25) - fy(q.p75)) + '" fill="var(--accent)" fill-opacity=".22"/>';
      s2 += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + fy(q.p50) + '" y2="' + fy(q.p50) + '" stroke="var(--muted)" stroke-width="1.6" stroke-dasharray="5 4"/>';
      s2 += '<path d="' + pathD(xs, ys, fx, fy) + '" fill="none" stroke="var(--fg)" stroke-width="1.4"/>';
      s2 += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + fy(cur) + '" y2="' + fy(cur) + '" stroke="var(--tail)" stroke-width="1" stroke-dasharray="2 3"/>';
      s2 += '<circle cx="' + fx(t1) + '" cy="' + fy(cur) + '" r="4.5" fill="var(--tail)"/>';
      return s2;
    } });
}
function renderMultHist(price, bvNow, epsNow) {
  var ser = multSeries(), msg = $("#hMsg"), body = $("#hBody");
  if (!ser || ser.length < 120) {
    body.classList.add("hidden"); msg.classList.remove("hidden");
    msg.textContent = "Sejarah ini butuh harga harian bertanggal sejak 2017 dan tab Riwayat fundamental. Tarik data dari Sheet.";
    return;
  }
  msg.classList.add("hidden"); body.classList.remove("hidden");
  var yrs = Number($("#hWin").value), tEnd = ser[ser.length - 1].t, win = yrs > 0 ? ser.filter(function (r) { return r.t >= tEnd - yrs * YR; }) : ser;
  var pb = win.map(function (r) { return r.pbv; }).sort(function (a, b) { return a - b; }), pe = win.map(function (r) { return r.per; }).sort(function (a, b) { return a - b; });
  function qs(a) { return { p10: quant(a, .1), p25: quant(a, .25), p50: quant(a, .5), p75: quant(a, .75), p90: quant(a, .9) }; }
  function rank(a, x) { var c = 0; for (var i = 0; i < a.length; i++) if (a[i] <= x) c++; return c / a.length; }
  var rr2 = win.map(function (r) { return r.rey; }).sort(function (a, b) { return a - b; }), curR = epsNow / price - latestYoy();
  var curB = price / bvNow, curE = price / epsNow, qb = qs(pb), qe = qs(pe), qr = qs(rr2), rb = rank(pb, curB), re = rank(pe, curE), rrk = rank(rr2, curR);
  var cb = 0, ce = 0, hr = 0, jj; for (jj = 0; jj < pb.length; jj++) { if (pb[jj] < curB) cb++; if (pe[jj] < curE) ce++; if (rr2[jj] > curR) hr++; }
  var since = new Date(win[0].t).getUTCFullYear();
  var D = FH.rows.filter(function (r) { var d = new Date(r.t); return d.getUTCMonth() === 11 && d.getUTCDate() === 31; }), roes = [], k;
  for (k = 1; k < D.length; k++) { if (D[k].t >= win[0].t - 366 * DAY) roes.push(D[k].eps / ((D[k].bv + D[k - 1].bv) / 2)); }
  var avgRoe = roes.length ? roes.reduce(function (a, b) { return a + b; }, 0) / roes.length : NaN, roeNow = fv("roe") / 100;
  var gLast = NaN, gBefore = NaN;
  if (D.length >= 2) gLast = D[D.length - 1].eps / D[D.length - 2].eps - 1;
  if (D.length >= 5) gBefore = Math.pow(D[D.length - 2].eps / D[D.length - 5].eps, 1 / 3) - 1;
  function tone(r) { return r < 0.15 ? "ok" : r > 0.85 ? "warn" : ""; }
  function daysTxt(c) { return c + " hari"; }
  function recentOnly(key, test) { for (var j = 0; j < win.length; j++) if (test(win[j][key]) && win[j].t < tEnd - 60 * DAY) return false; return true; }
  $("#hStats").innerHTML =
    stat("PBV hari ini", x2(curB), "Median sejak " + since + ": " + x2(qb.p50) + ". Rentang wajar " + x1(qb.p25) + " sampai " + x1(qb.p75) + ".", tone(rb)) +
    stat("Hari yang lebih murah dari hari ini", cb === 0 ? "Tidak ada" : cb <= 40 ? daysTxt(cb) : pct(rb, 0), cb === 0 ? "Hari ini di bawah semua penutupan sejak " + since + ". Penutupan terendah " + x2(pb[0]) + "." : cb <= 40 ? "Hanya " + daysTxt(cb) + " sejak " + since + " dengan PBV lebih rendah" + (recentOnly("pbv", function (v) { return v < curB; }) ? ", semuanya dalam dua bulan terakhir" : "") + ". Terendah " + x2(pb[0]) + "." : "Bagian hari sejak " + since + " dengan PBV lebih rendah. Terendah " + x2(pb[0]) + ".", tone(rb)) +
    stat("PER hari ini", x1(curE), "Median sejak " + since + ": " + x1(qe.p50) + ". Rentang wajar " + x1(qe.p25) + " sampai " + x1(qe.p75) + ".", tone(re)) +
    stat("Hari yang lebih murah dari hari ini", ce === 0 ? "Tidak ada" : ce <= 40 ? daysTxt(ce) : pct(re, 0), ce === 0 ? "Hari ini di bawah semua penutupan sejak " + since + ". Terendah " + x1(pe[0]) + "." : ce <= 40 ? "Hanya " + daysTxt(ce) + " sejak " + since + " dengan PER lebih rendah" + (recentOnly("per", function (v) { return v < curE; }) ? ", semuanya dalam dua bulan terakhir" : "") + ". Terendah " + x1(pe[0]) + "." : "Bagian hari sejak " + since + " dengan PER lebih rendah. Terendah " + x1(pe[0]) + ".", tone(re)) +
    stat("Imbal laba setelah inflasi hari ini", pct(curR, 1), "Median sejak " + since + ": " + pct(qr.p50, 1) + ". Rentang wajar " + pct(qr.p25, 1) + " sampai " + pct(qr.p75, 1) + ". Imbal laba " + pct(epsNow / price, 1) + " dikurangi inflasi " + pct(latestYoy(), 1) + ".", rrk > 0.85 ? "ok" : rrk < 0.15 ? "warn" : "") +
    stat("Hari yang memberi lebih dari hari ini", hr === 0 ? "Tidak ada" : hr <= 40 ? daysTxt(hr) : pct(1 - rrk, 0), hr === 0 ? "Imbal laba setelah inflasi hari ini di atas semua penutupan sejak " + since + "." : hr <= 40 ? "Hanya " + daysTxt(hr) + " sejak " + since + " yang memberi lebih setelah inflasi." : "Bagian hari sejak " + since + " dengan imbal laba setelah inflasi lebih tinggi.", rrk > 0.85 ? "ok" : "") +
    (isFinite(avgRoe) ? stat("ROE dulu dan sekarang", pct(avgRoe, 1) + " vs " + pct(roeNow, 1), "Rata-rata ROE akhir tahun di jendela ini, dibanding angka disetahunkan terakhir.") : "");
  drawMult("#chPBV", win, "pbv", curB, qb, "PBV " + TK.code + " dari waktu ke waktu");
  drawMult("#chPER", win, "per", curE, qe, "PER " + TK.code + " dari waktu ke waktu");
  drawMult("#chREY", win, "rey", curR, qr, "Imbal laba setelah inflasi " + TK.code, { fmt: function (v) { return nd(v * 100, 1) + "%"; }, neg: true });
  var part1 = "Dalam periode ini " + TK.code + " biasanya diperdagangkan sekitar " + x1(qb.p50) + " nilai buku dan " + nd(qe.p50, 0) + "× laba. " + x2(curB) + " dan " + x1(curE) + " hari ini berada " + (cb + ce <= 2 ? "di bawah dasar" : (cb <= 40 && ce <= 40) ? "di dasar paling bawah" : rb < 0.1 ? "dekat dasar" : rb < 0.35 ? "di bagian yang lebih murah" : rb > 0.65 ? "di bagian yang lebih mahal" : "dekat tengah") + " rentang itu: " + ((cb === 0 && ce === 0) ? "tidak ada hari dalam periode ini yang lebih murah di kedua ukuran." : (cb <= 40 && ce <= 40) ? "hanya " + daysTxt(cb) + " lebih murah di PBV dan " + daysTxt(ce) + " di PER." : "lebih murah dari ini hanya pada " + pct(rb, 0) + " hari untuk nilai buku dan " + pct(re, 0) + " untuk laba.");
  var part2 = isFinite(avgRoe) ? " Imbal hasil tidak turun banyak untuk menjelaskannya: ROE rata-rata " + pct(avgRoe, 1) + " selama tahun-tahun ini dibanding " + pct(roeNow, 1) + " sekarang." : "";
  var pi3 = D.length >= 5 ? Math.pow(cpiAt(D[D.length - 2].t) / cpiAt(D[D.length - 5].t), 1 / 3) - 1 : NaN, piL = D.length >= 2 ? cpiAt(D[D.length - 1].t) / cpiAt(D[D.length - 2].t) - 1 : NaN;
  var part3 = (isFinite(gLast) && isFinite(gBefore)) ? " Yang berubah adalah pertumbuhan. Laba per saham tumbuh sekitar " + pct(gBefore, 0) + " setahun dalam tiga tahun sebelum tahun penuh terakhir (" + pct(realOf(gBefore, pi3), 0) + " setelah inflasi), tetapi hanya " + pct(gLast, 0) + " pada tahun penuh terakhir (" + pct(realOf(gLast, piL), 0) + " setelah inflasi), dan pasar membayar lebih sedikit untuk pertumbuhan yang lebih lambat." : "";
  var part4 = " PBV dan PER tidak perlu disesuaikan inflasi, karena harga dan nilai buku sama-sama dalam rupiah tahun yang sama. Ukuran yang disesuaikan inflasi adalah imbal laba: setelah dikurangi inflasi " + pct(latestYoy(), 1) + ", imbal laba " + TK.code + " " + pct(curR, 1) + ", dibanding median " + pct(qr.p50, 1) + " sejak " + since + (rrk > 0.995 ? ", tertinggi dalam periode ini." : rrk > 0.85 ? ", di bagian atas rentangnya." : ".");
  note("#exHist2", "<p><b>Artinya.</b> " + part1 + part2 + part3 + "</p><p><b>Penyesuaian inflasi.</b>" + part4 + "</p><p><b>Yang tidak dikatakannya.</b> Kelipatan di dasar sejarahnya adalah alasan untuk bertanya, bukan putusan. Penurunan penilaian bisa permanen bila pertumbuhan sudah menetap lebih rendah, dan tahun-tahun awal punya pertumbuhan lebih tinggi dan suku bunga yang berbeda. Pakai sebagai satu tolok ukur bersama model valuasi di bawah.</p>");
  function closeAtOrBefore(t) { var i = lowerIdx(S.dates, t); return i >= 0 ? S.prices[i] : NaN; }
  var rowsH = "<thead><tr><th>Akhir tahun</th><th>Laba per saham</th><th>Nilai buku per saham</th><th>ROE</th><th>Dividen per saham</th><th>Harga penutupan</th><th>Dalam rupiah hari ini</th><th>PBV</th><th>PER</th><th>Inflasi tahun itu</th><th>Pertumbuhan EPS riil</th></tr></thead><tbody>";
  FH.rows.forEach(function (r, idx) {
    var d = new Date(r.t), isYE = d.getUTCMonth() === 11 && d.getUTCDate() === 31, cl = closeAtOrBefore(r.t), prev = FH.rows[idx - 1], prevYE = prev && isYE && new Date(prev.t).getUTCMonth() === 11, roe = prevYE ? r.eps / ((r.bv + prev.bv) / 2) : NaN, pyr = prevYE ? cpiAt(r.t) / cpiAt(prev.t) - 1 : NaN, rEps = isFinite(pyr) ? realOf(r.eps / prev.eps - 1, pyr) : NaN;
    rowsH += "<tr><td>" + (isYE ? d.getUTCFullYear() : fmtDay(r.t)) + "</td><td>" + px(r.eps) + "</td><td>" + px(r.bv) + "</td><td>" + (isFinite(roe) ? pct(roe, 1) : "–") + "</td><td>" + (isFinite(r.dps) ? px(r.dps) : "–") + "</td><td>" + (isFinite(cl) ? px(cl) : "–") + "</td><td>" + (isFinite(cl) ? px(cl * rf(r.t)) : "–") + "</td><td>" + (isFinite(cl) ? x2(cl / r.bv) : "–") + "</td><td>" + (isFinite(cl) ? x1(cl / r.eps) : "–") + "</td><td>" + (isFinite(pyr) ? pct(pyr, 1) : "–") + "</td><td class=\"" + (isFinite(rEps) ? (rEps < 0 ? "bad" : "ok") : "") + "\">" + (isFinite(rEps) ? spct(rEps, 0) : "–") + "</td></tr>";
  });
  rowsH += "<tr><td><b>Sekarang</b></td><td>" + px(epsNow) + "</td><td>" + px(bvNow) + "</td><td>" + pct(roeNow, 1) + "</td><td>" + px(fv("dps_ttm_paid")) + " (12 bln)</td><td>" + px(price) + "</td><td>" + px(price) + "</td><td><b>" + x2(curB) + "</b></td><td><b>" + x1(curE) + "</b></td><td>" + pct(latestYoy(), 1) + " (12 bln)</td><td>–</td></tr></tbody>";
  $("#hTable").innerHTML = rowsH;
  $("#hSrc").innerHTML = "Nilai buku dan laba ditetapkan di setiap akhir tahun dan laporan terakhir, lalu ditarik garis lurus di antaranya, jadi kelipatan harian akurat sampai beberapa persen. " + TK.x.fhSrc + " Inflasi adalah IHK BPS (tab IHK). Grafik memakai harga penutupan biasa: harga yang disesuaikan dividen akan membuat masa lalu tampak lebih murah dari kenyataannya.";
}
$("#hWin").addEventListener("change", function () { renderVal(); });

/* ---------- peers (per sector) ---------- */
var SECT = {
  bank: {
    all: ["BBCA", "BBRI", "BMRI", "BBNI"],   // order of the Date/Close blocks in the peers price sheet
    priceDs: "bank_peers_price", fundDs: "bank_peers_fund",
    noun: "bank besar", nounOne: "bank", period: "H1 2026",
    pIntro: " adalah bank besar Indonesia lainnya. Harga dari sheet harga harian; nilai buku, laba dan rasio dari laporan terakhir (H1 2026), jadi definisinya sedikit berbeda antarbank.",
    aggLab: "Rata-rata pembanding",
    cols: [{ k: "roe", lab: "ROE", f: "pct1" }, { k: "nim", lab: "NIM", f: "pct1" }, { k: "npl", lab: "NPL", f: "pct1" }, { k: "car", lab: "CAR", f: "pct1" }, { k: "pg", lab: "Laba H1", f: "spct1" }, { k: "lg", lab: "Kredit", f: "spct0" }],
    row: function (f) { return { roe: f.roe, nim: f.nim, npl: f.npl, car: f.car, pg: f.profit_growth_h1, lg: f.loan_growth }; },
    me: function () { return { roe: fv("roe"), nim: fv("nim"), npl: fv("npl"), car: fv("car"), pg: fv("profit_growth_h1"), lg: fv("loan_growth") }; },
    cush: { k: "car", lab: "Bantalan modal", hiGood: true, top: "bantalan paling tebal dari keempatnya", low: "bantalan paling tipis dari keempatnya", what: "memiliki rasio modal " },
    grow: { k: "lg", what: "kredit naik " },
    note: "ROE adalah angka H1 2026 disetahunkan dari masing-masing bank, dan nilai buku BMRI dan BBNI diturunkan dari kelipatan yang dipublikasikan, jadi anggap selisih satu atau dua poin sebagai gangguan.",
  },
};
function SEC() { return SECT[TK.sector || "bank"]; }
var PD = { f: {}, p: null };
function peersOf() { return SEC().all.filter(function (k) { return k !== TK.code; }); }
function pclose(tk, t) { var d = PD.p && PD.p[tk]; if (!d) return NaN; var i = lowerIdx(d.t, t); return i >= 0 ? d.c[i] : NaN; }
function avgOf(a) { var v = a.filter(isFinite); return v.length ? v.reduce(function (x, y) { return x + y; }, 0) / v.length : NaN; }
function ptsd(x, d) { if (!isFinite(x)) return "n/a"; return (x >= 0 ? "+" : "−") + nd(Math.abs(x), d === undefined ? 1 : d) + " poin"; }
function listAnd(a) { return a.join(", ").replace(/, ([^,]*)$/, " dan $1"); }
function renderPeers(price, bv, eps) {
  var me = TK.code, PE = peersOf(), SC = SEC(), AL = SC.aggLab, al = AL.toLowerCase();
  $("#pTitle").textContent = "Bagaimana " + me + " dibanding " + SC.noun + " lain?";
  $("#pIntro").textContent = listAnd(PE) + SC.pIntro;
  var B0 = SC.me(); B0.k = me; B0.name = TK.name; B0.price = price; B0.bvps = bv; B0.eps = eps; B0.dps = fv("dps_fy2025");
  var rows = [B0];
  PE.forEach(function (tk) {
    var f = PD.f[tk] || {}, pr = (PD.p && PD.p[tk] && PD.p[tk].c.length) ? PD.p[tk].c[PD.p[tk].c.length - 1] : NaN;
    var r = SC.row(f); r.k = tk; r.name = f.name || tk; r.price = pr; r.bvps = f.bvps; r.eps = f.eps_ttm; r.dps = f.dps_fy2025; rows.push(r);
  });
  rows.forEach(function (r) { r.pbv = r.price / r.bvps; r.per = r.price / r.eps; r.yld = r.dps / r.price * 100; });
  var peers = rows.slice(1), AV = {}, keys = ["pbv", "per", "yld"].concat(SC.cols.map(function (c) { return c.k; }));
  keys.forEach(function (k) { AV[k] = avgOf(peers.map(function (r) { return r[k]; })); });
  var B = rows[0], havePx = isFinite(AV.pbv) && isFinite(AV.per);
  $("#pMsg").classList.toggle("hidden", havePx);
  if (!havePx) $("#pMsg").textContent = "Harga atau fundamental pembanding belum terbaca, jadi kelipatan di bawah kosong. Tarik data dari Sheet.";
  function f1(x, s) { return isFinite(x) ? nd(x, 1) + (s || "") : "n/a"; }
  function f2(x, s) { return isFinite(x) ? nd(x, 2) + (s || "") : "n/a"; }
  function fmt(c, v) { if (!isFinite(v)) return "n/a"; if (c.f === "pct1") return nd(v, 1) + "%"; if (c.f === "pct0") return nd(v, 0) + "%"; if (c.f === "spct1") return spct(v / 100, 1); return spct(v / 100, 0); }
  function tr(r, cls) { return "<tr class=\"" + (cls || "") + "\"><td>" + (r.name ? "<b>" + r.k + "</b><br><span class=\"muted small\">" + r.name + "</span>" : r.k) + "</td><td>" + (isFinite(r.price) ? px(r.price) : "n/a") + "</td><td>" + f2(r.pbv, "×") + "</td><td>" + f1(r.per, "×") + "</td><td>" + f1(r.yld, "%") + "</td>" + SC.cols.map(function (c) { return "<td>" + fmt(c, r[c.k]) + "</td>"; }).join("") + "</tr>"; }
  var h = "<thead><tr><th>Bank</th><th>Harga</th><th>PBV</th><th>PER</th><th>Imbal dividen</th>" + SC.cols.map(function (c) { return "<th>" + c.lab + "</th>"; }).join("") + "</tr></thead><tbody>";
  h += tr(B, "sel"); peers.forEach(function (r) { h += tr(r); });
  var avr = { k: AL, price: NaN, pbv: AV.pbv, per: AV.per, yld: AV.yld }; SC.cols.forEach(function (c) { avr[c.k] = AV[c.k]; }); h += tr(avr);
  h += "<tr><td><b>" + me + " vs " + al + "</b></td><td></td><td>" + (isFinite(AV.pbv) ? x1(B.pbv / AV.pbv) : "n/a") + "</td><td>" + (isFinite(AV.per) ? x1(B.per / AV.per) : "n/a") + "</td><td>" + ptsd(B.yld - AV.yld) + "</td>" + SC.cols.map(function (c) { return "<td>" + ptsd(B[c.k] - AV[c.k], c.f === "spct0" || c.f === "pct0" ? 0 : 1) + "</td>"; }).join("") + "</tr></tbody>";
  $("#pTable").innerHTML = h;
  var prem = B.pbv / AV.pbv, premE = B.per / AV.per, pw = isFinite(prem) && prem < 1 ? "Diskon" : "Premi", CU = SC.cush, cv = B[CU.k], ca = AV[CU.k];
  $("#pStats").innerHTML =
    stat(pw + " atas nilai buku", isFinite(prem) ? x1(prem) : "n/a", me + " " + f2(B.pbv, "×") + " dibanding " + al + " " + f2(AV.pbv, "×") + ".") +
    stat(pw + " atas laba", isFinite(premE) ? x1(premE) : "n/a", me + " " + f1(B.per, "×") + " dibanding " + f1(AV.per, "×") + ".") +
    stat("Return on equity", ptsd(B.roe - AV.roe), me + " " + f1(B.roe, "%") + " dibanding " + f1(AV.roe, "%") + " untuk pembanding.", B.roe > AV.roe ? "ok" : "warn") +
    stat("Pertumbuhan laba, " + SC.period, ptsd(B.pg - AV.pg, 1), me + " " + spct(B.pg / 100, 1) + " dibanding " + spct(AV.pg / 100, 1) + " untuk pembanding.", B.pg < AV.pg - 5 ? "bad" : "") +
    stat("Imbal hasil dividen", ptsd(B.yld - AV.yld), me + " " + f1(B.yld, "%") + " dibanding " + f1(AV.yld, "%") + ", dari dividen FY2025 masing-masing bank.") +
    stat(CU.lab, ptsd(cv - ca, 1), me + " " + f1(cv, "%") + " dibanding " + f1(ca, "%") + ".", (CU.hiGood ? cv > ca : cv < ca) ? "ok" : "");
  var roeTop = peers.every(function (r) { return !isFinite(r.roe) || B.roe > r.roe; }), roeLow = peers.every(function (r) { return !isFinite(r.roe) || B.roe < r.roe; });
  var cTop = peers.every(function (r) { return !isFinite(r[CU.k]) || cv > r[CU.k]; }), cLow = peers.every(function (r) { return !isFinite(r[CU.k]) || cv < r[CU.k]; });
  var fast = peers.every(function (r) { return B.pg > r.pg; }), slow = peers.every(function (r) { return B.pg < r.pg; });
  var morePay = PE.filter(function (k) { return (PD.f[k] || {}).payout_fy2025 > fv("payout_fy2025"); }).length, G = SC.grow;
  note("#exPeers", "<p><b>Dalam bahasa sederhana.</b> " + (havePx ? me + " dihargai sekitar " + x1(prem) + " rata-rata pembanding atas nilai buku dan " + x1(premE) + " atas laba. " : "") + "ROE-nya " + f1(B.roe, "%") + " (" + (roeTop ? "tertinggi dari keempatnya" : roeLow ? "terendah dari keempatnya" : "di tengah keempatnya") + ") dan " + CU.what + f1(cv, "%") + " (" + (cTop ? CU.top : cLow ? CU.low : "di tengah keempatnya") + "). Dari sisi pertumbuhan, laba H1 naik " + spct(B.pg / 100, 1) + " dibanding rata-rata pembanding " + spct(AV.pg / 100, 0) + " (" + (fast ? "tercepat dari keempatnya" : slow ? "terlambat dari keempatnya" : "di tengah keempatnya") + "), dengan " + G.what + spct(B[G.k] / 100, 0) + " dibanding " + spct(AV[G.k] / 100, 0) + ". Imbal hasil dividen adalah campuran dividen dan harga, jadi imbal yang lebih tinggi di sini sebagian besar berarti harga yang lebih rendah terhadap laba" + (morePay > 0 ? ", dan " + morePay + " dari 3 pembanding juga membagikan porsi laba lebih besar dari " + me : "") + ".</p>" +
    "<p><b>Cara memakainya.</b> Selisih kelipatan hanya wajar bila selisih kualitas di baliknya bertahan. Bandingkan selisih PBV dengan selisih ROE dan pertumbuhan: bank yang menghasilkan lebih banyak dan tumbuh lebih cepat dari pembandingnya tetapi lebih murah berarti salah harga, atau membawa risiko yang tidak terlihat di tabel ini." + TK.x.peerTail(rows, B) + "</p><p class=\"small muted\">" + SC.note + "</p>");
  $("#pSrc").innerHTML = "Fundamental pembanding dari tab Fundamental di sheet harga bank pembanding; harga dari sheet yang sama." + (PD.url ? " <a href=\"" + PD.url + "\" target=\"_blank\" rel=\"noopener\">Buka sheet pembanding</a>" : "");
  renderMoves();
}
/* Identity colours: the stock in focus is amber (as in the ticker switch), peers
   get neutral hues in fixed order. Green/red are kept for good/bad only. */
var PCOL = {}, PDASH = {};
function setPeerColours() {
  PCOL = {}; PDASH = {}; PCOL[TK.code] = "var(--t-amber)";
  peersOf().forEach(function (k, i) { PCOL[k] = ["var(--accent)", "var(--peer-2)", "var(--peer-3)"][i % 3]; if (i === 2) PDASH[k] = 1; });
}
function renderMoves() {
  setPeerColours();
  var me = TK.code, PE = peersOf(), SC = SEC(), ch = $("#chPeers"), ok = PD.p && S.prices.length > 120;
  $("#pShockBox").classList.toggle("hidden", !ok);
  if (!ok) { ch.innerHTML = ""; $("#pLegend").innerHTML = ""; note("#exMove", "<p class=\"muted\">Harga pembanding belum termuat.</p>"); return; }
  var n = S.prices.length, w = $("#pWin").value, i0 = w === "ytd" ? lowerIdx(S.dates, Date.UTC(2025, 11, 31)) : n - 1 - Math.round(Number(w) * TD);
  i0 = Math.max(0, Math.min(n - 30, i0));
  var t0 = S.dates[i0], t1 = S.dates[n - 1], names = [me].concat(PE), ser = {}, i, lo = Infinity, hi = -Infinity;
  names.forEach(function (k) {
    var base = k === me ? S.prices[i0] : pclose(k, t0), xs = [], ys = [];
    if (!isFinite(base)) return;
    if (k !== me) { var d0 = PD.p[k]; if (!d0 || !d0.t.length || d0.t[0] > t0 + 8 * DAY) return; }
    for (i = i0; i < n; i++) { var v = k === me ? S.prices[i] : pclose(k, S.dates[i]); if (isFinite(v)) { xs.push(S.dates[i]); ys.push(v / base * 100); lo = Math.min(lo, v / base * 100); hi = Math.max(hi, v / base * 100); } }
    ser[k] = { x: xs, y: ys };
  });
  var pad = (hi - lo) * 0.06;
  chart(ch, { xmin: t0, xmax: t1, ymin: Math.max(0, lo - pad), ymax: hi + pad, yfmt: function (v) { return v.toFixed(0); }, xticks: timeTicks(t0, t1).filter(function (_, q) { return (ch.clientWidth || 720) < 480 ? q % 3 === 0 : true; }), R: 92, H: (ch.clientWidth || 720) < 480 ? 250 : 290, label: "Harga empat " + SC.noun + " disetel ke 100",
    layers: function (fx, fy, k) {
      var s2 = '<line x1="' + k.x0 + '" x2="' + k.x1 + '" y1="' + fy(100) + '" y2="' + fy(100) + '" stroke="var(--fg)" stroke-opacity=".3" stroke-dasharray="4 4"/>';
      PE.concat([me]).forEach(function (nm) { var d = ser[nm]; if (d) s2 += '<path d="' + pathD(d.x, d.y, fx, fy) + '" fill="none" stroke="' + PCOL[nm] + '" stroke-width="' + (nm === me ? 2.6 : 1.5) + '"' + (PDASH[nm] ? ' stroke-dasharray="5 3"' : '') + '/>'; });
      return s2;
    },
    overlay: function (fx, fy, k) {
      var lab = names.filter(function (nm) { return ser[nm]; }).map(function (nm) { var d = ser[nm], v = d.y[d.y.length - 1]; return { nm: nm, v: v, y: fy(v) }; }).sort(function (a, b) { return a.y - b.y; });
      for (var j = 1; j < lab.length; j++) { if (lab[j].y - lab[j - 1].y < 13) lab[j].y = lab[j - 1].y + 13; }
      return lab.map(function (l) { return '<text x="' + (k.x1 + 6) + '" y="' + (l.y + 4) + '" style="fill:' + PCOL[l.nm] + ';font-size:11.5px;font-weight:' + (l.nm === me ? 700 : 600) + ';font-family:var(--sans)">' + l.nm + ' ' + spct(l.v / 100 - 1, 0) + '</text>'; }).join("");
    } });
  $("#pLegend").innerHTML = names.filter(function (nm) { return ser[nm]; }).map(function (nm) { return '<span><i style="background:' + PCOL[nm] + ';height:' + (nm === me ? 4 : 2) + 'px;vertical-align:4px"></i>' + nm + '</span>'; }).join("") + "<span>Garis putus-putus: level awal</span>";
  var fin = {}; names.forEach(function (k) { if (ser[k]) fin[k] = ser[k].y[ser[k].y.length - 1] / 100 - 1; });
  var pavg = avgOf(PE.map(function (k) { return fin[k]; }).filter(isFinite));
  note("#exMove", "<p><b>Yang terlihat.</b> Sejak " + fmtDay(t0) + ", " + me + " " + spct(fin[me], 0) + " sementara pembanding " + PE.map(function (k) { return isFinite(fin[k]) ? k + " " + spct(fin[k], 0) : ""; }).filter(Boolean).join(", ") + ". " + (fin[me] < pavg - 0.03 ? "Jadi seluruh sektor bergerak, tetapi " + me + " lebih buruk dari pesaingnya. " : fin[me] > pavg + 0.03 ? me + " lebih baik dari pesaingnya. " : me + " bergerak kira-kira sejalan dengan pesaingnya. ") + (pavg < -0.1 ? "Gerak seluas ini menunjuk ke sesuatu yang memengaruhi seluruh sektor perbankan, bukan satu perusahaan." : "") + "</p>");
  var lo2 = Math.max(1, n - 60), wi = lo2, wr = 0;
  for (i = lo2; i < n; i++) { var r = S.prices[i] / S.prices[i - 1] - 1; if (r < wr) { wr = r; wi = i; } }
  if (wr > -0.07) { $("#pShockBox").classList.add("hidden"); return; }
  var tS = S.dates[wi], tP = S.dates[wi - 1], tL = S.dates[n - 1], rowD = {}, rowS = {}, rowB = {}, lowV = Infinity;
  rowD[me] = wr; rowS[me] = S.prices[n - 1] / S.prices[wi - 1] - 1;
  for (i = wi; i < n; i++) lowV = Math.min(lowV, S.prices[i]); rowB[me] = S.prices[n - 1] / lowV - 1;
  PE.forEach(function (k) {
    rowD[k] = pclose(k, tS) / pclose(k, tP) - 1; rowS[k] = pclose(k, tL) / pclose(k, tP) - 1;
    var mn = Infinity, d = PD.p[k], ii; for (ii = 0; ii < d.t.length; ii++) if (d.t[ii] >= tS) mn = Math.min(mn, d.c[ii]);
    rowB[k] = pclose(k, tL) / mn - 1;
  });
  $("#pShockTitle").textContent = "Hari paling tajam belakangan ini: " + fmtDay(tS);
  function line(lbl, o) { return "<tr><td>" + lbl + "</td>" + names.map(function (k) { var v = o[k]; return "<td class=\"" + (isFinite(v) ? (v < 0 ? "bad" : "ok") : "") + "\">" + (isFinite(v) ? spct(v, 1) : "n/a") + "</td>"; }).join("") + "</tr>"; }
  $("#pShock").innerHTML = "<thead><tr><th></th>" + names.map(function (k) { return "<th>" + k + "</th>"; }).join("") + "</tr></thead><tbody>" + line("Hari itu", rowD) + line("Sejak sehari sebelumnya sampai penutupan terakhir", rowS) + line("Pantulan dari penutupan terendah sejak itu", rowB) + "</tbody>";
  var pd = PE.map(function (k) { return rowD[k]; }).filter(isFinite), pb = PE.map(function (k) { return rowB[k]; }).filter(isFinite), wide = pd.length && pd.every(function (v) { return v < wr * 0.6; }), lagging = isFinite(rowB[me]) && pb.every(function (v) { return v > rowB[me] + 0.03; }), leading = isFinite(rowB[me]) && pb.every(function (v) { return v < rowB[me] - 0.03; });
  note("#exMove", $("#exMove").innerHTML + "<p><b>Hari paling tajam.</b> Pada " + fmtDay(tS) + " " + me + " turun " + pct(-wr, 1) + ". " + (wide ? "Ketiga pembanding turun " + pct(-Math.max.apply(null, pd), 0) + " sampai " + pct(-Math.min.apply(null, pd), 0) + " di hari yang sama, jadi ini guncangan sektor atau pasar, bukan khusus " + me + ". " : "Pembanding turun jauh lebih sedikit hari itu, jadi tampaknya khusus " + me + ". ") + (lagging ? "Yang membedakan " + me + " adalah pemulihannya: naik " + pct(rowB[me], 0) + " dari titik terendahnya, sementara pembanding naik " + pct(Math.min.apply(null, pb), 0) + " sampai " + pct(Math.max.apply(null, pb), 0) + ". Ketertinggalan itulah pertanyaan yang perlu dikejar: mengapa uang kembali ke " + listAnd(PE) + " lebih cepat daripada ke " + me + "?" : leading ? "Yang membedakan " + me + " adalah pemulihannya: naik " + pct(rowB[me], 0) + " dari titik terendah, di depan pembanding yang " + pct(Math.min.apply(null, pb), 0) + " sampai " + pct(Math.max.apply(null, pb), 0) + "." : "Pantulan " + me + " sejak itu sejalan dengan pembanding.") + "</p>");
}
$("#pWin").addEventListener("change", renderMoves);

/* ---------- foreign flows ---------- */
var FL = { rows: [], note: "" };
function mkFlowRows(arr) {
  return arr.map(function (r) {
    var n = (r[3] === "" || r[3] === undefined) ? NaN : numOf(r[3]);
    return { t0: toTime(r[0]), t1: toTime(r[1]), kind: String(r[2] || "").trim().replace(/^(bbca|bmri)_/, "stk_"), net: n, basis: r[4] || "", quality: r[5] || "", source: r[6] || "", note: r[7] || "" };
  }).filter(function (r) { return isFinite(r.t0) && isFinite(r.t1) && r.kind; });
}
/* Rp miliar in, "Rp 1,2 T" or "Rp 450 M" out */
function flowTxt(bn, signed) {
  if (!isFinite(bn)) return "n/a";
  var a = Math.abs(bn), t = a >= 1000 ? nd(a / 1000, a >= 10000 ? 1 : 2) + " T" : nd(a, a >= 100 ? 0 : 1) + " M";
  return (signed ? (bn < 0 ? "−" : bn > 0 ? "+" : "") : (bn < 0 ? "−" : "")) + "Rp " + t;
}
function flowAxis(v) { var a = Math.abs(v); return (v < 0 ? "−" : "") + (a >= 1000 ? nd(a / 1000, 1) + "T" : Math.round(a)); }
function fkind(k) { return FL.rows.filter(function (r) { return r.kind === k; }).sort(function (a, b) { return a.t1 - b.t1; }); }
function pxOK() { return S.hasDates && !S.sample && S.prices.length > 30; }
function sessionsIn(t0, t1) {
  var out = [], i;
  for (i = 0; i < S.dates.length; i++) if (S.dates[i] >= t0 && S.dates[i] <= t1) out.push(S.dates[i]);
  if (out.length) return out;
  for (var t = t0; t <= t1; t += DAY) { var wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) out.push(t); }
  return out.length ? out : [t0];
}
function dayList() {
  var out = [];
  fkind("stk_day").forEach(function (r) { var ss = sessionsIn(r.t0, r.t1); ss.forEach(function (t) { out.push({ t: t, v: r.net / ss.length, derived: r.quality === "derived", span: ss.length, row: r }); }); });
  return out.sort(function (a, b) { return a.t - b.t; });
}
function closeAt(t) { var i = lowerIdx(S.dates, t); return i >= 0 ? S.prices[i] : NaN; }
function weekRet(r) { return pxOK() ? closeAt(r.t1) / closeAt(r.t0 - DAY) - 1 : NaN; }
function consecutive(a, b) { return b.t1 - a.t1 <= 9 * DAY && b.t1 - a.t1 >= 5 * DAY; }
function isMsci(e) { return /MSCI|konsultasi|consult/i.test(e.note); }
var BASIS = { unspecified: "tidak disebut", regular: "pasar reguler", all: "semua pasar" }, QUAL = { reported: "dilaporkan", derived: "turunan" };

function flowSignals() {
  var days = dayList(), wk = fkind("stk_week"), mk = fkind("mkt_week"), out = [], hasPx = pxOK(), me = TK.code;
  if (days.length >= 3) {
    var last = days[days.length - 1], worst = Math.min.apply(null, days.map(function (d) { return d.v; })), ratio = last.v >= 0 ? 0 : last.v / worst;
    out.push({ short: "penjualan harian " + me, name: "Hari terakhir vs hari terburuk", reading: "Hari terakhir " + flowTxt(last.v, true) + " (" + fmtDay(last.t) + ") dibanding hari terburuk " + flowTxt(worst, true) + (last.v >= 0 ? ": beli bersih." : ": " + pct(ratio, 0) + " dari puncaknya."), status: last.v >= 0 || ratio <= 0.25 ? "ok" : ratio <= 0.6 ? "warn" : "bad", why: "Penjualan yang menyusut ke sebagian kecil puncaknya adalah wujud gelombang yang memudar. Di bawah seperempat puncak dihitung memudar." });
    var last5 = days.slice(-5), pos = last5.filter(function (d) { return d.v > 0; }).length;
    out.push({ short: "hari beli bersih", name: "Hari beli bersih dari lima terakhir", reading: pos + " dari " + last5.length + " hari terakhir mencatat beli bersih.", status: pos >= 3 ? "ok" : pos >= 1 ? "warn" : "bad", why: "Pembalikan butuh pembeli yang datang lebih dari satu hari. Satu hari beli bersih hanya kedipan, tiga dari lima adalah pergeseran." });
  }
  if (wk.length >= 2 && consecutive(wk[wk.length - 2], wk[wk.length - 1])) {
    var w1 = wk[wk.length - 1], w0 = wk[wk.length - 2], st = w1.net >= 0 ? "ok" : (w0.net < 0 && w1.net > w0.net * 0.75) ? "ok" : (w0.net >= 0 || w1.net < w0.net * 1.15) ? "bad" : "warn";
    out.push({ short: "penjualan mingguan", name: "Minggu ini vs minggu lalu", reading: "Minggu sampai " + fmtDay(w1.t1) + ": " + flowTxt(w1.net, true) + ", dibanding " + flowTxt(w0.net, true) + " minggu sebelumnya" + (w0.net < 0 && w1.net < 0 ? " (penjualan " + (w1.net < w0.net ? "naik " : "turun ") + pct(Math.abs(w1.net / w0.net - 1), 0) + ")." : "."), status: st, why: "Total mingguan meredam gangguan harian. Penjualan yang masih membesar dari minggu ke minggu belum mencapai puncak." });
  }
  if (hasPx && wk.length >= 2 && consecutive(wk[wk.length - 2], wk[wk.length - 1]) && wk[wk.length - 1].net < 0 && wk[wk.length - 2].net < 0) {
    var a1 = wk[wk.length - 1], a0 = wk[wk.length - 2], r1 = weekRet(a1), r0 = weekRet(a0), i1 = r1 / (-a1.net / 1000), i0 = r0 / (-a0.net / 1000), rel = Math.abs(i1) / Math.max(1e-9, Math.abs(i0));
    out.push({ short: "daya serap harga", name: "Gerak harga per Rp 1 T penjualan", reading: "Minggu lalu harga bergerak " + spct(r1, 1) + " atas penjualan " + flowTxt(a1.net) + " (" + spct(i1, 1) + " per Rp 1 T). Minggu sebelumnya " + spct(r0, 1) + " (" + spct(i0, 1) + " per Rp 1 T).", status: (r1 >= 0 || rel <= 0.5) ? "ok" : rel <= 1.5 ? "warn" : "bad", why: "Bila penjualan yang sama kini menggerakkan harga jauh lebih sedikit, pembeli lain menyerapnya. Begitulah tekanan jual habis." });
  }
  if (mk.length >= 2 && consecutive(mk[mk.length - 2], mk[mk.length - 1])) {
    var m1 = mk[mk.length - 1], m0 = mk[mk.length - 2], st5 = m1.net >= 0 ? "ok" : (m0.net < 0 && m1.net > m0.net * 0.75) ? "ok" : (m0.net >= 0 || m1.net < m0.net * 1.15) ? "bad" : "warn";
    out.push({ short: "penjualan seluruh pasar", name: "Arus asing seluruh pasar", reading: "Minggu sampai " + fmtDay(m1.t1) + ": " + flowTxt(m1.net, true) + " di seluruh pasar, dibanding " + flowTxt(m0.net, true) + " minggu sebelumnya.", status: st5, why: TK.x.mktWhy });
  }
  if (hasPx) {
    var n = S.prices.length, w0i = Math.max(0, n - 20), lowV = Infinity, lowI = w0i, j;
    for (j = w0i; j < n; j++) if (S.prices[j] < lowV) { lowV = S.prices[j]; lowI = j; }
    var above = S.prices[n - 1] / lowV - 1, since = n - 1 - lowI;
    out.push({ short: "harga bertahan di atas titik terendah", name: "Harga vs titik terendah terbaru", reading: "Penutupan terakhir " + px(S.prices[n - 1]) + " berada " + pct(above, 1) + " di atas titik terendah 20 sesi terakhir (" + px(lowV) + " pada " + fmtDay(S.dates[lowI]) + ", " + since + " sesi lalu).", status: (above >= 0.02 && since >= 3) ? "ok" : since <= 1 ? "bad" : "warn", why: "Penjualan yang tidak lagi mendorong harga ke titik terendah baru adalah tanda klasik penjual kehabisan barang." });
  }
  return { list: out, score: out.reduce(function (a, o) { return a + (o.status === "ok" ? 1 : o.status === "bad" ? -1 : 0); }, 0) };
}
function cumulativeSeries() {
  var days = dayList(); if (!days.length) return null;
  var ev = fkind("event").filter(function (e) { return isMsci(e) && e.t0 <= days[days.length - 1].t; }).sort(function (a, b) { return a.t0 - b.t0; })[0];
  var origin = ev ? ev.t0 : days[0].t, sel = days.filter(function (d) { return d.t >= origin; }), cum = 0, xs = [], ys = [];
  if (!sel.length) return null;
  xs.push(sel[0].t - DAY); ys.push(0);
  sel.forEach(function (d) { cum += d.v; xs.push(d.t); ys.push(cum); });
  return { x: xs, y: ys, days: sel, origin: origin, total: cum, derived: sel.some(function (d) { return d.derived; }) };
}
function renderFlows() {
  if (!S.prices.length) return;
  var me = TK.code, hasPx = pxOK(), sig = flowSignals(), days = dayList(), cs = cumulativeSeries(), wk = fkind("stk_week"), mk = fkind("mkt_week"), n = S.prices.length;
  var oks = sig.list.filter(function (o) { return o.status === "ok"; }), bads = sig.list.filter(function (o) { return o.status === "bad"; }), sc = sig.score;
  function join(a) { return listAnd(a.map(function (o) { return o.short; })); }
  $("#fVerdict").textContent = sig.list.length < 4 ? "Angka arus " + me + " terlalu sedikit untuk sebuah putusan. Tanda-tanda seluruh pasar " + (sc > 0 ? "mengarah ke pelonggaran." : sc < 0 ? "menunjukkan penjualan masih membesar." : "bercampur.") : sc >= 3 ? "Penjualan tampaknya mulai habis." : sc <= -2 ? "Tekanan jual masih membesar." : "Bercampur: " + (oks.length ? join(oks) + " mengarah ke pelonggaran" : "tidak ada yang jelas mengarah ke pelonggaran") + (bads.length ? ", tetapi " + join(bads) + " menunjukkan tekanan masih membesar." : ".");
  $("#fSub").textContent = sig.list.length ? "Skor " + (sc > 0 ? "+" : "") + sc + " dari " + sig.list.length + " uji (" + oks.length + " hijau, " + bads.length + " merah, " + (sig.list.length - oks.length - bads.length) + " kuning). Puncak penjualan baru pasti jika dilihat ke belakang, jadi pertanyaan yang berguna adalah berapa banyak uji yang sudah berbalik, dan apakah yang merah menyusul." : "Baris arus belum cukup untuk menjalankan uji.";
  var cards = "";
  if (cs && cs.days.length >= 4) {
    var a3 = avgOf(cs.days.slice(0, 3).map(function (d) { return d.v; })), b3 = avgOf(cs.days.slice(-3).map(function (d) { return d.v; }));
    cards += stat("Arus asing bersih sejak pengumuman", flowTxt(cs.total, true), "Selama " + cs.days.length + " sesi sejak " + fmtDay(cs.origin) + ". Rata-rata harian berubah dari " + flowTxt(a3) + " di tiga hari pertama menjadi " + flowTxt(b3) + " di tiga hari terakhir.", cs.total < 0 ? "bad" : "ok");
  }
  if (days.length) { var L = days[days.length - 1], W = Math.min.apply(null, days.map(function (d) { return d.v; })); cards += stat("Hari terakhir", flowTxt(L.v, true), fmtDay(L.t) + (L.v < 0 ? ". Itu " + pct(L.v / W, 0) + " dari hari terburuk (" + flowTxt(W, true) + ")." : ". Beli bersih pertama baru kedipan, belum pembalikan."), L.v < 0 ? (L.v / W <= 0.25 ? "warn" : "bad") : "ok"); }
  if (wk.length >= 2) { var q1 = wk[wk.length - 1], q0 = wk[wk.length - 2]; cards += stat("Minggu terakhir", flowTxt(q1.net, true), "Minggu sampai " + fmtDay(q1.t1) + ", dibanding " + flowTxt(q0.net, true) + (consecutive(q0, q1) ? " minggu sebelumnya." : " di minggu terlapor sebelumnya (sampai " + fmtDay(q0.t1) + ")."), q1.net < q0.net ? "bad" : "ok"); }
  if (mk.length >= 2) { var z1 = mk[mk.length - 1], z0 = mk[mk.length - 2]; cards += stat("Seluruh pasar, minggu terakhir", flowTxt(z1.net, true), "Arus asing di semua saham, minggu sampai " + fmtDay(z1.t1) + ", dibanding " + flowTxt(z0.net, true) + " minggu sebelumnya.", z1.net < z0.net ? "bad" : "ok"); }
  var ytd = fkind("mkt_ytd").slice(-1)[0]; if (ytd) cards += stat("Jual asing tahun ini, seluruh pasar", flowTxt(ytd.net, true), "Sejak 1 Jan sampai " + fmtDay(ytd.t1) + " (basis " + (BASIS[ytd.basis] || ytd.basis) + ").", "warn");
  if (hasPx) { var lw = Infinity, jj; for (jj = Math.max(0, n - 20); jj < n; jj++) lw = Math.min(lw, S.prices[jj]); cards += stat("Harga di atas titik terendah 20 sesi", spct(S.prices[n - 1] / lw - 1, 1), "Penutupan terakhir " + px(S.prices[n - 1]) + " dibanding titik terendah " + px(lw) + ".", S.prices[n - 1] / lw - 1 >= 0.02 ? "ok" : "warn"); }
  $("#fStats").innerHTML = cards;
  var lab = { ok: "Melonggar", warn: "Belum jelas", bad: "Membesar" };
  $("#fScore").innerHTML = "<thead><tr><th>Uji</th><th style=\"text-align:left\">Kata data</th><th style=\"text-align:left\">Bacaan</th></tr></thead><tbody>" + sig.list.map(function (o) { return "<tr><td><b>" + o.name + "</b><br><span class=\"muted small\">" + o.why + "</span></td><td style=\"text-align:left\">" + o.reading + "</td><td class=\"" + o.status + "\" style=\"text-align:left;white-space:nowrap\">● " + lab[o.status] + "</td></tr>"; }).join("") + "</tbody>";
  note("#exScore", "<p><b>Cara membaca.</b> " + (sc >= 3 ? "Sebagian besar uji sudah berbalik. Begitulah wujud aksi jual yang mulai habis, tetapi tunggu uji merah menyusul sebelum menganggapnya selesai." : sc <= -2 ? "Sebagian besar uji masih merah, jadi penjualan belum tuntas." : "Uji-ujinya tidak sepakat, hal yang lazim di dekat dan sebelum titik balik. Angka harian bisa membaik lebih dulu, lalu angka mingguan dan seluruh pasar menyusul, jadi perhatikan apakah uji merah bergeser ke kuning dalam beberapa hari ke depan.") + TK.x.flowRole + "</p>");
  drawFD(days, hasPx); drawFC(cs); drawFW(wk, hasPx);
  var wkAll = {};
  wk.concat(mk).forEach(function (r) { var key = r.t1; wkAll[key] = wkAll[key] || { t0: r.t0, t1: r.t1 }; if (r.kind === "stk_week") wkAll[key].b = r; else wkAll[key].m = r; });
  var keys = Object.keys(wkAll).map(Number).sort(function (a, b) { return a - b; });
  $("#fMkt").innerHTML = "<thead><tr><th>Minggu</th><th>Asing bersih " + me + "</th><th>Harga " + me + " minggu itu</th><th>Asing bersih seluruh pasar</th></tr></thead><tbody>" + keys.map(function (k) { var r = wkAll[k], pr = hasPx ? weekRet({ t0: r.t0, t1: r.t1 }) : NaN; return "<tr><td>" + fmtDay(r.t0) + " sampai " + fmtDay(r.t1) + "</td><td class=\"" + (r.b ? (r.b.net < 0 ? "bad" : "ok") : "") + "\">" + (r.b ? flowTxt(r.b.net, true) : "–") + "</td><td>" + (isFinite(pr) ? spct(pr, 1) : "–") + "</td><td class=\"" + (r.m ? (r.m.net < 0 ? "bad" : "ok") : "") + "\">" + (r.m ? flowTxt(r.m.net, true) : "–") + "</td></tr>"; }).join("") + "</tbody>";
  note("#exFW", "<p><b>Yang ditunjukkan.</b> " + (wk.length >= 2 ? "Arus mingguan " + me + " bergerak dari " + (wk.length >= 3 ? flowTxt(wk[wk.length - 3].net, true) + " dan " : "") + flowTxt(wk[wk.length - 2].net, true) + " ke " + flowTxt(wk[wk.length - 1].net, true) + " di minggu terakhir. " : "") + "Beberapa minggu tidak punya angka (celah di grafik), jadi perbandingan hanya dibuat antarminggu yang berurutan. Kolom seluruh pasar memakai basis “semua pasar”, sedangkan " + me + " basisnya campuran, jadi bandingkan arahnya, bukan besarnya.</p>");
  var preW = cs ? wk.filter(function (r) { return r.t1 < cs.origin && r.net < 0; }) : [], preAvg = preW.length ? preW.reduce(function (a, r) { return a + r.net; }, 0) / (preW.length * 5) : NaN;
  var l3avg = cs && cs.days.length >= 3 ? avgOf(cs.days.slice(-3).map(function (d) { return d.v; })) : NaN, f3avg = cs && cs.days.length >= 3 ? avgOf(cs.days.slice(0, 3).map(function (d) { return d.v; })) : NaN;
  if (days.length >= 3) {
    var ln = days.filter(function (d) { return d.t >= (cs ? cs.origin : 0); }), sells = ln.filter(function (d) { return d.v < 0; }).length, buys = ln.filter(function (d) { return d.v > 0; });
    note("#exFD", "<p><b>Yang ditunjukkan.</b> Sejak pengumuman, " + me + " mencatat jual bersih asing pada " + sells + " dari " + ln.length + " sesi yang ada angkanya" + (buys.length ? ", dengan beli bersih pertama pada " + fmtDay(buys[0].t) + "." : ".") + " " + (isFinite(l3avg) && isFinite(f3avg) ? (l3avg > f3avg ? "Penjualan paling deras di hari-hari pertama setelah pengumuman dan rata-ratanya lebih kecil sejak itu, tetapi belum berhenti. " : "Rata-rata penjualan belum mereda sejak hari-hari pertama setelah pengumuman. ") : "") + (isFinite(preAvg) && isFinite(l3avg) ? "Tiga hari terakhir masih rata-rata " + flowTxt(l3avg) + " sehari, dibanding " + flowTxt(preAvg) + " sehari di minggu-minggu jual bersih sebelum pengumuman." : "") + "</p><p class=\"muted small\">Garis tipis abu-abu berarti tidak ada angka hari itu; batang pucat bergaris putus adalah angka turunan.</p>");
  } else note("#exFD", "<p class=\"muted\">Hampir tidak ada angka arus asing harian " + me + " yang dilaporkan media, jadi grafik ini nyaris kosong. Tabel mingguan dan angka seluruh pasar di bawah memuat lebih banyak informasi.</p>");
  note("#exFC", "<p><b>Yang ditunjukkan.</b> " + (cs ? "Total berjalan " + flowTxt(cs.total, true) + " sejak " + fmtDay(cs.origin) + ". " + (cs.derived ? "Sebagian titik harian adalah turunan, jadi jalur di antaranya perkiraan, tetapi titik akhirnya sejalan dengan total mingguan yang dilaporkan. " : "") + "Lihat kemiringannya, bukan levelnya: bila terus menajam, tekanan membesar; bila mendatar, penjualan sudah berhenti. Setiap saham yang dijual punya pembeli, jadi investor domestik (reksa dana lokal, ritel, dan pembelian kembali bila ada) membeli kira-kira " + flowTxt(-cs.total) + " yang dijual asing." : "Belum ada baris harian setelah pengumuman.") + "</p>");
  var wl = wk.length ? wk[wk.length - 1] : null, ml = mk.length ? mk[mk.length - 1] : null, lowN = null, lw2 = Infinity, k2;
  if (hasPx) for (k2 = Math.max(0, n - 20); k2 < n; k2++) if (S.prices[k2] < lw2) { lw2 = S.prices[k2]; lowN = S.dates[k2]; }
  var nbN = (cs ? cs.days : days).filter(function (d) { return d.v > 0; }).length, nbTxt = nbN === 0 ? "Sejauh ini belum ada hari beli bersih sejak pengumuman." : nbN === 1 ? "Sejauh ini baru ada satu hari beli bersih." : "Sejauh ini ada " + nbN + " hari beli bersih.";
  $("#fConfirm").innerHTML =
    "<li><b>Pembeli datang lebih dari satu hari.</b> Dua hari beli bersih berturut-turut atau lebih, atau tiga dari lima. " + nbTxt + "</li>" +
    (wl ? "<li><b>Total mingguan lebih kecil dari sebelumnya.</b> Minggu terakhir " + flowTxt(wl.net, true) + (wk.length > 1 ? ", dibanding " + flowTxt(wk[wk.length - 2].net, true) + " sebelumnya" : "") + ". Minggu yang jelas lebih kecil, atau mendekati nol, akan membalik uji ini.</li>" : "") +
    (ml ? "<li><b>Seluruh pasar juga berhenti berdarah.</b> Arus asing seluruh pasar " + flowTxt(ml.net, true) + " di minggu terakhir. " + me + " jarang berbalik selama angka itu masih membesar.</li>" : "") +
    (hasPx && lowN ? "<li><b>Titik terendah bertahan.</b> Hari-hari jual yang tidak lagi mendorong harga di bawah " + px(lw2) + " (titik terendah pada " + fmtDay(lowN) + ") menandakan pasokan mengering.</li>" : "") +
    "<li><b>Pembeli domestik terus menyerap.</b> Kerusakan harga per rupiah penjualan asing yang makin kecil adalah uji yang paling langsung mengukur penyerapan.</li>";
  var now = nowT();
  $("#fEvents").innerHTML = fkind("event").sort(function (a, b) { return a.t0 - b.t0; }).map(function (e) { return "<li><b>" + fmtDay(e.t0) + (e.t0 > now ? " (akan datang)" : "") + ".</b> " + e.note + (e.source ? " <span class=\"muted small\">Sumber: " + e.source + ".</span>" : "") + "</li>"; }).join("") +
    "<li><b>Baca strukturnya, bukan hanya hari-harinya.</b> MSCI menyatakan akan melanjutkan reklasifikasi kecuali konsultasi menunjukkan bukti jelas perbaikan material dalam tata kelola dan fungsi pasar. Itu menjadi beban bagi pemegang asing selama berbulan-bulan, jadi satu hari arus yang baik tidak menghapusnya.</li>";
  var kmap = { stk_day: me + " harian", stk_week: me + " mingguan", mkt_week: "Pasar mingguan", mkt_day: "Pasar harian", mkt_ytd: "Pasar sejak awal tahun", event: "Peristiwa" };
  $("#fData").innerHTML = "<thead><tr><th>Periode</th><th>Jenis</th><th>Arus bersih</th><th>Basis</th><th>Kualitas</th><th>Sumber</th><th>Catatan</th></tr></thead><tbody>" + FL.rows.slice().sort(function (a, b) { return a.t0 - b.t0 || a.kind.localeCompare(b.kind); }).map(function (r) { return "<tr><td style=\"white-space:nowrap\">" + (r.t0 === r.t1 ? fmtDay(r.t0) : fmtDay(r.t0) + " sampai " + fmtDay(r.t1)) + "</td><td style=\"text-align:left\">" + (kmap[r.kind] || r.kind) + "</td><td class=\"" + (isFinite(r.net) ? (r.net < 0 ? "bad" : "ok") : "") + "\">" + (isFinite(r.net) ? flowTxt(r.net, true) : "–") + "</td><td style=\"text-align:left\">" + (BASIS[r.basis] || r.basis) + "</td><td style=\"text-align:left\">" + (QUAL[r.quality] || r.quality) + "</td><td style=\"text-align:left\">" + r.source + "</td><td style=\"text-align:left\">" + r.note + "</td></tr>"; }).join("") + "</tbody>";
  $("#fSrc").innerHTML = FL.note + " Hari baru ditambahkan di tab Arus asing di Sheet (atau lewat formulir di halaman Metadata). Negatif berarti jual bersih, dalam Rp miliar.";
}
function priceAxis(k, pmin, pmax) { return function (v) { return k.y1 + (1 - (v - pmin) / (pmax - pmin || 1)) * (k.y0 - k.y1); }; }
function priceLabels(k, pmin, pmax) { var py = priceAxis(k, pmin, pmax); return [pmin, (pmin + pmax) / 2, pmax].map(function (v) { return '<text class="tl" x="' + (k.x1 + 6) + '" y="' + (py(v) + 4) + '">' + pxShort(v) + '</text>'; }).join(""); }
function drawFD(days, hasPx) {
  /* 16 sessions ending a few sessions after the latest day with a figure, so the
     chart is not blank when the press has stopped reporting daily numbers. */
  var el = $("#chFD"), dm = {}, j, vals = [0];
  days.forEach(function (d) { dm[d.t] = d; });
  var lastI = days.length ? lowerIdx(S.dates, days[days.length - 1].t) : S.dates.length - 1, n = Math.min(S.dates.length, Math.max(lastI + 1 + 4, 16)), M = Math.min(16, n), i0 = n - M;
  for (j = 0; j < M; j++) { var d = dm[S.dates[i0 + j]]; if (d) vals.push(d.v); }
  if (vals.length < 2) { el.innerHTML = "<p class=\"muted small\">Tidak ada angka harian dalam 16 sesi terakhir.</p>"; return; }
  var ymin = Math.min.apply(null, vals) * 1.12, ymax = Math.max.apply(null, vals) * 1.12; if (ymax <= 0) ymax = -ymin * 0.12; if (ymin >= 0) ymin = -ymax * 0.12;
  var pr = [], pmin = Infinity, pmax = -Infinity; for (j = 0; j < M; j++) { var p = S.prices[i0 + j]; pr.push(p); pmin = Math.min(pmin, p); pmax = Math.max(pmax, p); }
  var ticks = [], step = M > 12 ? ((el.clientWidth || 720) < 480 ? 4 : 2) : 1; for (j = 0; j < M; j += step) { var dd = new Date(S.dates[i0 + j]); ticks.push({ v: j, l: dd.getUTCDate() + " " + MONTHS[dd.getUTCMonth()] }); }
  var evs = fkind("event").filter(function (e) { return isMsci(e) && e.t0 >= S.dates[i0] && e.t0 <= S.dates[n - 1]; });
  var useT = Math.max(Math.abs(ymin), Math.abs(ymax)) >= 1500;
  chart(el, { xmin: -0.5, xmax: M - 0.5, ymin: ymin, ymax: ymax, yfmt: function (v) { return v === 0 ? "0" : useT ? (v < 0 ? "−" : "") + nd(Math.abs(v) / 1000, 1) + "T" : Math.round(v) + ""; }, xticks: ticks, R: 58, H: (el.clientWidth || 720) < 480 ? 250 : 290, label: "Arus asing bersih harian " + TK.code + " dengan harga",
    layers: function (fx, fy, k) {
      var s2 = '<line x1="' + k.x0 + '" x2="' + k.x1 + '" y1="' + fy(0) + '" y2="' + fy(0) + '" stroke="var(--fg)" stroke-opacity=".5"/>', bw = (fx(1) - fx(0)) * 0.62;
      for (j = 0; j < M; j++) {
        var d = dm[S.dates[i0 + j]], cx = fx(j);
        if (!d) { s2 += '<line x1="' + (cx - 5) + '" x2="' + (cx + 5) + '" y1="' + fy(0) + '" y2="' + fy(0) + '" stroke="var(--muted)" stroke-width="3" stroke-opacity=".45"/>'; continue; }
        var y1 = fy(Math.max(d.v, 0)), h = Math.abs(fy(d.v) - fy(0)), col = d.v < 0 ? "var(--tail)" : "var(--ok)";
        s2 += '<rect x="' + (cx - bw / 2) + '" y="' + y1 + '" width="' + bw + '" height="' + Math.max(1, h) + '" rx="2" fill="' + col + '" fill-opacity="' + (d.derived ? 0.4 : 0.85) + '"' + (d.derived ? ' stroke="' + col + '" stroke-dasharray="3 2"' : '') + '><title>' + fmtDay(d.t) + ": " + flowTxt(d.v, true) + (d.derived ? " (turunan)" : "") + '</title></rect>';
      }
      if (hasPx) { var py = priceAxis(k, pmin, pmax), d2 = ""; pr.forEach(function (v, q) { d2 += (q ? "L" : "M") + fx(q).toFixed(1) + " " + py(v).toFixed(1); }); s2 += '<path d="' + d2 + '" fill="none" stroke="var(--fg)" stroke-width="1.8"/>'; }
      evs.forEach(function (e) { var q = 0; for (; q < M; q++) if (S.dates[i0 + q] >= e.t0) break; s2 += '<line x1="' + fx(q) + '" x2="' + fx(q) + '" y1="' + k.y1 + '" y2="' + k.y0 + '" stroke="var(--fg)" stroke-opacity=".4" stroke-dasharray="4 4"/>'; });
      return s2;
    },
    overlay: function (fx, fy, k) { return hasPx ? priceLabels(k, pmin, pmax) : ""; } });
}
function drawFC(cs) {
  var el = $("#chFC");
  if (!cs) { el.innerHTML = ""; return; }
  var lo = Math.min.apply(null, cs.y), hi = Math.max(0, Math.max.apply(null, cs.y)), pad = (hi - lo) * 0.1 || 1, small = (el.clientWidth || 720) < 480;
  chart(el, { xmin: cs.x[0], xmax: cs.x[cs.x.length - 1] + DAY * 0.8, ymin: lo - pad, ymax: hi + pad, yfmt: flowAxis, xticks: cs.x.slice(1).filter(function (_, q) { return !small || q % 2 === 0; }).map(function (t) { var d = new Date(t); return { v: t, l: d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] }; }), R: 70, H: small ? 220 : 250, label: "Kumulatif arus asing bersih " + TK.code + " sejak pengumuman",
    layers: function (fx, fy, k) {
      var d = "", q; for (q = 0; q < cs.x.length; q++) d += (q ? "L" : "M") + fx(cs.x[q]).toFixed(1) + " " + fy(cs.y[q]).toFixed(1);
      var s2 = '<line x1="' + k.x0 + '" x2="' + k.x1 + '" y1="' + fy(0) + '" y2="' + fy(0) + '" stroke="var(--fg)" stroke-opacity=".4"/>';
      s2 += '<path d="' + d + 'L' + fx(cs.x[cs.x.length - 1]) + ' ' + fy(0) + 'L' + fx(cs.x[0]) + ' ' + fy(0) + 'Z" fill="var(--tail)" fill-opacity=".12"/><path d="' + d + '" fill="none" stroke="var(--tail)" stroke-width="2"/>';
      for (q = 1; q < cs.x.length; q++) s2 += '<circle cx="' + fx(cs.x[q]) + '" cy="' + fy(cs.y[q]) + '" r="4" fill="var(--tail)" stroke="var(--panel)" stroke-width="2"><title>' + fmtDay(cs.x[q]) + ": " + flowTxt(cs.y[q], true) + '</title></circle>';
      return s2;
    },
    overlay: function (fx, fy) { var q = cs.x.length - 1; return '<text x="' + (fx(cs.x[q]) + 8) + '" y="' + (fy(cs.y[q]) + 4) + '" style="fill:var(--tail);font-size:11.5px;font-weight:650;font-family:var(--sans)">' + flowTxt(cs.y[q], true) + '</text>'; } });
}
function drawFW(wk, hasPx) {
  var el = $("#chFW");
  if (!wk.length) { el.innerHTML = ""; return; }
  var t0 = wk[0].t0 - 3 * DAY, t1 = wk[wk.length - 1].t1 + 3 * DAY, vals = [0].concat(wk.map(function (r) { return r.net; })), ymin = Math.min.apply(null, vals) * 1.12, ymax = Math.max.apply(null, vals) * 1.15; if (ymax <= 0) ymax = -ymin * 0.1; if (ymin >= 0) ymin = -ymax * 0.1;
  var i0 = Math.max(0, lowerIdx(S.dates, t0)), i1 = Math.min(S.dates.length - 1, lowerIdx(S.dates, t1)), pmin = Infinity, pmax = -Infinity, q;
  for (q = i0; q <= i1; q++) { pmin = Math.min(pmin, S.prices[q]); pmax = Math.max(pmax, S.prices[q]); }
  chart(el, { xmin: t0, xmax: t1, ymin: ymin, ymax: ymax, yfmt: flowAxis, xticks: timeTicks(t0, t1).filter(function (_, z) { return (el.clientWidth || 720) < 480 ? z % 2 === 0 : true; }), R: 58, H: (el.clientWidth || 720) < 480 ? 250 : 280, label: "Arus asing bersih mingguan " + TK.code + " dengan harga",
    layers: function (fx, fy, k) {
      var s2 = '<line x1="' + k.x0 + '" x2="' + k.x1 + '" y1="' + fy(0) + '" y2="' + fy(0) + '" stroke="var(--fg)" stroke-opacity=".5"/>';
      wk.forEach(function (r) { var a = fx(r.t0), b = fx(r.t1 + DAY * 0.9), col = r.net < 0 ? "var(--tail)" : "var(--ok)"; s2 += '<rect x="' + (a + 1) + '" y="' + fy(Math.max(r.net, 0)) + '" width="' + Math.max(2, b - a - 2) + '" height="' + Math.max(1, Math.abs(fy(r.net) - fy(0))) + '" rx="2" fill="' + col + '" fill-opacity=".8"><title>' + fmtDay(r.t0) + " sampai " + fmtDay(r.t1) + ": " + flowTxt(r.net, true) + '</title></rect>'; });
      if (hasPx && i1 > i0) { var py = priceAxis(k, pmin, pmax), d = ""; for (q = i0; q <= i1; q++) d += (q > i0 ? "L" : "M") + fx(S.dates[q]).toFixed(1) + " " + py(S.prices[q]).toFixed(1); s2 += '<path d="' + d + '" fill="none" stroke="var(--fg)" stroke-width="1.6"/>'; }
      return s2;
    },
    overlay: function (fx, fy, k) { return hasPx && i1 > i0 ? priceLabels(k, pmin, pmax) : ""; } });
}

/* ---------- fair-value ranges against the price ---------- */
function drawFF(rows, price) {
  var el = $("#chFF"), cw = el.clientWidth || 720, W = Math.max(300, Math.min(760, Math.round(cw))), L = 10, R = 10, rh = 52, T = 30, B = 30, H = T + rows.length * rh + B;
  var vals = [price]; rows.forEach(function (r) { if (isFinite(r.lo)) vals.push(r.lo); if (isFinite(r.hi)) vals.push(r.hi); });
  var vmin = Math.min.apply(null, vals) * 0.9, vmax = Math.max.apply(null, vals) * 1.06;
  var fx = function (v) { return L + (v - vmin) / (vmax - vmin) * (W - L - R); }, tk = niceTicks(vmin, vmax, 5), sv = '<svg class="ch" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Rentang nilai wajar terhadap harga saat ini">';
  tk.forEach(function (v) { var x = fx(v); if (x < L || x > W - R) return; sv += '<line class="grid" x1="' + x + '" x2="' + x + '" y1="' + T + '" y2="' + (H - B) + '"/><text class="tl" x="' + x + '" y="' + (H - B + 16) + '" text-anchor="middle">' + pxShort(v) + '</text>'; });
  rows.forEach(function (r, i) {
    var y = T + i * rh, col = r.market ? "var(--muted)" : "var(--accent)";
    sv += '<text x="' + L + '" y="' + (y + 14) + '" style="fill:var(--fg);font-size:12.5px;font-family:var(--sans);font-weight:' + (r.strong ? 650 : 500) + ';stroke:var(--panel);stroke-width:4px;paint-order:stroke">' + r.n + (isFinite(r.lo) && isFinite(r.hi) ? '' : ' (n/a)') + '</text>';
    if (isFinite(r.lo) && isFinite(r.hi)) {
      var x1 = fx(Math.min(r.lo, r.hi)), x2 = fx(Math.max(r.lo, r.hi));
      sv += '<rect x="' + x1 + '" y="' + (y + 22) + '" width="' + Math.max(2, x2 - x1) + '" height="' + (r.strong ? 18 : 14) + '" rx="4" fill="' + col + '" fill-opacity="' + (r.market ? .4 : r.strong ? .75 : .5) + '"><title>' + r.n + ": " + px(Math.min(r.lo, r.hi)) + " sampai " + px(Math.max(r.lo, r.hi)) + (isFinite(r.mid) ? ", dasar " + px(r.mid) : "") + '</title></rect>';
      if (isFinite(r.mid)) sv += '<line x1="' + fx(r.mid) + '" x2="' + fx(r.mid) + '" y1="' + (y + 19) + '" y2="' + (y + (r.strong ? 44 : 40)) + '" stroke="var(--fg)" stroke-width="3"/>';
    }
  });
  var px0 = fx(price);
  sv += '<line x1="' + px0 + '" x2="' + px0 + '" y1="' + (T - 8) + '" y2="' + (H - B) + '" stroke="var(--fg)" stroke-dasharray="5 4" stroke-width="1.4"/><text x="' + px0 + '" y="' + (T - 12) + '" text-anchor="' + (px0 > W * 0.8 ? "end" : px0 < W * 0.2 ? "start" : "middle") + '" style="fill:var(--fg);font-size:12px;font-family:var(--sans);font-weight:650">Harga ' + pxShort(price) + '</text></svg>';
  el.innerHTML = sv;
}

/* ---------- dividends ---------- */
var DV = { rows: [], note: "" };
function dvPx(v) { return "Rp " + (Math.abs(v - Math.round(v)) < 0.01 ? Math.round(v).toLocaleString("id-ID") : nd(v, 2).replace(/0$/, "")); }
function dvYears() {
  var m = {}, out = [];
  DV.rows.forEach(function (r) { var y = m[r.fy] || (m[r.fy] = { fy: r.fy, interim: 0, final: 0, hasFinal: false }); if (r.type === "final") { y.final += r.dps; y.hasFinal = true; } else y.interim += r.dps; });
  Object.keys(m).forEach(function (k) { var y = m[k]; y.total = y.interim + y.final; y.t = Date.UTC(y.fy, 11, 31); out.push(y); });
  return out.sort(function (a, b) { return a.fy - b.fy; });
}
function epsOfYear(fy) { var t = Date.UTC(fy, 11, 31), i; for (i = 0; i < FH.rows.length; i++) if (FH.rows[i].t === t) return FH.rows[i].eps; return NaN; }
function yearEndPx(fy) {
  var t = Date.UTC(fy, 11, 31), v = pxOK() && S.dates[0] <= t && S.dates[S.dates.length - 1] >= t ? closeAt(t) : NaN;
  if (isFinite(v)) return { v: v, live: true };
  return { v: (TK.dvpx || {})[fy] || NaN, live: false };
}
function dvData() {
  var all = dvYears(), done = all.filter(function (y) { return y.hasFinal; }), rows = done.slice(-10), open = all.filter(function (y) { return !y.hasFinal; })[0] || null;
  rows.forEach(function (y) {
    var prev = done[done.indexOf(y) - 1], p = yearEndPx(y.fy);
    y.g = prev ? y.total / prev.total - 1 : NaN; y.eps = epsOfYear(y.fy); y.pay = y.eps > 0 ? y.total / y.eps : NaN;
    y.px = p.v; y.live = p.live; y.yld = p.v > 0 ? y.total / p.v : NaN;
  });
  return { rows: rows, open: open };
}
var DVS = (TK.dvs || []).map(function (s) { return { n: s.n, g: s.g, p: s.p }; }), DVST = { eps: NaN, dps: NaN, paid: 0, cur: NaN, fy: 0 }, dvBuilt = false;
function buildScen() {
  var h = '<thead><tr><th>Kasus</th><th>Pertumbuhan laba %</th><th>Rasio pembayaran %</th><th>Dividen</th><th>Vs tahun lalu</th><th>Imbal di harga hari ini</th><th>' + TK.x.stillCol + '</th></tr></thead><tbody>';
  DVS.forEach(function (s, i) { h += '<tr><td><b>' + s.n + '</b></td><td><input type="number" class="dvin" id="dvG' + i + '" value="' + s.g + '" step="1" min="-40" max="40" aria-label="' + s.n + ', pertumbuhan laba"></td><td><input type="number" class="dvin" id="dvP' + i + '" value="' + s.p + '" step="1" min="10" max="100" aria-label="' + s.n + ', rasio pembayaran"></td><td id="dvD' + i + '"></td><td id="dvC' + i + '"></td><td id="dvY' + i + '"></td><td id="dvR' + i + '"></td></tr>'; });
  $("#dvScen").innerHTML = h + '</tbody>';
  DVS.forEach(function (_, i) { $("#dvG" + i).addEventListener("input", dvScenCalc); $("#dvP" + i).addEventListener("input", dvScenCalc); });
  dvBuilt = true;
}
function dvScenCalc() {
  var s = DVST, i, need = "";
  if (!isFinite(s.eps)) return;
  for (i = 0; i < DVS.length; i++) {
    var g = Number($("#dvG" + i).value), p = Number($("#dvP" + i).value);
    if (!isFinite(g)) g = 0; if (!isFinite(p)) p = 0;
    var eps = s.eps * (1 + g / 100), d = eps * p / 100, ch = d / s.dps - 1;
    $("#dvD" + i).innerHTML = "<b>" + dvPx(d) + "</b><br><span class=\"muted small\">dari laba per saham " + px(eps) + "</span>";
    $("#dvC" + i).innerHTML = "<span class=\"" + (ch < -0.005 ? "bad" : ch > 0.005 ? "ok" : "") + "\">" + spct(ch, 0) + "</span>";
    $("#dvY" + i).textContent = isFinite(s.cur) ? pct(d / s.cur, 1) : "n/a";
    $("#dvR" + i).textContent = dvPx(Math.max(0, d - s.paid));
    if (i === 0 && g < 0) need = "Dalam kasus lemah, mempertahankan dividen " + dvPx(s.dps) + " butuh rasio pembayaran naik ke sekitar " + pct(s.dps / eps, 0) + ".";
  }
  $("#dvNeed").textContent = need;
}
function renderDividends() {
  if (!S.prices.length) return;
  var D = dvData(), R = D.rows, open = D.open, n = R.length, me = TK.code;
  if (n < 2) { $("#dVerdict").textContent = "Riwayat dividen belum terbaca dari tab Dividen."; return; }
  var live = pxOK(), first = R[0], last = R[n - 1], cur = live ? S.prices[S.prices.length - 1] : NaN, asof = live ? S.dates[S.dates.length - 1] : DV.rows[DV.rows.length - 1].t;
  var ttm = 0; DV.rows.forEach(function (r) { if (r.t > asof - 365 * DAY && r.t <= asof) ttm += r.dps; });
  var ups = R.filter(function (y) { return y.g > 0; }), cuts = R.filter(function (y) { return y.g < 0; }), yrs = n - 1;
  var cagrD = Math.pow(last.total / first.total, 1 / yrs) - 1, cagrE = (first.eps > 0 && last.eps > 0) ? Math.pow(last.eps / first.eps, 1 / yrs) - 1 : NaN;
  var cagrR = Math.pow((last.total * rf(last.t)) / (first.total * rf(first.t)), 1 / yrs) - 1;
  var pays = R.filter(function (y) { return isFinite(y.pay); }).map(function (y) { return y.pay; }), avgPay = avgOf(pays);
  var ylds = R.filter(function (y) { return isFinite(y.yld); }).map(function (y) { return y.yld; }), minY = Math.min.apply(null, ylds), maxY = Math.max.apply(null, ylds);
  var yNow = isFinite(cur) ? ttm / cur : NaN, cutWhy = "";
  if (cuts.length) { var cy = cuts[0], pi0 = R.indexOf(cy); if (pi0 > 0 && isFinite(cy.eps) && isFinite(R[pi0 - 1].eps) && cy.eps < R[pi0 - 1].eps) cutWhy = " Laba per saham turun " + pct(1 - cy.eps / R[pi0 - 1].eps, 0) + " tahun itu, jadi pemotongan mengikuti laba."; }
  var cutTxt = cuts.length ? (cuts.length === 1 ? "Dipotong sekali, pada " : "Dipotong " + cuts.length + " kali, pada ") + cuts.map(function (y) { return "FY" + y.fy + " (" + spct(y.g, 1) + ")"; }).join(", ") + "." : "Tidak pernah dipotong dalam jendela ini.";
  var maxPay = Math.max.apply(null, pays), isMax = last.pay >= maxPay - 1e-9, highPay = last.pay >= 0.65;
  $("#dVerdict").textContent = ups.length + " kenaikan dalam " + n + " tahun. " + (highPay ? "Dari sini dividen sebaiknya tidak diharapkan tumbuh lebih cepat dari laba." : "Masih ada ruang untuk membagikan lebih banyak.");
  $("#dSub").textContent = me + " membayar dividen setiap tahun dalam jendela ini. " + cutTxt + " Rasio pembayarannya, bagian laba yang dibagikan ke pemegang saham, bergerak dari " + pct(first.pay, 0) + " pada FY" + first.fy + " ke " + pct(last.pay, 0) + " pada FY" + last.fy + ". Itulah sebabnya dividen tumbuh " + pct(cagrD, 0) + " setahun sementara laba per saham tumbuh " + (isFinite(cagrE) ? pct(cagrE, 0) : "jauh lebih lambat") + (cagrD > cagrE ? ": bank membagikan potongan yang makin besar." : ".") + (highPay ? " Tuas itu sebagian besar sudah terpakai." : " Rasio pembayaran masih punya ruang naik.");
  $("#dStats").innerHTML =
    stat("Dividen per saham, FY" + last.fy, dvPx(last.total), "Naik dari " + dvPx(first.total) + " pada FY" + first.fy + ": " + nd(last.total / first.total, 1) + " kali lipat.", "ok") +
    stat("Tahun dividen naik", ups.length + " dari " + n, cutTxt, cuts.length ? "warn" : "ok") +
    stat("Pertumbuhan dividen setahun", pct(cagrD, 1), "Laba per saham tumbuh " + (isFinite(cagrE) ? pct(cagrE, 1) : "n/a") + " setahun pada tahun-tahun yang sama. Setelah inflasi, dividen tumbuh " + pct(cagrR, 1) + " setahun.") +
    stat("Rasio pembayaran, FY" + last.fy, pct(last.pay, 0), "Dulu " + pct(first.pay, 0) + " pada FY" + first.fy + ". Rata-rata jendela: " + pct(avgPay, 0) + ".", last.pay > 0.7 ? "warn" : "") +
    stat("Imbal hasil dividen sekarang", isFinite(yNow) ? pct(yNow, 1) : "n/a", dvPx(ttm) + " dibayar dalam 12 bulan terakhir. Di setiap akhir tahun, imbal berkisar " + pct(minY, 1) + " sampai " + pct(maxY, 1) + ".", isFinite(yNow) ? "ok" : "");
  var car = fv("car"), pg = fv("profit_growth_h1"), eps25 = last.eps, cover = eps25 / last.total, g3 = R.slice(-3).map(function (y) { return y.g; }), avgG = avgOf(R.map(function (y) { return y.g; })), lastG = last.g;
  var tests = [
    { name: "Rekam jejak", why: "Apakah selalu membayar, dan menghindari pemotongan?", reading: "Membayar di semua " + n + " tahun. " + cutTxt + cutWhy, status: cuts.length === 0 ? "ok" : (cuts.length === 1 && cuts[0].g > -0.1) ? "ok" : "warn" },
    { name: "Arah", why: "Apakah dividen masih naik?", reading: "Tiga perubahan terakhir " + listAnd(g3.map(function (g) { return spct(g, 0); })) + "." + (lastG < 0 ? " Perubahan terakhir adalah pemotongan." : " Masih naik" + (lastG < avgG ? ", tetapi lebih lambat dari rata-rata jendela " + pct(avgG, 0) + "." : ".")), status: lastG > 0.05 ? "ok" : lastG >= 0 ? "warn" : "bad" },
    { name: "Rasio pembayaran", why: "Berapa bagian laba yang dibagikan?", reading: pct(last.pay, 0) + " dari laba pada FY" + last.fy + (isMax ? ", tertinggi di jendela ini" : "") + " (rata-rata " + pct(avgPay, 0) + "). " + (highPay ? "Rasio ini tidak bisa naik terus, jadi pertumbuhan ke depan bertumpu pada laba." : "Masih ada ruang membagikan lebih banyak bila laba memungkinkan."), status: last.pay < 0.6 ? "ok" : last.pay <= 0.8 ? "warn" : "bad" },
    { name: "Cakupan laba", why: "Berapa kali laba menutup dividen?", reading: "Laba per saham " + px(eps25) + " menutup dividen " + dvPx(last.total) + " sebanyak " + nd(cover, 2) + " kali, dibanding " + nd(first.eps / first.total, 1) + " kali pada FY" + first.fy + ".", status: cover >= 1.5 ? "ok" : cover >= 1.2 ? "warn" : "bad" },
    { name: "Bantalan modal", why: "Apakah bank punya modal lebih?", reading: isFinite(car) ? "Rasio modal " + nd(car, 1) + "%, dibanding batas minimum regulator di kisaran 8% sampai 14% tergantung profil risiko bank." + (car >= 20 ? TK.x.capOk : " Itu di bawah 20%, jadi rasio pembayaran tinggi bersaing dengan pertumbuhan kredit untuk modal.") : "Angka modal belum termuat.", status: isFinite(car) ? (car >= 20 ? "ok" : car >= 14 ? "warn" : "bad") : "warn" },
    { name: "Momentum laba", why: "Apakah laba masih tumbuh?", reading: isFinite(pg) ? "Laba semester I 2026 tumbuh " + spct(pg / 100, 1) + " (FY" + last.fy + ": " + TK.x.fyG + "). Dividen hanya bisa tumbuh lebih cepat dari laba untuk sementara." : "Angka pertumbuhan laba belum termuat.", status: isFinite(pg) ? (pg > 5 ? "ok" : pg >= 0 ? "warn" : "bad") : "warn" },
  ];
  var lab = { ok: "Mendukung", warn: "Awasi", bad: "Peringatan" };
  $("#dScore").innerHTML = "<thead><tr><th>Uji</th><th style=\"text-align:left\">Kata data</th><th style=\"text-align:left\">Bacaan</th></tr></thead><tbody>" + tests.map(function (o) { return "<tr><td><b>" + o.name + "</b><br><span class=\"muted small\">" + o.why + "</span></td><td style=\"text-align:left\">" + o.reading + "</td><td class=\"" + o.status + "\" style=\"text-align:left;white-space:nowrap\">● " + lab[o.status] + "</td></tr>"; }).join("") + "</tbody>";
  var nOk = tests.filter(function (o) { return o.status === "ok"; }).length, nWarn = tests.filter(function (o) { return o.status === "warn"; }).length, nBad = tests.filter(function (o) { return o.status === "bad"; }).length, slow = highPay && isFinite(pg) && pg < 5;
  note("#exDScore", "<p><b>Apakah akan berlanjut?</b> " + (nBad === 0 && cuts.length <= 1 ? "Sangat mungkin. " : nBad <= 1 ? "Kemungkinan besar, dengan satu peringatan yang perlu diperhatikan. " : "Belum pasti. ") + nOk + " uji mendukung, " + nWarn + " minta diawasi dan " + nBad + " peringatan. " + (nBad === 0 ? TK.x.dNothing : "Baca baris merah lebih dulu.") + "</p><p><b>Apakah akan tumbuh secepat dulu?</b> " + (slow ? "Kecil kemungkinannya. " : "Bisa saja. ") + "Pertumbuhan lama datang dari rasio pembayaran yang naik dan laba per saham yang tumbuh sekitar " + (isFinite(cagrE) ? pct(cagrE, 0) : "n/a") + " setahun. Pertumbuhan laba kini " + (isFinite(pg) ? "sekitar " + pct(pg / 100, 0) : "belum jelas") + (highPay ? ", dan rasio pembayaran " + (isMax ? "di rekor tertinggi" : "sudah tinggi") + ". Harapkan dividen bergerak kira-kira seiring laba." : ". Rasio pembayaran masih bisa ikut bekerja.") + "</p>");
  var real = $("#dvReal").checked;
  drawDVBars(R, open, real);
  $("#dvBarCap").textContent = real ? "Setiap batang dinyatakan dalam rupiah hari ini dengan indeks harga konsumen Indonesia, jadi batang yang datar berarti dividen hanya mengimbangi inflasi." : TK.x.barCap(open);
  note("#exDV", TK.x.exDV(open, first, last) + "<p>Setelah inflasi pertumbuhannya " + pct(cagrR, 1) + " setahun, bukan " + pct(cagrD, 1) + ". " + (cagrR > 0.03 ? "Inflasi menggerus sebagian, tetapi dividen tetap tumbuh jauh di atas kenaikan harga." : "Setelah inflasi, sebagian besar pertumbuhan itu hilang.") + "</p>");
  var th = "<thead><tr><th>Tahun</th><th>Interim</th><th>Final</th><th>Total</th><th>Perubahan</th><th>Laba per saham</th><th>Rasio bayar</th><th>Harga akhir tahun</th><th>Imbal</th></tr></thead><tbody>";
  R.forEach(function (y) { th += "<tr><td>FY" + y.fy + "</td><td>" + dvPx(y.interim) + "</td><td>" + dvPx(y.final) + "</td><td><b>" + dvPx(y.total) + "</b></td><td class=\"" + (y.g < 0 ? "bad" : "ok") + "\">" + (isFinite(y.g) ? spct(y.g, 0) : "–") + "</td><td>" + (isFinite(y.eps) ? px(y.eps) : "–") + "</td><td class=\"" + (y.pay > 0.7 ? "warn" : "") + "\">" + (isFinite(y.pay) ? pct(y.pay, 0) : "–") + "</td><td>" + (isFinite(y.px) ? ((!y.live && (TK.dvapprox || {})[y.fy]) ? "~" : "") + px(y.px) : "–") + "</td><td>" + (isFinite(y.yld) ? pct(y.yld, 1) : "–") + "</td></tr>"; });
  if (open) th += "<tr><td>FY" + open.fy + " sejauh ini</td><td>" + dvPx(open.interim) + "</td><td>jatuh tempo " + (open.fy + 1) + "</td><td>" + dvPx(open.total) + "+</td><td>–</td><td>–</td><td>–</td><td>" + (isFinite(cur) ? px(cur) : "–") + "</td><td>" + (isFinite(yNow) ? pct(yNow, 1) + " (12 bln)" : "–") + "</td></tr>";
  $("#dvTable").innerHTML = th + "</tbody>";
  var yp = R.filter(function (y) { return isFinite(y.yld); }).map(function (y) { return { x: y.fy, y: y.yld, l: "FY" + String(y.fy).slice(2) }; });
  if (isFinite(yNow)) yp.push({ x: last.fy + 1, y: yNow, l: "Kini", now: true });
  drawDVLine("#chDY", yp, { label: "Imbal hasil dividen " + me + " di setiap akhir tahun", dec: 1 });
  var pBase = R.filter(function (y) { return y.fy === last.fy - 1; })[0];
  if (isFinite(yNow) && pBase && isFinite(pBase.px)) {
    var yHold = ttm / pBase.px, pchg = cur / pBase.px - 1, dchg = ttm / pBase.total - 1;
    note("#exDY", "<p><b>Dari mana imbal hari ini.</b> Pada akhir " + pBase.fy + " imbalnya " + pct(pBase.yld, 1) + " (" + dvPx(pBase.total) + " pada harga " + px(pBase.px) + "). Hari ini " + pct(yNow, 1) + ". Dua hal bergerak. Dividen yang dibayar dalam 12 bulan terakhir " + pct(Math.abs(dchg), 0) + (dchg >= 0 ? " lebih tinggi" : " lebih rendah") + ", yang sendirian akan membawa imbal ke " + pct(yHold, 1) + ". Harga saham " + pct(Math.abs(pchg), 0) + (pchg <= 0 ? " lebih rendah" : " lebih tinggi") + ", dan itulah sisanya, sekitar " + nd((yNow - yHold) * 100, 1) + " poin." + (Math.abs(yNow - yHold) > Math.abs(yHold - pBase.yld) ? " Jadi imbal yang tinggi sebagian besar karena harga yang lebih rendah, bukan cek yang lebih besar." : "") + "</p><p>Itu juga sebabnya imbal tinggi bukan otomatis murah: penurunan harga yang sama yang menaikkan imbal adalah pasar yang mengkhawatirkan pertumbuhan dan penjualan asing. Dividen tunai sendiri tidak bergantung pada harga saham.</p>");
  } else note("#exDY", "<p>Butuh harga bertanggal untuk melihat berapa bagian imbal hari ini yang datang dari dividen dan berapa dari harga.</p>");
  var pp = R.filter(function (y) { return isFinite(y.pay); }).map(function (y) { return { x: y.fy, y: y.pay, l: "FY" + String(y.fy).slice(2) }; });
  drawDVLine("#chDP", pp, { label: "Rasio pembayaran " + me + " per tahun", dec: 0, ymax: 1.05, ref: 1, refLabel: "Seluruh laba" });
  var peerTxt = "", pe = peersOf().filter(function (k) { return PD.f[k] && isFinite(PD.f[k].payout_fy2025); });
  if (pe.length) peerTxt = " Sebagai pembanding, " + listAnd(pe.map(function (k) { return k + " " + Math.round(PD.f[k].payout_fy2025) + "%"; })) + " adalah bagian laba yang dibagikan untuk FY2025, dibanding " + Math.round(last.pay * 100) + "% untuk " + me + "." + TK.x.dpLast;
  note("#exDP", "<p><b>Dalam bahasa sederhana.</b> Rasio pembayaran menunjukkan berapa dari setiap rupiah laba yang keluar dari bank sebagai dividen. " + TK.x.dpIntro(last) + "</p><p>Hitungannya sederhana: begitu rasio pembayaran mendekati 100%, satu-satunya cara menaikkan dividen adalah menaikkan laba." + peerTxt + "</p>");
  DVST = { eps: last.eps, dps: last.total, paid: open ? open.interim : 0, cur: cur, fy: open ? open.fy : last.fy + 1 };
  if (!dvBuilt) buildScen();
  $("#dvScenCap").textContent = "Pilih pertumbuhan laba dan rasio pembayaran untuk FY" + DVST.fy + ". Tabel mengubahnya menjadi dividen per saham, dengan laba per saham FY" + last.fy + " " + px(last.eps) + " sebagai titik awal. Ubah kotak isian.";
  dvScenCalc();
  note("#exScen", TK.x.exScen(open, last));
  $("#dWatch").innerHTML = TK.x.watch({ pg: pg, last: last, isMax: isMax, fy: DVST.fy, car: car });
  var ph = "<thead><tr><th>Dibayar</th><th>Tahun buku</th><th>Jenis</th><th>Per saham</th><th style=\"text-align:left\">Catatan</th></tr></thead><tbody>";
  DV.rows.slice().sort(function (a, b) { return b.t - a.t; }).forEach(function (r) { ph += "<tr><td>" + fmtDay(r.t) + "</td><td>FY" + r.fy + "</td><td>" + (r.type === "final" ? "Final" : "Interim") + "</td><td>" + dvPx(r.dps) + "</td><td style=\"text-align:left\">" + (r.note || "") + "</td></tr>"; });
  $("#dvPays").innerHTML = ph + "</tbody>";
  $("#dvSrc").innerHTML = DV.note + " " + TK.x.dvSrc;
}
function drawDVBars(R, open, real) {
  var el = $("#chDV"), f = function (y) { return real ? rf(y.t) : 1; }, top = 0, small = (el.clientWidth || 720) < 480;
  R.forEach(function (y) { top = Math.max(top, y.total * f(y)); }); if (open) top = Math.max(top, open.total);
  var xt = R.map(function (y) { return { v: y.fy, l: (small ? "’" : "FY") + String(y.fy).slice(2) }; });
  if (open) xt.push({ v: open.fy, l: (small ? "’" : "FY") + String(open.fy).slice(2) });
  chart(el, { xmin: R[0].fy - 0.7, xmax: (open ? open.fy : R[R.length - 1].fy) + 0.7, ymin: 0, ymax: top * 1.12, yfmt: pxShort, xticks: xt, label: "Dividen " + TK.code + " per saham per tahun, interim dan final",
    layers: function (fx, fy) {
      var w = Math.max(6, (fx(1) - fx(0)) * 0.62), s = "";
      R.forEach(function (y) {
        var m = f(y), xc = fx(y.fy), yi = fy(y.interim * m), yt = fy(y.total * m), y0 = fy(0), tip = '<title>FY' + y.fy + ': interim ' + dvPx(y.interim * m) + ', final ' + dvPx(y.final * m) + '</title>';
        if (y.interim > 0) s += '<rect x="' + (xc - w / 2).toFixed(1) + '" y="' + yi.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, y0 - yi).toFixed(1) + '" fill="var(--accent)" fill-opacity=".45">' + tip + '</rect>';
        s += '<rect x="' + (xc - w / 2).toFixed(1) + '" y="' + yt.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, yi - yt - (y.interim > 0 ? 2 : 0)).toFixed(1) + '" rx="3" fill="var(--accent)" fill-opacity=".9">' + tip + '</rect>';
        if (!small || R.indexOf(y) % 2 === 1 || y === R[R.length - 1]) s += '<text class="tl" x="' + xc.toFixed(1) + '" y="' + (yt - 5).toFixed(1) + '" text-anchor="middle">' + pxShort(y.total * m) + '</text>';
      });
      if (open) {
        var xo = fx(open.fy), yo = fy(open.interim), y00 = fy(0);
        s += '<rect x="' + (xo - w / 2).toFixed(1) + '" y="' + yo.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, y00 - yo).toFixed(1) + '" rx="3" fill="var(--accent)" fill-opacity=".2" stroke="var(--accent)" stroke-dasharray="4 3"/>';
        s += '<text class="tl" x="' + xo.toFixed(1) + '" y="' + (yo - 5).toFixed(1) + '" text-anchor="middle">' + pxShort(open.interim) + '+</text>';
      }
      return s;
    } });
}
function drawDVLine(sel, pts, o) {
  var el = $(sel);
  if (!pts.length) { el.innerHTML = ""; return; }
  var small = (el.clientWidth || 720) < 480, ys = pts.map(function (p) { return p.y; }), ymax = o.ymax || Math.max.apply(null, ys) * 1.18, xt = pts.map(function (p) { return { v: p.x, l: p.l }; });
  if (small) xt = xt.filter(function (_, i) { return i % 2 === 0 || i === pts.length - 1; });
  chart(el, { xmin: pts[0].x - 0.5, xmax: pts[pts.length - 1].x + 0.5, ymin: 0, ymax: ymax, yfmt: function (v) { return Math.round(v * 100) + "%"; }, xticks: xt, label: o.label,
    layers: function (fx, fy, k) {
      var s = "", d = "";
      if (o.ref) s += '<line x1="' + k.x0 + '" x2="' + k.x1 + '" y1="' + fy(o.ref).toFixed(1) + '" y2="' + fy(o.ref).toFixed(1) + '" stroke="var(--muted)" stroke-dasharray="5 4"/><text class="tl" x="' + (k.x0 + 4) + '" y="' + (fy(o.ref) - 5).toFixed(1) + '">' + o.refLabel + '</text>';
      pts.forEach(function (p, i) { d += (i ? "L" : "M") + fx(p.x).toFixed(1) + " " + fy(p.y).toFixed(1); });
      s += '<path d="' + d + '" fill="none" stroke="var(--accent)" stroke-width="2"/>';
      pts.forEach(function (p, i) {
        var cx = fx(p.x), cy = fy(p.y);
        s += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="4" fill="' + (p.now ? "var(--warn)" : "var(--accent)") + '" stroke="var(--panel)" stroke-width="2"><title>' + p.l + ': ' + nd(p.y * 100, o.dec) + '%</title></circle>';
        if (!small || i % 2 === 0 || i === pts.length - 1) s += '<text class="tl" x="' + cx.toFixed(1) + '" y="' + (cy - 9).toFixed(1) + '" text-anchor="middle">' + nd(p.y * 100, o.dec) + (p.now ? "%" : "") + '</text>';
      });
      return s;
    } });
}

/* ---------- data in: from the local copy of the Sheet tabs (dash-shim) ---------- */
function valuesOf(id) {
  var d = window.dash.data(id);
  if (d.status !== "ok") return { status: d.status, message: d.message, rows: [] };
  var v = d.data, rows = Array.isArray(v) ? v : (v && Array.isArray(v.values) ? v.values : []);
  return { status: "ok", rows: rows, meta: d.meta };
}
function metaOf(id) { var m = (window.EO_META || {}).datasets || {}; return m[id] || {}; }
function ingest() {
  var p = valuesOf(TK.ds.price);
  if (p.status !== "ok") return p;
  var pr = p.rows.map(function (r) { return { t: toTime(r[0]), v: numOf(r[1]) }; }).filter(function (r) { return isFinite(r.t) && isFinite(r.v) && r.v > 0; }).sort(function (a, b) { return a.t - b.t; });
  var dates = [], prices = [];
  pr.forEach(function (r) { if (dates.length && dates[dates.length - 1] === r.t) { prices[prices.length - 1] = r.v; return; } dates.push(r.t); prices.push(r.v); });
  if (prices.length < 60) return { status: "error", message: "Harga " + TK.code + " terlalu sedikit (" + prices.length + " baris)." };
  S = { dates: dates, prices: prices, hasDates: true, sample: false };
  F.map = {}; valuesOf(TK.ds.fund).rows.forEach(function (r) { if (r[0]) F.map[String(r[0]).trim()] = numOf(r[2]); }); F.note = TK.fundNote;
  FH.rows = valuesOf(TK.ds.fh).rows.map(function (r) { return { t: toTime(r[0]), bv: numOf(r[1]), eps: numOf(r[2]), dps: numOf(r[3]) }; }).filter(function (r) { return isFinite(r.t) && isFinite(r.bv) && isFinite(r.eps); }).sort(function (a, b) { return a.t - b.t; });
  DV.rows = valuesOf(TK.ds.dv).rows.map(function (r) { return { t: toTime(r[0]), fy: numOf(r[1]), type: String(r[2] || "").trim().toLowerCase(), dps: numOf(r[3]), note: r[4] || "" }; }).filter(function (r) { return isFinite(r.t) && isFinite(r.fy) && isFinite(r.dps) && r.dps > 0 && (r.type === "interim" || r.type === "final"); }).sort(function (a, b) { return a.t - b.t; });
  DV.note = "Dividen dibaca dari tab Dividen di sheet " + TK.code + ".";
  FL.rows = mkFlowRows(valuesOf(TK.ds.flow).rows); FL.note = TK.flowNote;
  var c = valuesOf("cpi").rows.map(function (r) { return { t: toTime(r[0]), v: numOf(r[1]) }; }).filter(function (r) { return isFinite(r.t) && isFinite(r.v); }).sort(function (a, b) { return a.t - b.t; });
  setCPI(c); setInflDefaults();
  var SC = SEC();
  PD.f = {}; valuesOf(SC.fundDs).rows.forEach(function (r) {
    var k = String(r[0] || "").trim().toUpperCase(); if (!k) return;
    PD.f[k] = { name: r[1], bvps: numOf(r[2]), eps_ttm: numOf(r[3]), dps_fy2025: numOf(r[4]), payout_fy2025: numOf(r[5]), roe: numOf(r[6]), nim: numOf(r[7]), npl: numOf(r[8]), car: numOf(r[9]), profit_growth_h1: numOf(r[10]), loan_growth: numOf(r[11]) };
  });
  var pp = valuesOf(SC.priceDs).rows;
  PD.p = null;
  if (pp.length) {
    PD.p = {};
    SC.all.forEach(function (code, k) {
      var ts = [], cs = [];
      pp.forEach(function (r) { var t = toTime(r[3 * k]), v = numOf(r[3 * k + 1]); if (isFinite(t) && isFinite(v) && v > 0) { ts.push(t); cs.push(v); } });
      var ord = ts.map(function (_, i) { return i; }).sort(function (a, b) { return ts[a] - ts[b]; });
      PD.p[code] = { t: ord.map(function (i) { return ts[i]; }), c: ord.map(function (i) { return cs[i]; }) };
    });
  }
  PD.url = metaOf(SC.fundDs).sheet_url || "";
  return { status: "ok", meta: p.meta };
}

/* ---------- macro context strip (same tiles as the dashboard monitor) ---------- */
function nf(v, d) { return (+v).toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }); }
function sgn(v, d) { return (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v), d); }
function spark(vals, kind, tone) {
  var W = 84, H = 22, v = vals.filter(function (x) { return x != null && isFinite(x); }), s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="t-spark" aria-hidden="true">';
  if (v.length < 2) return s + '</svg>';
  if (kind === "flow") {
    var m = Math.max.apply(null, v.map(Math.abs)) || 1, bw = W / vals.length;
    vals.forEach(function (x, i) { if (x == null) return; var h = Math.max(1, Math.abs(x) / m * (H / 2 - 1)); s += '<rect x="' + (i * bw + 1) + '" width="' + Math.max(1, bw - 2) + '" y="' + (x >= 0 ? H / 2 - h : H / 2) + '" height="' + h + '" class="' + (x >= 0 ? "t-up" : "t-dn") + '"/>'; });
    return s + '</svg>';
  }
  var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), sx = W / (vals.length - 1), d = "", last = null;
  vals.forEach(function (x, i) { if (x == null || !isFinite(x)) return; var y = H - 2 - (x - lo) / ((hi - lo) || 1) * (H - 4); d += (d ? "L" : "M") + (i * sx).toFixed(1) + "," + y.toFixed(1); last = [i * sx, y]; });
  return s + '<path d="' + d + '" class="t-spark-line"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.2" class="t-' + tone + '"/></svg>';
}
function series(ds, f, per) {
  var d = window.dash.data(ds);
  if (d.status !== "ok" || !Array.isArray(d.data)) return [];
  return d.data.filter(function (r) { return r[f] != null && isFinite(r[f]); }).map(function (r) { return { per: String(r[per || "month"]), v: +r[f] }; });
}
function renderMacro() {
  var box = $("#labMacro"); if (!box) return;
  var me = TK.code, n = S.prices.length, tiles = [];
  function tile(o) {
    var rows = o.rows; if (!rows || !rows.length) return;
    var last = rows[rows.length - 1], prev = rows[rows.length - 2], v = last.v, raw = 0, chg = "";
    if (o.chg === "flow") { raw = v; chg = "bulan ini"; }
    else if (prev) {
      if (o.chg === "pct") { raw = (v / prev.v - 1) * 100; chg = sgn(raw, 1) + "%"; }
      else if (o.chg === "bp") { raw = (v - prev.v) * 100; chg = sgn(Math.round(raw), 0) + " bp"; }
      else { raw = v - prev.v; chg = sgn(raw, o.d); }
    }
    var tone = Math.abs(raw) < 1e-9 ? "flat" : raw * o.good > 0 ? "up" : "dn", arrow = o.chg === "flow" ? "" : raw > 0 ? "▲ " : raw < 0 ? "▼ " : "■ ";
    var per = last.per.replace(" (turunan)", "").replace(/ 20(\d\d)$/, " '$1");
    tiles.push('<button type="button" class="t-tile t-' + tone + '" data-go="' + o.go + '" title="' + o.name + ': ' + last.per + ' · ' + o.tip + ' Warna: hijau = baik untuk saham Indonesia, merah = buruk.">' +
      '<div class="t-tile-h"><span class="t-code">' + o.code + '</span><span class="t-tile-n">' + o.name + '</span><span class="t-per">' + per + '</span></div>' +
      '<div class="t-tile-v">' + (o.chg === "flow" ? sgn(v, o.d) : nf(v, o.d)) + (o.unit || "") + '</div>' + spark(rows.slice(-(o.spark || 12)).map(function (r) { return r.v; }), o.chg === "flow" ? "flow" : "line", tone) + '<div class="t-chg">' + arrow + chg + '</div></button>');
  }
  if (n > 1) tile({ code: me, name: "Harian", rows: S.dates.slice(-30).map(function (t, i) { return { per: fmtDay(t), v: S.prices[n - 30 + i] }; }).filter(function (r) { return isFinite(r.v); }), d: 0, chg: "pct", good: 1, go: "#char", spark: 30, tip: "Penutupan terakhir dan perubahan harian." });
  tile({ code: "IHSG", name: "IHSG", rows: series("saham", "ihsg"), d: 0, chg: "pct", good: 1, go: "eo-market", tip: "Bulanan. Klik untuk ke bagian pasar di dashboard." });
  tile({ code: "FIN", name: "IDX Finance", rows: series("saham", "fin"), d: 0, chg: "pct", good: 1, go: "eo-market", tip: "Indeks sektor keuangan, bulanan." });
  var bi = series("birate", "bi_rate"), fed = series("fed", "fed_upper"), fm = {}, spr = [];
  fed.forEach(function (r) { fm[r.per] = r.v; });
  bi.forEach(function (r) { if (fm[r.per] != null) spr.push({ per: r.per, v: r.v - fm[r.per] }); });
  tile({ code: "BI", name: "BI Rate", rows: bi, d: 2, unit: "%", chg: "bp", good: -1, go: "eo-checklist", tip: "Suku bunga acuan menentukan biaya dana dan margin bank." });
  tile({ code: "SPRD", name: "BI − Fed", rows: spr, d: 2, unit: " pt", chg: "bp", good: 1, go: "eo-us", tip: "Selisih yang besar menahan rupiah dan dana asing." });
  tile({ code: "IDR", name: "USD/IDR", rows: series("rupiah", "usd_idr"), d: 0, chg: "pct", good: -1, go: "eo-regime", tip: "Rupiah melemah biasanya berarti asing keluar." });
  tile({ code: "FLOW", name: "Asing saham", rows: series("flow", "flow_idr_t"), d: 1, unit: " T", chg: "flow", good: 1, go: "eo-market", tip: "Arus asing bersih bulanan di seluruh pasar saham." });
  tile({ code: "SBN", name: "SBN 10 th", rows: series("sbn", "sbn", "date"), d: 2, unit: "%", chg: "bp", good: -1, go: "eo-uang", tip: "Imbal obligasi negara: tolok ukur biaya ekuitas." });
  tile({ code: "CPI", name: "Inflasi YoY", rows: series("inflation", "inflation_yoy"), d: 2, unit: "%", chg: "pt", good: -1, go: "eo-regime", tip: "Inflasi menggerus dividen riil." });
  box.innerHTML = tiles.length ? tiles.join("") : '<div class="t-empty">Memuat konteks makro…</div>';
  box.querySelectorAll(".t-tile").forEach(function (b) {
    b.addEventListener("click", function () { var g = b.dataset.go; if (g.charAt(0) === "#") { showTab(g.slice(1)); window.scrollTo(0, 0); } else location.href = "index.html#" + g; });
  });
}

/* ---------- tabs and page chrome ---------- */
var TABS = ["char", "val", "flow", "div"];
function showTab(name, keepHash) {
  if (TABS.indexOf(name) < 0) name = "char";
  curTab = name;
  TABS.forEach(function (t) { $("#p-" + t).classList.toggle("hidden", t !== name); $("#tab-" + t).setAttribute("aria-selected", t === name ? "true" : "false"); });
  var hasData = S.prices.length > 0;
  $("#winbar").classList.toggle("hidden", !hasData || name !== "char");
  $("#winNote").classList.toggle("hidden", !hasData || name !== "char");
  window.dispatchEvent(new CustomEvent("eo:tab", { detail: name }));
  if (!keepHash) try { history.replaceState(null, "", location.pathname + location.search + "#" + name); } catch (e) { }
  if (!hasData) return;
  if (name === "val") renderVal();
  if (name === "flow") renderFlows();
  if (name === "div") renderDividends();
}
function toast(msg, kind) {
  var t = $("#adm-toast"); if (!t) return;
  t.textContent = msg; t.className = "adm-toast show " + (kind || "");
  clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = "adm-toast"; }, kind === "bad" ? 9000 : 4500);
}
function fillChrome() {
  document.title = TK.code + " · Saham";
  $("#labCode").textContent = TK.code; $("#labSector").textContent = TK.sector === "bank" ? "Bank" : TK.sector;
  $("#labFull").textContent = TK.full; $("#labTitle").textContent = TK.name;
  $("#lgI").textContent = TK.x.lgI; $("#lgF").textContent = TK.x.lgF; $("#ddmNote").textContent = TK.x.ddmNote;
  [["vCoe", TK.val.coe], ["vG", TK.val.g], ["vEg", TK.val.eg], ["vRoeT", TK.val.roeT]].forEach(function (a) { $("#" + a[0]).value = a[1]; });
  var sw = $("#tkSwitch"), codes = Object.keys(window.EO_STOCKS || {});
  sw.innerHTML = '<span class="lab-tk-l">Saham</span>' + codes.map(function (c) { return '<button type="button" class="adm-btn" data-tk="' + c + '" aria-pressed="' + (c === TK.code) + '">' + c + '</button>'; }).join("");
  sw.querySelectorAll("button").forEach(function (b) { b.addEventListener("click", function () { if (b.dataset.tk !== TK.code) location.search = "?tk=" + b.dataset.tk; }); });
}
function updateChrome(res) {
  var n = S.prices.length, last = S.prices[n - 1], prev = S.prices[n - 2], ch = last / prev - 1;
  $("#lastChip").innerHTML = "<b>" + px(last) + "</b> <span class=\"" + (ch >= 0 ? "ok" : "bad") + "\" style=\"color:var(--" + (ch >= 0 ? "ok" : "tail") + ")\">" + spct(ch, 1) + "</span> · " + fmtDay(S.dates[n - 1]);
  var m = metaOf(TK.ds.price), fetched = res.meta && res.meta.fetched_at ? new Date(res.meta.fetched_at) : null;
  $("#labStatus").textContent = TK.code + " · " + n.toLocaleString("id-ID") + " harga harian sampai " + fmtDay(S.dates[n - 1]) + (fetched && !isNaN(fetched) ? " · disalin dari Sheet " + fetched.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "");
  if (m.sheet_url) $("#labSheet").href = m.sheet_url;
  var fy0 = FH.rows.length ? new Date(FH.rows[0].t).getUTCFullYear() + 1 : 2017, o0 = document.querySelector("#hWin option[value='0']"); if (o0) o0.textContent = "Semua sejak " + fy0;
}
var firstDraw = true;
function draw() {
  var res = ingest(), banner = $("#noData");
  if (res.status === "loading") { $("#labStatus").textContent = "Memuat data…"; return; }
  if (res.status !== "ok") {
    banner.classList.remove("hidden");
    banner.innerHTML = "<b>Data " + TK.code + " belum tersedia.</b> " + (res.message || "") + " Klik <b>⟳ Tarik</b> di atas untuk membaca tab-tabnya dari Google Sheet, atau lihat halaman <a href=\"metadata.html\">Metadata</a>.";
    $("#labStatus").textContent = "Data belum ada";
    renderMacro();
    return;
  }
  banner.classList.add("hidden");
  applyDefaults();
  updateChrome(res);
  renderMacro();
  renderProfile();
  showTab(firstDraw ? (location.hash || "#char").slice(1) : curTab, firstDraw && !location.hash);
  firstDraw = false;
}

/* ---------- listeners ---------- */
document.querySelectorAll(".tab").forEach(function (b) { b.addEventListener("click", function () { showTab(b.dataset.tab); }); });
$("#win").addEventListener("change", function () { if (S.prices.length) renderProfile(); });
$("#histLog").addEventListener("change", function () { if (A) renderHist(); });
$("#priceReal").addEventListener("change", function () { if (A) renderPrice(); });
$("#showExplain").addEventListener("change", function (e) { document.body.classList.toggle("noexplain", !e.target.checked); });
$("#dvReal").addEventListener("change", function () { renderDividends(); });
$("#toVal").addEventListener("click", function () { showTab("val"); window.scrollTo(0, 0); });
window.addEventListener("hashchange", function () { var h = location.hash.slice(1); if (TABS.indexOf(h) >= 0 && h !== curTab) showTab(h, true); });
$("#labRefresh").addEventListener("click", function () {
  var btn = this, ids = Object.keys(TK.ds).map(function (k) { return TK.ds[k]; }).concat([SEC().priceDs, SEC().fundDs, "cpi"]);
  if (!window.EOJobs) return;
  btn.disabled = true;
  window.EOJobs.run("/api/refresh", { ids: ids }).then(function (r) {
    var w = r && r.warnings && r.warnings.length;
    toast(w ? "Sebagian data gagal ditarik; salinan lama dipakai. Lihat Metadata." : "Data " + TK.code + " diperbarui dari Google Sheet.", w ? "warn" : "ok");
  }).catch(function (e) { toast("Gagal menarik data: " + (e && e.message || e), "bad"); })
    .then(function () { btn.disabled = false; return window.dash.reload(); });
});

window.EOLab = { pct: pct, spct: spct, fv: fv, dvPx: dvPx, px: px, stat: stat,
  /* latest daily close, for the stock card in the rail (terminal.js) */
  last: function () { var n = S.prices.length; return n > 1 ? { v: S.prices[n - 1], p: S.prices[n - 2], per: (function (d) { return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()]; })(new Date(S.dates[n - 1])) } : { v: NaN }; } };
fillChrome();
if (window.dash) window.dash.onData(draw);
})();
