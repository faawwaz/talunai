# Talunai

**Tagihan belum cair. Usaha tetap berjalan.**

Talunai membantu supplier memperoleh modal lebih awal dari invoice B2B setelah barang diserahkan, bukti ditinjau, dan buyer menyetujui ketentuannya. Agent membantu memeriksa dokumen; keputusan verifikator dan persetujuan peserta tetap diperlukan. Pendanaan dan pembagian pembayaran dijalankan oleh kontrak di BNB Chain Testnet.

## Mulai dari sini

- **Deploy:** [Vercel + Supabase, konfigurasi dan kebutuhan worker/storage](docs/DEPLOYMENT_VERCEL_SUPABASE.md).
- **Case runnable:** [supplier gula kelapa → buyer, dari dokumen hingga settlement](demo/coconut-sugar/README.md).
- **Produk:** `/` adalah landing page; `/app` adalah pintu masuk workspace dengan login wallet.
- **Stack:** Next.js App Router, TypeScript, PostgreSQL + Drizzle, pg-boss, OpenRouter, viem, Foundry; Node.js 24 dan npm.

**Status 30 September 2026:** case gula kelapa menyelesaikan invoice Rp100 juta, pendanaan Rp70 juta, pembayaran buyer, serta penarikan pendana Rp71,05 juta dan sisa pemasok Rp28,95 juta. Pemeriksaan dokumen memakai OpenRouter live dengan `openai/gpt-4.1`. Supplier dan transaksi bersifat sintetis; konteks supply-chain publik tersedia pada [riset case](demo/coconut-sugar/research.json). Kontrak dan transaksi benar-benar berjalan di **BNB Chain Testnet 97**, dengan token uji **MockIDR** (label antarmuka: IDRT uji), bukan IDRT mainnet atau dana rupiah nyata.

Repo deployment berisi aplikasi, kontrak, worker, tests, dan tooling demo. File `.env`, wallet privat, database/dokumen lokal, serta workspace produksi video/pitch tidak dipublikasikan. Push Git tidak memindahkan data case yang sudah ada ke Supabase. Langkah pemindahan dan batas kesiapan cloud dijelaskan di panduan deployment.

## Workspace frontend

Pada lingkungan BSC yang sedang aktif, buka **https://localhost:3000/app**. Sertifikat lokal sintetis berada di `.local/testnet-tls`; bukan sertifikat produksi. Web dijalankan dengan `npm run dev:https`, worker dengan `npm run worker` atau build/start worker terpisah. Jangan menjalankan dua worker/dev server pada port yang sama.

Sesi testnet lokal membutuhkan tiga proses yang tetap hidup, masing-masing di terminal sendiri: `npm run local:postgres` (membuka database persisten di port 55432 tanpa menghapus data), `npm run worker` (indexer dan heartbeat), lalu `npm run dev:https` (web). Jalankan `npm run doctor` untuk memeriksa web, database, worker, agent, chain, dan readiness. `https://localhost:3000/health/ready` harus mengembalikan `{"status":"ready"}`. Jika database mati, halaman akun tidak dapat membaca sesi; nyalakan kembali PostgreSQL sebelum mencoba login.

`npm run test:ui:login` memeriksa login dan tampilan workspace keenam akun UI di Chromium, termasuk halaman akses Admin dan konsol agent Admin/Verifier, dengan wallet yang menandatangani lewat proses Node. Tes ini tidak mengirim transaksi chain.

Jika Next menulis `Another next dev server is already running`, proses lama masih memegang `.next/dev/lock` atau lock tertinggal setelah proses mati. Periksa PID yang dicetak Next dengan `ps -fp PID`; hentikan proses Next lama dengan `kill PID`, lalu jalankan `npm run dev:https`. Hapus `.next/dev/lock` **hanya setelah** memastikan PID itu sudah tidak hidup. Konfigurasi `.env.local` testnet memakai origin HTTPS; `npm run dev` menjalankan HTTP untuk setup Anvil lokal dan bukan perintah untuk sesi testnet ini. Jika sertifikat localhost belum dipercaya browser, buka tautan HTTPS dan lanjutkan lewat peringatan sertifikat pengembangan.

