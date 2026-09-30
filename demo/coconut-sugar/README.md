# Case gula kelapa Talunai

Satu transaksi B2B simulasi berdasarkan konteks publik Unilever Indonesia. Bukan pesanan Unilever nyata dan bukan kemitraan dengan Talunai. Sumber, keputusan harga dan kuantitas tersedia di [research.json](./research.json). Rencana dan hasil inspeksi awal tersedia di [PLAN.md](./PLAN.md).

## Jalankan dari root repository

```bash
npm run demo:validate
npm run demo:prepare
npm run demo:run
```

`prepare` membuat dokumen, mengecek/menjalankan layanan lokal, melakukan onboarding participant lewat admin API, memberi gas uji secukupnya, mengaktifkan lender melalui transaksi admin yang sah, dan mencetak MockIDR uji untuk dua wallet peserta. `run` menjalankan satu deal melalui auth, CSRF, RBAC, evidence gates, consent, transaction intents dan event projection yang asli. Backend API dipanggil melalui handler produksi dalam proses tooling, seperti smoke test testnet yang sudah ada; browser menggunakan server Next.js asli.

Jika hanya ingin PDF dan manifest tanpa jaringan, minting atau transaksi:

```bash
npm run demo:documents
```

Default capture aktif. Transaksi ditandatangani dan dikirim oleh wallet viem, kemudian Playwright mengambil state nyata di UI. Tidak ada wallet popup palsu. Seluruh aksi admin dan verifikator merupakan aksi aktor demo yang discript, tetap memerlukan kewenangan produk/onchain. Ini tidak membuktikan review manusia atau pengakuan Unilever di dunia nyata.

## Prasyarat

- `.env.testnet`: private key admin dan verifier development yang sudah sesuai deployment. Key peserta case dibuat sendiri di `.local/coconut-sugar/wallets.json` (0600), tidak diekspor ke artifact publik.
- `.env.local` dan `.env.worker`: konfigurasi DB/chain sama; `LLM_MODE=live`, model sama. API key hanya di `.env.worker`.
- PostgreSQL lokal yang dikonfigurasi harus sudah memiliki database testnet/migrations dan akun admin/verifier seeded. Tooling dapat menghidupkan instance embedded Postgres yang sudah disiapkan pada port 55432; tidak mereset atau mengganti database.
- RPC BNB Chain Testnet chain 97; kontrak Registry/Vault/AgentExecutor/MockIDR sesuai konfigurasi. Token harus `MockIDR`, 0 decimals.
- Admin mempunyai gas testnet, role admin vault dan minter MockIDR. Verifier memiliki role verifier registry. Jika gas tidak cukup, tooling berhenti sebelum bootstrap.
- Key/model OpenRouter aktif, credit memadai dan model mendukung structured outputs. Tidak ada fallback ke mock jika koneksi/model gagal.
- Chromium Playwright tersedia. Bila menggunakan binary khusus, set `CASE_CHROMIUM_PATH`. TLS lokal `.local/testnet-tls/localhost-key.pem` dan `localhost.pem` mengikuti setup produk saat ini.

Tooling menunggu heartbeat worker live dan projection indexer. Jika indeks tertinggal lebih dari 500 block, tooling memulihkan header dan receipt melalui mekanisme backfill yang sudah ada sebelum memverifikasi projection aktual. Worker lama dari repo yang berbeda model/mode dihentikan secara graceful sebelum worker live dijalankan. Web yang sedang berjalan dengan konfigurasi mock harus direstart; tooling tidak menimpa server milik user.

## Satu sumber data

`spec.json` mengunci 4.000 kg × Rp25.000 = invoice Rp100.000.000, belum dibayar sebelumnya, funding Rp70.000.000, fee tetap Rp1.050.000, entitlement lender Rp71.050.000, residual supplier Rp28.950.000. Tanggal invoice dibuat sekali saat prepare; jatuh tempo +45 hari kemudian. Pengiriman dianggap terjadi pada tanggal invoice. Ini asumsi untuk demo.

Payment terms diambil melalui ekstraksi OpenRouter tambahan yang hanya membaca PDF. Schema agent inti yang sudah ada tetap dipakai untuk semua field utama; pemetaan nama di summary dapat memakai `issuerName` sebagai seller, `goodsDescription` sebagai product dan `proofOfDeliveryReference` sebagai delivery reference.

Label settlement di PDF adalah **IDRT · BNB Chain Testnet**, dengan penanda simulasi kecil. Token kontrak tetap mengikuti deployment yang ada; `demo-truth.json` mencatat alamat/token aktual dan tidak menganggap label tampilan sebagai integrasi IDRT mainnet.

