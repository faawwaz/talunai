/** Checked-in OpenAPI 3.1 source. Runtime schemas reject unknown fields. */
import { opsSchemas, opsResponses } from "./ops-openapi";
const text = { type: "string" },
  version = { type: "integer", minimum: 1 },
  amount = {
    type: "string",
    pattern: "^(0|[1-9][0-9]{0,77})$",
    example: "70000000",
  },
  uuid = { type: "string", format: "uuid" },
  address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
  nonce = amount;
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const errors = Object.fromEntries(
  [401, 403, 404, 409, 413, 422, 429, 503].map((code) => [
    String(code),
    {
      description: (
        {
          401: "Authentication required, expired session or invalid SIWE",
          403: "Role, object, origin or CSRF denied",
          404: "Not found or inaccessible object",
          409: "Stale version, idempotency conflict or chain state conflict",
          413: "Upload/body size limit",
          422: "Invalid body, evidence, signature or policy bounds",
          429: "Rate limited",
          503: "Chain/provider/database unavailable or degraded indexer",
        } as Record<number, string>
      )[code],
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Error" },
          example: {
            error: {
              code:
                code === 409
                  ? "IDEMPOTENCY_CONFLICT"
                  : code === 403
                    ? "CSRF_INVALID"
                    : "REQUEST_REJECTED",
            },
            correlationId: "3f9d9c88-332b-4f46-bd65-29c00c521a44",
          },
        },
      },
    },
  ]),
);
const goodsSchema = object({
  category: { type: "string", enum: ["COCOA", "PACKAGING", "OTHER"] },
  description: { type: "string", minLength: 1, maxLength: 500 },
  lineItems: {
    type: "array",
    minItems: 1,
    maxItems: 30,
    items: object({
      description: { type: "string", minLength: 1, maxLength: 500 },
      quantity: {
        type: "string",
        pattern: "^(0|[1-9][0-9]{0,29})(\\.[0-9]{1,6})?$",
        description: "Positive exact decimal quantity; zero is rejected.",
      },
      unit: { type: "string", minLength: 1, maxLength: 32 },
    }),
  },
});
const schemas: Record<string, unknown> = {
  ...opsSchemas,
  ReplacementHint: object({
    hash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
  }),
  ReplacementObservation: object({
    intentId: uuid,
    replacesIntentId: uuid,
    status: {
      type: "string",
      enum: [
        "SUBMITTED",
        "MINED",
        "CONFIRMED",
        "REVERTED",
        "DROPPED_OR_UNKNOWN",
      ],
    },
    hash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
    stateConfidence: { const: "RECEIPT_HINT_PENDING_INDEXER" },
  }),
  AccessRequestInput: object(
    {
      organizationName: { type: "string", minLength: 3, maxLength: 160 },
      requestedRole: { type: "string", enum: ["BORROWER", "BUYER", "LENDER"] },
      note: { type: "string", maxLength: 1000 },
    },
    ["organizationName", "requestedRole"],
  ),
  AccessRequest: object({
    id: uuid,
    organizationName: text,
    requestedRole: { type: "string", enum: ["BORROWER", "BUYER", "LENDER"] },
    note: { type: ["string", "null"] },
    status: { type: "string", enum: ["PENDING", "APPROVED", "REJECTED"] },
    version,
    organizationId: { type: ["string", "null"] },
    reviewReason: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    reviewedAt: { type: ["string", "null"], format: "date-time" },
    isSynthetic: { const: true },
  }),
  AccessRequestEnvelope: object({
    request: {
      anyOf: [{ $ref: "#/components/schemas/AccessRequest" }, { type: "null" }],
    },
    restrictedWallet: { type: "boolean" },
  }),
  AccessRequestReview: object(
    {
      expectedVersion: version,
      decision: { type: "string", enum: ["APPROVE", "REJECT"] },
      organizationId: {
        type: "string",
        description:
          "Required for approval: reviewed canonical approved synthetic organization matching the requested role and with no existing authority.",
      },
      reason: { type: "string", minLength: 10, maxLength: 1000 },
    },
    ["expectedVersion", "decision", "reason"],
  ),
  CreateSyntheticOrganization: object({
    name: { type: "string", minLength: 3, maxLength: 160 },
    kind: { type: "string", enum: ["BORROWER", "BUYER", "LENDER"] },
    identityKey: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{2,99}$" },
    reason: { type: "string", minLength: 10, maxLength: 1000 },
  }),
  GoodsMetadata: goodsSchema,
  OrganizationOption: object({
    id: text,
    name: text,
    kind: { type: "string", enum: ["BUYER", "LENDER"] },
    isSynthetic: { type: "boolean" },
    authorityStatus: { const: "APPROVED" },
  }),
  DocumentMetadata: object({
    id: uuid,
    version,
    name: text,
    mediaType: text,
    sizeBytes: { type: "integer", minimum: 0 },
    status: text,
    createdAt: { type: "string", format: "date-time" },
    retentionAt: { type: "string", format: "date-time" },
    downloadUrl: text,
  }),
  Membership: object({
    organizationId: text,
    organizationName: text,
    organizationKind: text,
    organizationStatus: text,
    isSynthetic: { type: "boolean" },
    role: {
      type: "string",
      enum: ["BORROWER", "BUYER", "LENDER", "VERIFIER", "ADMIN"],
    },
  }),
  CurrentUser: object({
    userId: text,
    wallet: address,
    status: text,
    memberships: {
      type: "array",
      items: { $ref: "#/components/schemas/Membership" },
    },
  }),

  Error: object({
    error: object({ code: text, details: {} }, ["code"]),
    correlationId: uuid,
  }),
  Challenge: object(
    {
      address,
      chainId: { type: "integer", enum: [97, 31337] },
      accountType: { type: "string", enum: ["EOA"] },
    },
    ["address", "chainId"],
  ),
  Verify: object({
    challengeId: uuid,
    message: { type: "string", maxLength: 4096 },
    signature: { type: "string", pattern: "^0x[0-9a-fA-F]{130}$" },
  }),
  CreateClaim: object(
    {
      assetType: {
        type: "string",
        const: "TRADE_RECEIVABLE",
        default: "TRADE_RECEIVABLE",
      },
      goods: {
        $ref: "#/components/schemas/GoodsMetadata",
        description:
          "Absent goods are unclassified and require review; no implicit cocoa default.",
      },
      organizationId: text,
      buyerOrganizationId: text,
      lenderOrganizationId: text,
      invoiceNamespace: text,
      invoiceNumber: text,
      acceptedOutstanding: amount,
      requestedPrincipal: amount,
      invoiceDueAt: { type: "integer" },
      fundingWindowSeconds: { type: "integer", minimum: 60, maximum: 86400 },
    },
    [
      "organizationId",
      "buyerOrganizationId",
      "invoiceNamespace",
      "invoiceNumber",
      "acceptedOutstanding",
      "requestedPrincipal",
      "invoiceDueAt",
    ],
  ),
  PatchClaim: object(
    {
      expectedVersion: version,
      goods: { $ref: "#/components/schemas/GoodsMetadata" },
      acceptedOutstanding: amount,
      requestedPrincipal: amount,
      invoiceDueAt: { type: "integer" },
    },
    ["expectedVersion"],
  ),
  Version: object({ expectedVersion: version }),
  ConsentPrepare: object({
    expectedVersion: version,
    role: { type: "string", enum: ["BORROWER", "BUYER"] },
    nonce,
  }),
  Consent: object({
    expectedVersion: version,
    role: { type: "string", enum: ["BORROWER", "BUYER"] },
    nonce,
    signature: { type: "string", pattern: "^0x[0-9a-fA-F]{130}$" },
  }),
  Review: object(
    {
      expectedVersion: version,
      decision: { type: "string", enum: ["APPROVE", "REJECT"] },
      reason: { type: "string", minLength: 5, maxLength: 2000 },
      evidenceIds: { type: "array", items: uuid, minItems: 1 },
      attestations: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "buyerAcknowledgementStatus",
            "deliveryEvidenceStatus",
            "extractionStatus",
          ],
        },
      },
      resolvesDispute: { type: "boolean" },
    },
    ["expectedVersion", "decision", "reason", "evidenceIds"],
  ),
  Dispute: object({
    expectedVersion: version,
    reason: { type: "string", minLength: 5, maxLength: 2000 },
    evidenceId: uuid,
  }),
  Action: object(
    {
      expectedVersion: version,
      action: {
        type: "string",
        enum: [
          "REGISTER",
          "CANCEL",
          "APPROVE_TOKEN",
          "FUND",
          "COLLECT_BUYER_PAYMENT",
          "WITHDRAW_LENDER",
          "WITHDRAW_BORROWER",
          "CLEAR_HOLD",
          "REVOKE_CONSENT",
        ],
      },
      amount,
      nonce,
    },
    ["expectedVersion", "action"],
  ),
  Observe: object(
    {
      intentId: uuid,
      hash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
      replacesIntentId: uuid,
    },
    ["intentId", "hash"],
  ),
  FinancialRead: object(
    {
      claimId: uuid,
      isSynthetic: { type: "boolean", const: true },
      acceptedOutstanding: amount,
      principal: amount,
      fixedFee: amount,
      totalCollected: amount,
      lenderAllocated: amount,
      lenderWithdrawn: amount,
      lenderClaimable: amount,
      borrowerResidualClaimable: amount,
      remainingInvoiceCollection: amount,
      financingStatus: {
        type: "string",
        enum: ["UNFUNDED", "ACTIVE", "PARTIALLY_RECOVERED", "REPAID"],
      },
      collectionStatus: {
        type: "string",
        enum: ["UNPAID", "PARTIALLY_COLLECTED", "FULLY_COLLECTED"],
      },
      stateConfidence: {
        type: "string",
        enum: [
          "CONFIRMED_PROJECTION",
          "NO_CONFIRMED_PROJECTION",
          "DEGRADED_LAST_CONFIRMED_PROJECTION",
        ],
      },
    },
    [
      "claimId",
      "isSynthetic",
      "stateConfidence",
      "financingStatus",
      "collectionStatus",
    ],
  ),
};
(
  schemas.FinancialRead as { additionalProperties: boolean }
).additionalProperties = true;
const sampleId = "11111111-1111-4111-8111-111111111111";
const responseExamples: Record<string, unknown> = {
  "/v1/access-request": { request: null, restrictedWallet: false },
  "/v1/access-requests": { items: [], limit: 20, offset: 0, total: 0 },
  "/v1/access-organizations": { items: [], limit: 20, offset: 0, total: 0 },
  "/health/live": { status: "alive" },
  "/health/ready": { status: "ready" },
  "/v1/config": {
    chainId: 31337,
    appEnv: "local",
    appOrigin: "http://localhost:3000",
    isSynthetic: true,
    llmMode: "mock",
    paymentToken: { symbol: "MockIDR", decimals: 0 },
    accountTypes: ["EOA"],
    disclosures: ["SYNTHETIC_NO_VALUE", "NOT_LEGAL_RWA_TITLE"],
  },
  "/v1/auth/challenge": {
    challengeId: sampleId,
    message: "<exact server-issued SIWE message>",
    expiresAt: "2026-09-28T15:05:00.000Z",
    accountType: "EOA",
  },
  "/v1/auth/verify": {
    userId: "user-borrower",
    csrfToken: "<opaque response token; keep in memory>",
    expiresIn: 28800,
    accountType: "EOA",
  },
  "/v1/auth/logout": { loggedOut: true },
  "/v1/me": {
    userId: "user-borrower",
    status: "PROVISIONED_SYNTHETIC",
    memberships: [{ organizationId: "org-borrower", role: "BORROWER" }],
  },
  "/v1/claims": {
    id: sampleId,
    version: 1,
    workflow: "DRAFT",
    isSynthetic: true,
    organizationId: "org-borrower",
    buyerOrganizationId: "org-buyer",
  },
  "/v1/claims/{id}": {
    id: sampleId,
    version: 2,
    workflow: "NEEDS_REVIEW",
    isSynthetic: true,
    fundingHold: false,
    hasDispute: false,
  },
  "/v1/claims/{id}/documents": {
    documentId: sampleId,
    version: 2,
    status: "PENDING_PARSE",
    pages: null,
  },
  "/v1/claims/{id}/analyze": {
    runId: sampleId,
    status: "QUEUED",
    mode: "mock",
  },
  "/v1/agent-runs/{id}": {
    id: sampleId,
    status: "COMPLETED",
    stage: "COMPLETED",
    mode: "mock",
    result: {
      outcome: "NEEDS_REVIEW",
      reasonCodes: ["BUYER_ACKNOWLEDGEMENT_REQUIRED"],
    },
    steps: [],
  },
  "/v1/claims/{id}/evidence": {
    claimId: sampleId,
    version: 2,
    evidence: {
      buyerAcknowledgementStatus: "MISSING",
      deliveryEvidenceStatus: "SUPPORTED_BY_DOCUMENT",
      externalEncumbranceCheckStatus: "NOT_INTEGRATED",
    },
    documents: [{ id: sampleId, status: "PARSED" }],
    attestations: [],
  },
  "/v1/claims/{id}/offer": {
    claimId: sampleId,
    version: 3,
    acceptedOutstanding: "100000000",
    principal: "70000000",
    fixedFee: "1050000",
    advanceCap: "80000000",
    lenderEntitlement: "71050000",
    feeKind: "FLAT_SYNTHETIC_NOT_APR",
    isSynthetic: true,
    eligibleIsNotApproval: true,
  },
  "/v1/claims/{id}/consents/prepare": {
    claimId: sampleId,
    version: 3,
    role: "BORROWER",
    typedData: {
      primaryType: "BorrowerConsent",
      domain: { name: "TALUNAI RWARegistry", version: "1", chainId: 31337 },
      message: { nonce: "123456" },
    },
  },
  "/v1/claims/{id}/consents": {
    claimId: sampleId,
    version: 3,
    workflow: "READY_FOR_REGISTRATION",
    consentRole: "BUYER",
  },
  "/v1/claims/{id}/review": {
    id: sampleId,
    version: 3,
    workflow: "READY_FOR_SIGNATURES",
    isSynthetic: true,
  },
  "/v1/claims/{id}/disputes": {
    actionId: sampleId,
    hasDispute: true,
    onchainHold: "PENDING",
  },
  "/v1/claims/{id}/actions/prepare": {
    intentId: sampleId,
    status: "PREPARED",
    transaction: { chainId: 31337, value: "0", action: "FUND" },
    warning: "USER_MUST_SIGN; SIMULATION_IS_NOT_CONFIRMATION",
  },
  "/v1/transactions/observe": {
    intentId: sampleId,
    status: "MINED",
    stateConfidence: "RECEIPT_HINT_PENDING_INDEXER",
  },
  "/v1/claims/{id}/financing": {
    claimId: sampleId,
    isSynthetic: true,
    acceptedOutstanding: "100000000",
    principal: "70000000",
    fixedFee: "1050000",
    totalCollected: "71050000",
    lenderAllocated: "71050000",
    lenderWithdrawn: "50000000",
    lenderClaimable: "21050000",
    borrowerResidualClaimable: "0",
    remainingInvoiceCollection: "28950000",
    financingStatus: "REPAID",
    collectionStatus: "PARTIALLY_COLLECTED",
    stateConfidence: "CONFIRMED_PROJECTION",
  },
  "/v1/claims/{id}/audit": {
    items: [],
    limit: 20,
    offset: 0,
    integrityDisclosure:
      "Application append-only; database administrator can rewrite history.",
  },
  "/v1/review-tasks": { items: [], limit: 20, offset: 0 },
};
for (const route of [
  "/v1/organizations",
  "/v1/agent-runs",
  "/v1/claims/{id}/agent-runs",
  "/v1/claims/{id}/transactions",
])
  responseExamples[route] = { items: [], limit: 20, offset: 0 };
