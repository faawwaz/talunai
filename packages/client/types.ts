import type { Address, Hex } from "viem";
import type { ActionName, TransactionTemplate } from "../api/chain-port";
export type Role = "BORROWER" | "BUYER" | "LENDER" | "VERIFIER" | "ADMIN";
export type Page<T> = {
  items: T[];
  limit: number;
  offset: number;
  total?: number;
};
export type PublicConfig = {
  chainId: 97 | 31337;
  appEnv: "local" | "testnet";
  appOrigin?: string;
  contracts: {
    registry: Address;
    vault: Address;
    agentExecutor: Address;
    token: Address;
  };
  paymentToken: { symbol: "MockIDR"; decimals: 0 };
  isSynthetic: true;
  llmMode: "mock" | "live";
  confirmations: number;
  accountTypes: ["EOA"];
  disclosures: string[];
};
export type Membership = {
  organizationId: string;
  organizationName: string;
  organizationKind: string;
  organizationStatus: string;
  isSynthetic: boolean;
  role: Role;
};
export type CurrentUser = {
  userId: string;
  wallet: Address;
  status: string;
  memberships: Membership[];
};
export type Me = CurrentUser;
export type AccessRequest = {
  id: string;
  organizationName: string;
  requestedRole: "BORROWER" | "BUYER" | "LENDER";
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  version: number;
  reviewReason: string | null;
  organizationId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  isSynthetic: true;
};
export type AccessRequestState = {
  request: AccessRequest | null;
  restrictedWallet: boolean;
};
export type RequestAccessInput = {
  organizationName: string;
  requestedRole: AccessRequest["requestedRole"];
  note?: string;
};
export type AdminAccessRequest = AccessRequest & {
  userId: string;
  wallet: Address;
};
export type AccessOrganization = {
  id: string;
  name: string;
  kind: AccessRequest["requestedRole"];
  occupied: boolean;
  isSynthetic: true;
};
export type ReviewAccessInput = {
  expectedVersion: number;
  decision: "APPROVE" | "REJECT";
  organizationId?: string;
  reason: string;
};
export type ReviewAccessResult = {
  request: AccessRequest;
  remainingGate: "ONCHAIN_LENDER_ALLOWLIST_REQUIRED" | null;
  chainTransactionSent: false;
};
export type CreateAccessOrganizationInput = {
  name: string;
  kind: AccessRequest["requestedRole"];
  identityKey: string;
  reason: string;
};
export type CreateAccessOrganizationResult = {
  organization: Pick<
    AccessOrganization,
    "id" | "name" | "kind" | "isSynthetic"
  > & {
    kybStatus: "NOT_INTEGRATED";
  };
  chainTransactionSent: false;
};
export type OrganizationOption = {
  id: string;
  name: string;
  kind: "BUYER" | "LENDER";
  isSynthetic: boolean;
  authorityStatus: "APPROVED";
};
export type OrganizationQuery = {
  issuerOrganizationId?: string;
  role?: "BUYER" | "LENDER";
  limit?: number;
  offset?: number;
};
export type DocumentMetadata = {
  id: string;
  version: number;
  purpose?: "DEAL" | "DISPUTE";
  name: string;
  mediaType: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
  retentionAt: string;
  downloadUrl: string;
  original_name?: string;
  mime?: string;
  byte_size?: number;
  created_at?: string;
};
export type PolicyReport = {
  outcome: "ELIGIBLE_FOR_HUMAN_APPROVAL" | "NEEDS_REVIEW" | "REJECTED";
  reasonCodes: string[];
  evidenceIds: string[];
  policyVersion: string;
  policyHash: Hex;
  inputSnapshotHash: Hex;
  outstandingGates: string[];
  disclosures: string[];
  quote: {
    acceptedOutstanding: string;
    principal: string;
    advanceCap: string;
    fixedFee: string;
    lenderEntitlement: string;
    isSynthetic: true;
    feeKind: "FLAT_SYNTHETIC_NOT_APR";
  };
};
export type AgentRunResult = {
  mode?: "mock" | "live";
  provider?: string;
  model?: string;
  latencyMs?: number;
  usage?: Record<string, unknown> | null;
  policy?: PolicyReport;
  evidence?: Record<string, string>;
  explanation?: string;
  evidenceIds?: string[];
  conflicts?: string[];
  workflow?: string;
  status?: string;
};
export type AgentStep = {
  id: string;
  step: number;
  stage: string;
  result: Record<string, unknown>;
  createdAt: string;
};
export type AgentRun = {
  id: string;
  claimId: string;
  version: number;
  mode: "mock" | "live";
  status: string;
  stage: string;
  inputHash: string;
  result: AgentRunResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  invoiceNumber?: string;
  organizationName?: string;
};
export type TransactionStatus =
  | "PREPARED"
  | "SUBMITTED"
  | "MINED"
  | "CONFIRMED"
  | "REVERTED"
  | "REPLACED"
  | "DROPPED_OR_UNKNOWN";
export type TransactionIntent = {
  id: string;
  claimId: string;
  sender: Address;
  action: ActionName;
  status: TransactionStatus;
  transaction: TransactionTemplate;
  txHash: Hex | null;
  replacesIntentId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};
export type ReviewTask = {
  id: string;
  claimId: string;
  version: number;
  role: Role;
  kind: string;
  status: string;
  details: Record<string, unknown>;
  createdAt: string;
  invoiceNumber: string;
  organizationName: string;
  buyerOrganizationName: string;
};
export type Attestation = {
  id: string;
  version: number;
  actor_id: string;
  method: string;
  kind: string;
  status: string;
  evidence_ids: string[];
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

export type ConsentSummary = {
  role: "BORROWER" | "BUYER";
  version: number;
  signer: Address;
  nonce: string;
  deadline: number;
  termsHash: Hex;
  revoked: boolean;
  onchainInvalidation: {
    txHash: Hex;
    blockNumber: string;
    blockHash: Hex;
  } | null;
  stateConfidence: "RECORDED_OFFCHAIN";
};
export type ReviewSummary = {
  id: string;
  version: number;
  actorId: string;
  decision: "APPROVE" | "REJECT";
  reason: string;
  expiresAt: string;
  createdAt: string;
};

export type { GoodsCategory, GoodsMetadata } from "../domain/goods";
