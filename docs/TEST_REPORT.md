# Laporan pengujian TALUNAI

## Pembaruan perbaikan audit — 29 September 2026

Setelah laporan historis di bawah, perbaikan [F01–F31](TALUNAI_REMEDIATION_STATUS.md) telah diuji ulang pada source terkini: **44/44 Foundry**, **95/95 unit**, **25/25 agent dengan PostgreSQL sementara**, dan **28/28 API + indexer dengan PostgreSQL/Anvil sementara** lulus. `npm run build` (web dan worker), `npm run typecheck`, `npm run lint`, dan `npm run format:check` lulus. `npm run doctor` mendapatkan HTTP 200 dari web/readiness, database aktif, heartbeat worker/indexer, dan RPC chain97. Browser Chromium membuka `/app/explore` pada HTTPS localhost, menampilkan data pool canonical, penjelasan posisi lama, dan identitas MockIDR sintetis. Tidak ada transaksi BSC baru dalam perbaikan ini.

Bagian bertanggal 28 September dan hasil sandbox sebelumnya adalah **arsip tahap saat itu**. Misalnya, catatan lama bahwa siklus finansial BSC belum dijalankan atau build terakhir perlu diulang sudah digantikan oleh receipt publik dan pengujian di atas. Kode kontrak keamanan terbaru masih memerlukan deployment baru; inferensi OpenRouter tetap mock sampai key dipasang dan smoke live lulus.

## Pembaruan terakhir — 29 September 2026

Pool A telah menyelesaikan satu siklus invoice sintetis **di BSC Testnet**, bukan hanya di Anvil. [Receipt per peran, transaksi dan blok](TESTNET_FLOW_RECEIPTS.md) membuktikan registrasi verifier, pendanaan pool 70.000.000 MockIDR, pembayaran buyer 100.000.000, harvest 71.050.000, penarikan residual borrower 28.950.000, redemption investor 1.001.050.000, dan redeposit seluruh hasil. Pembacaan ulang `GET /v1/explore` pada blok 133830095 menunjukkan satu deal `REPAID`, fee terealisasi 1.050.000, aset idle/buku 1.001.050.000, nol pokok dan deal aktif. `/health/ready` kembali HTTP 200 setelah backfill historis header/receipt dan perbaikan pembacaan RPC.

Verifikasi pada tahap ini: 39 tes Solidity lulus (termasuk pembagian fee dua investor dan default yang mengunci redemption), `npm test` **173 passed / 76 skipped**, financial UI E2E Anvil 8 checkpoint lulus, build web, typecheck, lint, dan format lulus. Explore pada Chromium desktop 1440px dan mobile 390px menampilkan transaksi dan deal onchain tanpa error JavaScript/overflow; axe WCAG A/AA melaporkan nol pelanggaran pada dua viewport. OpenRouter masih **belum live** karena API key belum tersedia; worker saat siklus publik secara eksplisit mencatat provider `mock`.

Tanggal: **28 September 2026, Asia/Jakarta**. Ini bukti eksekusi prototype lokal, bukan audit keamanan, bukti legal title, atau hasil underwriting.

**Pembaruan 22:42 WIB:** blocker BSC pada laporan awal di bawah telah diselesaikan setelah pengguna menyediakan wallet agent dan tBNB. Empat kontrak dideploy pada chain97; delapan receipt deployment/bootstrap dikonfirmasi, role agent diperiksa, dan runtime API/worker testnet mencapai READY. Rincian addendum ada di bagian terakhir dan `BSC_TESTNET.md`. Hasil suite awal tetap merupakan pengujian lokal, bukan testnet financing flow.


## Pembaruan workspace per peran — 29 September 2026

Implementasi menyediakan area borrower, buyer, lender, verifier, admin dan konsol agent privat. Status/angka berasal dari API, PostgreSQL, worker dan event chain. Label token kini mengikuti simbol onchain MockIDR pada alamat immutable; tidak ada redeployment kosmetik.

### Eksekusi pada perubahan ini

| Command | Hasil aktual |
| --- | --- |
| `npm run build` | PASS: web Next 16.3.6 dan worker Node dibangun; enam namespace workspace tercantum sebagai route dinamis. |
| `npm run lint`, `npx tsc --noEmit` | PASS. |
| `npm test` | **169 passed, 75 skipped**, 13 file passed/4 skipped. File yang memakai flag integration tidak dijalankan oleh command default; hasil isolasi terpisah di bawah, bukan 244 tes lulus. |
| `npx vitest run tests/roles-ops.integration.test.ts tests/frontend-api.integration.test.ts tests/onboarding.integration.test.ts` | **56/56 PASS**, PostgreSQL temporer: semua peran, pencabutan organisasi/membership, scope issuer, retry idempotent/race/limit, provenance, consent invalidation, replacement recovery. |
| `npm run test:api:isolated` | **28/28 PASS** dengan PostgreSQL + Anvil terisolasi, termasuk recovery transaksi pengganti dengan nonce sama setelah mined tanpa prepare FUND kedua. |
| `npm run test:ui:financial` | **8/8 checkpoint PASS**, **11 transaksi onchain Anvil nyata** melalui kontrol UI dengan wallet bridge lokal, server production build, worker persisten, dan database temporer. |
| `UI_ARTIFACTS_DIR=.local/role-ui node --env-file=.env.testnet --import tsx scripts/test-role-ui.ts` | **25/25 PASS**, semua landing/nav role, API 403, SSR/private body non-leak, agent/admin desktop/mobile, 10 pemeriksaan axe dengan 0 violations, 0 exception browser, 0 broadcast publik. |

