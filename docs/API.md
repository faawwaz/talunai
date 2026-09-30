# TALUNAI API

Backend Next.js Route Handlers berada di `/v1/*`; business logic ada di `packages/api/`, dan modul tersebut memakai standard `Request`/`Response` tanpa API Next.js. Dashboard menggunakan API yang sama. Worker Node terpisah memproses transactional outbox, ekstraksi dokumen, indexing, dan rekonsiliasi.

Spesifikasi mesin: [`openapi.json`](./openapi.json), tersedia juga melalui `GET /v1/openapi`. Typed client: [`packages/client/index.ts`](../packages/client/index.ts). Base URL lokal `http://localhost:3000`.

## Authentication dan mutation

1. `POST /v1/auth/challenge` dengan Origin persis `APP_ORIGIN`, body `{"address":"<wallet EOA>","chainId":31337,"accountType":"EOA"}`. Server mengirim cookie browser HttpOnly dan pesan SIWE lengkap yang berlaku lima menit.
2. Wallet menandatangani **pesan yang diterima**, lalu `POST /v1/auth/verify` dengan `challengeId`, `message`, `signature`, dan cookie browser. Response berisi `csrfToken`; cookie session opaque HttpOnly berlaku delapan jam. Cookie `talunai_csrf` dapat dibaca JavaScript pada origin yang sama sehingga client dapat memulihkan header CSRF setelah reload. Cookie tersebut bukan token sesi. Browser memakai `credentials: include`. Login bukan consent financing.
3. Mutation sesudah login mengirim `X-CSRF-Token` dan `Idempotency-Key` (logout hanya membutuhkan origin dan CSRF). Browser mengirim `Origin` secara native; client tidak mencoba memasang forbidden header tersebut. CLI memasang Origin konfigurasi secara eksplisit. Permintaan peran melalui onboarding belum memberi privilege; role berasal dari membership yang disetujui ADMIN atau di-provision melalui CLI tepercaya. [Endpoint dan alur onboarding](ONBOARDING.md).
4. `POST /v1/auth/logout` mencabut sesi dan menghapus cookie session, CSRF, serta browser challenge. Wallet baru mendapat profil `PENDING` tanpa membership atau privilege.

Cookie `SameSite=Strict`, `Secure` untuk HTTPS. Testnet memerlukan origin HTTPS dan chain 97. P0 hanya EOA; ERC-1271 ditolak. SIWE memakai hash challenge/pesan dan token browser serta atomic consume nonce; kegagalan signature tidak menghasilkan sesi. Session token disimpan sebagai keyed hash. Batas request JSON 64 KiB dibaca secara bounded; upload maksimal 10 MiB.

Idempotency scope: user + HTTP method + pathname + key. Body sama mengembalikan hasil logical sebelumnya; key sama dengan body berbeda menghasilkan 409. Hasil disimpan bersama mutation/outbox dalam transaksi PostgreSQL. Auth challenge/verify memiliki semantics single-use nonce; logout memiliki semantics pencabutan sesi.

## Alur request

Semua amount JSON adalah string integer desimal, bukan `Number`. Timestamp terms memakai Unix seconds UTC, invoice namespace/number dikanonisasi, dan wallet recipient di-resolve dari organisasi approved. Default cap 80%, fee flat 150 bps, cap principal 100 juta unit uji.

Asset type yang diterima hanya `TRADE_RECEIVABLE`: piutang B2B atas barang yang sudah diserahkan dan outstanding yang diakui buyer. Metadata `goods` mendeskripsikan barang; bukan collateral token atau basis revaluasi harga. Kategori P0 `COCOA` dan `PACKAGING`; `OTHER` memerlukan review dan belum lolos kebijakan exposure otomatis. Claim tanpa metadata tetap `goods: null`, bukan otomatis kakao. Edit metadata sebelum registrasi membuat versi baru serta mencabut review/consent lama. Metadata dan terms tidak dapat diedit setelah registrasi.

