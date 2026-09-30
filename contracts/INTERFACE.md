# TALUNAI contract integration interface

Solidity 0.8.28; EVM paris; only chains 31337 and 97. Amounts are integer MockIDR (decimals 0). No upgrade proxies.

Deploy in order `MockIDR(admin)`, `RWARegistry(admin, verifier, token, 8000, 150, 100000000)`, `FinancingVault(admin, registry)`, `AgentExecutor(admin, agent, registry, vault)`. Bootstrap registry once with `configureEndpoints(vault, executor)` as admin; grant vault `LENDER_ROLE` to test lenders; mint test tokens through token `DEMO_MINTER_ROLE`. Never use public Anvil keys on chain 97.

`RWARegistry.Terms` ordered ABI fields: `bytes32 claimKey`, `uint256 version`, `address borrower`, `address buyer`, `address token`, `uint256 acceptedOutstanding`, `uint256 principal`, `uint256 fee`, `uint256 fundingDeadline`, `uint256 invoiceDueAt`, `uint256 reviewExpiry`, `uint256 consentExpiry`, `bytes32 evidenceCommitment`, `bytes32 decisionHash`, `bytes32 policyHash`.

`termsHash = keccak256(abi.encode(terms))` (static ordered tuple). Contract provides `hashTerms(terms)`.

EIP712 domain `{name:'TALUNAI RWARegistry', version:'1', chainId, verifyingContract: registry}`. Distinct types `BorrowerConsent` and `BuyerAcknowledgement`, both fields in order `bytes32 claimKey`, `uint256 version`, `bytes32 termsHash`, `uint256 nonce`, `uint256 deadline`. Deadline must equal terms.consentExpiry. Conventional EOA signatures only.

`Consent` tuple: `uint256 nonce`, `uint256 deadline`, `bytes signature`.

Registry methods:
- `registerApprovedClaim(Terms terms, Consent borrowerConsent, Consent buyerConsent)` verifier only.
- `getTerms(bytes32 key) -> Terms`, `getClaim(bytes32 key) -> (Terms terms, bytes32 termsHash, uint8 state, bool fundingHold)`; state 0 unknown, 1 available, 2 funded, 3 cancelled.
- `canFund(bytes32 key) -> bool`; `invalidateConsentNonce(uint256 nonce)` signer revokes own nonce; `nonceUnavailable(address,uint256)`.
- `cancelBeforeFunding(bytes32 key)` borrower, buyer, or verifier.
- `setFundingHold(bytes32 key, bytes32 evidenceCommitment)` verifier or configured executor.
- `clearFundingHold(bytes32 key, bytes32 freshReviewHash, uint256 freshReviewExpiry)` verifier only; new review is bounded by immutable original expiry.
- `markFunded(bytes32 key)` configured vault only.

Vault methods: `fundAndDisburse(bytes32 key)`, `collectBuyerPayment(bytes32 key,uint256 amount)`, `withdrawLender(bytes32 key)`, `withdrawBorrowerResidual(bytes32 key)`, `setFundingPaused(bool)` admin.
`getDeal(bytes32 key) -> (address lender,uint256 totalCollected,uint256 lenderWithdrawn,uint256 borrowerWithdrawn,bool funded)`.
`getAccounting(bytes32 key) -> (uint256 principalAllocated,uint256 feeAllocated,uint256 borrowerAllocated,uint256 lenderClaimable,uint256 borrowerClaimable,uint256 remainingLenderEntitlement,uint256 remainingInvoiceCollection,uint8 financingStatus,uint8 collectionStatus)`; financing 0 UNFUNDED, 1 ACTIVE, 2 PARTIALLY_RECOVERED, 3 REPAID; collection 0 UNPAID, 1 PARTIALLY_COLLECTED, 2 FULLY_COLLECTED. `totalLiabilities()` excludes unsolicited donations. `isFinancingOverdue` and `isInvoiceOverdue` use block time.

Executor: `proposeFundingHold(bytes32 claimKey,bytes32 actionId,bytes32 evidenceCommitment)` agent role only; deduplicated actionId. `recordRiskObservation(bytes32 claimKey,bytes32 actionId,bytes32 evidenceCommitment)` accepts funded claims without changing disbursement.

Key events:
- Registry `ClaimRegistered(bytes32 indexed claimKey,bytes32 indexed termsHash,address indexed borrower,address buyer,uint256 version)`; `ClaimFunded(bytes32 indexed claimKey)`; `ClaimCancelled(bytes32 indexed claimKey,address indexed actor)`; `FundingHoldSet(bytes32 indexed claimKey,address indexed actor,bytes32 evidenceCommitment)`; `FundingHoldCleared(bytes32 indexed claimKey,address indexed verifier,bytes32 reviewHash,uint256 reviewExpiry)`.
- Vault `Funded(bytes32 indexed claimKey,address indexed lender,address indexed borrower,uint256 principal)`; `BuyerPaymentCollected(bytes32 indexed claimKey,address indexed buyer,uint256 amount,uint256 totalCollected)`; `LenderWithdrawal(bytes32 indexed claimKey,address indexed lender,uint256 amount)`; `BorrowerWithdrawal(bytes32 indexed claimKey,address indexed borrower,uint256 amount)`.
- Executor `AgentFundingHold(bytes32 indexed claimKey,bytes32 indexed actionId,bytes32 evidenceCommitment)`; `RiskObservation(bytes32 indexed claimKey,bytes32 indexed actionId,bytes32 evidenceCommitment)`.

Root deploy script can read `contracts/out/<Contract>.sol/<Contract>.json` after forge build. TS ABI source will be generated in packages/chain/contracts.ts once compilation passes.