`UI_ARTIFACTS_DIR=.local/onboarding-roles npm run test:ui:onboarding` juga **8/8 PASS**, termasuk persetujuan admin yang tersimpan, pembuatan organisasi kanonik, penolakan dan pengajuan ulang, larangan service wallet, serta perpindahan pengguna baru ke `/borrower`. Bukti di `design/results/roles/onboarding/`.

`UI_ARTIFACTS_DIR=.local/ui-roles npm run test:ui` diulang setelah perbaikan mobile dan restart worker: **14/14 PASS**, mencakup COCOA/PACKAGING, edit/upload/analisis persisten, review manusia, kedua consent exact, signature rejection/retry, private document isolation, kelima tab claim mobile, dan logout. Tidak ada exception browser. Ringkasan browser runtime aktif: **47 pemeriksaan PASS** (25 role + 8 onboarding + 14 claim); semua menolak broadcast BSC. Artefak di `design/results/roles/claims/`. Financial harness Anvil di atas terpisah dan memang melakukan 11 broadcast lokal.

Build web/worker dan ESLint dijalankan ulang setelah perbaikan mobile: PASS. Worker aktif direstart secara graceful setelah validasi PID, command dan working directory; `/health/ready` kembali 200. Graph diperbarui dengan `graft build` (175 source files).

Financial UI memproses bukti melalui worker, review verifier, kedua consent EIP-712, registrasi, approval token exact, funding 70 juta, collection 50 juta → 71,05 juta → 100 juta, dan kedua withdrawal. Pada 71,05 juta: financing REPAID sementara invoice PARTIALLY_COLLECTED. Final: total collection 100 juta, lender withdrawn 71,05 juta, borrower residual withdrawn 28,95 juta, kedua claimable nol dan saldo vault nol. Assertion saldo wallet: borrower menerima total 98,95 juta, lender bertambah bersih 1,05 juta. Tidak ada update database finansial buatan.

Bukti: [financial report](design/results/financial/report.json), [screenshot settlement](design/results/financial/borrower-settled.png), dan folder `docs/design/results/roles/`. Hash financial report berasal dari **Anvil temporer**, bukan BSC explorer. Harness menolak chain selain 31337 dan RPC di luar loopback; tidak membaca private key testnet atau menulis deployment manifest.

### Kegagalan yang ditemukan dan diperbaiki

- Fixture SIWE ops pertama memakai domain berbeda dari origin; fixture dikoreksi tanpa melonggarkan guard.
- Tes helper replacement awal kehilangan argument intent ID; diperbaiki lalu seluruh 28 tes isolasi dijalankan ulang.
- Badge Test menghasilkan rasio kontras 4,49; warna teks diperkuat, axe rerun lulus.
- Detail commitment audit menyebabkan overflow mobile; layout disclosure diperbaiki dan browser rerun lulus.
- Trail enam tahap pada claim summary membuat halaman mobile melebar 635 px pada viewport 390 px. Teks screen-reader absolut sekarang dibatasi oleh positioning container scroll; tidak memakai body overflow-hidden sebagai penutup masalah.
- Financial UI pertama mendapat 404 lender karena fixture tidak membagikan claim pada organisasi lender. Harness kini memilih lender secara eksplisit pada pembuatan claim; kontrol akses tetap utuh. Delapan checkpoint dan 11 transaksi dijalankan ulang sampai PASS.
- Tombol kembali pada halaman not-found yang dirender server kehilangan isi melalui wrapper asChild; diganti Link semantik dengan style tombol yang sama.

### Batas bukti

Runtime HTTPS lokal masih terhubung deployment BSC 97 yang sudah ada; pekerjaan UI ini tidak mengirim transaksi finansial publik baru. Mode provider aktif tetap **mock** karena `OPENROUTER_API_KEY` belum tersedia; adapter OpenRouter tidak diklaim telah smoke-tested live. Mode aktual tersedia pada detail run. Admin approval akses aplikasi tidak otomatis memberikan allowlist lender onchain; bootstrap terpisah tetap diperlukan. Tes aksesibilitas lab bukan bukti seluruh kriteria WCAG atau performa lapangan. Ini MVP testnet, bukan peluncuran layanan pembiayaan produksi.

## Lingkungan nyata

- Linux x64, Node **24.18.0**, npm **11.16.0**; dependency dipin pada `package-lock.json`. `npm ci` selesai dengan 459 packages dan audit 0 vulnerabilities.
- Next.js **16.3.6**, TypeScript **5.9.3**, PostgreSQL **17.9** melalui embedded-postgres yang menjalankan database asli di localhost:55432.
- Anvil/Foundry **1.7.1**, chain **31337**, compiler Solidity **0.8.28**, target EVM **Paris**, OpenZeppelin **5.0.2**.
- Web produksi `npm run start:web` di 127.0.0.1:3000; worker terpisah dari hasil build `npm run start:worker`. `/health/ready` mengembalikan `{"status":"ready"}` dengan heartbeat/indexer aktif.
- Mode analisis demo **mock**. Identitas, invoice dan MockIDR seluruhnya sintetis. Tidak ada dana nyata, mainnet atau data pelanggan.