Untuk mencoba akun testnet yang sudah dikonfigurasi, jalankan `npm run wallets:export`. Perintah ini memverifikasi private key terhadap alamat seed lalu menulis daftar lokal ke `.private/TESTNET_WALLETS.md` dengan izin file `600`; folder tersebut diabaikan Git. Browser akan diarahkan ke origin yang sesuai `.env.local` sebelum membuka permintaan tanda tangan wallet.

- `/app`: pintu masuk dan tindakan berikutnya setelah SIWE; wallet tanpa peran melihat formulir/status akses. Beberapa peran sah tetap memakai konteks organisasi yang dipilih.
- `/app/explore`: statistik pool dan histori transaksi terkonfirmasi dari chain; pool lama hanya untuk posisi/penarikan. Market lender menampilkan Deal aktif yang lolos filter waktu dan izin, bukan placeholder.
- Navigasi utama workspace berisi **Tindakan** dan **Deals**. Route lama `/borrower`, `/buyer`, `/lender`, `/verifier` serta subroute tugas/detail tetap tersedia untuk bookmark dan alur operasional yang sudah ada; kewenangan tetap diperiksa pada Deal, bukan dari URL.
- `/borrower/claims/new`: pengajuan invoice B2B; akses lender dipilih secara eksplisit oleh issuer.
- `/admin/access`: meninjau permohonan akses; `/admin/organizations`, `/admin/claims`, `/admin/tasks`, `/admin/payments`, `/admin/activity`, dan `/admin/audit`: organisasi, pengajuan, antrean, pembukuan, aktivitas, dan audit aktual. Menu admin membuka halaman pemantauan ini tanpa memberi hak tanda tangan peserta.
- `/agent`, `/agent/runs`, `/agent/runs/:id`, `/agent/transactions`: konsol privat ADMIN/VERIFIER untuk worker, analisis, antrean persisten, dan rekonsiliasi transaksi. Worker AGENT tetap tidak mendapat kewenangan manusia.
- `/login?workspace=verifier`: login khusus peran; bukan tombol pemberian role. Server memeriksa sesi/organisasi pada setiap halaman privat, API memeriksa ulang otorisasi.
- Pengguna baru mengajukan akses melalui form, admin menerima/menolak berdasarkan organisasi kanonik. [Panduan onboarding](docs/ONBOARDING.md).
- `/app/demo` lama dialihkan ke `/app`; panduan contoh statis telah dihapus. Rute `/app/claims` lama dialihkan sesuai peran.

UI menampilkan **IDRT uji** dengan penjelasan bahwa token onchain yang digunakan adalah **MockIDR** di testnet. Klik identitas token untuk melihat jaringan, alamat, desimal, dan batas aset uji. Hold, error, dan transaksi pending tetap terlihat saat membutuhkan tindakan.

Masuk menggunakan wallet aktor testnet yang telah disiapkan. Wallet agent **tidak otomatis menjadi borrower/verifier/admin**; wallet tanpa membership menampilkan akses menunggu. Tidak ada role switch yang memberikan hak. Angka publik berasal dari chain, sedangkan data privat berasal dari endpoint terotorisasi; empty state tidak diisi portofolio fiktif.

[Alur produk dan kewenangan tiap peran](docs/PRODUCT_FLOW.md), [alur MVP dan peta kode](docs/MVP_FLOW.md), [matriks fitur per peran](docs/ROLE_FEATURE_MATRIX.md), [konsol ops](docs/OPS_UI.md), dan [API operator](docs/ROLE_API.md).

Desain: Tailwind, komponen pola shadcn dengan Base UI, Manrope, Motion yang mengikuti reduced motion, jade/ivory/sage. [Referensi screenshot](docs/design/REFERENCES.md), [handoff](docs/FRONTEND_HANDOFF.md), dan [scope barang](docs/GOODS_SCOPE.md).

