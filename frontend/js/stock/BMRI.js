/*
 * BMRI (Bank Mandiri): everything specific to this stock that is not a number
 * in the Sheet: names, which datasets hold its data, valuation defaults,
 * dividend scenarios, and the analyst's narrative (in Indonesian).
 *
 * The numbers the narrative quotes (e.g. "18,4% pada September") are facts
 * from reports at the time of writing; update them when you update the Sheet.
 *
 * To add another stock: copy this file to <CODE>.js, change the fields, add
 * its datasets to config/datasets.yaml, and add <script src="js/stock/<CODE>.js">
 * to stock.html.
 */
(function () {
  const H = () => window.EOLab; // helpers from engine.js (pct, spct, fv, dvPx, ...)
  window.EO_STOCKS = window.EO_STOCKS || {};
  window.EO_STOCKS.BMRI = {
    code: 'BMRI', sector: 'bank', name: 'Bank Mandiri', short: 'Mandiri', full: 'PT Bank Mandiri (Persero) Tbk',
    // dataset ids in config/datasets.yaml
    ds: { price: 'bmri_price', fund: 'bmri_fund', fh: 'bmri_fh', dv: 'bmri_dv', flow: 'bmri_flow' },
    // year-end closes, used only when the price sheet lacks that year
    dvpx: { 2016: 2894, 2017: 4000, 2018: 3688, 2019: 3838, 2020: 3163, 2021: 3513, 2022: 4963, 2023: 6050, 2024: 5700, 2025: 5100 },
    dvapprox: {},
    dvs: [{ n: 'Tahun lemah', g: 5, p: 60 }, { n: 'Kasus dasar', g: 15, p: 75 }, { n: 'Tahun kuat', g: 20, p: 79 }],
    val: { coe: 12.5, g: 5.5, eg: 3, roeT: 17 },
    fundNote: 'Fundamental dibaca dari tab Fundamental di sheet BMRI (hasil H1 2026). Ekuitas per 30 Juni 2026 adalah estimasi (nilai buku per saham Rp 3.132); rasio lain dari laporan SSI, Kontan, BCA Sekuritas dan BRI Danareksa.',
    flowNote: 'Arus dibaca dari tab Arus asing di sheet BMRI (sampai 26 Okt 2026 untuk BMRI, 13 Nov 2026 untuk seluruh pasar). Angka harian BMRI tidak lengkap: 19 sampai 23 Okt adalah total mingguan yang dibagi rata, dan hari tanpa laporan dibiarkan kosong.',
    x: {
      lgI: 'Interim (dibayar Januari 2026 dan Oktober 2026)',
      lgF: 'Final, dibayar April atau Mei tahun berikutnya',
      stillCol: 'Masih akan datang (final)',
      carNote: 'Bantalan terhadap kerugian. Rasio bank saja; manajemen menargetkan 18% sampai 20%.',
      ddmNote: 'Cocok untuk BMRI karena sebagian besar labanya dibagikan.',
      getNote: function (pg) {
        const { pct } = H();
        return ' Laba tumbuh ' + pct(pg / 100, 1) + ' pada semester pertama, termasuk yang tercepat di antara bank besar. Masalahnya ada di margin: net interest margin bank saja menyempit dari 4,63% ke 4,37%, dan pada kuartal ketiga pertumbuhan laba melambat menjadi 13,9% secara tahunan (sembilan bulan: Rp 45,5 T, +20,7%).';
      },
      safeNote: function () {
        const { pct, spct, fv } = H();
        return 'Laba bank hanya sebaik kreditnya. BMRI menumbuhkan kredit dengan cepat (' + spct(fv('loan_growth') / 100, 1) + '), dipimpin pinjaman ke pemerintah dan BUMN, dan itu memakan modal: rasio modal bank saja ' + pct(fv('car') / 100, 1) + ' pada Juni dan 18,4% pada September, di bawah target manajemen 18% sampai 20%. Kredit bermasalah bruto rendah di ' + pct(fv('npl') / 100, 1) + ', tetapi loan at risk (ukuran lebih luas yang juga memuat kredit terlambat tetapi belum macet) naik dari ' + pct(fv('lar') / 100, 1) + ' pada Juni ke 6,8% pada September, dan biaya dana menekan margin (NIM bank saja 3,9% di kuartal ketiga). Sebuah bank bisa tampak kokoh sementara tepi-tepi ini bergerak.';
      },
      fhSrc: 'Nilai buku dan laba per saham memakai ekuitas dan laba yang diatribusikan ke entitas induk dari laporan audit Bank Mandiri (2016 sampai 2020) dan riset BRI Danareksa, MNC Sekuritas dan stockanalysis.com (2021 sampai 2025), disesuaikan dengan stock split dua-untuk-satu tahun 2018 dan 2023 (93,33 miliar saham saat ini). Nilai buku Juni 2026 adalah estimasi. Dalam kenyataan nilai buku turun setiap April atau Mei saat dividen final dibayar.',
      peerTail: function () { return ''; },
      flowRole: ' Uji seluruh pasar paling penting untuk BMRI: dana asing yang harus mengurangi eksposur Indonesia menjual saham terbesar dan paling likuid lebih dulu, dan saham seperti BMRI jarang pulih selama seluruh pasar masih dijual.',
      mktWhy: 'Bank besar dan likuid seperti BMRI termasuk yang pertama dijual dana asing, jadi jarang pulih selama seluruh pasar masih dijual.',
      barCap: function (open) { return 'Setiap batang adalah dividen untuk satu tahun buku. Sampai FY2025 Bank Mandiri membayar satu dividen final pada Maret sampai Juni tahun berikutnya. Bagian lebih terang di bawah adalah interim yang dibayar di dalam tahun itu (yang pertama datang Januari 2026). Batang putus-putus adalah FY' + (open ? open.fy : '') + ' sejauh ini.'; },
      exDV: function (open, first, last) {
        const { dvPx } = H();
        return '<p><b>Dalam bahasa sederhana.</b> Dividen per saham naik dari ' + dvPx(first.total) + ' menjadi ' + dvPx(last.total) + '. Hampir semuanya adalah dividen final, dibayar pada musim semi setelah RUPS, karena itu FY' + (open ? open.fy : '') + ' tampak kecil untuk sekarang: baru interim yang dibayar' + (open ? ' (' + dvPx(open.interim) + ')' : '') + '. Dividen final ditetapkan di RUPS awal tahun depan. Penurunan FY2020 mengikuti laba, yang turun di tahun Covid itu.</p>';
      },
      fyG: '+0,9%',
      capOk: ' Modal bukan hal yang akan memaksa pemotongan.',
      dNothing: 'Tidak ada yang mengarah ke pemotongan: bank menghasilkan lebih dari yang dibayarkannya. Yang perlu diawasi adalah modal, yang cukup tetapi tidak berlimpah, dan rasio pembayaran sekitar 79% yang menyisakan sedikit ruang untuk naik lagi.',
      dpIntro: function (last) {
        const { pct, fv } = H();
        return 'Bank Mandiri membagikan 60% laba untuk FY2019 sampai FY2023 (tingkat yang diminta pemegang saham negara, menurut Bisnis), lalu menaikkannya ke sekitar 78% sampai 79%. Kini bank menahan ' + pct(1 - last.pay, 0) + '. Dengan ROE sekitar ' + (isFinite(fv('roe')) ? fv('roe').toFixed(0) : '22') + '%, bagian yang ditahan masih menumbuhkan nilai buku, tetapi rasio modal bank saja ' + pct(fv('car') / 100, 1) + ' berarti rasio pembayaran yang lebih tinggi bersaing dengan pertumbuhan kredit untuk modal.';
      },
      dpLast: '',
      exScen: function (open, last) {
        const { dvPx } = H();
        return '<p><b>Yang sudah pasti.</b> ' + (open ? dvPx(open.interim) + ' sudah dibayar untuk FY' + open.fy + ' (interim yang dibayar 2 Oktober 2026). ' : '') + 'Untuk FY' + last.fy + ' bank membayar interim Rp100 pada Januari 2026, lalu final Rp376,96 pada Mei, total ' + dvPx(last.total) + '. Interim kini datang lebih awal dalam siklus, jadi uang tunai tiba lebih cepat, tetapi tetap dihitung dalam total tahun itu.</p><p><b>Yang belum.</b> Dividen final FY' + (open ? open.fy : last.fy + 1) + ' berasal dari RUPS 2027, yang tanggalnya belum diumumkan, dan pemegang saham negara ikut menentukan rasio pembayaran. Ini skenario, bukan ramalan.</p>';
      },
      watch: function (o) {
        const { pct, spct } = H();
        return '<li><b>Dividen final dan rasio pembayaran FY' + o.fy + '.</b> RUPS awal 2027 menetapkan keduanya. Rasio pembayaran FY2025 79%. Dividen final FY2025 ex-dividen 11 Mei 2026, dibanding 14 April setahun sebelumnya, jadi waktunya juga bisa bergeser.</li>' +
          '<li><b>Pertumbuhan laba.</b> Laba semester pertama tumbuh ' + (isFinite(o.pg) ? spct(o.pg / 100, 1) : 'kuat') + ' dan laba sembilan bulan tumbuh 20,7% (Rp 45,5 T), tetapi kuartal ketiga hanya +0,6% dibanding kuartal kedua. Dividen hanya bisa tumbuh lebih cepat dari laba bila rasio pembayaran naik lagi, dan ' + pct(o.last.pay, 0) + (o.isMax ? ' sudah tertinggi di jendela ini.</li>' : ' masih menyisakan ruang naik.</li>') +
          '<li><b>Modal.</b> Rasio modal ' + (isFinite(o.car) ? o.car.toFixed(1).replace('.', ',') + '%' : 'n/a') + ' (bank saja, Juni) di bawah target manajemen 18% sampai 20%, dan satu laporan broker mengingatkan hal ini bisa membatasi pertumbuhan atau dividen. Pada September 18,4%.</li>' +
          '<li><b>Loan at risk.</b> Ukuran yang lebih luas ini naik ke 6,8% pada September dari 5,9% pada Juni. Kalau mengalir ke biaya kredit, laba dan dividen ikut terdampak.</li>' +
          '<li><b>Jangan pakai harga saham untuk ini.</b> Penjualan asing dan tinjauan MSCI menggerakkan harga, dan karena itu imbal hasil dividen. Bank Mandiri membayar sekian rupiah per saham berapa pun harga pasarnya. Risiko bagi dividen adalah laba dan modal, bukan harga.</li>';
      },
      dvSrc: 'Jumlah per saham, disesuaikan dengan stock split dua-untuk-satu Bank Mandiri tahun 2018 dan 2023 (93,33 miliar saham saat ini); angka FY2015 sampai FY2018 dibagi empat atau dua dari jumlah aslinya. Dihimpun dari riwayat pembayaran Digrin, Bisnis, Kontan, Bareksa, Kabarbursa, Investortrust, stockanalysis.com, Jakarta Post dan Wartaekonomi. FY2015 bertumpu pada satu sumber. Laba per saham dari tab Riwayat fundamental. Harga akhir tahun dari sheet harga, atau dari angka bawaan bila tahunnya tidak ada.',
    },
  };
})();
