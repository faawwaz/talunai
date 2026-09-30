import type { Address, Hex } from "viem";
import type {
  ActionName,
  TransactionTemplate,
  ClaimTerms,
} from "../api/chain-port";
export type {
  ActionName,
  TransactionTemplate,
  ClaimTerms,
} from "../api/chain-port";
export * from "./types";
export * from "./ops-types";
import type {
  OpsStatus,
  OpsRun,
  OpsRunDetail,
  OpsRunStatus,
  OpsTransaction,
  OpsRetryResult,
  OpsOrganization,
  OpsOrganizationStatus,
  OpsAuditEvent,
} from "./ops-types";
import type {
  PublicConfig,
  CurrentUser,
  OrganizationOption,
  OrganizationQuery,
  Page,
  DocumentMetadata,
  AgentRun,
  AgentStep,
  TransactionIntent,
  ReviewTask,
  PolicyReport,
  Attestation,
  ConsentSummary,
  ReviewSummary,
  GoodsMetadata,
  AccessRequestState,
  RequestAccessInput,
  AdminAccessRequest,
  AccessOrganization,
  ReviewAccessInput,
  ReviewAccessResult,
  CreateAccessOrganizationInput,
  CreateAccessOrganizationResult,
} from "./types";
export type Workflow =
  | "DRAFT"
  | "EXTRACTING"
  | "NEEDS_REVIEW"
  | "READY_FOR_SIGNATURES"
  | "READY_FOR_REGISTRATION"
  | "REGISTRATION_PENDING"
  | "REGISTERED"
  | "CANCELLED"
  | "REJECTED"
  | "PROCESSING_FAILED";
export type EvidenceStatus =
  | "MISSING"
  | "PENDING"
  | "SUPPORTED_BY_DOCUMENT"
  | "ATTESTED"
  | "REJECTED"
  | "STALE"
  | "NOT_INTEGRATED";