## Hasil command

| Command yang dijalankan | Hasil |
| --- | --- |
| `npx --yes create-next-app@16.3.6 . --ts --eslint --app --src-dir --no-tailwind --use-npm --import-alias '@/*' --yes --skip-install --disable-git` | Berhasil membuat project langsung di root; cache lama dipertahankan. |
| `npm ci` | PASS, lockfile npm dapat diinstal ulang. |
| `npm run local:init` | PASS, env lokal privat dibuat dan secret web/worker dipisahkan. |
| `npm run local:postgres` | PostgreSQL nyata berjalan. |
| `npm run db:migrate` dan `npm run db:seed` | PASS, migrasi SQL dan organisasi/aktor sintetis tersimpan. |
| `npm run contracts:build` | PASS, empat kontrak dikompilasi untuk Paris dan ABI dihasilkan. |
| `npm run deploy:local` | PASS, receipt deployment/bootstrap/mint token uji nyata; manifest terlampir. |
| `npm run build` | PASS: Next web/API dan worker Node dibangun terpisah. |
| `npm run lint` | PASS, tanpa error/warning. |
| `npm run typecheck` | PASS, TypeScript strict. |
| `npm run format:check` | PASS. |
| `npm run test:integration` | **145 passed, 0 failed, 0 skipped**, 8 file, 8,85 detik pada run akhir pukul 22:16 WIB. |
| `npm run test:contracts` | **34 passed, 0 failed, 0 skipped**, 3 suite. |
| `npm audit --audit-level=low` | PASS, **0 vulnerabilities** pada dependency yang diperiksa. Ini bukan audit kode aplikasi. |
| `docker compose --env-file .env.local --env-file .env.worker config --quiet` | PASS; hanya validasi konfigurasi. |
| `npm run graft:build` dan `npm run graft:check` | PASS, wiring graph sinkron: 432 nodes, 1.198 edges, 67 source files. Deep/LLM summaries tidak dijalankan. |

Log run akhir lokal disimpan pada `.local/integration-final.log`, `forge-final.log`, `contracts-build.log`, `build-final.log`, `lint-final.log`, `typecheck-final.log`, `format-check-final.log`, dan `npm-ci.log`. Direktori lokal ini diabaikan Git; hasil dapat diulang melalui command di README.

Anvil awal dijalankan melalui binary paket dengan `--host 127.0.0.1 --chain-id 31337 --silent`; script `local:anvil` memakai native launcher dan `--block-time 1` untuk sesi baru. Isolated chain integration juga memulai proses Anvil sendiri. Tidak mengklaim daemon Docker dipakai pada jalur ini.

## Cakupan executable

Suite TypeScript menguji aritmetika exact dan batas uint256, canonical invoice/HMAC/wallet rotation, SIWE challenge binding dan concurrent nonce consumption, CSRF/origin, tenant authorization, optimistic versioning, idempotency, private upload, parser text/PDF nyata, provider validation, provenance, persistent workflow/outbox dan gateway sempit.

Invoice yang berbeda namespace/tanda baca tetapi mempunyai nomor alphanumeric sama pada issuer yang sama masuk review. Riwayat cancelled tetap diperiksa. Payment instruction yang konflik, acknowledgement hilang, prompt injection, fabricated evidence, refusal/timeout/schema error dan key yang hilang tidak menghasilkan approval otomatis.

Integration indexer membuat database temporer dan Anvil terisolasi: deployment nyata, signed terms TypeScript-to-Solidity, duplicate/out-of-order logs, failpoint sebelum commit, replay, snapshot/revert, deep reorg degraded, canonical hash race, omitted hold event, serta replacement dengan nonce sama/gas berbeda. Success receipt tetap ditolak jika expected event/claim/sender/recipient/nominal/target tidak cocok.

Foundry mencakup 27 tes inti termasuk **2 fuzz test × 256 runs**, 4 tes token adversarial dan **3 stateful invariant × 64 runs × 64 calls**. Assertions memeriksa one-time funding, conservation, per-deal liability, withdrawal, hold/pause, signed consent dan pembatasan agent. Random testing bukan pembuktian formal semua urutan.

Pemetaan 65 butir matriks permintaan ke nama test/assertion beserta batas masing-masing ada di [TEST_MATRIX.md](TEST_MATRIX.md). Tidak ada coverage percentage yang digunakan sebagai bukti keamanan.

## Demo end-to-end

Seluruh demo berikut selesai dengan exit code 0 dan assertion PASS. API/worker/chain benar-benar digunakan; tidak ada edit database untuk membuat saldo finansial tampak berhasil.