const bodyExamples: Record<string, unknown> = {
  AccessRequestInput: {
    organizationName: "Pemasok Kemasan Sintetis",
    requestedRole: "BORROWER",
    note: "Permintaan akses simulasi dari wallet peserta.",
  },
  AccessRequestReview: {
    expectedVersion: 1,
    decision: "APPROVE",
    organizationId: "org-reviewed-canonical-id",
    reason: "Wallet peserta dan identitas sintetis ditinjau operator.",
  },
  CreateSyntheticOrganization: {
    name: "Pemasok Kemasan Sintetis",
    kind: "BORROWER",
    identityKey: "demo-packaging-supplier-001",
    reason:
      "Identitas sintetis berbeda telah ditinjau; bukan alias issuer lama.",
  },
  CreateClaim: {
    assetType: "TRADE_RECEIVABLE",
    goods: {
      category: "COCOA",
      description: "Delivered cocoa goods, synthetic sample",
      lineItems: [{ description: "Cocoa beans", quantity: "1000", unit: "kg" }],
    },
    organizationId: "org-borrower",
    buyerOrganizationId: "org-buyer",
    lenderOrganizationId: "org-lender",
    invoiceNamespace: "2026",
    invoiceNumber: "DEMO-KAKAO-001",
    acceptedOutstanding: "100000000",
    requestedPrincipal: "70000000",
    invoiceDueAt: 1794528000,
    fundingWindowSeconds: 82800,
  },
  PatchClaim: { expectedVersion: 1, requestedPrincipal: "65000000" },
  Version: { expectedVersion: 2 },
  ConsentPrepare: { expectedVersion: 3, role: "BORROWER", nonce: "123456" },
  Review: {
    expectedVersion: 2,
    decision: "APPROVE",
    reason: "Bukti sintetis ditinjau oleh verifier.",
    evidenceIds: [sampleId],
    attestations: ["deliveryEvidenceStatus", "buyerAcknowledgementStatus"],
  },
  Dispute: {
    expectedVersion: 3,
    reason: "Buyer melaporkan konflik bukti invoice.",
    evidenceId: sampleId,
  },
  Action: {
    expectedVersion: 3,
    action: "COLLECT_BUYER_PAYMENT",
    amount: "50000000",
  },
};
type Definition = [
  method: string,
  path: string,
  summary: string,
  body?: string,
  status?: number,
  publicRoute?: boolean,
];
const definitions: Definition[] = [
  [
    "post",
    "/v1/transactions/{id}/replacement",
    "Recover an already-mined wallet replacement using the original trusted template and verified same nonce; never resends or creates a new financial action",
    "ReplacementHint",
    202,
  ],
  [
    "get",
    "/v1/ops/status",
    "ADMIN/VERIFIER: actual persisted heartbeat, checkpoint freshness and durable outbox counts; no fabricated RPC health",
  ],
  [
    "get",
    "/v1/ops/agent-runs",
    "ADMIN/VERIFIER: paginated persisted runs with optional status filter; no prompts or document text",
  ],
  [
    "get",
    "/v1/ops/agent-runs/{id}",
    "ADMIN/VERIFIER: object-authorized run and up to eight sanitized persisted steps",
  ],
  [
    "post",
    "/v1/ops/agent-runs/{id}/retry",
    "ADMIN/VERIFIER: atomically enqueue current-version transient failed analysis; three manual retries maximum, no human approval",
    "Version",
    202,
  ],
  [
    "get",
    "/v1/ops/transactions",
    "ADMIN/VERIFIER: transaction status metadata without calldata, signatures or private templates",
  ],
  [
    "get",
    "/v1/ops/organizations",
    "ADMIN only: canonical organizations and membership/wallet authority; application approval is not an onchain role",
  ],
  [
    "get",
    "/v1/ops/audit",
    "ADMIN only: paginated attributable audit metadata without document text, reason or raw details",
  ],
  [
    "get",
    "/v1/access-request",
    "Read own latest access request and actual restricted service-wallet gate",
  ],
  [
    "post",
    "/v1/access-request",
    "Persist a pending demo access request; grants no membership or company verification",
    "AccessRequestInput",
    201,
  ],
  [
    "get",
    "/v1/access-requests",
    "ADMIN only: paginated pending/reviewed access requests including requesting wallet",
  ],
  [
    "get",
    "/v1/access-organizations",
    "ADMIN only: approved synthetic canonical organizations with occupied-authority indicator",
  ],
  [
    "post",
    "/v1/access-requests/{id}/review",
    "ADMIN only: version-bound review for one exact canonical organization; does not grant chain roles",
    "AccessRequestReview",
  ],
  [
    "post",
    "/v1/organizations/demo",
    "ADMIN only: explicitly provision reviewed synthetic canonical identity; not KYB, no implicit duplicate-issuer creation",
    "CreateSyntheticOrganization",
    201,
  ],
  ["get", "/health/live", "Liveness only", undefined, 200, true],
  [
    "get",
    "/health/ready",
    "Database, deployment and confirmed indexer readiness",
    undefined,
    200,
    true,
  ],
  [
    "get",
    "/v1/config",
    "Public actual chain configuration and synthetic disclosures",
    undefined,
    200,
    true,
  ],
  ["get", "/v1/openapi", "OpenAPI 3.1 document", undefined, 200, true],
  [
    "get",
    "/v1/explore",
    "Public BSC Testnet pool balances, onchain financed-deal portfolio, controls, events by default, and optional wallet position; events=0 omits the activity feed for faster live core data",
    undefined,
    200,
    true,
  ],
  [
    "get",
    "/v1/explore/events",
    "Public onchain pool activity from the latest 5,000 blocks plus receipt-verified deployment and testnet flow transactions; eventHistoryComplete flags an incomplete lifetime history and RPC failures return an error",
    undefined,
    200,
    true,
  ],
  [
    "get",
    "/v1/explore/candidate",
    "Public onchain invoice allocation eligibility, principal, fee and indicative gross annualized rate for one claim key",
    undefined,
    200,
    true,
  ],
  [
    "post",
    "/v1/auth/challenge",
    "Issue five-minute SIWE challenge bound to browser cookie",
    "Challenge",
    200,
    true,
  ],
  [
    "post",
    "/v1/auth/verify",
    "Consume challenge atomically; return opaque HttpOnly cookie and CSRF token",
    "Verify",
    200,
    true,
  ],
  ["post", "/v1/auth/logout", "Revoke current session", undefined, 200],
  [
    "get",
    "/v1/me",
    "Actual persisted user status and named server-controlled memberships",
  ],
  [
    "get",
    "/v1/organizations",
    "Approved buyer/lender directory scoped to the borrower's issuer organization",
  ],
  ["get", "/v1/agent-runs", "Paginated actor-authorized agent activity"],
  [
    "get",
    "/v1/claims/{id}/agent-runs",
    "Paginated authorized agent runs for this claim",
  ],
  [
    "get",
    "/v1/claims/{id}/transactions",
    "Paginated current-user-owned transaction intents for an authorized claim",
  ],
  [
    "post",
    "/v1/claims",
    "Create authorized borrower draft; canonical duplicate check",
    "CreateClaim",
    201,
  ],
  ["get", "/v1/claims", "Paginated actor-filtered claim list"],
  [
    "get",
    "/v1/claims/{id}",
    "Authorized immutable terms, workflow and evidence",
  ],
  [
    "patch",
    "/v1/claims/{id}",
    "Versioned edit; revoke prior consents/reviews",
    "PatchClaim",
  ],
  [
    "post",
    "/v1/claims/{id}/documents",
    "Upload private UTF-8 text, synthetic JSON or bounded text PDF",
    "Upload",
    201,
  ],
  ["get", "/v1/documents/{id}", "Authorized private document download"],
  [
    "post",
    "/v1/claims/{id}/analyze",
    "Persist run and transactional outbox before 202",
    "Version",
    202,
  ],
  [
    "get",
    "/v1/agent-runs/{id}",
    "Authorized provider-labelled run and validated stage results",
  ],
  [
    "get",
    "/v1/claims/{id}/evidence",
    "Evidence status, source metadata, attributable attestations and policy",
  ],
  [
    "get",
    "/v1/claims/{id}/offer",
    "Exact amounts, synthetic flat fee and actual deadlines",
  ],
  [
    "post",
    "/v1/claims/{id}/consents/prepare",
    "Prepare role-specific EIP-712 typed data after current unexpired human approval",
    "ConsentPrepare",
  ],
  [
    "post",
    "/v1/claims/{id}/consents",
    "Verify and persist consent for exact reviewed terms/version",
    "Consent",
  ],
  [
    "post",
    "/v1/claims/{id}/review",
    "Verifier review with source references; does not assert onchain success",
    "Review",
  ],
  [
    "post",
    "/v1/claims/{id}/disputes",
    "Attributable dispute and transactional bounded hold job",
    "Dispute",
    202,
  ],
  [
    "post",
    "/v1/claims/{id}/actions/prepare",
    "Allowlisted user-signed transaction template after simulation",
    "Action",
  ],
  [
    "post",
    "/v1/transactions/observe",
    "Attribute transaction hint and reconcile canonical receipt",
    "Observe",
    202,
  ],
  [
    "get",
    "/v1/claims/{id}/financing",
    "Confirmed canonical financial read model",
  ],
  ["get", "/v1/claims/{id}/audit", "Paginated authorized audit trail"],
  ["get", "/v1/review-tasks", "Paginated actor-owned pending tasks"],
];
const paths: Record<string, Record<string, unknown>> = {};
for (const [
  method,
  path,
  summary,
  body,
  status = 200,
  isPublic = false,
] of definitions) {
  const parameters: unknown[] = [];
  if (path === "/v1/explore") {
    parameters.push({
      in: "query",
      name: "wallet",
      required: false,
      schema: address,
      description:
        "Public wallet address for onchain share balance and investor allowlist status",
    });
    parameters.push({
      in: "query",
      name: "events",
      required: false,
      schema: { type: "string", enum: ["0"] },
      description:
        "Set to 0 to omit event fields. Fetch /v1/explore/events separately for activity.",
    });
  }
  if (path === "/v1/explore/candidate")
    parameters.push({
      in: "query",
      name: "key",
      required: true,
      schema: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
      description: "Registered onchain claim key",
    });
  if (path.includes("{id}"))
    parameters.push({ in: "path", name: "id", required: true, schema: uuid });
  if (
    ([
      "/v1/claims",
      "/v1/review-tasks",
      "/v1/organizations",
      "/v1/agent-runs",
      "/v1/access-requests",
      "/v1/access-organizations",
      "/v1/ops/organizations",
    ].includes(path) &&
      method === "get") ||
    path.endsWith("/audit") ||
    path.endsWith("/transactions") ||
    path.endsWith("/agent-runs")
  )
    parameters.push(
      {
        in: "query",
        name: "limit",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      {
        in: "query",
        name: "offset",
        schema: { type: "integer", minimum: 0, default: 0 },
      },
    );
  if (path === "/v1/organizations")
    parameters.push(
      {
        in: "query",
        name: "issuerOrganizationId",
        schema: text,
        description:
          "An approved BORROWER membership owned by this actor. Required when several issuer organizations exist.",
      },
      {
        in: "query",
        name: "role",
        schema: { type: "string", enum: ["BUYER", "LENDER"] },
      },
    );
  if (
    path === "/v1/ops/agent-runs" ||
    path === "/v1/ops/transactions" ||
    path === "/v1/ops/organizations"
  )
    parameters.push({
      in: "query",
      name: "status",
      schema: {
        type: "string",
        enum: path.endsWith("agent-runs")
          ? ["QUEUED", "COMPLETED", "FAILED", "STALE"]
          : path.endsWith("transactions")
            ? [
                "PREPARED",
                "SUBMITTED",
                "MINED",
                "CONFIRMED",
                "REVERTED",
                "REPLACED",
                "DROPPED_OR_UNKNOWN",
              ]
            : ["APPROVED", "PENDING", "REJECTED", "REVOKED"],
      },
    });
  if (path === "/v1/ops/audit")
    parameters.push({
      in: "query",
      name: "action",
      schema: { type: "string", pattern: "^[A-Z][A-Z0-9_]{0,99}$" },
    });
  if (path === "/v1/access-requests")
    parameters.push({
      in: "query",
      name: "status",
      schema: { type: "string", enum: ["PENDING", "APPROVED", "REJECTED"] },
    });
  if (path === "/v1/access-organizations")
    parameters.push({
      in: "query",
      name: "role",
      schema: { type: "string", enum: ["BORROWER", "BUYER", "LENDER"] },
    });
  if (path === "/v1/claims" && method === "get")
    parameters.push(
      {
        in: "query",
        name: "search",
        schema: { type: "string", maxLength: 120 },
        description:
          "Case-insensitive literal invoice-number substring, applied inside authorization scope.",
      },
      {
        in: "query",
        name: "workflow",
        schema: {
          type: "string",
          enum: [
            "DRAFT",
            "EXTRACTING",
            "NEEDS_REVIEW",
            "READY_FOR_SIGNATURES",
            "READY_FOR_REGISTRATION",
            "REGISTRATION_PENDING",
            "REGISTERED",
            "CANCELLED",
            "REJECTED",
            "PROCESSING_FAILED",
          ],
        },
      },
    );
  if (method !== "get") {
    parameters.push({
      in: "header",
      name: "Origin",
      required: true,
      schema: { type: "string", example: "http://localhost:3000" },
    });
    if (!isPublic) {
      parameters.push({
        in: "header",
        name: "X-CSRF-Token",
        required: true,
        schema: text,
      });
      if (!path.endsWith("/logout"))
        parameters.push({
          in: "header",
          name: "Idempotency-Key",
          required: true,
          schema: { type: "string", maxLength: 128 },
        });
    }
  }
  const requestBody = body
    ? {
        required: true,
        content:
          body === "Upload"
            ? {
                "multipart/form-data": {
                  schema: object({
                    file: { type: "string", format: "binary" },
                    expectedVersion: version,
                  }),
                },
              }
            : {
                "application/json": {
                  schema: { $ref: `#/components/schemas/${body}` },
                  ...(bodyExamples[body]
                    ? { example: bodyExamples[body] }
                    : {}),
                },
              },
      }
    : undefined;
  const responseSchema =
    path === "/v1/transactions/{id}/replacement"
      ? { $ref: "#/components/schemas/ReplacementObservation" }
      : opsResponses[path]
        ? { $ref: `#/components/schemas/${opsResponses[path]}` }
        : path.endsWith("/financing")
          ? { $ref: "#/components/schemas/FinancialRead" }
          : path === "/v1/access-request"
            ? { $ref: "#/components/schemas/AccessRequestEnvelope" }
            : path === "/v1/me"
              ? { $ref: "#/components/schemas/CurrentUser" }
              : { type: "object", additionalProperties: true };
  (paths[path] ??= {})[method] = {
    summary,
    description:
      "Response examples are illustrative synthetic samples, not deployment evidence. Fetch complete actual signing and transaction payloads from this server.",
    operationId: `${method}_${path.replace(/[{}]/g, "").replace(/\W+/g, "_")}`,
    security: isPublic ? [] : [{ sessionCookie: [] }],
    parameters,
    ...(requestBody ? { requestBody } : {}),
    responses: {
      [String(status)]: {
        description:
          status === 202
            ? "Persisted pending work; financial success requires canonical confirmed events"
            : "Successful logical result",
        content: path.startsWith("/v1/documents/")
          ? {
              "application/octet-stream": {
                schema: { type: "string", format: "binary" },
              },
            }
          : {
              "application/json": {
                schema: responseSchema,
                ...(responseExamples[path]
                  ? {
                      example:
                        path === "/v1/claims" && method === "get"
                          ? { items: [], limit: 20, offset: 0 }
                          : responseExamples[path],
                    }
                  : {}),
              },
            },
      },
      ...errors,
    },
  };
}
export const openApi = {
  openapi: "3.1.0",
  info: {
    title: "TALUNAI synthetic financing backend",
    version: "0.1.0",
    description:
      "EOA SIWE opaque HttpOnly-cookie sessions. Login also sets a same-origin-readable Secure-on-HTTPS SameSite=Strict talunai_csrf cookie, restored on browser reload and cleared on logout. The server validates its header value against the hash bound to the opaque session; the CSRF cookie itself is not authentication. Origin is browser-controlled. All financial JSON integers are decimal strings. Synthetic demo only; no legal title, real payments or production underwriting. Mutations use Origin, X-CSRF-Token and Idempotency-Key unless auth endpoints. No mainnet.",
  },
  servers: [{ url: "http://localhost:3000", description: "Local Anvil demo" }],
  paths,
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "talunai_session" },
    },
    schemas,
  },
};
