# Guided demo Talunai

## Entry

- Landing: **Buka Aplikasi** → `/app`; **Lihat Demo** → `/demo`.
- Public route: `/demo`, no login or wallet connection.
- Canonical case: `c8ea1af0-7394-49db-9e23-0ea7a5bb8036`.
- Supplier: PT Gula Kelapa Nusantara (fictional).
- Buyer scenario: PT Unilever Indonesia Tbk. This is not an actual order or partnership.

## Audit and design decisions

The existing app has authenticated Deal detail, evidence, terms, payments and activity surfaces. Its components mix presentation with session hooks, Query, role navigation and transaction operations. Mounting the complete authenticated `ClaimDetail` under a public provider would introduce unnecessary security and network boundaries.

The demo shares the actual `Brand`, `PageHeader`, `StatusBadge`, `Button`, `DetailFacts`, `SectionTitle` and `NextActionSurface` with the product. The last three are pure presentation extracted from `claims/shared.tsx`; its existing exports and authenticated Next Action behavior are preserved. The demo uses the same global tokens, Manrope typography and financial surface styles. It renders real HTML, not product screenshots or a video.

`RouteProviders` excludes only `/` and `/demo` from wallet/session providers. `/app` and all existing role routes retain their current authorization. The demo imports no session provider, API client, transaction builder, server secrets or wallet account.

### Actual lifecycle versus seven story stages

1. **Pengajuan** — existing `DRAFT` record, invoice and delivery evidence.
2. **Konfirmasi buyer** — the archived buyer acknowledgement **document**, not a newly created signature.
3. **Pemeriksaan** — `EXTRACTING` → `READY_FOR_SIGNATURES`, using the completed live OpenRouter run.
4. **Review** — verifier approval, both exact-term consents, then registration (`REGISTERED`). These existing events are grouped into one narrative stage. The actual case signed final terms after review, not before extraction.
5. **Pendanaan** — `AVAILABLE` → confirming → `ACTIVE` / `FUNDED`. The view then changes to Supplier receiving the principal.
6. **Pembayaran** — unpaid → confirming → `FULLY_COLLECTED` / `REPAID`. Allocation does not imply withdrawal.
7. **Settlement** — claimable balances → lender withdrawal → supplier withdrawal. Only both withdrawals together produce the completed presentation state; the underlying claim workflow stays `REGISTERED`.

The agent had zero material conflicts but `goodsCategory` was not extracted. The demo retains the manual-review note; it does not claim all fields were automatically verified. The final review and configured goods category remain separate from the agent's authority.

## Source and publication

Source directory: `demo-artifacts/coconut-sugar/hero/` (local, intentionally not published wholesale).

Inputs:

- `demo-truth.json`, `case-summary.json`
- `agent-run.json`, `agent-extraction.json`
- `evidence.json` (review and consent metadata only)
- `financing-final.json`, `settlement-before-withdrawal.json`
- Five successful transaction receipts under `transactions/`
- Original `documents/invoice.pdf`, `delivery-note.pdf`, `buyer-acknowledgement.pdf`

Publication tool: `scripts/export-guided-demo.ts`. It checks completion, common case ID, live provider, review, same-version consents, receipt hashes/status/block hashes, extracted values and financial conservation. It exports an allowlist rather than serializing private state wholesale.

Published deterministic data: `src/features/demo/case-snapshot.json`. Public PDFs and rendered invoice thumbnail: `public/demo/coconut-sugar/`. The thumbnail is rendered from the archived PDF. It is not a regenerated commercial document.

`case.ts` validates the snapshot at runtime. Missing/invalid evidence returns a readable unavailable page with links to the real app and landing. Missing financial/transaction evidence is never replaced by invented defaults.

## Economics and truth

| Item | IDR equivalent / IDRT uji units |
|---|---:|
| Invoice, 4,000 kg coconut sugar | 100,000,000 |
| Funding principal | 70,000,000 |
| Flat fee, 1.5% of principal | 1,050,000 |
| Lender entitlement and final withdrawal | 71,050,000 |
| Supplier residual and final withdrawal | 28,950,000 |

Issue: 30 September 2026. Due: 14 November 2026. Contract term: 45 days. The actual testnet payment was accelerated during the demonstration; the replay states this.

**Synthetic:** supplier identity, buyer demo participant, invoice/order, commercial terms and asset value. **Actual archived execution:** live OpenRouter `openai/gpt-4.1` extraction, API review/consents, registration/funding/payment/withdrawal receipts on chain 97. Display token is **IDRT uji**; the actual contract token remains **MockIDR**, not official IDRT.

## Transaction references

- [Registration](https://testnet.bscscan.com/tx/0x70d12a0c646dcd65491e04520b0668b72b61137dce8217711ff71df15b80eec1)
- [Funding](https://testnet.bscscan.com/tx/0xb11a90ecd85257b475ff623b46bda45b5004733fafb3d90b7a39971746bcb106)
- [Buyer payment](https://testnet.bscscan.com/tx/0x4c1e274065b94407439ff9a4fc4fbce0a9483b92baf80a34a5aede84bf864f20)
- [Lender withdrawal](https://testnet.bscscan.com/tx/0xd41933e817b9eac2f8335012e9ae737b5e29d1ed768387b26c7b6cd520c340ae)
- [Supplier withdrawal](https://testnet.bscscan.com/tx/0x958a5a0ed93998de1d4212e50dcedda4c16a56e7f6f8b52d39f001a15970ce4d)

These links reference the existing completed run; public playback creates no transactions.

## Replay behavior

`replay.ts` is a bounded reducer over seven stages and their substeps. Navigation always derives financial state from a checkpoint, so revisiting an earlier stage cannot retain later balances. Confirming checkpoints do not show success or new claimable funds.

- Manual first; autoplay only on request.
- Each main stage has roughly 5–6 seconds of autoplay dwell, subdivided for checks and confirmation.
- Pause stops both automatic stage progression and within-stage replay.
- Browser hidden → pause, avoiding skipped unread stages.
- Direct stage navigation pauses autoplay. Agent checks run once within their stage.
- URL fragments preserve stage/substep on refresh, for example `/demo#pendanaan/2`.
- A refresh restores paused; an invalid fragment opens the first stage.
- Completion stops autoplay. Replay clears progress.
- Reduced motion keeps every state/action available and removes spatial animations.

## Commands

```bash
npm run dev
# Open http://127.0.0.1:3000/demo
npm run test:demo
npm run test:ui:demo
npm run build:web
```

Use `DEMO_TEST_ORIGIN=https://localhost:3000 npm run test:ui:demo` if using the existing HTTPS dev command. Regenerate the public snapshot only after a complete canonical case is available locally:

```bash
npm run demo:export-public
```

Export requires Poppler `pdftoppm` plus the installed Node dependencies. It makes no DB, LLM or blockchain request. Ordinary builds use the committed snapshot and assets, so production does not depend on local demo artifacts or Poppler.

Production regression:

```bash
DEMO_TEST_ORIGIN=https://talunai.vercel.app \
DEMO_QA_DIR=.private/demo-qa/production npm run test:ui:demo
```

QA screenshots and reports are private development artifacts under `.private/demo-qa/`. The regression checks landing entry, manual full journey, pending states, both withdrawals, refresh, previous/next, replay, direct navigation, autoplay/pause, six widths, reduced motion, document files, image loading, accessible controls, console errors and absence of app/LLM/wallet API calls during replay. The app handoff is tested after replay isolation checks.
