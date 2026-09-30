# Handoff frontend TALUNAI

Dashboard menggunakan Next.js dan backend Route Handlers dalam repository yang sama; landing page ditunda. Gunakan typed client [`packages/client/index.ts`](../packages/client/index.ts), tipe [`packages/client/types.ts`](../packages/client/types.ts), OpenAPI [`openapi.json`](./openapi.json), dan rincian [`API.md`](./API.md).

## Workspace per peran (29 September 2026)

Pintu masuk `/app` mengarahkan membership approved ke `/borrower`, `/buyer`, `/lender`, `/verifier`, atau `/admin`. `/agent` adalah konsol operator ADMIN/VERIFIER, bukan principal machine agent. Pemilihan ruang kerja hanya tersedia untuk peran yang benar-benar dimiliki. SSR guard berada pada setiap leaf request; API tetap menjadi batas otoritatif. Next dapat merender not-found privat sebagai streamed 200 dengan marker 404; tidak ada data privat dalam body dan API tetap 403/404.

Gunakan `useWorkspaceNavigation` untuk semua tautan claim. Route lama `/app/claims/...` dialihkan sesuai peran. `safeWorkspaceReturn` membatasi tujuan setelah login ke area tepat, tanpa redirect ke domain lain.

[Fitur dan prasyarat per peran](ROLE_FEATURE_MATRIX.md) · [Ops UI](OPS_UI.md) · [Ops API dan replacement recovery](ROLE_API.md).

Display token **MockIDR Testnet** memakai `TokenIdentity`; dialog menerangkan alamat immutable, desimal 0, dan token tanpa nilai. Kontrak transaksi selalu berasal dari konfigurasi chain. Ikon dan identitas: [ASSETS.md](design/ASSETS.md).

## Perjalanan actor

| Actor    | Urutan                                                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Borrower | SIWE → draft issuer canonical → upload bukti → analyze → menanggapi request bukti → lihat offer versi final → exact-term consent → registry/funding tracking → residual withdrawal |
| Buyer    | SIWE → claim terkait → tinjau bukti/pengakuan invoice → exact-term acknowledgement → approve token → collect payment parsial/penuh → dispute bila ada bukti                        |
| Verifier | SIWE → task bukti/review → human approval independen → REGISTER transaction setelah kedua consent → fresh review lalu CLEAR_HOLD bila dispute terselesaikan                        |
| Lender   | SIWE → claim yang dibagikan → nominal dan risiko → approve principal → FUND transaction → pantau collection dan lender outstanding → withdrawal                                    |
| Agent    | Principal worker terpisah; ekstraksi/policy/request bukti/hold terbatas. Tidak ada participant key di backend.                                                                     |

Aktor baru mendapat profil pending tanpa membership, lalu mengajukan akses melalui form workspace. ADMIN meninjau permohonan di `/admin/access`, memilih organisasi kanonik yang telah ditinjau dan menyetujui/menolak versi tertentu. Pembuatan organisasi sintetis baru adalah langkah admin eksplisit. Allowlist lender onchain tetap terpisah. Wallet connect belum login; SIWE login belum financing consent dan bukan ERC-20 approval. P0 EOA; tampilkan error eksplisit bagi contract wallet.

`me()` memberikan `CurrentUser`: status user aktual, wallet dan membership dengan `organizationName`, `organizationKind`, `organizationStatus`, serta `role`. Tampilkan onboarding pending bila membership kosong; jangan menyediakan pilihan role demo yang menaikkan privilege. Agent wallet bukan identitas participant.

## Metadata barang dan pembuatan claim

Produk membiayai `TRADE_RECEIVABLE`: invoice B2B fixed amount setelah penyerahan barang dan pengakuan buyer. Goods category `COCOA` adalah demo utama; `PACKAGING` membuktikan alur yang sama untuk barang nonagrikultur. Jangan menawarkan pembiayaan PO, panen masa depan, persediaan, properti, atau emas sebagai asset type tambahan.

Form menerima `goods: { category, description, lineItems: [{ description, quantity, unit }] }`. Quantity adalah string desimal positif dengan titik, maksimal enam angka pecahan; nominal uang tetap string integer. Kategori `OTHER` dan metadata kosong perlu review; tidak diasumsikan kakao. Kebijakan P0 merekonsiliasi bukti untuk satu line item; beberapa line item masuk review sampai reconciliation tersedia. Metadata bukan input harga untuk menghitung ulang nilai invoice.