| Command | Hasil yang diamati |
| --- | --- |
| `npm run demo:happy` | Principal 70.000.000 ke borrower; collection 50.000.000 menghasilkan lender outstanding 21.050.000; collection 71.050.000 menghasilkan REPAID tetapi invoice belum penuh; collection 100.000.000 dan withdrawals menghasilkan lender 71.050.000, borrower residual 28.950.000. Total penerimaan borrower 98.950.000. |
| `npm run demo:duplicate` | Invoice pertama funded; bytes/hash file kedua berbeda tetapi identitas invoice sama ditolak 409. |
| `npm run demo:injection` | Injection, acknowledgement hilang, dan konflik masing-masing NEEDS_REVIEW; recipient tidak berubah dan registration template tidak tersedia. |
| `npm run demo:hold` | Dispute buyer diproses worker menjadi hold onchain; direct lender funding simulation revert; hanya verifier dengan review baru dapat clear. Principal belum dicairkan. |
| `npm run demo:restart` | Worker dihentikan dengan pemeriksaan PID proses milik proyek; payment mined; proses indexer gagal sebelum commit; proses baru mereplay collection tepat 50.000.000 satu kali; worker dipulihkan. |
| `npm run demo:late` | Waktu Anvil melewati jatuh tempo: entitlement outstanding tetap 71.050.000; payment terlambat 50.000.000 menurunkan outstanding menjadi 21.050.000. Snapshot dipulihkan. |
| `npm run demo:reorg` | Collection 50.000.000 pada branch Anvil yang di-revert dihapus dari projection; collection kembali 0 dan reversal audit dipertahankan. |

Happy dan hold dijalankan ulang setelah penguatan receipt-event verification, melalui web dan worker hasil production build. Bukti run akhir: `.local/demo-happy-final.log`, `.local/demo-hold-final.log`; demo lain pada `.local/demo-{duplicate,injection,restart,late,reorg}.log`. Read model happy terakhir ada di `.local/demo-happy.json`.

Contoh hash **Anvil lokal, bukan public explorer** dari run akhir:

- Full collection: `0x3421f1559c3d77bc922e2d1af56af962297b3b54ed012a701fbfbb4d2dcfc048`, block 60.
- Borrower residual withdrawal: `0xc0ca209e65f561200033d1bbce1b4e52c6d17f9c10be65e847e520919c9f9d9f`, block 62.
- Human clear hold: `0xb2562165276ce10375f00b002fffb78d8e11727ac61fbb541c851ae63faf4f17`, block 65.

## Deployment dan integrasi

Manifest receipt sebenarnya: [deployments/anvil.json](../deployments/anvil.json). Registry `0xe7f1725e7734ce288f8367e1bb143e90bb3f0512`, vault `0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0`, executor `0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9`, MockIDR `0x5fbdb2315678afecb367f032d93f642f64180aa3`. Manifest mencatat block/tx hash empat deployment dan bootstrap, bukan alamat hasil tebakan.

| Integrasi | Status bukti |
| --- | --- |
| Next, PostgreSQL, pg-boss/outbox, private storage, text-PDF parser, viem, Anvil | Nyata, dijalankan lokal. |
| DocumentAnalysisProvider mock | Nyata sebagai parser deterministik sintetis; semua run ditandai mock. |
| OpenRouter adapter | Implementasi SDK dengan endpoint OpenRouter dan structured output; error/success transport diuji memakai intercepted fetch. **Inference live belum diuji: key tidak tersedia.** |
| Gateway network failure cases | Database dan raw signatures nyata; RPC doubles eksplisit untuk failpoint/retry. Demo hold memberi bukti gateway ke Anvil nyata. |
| Verifier/organization authority | Seed sintetis dan approval aktor CLI; bukan pemeriksaan perusahaan nyata. |
| BSC testnet RPC | `eth_chainId` terverifikasi 97, block 133690180 pada pemeriksaan; **deployment belum dilakukan**, test-only actor keys/test BNB belum tersedia. |
| Docker Compose | Konfigurasi valid; build/runtime **belum diuji** karena akses daemon ditolak. |
| Registry eksternal/KYB/bank/fiat/OCR | **NOT_INTEGRATED**; tidak ada status verified/settled fiktif. |

`LLM_MODE=live npm run worker` tanpa key telah dicoba dan gagal eksplisit dengan `LIVE_PROVIDER_CONFIGURATION_REQUIRED`, exit 1. Ini hasil negatif yang diharapkan, bukan fallback ke mock. `npm run smoke:provider` disediakan untuk pemanggilan nyata setelah key tersedia.

## Kegagalan yang diselesaikan dan blocker

- OpenZeppelin 5.6 memakai opcode yang tidak cocok dengan target Paris; compiler memang menolak. Versi dipin ke 5.0.2 yang kompatibel; target keamanan tidak diturunkan untuk mengabaikan hasil tes.
- Shim npm Foundry dapat menelan exit code binary. Script sekarang memanggil binary platform secara langsung dan meneruskan status kegagalan.
- Funding deadline dari jam host melewati batas 24 jam pada Anvil idle. Deadline kini diikat ke waktu chain dengan batas review/consent; stale RPC testnet menolak exposure baru.
- Type errors, perbedaan API parser PDF, dan konfigurasi output Next yang tidak konsisten ditemukan selama implementasi lalu diperbaiki. Gate build/typecheck/lint akhir semuanya lulus.
- Docker daemon menolak akses, dan sudo tanpa interaksi tidak tersedia. Implementasi lokal tetap selesai melalui PostgreSQL/Anvil native; tidak mengklaim image telah berjalan.
- Tidak ada key OpenRouter atau test-only BSC actor yang disediakan. Tidak ada deployment eksternal, inference berbayar, registrasi perusahaan nyata atau pembayaran nyata yang diklaim.

Batas trusted verifier/admin, double financing di luar platform, counterparty fraud, token sintetis, alur collection, refund/prepayment/recovery dan operasi insiden dijelaskan pada [LIMITATIONS.md](LIMITATIONS.md).

