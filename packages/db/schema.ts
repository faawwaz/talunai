import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uuid,
  numeric,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
export const organizations = pgTable("organizations", {
  id: text().primaryKey(),
  name: text().notNull(),
  kind: text().notNull(),
  status: text().notNull().default("PENDING"),
  synthetic: boolean().notNull().default(true),
});
export const users = pgTable("users", {
  id: text().primaryKey(),
  createdAt: time("created_at").notNull().defaultNow(),
  status: text().notNull().default("PENDING"),
});
export const wallets = pgTable("wallets", {
  address: text().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
});
export const memberships = pgTable(
  "memberships",
  {
    id: text().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    role: text().notNull(),
    approved: boolean().notNull().default(false),
  },
  (t) => [
    uniqueIndex("membership_unique").on(t.userId, t.organizationId, t.role),
  ],
);
export const accessRequests = pgTable("access_requests", {
  id: text().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  wallet: text()
    .notNull()
    .references(() => wallets.address),
  organizationName: text("organization_name").notNull(),
  requestedRole: text("requested_role").notNull(),
  note: text(),
  status: text().notNull().default("PENDING"),
  version: integer().notNull().default(1),
  organizationId: text("organization_id").references(() => organizations.id),
  reviewReason: text("review_reason"),
  reviewedBy: text("reviewed_by").references(() => users.id),
  reviewedAt: time("reviewed_at"),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const organizationAliases = pgTable("organization_aliases", {
  aliasKey: text("alias_key").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
});
export const syntheticOrganizationIdentities = pgTable(
  "synthetic_organization_identities",
  {
    identityKey: text("identity_key").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .unique()
      .references(() => organizations.id),
  },
);
export const siweChallenges = pgTable("siwe_challenges", {
  id: text().primaryKey(),
  address: text().notNull(),
  messageHash: text("message_hash").notNull(),
  browserHash: text("browser_hash").notNull(),
  expiresAt: time("expires_at").notNull(),
  consumedAt: time("consumed_at"),
});
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  wallet: text().notNull(),
  csrfHash: text("csrf_hash").notNull(),
  expiresAt: time("expires_at").notNull(),
  revokedAt: time("revoked_at"),
});
export const claims = pgTable(
  "claims",
  {
    id: text().primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    buyerOrgId: text("buyer_org_id")
      .notNull()
      .references(() => organizations.id),
    claimKey: text("claim_key").notNull().unique(),
    assetType: text("asset_type").notNull().default("TRADE_RECEIVABLE"),
    goods: jsonb("goods"),
    hmacKeyVersion: integer("hmac_key_version").notNull().default(1),
    invoiceNamespace: text("invoice_namespace").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    version: integer().notNull().default(1),
    workflow: text().notNull().default("DRAFT"),
    terms: jsonb().notNull(),
    evidence: jsonb().notNull(),
    fundingHold: boolean("funding_hold").notNull().default(false),
    hasDispute: boolean("has_dispute").notNull().default(false),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("claims_canonical_identity").on(
      t.orgId,
      t.invoiceNamespace,
      t.invoiceNumber,
    ),
  ],
);
export const claimAccess = pgTable(
  "claim_access",
  {
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
  },
  (t) => [uniqueIndex("claim_access_unique").on(t.claimId, t.orgId)],
);
export const claimVersions = pgTable(
  "claim_versions",
  {
    id: text().primaryKey(),
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id),
    version: integer().notNull(),
    snapshot: jsonb().notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("claim_version_unique").on(t.claimId, t.version)],
);
export const documents = pgTable("documents", {
  id: text().primaryKey(),
  claimId: text("claim_id")
    .notNull()
    .references(() => claims.id),
  version: integer().notNull(),
  purpose: text().notNull().default("DEAL"),
  originalName: text("original_name").notNull(),
  storageKey: text("storage_key").notNull(),
  sha256: text().notNull(),
  commitment: text().notNull(),
  mime: text().notNull(),
  byteSize: integer("byte_size").notNull(),
  extractedText: text("extracted_text"),
  status: text().notNull(),
  retentionAt: time("retention_at").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const extractedFields = pgTable("extracted_fields", {
  id: text().primaryKey(),
  claimId: text("claim_id").notNull(),
  version: integer().notNull(),
  fields: jsonb().notNull(),
});
export const attestations = pgTable("attestations", {
  id: text().primaryKey(),
  claimId: text("claim_id").notNull(),
  version: integer().notNull(),
  actorId: text("actor_id").notNull(),
  method: text().notNull(),
  kind: text().notNull(),
  status: text().notNull(),
  evidenceIds: jsonb("evidence_ids").notNull(),
  expiresAt: time("expires_at").notNull(),
  revokedAt: time("revoked_at"),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const consentRecords = pgTable(
  "consent_records",
  {
    id: text().primaryKey(),
    claimId: text("claim_id").notNull(),
    version: integer().notNull(),
    role: text().notNull(),
    signer: text().notNull(),
    nonce: text().notNull(),
    deadline: integer().notNull(),
    signature: text().notNull(),
    termsHash: text("terms_hash").notNull(),
    revoked: boolean().notNull().default(false),
  },
  (t) => [
    uniqueIndex("consent_current_unique")
      .on(t.claimId, t.version, t.role)
      .where(eq(t.revoked, false)),
  ],
);
export const consentIssuances = pgTable(
  "consent_issuances",
  {
    id: text().primaryKey(),
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id),
    version: integer().notNull(),
    role: text().notNull(),
    signer: text().notNull(),
    nonce: text().notNull(),
    deadline: integer().notNull(),
    termsHash: text("terms_hash").notNull(),
    chainId: integer("chain_id").notNull(),
    registryAddress: text("registry_address").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("consent_issuances_chain_nonce").on(
      t.chainId,
      t.registryAddress,
      t.signer,
      t.nonce,
    ),
    index("consent_issuances_claim_version").on(t.claimId, t.version),
  ],
);
export const reviewDecisions = pgTable("review_decisions", {
  id: text().primaryKey(),
  claimId: text("claim_id").notNull(),
  version: integer().notNull(),
  actorId: text("actor_id").notNull(),
  decision: text().notNull(),
  reason: text().notNull(),
  expiresAt: time("expires_at").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const policySnapshots = pgTable("policy_snapshots", {
  id: text().primaryKey(),
  claimId: text("claim_id").notNull(),
  version: integer().notNull(),
  result: jsonb().notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const agentRuns = pgTable("agent_runs", {
  id: text().primaryKey(),
  claimId: text("claim_id").notNull(),
  version: integer().notNull(),
  mode: text().notNull(),
  status: text().notNull(),
  stage: text().notNull(),
  inputHash: text("input_hash").notNull(),
  executionToken: uuid("execution_token"),
  result: jsonb(),
  error: text(),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
export const agentSteps = pgTable("agent_steps", {
  id: text().primaryKey(),
  runId: text("run_id").notNull(),
  step: integer().notNull(),
  stage: text().notNull(),
  result: jsonb().notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const reviewTasks = pgTable("review_tasks", {
  id: text().primaryKey(),
  claimId: text("claim_id").notNull(),
  version: integer().notNull(),
  role: text().notNull(),
  kind: text().notNull(),
  status: text().notNull().default("OPEN"),
  details: jsonb().notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const notifications = pgTable("notifications", {
  id: text().primaryKey(),
  claimId: text("claim_id").notNull(),
  role: text().notNull(),
  message: text().notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const chainDeployments = pgTable("chain_deployments", {
  chainId: integer("chain_id").primaryKey(),
  manifest: jsonb().notNull(),
});
export const transactionIntents = pgTable("transaction_intents", {
  id: text().primaryKey(),
  claimId: text("claim_id").notNull(),
  actorId: text("actor_id").notNull(),
  sender: text().notNull(),
  action: text().notNull(),
  status: text().notNull(),
  template: jsonb().notNull(),
  txHash: text("tx_hash"),
  replacesId: text("replaces_id"),
  details: jsonb(),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
export const chainEvents = pgTable(
  "chain_events",
  {
    id: text().primaryKey(),
    chainId: integer("chain_id").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: numeric("block_number", { precision: 78, scale: 0 }).notNull(),
    blockHash: text("block_hash").notNull(),
    contractAddress: text("contract_address"),
    claimKey: text("claim_key"),
    eventName: text("event_name").notNull(),
    args: jsonb().notNull(),
    canonical: boolean().notNull().default(true),
  },
  (t) => [
    uniqueIndex("chain_event_unique").on(t.chainId, t.txHash, t.logIndex),
  ],
);
export const indexerCheckpoints = pgTable("indexer_checkpoints", {
  chainId: integer("chain_id").primaryKey(),
  blockNumber: numeric("block_number", { precision: 78, scale: 0 }).notNull(),
  blockHash: text("block_hash").notNull(),
  degraded: boolean().notNull().default(false),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
export const financialProjections = pgTable("financial_projections", {
  claimKey: text("claim_key").primaryKey(),
  chainId: integer("chain_id").notNull(),
  state: jsonb().notNull(),
  blockNumber: numeric("block_number", { precision: 78, scale: 0 }).notNull(),
  blockHash: text("block_hash").notNull(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
export const idempotencyRecords = pgTable("idempotency_records", {
  scope: text().primaryKey(),
  bodyHash: text("body_hash").notNull(),
  status: integer().notNull(),
  response: jsonb().notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const outbox = pgTable(
  "outbox",
  {
    id: text().primaryKey(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    publishedAt: time("published_at"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [index("outbox_unpublished").on(t.publishedAt)],
);
export const auditEvents = pgTable("audit_events", {
  id: text().primaryKey(),
  actorId: text("actor_id").notNull(),
  organizationId: text("organization_id"),
  action: text().notNull(),
  target: text().notNull(),
  beforeHash: text("before_hash"),
  afterHash: text("after_hash"),
  reason: text(),
  correlationId: text("correlation_id").notNull(),
  details: jsonb().notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const rateLimits = pgTable("rate_limits", {
  key: text().primaryKey(),
  count: integer().notNull(),
  resetAt: time("reset_at").notNull(),
});