Ambil buyer/lender melalui `api.organizations({issuerOrganizationId, role})`; jangan meminta pengguna mengetik organization ID atau payout address. Lookup hanya tersedia bagi borrower approved pada issuer tersebut. Pemilihan counterpart tidak memberi authority baru. `PATCH` metadata menaikkan version dan membatalkan review/consent lama; setelah registrasi metadata immutable.

## Read models dan pemulihan halaman

| Client method                                           | Penggunaan                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `config()` / `me()`                                     | PublicConfig deployment dan CurrentUser aktual                                          |
| `claims(limit, offset, {search, workflow})`             | Pencarian nomor invoice dan workflow di server; `total` sesuai authorization dan filter |
| `evidence(claimId)`                                     | Metadata dokumen aman, policy, attestations, ringkasan consent dan review               |
| `downloadDocument(documentId)`                          | Blob dari endpoint privat yang memeriksa object authorization                           |
| `agentActivity(limit, offset)`                          | Run agent lintas claim yang dapat dibaca actor                                          |
| `agentRuns(claimId, limit, offset)` / `agentRun(runId)` | Riwayat run dan detail langkah yang tersimpan                                           |
| `transactions(claimId, limit, offset)`                  | Intent milik user sesi; memulihkan transaksi pending setelah reload                     |
| `reviewTasks(limit, offset)`                            | Task terbuka sesuai actor dan claim                                                     |

Tipe publik meliputi `PublicConfig`, `CurrentUser`, `Claim`, `ClaimTerms`, `GoodsMetadata`, `ActionName`, `TransactionTemplate`, `DocumentMetadata`, `AgentRun`, `TransactionIntent`, dan `ReviewTask`. Nama organisasi berasal dari backend. Jangan memalsukan chart atau finance state ketika data kosong; tampilkan empty state atau data terkonfirmasi yang ada.

Document metadata berisi nama, MIME, ukuran byte, status, waktu unggah/retensi dan authorized download URL. Tidak ada storage path/salt. `evidence.consents` menyatakan consent yang tercatat offchain, bukan konfirmasi chain; tidak mengandung signature/nonce. Bandingkan version dan revoked/expiry sebelum menampilkan kesiapannya. Review terakhir juga dapat merujuk versi lama.

## State yang harus ditampilkan terpisah

Workflow: `DRAFT`, `EXTRACTING`, `NEEDS_REVIEW`, `READY_FOR_SIGNATURES`, `READY_FOR_REGISTRATION`, `REGISTRATION_PENDING`, `REGISTERED`, `REJECTED`, `CANCELLED`, `PROCESSING_FAILED`.

Financing: `UNFUNDED`, `ACTIVE`, `PARTIALLY_RECOVERED`, `REPAID`. Collection: `UNPAID`, `PARTIALLY_COLLECTED`, `FULLY_COLLECTED`. Withdrawal adalah nominal tersendiri, bukan status financing. `fundingHold` dan `hasDispute` terpisah. Hold tidak berarti uang sudah kembali.

Evidence: `MISSING`, `PENDING`, `SUPPORTED_BY_DOCUMENT`, `ATTESTED`, `REJECTED`, `STALE`, `NOT_INTEGRATED`. Tampilkan `extractionStatus`, issuer/buyer authority, buyer acknowledgement, delivery, duplicate, external encumbrance dan human review satu per satu. Jangan ubah seluruh panel menjadi boolean “verified”.

Transaction intents: `PREPARED`, `SUBMITTED`, `MINED`, `CONFIRMED`, `REVERTED`, `REPLACED`, `DROPPED_OR_UNKNOWN`. Timeout tidak berarti gagal atau sukses. Tx hash observe hanya hint. `CONFIRMED_PROJECTION` berarti saldo berasal dari event canonical sesuai policy confirmations deployment; `NO_CONFIRMED_PROJECTION` berarti belum ada proyeksi terkonfirmasi. `DEGRADED_LAST_CONFIRMED_PROJECTION` berarti proyeksi terakhir tersedia tetapi checkpoint stale atau indexer degraded; tampilkan data sebagai historis dan hentikan exposure baru.