```bash
npm run test:unit
npm run test:workflow      # PostgreSQL temporer otomatis; tidak menyentuh DB aktif
npm run test:api:isolated  # PostgreSQL + Anvil temporer; API dan indexer kanonik
npx vitest run tests/frontend-api.integration.test.ts
npm run test:ui            # backend+worker aktif; aktor test-only dari .env.testnet
npm run test:onboarding    # PostgreSQL temporer; izin, race, idempotensi, pencabutan
npm run test:ui:onboarding # browser + API aktif; admin approval, no chain transactions
npm run test:ui:roles      # semua workspace, server/API role guards, desktop/mobile
npm run test:roles         # PostgreSQL temporer; ops/retry/recovery/otorisasi
npm run build
npm run test:ui:financial  # PostgreSQL + Anvil + web/worker terisolasi; transaksi UI nyata
```

`test:ui` menggunakan Chromium dan key aktor hanya di proses Node untuk menandatangani pesan login/consent; key tidak masuk browser. Harness membuat invoice/dokumen sintetis melalui UI/API, memeriksa aksesibilitas dan menyimpan screenshot/report di `.local/ui-smoke`. Ia tidak mengirim transaksi onchain atau memalsukan collection. Prasyarat browser: `npx playwright install chromium`.

## Jalankan lokal

Prasyarat: Node **24**, npm, Linux/macOS yang didukung binary Foundry. Linux x64 adalah lingkungan yang diuji. Tidak perlu Docker atau API key untuk alur lokal; `embedded-postgres` menjalankan PostgreSQL asli pada localhost. Instalasi mengunduh binary platform dan compiler Solidity.

```bash
npm ci
npm run local:init
npm run contracts:build
```

Jalankan dua terminal infrastruktur, biarkan hidup:

```bash
# Terminal 1: PostgreSQL nyata, localhost:55432, data privat .local/postgres
npm run local:postgres
```

```bash
# Terminal 2: Anvil, localhost:8545, hanya akun uji publik
npm run local:anvil
```

Di terminal setup:

```bash
npm run db:migrate
npm run deploy:local
npm run db:seed
```

Deployment mencetak alamat/hash/block yang benar-benar diperoleh dari receipt, menyimpan `deployments/anvil.json`, dan mengisi alamat pada `.env.local` serta `.env.worker`. Jangan mengulang deployment pada database demo aktif; untuk sesi baru gunakan database/Anvil terisolasi yang baru. Manifest Anvil adalah bukti sesi lokal, bukan alamat yang dapat diakses pada public explorer.

```bash
# Terminal 3: worker terpisah; parser/LLM/indexer tidak berjalan melalui lifecycle request
npm run worker
```

```bash
# Terminal 4: Next.js web/API
npm run dev
```

API tersedia di `http://localhost:3000`. Cek:

```bash
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
curl http://localhost:3000/v1/config
```

Untuk build/start terpisah, hentikan dev server dahulu:

```bash
npm run build                 # build:web + build:worker
npm run start:web             # terminal web
npm run start:worker          # terminal worker; hentikan worker dev dahulu
```

`local:init` membuat secret sesi/HMAC acak. `.env.local` untuk web tidak berisi key agent/provider; `.env.worker` memuat key agent Anvil publik yang dibatasi kontrak. API dan worker tidak menyimpan key borrower/buyer/lender/verifier. Key peserta lokal diturunkan hanya dalam CLI demo dengan guard chain31337. File env/private data diabaikan Git.

## Demonstrasi dan tes

Dengan infrastruktur, web dan worker aktif:

```bash
npm run demo:happy
npm run demo:duplicate
npm run demo:injection
npm run demo:hold
npm run demo:restart
npm run demo:late
npm run demo:reorg
```

CLI login SIWE dengan empat aktor, menggunakan endpoint versi/consent, menandatangani transaksi nyata dan menunggu proyeksi terkonfirmasi. Setiap check mencetak expected/actual. Happy path membuktikan principal **70.000.000**, fee **1.050.000**, lender **71.050.000**, dan residual borrower **28.950.000**. Collection **71.050.000** melunasi pembiayaan sementara invoice masih outstanding **28.950.000**.

