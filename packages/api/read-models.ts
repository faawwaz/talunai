import { z } from "zod";
import { getSql } from "../db";
import { config } from "./config";
import {
  ApiError,
  type Actor,
  authorizedClaim,
  hasRole,
  json,
  requireRole,
} from "./core";

export function pagination(req: Request) {
  const params = new URL(req.url).searchParams;
  return z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    })
    .parse({
      limit: params.get("limit") ?? undefined,
      offset: params.get("offset") ?? undefined,
    });
}

/** All collection queries use the same organization/object access rules as detail reads. */
export function claimVisibility(actor: Actor) {
  const sql = getSql();
  if (hasRole(actor, "ADMIN") || hasRole(actor, "VERIFIER")) return sql`true`;
  const orgs = [...new Set(actor.memberships.map((m) => m.organizationId))];
  const lenders = [
    ...new Set(
      actor.memberships
        .filter((m) => m.role === "LENDER")
        .map((m) => m.organizationId),
    ),
  ];
  if (!orgs.length) return sql`false`;
  return lenders.length
    ? sql`(c.org_id IN ${sql(orgs)} OR c.buyer_org_id IN ${sql(orgs)} OR EXISTS(SELECT 1 FROM claim_access access WHERE access.claim_id=c.id AND access.org_id IN ${sql(lenders)}))`
    : sql`(c.org_id IN ${sql(orgs)} OR c.buyer_org_id IN ${sql(orgs)})`;
}

/** A lender can explore confirmed available terms without reading private evidence. */
export async function marketDeals(req: Request, actor: Actor) {
  requireRole(actor, ["LENDER"]);
  const lenderOrganizations = [
    ...new Set(
      actor.memberships
        .filter((membership) => membership.role === "LENDER")
        .map((membership) => membership.organizationId),
    ),
  ];
  const { limit, offset } = pagination(req);
  const sql = getSql();
  const chainId = config().CHAIN_ID;
  const [checkpoint] =
    await sql`SELECT degraded,updated_at FROM indexer_checkpoints
    WHERE chain_id=${chainId}`;
  if (
    !checkpoint ||
    checkpoint.degraded ||
    Date.now() - new Date(checkpoint.updated_at).getTime() > 120_000
  )
    throw new ApiError(503, "INDEXER_NOT_FRESH");
  const available = sql`c.workflow='REGISTERED' AND c.has_dispute=false
    AND c.funding_hold=false AND fp.chain_id=${chainId}
    AND fp.state->>'registryStatus'='AVAILABLE'
    AND fp.state->>'financingStatus'='UNFUNDED'
    AND fp.state->>'stateConfidence'='CONFIRMED_PROJECTION'
    AND (c.terms->>'fundingDeadline')::bigint>extract(epoch from now())
    AND (c.terms->>'reviewExpiry')::bigint>extract(epoch from now())
    AND (c.terms->>'consentExpiry')::bigint>extract(epoch from now())
    AND fp.updated_at>now()-interval '120 seconds'`;
  const rows = await sql`SELECT c.id,c.claim_key,c.terms,c.goods,
    fp.block_number,
    EXISTS(SELECT 1 FROM claim_access access
      WHERE access.claim_id=c.id AND access.org_id IN ${sql(lenderOrganizations)}) AS has_access
    FROM claims c JOIN financial_projections fp ON fp.claim_key=c.claim_key
    WHERE ${available}
    ORDER BY (c.terms->>'invoiceDueAt')::bigint,c.id
    LIMIT ${limit} OFFSET ${offset}`;
  const [count] = await sql`SELECT count(*)::integer AS total
    FROM claims c JOIN financial_projections fp ON fp.claim_key=c.claim_key
    WHERE ${available}`;
  return json({
    items: rows.map((row) => ({
      id: row.id,
      claimKey: row.claim_key,
      invoiceAmount: row.terms.acceptedOutstanding,
      principal: row.terms.principal,
      fee: row.terms.fee,
      dueAt: row.terms.invoiceDueAt,
      category: row.goods?.category ?? null,
      status: "READY_TO_FUND",
      hasAccess: row.has_access,
      confirmedBlock: String(row.block_number),
      stateConfidence: "CONFIRMED_PROJECTION",
    })),
    total: count.total,
    limit,
    offset,
  });
}