export type Claim = {
  id: string;
  assetType: "TRADE_RECEIVABLE";
  goods: GoodsMetadata | null;
  claimKey: Hex;
  version: number;
  workflow: Workflow;
  terms: ClaimTerms;
  organizationId: string;
  organizationName?: string | null;
  buyerOrganizationName?: string | null;
  createdAt?: string;
  updatedAt?: string;
  buyerOrganizationId: string;
  lenderOrganizationId?: string | null;
  invoiceNumber: string;
  invoiceNamespace: string;
  evidence: Record<string, EvidenceStatus>;
  fundingHold: boolean;
  hasDispute: boolean;
  isSynthetic: true;
};
export type LenderReadiness = {
  wallet: Address;
  chainId: 97 | 31337;
  blockNumber: string;
  stateConfidence: "CONFIRMED_CHAIN_READ";
  appMembershipApproved: true;
  chainAllowlisted: boolean;
  tokenBalance: string;
  vaultAllowance: string;
  gasBalanceWei: string;
  nextAction:
    | "REQUEST_LENDER_ALLOWLIST"
    | "GET_TEST_TOKEN"
    | "GET_TESTNET_GAS"
    | "APPROVE_TOKEN"
    | "READY";
  isSynthetic: true;
};
export type MarketDeal = {
  id: string;
  claimKey: Hex;
  invoiceAmount: string;
  principal: string;
  fee: string;
  dueAt: number;
  category: string | null;
  status: "READY_TO_FUND";
  hasAccess: boolean;
  confirmedBlock: string;
  stateConfidence: "CONFIRMED_PROJECTION";
};
export type ActionInboxItem = {
  claimId: string;
  role: "BORROWER" | "BUYER" | "LENDER" | "VERIFIER";
  action:
    | "COMPLETE_EVIDENCE"
    | "INVITE_LENDER"
    | "SIGN_TERMS"
    | "CONFIRM_INVOICE"
    | "REVIEW_DEAL"
    | "REGISTER_DEAL"
    | "FUND_DEAL"
    | "PAY_INVOICE"
    | "WITHDRAW_RETURN"
    | "WITHDRAW_BALANCE";
  tab: "summary" | "evidence" | "terms" | "payments";
  invoiceNumber: string;
  organizationName: string;
  buyerOrganizationName: string;
  principal: string;
  invoiceAmount: string;
  fee: string;
  dueAt: number;
  workflow: Workflow;
  updatedAt: string;
};
export type ActionInbox = {
  items: ActionInboxItem[];
  total: number;
  limit: number;
  offset: number;
  financialDataCurrent: boolean;
};
export type CreateClaim = {
  assetType?: "TRADE_RECEIVABLE";
  goods?: GoodsMetadata;
  organizationId: string;
  buyerOrganizationId: string;
  lenderOrganizationId?: string;
  invoiceNamespace: string;
  invoiceNumber: string;
  acceptedOutstanding: string;
  requestedPrincipal: string;
  invoiceDueAt: number;
  fundingWindowSeconds?: number;
};
export type Financing = {
  claimId: string;
  isSynthetic: true;
  chainId?: 97 | 31337;
  paymentToken?: { address: Address; symbol: "MockIDR"; decimals: 0 };
  borrower?: Address;
  buyer?: Address;
  lender?: Address | null;
  principal: string;
  fixedFee: string;
  acceptedOutstanding: string;
  totalCollected: string;
  lenderAllocated?: string;
  lenderOutstanding?: string;
  lenderWithdrawn: string;
  lenderClaimable: string;
  borrowerResidualClaimable: string;
  borrowerWithdrawn?: string;
  remainingInvoiceCollection: string;
  financingStatus: "UNFUNDED" | "ACTIVE" | "PARTIALLY_RECOVERED" | "REPAID";
  collectionStatus: "UNPAID" | "PARTIALLY_COLLECTED" | "FULLY_COLLECTED";
  registryStatus?: "CANCELLED" | "FUNDED" | "AVAILABLE";
  fundingHold?: boolean;
  hasDispute?: boolean;
  financingOverdue?: boolean;
  invoiceOverdue?: boolean;
  confirmedBlock?: string;
  confirmedBlockHash?: `0x${string}`;
  blockNumber?: string;
  blockHash?: `0x${string}`;
  indexerDegraded?: boolean;
  stateConfidence:
    | "CONFIRMED_PROJECTION"
    | "NO_CONFIRMED_PROJECTION"
    | "DEGRADED_LAST_CONFIRMED_PROJECTION";
};
export class TalunaiApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
    public correlationId?: string,
  ) {
    super(code);
  }
}
/** Browser clients use cookies; CLI injects fetch with a cookie jar. No participant key is accepted here. */
export class TalunaiClient {
  private csrfToken?: string;
  constructor(
    readonly baseUrl: string,
    private readonly requestFetch: typeof fetch = fetch,
    readonly origin = baseUrl,
  ) {}
  setCsrfToken(token: string) {
    this.csrfToken = token;
  }
  private browserCsrfToken() {
    if (typeof document === "undefined") return undefined;
    const token = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("talunai_csrf="))
      ?.slice("talunai_csrf=".length);
    return token && /^[a-f0-9]{64}$/.test(token) ? token : undefined;
  }
  private async fetchResponse(
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    try {
      // Native browser fetch must not receive the TalunaiClient instance as `this`.
      const requestFetch = this.requestFetch;
      return await requestFetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        credentials: "include",
        cache: "no-store",
      });
    } catch {
      throw new TalunaiApiError(0, "NETWORK_UNAVAILABLE");
    }
  }
  private async responseJson(response: Response): Promise<unknown> {
    const raw = await response.text();
    let result: unknown;
    try {
      result = raw ? JSON.parse(raw) : undefined;
    } catch {
      throw new TalunaiApiError(
        response.status,
        response.ok ? "INVALID_RESPONSE" : "HTTP_ERROR",
        undefined,
        response.headers.get("x-correlation-id") ?? undefined,
      );
    }
    if (!response.ok) {
      if (response.status === 401) this.csrfToken = undefined;
      const error =
        result && typeof result === "object"
          ? (result as {
              error?: { code?: unknown; details?: unknown };
              correlationId?: unknown;
            })
          : undefined;
      throw new TalunaiApiError(
        response.status,
        typeof error?.error?.code === "string"
          ? error.error.code
          : "HTTP_ERROR",
        error?.error?.details,
        typeof error?.correlationId === "string"
          ? error.correlationId
          : undefined,
      );
    }
    if (result === undefined && response.status !== 204)
      throw new TalunaiApiError(response.status, "INVALID_RESPONSE");
    return result;
  }
  private async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (method !== "GET") {
      // Browser controls Origin. CLI retains its explicit origin for the same server-side check.
      if (typeof window === "undefined" && typeof document === "undefined")
        headers.Origin = this.origin;
      const csrf = this.browserCsrfToken() ?? this.csrfToken;
      if (csrf) headers["X-CSRF-Token"] = csrf;
      if (key) headers["Idempotency-Key"] = key;
    }
    const form = typeof FormData !== "undefined" && body instanceof FormData;
    if (body !== undefined && !form)
      headers["Content-Type"] = "application/json";
    const response = await this.fetchResponse(path, {
      method,
      headers,
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    return (await this.responseJson(response)) as T;
  }
  config() {
    return this.request<PublicConfig>("/v1/config");
  }
  challenge(address: Address, chainId: 97 | 31337) {
    return this.request<{
      challengeId: string;
      message: string;
      expiresAt: string;
    }>("/v1/auth/challenge", "POST", { address, chainId, accountType: "EOA" });
  }
  async verify(challengeId: string, message: string, signature: Hex) {
    const result = await this.request<{ userId: string; csrfToken: string }>(
      "/v1/auth/verify",
      "POST",
      { challengeId, message, signature },
    );
    this.csrfToken = result.csrfToken;
    return result;
  }
  async logout() {
    const result = await this.request<{ loggedOut: true }>(
      "/v1/auth/logout",
      "POST",
      {},
    );
    this.csrfToken = undefined;
    return result;
  }
  me() {
    return this.request<CurrentUser>("/v1/me");
  }
  opsStatus() {
    return this.request<OpsStatus>("/v1/ops/status");
  }
  opsRuns(
    query: { status?: OpsRunStatus; limit?: number; offset?: number } = {},
  ) {
    const params = new URLSearchParams({
      limit: String(query.limit ?? 20),
      offset: String(query.offset ?? 0),
    });
    if (query.status) params.set("status", query.status);
    return this.request<Page<OpsRun>>(`/v1/ops/agent-runs?${params}`);
  }
  opsRun(id: string) {
    return this.request<OpsRunDetail>(
      `/v1/ops/agent-runs/${encodeURIComponent(id)}`,
    );
  }
  retryOpsRun(id: string, input: { expectedVersion: number }, key: string) {
    return this.request<OpsRetryResult>(
      `/v1/ops/agent-runs/${encodeURIComponent(id)}/retry`,
      "POST",
      input,
      key,
    );
  }
  opsTransactions(
    query: {
      status?: OpsTransaction["status"];
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const params = new URLSearchParams({
      limit: String(query.limit ?? 20),
      offset: String(query.offset ?? 0),
    });
    if (query.status) params.set("status", query.status);
    return this.request<Page<OpsTransaction>>(`/v1/ops/transactions?${params}`);
  }
  opsOrganizations(
    query: {
      status?: OpsOrganizationStatus;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const params = new URLSearchParams({
      limit: String(query.limit ?? 20),
      offset: String(query.offset ?? 0),
    });
    if (query.status) params.set("status", query.status);
    return this.request<Page<OpsOrganization>>(
      `/v1/ops/organizations?${params}`,
    );
  }
  opsAudit(query: { action?: string; limit?: number; offset?: number } = {}) {
    const params = new URLSearchParams({
      limit: String(query.limit ?? 20),
      offset: String(query.offset ?? 0),
    });
    if (query.action) params.set("action", query.action);
    return this.request<Page<OpsAuditEvent> & { integrityDisclosure: string }>(
      `/v1/ops/audit?${params}`,
    );
  }
  accessRequest() {
    return this.request<AccessRequestState>("/v1/access-request");
  }
  requestAccess(input: RequestAccessInput, idempotencyKey: string) {
    return this.request<AccessRequestState>(
      "/v1/access-request",
      "POST",
      input,
      idempotencyKey,
    );
  }
  accessRequests(
    query: {
      status?: AdminAccessRequest["status"];
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const params = new URLSearchParams();
    if (query.status) params.set("status", query.status);
    params.set("limit", String(query.limit ?? 20));
    params.set("offset", String(query.offset ?? 0));
    return this.request<Page<AdminAccessRequest>>(
      `/v1/access-requests?${params}`,
    );
  }
  accessOrganizations(query: {
    role: AccessOrganization["kind"];
    limit?: number;
    offset?: number;
  }) {
    const params = new URLSearchParams({
      role: query.role,
      limit: String(query.limit ?? 100),
      offset: String(query.offset ?? 0),
    });
    return this.request<Page<AccessOrganization>>(
      `/v1/access-organizations?${params}`,
    );
  }
  reviewAccess(id: string, input: ReviewAccessInput, key: string) {
    return this.request<ReviewAccessResult>(
      `/v1/access-requests/${id}/review`,
      "POST",
      input,
      key,
    );
  }
  createAccessOrganization(input: CreateAccessOrganizationInput, key: string) {
    return this.request<CreateAccessOrganizationResult>(
      "/v1/organizations/demo",
      "POST",
      input,
      key,
    );
  }
  organizations(query: OrganizationQuery = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) params.set(key, String(value));
    return this.request<Page<OrganizationOption>>(
      `/v1/organizations?${params}`,
    );
  }
  createClaim(input: CreateClaim, idempotencyKey: string) {
    return this.request<Claim>("/v1/claims", "POST", input, idempotencyKey);
  }
  claims(
    limit = 20,
    offset = 0,
    filters: { search?: string; workflow?: Workflow } = {},
  ) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (filters.search) params.set("search", filters.search);
    if (filters.workflow) params.set("workflow", filters.workflow);
    return this.request<Page<Claim>>(`/v1/claims?${params}`);
  }
  claim(id: string) {
    return this.request<Claim>(`/v1/claims/${id}`);
  }
  lenderReadiness() {
    return this.request<LenderReadiness>("/v1/lender/readiness");
  }
  marketDeals(limit = 20, offset = 0) {
    return this.request<Page<MarketDeal>>(
      `/v1/market/deals?limit=${limit}&offset=${offset}`,
    );
  }
  inviteLender(id: string, organizationId: string, key: string) {
    return this.request<{
      claimId: string;
      lenderOrganizationId: string;
      access: "INVITED";
    }>(
      `/v1/claims/${encodeURIComponent(id)}/lenders`,
      "POST",
      { organizationId },
      key,
    );
  }
  patchClaim(
    id: string,
    input: {
      expectedVersion: number;
      goods?: GoodsMetadata;
      acceptedOutstanding?: string;
      requestedPrincipal?: string;
      invoiceDueAt?: number;
    },
    key: string,
  ) {
    return this.request<Claim>(`/v1/claims/${id}`, "PATCH", input, key);
  }
  uploadDocument(
    id: string,
    file: File,
    expectedVersion: number,
    key: string,
    purpose: "DEAL" | "DISPUTE" = "DEAL",
  ) {
    const form = new FormData();
    form.set("file", file);
    form.set("expectedVersion", String(expectedVersion));
    form.set("purpose", purpose);
    return this.request<{
      documentId: string;
      version: number;
      status: string;
      purpose?: "DEAL" | "DISPUTE";
    }>(`/v1/claims/${id}/documents`, "POST", form, key);
  }
  analyze(id: string, expectedVersion: number, key: string) {
    return this.request<{
      runId: string;
      status: "QUEUED";
      mode: "mock" | "live";
    }>(`/v1/claims/${id}/analyze`, "POST", { expectedVersion }, key);
  }
  agentRun(id: string) {
    return this.request<AgentRun & { steps: AgentStep[] }>(
      `/v1/agent-runs/${encodeURIComponent(id)}`,
    );
  }
  agentRuns(claimId: string, limit = 20, offset = 0) {
    return this.request<Page<AgentRun>>(
      `/v1/claims/${encodeURIComponent(claimId)}/agent-runs?limit=${limit}&offset=${offset}`,
    );
  }
  agentActivity(limit = 20, offset = 0) {
    return this.request<Page<AgentRun>>(
      `/v1/agent-runs?limit=${limit}&offset=${offset}`,
    );
  }
  transactions(claimId: string, limit = 20, offset = 0) {
    return this.request<Page<TransactionIntent>>(
      `/v1/claims/${encodeURIComponent(claimId)}/transactions?limit=${limit}&offset=${offset}`,
    );
  }
  evidence(id: string) {
    return this.request<{
      claimId: string;
      version: number;
      evidence: Record<string, EvidenceStatus>;
      documents: DocumentMetadata[];
      extractedFields: Array<{
        id: string;
        version: number;
        fields: import("../domain/evidence").Extraction;
      }>;
      consents: ConsentSummary[];
      review: ReviewSummary | null;
      policy: PolicyReport | null;
      attestations: Attestation[];
    }>(`/v1/claims/${encodeURIComponent(id)}/evidence`);
  }
  async downloadDocument(id: string): Promise<Blob> {
    const response = await this.fetchResponse(
      `/v1/documents/${encodeURIComponent(id)}`,
      { method: "GET" },
    );
    if (!response.ok) await this.responseJson(response);
    return response.blob();
  }
  offer(id: string) {
    return this.request<{
      claimId: string;
      version: number;
      principal: string;
      fixedFee: string;
      advanceCap: string;
      lenderEntitlement: string;
      terms: ClaimTerms;
    }>(`/v1/claims/${id}/offer`);
  }
  prepareConsent(
    id: string,
    input: {
      expectedVersion: number;
      role: "BORROWER" | "BUYER";
      nonce: string;
    },
    key: string,
  ) {
    return this.request<{
      claimId: string;
      version: number;
      typedData: Record<string, unknown>;
    }>(`/v1/claims/${id}/consents/prepare`, "POST", input, key);
  }
  consent(
    id: string,
    input: {
      expectedVersion: number;
      role: "BORROWER" | "BUYER";
      nonce: string;
      signature: Hex;
    },
    key: string,
  ) {
    return this.request<{
      claimId: string;
      version: number;
      workflow: Workflow;
    }>(`/v1/claims/${id}/consents`, "POST", input, key);
  }
  review(
    id: string,
    input: {
      expectedVersion: number;
      decision: "APPROVE" | "REJECT";
      reason: string;
      evidenceIds: string[];
      attestations?: Array<
        | "buyerAcknowledgementStatus"
        | "deliveryEvidenceStatus"
        | "extractionStatus"
      >;
      resolvesDispute?: boolean;
    },
    key: string,
  ) {
    return this.request<
      | Claim
      | {
          claimId: string;
          version: number;
          reviewId: string;
          onchainHold: string;
        }
    >(`/v1/claims/${id}/review`, "POST", input, key);
  }
  dispute(
    id: string,
    input: { expectedVersion: number; reason: string; evidenceId: string },
    key: string,
  ) {
    return this.request<{
      actionId: string;
      hasDispute: true;
      onchainHold: "PENDING";
    }>(`/v1/claims/${id}/disputes`, "POST", input, key);
  }
  prepareAction(
    id: string,
    input: {
      expectedVersion: number;
      action: ActionName;
      amount?: string;
      nonce?: string;
    },
    key: string,
  ) {
    return this.request<{
      intentId: string;
      status: "PREPARED";
      transaction: TransactionTemplate;
    }>(`/v1/claims/${id}/actions/prepare`, "POST", input, key);
  }
  observe(intentId: string, hash: Hex, key: string, replacesIntentId?: string) {
    return this.request<{ intentId: string; status: string }>(
      "/v1/transactions/observe",
      "POST",
      { intentId, hash, replacesIntentId },
      key,
    );
  }
  observeReplacement(intentId: string, hash: Hex, key: string) {
    return this.request<{
      intentId: string;
      replacesIntentId: string;
      status: string;
      hash: Hex;
      stateConfidence: "RECEIPT_HINT_PENDING_INDEXER";
    }>(
      `/v1/transactions/${encodeURIComponent(intentId)}/replacement`,
      "POST",
      { hash },
      key,
    );
  }
  financing(id: string) {
    return this.request<Financing>(`/v1/claims/${id}/financing`);
  }
  audit(id: string, limit = 20, offset = 0) {
    return this.request<{ items: unknown[] }>(
      `/v1/claims/${id}/audit?limit=${limit}&offset=${offset}`,
    );
  }
  reviewTasks(limit = 20, offset = 0) {
    return this.request<Page<ReviewTask>>(
      `/v1/review-tasks?limit=${limit}&offset=${offset}`,
    );
  }
  actionsInbox(
    role: "BORROWER" | "BUYER" | "LENDER" | "VERIFIER" | "ADMIN",
    limit = 20,
    offset = 0,
  ) {
    return this.request<ActionInbox>(
      `/v1/actions/inbox?role=${role}&limit=${limit}&offset=${offset}`,
    );
  }
}
