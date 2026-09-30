# Threat model

Protected assets are participant token balances, exact signed terms, confidential evidence, organization authority and attributable audit history. Trust boundaries separate document content, provider output, session identity, human approval, restricted worker and participant signing wallets.

| Threat                                 | Boundary and control                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login replay or cross-domain signature | Issued SIWE message, address, domain, URI, chain, browser binding, expiry; atomic hashed nonce consumption; revocable opaque hashed sessions              |
| Tenant/role forgery                    | Server-provisioned canonical organizations, object membership, claim buyer/lender assignments; request body never grants a role                           |
| Prompt injection / fabricated evidence | Parsed text treated as data; strict schema, source references and deterministic policy; no tool shell, SQL or arbitrary HTTP; no model-derived recipients |
| Duplicate invoice / changed PDF        | Database unique canonical identity and immutable HMAC claim key; registry one-time registration/funding marker                                            |
| Consent substitution                   | Separate typed borrower/buyer signatures binding chain, contract, claim, version, terms hash, expiry and signer nonce                                     |
| Double funding / transfer failure      | Allowlisted lender, registry eligibility and atomic transfer/revert, permanent funded marker, reentrancy protection                                       |
| Misallocated repayments                | Registered buyer only, exact token receipts, overpayment rejection, per-deal waterfall, pull withdrawals to immutable recipients                          |
| Agent compromise                       | Narrow immutable target adapter, agent cannot clear hold, replay-protected evidence commitments; gateway independently checks attributable dispute        |
| Worker crash / duplicate jobs          | Persistent jobs, transactional outbox, per-claim database locks, idempotent transitions, raw signed transaction persisted before broadcast                |
| False chain success / reorg            | Sender/target/calldata/receipt verification, confirmed canonical events, overlap rescans, projection rollback/replay, deep reorg degraded state           |
| PDF resource exhaustion                | File signature, size/page/text limits, isolated parser process and timeout; scans need manual entry                                                       |
| Data exfiltration                      | Private generated storage names, object authorization, redacted logs, salted commitments, no onchain document contents                                    |

Known residual risks: dishonest/colluding buyer, borrower or verifier; administrator role abuse; external double financing; misleading synthetic documents; stolen participant wallet; RPC censorship/inconsistency; unallocated direct token donations; inadequate legal recovery and production incident operations. Database audit append-only behavior does not prevent a privileged database administrator rewriting history. This document and test suite are not a security audit.

## Offchain edits and outstanding consent signatures

Application edits increment the claim version, revoke stored consents, invalidate review, and block stale templates in the API and normal browser signing flow. Goods metadata and policy commitments are included in the reviewed decision hash that both parties sign. These application checks do not revoke an already issued EIP-712 signature onchain.

A trusted verifier holding a previously prepared registration transaction can bypass the API and submit the older signed terms directly while the signature deadlines and nonces remain valid. The registry has no authoritative view of draft versions in PostgreSQL. The application showing a newer draft therefore does not guarantee that the older consent can no longer be registered. This remains an explicit trusted-verifier boundary, including a race between a draft edit and an already prepared registration transaction.

For cryptographic revocation, each affected signer must submit `invalidateConsentNonce` through the `REVOKE_CONSENT` action, and verify confirmed canonical nonce invalidation before treating the signature as revoked. Expiry or prior consumption also blocks its use. Merely marking a database consent revoked, disconnecting the wallet, logging out, or editing goods metadata does not have this effect. No new contract version anchoring or automatic participant-signed revocation has been added in this MVP.