export async function currentUser(actor: Actor) {
  const sql = getSql();
  const [user] = await sql`SELECT status FROM users WHERE id=${actor.userId}`;
  if (!user) throw new ApiError(401, "SESSION_INVALID");
  const memberships =
    await sql`SELECT m.organization_id,m.role,o.name,o.kind,o.status,o.synthetic FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=${actor.userId} AND m.approved=true AND o.status='APPROVED' ORDER BY o.name,m.role`;
  return json({
    userId: actor.userId,
    wallet: actor.wallet,
    status: user.status,
    memberships: memberships.map((m) => ({
      organizationId: m.organization_id,
      organizationName: m.name,
      organizationKind: m.kind,
      organizationStatus: m.status,
      isSynthetic: m.synthetic,
      role: m.role,
    })),
  });
}

/** Only provisioned borrowers can browse the approved counterpart directory for issuance. */
export async function approvedOrganizations(req: Request, actor: Actor) {
  const params = new URL(req.url).searchParams;
  const query = z
    .object({
      issuerOrganizationId: z.string().min(1).max(100).optional(),
      role: z.enum(["BUYER", "LENDER"]).optional(),
    })
    .parse({
      issuerOrganizationId: params.get("issuerOrganizationId") ?? undefined,
      role: params.get("role") ?? undefined,
    });
  const issuers = [
    ...new Set(
      actor.memberships
        .filter((m) => m.role === "BORROWER")
        .map((m) => m.organizationId),
    ),
  ];
  requireRole(actor, ["BORROWER"]);
  const issuer =
    query.issuerOrganizationId ??
    (issuers.length === 1 ? issuers[0] : undefined);
  if (!issuer) throw new ApiError(422, "ISSUER_SELECTION_REQUIRED");
  requireRole(actor, ["BORROWER"], issuer);
  const sql = getSql();
  const allowed =
    await sql`SELECT id FROM organizations WHERE id=${issuer} AND status='APPROVED'`;
  if (!allowed.length) throw new ApiError(403, "ISSUER_NOT_APPROVED");
  const { limit, offset } = pagination(req);
  const roleFilter = query.role
    ? sql`o.kind=${query.role}`
    : sql`o.kind IN ('BUYER','LENDER')`;
  const rows =
    await sql`SELECT o.id,o.name,o.kind,o.synthetic FROM organizations o JOIN memberships m ON m.organization_id=o.id AND m.role=o.kind AND m.approved=true JOIN wallets w ON w.user_id=m.user_id WHERE o.status='APPROVED' AND o.id<>${issuer} AND ${roleFilter} GROUP BY o.id,o.name,o.kind,o.synthetic HAVING count(DISTINCT w.address)=1 ORDER BY o.name,o.id LIMIT ${limit} OFFSET ${offset}`;
  return json({
    items: rows.map((o) => ({
      id: o.id,
      name: o.name,
      kind: o.kind,
      isSynthetic: o.synthetic,
      authorityStatus: "APPROVED",
    })),
    limit,
    offset,
  });
}

export function documentMetadata(row: Record<string, unknown>) {
  return {
    id: row.id,
    version: row.version,
    purpose: row.purpose ?? "DEAL",
    status: row.status,
    name: row.original_name,
    mediaType: row.mime,
    sizeBytes: row.byte_size,
    createdAt: row.created_at,
    retentionAt: row.retention_at,
    downloadUrl: `/v1/documents/${row.id}`,
    original_name: row.original_name,
    mime: row.mime,
    byte_size: row.byte_size,
    created_at: row.created_at,
    retention_at: row.retention_at,
  };
}

