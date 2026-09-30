# QA case gula kelapa

Tanggal pemeriksaan: 30 September 2026. Ini laporan hasil yang sudah diamati, bukan klaim bahwa runtime jaringan selesai.

## Lolos

- TypeScript repository: `npm run typecheck` dan pemeriksaan non-incremental pada revisi retry.
- ESLint tooling case: `node node_modules/eslint/bin/eslint.js demo/coconut-sugar --max-warnings=0`.
- Parser PDF produk melalui direct CLI: ketiga dokumen text-bearing berhasil diekstrak; referensi, tanggal, nominal, quantity dan disclosure diperiksa. Hasil aktual di `qa/offline-validation.json`.
- Accounting offline: quote 1,5% dari pokok, lender-first waterfall untuk pembayaran sebagian/penuh, sisa supplier, setelah withdrawal dan penolakan overpayment. Mutasi nilai outstanding pada teks invoice menghasilkan konflik, bukan approval.
- Visual PDF: `python3 demo/coconut-sugar/pdf-qa.py`; tidak ditemukan clipping/overlap, IDRT dan Testnet tampil, MockIDR tidak tampil di dokumen. Ketiga preview juga diperiksa secara visual.
- Review API: onboarding, review, consent, retry, transaction preparation dan capture memakai interface produk yang sudah ada. Tidak ada penulisan langsung ke state deal, permission atau financial projection dalam database.

## Runtime aktual terbukti

- OpenRouter `openai/gpt-4.1` memproses tiga PDF; 15 field utama dan payment terms cocok dengan sumber actual. Agent run `ed4d7f73-f7f9-4258-ab85-eec4a1fbb636` berstatus live/COMPLETED.
- Tiga organisasi dan wallet peserta mengikuti onboarding admin API.
- Deal `c8ea1af0-7394-49db-9e23-0ea7a5bb8036` diregistrasi, didanai, dibayar penuh dan kedua hak ditarik pada BNB Chain Testnet. Ada 13 receipt termasuk provisioning, 7 di antaranya aksi aplikasi.
- Projection terkonfirmasi, perubahan saldo diverifikasi: pemasok menerima total 98.950.000; pendana mendapat keuntungan bersih 1.050.000; buyer membayar 100.000.000 token uji.
- Screenshot actual UI untuk setiap tahap tersedia. `submissionEvidence.ready=true`, tidak ada artifact wajib yang hilang.
- Re-run selesai tanpa funding, payment atau withdrawal kedua.
- Enam file tes terkait: **98/98 lolos**, termasuk parser PDF, provider structured outputs dan lock filesystem.

Percobaan awal berhenti dengan `NETWORK_SOCKET_DENIED`. Setelah akses jaringan diaktifkan, pemeriksaan menemukan RPC tidak menyediakan state historis (`missing trie node`). Riwayat dipulihkan lewat header/receipt yang diverifikasi, kemudian indexer membangun projection aktual. Model Qwen diganti GPT-4.1 dan prompt JSON diperbaiki; smoke provider nyata lolos. Lock lintas namespace juga diperbaiki dan diuji. `last-attempt.json`, `case-state.json` dan `demo-truth.json` sekarang mencatat keberhasilan aktual.

## Kendala runtime pengujian

Pada runtime terbatas sebelumnya, subset tes menghasilkan 81 lolos dan 5 gagal pada subprocess PDF. Setelah pembatas dilepas, seluruh subset yang diperluas menjadi 98 tes lolos. Parser produk tidak diubah. Probe lama menunjukkan stdio socket child Node terputus; syscall pembatas spesifik tidak diidentifikasi.

Parser produk, subprocess isolation dan security boundary tidak diubah. Untuk membuktikan jaringan/capture, jalankan di terminal lokal normal:

```bash
npm run demo:validate
npm run demo:run
```

`run` otomatis memanggil `prepare` dan menjalankan capture. Jika terganggu, ulangi perintah yang sama; jurnal mempertahankan hash sebelum broadcast. Agent retry hanya untuk kegagalan provider sementara, melalui endpoint admin, dengan batas percobaan produk. Tidak ada bypass untuk evidence conflict atau stale karena perubahan versi.

Paket dianggap siap dipakai sebagai bukti hanya setelah `case-summary.json.submissionEvidence.ready` bernilai `true`.
