# Role and operator API

## Access boundary

Every API request authenticates the opaque SIWE session and reloads approved memberships **joined to an APPROVED organization**. Revoking either membership or organization removes authority on the next request, including ordinary claim reads. A connected wallet and a pending access request grant no participant or operator rights.

The human operator console is separate from the `AGENT` worker principal. ADMIN and VERIFIER can inspect operational state. Only ADMIN handles organization access requests. Only VERIFIER can approve claim evidence under the existing conflict and version checks. The worker cannot register, approve financing, fund, clear holds, mint, or withdraw participant funds.

Existing claim reads use the actor's union of authorized organizations and explicit lender grants. ADMIN and VERIFIER have platform review scope. A BORROWER membership in a different issuer does not authorize analysis of a claim visible through a BUYER membership.

## Operator endpoints

All responses are `Cache-Control: no-store`; every successful response below has an explicit OpenAPI schema. Lists accept `limit` 1–100 (default 20), `offset` 0–1,000,000 (default 0), and return `items`, `limit`, `offset`, `total`.

| Endpoint | Human roles | Data/action |
| --- | --- | --- |
| `GET /v1/ops/status` | ADMIN, VERIFIER | Persisted worker heartbeat, current-chain indexer checkpoint, freshness, unpublished transactional outbox counts, run/intent counts |
| `GET /v1/ops/agent-runs` | ADMIN, VERIFIER | Paginated actual runs; optional `status=QUEUED\|COMPLETED\|FAILED\|STALE` |
| `GET /v1/ops/agent-runs/:id` | ADMIN, VERIFIER | Authorized run and up to eight persisted stage summaries |
| `POST /v1/ops/agent-runs/:id/retry` | ADMIN, VERIFIER | Version-bound manual retry for a classified transient processing failure |
| `GET /v1/ops/transactions` | ADMIN, VERIFIER | Paginated status metadata; optional existing transaction status enum |
| `GET /v1/ops/organizations` | ADMIN | Canonical organizations, memberships, approved flags and public wallet addresses; optional organization status |
| `GET /v1/ops/audit` | ADMIN | Paginated audit metadata; optional uppercase `action` code |

### Health semantics

Status is based on observed database records, not a new RPC probe. Missing heartbeat/checkpoint is `UNAVAILABLE`; an observation older than 120 seconds is `STALE`; an explicit failure is `DEGRADED`. Aggregate status can only be `READY` when both observations are fresh and ready. `blockNumber` is an exact decimal string.

`queues.source=POSTGRES_OUTBOX` means the count is unpublished durable outbox messages. A published job may still be queued/running/retrying inside pg-boss; the outbox count is **not** a count of all pg-boss jobs. `transactions.pending` includes PREPARED, SUBMITTED and MINED, while unknown and reverted are separate. None of these counters proves financial settlement.

Run provider/model/latency come from persisted results; an unavailable value remains null rather than being inferred from current server configuration. Failed run and heartbeat errors expose only bounded uppercase codes; other raw errors become `REDACTED_ERROR`. Operator list responses omit prompts, documents, signatures, transaction calldata/templates, raw transaction bytes and raw audit details/reasons. Authorized per-claim evidence remains available through its existing object-scoped endpoint.

### Retry request

```http
POST /v1/ops/agent-runs/<run-id>/retry
Origin: <configured application origin>
X-CSRF-Token: <session-bound token>
Idempotency-Key: <fresh request key>
Content-Type: application/json

{"expectedVersion":3}
```

Only `PROVIDER_TIMEOUT`, `PROVIDER_RATE_LIMIT`, `PROVIDER_UNAVAILABLE`, or `PROVIDER_TRANSIENT_FAILURE` qualify. The source must be FAILED and match the claim's current version; the current claim workflow must be PROCESSING_FAILED. Refusal, invalid schema/signature, missing key, parsing/integrity failure, changed version and completed analysis are not silently retried.

The transaction locks source run then claim (matching worker lock order), marks the old run STALE/SUPERSEDED_BY_RETRY while preserving its error and audit, creates a new QUEUED run plus outbox message, sets EXTRACTING and appends an audit event before returning 202. A previously queued automatic retry sees the superseded source and exits. No review decision, consent or financial balance is created. At most three manual retries per claim version are allowed. Same idempotency key/body returns the same logical result; a changed body returns 409; concurrent distinct keys create one replacement.

