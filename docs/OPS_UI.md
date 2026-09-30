# Operator consoles

The MVP exposes persisted operational data through authenticated, role-scoped pages. No page grants the worker wallet a participant or operator role. The server route guard and API authorization are authoritative; the components also check approved organization membership before fetching operator data.

| Page                   | Access           | Data source                                           |
| ---------------------- | ---------------- | ----------------------------------------------------- |
| `/agent`               | ADMIN / VERIFIER | `GET /v1/ops/status`, recent `GET /v1/ops/agent-runs` |
| `/agent/runs`          | ADMIN / VERIFIER | Filtered, paginated `GET /v1/ops/agent-runs`          |
| `/agent/runs/:id`      | ADMIN / VERIFIER | `GET /v1/ops/agent-runs/:id`                          |
| `/agent/transactions`  | ADMIN / VERIFIER | `GET /v1/ops/transactions`                            |
| `/admin/organizations` | ADMIN            | `GET /v1/ops/organizations`                           |
| `/admin/audit`         | ADMIN            | `GET /v1/ops/audit`                                   |

## Reading status

- Health uses actual persisted worker heartbeat and indexer checkpoint timestamps. Missing and stale state are shown explicitly. The console does not invent network latency, block lag, uptime percentages, or progress animations.
- The outbox count describes persisted work awaiting dispatch to the worker queue. It is not presented as all pg-boss jobs or in-flight work.
- The run list and detail show recorded stages, version, provider/model when recorded, mode, explanations, reason codes, evidence references, and errors. A missing model remains “Belum tercatat”. Mock/live is shown in execution metadata; it is not repeated as a banner on every list row.
- A queued run polls its detail every five seconds while the tab is visible. Terminal states stop polling. Health refreshes every fifteen seconds while visible; lists also provide manual refresh.
- Transaction templates, submission, mined receipts, and confirmed state remain distinct. A hash links to the configured chain explorer where available. No operational page sends or replaces financial transactions.
- Claim links target the authenticated operator's ADMIN or VERIFIER workspace. Evidence references lead to that claim's authorized evidence page.

## Safe retry

Only a run returned as `retryable: true` offers “Jadwalkan ulang pemeriksaan”. The request uses `POST /v1/ops/agent-runs/:id/retry`, expected claim version, CSRF, and an Idempotency-Key retained across retries of the same request. A pending click is locked against repeated submissions.

The backend checks transient failure classification, claim/version/workflow, and retry limits again at execution. A successful 202 response is displayed as a new queued run with a link; the UI does not present it as successful extraction or human approval. The original run remains visible.

## Organizations and audit

The organization view displays canonical organization IDs, real memberships, role/approval state, and connected wallet addresses. It does not provide arbitrary wallet replacement or role elevation. Access review remains a distinct flow at `/admin/access`; canonical organization creation is explicit and reviewed there.

Audit displays actual IDs, actor, target, action, timestamps, correlation IDs, and before/after commitments. Sensitive details, private prompts, credentials, signatures, transaction calldata, and raw documents are not exposed. Database administrators can still rewrite database history; this is not a tamper-proof external audit log.

## UI verification selectors

- `#ops-run-status`: run status filter.
- `#ops-tx-status`: transaction status filter.
- `#ops-org-status`: organization status filter.
- `#ops-audit-action`: exact audit action filter; “Terapkan” submits it.
- Detail retry button: “Jadwalkan ulang pemeriksaan”. A successful request displays “Percobaan ulang tersimpan” and “Lihat proses baru”.
- All lists include actual loading, empty, failure/retry and pagination states. Long wallet/hash identifiers wrap at narrow widths; native details controls expose audit metadata with keyboard support.

Exports are in `src/features/ops/pages.ts`. Typed client DTOs are in `packages/client/ops-types.ts`; request methods are on `TalunaiClient`. Runtime and browser test evidence belongs in `docs/TEST_REPORT.md` after those checks run.
