# Deploy Talunai: Vercel + Supabase

## Status kesiapan

Repository ini adalah aplikasi Next.js di root, bukan workspace `video/`. `vercel.json` memilih `npm run build:web`; worker dibangun dan dijalankan terpisah.

**Vercel + Supabase Database saja belum menjalankan seluruh flow.** Dua kebutuhan runtime masih harus dipenuhi sebelum menerima upload/pembiayaan melalui deployment publik:

1. **Worker persisten:** `apps/worker/main.ts` menjalankan pg-boss, OpenRouter, parsing dokumen, indexer, dan rekonsiliasi transaksi. Jalankan sebagai proses Node terpisah pada host/container yang selalu hidup. Ia tidak dijalankan oleh build atau request Vercel.
2. **Storage dokumen bersama:** `packages/agents/storage.ts` menyediakan adapter bucket privat Supabase. Pilih `DOCUMENT_STORAGE_DRIVER=supabase` pada web dan worker. Byte dokumen dan salt disimpan privat; unduhan pengguna tetap melalui otorisasi API Talunai. Vercel menolak fallback ke filesystem. Data lama harus dipindahkan beserta salt dan storage key yang sama.

Adapter filesystem tetap tersedia untuk lokal. Build sukses saja tidak membuktikan bahwa migrasi atau deployment runtime selesai; verifikasi dengan pemeriksaan di bagian akhir.

## 1. Import repository ke Vercel

- Repository: `faawwaz/talunai`, branch `main`.
- Root directory: `.` (root), framework: **Next.js**.
- Node.js: **24.x** (sesuai `package.json`).
- Install command: `npm ci`.
- Build command: `npm run build:web` (sudah di `vercel.json`).
- Output directory: default Next.js. Jangan pilih static export.

Build web tidak menjalankan migrasi, seed, deployment kontrak, atau worker. Alamat kontrak testnet sudah ada di `deployments/bsc-testnet.json`; tidak perlu deploy ulang hanya untuk mengganti host web.

## 2. Supabase sebagai PostgreSQL

Gunakan proyek Supabase terpisah untuk demo ini. Salin URI database dari panel **Connect**. Untuk driver `postgres` yang sekarang dipakai Talunai, gunakan koneksi **direct** atau **session pooler port 5432**, dengan TLS sesuai URI Supabase. Session pooler dapat digunakan saat host hanya mendukung IPv4.

**Jangan memakai transaction pooler port 6543 dengan konfigurasi saat ini.** Driver masih menggunakan prepared statements. Dokumentasi Supabase juga mencatat interaksi pipelining `postgres.js` dengan shared transaction pooler. Perubahan driver/pooling perlu diuji terhadap transaksi dan advisory lock Talunai dahulu.

Web memiliki dua pool: default Vercel raw SQL 2 koneksi dan Drizzle 1 per instance (lokal 12 + 4). Atur `DATABASE_POOL_MAX`, `DATABASE_ORM_POOL_MAX`, serta `WORKER_DATABASE_POOL_MAX` (default pg-boss 5). Total koneksi tetap bertambah dengan jumlah instance.

Untuk pooler dengan CA Supabase, isi `DATABASE_SSL_CA_BASE64` dengan PEM CA resmi yang di-base64. Verifikasi TLS tetap aktif. Jangan memakai `rejectUnauthorized=false`, dan hindari parameter `sslmode` di URL saat menggunakan CA eksplisit karena parser node-pg dapat menggantinya.

**Lindungi Data API Supabase:** nonaktifkan bila tidak dipakai, atau aktifkan RLS tanpa policy publik pada seluruh tabel aplikasi dan cabut hak schema/tabel/function dari `anon` dan `authenticated`. `pgboss` tidak boleh menjadi exposed schema. Talunai memakai API Next.js dengan SIWE/RBAC, bukan Supabase Auth/PostgREST. Tabel sesi, dokumen, dan keuangan tidak boleh terekspos lewat Data API tanpa RLS yang sesuai. Jangan memasukkan URL database atau secret ke variabel `NEXT_PUBLIC_*`.

## 3. Env web

Masukkan melalui Vercel Project Settings → Environment Variables. Jangan mengunggah `.env.local` atau mengubah file lokal menjadi konfigurasi cloud.

