import type { Address, Hex } from "viem";
import type { TransactionStatus } from "./types";

export type OpsHealthStatus = "READY" | "DEGRADED" | "STALE" | "UNAVAILABLE";
export type OpsStatus = {
  observedAt: string;
  chainId: 97 | 31337;
  isSynthetic: true;
  freshnessThresholdSeconds: number;
  status: "READY" | "DEGRADED" | "UNAVAILABLE";
  worker: {
    status: OpsHealthStatus;
    updatedAt: string | null;
    errorCode: string | null;
    mode: "mock" | "live" | null;
    model: string | null;
    configuredMode: "mock" | "live";
    configurationMatch: boolean | null;
  };
  indexer: {
    status: OpsHealthStatus;
    updatedAt: string | null;
    blockNumber: string | null;
    blockHash: string | null;
  };
  queues: {
    source: "POSTGRES_OUTBOX";
    pending: number;
    oldestPendingAt: string | null;
    byType: Array<{ type: string; pending: number }>;
  };
  runs: {
    QUEUED: number;
    RUNNING: number;
    COMPLETED: number;
    FAILED: number;
    STALE: number;
  };
  transactions: { pending: number; unknown: number; reverted: number };
};
export type OpsRunStatus =
  "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "STALE";
export type OpsRun = {
  id: string;
  claimId: string;
  version: number;
  currentVersion: number;
  invoiceNumber: string;
  organizationName: string;
  mode: "mock" | "live";
  status: OpsRunStatus;
  stage: string;
  inputHash: string;
  provider: string | null;
  model: string | null;
  errorCode: string | null;
  latencyMs: number | null;
  explanation: string | null;
  reasonCodes: string[];
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
  retryable: boolean;
};
export type OpsStep = {
  id: string;
  step: number;
  stage: string;
  createdAt: string;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  reasonCodes: string[];
  evidenceIds: string[];
  explanation: string | null;
};
export type OpsRunDetail = OpsRun & { steps: OpsStep[] };
// These read models intentionally omit calldata, credentials, signatures and raw prompts.
export type OpsTransaction = {
  id: string;
  claimId: string;
  invoiceNumber: string;
  organizationName: string;
  sender: Address;
  action: string;
  status: TransactionStatus;
  txHash: Hex | null;
  replacesIntentId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type OpsOrganizationStatus =
  "APPROVED" | "PENDING" | "REJECTED" | "REVOKED";
export type OpsOrganization = {
  id: string;
  name: string;
  kind: string;
  status: OpsOrganizationStatus;
  isSynthetic: boolean;
  memberships: Array<{
    id: string;
    userId: string;
    role: string;
    approved: boolean;
    wallets: Address[];
  }>;
};
export type OpsAuditEvent = {
  id: string;
  actorId: string;
  organizationId: string | null;
  action: string;
  target: string;
  beforeHash: string | null;
  afterHash: string | null;
  correlationId: string;
  createdAt: string;
};
export type OpsRetryResult = {
  runId: string;
  status: "QUEUED";
  mode: "mock" | "live";
  retriesRunId: string;
};