`demo:injection` mencakup injection, acknowledgement hilang, dan konflik; ketiganya berhenti sebelum registrasi. `demo:restart` Linux menghentikan hanya worker TALUNAI yang PID/command-nya diverifikasi, mengirim collection, menjalankan proses indexer yang gagal sebelum commit, menjalankan proses baru dan memulihkan worker. `demo:late`/`reorg` memakai snapshot Anvil dan mengembalikannya; transaksi pada cabang yang di-revert tidak diklaim masih kanonik.

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration      # HANYA environment Anvil terisolasi; jangan pada BSC aktif
npm run test:contracts       # unit, fuzz dan stateful invariants
npm audit
```

`npm test` menjalankan unit dan suite frontend API yang memakai PostgreSQL temporer; suite DB/chain lain dilewati bila environment prasyarat tidak diberikan. Jalankan `test:workflow` serta `test:api:isolated` untuk workflow, API dan indexer dengan database/Anvil sementara; kedua harness tidak membaca konfigurasi BSC aktif. `test:integration` adalah jalur lama yang memerlukan environment Anvil terisolasi. Rincian hasil nyata: [TEST_REPORT](docs/TEST_REPORT.md), [TEST_MATRIX](docs/TEST_MATRIX.md). Launcher Foundry lokal meneruskan exit code binary asli; tidak memakai shim npm yang dapat menelan kegagalan.

## OpenRouter

Provider live adalah **OpenRouter**. Case terbaru memakai `openai/gpt-4.1`; SDK `openai` adalah transport kompatibel OpenRouter, bukan panggilan langsung ke endpoint OpenAI. Template lokal tetap dapat menggunakan mode mock tanpa API key.

Edit **`.env.worker`**:

```dotenv
LLM_MODE=live
OPENROUTER_API_KEY=<key-pribadi-anda>
OPENROUTER_MODEL=openai/gpt-4.1
```

Selaraskan `LLM_MODE=live` dan `OPENROUTER_MODEL` pada `.env.local`, jalankan migrasi database, lalu restart web dan worker. Key tetap hanya pada worker. Halaman `/agent` menunjukkan mode dan model yang benar-benar dilaporkan heartbeat worker; pemeriksaan baru ditolak bila konfigurasi web dan worker berbeda. `npm run smoke:provider` memakai fixture sintetis dan benar-benar memanggil OpenRouter bila key tersedia; hasil `PASSED` berarti respons live lolos validasi schema dan provenance pada fixture tersebut. Tanpa key, startup live gagal; tidak ada fallback diam-diam ke mock. Output structured divalidasi terhadap schema dan sumber dokumen, routing provider meminta `data_collection: deny`, dan perhitungan uang tetap deterministik. `npm run doctor` memeriksa heartbeat mode/model worker tanpa meminta API key di env web. Pemeriksaan live telah dijalankan pada case gula kelapa; hasil lokal tersedia di `demo-artifacts/coconut-sugar/hero/`.

## Docker Compose

Konfigurasi tersedia untuk PostgreSQL, Anvil, Next.js dan worker; database/Anvil tidak mempunyai host port. Web dibatasi `127.0.0.1:3000`. Image memakai tag versi tetap. Jalur ini belum dieksekusi dalam sesi pembangunan karena Docker daemon menolak akses; `docker compose config --quiet` sudah lulus.

Untuk **lingkungan Compose baru**, bukan menghubungkan database native yang sudah dipakai:

```bash
npm run local:init
mkdir -p .local/compose deployments
docker compose --env-file .env.local --env-file .env.worker up -d postgres anvil
docker compose --env-file .env.local --env-file .env.worker --profile tools run --build --rm bootstrap
docker compose --env-file .env.local --env-file .env.worker --env-file .local/compose/compose.env up -d --build web worker
```

Bootstrap menjalankan migrasi, deployment lokal dan seed di jaringan internal Compose serta menulis konfigurasi kontrak publik ke `.local/compose/compose.env`. Restart berikutnya cukup `up -d`; jangan bootstrap ulang pada data aktif. Compose hanya meneruskan secret yang dibutuhkan masing-masing proses. Untuk CLI host dengan setup Compose, gunakan script di container/bootstrap yang berbagi RPC internal atau pilih jalur native yang sudah diuji; tidak perlu memublikasikan Anvil/DB.

## BSC testnet

**Sudah dideploy ke BSC Testnet 97**, dengan receipt kontrak pada `deployments/bsc-testnet.json`, Pool A pada `deployments/pool-a-bsc-testnet.json`, dan pemeriksaan role pada `deployments/bsc-testnet.verification.json`. Satu siklus invoice sintetis publik dari registrasi hingga redemption dan redeposit pool telah dikonfirmasi; [12 transaksi dan akuntansinya](docs/TESTNET_FLOW_RECEIPTS.md) dapat diperiksa. Pool menyimpan 1.001.050.000 MockIDR setelah fee 1.050.000 benar-benar dibayar. Agent pengguna terpisah dari admin/verifier/borrower/buyer/lender. Tidak ada mainnet atau dana rupiah nyata; inference OpenRouter belum aktif tanpa key.

Konfigurasi runtime aktif `.env.local`/`.env.worker` berisi alamat deployment sebenarnya. `.env.testnet` adalah **deployment CLI saja** dan memegang key aktor uji terpisah; hanya public `AGENT_ADDRESS` dibutuhkan di situ. Cadangan konfigurasi sebelumnya ada di path yang dicatat pada `deployments/bsc-testnet.activation.json`.

```bash
npm run testnet:smoke       # Read-only: RPC, code, immutable config, roles, receipt canonical
npm run dev:https          # Terminal web, HTTPS localhost dengan certificate lokal
npm run start:worker       # Terminal worker, env testnet aktif
```

Sertifikat localhost adalah self-signed untuk demo, belum otomatis dipercaya browser. `curl --cacert .local/testnet-tls/localhost.pem https://localhost:3000/health/ready` memverifikasi API tanpa menonaktifkan TLS verification. Gunakan sertifikat publik yang valid bila API dipublikasikan.