export function agentRunModel(row: Record<string, unknown>) {
  return {
    ...row,
    claimId: row.claim_id,
    inputHash: row.input_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    invoiceNumber: row.invoice_number,
    organizationName: row.organization_name,
  };
}
export async function agentRuns(req: Request, actor: Actor, claimId?: string) {
  if (claimId) await authorizedClaim(actor, claimId);
  const { limit, offset } = pagination(req),
    sql = getSql();
  const scope = claimId ? sql`r.claim_id=${claimId}` : claimVisibility(actor);
  const rows =
    await sql`SELECT r.id,r.claim_id,r.version,r.mode,r.status,r.stage,r.input_hash,r.result,r.error,r.created_at,r.updated_at,c.invoice_number,o.name AS organization_name FROM agent_runs r JOIN claims c ON c.id=r.claim_id JOIN organizations o ON o.id=c.org_id WHERE ${scope} ORDER BY r.created_at DESC,r.id DESC LIMIT ${limit} OFFSET ${offset}`;
  const [count] =
    await sql`SELECT count(*)::integer AS total FROM agent_runs r JOIN claims c ON c.id=r.claim_id WHERE ${scope}`;
  return json({
    items: rows.map(agentRunModel),
    limit,
    offset,
    total: count.total,
  });
}
export async function agentRun(actor: Actor, runId: string) {
  const sql = getSql();
  const [run] =
    await sql`SELECT id,claim_id,version,mode,status,stage,input_hash,result,error,created_at,updated_at FROM agent_runs WHERE id=${runId}`;
  if (!run) throw new ApiError(404, "RUN_NOT_FOUND");
  await authorizedClaim(actor, run.claim_id);
  const steps =
    await sql`SELECT id,step,stage,result,created_at FROM agent_steps WHERE run_id=${runId} ORDER BY step,id`;
  return json({
    ...agentRunModel(run),
    steps: steps.map((s) => ({ ...s, createdAt: s.created_at })),
  });
}
export async function transactionIntents(
  req: Request,
  actor: Actor,
  claimId: string,
) {
  await authorizedClaim(actor, claimId);
  const { limit, offset } = pagination(req),
    sql = getSql();
  // A reviewer may read claim evidence, but another participant's prepared intents stay private.
  const rows =
    await sql`SELECT id,claim_id,sender,action,status,template,tx_hash,replaces_id,details,created_at,updated_at FROM transaction_intents WHERE claim_id=${claimId} AND actor_id=${actor.userId} ORDER BY created_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}`;
  const [count] =
    await sql`SELECT count(*)::integer AS total FROM transaction_intents WHERE claim_id=${claimId} AND actor_id=${actor.userId}`;
  return json({
    items: rows.map((r) => ({
      id: r.id,
      claimId: r.claim_id,
      sender: r.sender,
      action: r.action,
      status: r.status,
      transaction: r.template,
      txHash: r.tx_hash,
      replacesIntentId: r.replaces_id,
      details: r.details,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    limit,
    offset,
    total: count.total,
  });
}
export async function actorReviewTasks(req: Request, actor: Actor) {
  const { limit, offset } = pagination(req),
    sql = getSql();
  const roles = [...new Set(actor.memberships.map((m) => m.role))];
  const roleScope = hasRole(actor, "ADMIN")
    ? sql`true`
    : roles.length
      ? sql`t.role IN ${sql(roles)}`
      : sql`false`;
  const scope = claimVisibility(actor);
  const rows =
    await sql`SELECT t.*,c.invoice_number,o.name AS organization_name,b.name AS buyer_organization_name FROM review_tasks t JOIN claims c ON c.id=t.claim_id JOIN organizations o ON o.id=c.org_id JOIN organizations b ON b.id=c.buyer_org_id WHERE t.status='OPEN' AND ${roleScope} AND ${scope} ORDER BY t.created_at DESC,t.id DESC LIMIT ${limit} OFFSET ${offset}`;
  const [count] =
    await sql`SELECT count(*)::integer AS total FROM review_tasks t JOIN claims c ON c.id=t.claim_id WHERE t.status='OPEN' AND ${roleScope} AND ${scope}`;
  return json({
    items: rows.map((r) => ({
      ...r,
      claimId: r.claim_id,
      invoiceNumber: r.invoice_number,
      organizationName: r.organization_name,
      buyerOrganizationName: r.buyer_organization_name,
      createdAt: r.created_at,
    })),
    limit,
    offset,
    total: count.total,
  });
}