```json
{
  "assetType": "TRADE_RECEIVABLE",
  "goods": {
    "category": "COCOA",
    "description": "kakao",
    "lineItems": [{ "description": "kakao", "quantity": "10", "unit": "ton" }]
  },
  "organizationId": "org-borrower",
  "buyerOrganizationId": "org-buyer",
  "lenderOrganizationId": "org-lender",
  "invoiceNamespace": "2026",
  "invoiceNumber": "DEMO-KAKAO-001",
  "acceptedOutstanding": "100000000",
  "requestedPrincipal": "70000000",
  "invoiceDueAt": 1794528000,
  "fundingWindowSeconds": 82800
}
```

Contoh tanggal di atas hanya ilustrasi payload; CLI menghitung due date aktual saat persiapan. `fundingWindowSeconds` maksimal 86400. Server mengikat deadline pada timestamp RPC dan wall clock sehingga latest-block simulation tidak melewati cap kontrak. Testnet RPC tertinggal lebih dari 120 detik menolak exposure baru. Sesudah time travel lokal, reset chain sebelum membuat sesi demo baru dengan wall-clock dates.

| Endpoint                               | Otorisasi dan hasil                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health/live`                     | Publik, `{ "status": "alive" }`                                                                                                                                                                               |
| `GET /health/ready`                    | Publik, cek DB, hubungan kontrak/token/cap, checkpoint dan heartbeat; detail internal tidak dibocorkan                                                                                                        |
| `GET /v1/config`                       | Publik, alamat konfigurasi nyata, token, mode dan disclosure                                                                                                                                                  |
| `GET /v1/me`                           | Wallet, status user aktual, memberships berisi nama/kind/status organisasi dan role                                                                                                                           |
| `GET /v1/organizations`                | Borrower approved; daftar counterpart approved BUYER/LENDER dengan satu wallet authority; `issuerOrganizationId`, opsional `role`, `limit`, `offset`. Tidak mengekspos wallet authority                       |
| `POST /v1/claims`                      | Borrower dari organisasi issuer; 201 draft dengan `id`, `version`, `terms`                                                                                                                                    |
| `GET /v1/claims`                       | Hanya claim organisasi borrower/buyer, lender yang diberi akses, verifier/admin; `limit` 1–100, `offset`, `search` literal nomor invoice dan `workflow`; hasil berisi `items` dan `total` sesuai scope/filter |
| `GET /v1/claims/:id`                   | Workflow, terms, evidence, hold dan dispute terpisah                                                                                                                                                          |
| `PATCH /v1/claims/:id`                 | Borrower sebelum registrasi, `expectedVersion`; increment versi dan revoke consent/attestation lama                                                                                                           |
| `POST /v1/claims/:id/documents`        | Borrower, multipart `file` dan `expectedVersion`; private upload `PENDING_PARSE`, increment versi; parsing dilakukan worker saat analyze                                                                      |
| `GET /v1/documents/:id`                | Object authorization yang sama dengan claim; attachment, no-store                                                                                                                                             |
| `POST /v1/claims/:id/analyze`          | Borrower/verifier, `{ "expectedVersion": 2 }`; 202 setelah run dan outbox persisten                                                                                                                           |
| `GET /v1/agent-runs/:id`               | Run/status/stages/model mode dan hasil tervalidasi yang diotorisasi                                                                                                                                           |
| `GET /v1/agent-runs`                   | Aktivitas agent lintas claim yang diotorisasi, paginated                                                                                                                                                      |
| `GET /v1/claims/:id/agent-runs`        | Riwayat run milik claim yang diotorisasi, paginated                                                                                                                                                           |
| `GET /v1/claims/:id/evidence`          | Status bukti, metadata dokumen aman, attribution attestation, policy, ringkasan consent tanpa signature/nonce dan review terakhir                                                                             |
| `GET /v1/claims/:id/offer`             | Amount exact, fee, deadline dan disclosure                                                                                                                                                                    |
| `POST /v1/claims/:id/review`           | Verifier independen, evidence ID valid, reason, APPROVE/REJECT; finalisasi decision commitment dan versi baru                                                                                                 |
| `POST /v1/claims/:id/consents/prepare` | Borrower/buyer terkait; `expectedVersion`, `role`, `nonce`; role-specific EIP-712                                                                                                                             |
| `POST /v1/claims/:id/consents`         | Body prepare ditambah `signature`; verifikasi exact terms, signer dan chain nonce                                                                                                                             |
| `POST /v1/claims/:id/disputes`         | Borrower/buyer/verifier terkait; evidence ID dan reason; 202 bounded hold job                                                                                                                                 |
| `POST /v1/claims/:id/actions/prepare`  | Sender session; enum terbatas, simulasi sender nyata, simpan PREPARED intent                                                                                                                                  |
| `POST /v1/transactions/observe`        | Pemilik intent, hash sebagai hint; cocokan sender/target/calldata, simpan receipt state, enqueue reconcile                                                                                                    |
| `GET /v1/claims/:id/transactions`      | Riwayat intent **milik user sesi** pada claim yang diotorisasi; status, template, hash, replacement dan timestamps untuk pemulihan setelah reload                                                             |
| `GET /v1/claims/:id/financing`         | Proyeksi finansial confirmed, confidence dan block/hash                                                                                                                                                       |
| `GET /v1/claims/:id/audit`             | Audit objek, paginated; tanpa signature penuh atau document text                                                                                                                                              |
| `GET /v1/review-tasks`                 | Task terbuka sesuai actor/objek, paginated                                                                                                                                                                    |

Lender tidak mendapatkan akses universal karena status allowlist. Draft creation bisa memberi akses kepada satu lender approved melalui `lenderOrganizationId`; lender lain menerima 404 untuk claim maupun dokumennya. Duplicate canonical invoice menghasilkan conflict generik tanpa membocorkan data tenant.

Metadata dokumen: `id`, `version`, `name`, `mediaType`, `sizeBytes`, `status`, `createdAt`, `retentionAt`, dan `downloadUrl` ke endpoint privat. Respons tidak memuat storage path, salt, teks hasil ekstraksi atau isi file. Ringkasan consent memiliki `stateConfidence: RECORDED_OFFCHAIN`; status nonce/revocation chain tetap diperiksa saat menyiapkan transaksi. `review.version` harus dibandingkan dengan versi claim karena review terakhir dapat sudah stale.

## Consent, review dan transaksi

Review body contoh:

```json
{
  "expectedVersion": 2,
  "decision": "APPROVE",
  "reason": "Bukti sintetis delivery dan acknowledgement ditinjau.",
  "evidenceIds": ["<document UUID milik claim>"],
  "attestations": ["deliveryEvidenceStatus", "buyerAcknowledgementStatus"]
}
```

Review tidak mengeksekusi transaksi. Approval normal menghasilkan versi baru; fetch ulang claim sebelum prepare signatures. Gates kebijakan dihitung ulang secara deterministik. Konflik material yang belum selesai memblokir approval. Decision commitment mengikat policy snapshot, policy hash aktif, asset type, metadata goods lengkap, reviewer, evidence IDs dan versi baru. Consent prepare maupun submit memerlukan review manusia untuk versi tersebut yang belum kedaluwarsa; status agent `READY_FOR_SIGNATURES` saja belum cukup. Signature borrower dan buyer menggunakan primary type berbeda dan mengikat claimKey/version/termsHash/nonce/deadline serta EIP-712 domain chain+registry.

```json
{ "expectedVersion": 3, "role": "BORROWER", "nonce": "123456" }
```

Prepare action contoh:

```json
{
  "expectedVersion": 3,
  "action": "COLLECT_BUYER_PAYMENT",
  "amount": "50000000"
}
```

Response berupa `intentId`, `status: PREPARED`, `transaction: { chainId, from, to, data, value, simulationBlock, action }`. Wallet memeriksa chain/from, lalu menandatangani/mengirim transaksi. Backend tidak menerima participant private key. Setelah broadcast kirim `{"intentId":"<UUID>","hash":"<tx hash nyata>"}` ke observe. Mining/confirmation dapat berubah; hanya canonical confirmed indexer yang mengubah proyeksi saldo.

Action enum: `REGISTER`, `CANCEL`, `APPROVE_TOKEN`, `FUND`, `COLLECT_BUYER_PAYMENT`, `WITHDRAW_LENDER`, `WITHDRAW_BORROWER`, `CLEAR_HOLD`, `REVOKE_CONSENT`. Tidak ada custom target, arbitrary calldata atau parameter recipient. Approval token dibatasi principal lender atau outstanding buyer. REGISTER membutuhkan verifier dengan review+dua consent current. Funding/persiapan registration berhenti bila checkpoint tidak fresh/degraded atau ada dispute/hold.

Untuk clear hold pada claim terdaftar, verifier membuat review APPROVE baru dengan `resolvesDispute: true`, reason dan evidence IDs. Jalur ini mempertahankan terms/version immutable, mencabut attestation dispute yang direview, dan mencatat fresh commitment. Setelah itu verifier menandatangani action CLEAR_HOLD. Flag hold onchain tetap berlaku sampai event terkonfirmasi. Expiry/cancellation tidak dapat dihidupkan oleh clear hold.

Replacement memerlukan intent sebelumnya dari actor/sender/claim/action yang sama, template ekonomi sama, dan nonce transaksi lama/baru yang dapat diverifikasi. Hash unknown tidak cukup untuk menandai transaksi lama REPLACED.

## Errors

```json
{
  "error": { "code": "STALE_VERSION", "details": { "currentVersion": 3 } },
  "correlationId": "<UUID>"
}
```

| HTTP | Contoh code                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| 401  | `AUTH_REQUIRED`, `SESSION_INVALID`, `CHALLENGE_INVALID`, `SIGNATURE_INVALID`, `NONCE_CONSUMED`                                |
| 403  | `ROLE_FORBIDDEN`, `ORIGIN_MISMATCH`, `CSRF_INVALID`, `REVIEWER_CONFLICT`, `BUYER_ONLY`                                        |
| 404  | `CLAIM_NOT_FOUND`, `DOCUMENT_NOT_FOUND`, `INTENT_NOT_FOUND` termasuk objek yang tidak diotorisasi                             |
| 409  | `STALE_VERSION`, `IDEMPOTENCY_CONFLICT`, `CONFLICT_REQUIRES_REVIEW`, `HOLD_OR_DISPUTE`, `CHAIN_VALIDATION_FAILED`             |
| 413  | `BODY_TOO_LARGE`, `DOCUMENT_SIZE_LIMIT`                                                                                       |
| 422  | `VALIDATION_ERROR`, `ACCOUNT_TYPE_UNSUPPORTED`, `EVIDENCE_REFERENCE_INVALID`, `EVIDENCE_GATES_UNMET`, `GOODS_REVIEW_REQUIRED` |
| 429  | `RATE_LIMITED`                                                                                                                |
| 503  | `CHAIN_UNAVAILABLE`, `INDEXER_NOT_FRESH`, `RPC_TIMESTAMP_STALE`                                                               |

LLM prompt/text bukan sumber role, wallet, kebijakan atau saldo. `NOT_INTEGRATED` tetap muncul untuk external encumbrance. Audit append-only berlaku pada boundary aplikasi; administrator database tetap dapat menulis ulang database.


## Konsol operator dan recovery wallet

Endpoint `/v1/ops/*`, pemeriksaan membership+organisasi setiap request, serta `/v1/transactions/:id/replacement` dijelaskan di [ROLE_API.md](ROLE_API.md). Semua response baru tercantum pada `openapi.json`; client bertipe menyertakan DTO operator pada `packages/client/ops-types.ts`.
