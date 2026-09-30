# Demo runbook

Ikuti setup native di README. Semua perintah dijalankan dari root repository dengan npm. Infrastrukturnya PostgreSQL localhost:55432, Anvil localhost:8545, Next.js localhost:3000, dan worker terpisah. Database persisten menyimpan challenge, workflow, outbox, intents dan event; jangan mengedit proyeksi agar tampak sukses.

## Urutan narasi sekitar lima menit

1. Tampilkan `/v1/config`: chain31337, alamat kontrak nyata, MockIDR decimals0, synthetic, mode mock, EOA.
2. `npm run demo:happy`: CLI login empat aktor via SIWE; borrower membuat invoice, upload, worker parse/analisis, verifier review, borrower/buyer menandatangani typed data berbeda, verifier sign registry transaction.
3. Lender sign allowance dan fund. Expected borrower menerima 70.000.000 atomik. Buyer membayar 50.000.000; lender dapat withdraw 50.000.000, sisa entitlement 21.050.000.
4. Buyer menambah 21.050.000. Tampilkan `REPAID` dengan invoice `PARTIALLY_COLLECTED` dan invoice outstanding 28.950.000. Lalu collection penuh dan pull withdrawals; lender total 71.050.000, residual borrower 28.950.000.
5. `npm run demo:hold`: dispute buyer yang diatribusikan ke evidence. Worker mengirim hold, direct funding simulation revert, verifier melakukan review baru dan clear. Tidak ada uang dikembalikan oleh hold.
6. Tampilkan hasil `demo:injection`/`duplicate` dan batas integrasi. Registri eksternal tidak terhubung, tidak ada bank settlement atau izin OJK yang diklaim.

## Perintah dan hasil yang diperiksa

| Perintah | Bukti executable |
| --- | --- |
| `npm run demo:happy` | Transaksi register, approve, fund, partial/full collection, withdrawals; expected/actual seluruh nominal |
| `npm run demo:duplicate` | Invoice pertama benar-benar funded. File kedua berbeda bytes/hash tetap menghasilkan nomor invoice sama; create ulang ditolak409 berdasarkan identitas organisasi/invoice |
| `npm run demo:injection` | Tiga branch: malicious wallet instruction, missing buyer acknowledgement, material conflict. Semuanya NEEDS_REVIEW, recipient tetap; tidak ada registrasi/funding yang dipaksakan |
| `npm run demo:hold` | Dispute terautentikasi → pg-boss/outbox → signed agent hold nyata → lender direct call gagal → human review/clear |
| `npm run demo:restart` | Worker Linux yang dimiliki proyek dihentikan; buyer transaction mined; proses indexer gagal sebelum commit; proses baru replay; collection tepat50 juta, bukan100 juta; worker dipulihkan |
| `npm run demo:late` | Anvil snapshot, waktu melewati due date, outstanding71,05 juta tetap; pembayaran terlambat50 juta mengurangi ke21,05 juta; snapshot dikembalikan dan projection direplay |
| `npm run demo:reorg` | Anvil snapshot/revert menghilangkan collection50 juta; proyeksi kembali0 dan reversal audit dipertahankan |

Fixture principal dan outstanding tidak diubah model. Tanggal baru dihitung ketika membuat claim (~45 hari); funding window demo23 jam, maksimum kontrak24 jam. Nilai timestamp yang ditandatangani tetap; tidak mengklaim funding belakangan memiliki tenor persis45 hari.

Setiap demonstrasi memakai invoice unik agar dapat dijalankan ulang tanpa menghapus data. Actor balances awal1 miliar MockIDR diprovision oleh deployment CLI, tidak ada mint endpoint publik. Jika saldo actor uji habis setelah banyak demo, mulai lingkungan sintetis baru; jangan memint dana ke vault untuk menutup shortage deal.

## Operasi dan pemeriksaan

- Liveness `/health/live` berbeda readiness `/health/ready`. Readiness membutuhkan config/RPC benar, checkpoint segar, dan heartbeat worker READY.
- `GET /v1/claims/:id/financing` memisahkan allocation, withdrawn, claimable, lender outstanding dan invoice outstanding. Saat indexer degraded, data ditandai sebagai proyeksi terkonfirmasi terakhir yang sudah tidak segar.
- File `.local/demo-happy.json` menyimpan ID claim/hash dan read model terakhir; `deployments/anvil.json` menyimpan receipt deployment nyata.
- Audit dan dokumen hanya melalui sesi berotorisasi. Cookie HttpOnly/SameSite Strict, Origin dan `X-CSRF-Token` diperlukan untuk mutation, disertai `Idempotency-Key` dan expectedVersion.
- Retry HTTP dengan idempotency key sama/body sama mengembalikan logical result lama. Body berbeda dengan key sama ditolak409. Tx hash belum dikenal tetap unknown, bukan sukses.
- `npm run test:integration` menjalankan suite DB/API serta isolated Anvil reorg/replacement. Suite gateway memakai DB nyata dan RPC mock dengan raw signature nyata untuk failpoint yang terkontrol.
- Jangan menjalankan dua copy demo yang mengubah waktu/reorg bersamaan. `demo:restart` menggunakan `/proc` Linux untuk memverifikasi PID worker proyek sebelum menghentikannya. Tidak mematikan proses lain.

## OpenRouter dan public testnet

Mode mock eksplisit dipakai CI/demo tanpa key. Untuk live, isi `.env.worker` dan jalankan `npm run smoke:provider` sesuai README. Screenshot JSON atau keberhasilan parsing bukan verifikasi asli invoice. API key tidak dikirim melalui browser.

Empat kontrak sekarang telah dideploy pada BSC97 dan runtime workspace aktif memakai konfigurasi testnet; lihat `BSC_TESTNET.md`. Deployment, bootstrap, role readback dan indexer telah diperiksa, tetapi tujuh demo financing/restart/reorg yang dilaporkan sebelumnya tetap merupakan **Anvil lokal**. Jangan menjalankannya terhadap chain97. Untuk mengulang demo Anvil, gunakan lingkungan database/Anvil dan env lokal terpisah; cadangan konfigurasi sebelumnya tercatat di manifest activation. Time travel/impersonation dan public Anvil keys dilarang pada public testnet.


## Demo browser terisolasi yang melakukan transaksi nyata

Setelah `npm run build`, jalankan `npm run test:ui:financial`. Command membuat PostgreSQL + Anvil sementara pada port bebas, deploy/bootstrap empat kontrak dengan akun publik lokal, lalu menjalankan web production dan worker terpisah. Wallet bridge hanya boleh broadcast ke chain 31337 loopback dan target deployment ini. Tidak ada private key testnet yang dibaca atau manifest runtime aktif yang diganti.

Delapan checkpoint: analisis worker/review, consent kedua pihak, registrasi, funding, tiga collection bertahap, lalu penarikan lender dan borrower. Lihat `docs/design/results/financial/report.json` untuk hash dari sebelas transaksi lokal dan read model aktual. Daemon/DB sementara dihentikan setelah selesai. Browser memerlukan Chromium (`npx playwright install chromium`).

Untuk runtime BSC aktif, `npm run test:ui:roles` memeriksa navigasi/guard tanpa broadcast; `npm run test:ui:onboarding` memeriksa permohonan serta approval akses. Detail endpoint operator di `ROLE_API.md` dan seluruh kemampuan role di `ROLE_FEATURE_MATRIX.md`.