## Addendum: deployment BSC testnet dengan agent pengguna

Pengguna mengganti key agent, memilih BSC97, lalu mengonfirmasi saldo tBNB tersedia dan meminta deployment. Saldo awal benar-benar diperiksa 0,3 tBNB. Wallet agent `0x954Da57Aeec71b02c0A9369c0C3ED6D21F460aDd` tetap terpisah dari admin/verifier/borrower/buyer/lender. Key tidak dicetak pada log atau dimasukkan ke Git.

| Command/check yang benar-benar dijalankan | Hasil |
| --- | --- |
| `node --import tsx scripts/prepare-testnet.ts` | PASS; staged env/key aktor uji terpisah, alamat agent berasal dari key pengguna. |
| `node --env-file=.env.testnet --import tsx scripts/deploy.ts --check` sebelum transfer gas | Exit2 yang diharapkan: admin belum mempunyai gas; tidak ada transaksi deployment dikirim. |
| `npm run testnet:fund-deployer` | PASS; transfer 0,0024 tBNB ke deployer terpisah, hash/nonce/raw bytes dipersist sebelum broadcast. Receipt canonical dengan tiga konfirmasi. |
| `npm run deploy:testnet` | PASS; 4 deployment + endpoint wiring + lender allowlist + 2 mint MockIDR sintetis. Delapan receipt sukses. |
| `npm run testnet:smoke` | PASS; chain97, code/config immutable, canonical receipt dan batas role agent. Role mint yang diperiksa adalah `DEMO_MINTER_ROLE`. |
| `npm run testnet:activate` | PASS; database baru dibuat, dua migrasi diterapkan, organisasi/aktor sintetis di-seed, env lama dicadangkan privat. |
| `npm run dev:https`, `npm run start:worker` | Berjalan; Next Route Handlers melalui HTTPS localhost, worker terpisah. |
| `curl --cacert .local/testnet-tls/localhost.pem https://localhost:3000/health/ready` | `{"status":"ready"}` setelah RPC indexer diperbaiki. TLS tidak dinonaktifkan. |
| `GET /v1/config` | chain97, empat alamat BSC yang benar, tiga confirmations, `isSynthetic:true`, mode mock. |
| Query read-only checkpoint/heartbeat/event | Chain97 checkpoint133696008, degraded=false; worker dan indexer READY; 6 RoleGranted + 1 EndpointsConfigured terindeks. |
| `npx vitest run tests/deployment-safety.test.ts` | **9 passed**, 0 failed, 0 skipped. Memeriksa wallet override, key/address mismatch, pemisahan role, penolakan mainnet/public Anvil key, sanitasi error secret, dan anggaran bigint. |
| `npm run typecheck`, `npm run lint` | PASS setelah penambahan deployment/setup scripts. |

Biaya delapan transaksi deployment/bootstrap **0,0005443856 tBNB**; biaya transfer gas **0,0000021 tBNB**. Saldo snapshot setelah deployment: agent **0,2975979 tBNB**, deployer **0,0018556144 tBNB**. Manifest/verification/activation ada di `deployments/bsc-testnet*.json`; bukti log lokal pada `.local/deploy-bsc-testnet.log`, `testnet-gas-transfer.log`, `testnet-smoke.log`, `testnet-activation.log`, dan `worker-testnet-publicnode.log`.

Kegagalan nyata dan perbaikan: RPC data-seed menerima deployment/receipt tetapi menolak `eth_getLogs` dengan -32005 pada rentang1/16/64 blok. Worker tetap DEGRADED dan API503 sampai RPC diganti ke PublicNode yang benar-benar diuji chain97 dan log tujuh event. RPC data-seed dipertahankan sebagai pembanding canonical block. Tidak ada perubahan indexer untuk mengabaikan log atau memalsukan readiness. Type errors pada setup script diperbaiki sebelum aktivasi.

Full financing/collection/withdrawal di public BSC belum dijalankan; aktor peserta belum diberi gas. Source-code verification explorer, inference OpenRouter live dan Docker runtime juga belum diklaim berhasil. Tidak ada time travel/impersonation pada public testnet.

## Addendum: workspace frontend dan scope barang B2B (28 September 2026)

Lingkungan: Node24.18.0, Next16.3.6, TypeScript5.9.3, Chromium Playwright, PostgreSQL17.9 temporer untuk pengujian terisolasi. Runtime demo aktif tetap BSC97 + PostgreSQL privat + worker Node terpisah, LLM_MODE=mock. Kontrak deployment sebelumnya tidak diubah.