Errors include 401 AUTH_REQUIRED, 403 ROLE_FORBIDDEN / CSRF_INVALID / ORIGIN_MISMATCH, 404 RUN_NOT_FOUND, 409 STALE_VERSION / RUN_NOT_RETRYABLE / RETRY_LIMIT_REACHED / IDEMPOTENCY_CONFLICT, and 422 VALIDATION_ERROR.

## Existing participant evidence additions

`GET /v1/claims/:id/evidence` now includes `consents[].nonce` for explicit onchain revocation, without disclosing full signatures, and `extractedFields: [{id, version, fields}]` containing up to 20 persisted validated extraction snapshots. Fields retain evidence ID/raw text/page/line provenance and remain private to the existing authorized claim scope. Earlier versions are labeled and do not become current evidence automatically.

Each consent also includes `onchainInvalidation: {txHash, blockNumber, blockHash} | null`, derived from the configured chain's confirmed canonical `ConsentNonceInvalidated` event for that exact signer and nonce. Null means no invalidation is observed in the current indexed history; it does not assert onchain validity. This field naturally clears when the event becomes noncanonical. `revoked` remains the separate offchain version/review invalidation flag. Chain preparation rechecks nonce availability independently.

## Wallet replacement recovery

`POST /v1/transactions/:id/replacement` accepts only `{"hash":"0x…"}` with Origin, CSRF and Idempotency-Key. It is available to the original intent owner and session wallet, within the authorized claim. It recovers a transaction already replaced by the user's wallet; the endpoint never broadcasts or re-simulates the financial action.

The original intent is locked; sender, chain, original transaction hash and nonterminal state are checked. The original nonce must already have been verified or still be verifiable from RPC. The replacement is inspected by the same chain adapter used for normal receipt attribution: exact sender, configured target, identical calldata and value, supported method, canonical receipt and expected events. Its nonce must equal the original verified nonce. The replacement must have a canonical MINED/CONFIRMED/REVERTED receipt; a pending replacement produces `REPLACEMENT_AWAITING_RECEIPT`, and an unobservable hash produces `REPLACEMENT_TRANSACTION_NOT_OBSERVED`. Both leave the original untouched. Unknown nonce produces `REPLACEMENT_NONCE_NOT_VERIFIED`. Wait and retry after mining; do not fund again.

A successful response is 202 with `{intentId, replacesIntentId, status, hash, stateConfidence:"RECEIPT_HINT_PENDING_INDEXER"}`. One successor inherits the exact original template, the original becomes REPLACED with its hash preserved, and audit plus reconciliation outbox are written atomically. Repeated hints return the same successor; concurrent hints cannot create two successors. A late observation or in-flight reconciliation cannot overwrite the REPLACED parent. Financial read models still depend on the canonical indexer; receipt metadata is not a database credit.

The old `observe` API continues to accept the same recorded hash for ordinary reconciliation. A different hash cannot overwrite it. Recovery works after funding has mined, when simulating a fresh FUND action would correctly fail the one-time funding guard.

## Bootstrap boundary

Application membership approval does not grant an onchain AccessControl role. A new lender still needs a separately authorized testnet bootstrap operator to allowlist its address on the configured vault. Existing seed CLI and deployment workflow remain the authority for that operation. No generic admin execution, agent key exposure, public mint, or automatic role-grant endpoint was added.

## Executed tests

`npx vitest run tests/roles-ops.integration.test.ts` uses disposable PostgreSQL with synthetic fixtures and performs no RPC writes. It covers anonymous/pending/all five role access, organization and membership revocation, ordinary claim isolation, cross-issuer analysis, exact block numbers, missing/stale/degraded observations, strict limits, method/CSRF/origin rejection, privacy boundaries, persisted steps, retry idempotency/races/limits/permanent failures and explicit OpenAPI response schemas.

The fixture setup initially failed with ORIGIN_CONFIG_MISMATCH and was corrected to match its own synthetic origin. The older onboarding revocation test expected a later OPERATOR_ADMIN_REQUIRED code; it now expects ROLE_FORBIDDEN from the stronger authentication filter while retaining the same 403 and no-membership assertions.

Final backend checks on 29 September 2026: `npx vitest run tests/roles-ops.integration.test.ts tests/chain-service.test.ts` passed 36/36 (16 ops/recovery and 20 chain adapter tests). `npm run test:api:isolated` passed 28/28, including a real Anvil same-nonce gas replacement recovered after mining using the new endpoint. Its first run exposed a missing intent ID argument in the modified test helper (INTENT_NOT_FOUND); the helper was corrected and all 28 rerun successfully. No public testnet financial transactions were sent by these tests.