| Variabel                                      | Nilai / cara mengisi                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `APP_ENV`                                     | `testnet` (bukan `production`; ini jaringan aset uji)                                                  |
| `DATABASE_URL`                                | URI direct/session pooler Supabase dengan password yang di-URL-encode dan TLS                          |
| `APP_ORIGIN`                                  | `https://domain-demo-anda` tanpa trailing slash                                                        |
| `SIWE_DOMAIN`                                 | `domain-demo-anda` tanpa protokol                                                                      |
| `SIWE_URI`                                    | Sama dengan `APP_ORIGIN`                                                                               |
| `SESSION_SECRET`                              | Secret acak minimum 32 karakter                                                                        |
| `CLAIM_ID_HMAC_KEY`                           | Secret acak minimum 32 karakter; pertahankan key lama jika memindahkan database yang sudah berisi Deal |
| `CLAIM_ID_HMAC_KEY_VERSION`                   | `1`, atau versi yang sama dengan database yang dipindahkan                                             |
| `CHAIN_ID`                                    | `97`                                                                                                   |
| `RPC_HTTP_URL`                                | RPC BNB Chain Testnet dengan dukungan histori yang dibutuhkan indexer                                  |
| `RPC_FALLBACK_HTTP_URL`                       | RPC testnet kedua, opsional                                                                            |
| `CHAIN_CONFIRMATIONS`                         | `3`                                                                                                    |
| `INDEXER_RESCAN_BLOCKS`                       | `64`                                                                                                   |
| `CONTRACT_REGISTRY_ADDRESS`                   | `registry` dari manifest testnet                                                                       |
| `CONTRACT_VAULT_ADDRESS`                      | `vault` dari manifest testnet                                                                          |
| `CONTRACT_AGENT_EXECUTOR_ADDRESS`             | `executor` dari manifest testnet                                                                       |
| `MOCK_IDR_ADDRESS`                            | `token` dari manifest testnet                                                                          |
| `DEPLOYMENT_START_BLOCK`                      | `deploymentStartBlock` dari manifest testnet                                                           |
| `LLM_MODE`                                    | `live`                                                                                                 |
| `OPENROUTER_MODEL`                            | `openai/gpt-4.1` (harus sama dengan worker)                                                            |
| `DOCUMENT_MAX_BYTES`                          | `4000000` untuk upload melalui Vercel; gunakan batas sama pada worker                                  |
| `DOCUMENT_MAX_PAGES`                          | `20`                                                                                                   |
| `DOCUMENT_STORAGE_DRIVER`                     | `supabase`                                                                                             |
| `SUPABASE_URL`                                | URL proyek Supabase                                                                                    |
| `SUPABASE_SERVICE_ROLE_KEY`                   | Secret server untuk bucket privat; jangan `NEXT_PUBLIC_*`                                              |
| `SUPABASE_STORAGE_BUCKET`                     | `talunai-documents`, public=false                                                                      |
| `DATABASE_SSL_CA_BASE64`                      | CA resmi Supabase dalam base64, TLS diverifikasi                                                       |
| `DATABASE_POOL_MAX` / `DATABASE_ORM_POOL_MAX` | `2` / `1`                                                                                              |

Vercel membatasi request/response function hingga 4,5 MB. Batas 4.000.000 byte memberi ruang untuk multipart, dengan storage bersama Supabase. Upload lebih besar memerlukan alur upload langsung dengan otorisasi, validasi, dan finalisasi yang sesuai.

Jangan memasukkan `OPENROUTER_API_KEY`, `AGENT_PRIVATE_KEY`, maupun key peserta ke env web. Domain login harus persis sesuai env: preview Vercel dengan hostname berbeda memerlukan konfigurasi/lingkungan tersendiri. Tetapkan satu domain demo stabil untuk SIWE.

`VERCEL_OIDC_TOKEN` bukan konfigurasi Talunai dan tidak perlu disalin secara manual dari proyek lain.

## 4. Worker

Gunakan database, chain, alamat kontrak, mode/model agent, serta storage yang sama dengan web. Secret worker hanya berada pada host worker:

```dotenv
LLM_MODE=live
OPENROUTER_MODEL=openai/gpt-4.1
OPENROUTER_API_KEY=<isi-di-secret-manager-worker>
AGENT_PRIVATE_KEY=<key-agent-testnet-yang-sudah-memiliki-role>
AGENT_MAX_STEPS=8
AGENT_TIMEOUT_MS=30000
```

Build dan start dengan environment yang diinjeksi platform:

```bash
npm ci
npm run build:worker
node dist/worker/main.js
```

`npm run worker` dan `npm run start:worker` ditujukan untuk lokal dan membaca `.env.worker`. Di cloud gunakan perintah Node langsung di atas. Jangan menjalankan dua worker saat memindahkan satu lingkungan aktif. Worker membutuhkan RPC yang dapat membaca blok/event historis; RPC publik dengan batas histori bisa membuat sinkronisasi dari deployment block gagal. Recovery berbasis receipts yang tersedia tetap memerlukan bukti onchain yang valid.

## 5. Database kosong atau migrasi case lama

### Lingkungan baru

Buat file privat `.env.deploy` berisi env target. File ini diabaikan Git. Jalankan migrasi dari mesin/runner tepercaya:

```bash
node --env-file=.env.deploy --import tsx scripts/migrate.ts
```

Jika perlu seed akun, tambahkan keenam `SEED_*_ADDRESS` dari manifest/identitas testnet yang memang dipakai, lalu jalankan:

```bash
node --env-file=.env.deploy --import tsx scripts/seed.ts
```

Seed hanya membuat akun/organisasi; ia tidak memindahkan dokumen atau menciptakan riwayat case yang sudah selesai. Gunakan alamat peserta dan agent yang sesuai izin kontrak. Jangan memakai akun Anvil publik di testnet.

### Mempertahankan case gula kelapa yang sudah selesai

1. Simpan backup PostgreSQL dan direktori dokumen privat. Gunakan tool `pg_dump`/restore yang cocok dengan versi database.
2. Hentikan mutasi dan worker saat mengambil snapshot untuk cutover konsisten.
3. Pindahkan schema/data Talunai beserta checkpoint indexer, event, audit, izin, dan antrean pg-boss yang relevan. Jangan menyalin schema internal Supabase atau menghapus proyek target secara massal.
4. Pindahkan file dokumen dan metadata salt secara privat dengan storage key yang sama. PostgreSQL saja tidak berisi byte PDF.
5. Pertahankan `CLAIM_ID_HMAC_KEY` dan versinya agar identitas invoice tetap konsisten. Secret sesi dapat dirotasi dengan konsekuensi pengguna login ulang.
6. Jalankan migrasi yang belum diterapkan, lalu hidupkan satu worker pada database target.
7. Verifikasi readiness, login setiap peran, dokumen, status Deal, dan saldo dari chain. Baru alihkan web.

Jangan menjalankan `demo:run` pada database cloud aktif untuk berpura-pura mengimpor case. Runner itu menyiapkan layanan lokal dan dapat mengirim transaksi testnet baru; bukan tool migrasi.

## 6. Pemeriksaan setelah deployment

- `/health/live`: proses web menjawab.
- `/health/ready`: database, chain, worker, dan indexer benar-benar siap.
- `/v1/config`: alamat/jaringan publik sesuai manifest; tidak memuat secret.
- Login wallet di domain final; pastikan izin dan organisasi benar.
- Upload PDF → analisis worker → lihat dokumen kembali melalui API terotorisasi.
- Jalankan satu Deal baru yang terisolasi untuk memverifikasi persetujuan, pendanaan, pembayaran, dan penarikan.

Build sukses tidak membuktikan seluruh runtime siap. Adapter cloud memiliki unit test privasi, traversal, rollback, dan roundtrip commitment. Retensi orphan di cloud belum otomatis; cleanup lokal tidak menyentuh bucket. Deployment tetap harus lulus pengujian runtime setelah migrasi.

## Sumber resmi

- [Supabase: koneksi PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase: Postgres.js dan batas transaction pooler](https://supabase.com/docs/guides/database/postgres-js)
- [Supabase: keamanan Data API](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase: storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Vercel: batas Functions](https://vercel.com/docs/functions/limitations)

Ditinjau 30 September 2026. Tidak ada credential cloud, private key, atau database dump di repository publik.