`testnet:prepare`, `testnet:check`, `testnet:fund-deployer`, `deploy:testnet`, dan `testnet:activate` mendukung setup terkontrol; jangan mengulang deployment pada state aktif. Script menghentikan deployment bila agent berbeda dari worker, role bertumpuk, saldo anggaran gas kurang, atau manifest/pending deployment sebelumnya perlu direkonsiliasi. Lihat runbook untuk batas langkah dan penggunaan gas.

## Struktur dan dokumentasi

- `src/app/v1/[...path]/route.ts`, `src/app/health/[kind]/route.ts`: adapter Next Route Handlers.
- `packages/api`, `domain`, `db`, `chain`, `agents`: modular business logic tanpa dependensi Next.
- `apps/worker/main.ts`: pg-boss/outbox, parser/provider, indexer, rekonsiliasi, heartbeat.
- `contracts/src`, `contracts/test`, `contracts/script`: Solidity, tes dan ABI generation.
- `packages/chain/contracts.ts`: ABI hasil compiler; `packages/client/index.ts`: typed client.
- OpenAPI: `docs/openapi.json`, live `GET /v1/openapi`.
- [API](docs/API.md), [Frontend handoff](docs/FRONTEND_HANDOFF.md), [Demo runbook](docs/DEMO_RUNBOOK.md).
- [Decisions](docs/DECISIONS.md), [Threat model](docs/THREAT_MODEL.md), [Sources](docs/SOURCE_MATRIX.md), [Limitations](docs/LIMITATIONS.md).

Graft sudah dikonfigurasi melalui `AGENTS.md`; graph lokal tidak di-commit. Jalankan `graft build`, `graft map`, `graft ask "consent workflow" --source`, `graft check`. Jika CLI belum terpasang gunakan `npx --yes @nanonets/graft@0.20.0` sebagai pengganti `graft`. Tidak memerlukan key atau LLM pass untuk graph deterministik.