| Command aktual | Hasil |
|---|---|
| `npm install --save-exact tailwindcss @tailwindcss/postcss @base-ui/react class-variance-authority clsx tailwind-merge lucide-react motion @tanstack/react-query @tanstack/react-form @tanstack/react-table` | Berhasil; versi exact tersimpan npm lockfile. |
| `npm install --save-dev --save-exact @playwright/test @axe-core/playwright` dan `npx playwright install chromium` | Berhasil; Chromium benar-benar diluncurkan. |
| `npm run db:migrate` | Migrasi `0003_goods.sql` diterapkan ke database demo aktif. Tidak mengubah finansial chain. |
| `npm run fixtures:pdf` (equivalent `npx tsx scripts/make-pdf-fixtures.ts`) | Kedua PDF sintetis dibuat ulang dari teks nyata. |
| `npx vitest run tests/domain.test.ts tests/goods.test.ts tests/agents.test.ts tests/chain-service.test.ts tests/deployment-safety.test.ts` | 83 passed, 5 file, 0 failed. |
| `npx vitest run tests/frontend-api.integration.test.ts` | 18 passed; cluster PostgreSQL temporer, SIWE read-only RPC stub; tidak memanggil BSC atau memodifikasi DB aktif. Real processClaim dan human review diuji untuk COCOA/PACKAGING. |
| `npm run test:workflow` | 21 passed pada PostgreSQL temporer: kedua kategori, duplicate jobs, missing acknowledgement, konflik, alias issuer/invoice dan kegagalan provider. |
| `npx vitest run tests/wallet-guards.test.ts` | 6 passed: hash browser sama dengan backend; exact domain/terms/role, recipient, action/method, spender, amount, native value dan chain. |
| `npx vitest run src/features/claims/pending.test.ts` | 5 passed: recovery hash sesudah reload, scope wallet/user/chain/claim, duplicate hint, malformed input/mainnet, storage failure. |
| `npm test` | **121 passed, 75 skipped, 0 failed; 9 passed files + 4 skipped.** Default run tidak memberi environment database/Anvil kepada suite API lama/chain/indexer/agents-db. Agents-db dijalankan terpisah lewat `test:workflow`. Skips bukan klaim tes finansial ulang. |
| `npm run lint` | PASS, tanpa warning pada pemeriksaan akhir sebelum browser final. |
| `npm run typecheck` | PASS setelah integrasi payload guard dan signature caller. |
| `npm run build:web`, `npm run build:worker` | Build produksi sukses; seluruh route workspace dan Route Handlers terdaftar. Worker tetap proses terpisah. |

### Temuan yang diperbaiki selama pengujian

- Browser Chromium menemukan native fetch `Illegal invocation` pada typed client: diperbaiki dengan pemanggilan tanpa receiver, ditambah regression test.
- Tes wallet bridge awal memiliki transpiler helper `__name` yang tidak tersedia di browser; harness memakai bootstrap JavaScript eksplisit. Ini kegagalan harness, tidak diubah menjadi keberhasilan produk.
- AXE menemukan teks muted pada sage di bawah rasio 4,5:1; warna teks konteks sage diperkuat tanpa mengganti palet utama.
- Tiga kasus alias-invoice workflow sempat gagal karena fixture SQL ditambah kolom goods tanpa value; fixture diperbaiki dan 21 kasus lulus ulang. Kontrol deduplication tetap aktif.
- Review gate diperkuat: READY_FOR_SIGNATURES dari agent belum cukup untuk consent; human review aktual, versi dan expiry harus cocok. Review baru mengikat metadata goods dan policy hash terkini.
- Payload wallet divalidasi lagi di browser terhadap terms yang ditampilkan. Cache privat dikunci ketika logout/account berubah, termasuk bila jaringan gagal.
- Hash broadcast disimpan sebelum observe agar reload tidak mengirim ulang transaksi. Session storage bukan pengganti reconciler chain.

Tidak ada tes browser yang memalsukan REPAID, pembayaran fiat, mint publik, atau regulator/KYB. Tidak ada transaksi finansial BSC baru dikirim oleh rangkaian frontend ini. Hasil browser akhir dan screenshot dilaporkan di bagian berikut. Pengukuran lapangan Core Web Vitals belum tersedia; AXE bukan audit aksesibilitas manual menyeluruh.


### Verifikasi browser akhir — 29 September 2026, Asia/Jakarta

`npm run test:ui` selesai **14/14 passed**, 0 failed dan 0 browser exceptions. Browser memakai backend HTTPS localhost yang aktif, PostgreSQL persisten dan worker nyata, konfigurasi BSC97, serta dokumen/token sintetis. Private key aktor hanya berada di proses Node. Metode pengiriman transaksi wallet ditolak oleh harness; **0 transaksi onchain dikirim**.

Yang benar-benar dilakukan: login SIWE dan penolakan login, pembuatan invoice kemasan melalui form bertahap, revisi metadata dengan invalid-input recovery dan kenaikan versi, upload privat, analisis kedua kategori, seluruh sidebar/detail URL, review verifier dengan versi terms baru, penolakan consent borrower lalu retry, dua consent EIP-712 borrower/buyer yang tersimpan, akses dokumen lintas organisasi ditolak, actor pending tidak dapat membuat claim, dan logout server terkonfirmasi. Claim consent berakhir pada `READY_FOR_REGISTRATION`, **bukan REGISTERED atau FUNDED**.

Fault injection hanya satu respons GET `/v1/claims` 503 untuk memeriksa error/retry. Traffic utama tidak dimock. Laporan lengkap: [report.json](design/results/report.json).

Sesudah perbaikan ringkasan mobile, command `UI_VISUAL_ONLY=1 UI_ARTIFACTS_DIR=.local/ui-smoke/mobile-followup npm run test:ui` lulus **1/1**. Ini hanya SIWE, pembacaan backend dan logout; tidak membuat invoice tambahan. Nominal, status dan jatuh tempo sekarang terlihat tanpa horizontal scroll pada ringkasan mobile; width 390 px tidak overflow. [Laporan follow-up](design/results/mobile-followup-report.json).

