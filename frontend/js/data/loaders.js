/*
 * DATA LAYER — loaders.
 *
 * A loader turns the raw answer the backend gives for one dataset
 * ({ values: [[cell, cell, ...], ...] }, exactly what the Google Sheets API
 * returns) into clean rows that the charts read with dash.data(id).
 *
 * To add a new indicator:
 *   1. add the dataset to config/datasets.yaml (which tab and range),
 *   2. add a dash.loader('<id>', ...) here that names each column,
 *   3. draw it in a section script (see js/sections/).
 *
 * Column positions (r[0], r[1], ...) follow the Sheet columns A, B, ...
 */
(function () {
function sheetRows(answer) { return (answer && answer.values) || []; }
function numOrNull(x) { return (x === undefined || x === null || x === '') ? null : Number(String(x).replace(/,/g, '')); }

dash.loader('pmi', {
description: 'Baris tab PMI (Periode, PMI, Unit, Penerbit, URL sumber, Tingkat kepercayaan, Catatan) dari Google Sheet, diubah jadi angka.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], pmi: Number(r[1]), unit: r[2], source: r[3], url: r[4], confidence: r[5], notes: r[6],
})),
});
dash.loader('gdp', {
description: 'Baris tab PDB (Periode, PDB riil YoY, Unit, Penerbit, URL sumber, Tingkat kepercayaan, Catatan) dari Google Sheet, diubah jadi angka.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
quarter: r[0], gdp_yoy: Number(r[1]), unit: r[2], source: r[3], url: r[4], confidence: r[5], notes: r[6],
})),
});
dash.loader('retail', {
description: 'Baris tab Penjualan Ritel (Periode, Penjualan Ritel YoY, Unit, Penerbit, URL sumber, Tingkat kepercayaan, Catatan) dari Google Sheet, diubah jadi angka.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], retail_yoy: Number(r[1]), unit: r[2], source: r[3], url: r[4], confidence: r[5], notes: r[6],
})),
});
dash.loader('ikk', {
description: 'Baris tab Keyakinan Konsumen (Periode, IKK, Unit, Penerbit, URL sumber, Tingkat kepercayaan, Catatan) dari Google Sheet, diubah jadi angka.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], ikk: Number(r[1]), unit: r[2], source: r[3], url: r[4], confidence: r[5], notes: r[6],
})),
});
dash.loader('birate', {
description: 'Baris tab BI Rate (Periode, BI Rate, Unit, Penerbit, URL sumber, Tingkat kepercayaan, Catatan) dari Google Sheet, diubah jadi angka.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], bi_rate: Number(r[1]), unit: r[2], source: r[3], url: r[4], confidence: r[5], notes: r[6],
})),
});
dash.loader('inflation', {
description: 'Baris tab Inflasi (Periode, Inflasi YoY, Unit, Penerbit, URL sumber, Tingkat kepercayaan, Catatan) dari Google Sheet, diubah jadi angka.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], inflation_yoy: Number(r[1]), unit: r[2], source: r[3], url: r[4], confidence: r[5], notes: r[6],
})),
});
dash.loader('rupiah', {
description: 'Baris tab Rupiah (Periode, USD/IDR rata-rata bulanan, Unit, Penerbit, URL sumber, Tingkat kepercayaan, Catatan) dari Google Sheet; angka "16,520.03" dijadikan angka.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], usd_idr: Number(String(r[1]).replace(/,/g, '')), unit: r[2], source: r[3], url: r[4], confidence: r[5], notes: r[6],
})),
});
dash.loader('flow', {
description: 'Tabel bulanan arus asing di saham dari tab Arus Modal Asing (baris Okt\'25–Sep\'26); sel kosong jadi kosong, bukan nol.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0],
flow_idr_t: (r[1] === undefined || r[1] === '') ? null : Number(String(r[1]).replace(/,/g, '')),
unit: r[2], source: r[3], url: r[4], confidence: r[5], notes: r[6],
})),
});
dash.loader('rotation', {
description: 'Tabel bulanan SBN (kolom A–G) plus kolom H = arus saham yang ditarik rumus dari tabel saham di tab yang sama; sel kosong jadi kosong, bukan nol.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], sbn_idr_t: numOrNull(r[1]), stock_idr_t: numOrNull(r[7]),
source: r[3], url: r[4], confidence: r[5], notes: r[6] || '',
partial: String(r[6] || '').toUpperCase().indexOf('PARSIAL') === 0,
})),
});
dash.loader('srbi', {
description: 'Tabel pendukung kepemilikan asing di SRBI (posisi akhir bulan, Rp triliun) dari tab Arus Modal Asing.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], srbi_idr_t: numOrNull(r[1]), unit: r[2], source: r[3], url: r[4], confidence: r[5], notes: r[6],
})),
});
dash.loader('gpmi', {
description: 'Baris tab PMI Global: J.P. Morgan Global Manufacturing PMI bulanan (kolom B), sumber dan kepercayaan.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], gpmi: numOrNull(r[1]), unit: r[2], source: r[3], url: r[4], confidence: r[5], notes: r[6],
})),
});
dash.loader('ism', {
description: 'Baris tab ISM AS: ISM Manufacturing PMI AS bulanan (kolom B), sumber dan kepercayaan.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], ism: numOrNull(r[1]), unit: r[2], source: r[3], url: r[4], confidence: r[5], notes: r[6],
})),
});
dash.loader('gdpus', {
description: 'Baris tab PDB AS: PDB riil AS QoQ laju tahunan per kuartal (kolom B), sumber dan kepercayaan.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
quarter: r[0], gdp_us: numOrNull(r[1]), unit: r[2], source: r[3], url: r[4], confidence: r[5], notes: r[6],
})),
});
dash.loader('trade', {
description: 'Baris tab Perdagangan per Mitra: ekspor (B) dan impor (C) nonmigas kumulatif, koordinat titik peta (I, J), sumber dan kepercayaan (G).',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
partner: r[0], exp: numOrNull(r[1]), imp: numOrNull(r[2]), unit: r[3], source: r[4], url: r[5], confidence: r[6], notes: r[7], lon: numOrNull(r[8]), lat: numOrNull(r[9]),
})),
});
dash.loader('cpmi', {
description: 'Baris tab PMI China: PMI manufaktur resmi China (NBS) bulanan (kolom B), sumber dan kepercayaan.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], cpmi: numOrNull(r[1]), unit: r[2], source: r[3], url: r[4], confidence: r[5], notes: r[6],
})),
});
dash.loader('komoditas', {
description: 'Baris tab Komoditas: harga bulanan batu bara (B), CPO (C), nikel (D) dalam USD/ton, sumber dan kepercayaan (H).',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], coal: numOrNull(r[1]), cpo: numOrNull(r[2]), nickel: numOrNull(r[3]), unit: r[4], source: r[5], url: r[6], confidence: r[7], notes: r[8],
})),
});
dash.loader('saham', {
description: 'Baris tab Saham: penutupan akhir bulan IHSG (B), IDXFINANCE (C), BBCA (I), BBRI (J), BMRI (K), BBNI (L) dari rumus Google Finance, sumber dan kepercayaan (G).',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], ihsg: numOrNull(r[1]), fin: numOrNull(r[2]), unit: r[3], source: r[4], url: r[5], confidence: r[6], notes: r[7],
bbca: numOrNull(r[8]), bbri: numOrNull(r[9]), bmri: numOrNull(r[10]), bbni: numOrNull(r[11]),
})).filter((r) => r.ihsg !== null),
});
dash.loader('kredit', {
description: 'Baris tab Kredit per Provinsi: kredit total, pertanian, pertambangan, industri (Agu 2025 dan Agu 2026, Rp miliar), koordinat titik, sumber dan kepercayaan (T).',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
code: r[0], prov: r[1], tot0: numOrNull(r[2]), tot1: numOrNull(r[3]), agr0: numOrNull(r[5]), agr1: numOrNull(r[6]), min0: numOrNull(r[8]), min1: numOrNull(r[9]), ind0: numOrNull(r[11]), ind1: numOrNull(r[12]),
lon: numOrNull(r[14]), lat: numOrNull(r[15]), unit: r[16], source: r[17], url: r[18], confidence: r[19], notes: r[20],
})).filter((r) => r.lon !== null && r.tot1 !== null),
});
dash.loader('fed', {
description: 'Baris tab Fed Funds (posisi akhir bulan): batas atas target (kolom B), batas bawah (H), titik tengah (I), sumber dan kepercayaan.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], fed_upper: numOrNull(r[1]), fed_lower: numOrNull(r[7]), fed_mid: numOrNull(r[8]),
source: r[3], url: r[4], confidence: r[5], notes: r[6],
})),
});
dash.loader('tambang', {
description: 'Baris tab Saham Tambang: penutupan akhir bulan IDXENERGY (B), IDXBASIC (C), ADRO/PTBA/ITMG/BUMI (I-L), ANTM/INCO/MDKA/AMMN (M-P) dari rumus Google Finance, sumber dan kepercayaan (G).',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], energy: numOrNull(r[1]), basic: numOrNull(r[2]), unit: r[3], source: r[4], url: r[5], confidence: r[6], notes: r[7],
adro: numOrNull(r[8]), ptba: numOrNull(r[9]), itmg: numOrNull(r[10]), bumi: numOrNull(r[11]),
antm: numOrNull(r[12]), inco: numOrNull(r[13]), mdka: numOrNull(r[14]), ammn: numOrNull(r[15]),
})).filter((r) => r.energy !== null),
});
dash.loader('sahamasia', {
description: 'Baris tab Saham Asia: penutupan akhir bulan IHSG (B), S&P 500 (C), indeks Asia (I-O: Nifty, KOSPI, Nikkei, Hang Seng, TAIEX, ASX 200, Shenzhen), ETF USD (P-V: THD, EWM, EPHE, EWS, VNM, EIDO, EEM), kepercayaan (G).',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], ihsg: numOrNull(r[1]), spx: numOrNull(r[2]), unit: r[3], source: r[4], url: r[5], confidence: r[6], notes: r[7],
nifty: numOrNull(r[8]), kospi: numOrNull(r[9]), nikkei: numOrNull(r[10]), hsi: numOrNull(r[11]), taiex: numOrNull(r[12]), asx: numOrNull(r[13]), sz: numOrNull(r[14]),
thd: numOrNull(r[15]), ewm: numOrNull(r[16]), ephe: numOrNull(r[17]), ews: numOrNull(r[18]), vnm: numOrNull(r[19]), eido: numOrNull(r[20]), eem: numOrNull(r[21]),
})).filter((r) => r.ihsg !== null),
});
dash.loader('sbn', {
description: 'Baris tab Yield SBN: yield SBN 10 tahun (B), UST 10 tahun (C), penerbit (E), URL (F), kepercayaan (G), catatan (H), selisih (I).',
fn: ({ answer }) => sheetRows(answer).map((r) => ({ date: r[0], sbn: numOrNull(r[1]), ust: numOrNull(r[2]), source: r[4], url: r[5], confidence: r[6], notes: r[7], spread: numOrNull(r[8]), iso: r[9] })).filter((r) => r.sbn !== null),
});
dash.loader('asingksei', {
description: 'Baris tab Asing KSEI (A2:H9): nilai saham dipegang asing Rp triliun (B), porsi asing % (C), kepercayaan (G).',
fn: ({ answer }) => sheetRows(answer).map((r) => ({ month: r[0], value: numOrNull(r[1]), share: numOrNull(r[2]), source: r[4], url: r[5], confidence: r[6], notes: r[7] })).filter((r) => r.value !== null),
});
dash.loader('asingnegara', {
description: 'Tab Asing KSEI (A14:H18): negara asal manajer investasi asing dan jumlah emiten yang dipegang (>1%), per 31 Jul 2026.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({ country: r[0], n: numOrNull(r[1]), source: r[4], url: r[5], confidence: r[6], notes: r[7] })).filter((r) => r.n !== null),
});
dash.loader('sektor', {
description: 'Tab Sektor IHSG (A2:I13): kapitalisasi dan bobot 11 sektor IDX-IC akhir Mar 2026, saham terbesar, kepercayaan.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({ label: r[0], cap: numOrNull(r[1]), w: numOrNull(r[2]), source: r[4], url: r[5], confidence: r[6], notes: r[7], top: r[8] })).filter((r) => r.label && r.cap !== null),
});
dash.loader('asingrisiko', {
description: 'Tab Asing KSEI (A21:H24): konsentrasi net sell asing, estimasi dana pasif keluar (skenario), dan catatan arus per negara asal tidak tersedia.',
fn: ({ answer }) => sheetRows(answer).map((r) => ({ label: r[0], value: numOrNull(r[1]), unit: r[2], source: r[4], url: r[5], confidence: r[6], notes: r[7] })).filter((r) => r.label),
});
dash.loader('valuasi', {
description: 'Baris tab Valuasi IHSG: PER (B), PBV (C), penerbit (E), URL (F), kepercayaan (G), catatan (H).',
fn: ({ answer }) => sheetRows(answer).map((r) => ({ date: r[0], per: numOrNull(r[1]), pbv: numOrNull(r[2]), source: r[4], url: r[5], confidence: r[6], notes: r[7], kind: r[8], avg: r[9], pos: r[10] })).filter((r) => r.per !== null),
});
dash.loader('sahamglobal', {
description: 'Baris tab Saham Global: penutupan akhir bulan IHSG (B), S&P 500 (C), FTSE 100 (I), DAX (J), CAC 40 (K), Nikkei 225 (L), Hang Seng (M), CSI 300 (N), ETF URTH dan EIDO dalam USD (O-P), kepercayaan (G).',
fn: ({ answer }) => sheetRows(answer).map((r) => ({
month: r[0], ihsg: numOrNull(r[1]), spx: numOrNull(r[2]), unit: r[3], source: r[4], url: r[5], confidence: r[6], notes: r[7],
ftse: numOrNull(r[8]), dax: numOrNull(r[9]), cac: numOrNull(r[10]), nikkei: numOrNull(r[11]), hsi: numOrNull(r[12]), csi: numOrNull(r[13]), urth: numOrNull(r[14]), eido: numOrNull(r[15]),
})).filter((r) => r.ihsg !== null),
});
})();