## Payload dan concurrency

- Financial amount harus string integer exact. Gunakan `BigInt` untuk perhitungan; format tampilan dengan locale `id-ID`. MockIDR decimals 0; 1 unit merepresentasikan Rp simulasi tanpa nilai/redeemability.
- Timestamp terms Unix seconds UTC. Tampilan tanggal `Asia/Jakarta`. Jangan menampilkan “tenor 45 hari” bagi funding yang terlambat; hitung berdasarkan tanggal sebenarnya.
- Setiap edit/upload menaikkan versi dan membatalkan consent/review lama. Review approval normal juga finalisasi versi baru. Selalu fetch claim terbaru dan kirim `expectedVersion` yang sedang ditampilkan.
- Gunakan idempotency key baru untuk intent pengguna baru, dan key yang sama bila me-retry intent yang sama. 409 `IDEMPOTENCY_CONFLICT` membutuhkan pemeriksaan payload. 409 `STALE_VERSION` membutuhkan fetch ulang dan persetujuan ulang, bukan auto-resubmit terms berbeda.
- Upload multipart berisi `file` dan `expectedVersion`; menerima `.txt`, fixture `.json` dengan `isSynthetic:true`, PDF text. Maksimum 10 MiB/20 halaman. Upload menghasilkan `PENDING_PARSE`; parsing text/PDF berjalan di worker sesudah analyze. Scan tanpa OCR menghasilkan `NEEDS_MANUAL_ENTRY`, PDF rusak/terenkripsi menandai processing failure eksplisit. Dokumen hanya tersedia lewat authorized download endpoint.
- Analyze mengembalikan 202 dan run ID setelah persistence. Poll run dengan interval terbatas. Worker berjalan terpisah dari request lifecycle.

## Signing dan transaksi

1. Fetch public `/v1/config`, tolak wallet chain selain deployment chain 97/31337; selalu tampilkan alamat token+registry aktual dari config.
2. SIWE challenge → sign message persis → verify. Opaque session cookie HttpOnly dikelola browser dengan credentials include. Cookie `talunai_csrf` terpisah, readable pada origin sama, `SameSite=Strict`, Secure di HTTPS; typed client memulihkan header CSRF dari cookie setelah reload. Browser mengirim Origin secara native. Logout mencabut session serta membersihkan cookie. Tidak ada JWT/localStorage.
3. Consent prepare membutuhkan role, exact current version dan nonce string. Tampilkan seluruh terms, expiry dan synthetic fee, lalu wallet menandatangani typed data server. Primary types borrower/buyer berbeda; jangan mengganti domain, recipient, nominal atau deadline.
4. Kirim signature ke consent endpoint. Jangan menandai registered karena signature sudah diterima.
5. Prepare action menghasilkan template sender/target/calldata tetap. Tampilkan tindakan dan nominal; signer harus wallet sesi. Sender transaksi mengirim langsung ke chain. Tidak pernah mengirim participant key ke backend.
6. Setelah memperoleh hash nyata, observe dengan intent ID. Poll intent milik user dan finansial/audit sampai proyeksi confirmed. Reload tidak perlu menyiapkan/mengirim transaksi yang sama lagi. Bila reverted/unknown, tampilkan status itu. Simulasi bukan jaminan transaksi mined.

Action buttons mengikuti role dan prasyarat API. Client-side hiding hanya UX; otorisasi server/contract tetap wajib. Lender melihat hanya claim dengan explicit access. Jangan menampilkan dokumen di URL publik atau mengirim isi mentahnya ke analytics.

Untuk clear hold, verifier melakukan review baru `resolvesDispute:true` dengan evidence IDs lalu menandatangani CLEAR_HOLD. UI menampilkan hold sampai event canonical terkonfirmasi. Terms immutable tetap sama, dan expiry/cancellation tidak dapat dilewati.

## Contoh finance

Outstanding `100000000`, principal `70000000`, fixed fee `1050000`. Funding mencairkan principal atomik ke borrower. Collection `50000000`: lender allocated 50 juta, lender outstanding 21,05 juta, invoice outstanding 50 juta. Collection kumulatif `71050000`: financing `REPAID`, collection `PARTIALLY_COLLECTED`, invoice outstanding 28,95 juta. Collection kumulatif 100 juta: invoice fully collected, borrower residual allocated 28,95 juta. Withdrawal mengurangi claimable, bukan total collection. Saldo token wallet/vault dari donasi bukan pembayaran invoice.

