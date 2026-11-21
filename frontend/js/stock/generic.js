/*
 * Any stock added from the page (a row in the Saham sheet's Daftar tab) gets
 * its profile from here: names, dataset ids, valuation defaults, and a
 * narrative written from its own numbers rather than by hand.
 *
 * A stock that deserves hand-written commentary can still get its own file,
 * like js/stock/BMRI.js; that file wins over this one.
 */
(function () {
  const H = () => window.EOLab; // helpers from engine.js, read when the text is built

  function make(row) {
    const code = String(row.code).toUpperCase();
    const bank = String(row.sector || '').trim().toLowerCase() === 'bank';
    const peers = String(row.peers || '').toUpperCase().split(/[,\s;/]+/).filter((c) => /^[A-Z]{4}$/.test(c) && c !== code).slice(0, 5);
    const name = String(row.name || '').trim() || code;
    return {
      code, name, short: name, full: name, sector: bank ? 'bank' : 'umum', peers, shared: true,
      // shared tabs (filtered by Kode) plus this stock's own price tab
      ds: { price: 'harga_' + code.toLowerCase(), fund: 'saham_fund', fh: 'saham_fh', dv: 'saham_dv', flow: 'saham_flow' },
      dvpx: {}, dvapprox: {},
      // payout of each case is set from the last full year when the dividends load
      dvs: [{ n: 'Tahun lemah', g: -10, p: 50 }, { n: 'Kasus dasar', g: 5, p: 50 }, { n: 'Tahun kuat', g: 15, p: 50 }],
      val: bank ? { coe: 12.5, g: 5, eg: 5, roeT: 15 } : { coe: 13, g: 5, eg: 5, roeT: 12 },
      fundNote: 'Fundamental dibaca dari tab Fundamental di sheet Saham (Kode ' + code + '). Periode dan sumber tiap angka ada di kolom Catatan.',
      flowNote: 'Arus dibaca dari tab Arus asing di sheet Saham: baris Kode ' + code + ' untuk saham ini dan Kode PASAR untuk seluruh pasar.',
      x: {
        lgI: 'Interim (dibayar di dalam tahun buku)',
        lgF: 'Final, dibayar setelah RUPS tahun berikutnya',
        stillCol: 'Masih akan datang (final)',
        carNote: 'Bantalan terhadap kerugian.',
        ddmNote: 'Paling cocok bila ' + code + ' membagikan sebagian besar labanya secara teratur; untuk pembayar dividen yang tidak menentu, anggap hasilnya kasar.',
        getNote(pg) {
          const { spct, pgLabel } = H();
          return isFinite(pg) ? ' Laba ' + pgLabel() + ' tumbuh ' + spct(pg / 100, 1) + ' dibanding periode yang sama tahun lalu.' : '';
        },
        safeNote() {
          return bank
            ? 'Laba bank hanya sebaik kreditnya. Perhatikan tiga hal bersama: kredit bermasalah (NPL) yang naik, modal (CAR) yang menipis karena kredit tumbuh cepat, dan margin (NIM) yang menyempit saat biaya dana naik. Angka di atas adalah potret satu periode; bandingkan dengan laporan sebelumnya untuk melihat arahnya.'
            : 'Dua pertanyaan dasarnya: apakah laba benar-benar menjadi kas, dan seberapa besar utang menekan perusahaan saat bisnis melemah. Margin menunjukkan berapa yang tersisa dari setiap rupiah penjualan; utang terhadap ekuitas menunjukkan seberapa tebal bantalan pemilik. Bandingkan dengan pembanding di atas dan dengan laporan sebelumnya.';
        },
        fhSrc: 'Nilai buku, laba dan dividen per saham dari tab Riwayat fundamental di sheet Saham (sumber tiap baris di kolom Sumber).',
        peerTail() { return ''; },
        flowRole: ' Uji seluruh pasar (baris Kode PASAR) berlaku untuk semua saham: dana asing yang mengurangi eksposur Indonesia menjual di banyak saham sekaligus.',
        mktWhy: 'Saat dana asing mengurangi eksposur Indonesia, mereka menjual di banyak saham sekaligus, jadi satu saham jarang pulih selama seluruh pasar masih dijual.',
        barCap(open) { return 'Setiap batang adalah dividen untuk satu tahun buku: interim di bawah (lebih terang), final di atas.' + (open ? ' Batang putus-putus adalah FY' + open.fy + ' sejauh ini.' : ''); },
        exDV(open, first, last) {
          const { dvPx } = H();
          return '<p><b>Dalam bahasa sederhana.</b> Dividen per saham bergerak dari ' + dvPx(first.total) + ' pada FY' + first.fy + ' ke ' + dvPx(last.total) + ' pada FY' + last.fy + '.' +
            (open ? ' FY' + open.fy + ' baru sebagian dibayar (' + dvPx(open.interim) + '); sisanya biasanya ditetapkan di RUPS tahun depan.' : '') + '</p>';
        },
        fyG(g) { const { spct } = H(); return isFinite(g) ? spct(g, 1) + ' laba per saham' : 'n/a'; },
        capOk: ' Modal bukan hal yang akan memaksa pemotongan.',
        capTest: bank ? undefined : function () {
          const { fv, pct, nd } = H(), der = fv('der'), nc = fv('net_cash'), cash = isFinite(nc) && nc > 0;
          return {
            name: 'Neraca', why: 'Bisakah membayar tanpa berutang?',
            reading: cash ? 'Kas bersih sekitar Rp ' + nd(nc, 1) + ' T: kas lebih besar dari utang berbunga, jadi dividen tidak bergantung pada pinjaman.'
              : isFinite(der) ? 'Utang berbunga ' + pct(der / 100, 0) + ' dari ekuitas. ' + (der < 50 ? 'Rendah.' : der < 100 ? 'Sedang: pelunasan utang bersaing dengan dividen untuk kas.' : 'Tinggi: pelunasan utang bisa didahulukan daripada dividen.')
                : 'Angka utang belum diisi (kunci der atau net_cash di tab Fundamental).',
            status: cash || der < 50 ? 'ok' : der < 100 ? 'warn' : isFinite(der) ? 'bad' : 'warn',
          };
        },
        dNothing: 'Tidak ada uji yang memberi peringatan. Tetap periksa apakah laba ke depan cukup untuk mempertahankan rasio pembayaran.',
        dpIntro(last) { const { pct } = H(); return code + ' membagikan ' + pct(last.pay, 0) + ' dari laba FY' + last.fy + ' dan menahan ' + pct(1 - last.pay, 0) + ' untuk bisnisnya.'; },
        dpLast: '',
        exScen(open, last) {
          const { dvPx } = H();
          return '<p><b>Yang sudah pasti.</b> ' + (open && open.interim > 0 ? dvPx(open.interim) + ' sudah dibayar untuk FY' + open.fy + '. ' : 'Belum ada pembayaran untuk FY' + (last.fy + 1) + '. ') +
            'Untuk FY' + last.fy + ' totalnya ' + dvPx(last.total) + '.</p><p><b>Yang belum.</b> Dividen final ditetapkan di RUPS tahun depan dari laba setahun penuh dan keputusan pemegang saham. Ini skenario, bukan ramalan.</p>';
        },
        watch(o) {
          const { pct, spct, pgLabel } = H();
          return '<li><b>Rasio pembayaran FY' + o.fy + '.</b> Ditetapkan di RUPS. FY' + o.last.fy + ' ' + pct(o.last.pay, 0) + (o.isMax ? ', tertinggi di jendela ini, jadi ruang naiknya terbatas.' : '.') + '</li>' +
            '<li><b>Pertumbuhan laba.</b> ' + (isFinite(o.pg) ? 'Laba ' + pgLabel() + ' ' + spct(o.pg / 100, 1) + '. ' : '') + 'Dividen hanya bisa tumbuh lebih cepat dari laba bila rasio pembayaran naik.</li>' +
            (bank ? '<li><b>Modal.</b> Kredit yang tumbuh cepat memakan modal; rasio modal yang turun bisa membatasi dividen.</li>' : '<li><b>Utang dan kas.</b> Pelunasan utang dan belanja modal bersaing dengan dividen untuk kas.</li>') +
            '<li><b>Jangan pakai harga saham untuk ini.</b> Harga menggerakkan imbal hasil, tetapi ' + code + ' membayar sekian rupiah per saham berapa pun harganya. Risiko bagi dividen adalah laba dan kas, bukan harga.</li>';
        },
        dvSrc: 'Jumlah per saham dari tab Dividen di sheet Saham (sumber tiap baris di kolom Catatan). Laba per saham dari tab Riwayat fundamental. Harga akhir tahun dari tab Harga ' + code + '.',
      },
    };
  }

  window.EOGeneric = { make };
})();