AXE: ringkasan desktop 24 checks passed dan mobile 22 checks passed, **0 violations, 0 incomplete**. Detail claim 26 checks passed, 0 violations, satu incomplete untuk karakter panah dekoratif `→` di antara pihak. Panah disembunyikan dari assistive technology dan hubungan pihak memiliki teks `kepada`; item ini ditinjau manual, tidak dihapus dari laporan. Hasil tidak diklaim sebagai audit aksesibilitas penuh atau pengukuran field Core Web Vitals.

Screenshot hasil aktual: [desktop](design/results/overview-desktop.png), [mobile](design/results/overview-mobile.png), [invoice](design/results/claim-detail-desktop.png), [consent selesai](design/results/consents-complete-desktop.png).

`npm test` dijalankan ulang setelah melanjutkan sesi: tetap 121 passed, 75 skipped; `npm run test:workflow` ulang 21 passed. Web/worker/PostgreSQL direstart tanpa redeploy atau modifikasi saldo finansial. `/health/ready` kembali HTTP200 ready. Gangguan RPC auth sementara tetap menghasilkan kegagalan tertutup; tidak ada pengecualian keamanan untuk membuat tes lulus.

### Regresi API/indexer dan build final — 29 September 2026

| Command yang dijalankan | Hasil |
|---|---|
| `npx tsx scripts/test-api.ts` | **28 passed, 0 failed, 0 skipped**: 18 API dan 10 indexer, PostgreSQL17.9 + Anvil nyata pada port sementara. Alias untuk mengulang: `npm run test:api:isolated`. |
| `npx eslint scripts/test-api.ts tests/chain-indexer.integration.test.ts` | PASS. |
| `npx tsc --noEmit` | PASS. |
| `npm run build` | PASS setelah seluruh perubahan final: Next build produksi beserta pemeriksaan TypeScript, kemudian bundle worker Node24 terpisah. Semua 17 route tercantum pada output build. |
| `npm run lint` | PASS setelah penambahan harness regresi. |
| `curl --silent --show-error --cacert .local/testnet-tls/localhost.pem https://localhost:3000/health/ready` | HTTP200, `{"status":"ready"}` pada runtime BSC97 aktif. |

Regresi API mencakup nonce SIWE bersamaan, pencabutan sesi, privasi dokumen, idempotensi/dedup, invalidasi versi upload, human review untuk hold, nominal exact dan replacement nonce. Regresi chain melakukan deploy lokal nyata, memeriksa kesamaan EIP-712 TypeScript/Solidity, collection/withdrawal, log duplikat/urutan berbeda, rollback saat crash, rebuild proyeksi, reorg Anvil nyata, event hold yang hilang, konflik header dan replacement transaksi dengan nonce sama.

Harness baru memakai allowlist environment, tidak membaca `.env.local`/key BSC, tidak mengganti manifest, dan membersihkan PostgreSQL/Anvil sementara. Suite chain kini memprioritaskan `CHAIN_TEST_DATABASE_URL` eksplisit tanpa terlebih dahulu membaca environment aktif. Tidak diperlukan pelonggaran authorization atau perubahan API untuk membuat regresi lulus. Dari 75 kasus yang dilewati oleh command default, suite workflow/API/indexer dijalankan terpisah sebagaimana dicatat di atas; sisa suite gateway bukan klaim pengujian ulang dalam pass frontend ini. Hasil baseline gateway tetap tercatat pada bagian backend sebelumnya.

## Onboarding operasional dan detail UI — 29 September 2026

Permohonan akses kini tersimpan melalui API, ditinjau pada `/app/access` oleh ADMIN terautentikasi, dan menghasilkan membership nyata setelah approval. Pengguna baru tidak perlu menunggu tanpa tindakan yang jelas. Pembuatan organisasi sintetis kanonik adalah langkah admin eksplisit; role dari pilihan form tidak memberi privilege. Pending, rejection beserta alasan, pengajuan ulang, dan pembaruan sesi setelah approval memakai state database sebenarnya.

| Command aktual | Hasil |
|---|---|
| `npm run db:migrate` | `0004_access_requests.sql` diterapkan pada DB aktif; tidak mengubah terms/saldo finansial. |
| `npx vitest run tests/onboarding.integration.test.ts` | **21 passed** pada PostgreSQL temporer. Role RPC memakai stub eksplisit: pending tidak mendapat akses, idempotency, race, private request scope, body escalation, wallet khusus sistem, alias/identitas organisasi, authority occupied, stale review, pencabutan organisasi ADMIN, dan audit wallet sesi yang tepat. |
| `npm test` | **142 passed, 75 skipped, 0 failed**, 10 passed files dan 4 skipped. Tes onboarding termasuk dalam 142 ini. Suite DB/chain/gateway lama yang membutuhkan environment tetap skipped pada command default sebagaimana dijelaskan sebelumnya. |
| `npm run test:ui:onboarding` | **8/8 passed**, 0 page errors, 0 transaksi onchain. Chromium memakai API HTTPS aktif + PostgreSQL nyata dan role read dari kontrak BSC97 aktif. |
| `UI_VISUAL_ONLY=1 UI_ARTIFACTS_DIR=.local/onboarding-ui/visual-final npm run test:ui:onboarding` | **2/2 passed**; contoh publik, login dan pembacaan onboarding saja. Screenshot mobile final 390×1537, tanpa overflow horizontal. |
| `npm run build` | PASS: web produksi/TypeScript dan worker Node24; route `/app/access` dan `/app/demo` terdaftar. |
| `npm run lint` | PASS. Scoped lint harness diulang setelah perbaikan screenshot. |
| `curl --silent --show-error --cacert .local/testnet-tls/localhost.pem https://localhost:3000/health/ready` | `{"status":"ready"}`. |

