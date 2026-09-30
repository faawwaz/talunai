# Role workspace browser evidence — 29 September 2026

These captures come from the actual HTTPS application at `https://localhost:3000`, using the configured BSC testnet deployment and PostgreSQL state. Browser wallets sign SIWE and explicitly authorized exact-term consents through a Node test bridge. Private keys stay outside the browser, and the bridge refuses transaction broadcasts.

## Commands and results

| Executed command | Result | Report |
| --- | --- | --- |
| `UI_ARTIFACTS_DIR=.local/role-ui node --env-file=.env.testnet --import tsx scripts/test-role-ui.ts` | 25 passed, 0 failed | [Roles and operations](report.json) |
| `UI_ARTIFACTS_DIR=.local/onboarding-roles npm run test:ui:onboarding` | 8 passed, 0 failed | [Onboarding](onboarding/report.json) |
| `UI_ARTIFACTS_DIR=.local/ui-roles npm run test:ui` | 14 passed, 0 failed | [Claims workflow](claims/report.json) |

Total: **47 browser checks passed**, with no uncaught browser exceptions and no financial transaction broadcasts to BSC. Main workflow extraction ran in explicitly configured **mock** mode; this does not establish a successful live OpenRouter inference. API traffic was real except the main suite's one explicitly injected GET-claims HTTP 503 to test recoverable error presentation.

## What was exercised

- Actual SIWE sessions for borrower, buyer, lender, verifier and admin; each opened its own workspace and sidebar destinations.
- 42 successful role/operations route visits and 16 denied direct page requests. Next.js can send HTTP 200 after flushing a loading boundary before `notFound()` resolves; denied page checks require an explicit server `NEXT_HTTP_ERROR_FALLBACK;404` marker or HTTP 404, verify absence of protected page content/serialized claim data, and separately require API authorization failures.
- Borrower/buyer/lender cannot read operator endpoints; verifier can monitor agent runs and transactions but cannot read admin organization/audit endpoints. Pending users cannot read another organization's claim.
- Legacy workspace redirects preserve the intended route, and an external `next` URL cannot redirect the session offsite.
- Operator health, outbox counts, persisted run steps, provider metadata, evidence references, transaction state, organization authority and audit records all came from the authorized backend.
- New user onboarding created a real pending request; an authenticated admin explicitly created a canonical synthetic organization and approved the exact request. The user then entered `/borrower` and opened the submission form. Rejection/resubmission and rejection of the configured agent wallet as a participant also passed.
- Cocoa and packaging claims were actually created, uploaded and analyzed by the persistent worker. Human review and borrower/buyer EIP-712 consent persisted, while rejected signatures remained retryable. Logout revoked the session.

## Accessibility and responsive checks

- Role/operator suite: 10 axe scans, **0 violations and 0 incomplete checks**.
- Onboarding suite: 4 axe scans, **0 violations and 0 incomplete checks**.
- Claims suite: 3 axe scans, **0 violations**. One incomplete color-contrast check concerns the decorative `aria-hidden` arrow between issuer and buyer; it is not evidence that every visual element has been fully audited.
- Mobile captures use a 390 × 844 viewport. The suite checks document width, all five claim detail tabs and mobile drawer focus recovery. Desktop captures use 1440 × 1000.

The first regression attempts found a 4.49:1 token-badge contrast pair and absolute screen-reader labels escaping a horizontal claim workflow scroller. These were corrected before the final passing runs. The audit disclosure was also de-duplicated and responsive capture waits for stable viewport geometry.

## Selected captures

- [Borrower workspace](borrower-desktop.png), [buyer workspace](buyer-desktop.png), [lender workspace](lender-desktop.png), [verifier workspace](verifier-desktop.png), [admin workspace](admin-desktop.png).
- [Agent overview](agent-overview-desktop.png), [agent detail](agent-run-detail-desktop.png), [agent mobile](agent-overview-mobile.png).
- [Organization authority](admin-organizations-desktop.png), [audit detail](admin-audit-desktop.png), [audit mobile](admin-audit-mobile.png).
- [Admin access review](onboarding/admin-review.png), [new-user mobile](onboarding/access-mobile.png).
- [Claim detail](claims/claim-detail-desktop.png), [persisted consents](claims/consents-complete-desktop.png), [claim activity mobile](claims/claim-activity-mobile.png).

Screenshots contain synthetic names, public test wallet addresses and test claim identifiers. Reports do not contain cookies, full signatures, private keys or raw private document text. These are actual runtime captures, not visual regression baselines. Synthetic fixtures and their audit history are retained; no financial projection was edited directly to make a test pass.