## Disclosure yang selalu terlihat

TALUNAI adalah demo sintetis testnet/lokal: tidak ada token bernilai, dana fiat, legal title/RWA resmi, registry gudang/KYB live, kredit terkalibrasi atau audit kontrak. Fee flat bukan APR atau janji hasil. `LLM_MODE=mock` harus berlabel MOCK; live memakai OpenRouter hanya bila key/config valid dan hasil nyata tersedia. External encumbrance `NOT_INTEGRATED`; dedup deployment tidak membuktikan tidak ada financing di luar platform. Dokumen/attestation dapat salah atau kolusif; verifier/admin adalah trust pihak terpusat.

## Penanganan error

401 kembali ke login. 403 periksa actor/origin/CSRF, tanpa menaikkan privilege melalui client. 404 dapat berarti inaccessible object. 409 tampilkan stale terms/hold/idempotency/chain conflict dan refresh tanpa menandatangani ulang otomatis. 422 tampilkan error field/evidence/policy; `GOODS_REVIEW_REQUIRED` menghentikan registration/funding metadata yang belum didukung. 429 tunggu retry. 503 tampilkan layanan/chain/indexer unavailable; jangan membuat optimistic funded/repaid state. Client menormalisasi kegagalan jaringan menjadi `NETWORK_UNAVAILABLE`, respons HTML gagal menjadi `HTTP_ERROR`, dan JSON sukses rusak menjadi `INVALID_RESPONSE`. Sertakan correlation ID untuk diagnosis, tanpa cookie, signature lengkap atau isi dokumen dalam log publik.


## Implementasi workspace saat ini

- Session/context: `src/features/session/provider.tsx`; cookie sesi HttpOnly, CSRF cookie terpisah. Cache data privat dikunci sebelum permintaan logout; kegagalan pencabutan server ditampilkan dan dapat dicoba lagi.
- Browser memverifikasi ulang typed-data domain versi1, primary type, signer sesuai pihak, hash terms dari ABI kontrak, claim/version/expiry. Template transaksi harus cocok dengan action, selector, target, token allowance spender dan nominal yang ditampilkan; agentExecutor bukan target transaksi peserta.
- `src/features/claims/pending.ts` menyimpan **hash hint nonsecret** di sessionStorage dengan scope user/wallet/chain/claim/intent. Ini bukan token autentikasi. Setelah reload, rekonsiliasi memeriksa hash yang sama; tidak otomatis broadcast ulang. Penyimpanan berlaku selama tab. Bila storage gagal, salin hash; bila wallet belum memberikan hash, cek riwayat wallet/operator.
- `/` dan `/login` membuka `/app`; landing dan hero3D ditunda. Panduan contoh statis telah dihapus dan `/app/demo` mengarah ke `/app`. Pengunjung anonim mendapat penjelasan login dan alur singkat tanpa wallet popup otomatis.
- Wallet pending mendapat `AccessOnboarding`: GET/POST `/v1/access-request`, idempotent, state PENDING/APPROVED/REJECTED. Refresh terbatas; APPROVED memuat ulang keanggotaan dan membuka workspace. Wallet agent/admin/verifier tetap tidak dapat memperoleh role peserta lewat form ini. Lihat [ONBOARDING](ONBOARDING.md) untuk kontrak API lengkap.
- Peran agent onchain tidak memberikan membership browser. Seed/provision participant tetap CLI privat; tidak ada endpoint publik mint/admin.

`npm run test:ui` menggunakan aktor sintetis dan backend nyata, dengan satu fault injection 503 eksplisit untuk menguji retry. Laporan menunjukkan metode wallet yang dipakai; tidak ada sendTransaction dalam harness. AXE/screenshot tidak membuktikan Core Web Vitals persentil75 atau audit aksesibilitas penuh.

Revisi pada Ringkasan mencakup metadata kategori/deskripsi/line items, nominal dan jatuh tempo. Form menyimpan versi yang sedang diedit; jika versi server berubah, user memuat data terbaru secara eksplisit sebelum mencoba lagi. Input tidak hilang ketika request gagal.