Browser benar-benar membuat pengguna dan permohonan sintetis, me-reload untuk memastikan persistence, membuat organisasi kanonik lewat UI ADMIN, menyetujui request versi tepat, kemudian memeriksa workspace terbuka otomatis dan form invoice dapat dibuka. Penolakan dan pengajuan ulang diuji. Wallet agent yang dikonfigurasi benar-benar ditolak ketika meminta role peserta. Private key test hanya digunakan di Node untuk SIWE; bridge wallet menolak broadcast transaksi. Script membaca `.env.testnet` dan `.env.worker` untuk aktor uji/agent, tidak menulis key ke browser atau report.

Satu run awal berhenti pada selector harness yang mengharapkan role link untuk navigasi bergaya tombol. Selector diikat pada href yang tepat dan alur lulus ulang. Screenshot awal yang diambil langsung sesudah perubahan viewport menyimpan dimensi lama; harness kini membuka ulang halaman pada viewport mobile sebelum capture. Pengukuran fresh mobile sebenarnya 390 px lebar dan 1537 px tinggi; tidak ada perubahan data untuk membuat screenshot tampak berhasil. Indikator developer Next disembunyikan melalui opsi resmi `devIndicators:false`, sementara pelaporan error tetap berjalan.

AXE tidak menemukan violation pada form desktop/mobile, review admin, dan layar wallet agent. Hasil lengkap dan item incomplete bila ada disimpan bersama screenshot pada [hasil onboarding](design/results/onboarding/report.json). [Desktop](design/results/onboarding/access-desktop.png), [mobile](design/results/onboarding/access-mobile.png), [review admin](design/results/onboarding/admin-review.png).

Status integrasi: onboarding/API/DB/worker dan pembacaan role BSC berjalan nyata. Contoh di `/app/demo` adalah perhitungan domain yang jelas berlabel, bukan data tenant atau transaksi. Provider masih `LLM_MODE=mock` karena `OPENROUTER_API_KEY` belum terisi; tidak mengklaim inference live. Tidak ada deployment publik web atau transaksi finansial BSC baru pada pass ini.

## Penyederhanaan Explore dan pintu masuk workspace — 29 September 2026

Setelah laporan di atas, rute `/app/demo` dialihkan ke `/app` dan halaman contoh statis dihapus. Explore menjadi tiga bagian utama: pasar, posisi investor, dan transaksi; kontrol operator tampil hanya untuk ADMIN. Pembacaan inti pasar dipisahkan dari histori event agar tampilan awal tetap cepat dan transaksi menampilkan status loading/error sendiri. Pengguna baru melihat permohonan akses, satu membership aktif langsung membuka workspace, dan beberapa membership aktif memberi pilihan workspace.

| Pemeriksaan terakhir | Hasil dan batas |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run format:check` | **Lulus** setelah perubahan UI, API, dan onboarding terbaru. |
| `npm run build:worker` | **Lulus** pada kode terbaru. |
| `npm run test:contracts` | **39 lulus**. |
| API `GET /v1/explore?events=0` terhadap BSC Testnet | HTTP 200, snapshot terkonfirmasi sekitar 1,49–1,53 detik; jalur lama dengan histori sekitar 45,5 detik pada pengukuran pembanding. Event endpoint cold sekitar 16,43 detik, warm 0,59 detik. Ini pengukuran lokal, bukan jaminan latensi publik. |
| Browser Explore sebelum sandbox berubah | Tab pasar/investasi/transaksi pada desktop 1440 px dan mobile 390 px dapat dibuka, tanpa page error atau horizontal overflow. Pengujian ini mendahului perubahan onboarding terakhir. |
| `npm test` dalam sandbox akhir | **117 lulus, 5 gagal, 134 dilewati**. Tiga suite integrasi timeout karena sandbox menolak `listen 127.0.0.1` dengan `EPERM`. Lima test PDF gagal di Vitest: proses parser anak keluar tanpa stdout/stderr. Pemanggilan `parseDocument` terhadap fixture PDF langsung di luar runner berhasil; probe proses anak dalam Vitest juga kehilangan seluruh stdout/stderr. Ini bukan hasil suite penuh yang lulus dan perlu diulang pada lingkungan yang mengizinkan socket/subprocess normal. |
| `npm run build` dan browser onboarding HTTPS dalam sandbox akhir | **Belum terverifikasi ulang**: Turbopack dan server pengujian mencoba bind port lalu mendapat `EPERM`. Build produksi dan browser onboarding pernah lulus sebelum perubahan terbaru, sebagaimana tercatat di atas. |

Status bukti yang bisa dipresentasikan: transaksi BSC dan akuntansi pool terkonfirmasi; fitur UI terakhir lulus pemeriksaan statis, tetapi build/browser final perlu diulang di host dengan izin localhost. OpenRouter tetap mode mock sampai key dipasang dan hasil run live diverifikasi.
