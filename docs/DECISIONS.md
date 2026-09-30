# TALUNAI design decisions

Date: 2026-09-28 (Asia/Jakarta). Synthetic demonstration only.

- User override: Next.js App Router at repository root, TypeScript strict, npm and package-lock.json. No Fastify, additional API server, or product frontend. Next Route Handlers delegate to framework-independent modules.
- One Node worker runs pg-boss, document workflow, transactional outbox, chain indexer and reconciliation. HTTP requests never start background workers.
- PostgreSQL stores authentication, identity, evidence, application intent, immutable versions and canonical event projections. Financial values cross JSON as decimal strings and calculations use bigint. MockIDR has zero decimals.
- Only chains 31337 and 97. Compiler 0.8.28 targets Paris; a successful Anvil deployment is local compatibility evidence, not a BSC deployment claim.
- Fixed invoice outstanding, 80% advance cap, 1.5% flat synthetic fee rounded upwards, principal cap 100,000,000. Pricing is a demo policy, not underwriting or APR. No commodity price liquidation.
- Immutable onchain terms bind claimKey, version, counterparties, token, amounts, funding/review/consent deadlines, invoice due time, evidence, policy and decision commitments. EIP-712 consent uses distinct borrower and buyer types, with consumed/revoked nonces.
- Invoice canonical identity uses approved organization ID plus invoice namespace and normalized invoice number. A stable composite organization/namespace/invoice constraint protects uniqueness across HMAC key rotations; historical keys remain on claims. Public commitments salt private evidence.
- One lender atomically funds and disburses principal. Only the registered buyer collects into a funded deal. Principal is allocated first, fee second, borrower residual last. Withdrawal, financing repayment and invoice collection remain distinct.
- Agent has a separate principal and can only submit evidence-bound funding holds or risk observations. Recipient, approval, mint, funding, registration and participant withdrawals are outside its capability.
- Conventional EOA support only. SIWE is login, not KYB or consent. Human verifier and demo administrator are trusted; synthetic organizations are provisioned through CLI.
- Confirmed event projections retain canonical block hashes and audit reorg reversals. Confirmation count is configurable and is not a protocol finality guarantee. Exposure is refused while degraded.
- Docker access is unavailable in the implementation environment. Native ephemeral PostgreSQL and npm-distributed Foundry tools provide an additional local test route; Docker Compose remains supplied and its execution status is reported explicitly.

See `contracts/INTERFACE.md`, `THREAT_MODEL.md`, `LIMITATIONS.md` and `TEST_REPORT.md` for exact boundaries and evidence.


## Override produk dan frontend — 28 September 2026

Core adalah piutang perdagangan B2B `TRADE_RECEIVABLE`; kakao hanya demo utama dan kemasan demo kedua. Generic goods metadata berada dalam version snapshot dan review decision commitment. Kategori kosong/OTHER tidak otomatis eligible. Batas pembukuan/role/token/financial contract tetap sama; tidak redeploy untuk perubahan metadata. Lihat [GOODS_SCOPE](GOODS_SCOPE.md).

Pengguna kemudian mengizinkan frontend: workspace dibangun dahulu dan landing ditunda. Next App Router tetap satu monolith, worker terpisah. Tailwind + Base UI/shadcn composition, Manrope, TanStack Query/Form/Table dan Motion; npm lockfile tetap tunggal. Sidebar, financial read models dan actions memakai API nyata. Semua pending/onchain confirmation bersumber dari intent/projection, tidak optimistic success. Lihat [referensi visual](design/REFERENCES.md).
