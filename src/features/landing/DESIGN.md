# Talunai landing: design and evidence record

Implemented 29 September 2026. This is an internal implementation record, not a new marketing route.

## Skills applied

- `design-taste-frontend` from `Leonxlnx/taste-skill`.
- `frontend-design` and `animate` from `aladicf/better-web-ui`.
- Package origins verified in `skills-lock.json`. The repository installs individual skills rather than files literally named taste-skill or better-web-ui.
- Used the existing `.better-web-ui.md` context, the user brief, and version-matched Next.js 16.3.6 documentation.

## A. Research findings

Official pages and rendered browser screenshots were inspected before implementation. Screenshots are in `.local/landing-research/`.

| Reference                                                              | What works                                                        | Applied to Talunai                                                    | Not copied                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| [Mercury](https://mercury.com/)                                        | Calm composition and space around a precise financial proposition | Restrained navigation, large headline, warm light canvas              | Scenic brand imagery, customer claims               |
| [Stripe](https://stripe.com/)                                          | Product behavior makes financial concepts concrete                | Amounts, recipients and transaction evidence close to the proposition | Gradients, breadth of products, enterprise logos    |
| [Linear](https://linear.app/)                                          | Disciplined hierarchy and attention to interaction detail         | Short labels, controlled typography, purposeful motion                | Dark visual system and dense product architecture   |
| [Ramp accounts payable](https://ramp.com/accounts-payable)             | Clear main action and understandable approval process             | Four steps, human review and exact consent boundaries                 | Savings statistics or promises                      |
| [Mekari Capital](https://mekari.com/produk/capital/invoice-financing/) | Local business language explains the working-capital need         | Plain Indonesian, invoice and payment-date vocabulary                 | Cash photography and unsupported financing promises |
| [FundThrough](https://www.fundthrough.com/)                            | Clear relationship between an invoice and earlier working capital | Explain the supplier benefit before the mechanism                     | Approval speed or funding guarantees                |

Godly and Land-book were available as gallery context. No gallery template was selected. Awwwards finance-category access was unavailable.

## B. Visual direction

Warm Precision: ivory #F7F8F2, white, ink #173B35, jade #176653, sage and restrained pistachio. Secondary text is refined to #596960 to pass AA against tinted surfaces. Official BNB assets retain their original colors.

Manrope is the UI and body face. Instrument Serif appears only in the second hero line. Large typography, asymmetrical hero, aligned financial values and clear section rhythm. Controls have 8px radii; the transaction document uses 14px. No repeating marketing-card grid.

Motion is a short entrance/settle, subtle pointer response on fine pointers and once-only section reveals. Reduced motion removes these effects. There is no WebGL, continuous spin or scroll interception that traps navigation.

The checks panel has a restrained 6.4-second repeating reading sequence: a thin trace connects the archived checks, a soft highlight and ring guide the eye through each row, then a brief line/arrow accent points to the human reviewer. All text, check results, timestamps and geometry stay fixed. It runs while the panel is visible, with an accessible pause/play control beside the record date. It stops offscreen, while reading the log with keyboard focus, and when the tab is hidden. Reduced motion is static by default; an explicit press of this panel's play button opts into this animation only. CSS runs the cycle without polling, recurring JavaScript timers, fabricated status or extra animation dependencies. Navigation underlines, proof-link arrows and the check-history chevron use 200–220ms transitions; keyboard-triggered tab content remains immediate.

## C. Information architecture

1. Proposition and custom invoice visual.
2. Actual completed testnet cycle, with supplier and lender context: the financial capability.
3. Archived document checks from that same deal and the human decision boundary: the background-work capability.
4. Four selectable roles and their next action, integrating how it works: the simplicity capability.
5. Blockchain rules with transaction evidence.
6. Final application CTA and compact footer.

## D. Hero concept

“Tagihan belum cair. Usaha tetap berjalan.”

“Invoice diakui pembeli, bukti ditinjau, pendana menyediakan modal lebih awal. Pembayaran mengikuti ketentuan yang disepakati.”

An ivory ceramic invoice rests in a jade payment rail. Labels are HTML, not baked into the image. The object is decorative; headings and content communicate the meaning independently. All core content is server rendered.

## E. Route and CTA map

| Control                       | Destination                                        |
| ----------------------------- | -------------------------------------------------- |
| Talunai logo                  | /                                                  |
| Produk                        | #produk                                            |
| Cara Kerja / Lihat Cara Kerja | #cara-kerja                                        |
| Teknologi                     | #teknologi                                         |
| Buka Aplikasi                 | /app                                               |
| Lihat data di aplikasi        | /app/explore                                       |
| Proof and allocation links    | Exact archived transactions on testnet.bscscan.com |

Anchor scrolling transfers keyboard focus to the target. Mobile navigation supports Escape and outside click. No placeholder destinations or extra marketing routes.

## F. Asset provenance

- Talunai wordmark/sprout: existing `src/components/brand.tsx`; matching favicon and Apple icon.
- [BNB official guidelines](https://www.bnbchain.org/en/brand-guidelines):
  - `public/brand/bnb-chain.svg` copied unchanged from [official black lockup](https://www.bnbchain.org/images/brand-guidelines/svg/BNB%20Chain_Logo_Black.svg).
  - `public/brand/bnb-symbol.svg` copied unchanged from [official yellow symbol](https://www.bnbchain.org/images/brand-guidelines/svg/BNB%20Chain_Symbol_Yellow.svg).
  - The page states testnet operation, never partnership or endorsement.
- [Rupiah Token](https://rupiahtoken.com/): official BSC IDRT address 0x66207e39bb77e6b99aab56795c7c340c08520d83 differs from the deployed synthetic token. Following the user's branding revision, the hero shows IDRT with the existing `public/idrt-logo.svg` asset documented in `docs/ASSET_PROVENANCE.md`. The badge links to the footer disclosure: the IDRT label in this MVP refers to MockIDR, a simulated asset without real monetary value. No official IDRT integration or endorsement is claimed.
- Hero: generated with the built-in image generation tool, transparent PNG master; optimized with Sharp to `public/landing/invoice-flow.webp` (99,246 bytes). No model-generated UI or important text.
- OpenGraph: `public/landing/talunai-og.png`, 1200 × 630, rendered with the actual fonts, art and Talunai brand. Matching metadata is in `src/app/page.tsx`.

## G. Truth audit

| Classification        | Evidence and presentation                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implemented           | Invoice submission, review, signatures, registration, funding, collection, allocations and withdrawals exist. Public exploration is available.        |
| Testnet               | BSC chain ID 97. The archived receipt contains actual transactions. The page clearly labels the environment.                                          |
| Simulated             | MockIDR has no real monetary value. The active agent mode inspected during the audit is mock/deterministic, so the checks panel says “Mode simulasi”. |
| Planned / not enabled | OpenRouter adapter exists, but a live keyed provider was not active. No claim of live LLM checks.                                                     |
| Not implemented       | Official IDRT settlement, mainnet financing, production legal/credit-risk process, and buyer-first V2 consent flow. No such claims appear.            |

The actual current ordering is submission → agent checks and verifier review → supplier and buyer consent → registration → funding → payment → withdrawals. The landing follows this order.

The preview imports the public receipt at `deployments/bsc-testnet-flow-smoke.json`. It is explicitly a completed cycle, not a funding offer:

- Accepted remaining invoice balance: Rp100.000.000 (original Rp120.000.000 less Rp20.000.000 already paid, verified against this deal's extracted fields). The primary UI explicitly labels the remaining balance. All financial details, including original invoice, prior payment, principal, fee and recipient allocations, are always visible; there is no financial accordion.
- Earlier capital: Rp70.000.000
- Financing fee: Rp1.050.000, or 1.5% of capital for this deal (not APY)
- Lender entitlement: Rp71.050.000
- Supplier residual: Rp28.950.000

No supplier/buyer company names are invented. Funding and harvest in this archive used the legacy testnet pool; the preview links those exact receipts. It does not advertise new pool deposits.

Public `/v1/explore?events=0` is fetched only when the preview approaches the viewport. It verifies the matching deal, principal, immutable due date and completed lender entitlement. A timeout, invalid response or mismatch is visible and never changes archived evidence into invented live data. The transaction date is derived from the receipt; the due date is exported from the same registered terms so it remains visible without JavaScript or network access. No public endpoint exposes keys or private documents here.

### Addendum: three capabilities, inspected before promotion

| Capability                                        | Classification                                            | Code and evidence                                                                                                 | Landing treatment                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Invoice financing and allocation                  | IMPLEMENTED, TESTNET                                      | Existing registry/vault, public exploration and the canonical transaction receipt                                 | Large financial surface, one completed deal and exact explorer links                                           |
| Background extraction, comparison, review request | IMPLEMENTED workflow; MOCK provider for this archived run | `packages/agents/process.ts`, `agent_runs` and `agent_steps`; successful run b0c12fda-77ab-48e0-b0cc-92a431ee21a6 | Sanitized archival checks, explicitly marked “Mode simulasi”; actual recorded timestamps in expandable history |
| Relevant next action for each participant         | IMPLEMENTED                                               | `src/features/claims/next-task.ts`, `NextClaimAction`, `RoleHome`, `packages/api/action-inbox.ts`                 | Controlled role preview with examples matching supported workflow states, not a current transaction control    |
| Buyer signature before the agent/reviewer         | PLANNED                                                   | Current signatures follow human review                                                                            | Not represented as implemented; role order matches current application                                         |
| Live LLM processing in the displayed run          | NOT ACTIVE                                                | Run mode is mock, not OpenRouter live                                                                             | No live-AI claim                                                                                               |

The new `deployments/bsc-testnet-landing-checks.json` is a whitelist export from the existing completed testnet run for the canonical deal, queried read-only on 29 September. It contains support statuses and recorded stage times, not uploaded documents, names, wallets, prompts or secret data. It is not a generated scenario. The `agent_steps` records were persisted together at 08:24:09.664Z; the UI honestly calls these recording times rather than inventing successive processing timestamps.

The next-action interaction is explicitly “Pratinjau tampilan peran”. It explains earlier lifecycle stages while noting that the actual referenced deal cycle is completed. It changes explanatory copy only. It never changes roles, claim state or permissions, simulates a payment, or triggers a wallet action. Its action link opens the real application. The proof tabs likewise select real archived transactions; they never manufacture an open financing offer.

There are three capabilities in existing sections, with no separate AI section, generic feature grid or category/track labels. A real buyer-confirm → agent → approval → funding interaction requires the planned state-machine change and is not faked on the public page.

## H. Build and QA

- Scoped landing CSS and components under `src/features/landing/`.
- Route-aware provider wrapper keeps wallet/session dependencies off the landing and preserves them on product routes.
- Interactivity is limited to navigation, accessible proof tabs, network read and pointer/reveal enhancement.
- Semantic landmarks, one h1, visible focus, native details, reduced motion and no-JavaScript content.
- `npm run test:ui:landing`: six viewports; desktop/mobile axe A/AA; keyboard tabs; mobile menu; API failure/retry; reduced motion; no-JavaScript fallback; actual /app handoff.
- Screenshots and automated report: `.local/landing-qa/`.
- QA and production performance measurements are recorded below.

### Verification results

- `npm run build`: web and worker build passed, including TypeScript checks. `/` is statically generated.
- Targeted ESLint passed for all landing modules, the root layout/provider boundary and the browser test.
- Browser QA at 1440, 1280, 1024, 768, 390 and 360px: no horizontal overflow or browser runtime errors; hero CTA remains in the first viewport.
- Axe WCAG A/AA checks at 1440 and 390px: no automated violations. Keyboard tabs, role preview, native details, mobile menu Escape/focus and anchor focus were exercised.
- Error/recovery: forced public API 503 retains archived financial evidence and offers retry. Reduced motion is static. No-JavaScript mode retains headline, links, financial evidence, due date and native menu.
- Marketing previews perform no mutating requests and no wallet/session/config requests. The real `/app` handoff works. `/`, `/app`, `/app/explore`, brand assets, favicon, Apple icon and OpenGraph asset returned HTTP 200.
- Lighthouse 13.5.0, local production build, mobile simulated throttling, 29 September 2026 14:27 UTC: Performance **99**, Accessibility **100**, Best Practices **100**, SEO **100**; FCP **0.9s**, LCP **2.2s**, CLS **0**, TBT **50ms**. These are a lab sample, not field uptime or performance claims. The report is `.local/landing-qa/lighthouse-mobile.report.html` (JSON alongside it).
- Screenshot files: `.local/landing-qa/page-{width}.png`, `hero-{width}.png`, `allocation-{1440,390}.png`, `checks-{1440,390}.png`, `workflow-{1440,390}.png`, and `network-unavailable.png`.

## Image generation prompt

Tool: built-in image_gen. Transparent background. The only postprocessing was format/size optimization.

Use case: stylized-concept. Asset type: custom hero illustration for Talunai, a premium Indonesian B2B invoice financing product, not a UI mockup. Create a high-end editorial 3D studio render, square composition, transparent background. Subject: an elegant upright ivory ceramic invoice sheet with subtly folded top-right corner, very subtle shallow embossed horizontal rules but ABSOLUTELY NO letters, numbers, words, logos or currency symbols. One thin second invoice sheet offset behind it. The two sheets rest inside a beautiful continuous sculptural jade green ribbon rail, shaped like a gently rising open U-shaped bridge that sweeps from lower left around the document to the right foreground, ending as three neatly layered matte ivory rectangular slips. A meaningful physical metaphor for an invoice becoming working capital. Composition: architectural, restrained, three-quarter front view, slightly elevated camera, center object fills 78% of square, generous clear margins, not a pile of random objects. Main sheet tall and narrow, near center-left; jade rail occupies right and lower half; asymmetry with a confident silhouette. Palette strictly warm ivory #F7F8F2, rich muted jade #176653, soft sage #E7EFE7, tiny pistachio edge #D6ED84. Materials: fine matte porcelain, satin jade resin with delicate edge translucency, no shiny gold, no chrome. Soft upper-left studio light, realistic ambient occlusion and soft grounded shadows. Sophisticated photoreal physical object, precise bevels, no cheap toy look, no oversized rounded corners. Transparent background with alpha. No UI panels, no screenshot, no coins, no token logos, no orb, no robot, no lettering, no watermark.

Original master: `/home/fawwaz/.codex/generated_images/01a0eb87-2a4c-73e3-87aa-7342bebe545e/exec-c8ef261b-8e52-42df-817d-40ae243c2ebe.png`.