Flow consent mengikuti gate produk: agent → review verifikator → supplier/buyer tanda tangan versi reviewed → register → direct lender funds → buyer pays → claimable → withdraw. PDF pengakuan buyer adalah evidence sintetis sebelum consent final; bukan signature atau pengakuan utang sungguhan.

## Re-run dan recovery

Re-run melanjutkan invoice yang sama. Jurnal menyimpan signed hash sebelum broadcast dan raw signed transaction hanya dalam `.local/`. Receipt wajib sukses, canonical setelah confirmations, lalu financial projection harus terkonfirmasi. Completed case diverifikasi ulang tanpa funding/payment kedua. Jangan menghapus jurnal setelah broadcast yang belum pasti.

Jika funding window 23 jam sudah habis sebelum deal didanai, buat instance baru:

```bash
npm run demo:prepare -- --instance=run-20261001
npm run demo:run -- --instance=run-20261001
```

Instance baru memakai organisasi/wallet case yang sama, dengan invoice, reference, dan artifact terpisah. Tidak menghapus sejarah chain atau mengubah terms yang sudah ditandatangani. Kegagalan provider sementara dapat diulang melalui API retry admin yang sah, maksimal tiga kali dan hanya untuk versi yang sama. Kesalahan schema/provenance, konflik dan stale karena versi berubah tetap menghentikan flow.

`--no-capture` menjalankan transaksi tanpa screenshot; gunakan hanya jika ingin menguji chain terlebih dahulu. Hasilnya belum memenuhi paket visual penuh. Screenshot state lama tidak dapat direkonstruksi sebagai screenshot live setelah settlement. Jalankan instance baru dengan capture untuk bukti tiap tahap.

## Artifact

`demo-artifacts/coconut-sugar/hero/` (atau nama instance) berisi:

- `documents/invoice.pdf`, `delivery-note.pdf`, `buyer-acknowledgement.pdf`, manifest SHA-256.
- `scenario.json`, `identities.json`, `chain-configuration.json`, `case-state.json`.
- `agent-run.json`, `agent-extraction.json`, `commercial-extraction.json` setelah OpenRouter benar-benar berhasil.
- `settlement-before-withdrawal.json`, `financing-final.json`, `deal-final.json` setelah tahapnya berjalan.
- `transactions/*.receipt.json`, `transaction-intents.json`, `audit.json`, `evidence.json` setelah eksekusi aktual.
- `screenshots/01-problem.png`, `02-supplier-deal.png`, `03-buyer-confirm.png`, `04-agent-checks.png`, `05-ready-to-fund.png`, `06-funded.png`, `07-settled.png`, `08-completed.png`; tambahan crop `*-main.png` dan manifest dengan hash.
- `case-summary.json`, `CASE_SUMMARY.md`, `demo-truth.json` untuk input pitch/video selanjutnya. Klaim belum dieksekusi tetap ditandai.
- `qa/offline-validation.json`: parser dan money model; tidak membuktikan koneksi LLM/chain.
- `qa/pdf-visual-qa.json` dan `qa/*-preview.png`: pemeriksaan layout ketiga PDF, bukan screenshot aplikasi. Bisa dibuat dengan `python3 demo/coconut-sugar/pdf-qa.py` jika PyMuPDF tersedia.
- `last-attempt.json` bila ada kegagalan, dengan error yang sudah disanitasi.

Folder artifact lokal di-ignore Git; private key dan raw signed transactions juga tidak masuk artifact publik. Video kakao sebelumnya merupakan arsip kasus lain dan tidak otomatis diubah oleh tooling ini.

`case-summary.json.submissionEvidence.ready` hanya bernilai true bila flow selesai **dan** semua bukti agent, receipt, serta capture yang diperlukan tersedia. Keberhasilan transaksi tanpa capture belum menjadi paket bukti submission lengkap.

## Catatan pengujian saat ini

Hasil pengecekan tersimpan dalam [QA.md](./QA.md). Case `hero` sudah **COMPLETED** pada 30 September 2026: OpenRouter GPT-4.1 live, 13 transaksi testnet terkonfirmasi, kedua withdrawal selesai dan semua screenshot tahap tersedia. Kegagalan socket/parser dari runtime terbatas sebelumnya sudah teratasi setelah akses jaringan diaktifkan; parser dan batas isolasinya tetap dipertahankan. Re-run memverifikasi state yang sama tanpa transaksi baru.
