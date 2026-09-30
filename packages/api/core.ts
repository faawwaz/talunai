import { createHash, createHmac, randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { getSql, type DbTransaction } from "../db";
import { config } from "./config";
import type { ChainClaim } from "./chain-port";
import type { GoodsMetadata } from "../domain/goods";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}
export const id = () => randomUUID();
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const secretHash = (value: string) =>
  createHmac("sha256", config().SESSION_SECRET).update(value).digest("hex");
export const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    typeof x === "bigint"
      ? x.toString()
      : x && typeof x === "object" && !Array.isArray(x)
        ? Object.keys(x)
            .sort()
            .reduce((a, k) => ({ ...a, [k]: x[k] }), {})
        : x,
  );
export const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(canonical(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
export function failure(error: unknown, correlationId: string) {
  if (error instanceof ApiError)
    return json(
      { error: { code: error.code, details: error.details }, correlationId },
      error.status,
    );
  if (error instanceof ZodError)
    return json(
      {
        error: {
          code: "VALIDATION_ERROR",
          details: error.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        },
        correlationId,
      },
      422,
    );
  if ((error as { code?: string })?.code === "23505")
    return json(
      { error: { code: "CONFLICT_REQUIRES_REVIEW" }, correlationId },
      409,
    );
  console.error(
    JSON.stringify({
      level: "error",
      code: "INTERNAL_ERROR",
      correlationId,
      type: error instanceof Error ? error.constructor.name : "Unknown",
    }),
  );
  return json({ error: { code: "INTERNAL_ERROR" }, correlationId }, 500);
}
export async function readBody(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 65536)
    throw new ApiError(413, "BODY_TOO_LARGE");
  const reader = req.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 65536) {
      await reader.cancel();
      throw new ApiError(413, "BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  try {
    return bytes.byteLength
      ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
      : {};
  } catch {
    throw new ApiError(422, "INVALID_JSON");
  }
}
export function checkOrigin(req: Request) {
  if (req.headers.get("origin") !== config().APP_ORIGIN)
    throw new ApiError(403, "ORIGIN_MISMATCH");
}
export type Actor = {
  userId: string;
  wallet: `0x${string}`;
  sessionHash: string;
  memberships: Array<{ organizationId: string; role: string }>;
};
export function hasRole(actor: Actor, role: string, orgId?: string) {
  return actor.memberships.some(
    (m) => m.role === role && (!orgId || m.organizationId === orgId),
  );
}
export function requireRole(actor: Actor, roles: string[], orgId?: string) {
  if (!roles.some((r) => hasRole(actor, r, orgId)))
    throw new ApiError(403, "ROLE_FORBIDDEN");
}
export function authorizingOrganization(
  actor: Actor,
  role: string,
  orgId?: string,
): string | null {
  const matches = [
    ...new Set(
      actor.memberships
        .filter(
          (membership) =>
            membership.role === role &&
            (!orgId || membership.organizationId === orgId),
        )
        .map((membership) => membership.organizationId),
    ),
  ];
  return matches.length === 1 ? matches[0] : null;
}
export type ClaimRow = {
  id: string;
  asset_type: "TRADE_RECEIVABLE";
  goods: GoodsMetadata | null;
  org_id: string;
  buyer_org_id: string;
  claim_key: `0x${string}`;
  version: number;
  workflow: string;
  terms: ChainClaim["terms"];
  evidence: Record<string, string>;
  funding_hold: boolean;
  has_dispute: boolean;
  invoice_namespace: string;
  invoice_number: string;
  [key: string]: unknown;
};
export const toChainClaim = (r: ClaimRow): ChainClaim => ({
  id: r.id,
  claimKey: r.claim_key,
  version: r.version,
  workflow: r.workflow,
  terms: r.terms,
  fundingHold: r.funding_hold,
  hasDispute: r.has_dispute,
});
export async function authorizedClaim(
  actor: Actor,
  claimId: string,
  sql = getSql() as unknown as DbTransaction,
  lock = false,
): Promise<ClaimRow> {
  const rows = lock
    ? await sql`SELECT c.*,(SELECT access.org_id FROM claim_access access WHERE access.claim_id=c.id ORDER BY access.org_id LIMIT 1) AS lender_organization_id FROM claims c WHERE c.id=${claimId} FOR UPDATE OF c`
    : await sql`SELECT c.*,o.name AS organization_name,b.name AS buyer_organization_name,(SELECT access.org_id FROM claim_access access WHERE access.claim_id=c.id ORDER BY access.org_id LIMIT 1) AS lender_organization_id FROM claims c JOIN organizations o ON o.id=c.org_id JOIN organizations b ON b.id=c.buyer_org_id WHERE c.id=${claimId}`;
  const claim = rows[0] as ClaimRow | undefined;
  if (!claim) throw new ApiError(404, "CLAIM_NOT_FOUND");
  const privileged = hasRole(actor, "ADMIN") || hasRole(actor, "VERIFIER");
  const owner = actor.memberships.some(
    (m) =>
      m.organizationId === claim.org_id ||
      m.organizationId === claim.buyer_org_id,
  );
  const orgs = actor.memberships
    .filter((m) => m.role === "LENDER")
    .map((m) => m.organizationId);
  const grants = orgs.length
    ? await sql`SELECT org_id FROM claim_access WHERE claim_id=${claimId} AND org_id IN ${sql(orgs)}`
    : [];
  if (!privileged && !owner && !grants.length)
    throw new ApiError(404, "CLAIM_NOT_FOUND");
  return claim;
}
export async function assertCurrentAuthorities(
  tx: DbTransaction,
  claim: ClaimRow,
) {
  for (const [org, role, wallet] of [
    [claim.org_id, "BORROWER", claim.terms.borrower],
    [claim.buyer_org_id, "BUYER", claim.terms.buyer],
  ]) {
    const rows =
      await tx`SELECT w.address FROM wallets w JOIN memberships m ON m.user_id=w.user_id JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=${org} AND m.role=${role} AND m.approved=true AND o.status='APPROVED' AND w.address=${wallet.toLowerCase()}`;
    if (rows.length !== 1)
      throw new ApiError(409, "AUTHORITY_STALE_REVIEW_REQUIRED");
  }
}
export async function assertIndependentVerifier(
  tx: DbTransaction,
  actor: Actor,
  claim: ClaimRow,
) {
  if (
    actor.memberships.some(
      (membership) =>
        membership.organizationId === claim.org_id ||
        membership.organizationId === claim.buyer_org_id,
    )
  )
    throw new ApiError(403, "REVIEWER_CONFLICT");
  const lenderOrganizations = actor.memberships
    .filter((membership) => membership.role === "LENDER")
    .map((membership) => membership.organizationId);
  if (lenderOrganizations.length) {
    const grants = await tx`SELECT 1 FROM claim_access
      WHERE claim_id=${claim.id} AND org_id IN ${tx(lenderOrganizations)} LIMIT 1`;
    if (grants.length) throw new ApiError(403, "REVIEWER_CONFLICT");
  }
  const fundedByActor = await tx`SELECT 1 FROM chain_events
    WHERE chain_id=${config().CHAIN_ID} AND claim_key=${claim.claim_key}
      AND canonical=true AND event_name='Funded'
      AND lower(args->>'lender')=${actor.wallet.toLowerCase()} LIMIT 1`;
  if (fundedByActor.length) throw new ApiError(403, "REVIEWER_CONFLICT");
}
export async function assertGrantedLender(
  tx: DbTransaction,
  actor: Actor,
  claim: ClaimRow,
) {
  if (
    actor.wallet.toLowerCase() === claim.terms.borrower.toLowerCase() ||
    actor.wallet.toLowerCase() === claim.terms.buyer.toLowerCase() ||
    actor.memberships.some(
      (membership) =>
        membership.organizationId === claim.org_id ||
        membership.organizationId === claim.buyer_org_id,
    )
  )
    throw new ApiError(403, "LENDER_CONFLICT");
  const lenderOrganizations = actor.memberships
    .filter(
      (membership) =>
        membership.role === "LENDER" &&
        membership.organizationId !== claim.org_id &&
        membership.organizationId !== claim.buyer_org_id,
    )
    .map((membership) => membership.organizationId);
  if (!lenderOrganizations.length)
    throw new ApiError(403, "LENDER_ACCESS_REQUIRED");
  const grant = await tx`SELECT org_id FROM claim_access
    WHERE claim_id=${claim.id} AND org_id IN ${tx(lenderOrganizations)} LIMIT 1`;
  if (!grant.length) throw new ApiError(403, "LENDER_ACCESS_REQUIRED");
  return String(grant[0].org_id);
}
export function versionCheck(claim: ClaimRow, version: number) {
  if (claim.version !== version)
    throw new ApiError(409, "STALE_VERSION", { currentVersion: claim.version });
}
export async function audit(
  sql: DbTransaction,
  actor: Actor,
  action: string,
  target: string,
  correlationId: string,
  details: Record<string, unknown> = {},
  beforeHash?: string,
  afterHash?: string,
  authorizingOrgId?: string | null,
) {
  const organizations = [
    ...new Set(
      actor.memberships.map((membership) => membership.organizationId),
    ),
  ];
  const organizationId =
    authorizingOrgId === undefined
      ? organizations.length === 1
        ? organizations[0]
        : null
      : authorizingOrgId;
  if (
    organizationId &&
    !actor.memberships.some(
      (membership) => membership.organizationId === organizationId,
    )
  )
    throw new ApiError(403, "AUDIT_ORGANIZATION_MISMATCH");
  await sql`INSERT INTO audit_events(id,actor_id,organization_id,action,target,correlation_id,details,before_hash,after_hash) VALUES(${id()},${actor.userId},${organizationId},${action},${target},${correlationId},${sql.json(details as never)},${beforeHash ?? null},${afterHash ?? null})`;
}
export async function rateLimit(key: string, limit = 30) {
  const sql = getSql();
  const rows =
    await sql`INSERT INTO rate_limits(key,count,reset_at) VALUES(${key},1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<now() THEN 1 ELSE rate_limits.count+1 END,reset_at=CASE WHEN rate_limits.reset_at<now() THEN now()+interval '1 minute' ELSE rate_limits.reset_at END RETURNING count`;
  if (rows[0].count > limit) throw new ApiError(429, "RATE_LIMITED");
}
export async function mutate(
  req: Request,
  actor: Actor,
  body: unknown,
  run: (tx: DbTransaction) => Promise<{ status?: number; body: unknown }>,
) {
  const key = req.headers.get("idempotency-key");
  if (!key || key.length > 128)
    throw new ApiError(422, "IDEMPOTENCY_KEY_REQUIRED");
  const scope = `${actor.userId}:${req.method}:${new URL(req.url).pathname}:${key}`,
    bodyHash = hash(canonical(body));
  return getSql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${scope},0))`;
    const old =
      await tx`SELECT * FROM idempotency_records WHERE scope=${scope}`;
    if (old.length) {
      if (old[0].body_hash !== bodyHash)
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
      return json(old[0].response, old[0].status);
    }
    const result = await run(tx);
    await tx`INSERT INTO idempotency_records(scope,body_hash,status,response) VALUES(${scope},${bodyHash},${result.status ?? 200},${tx.json(result.body as never)})`;
    return json(result.body, result.status ?? 200);
  }) as Promise<Response>;
}
