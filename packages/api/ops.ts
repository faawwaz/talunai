import { z } from "zod";
import { getSql } from "../db";
import { config } from "./config";
import {
  ApiError,
  type Actor,
  audit,
  authorizedClaim,
  canonical,
  hash,
  id,
  json,
  mutate,
  readBody,
  requireRole,
  versionCheck,
} from "./core";
import { pagination } from "./read-models";

const runStatuses = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "STALE",
] as const;
const transactionStatuses = [
  "PREPARED",
  "SUBMITTED",
  "MINED",
  "CONFIRMED",
  "REVERTED",
  "REPLACED",
  "DROPPED_OR_UNKNOWN",
] as const;
const transientErrors = [
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TRANSIENT_FAILURE",
  "AGENT_PROVIDER_MODE_MISMATCH",
];
const queueTypes = ["ANALYZE_CLAIM", "FUNDING_HOLD", "RECONCILE_TRANSACTION"];
const operators = (actor: Actor) => requireRole(actor, ["ADMIN", "VERIFIER"]);
type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
const str = (value: unknown) => (typeof value === "string" ? value : null);
const codes = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string").slice(0, 100)
    : [];
const safeCode = (value: unknown) =>
  typeof value === "string"
    ? /^[A-Z][A-Z0-9_]{0,99}$/.test(value)
      ? value
      : "REDACTED_ERROR"
    : null;
const stamp = (value: unknown) =>
  value instanceof Date ? value.toISOString() : str(value);

function stageModel(value: unknown) {
  const r = record(value),
    policy = record(r.policy);
  return {
    provider: str(r.provider),
    model: str(r.model),
    latencyMs:
      typeof r.latencyMs === "number" && Number.isFinite(r.latencyMs)
        ? r.latencyMs
        : null,
    explanation: str(r.explanation),
    reasonCodes: codes(r.reasonCodes ?? policy.reasonCodes),
    evidenceIds: codes(r.evidenceIds ?? r.documentIds),
  };
}
function retryable(row: Row) {
  return (
    row.status === "FAILED" &&
    row.version === row.current_version &&
    row.workflow === "PROCESSING_FAILED" &&
    transientErrors.includes(String(row.error)) &&
    Number(row.retry_count ?? 0) < 3
  );
}
function runModel(r: Row) {
  return {
    id: r.id,
    claimId: r.claim_id,
    version: r.version,
    currentVersion: r.current_version,
    invoiceNumber: r.invoice_number,
    organizationName: r.organization_name,
    mode: r.mode,
    status: r.status,
    stage: r.stage,
    inputHash: r.input_hash,
    ...stageModel(r.result),
    errorCode: safeCode(r.error),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    retryable: retryable(r),
  };
}

/** Operational status reports persisted observations; it never fabricates a live RPC check. */
export async function opsStatus(actor: Actor) {
  operators(actor);
  const sql = getSql(),
    cfg = config(),
    now = Date.now();
  const [[worker], [indexer], queueRows, runRows, [transactions]] =
    await Promise.all([
      sql`SELECT status,updated_at,error_code,provider_mode,provider_model FROM worker_heartbeats WHERE id='worker'`,
      sql`SELECT block_number,block_hash,degraded,updated_at FROM indexer_checkpoints WHERE chain_id=${cfg.CHAIN_ID}`,
      sql`SELECT type,count(*)::integer AS pending,min(created_at) AS oldest FROM outbox WHERE published_at IS NULL GROUP BY type`,
      sql`SELECT status,count(*)::integer AS count FROM agent_runs GROUP BY status`,
      sql`SELECT count(*) FILTER(WHERE status IN ('PREPARED','SUBMITTED','MINED'))::integer AS pending,count(*) FILTER(WHERE status='DROPPED_OR_UNKNOWN')::integer AS unknown,count(*) FILTER(WHERE status='REVERTED')::integer AS reverted FROM transaction_intents`,
    ]);
  const freshness = (row: Row | undefined, degraded: boolean) =>
    !row
      ? "UNAVAILABLE"
      : degraded
        ? "DEGRADED"
        : now - new Date(String(row.updated_at)).getTime() > 120_000
          ? "STALE"
          : "READY";
  const providerMode =
      worker?.provider_mode === "mock" || worker?.provider_mode === "live"
        ? worker.provider_mode
        : null,
    providerModel = str(worker?.provider_model),
    providerConfigMatch =
      providerMode === null
        ? null
        : providerMode === cfg.LLM_MODE &&
          (providerMode !== "live" || providerModel === cfg.OPENROUTER_MODEL),
    workerStatus = freshness(
      worker,
      worker?.status !== "READY" || providerConfigMatch === false,
    ),
    indexerStatus = freshness(indexer, !!indexer?.degraded);
  const queueDates = queueRows
    .map((r) => stamp(r.oldest))
    .filter((v): v is string => v !== null)
    .sort();
  return json({
    observedAt: new Date(now).toISOString(),
    chainId: cfg.CHAIN_ID,
    isSynthetic: true,
    freshnessThresholdSeconds: 120,
    status:
      workerStatus === "READY" && indexerStatus === "READY"
        ? "READY"
        : !worker || !indexer
          ? "UNAVAILABLE"
          : "DEGRADED",
    worker: {
      status: workerStatus,
      updatedAt: stamp(worker?.updated_at),
      errorCode: safeCode(worker?.error_code),
      mode: providerMode,
      model: providerMode === "live" ? providerModel : null,
      configuredMode: cfg.LLM_MODE,
      configurationMatch: providerConfigMatch,
    },
    indexer: {
      status: indexerStatus,
      updatedAt: stamp(indexer?.updated_at),
      blockNumber: indexer ? String(indexer.block_number) : null,
      blockHash: str(indexer?.block_hash),
    },
    queues: {
      source: "POSTGRES_OUTBOX",
      pending: queueRows.reduce((n, r) => n + r.pending, 0),
      oldestPendingAt: queueDates[0] ?? null,
      byType: queueTypes.map((type) => ({
        type,
        pending: queueRows.find((r) => r.type === type)?.pending ?? 0,
      })),
    },
    runs: Object.fromEntries(
      runStatuses.map((status) => [
        status,
        runRows.find((r) => r.status === status)?.count ?? 0,
      ]),
    ),
    transactions,
  });
}

export async function opsRuns(req: Request, actor: Actor) {
  operators(actor);
  const sql = getSql(),
    { limit, offset } = pagination(req);
  const status = z
    .enum(runStatuses)
    .optional()
    .parse(new URL(req.url).searchParams.get("status") ?? undefined);
  const filter = status ? sql`r.status=${status}` : sql`true`;
  const rows =
    await sql`SELECT r.*,c.version AS current_version,c.workflow,c.invoice_number,o.name AS organization_name,(SELECT count(*)::integer FROM audit_events a WHERE a.target=c.id AND a.action='ANALYSIS_RETRY_REQUESTED' AND a.details->>'version'=c.version::text) AS retry_count FROM agent_runs r JOIN claims c ON c.id=r.claim_id JOIN organizations o ON o.id=c.org_id WHERE ${filter} ORDER BY r.created_at DESC,r.id DESC LIMIT ${limit} OFFSET ${offset}`;
  const [count] =
    await sql`SELECT count(*)::integer AS total FROM agent_runs r JOIN claims c ON c.id=r.claim_id WHERE ${filter}`;
  return json({ items: rows.map(runModel), limit, offset, total: count.total });
}
export async function opsRun(actor: Actor, runId: string) {
  operators(actor);
  const sql = getSql();
  const [row] =
    await sql`SELECT r.*,c.version AS current_version,c.workflow,c.invoice_number,o.name AS organization_name,(SELECT count(*)::integer FROM audit_events a WHERE a.target=c.id AND a.action='ANALYSIS_RETRY_REQUESTED' AND a.details->>'version'=c.version::text) AS retry_count FROM agent_runs r JOIN claims c ON c.id=r.claim_id JOIN organizations o ON o.id=c.org_id WHERE r.id=${runId}`;
  if (!row) throw new ApiError(404, "RUN_NOT_FOUND");
  await authorizedClaim(actor, row.claim_id);
  const steps =
    await sql`SELECT id,step,stage,result,created_at FROM agent_steps WHERE run_id=${runId} ORDER BY step,id LIMIT 8`;
  return json({
    ...runModel(row),
    steps: steps.map((s) => ({
      id: s.id,
      step: s.step,
      stage: s.stage,
      createdAt: s.created_at,
      ...stageModel(s.result),
    })),
  });
}

/** Retry is a fresh bounded analysis intent. It cannot approve a claim or sign participant transactions. */
export async function retryOpsRun(
  req: Request,
  actor: Actor,
  runId: string,
  correlationId: string,
) {
  operators(actor);
  const body = z
    .object({ expectedVersion: z.number().int().positive() })
    .strict()
    .parse(await readBody(req));
  return mutate(req, actor, body, async (tx) => {
    // Match worker lock order: run, then claim. Supersede the source so a queued
    // automatic retry cannot perform this same version again after the manual retry.
    const [run] =
      await tx`SELECT * FROM agent_runs WHERE id=${runId} FOR UPDATE`;
    if (!run) throw new ApiError(404, "RUN_NOT_FOUND");
    const claim = await authorizedClaim(actor, run.claim_id, tx, true);
    versionCheck(claim, body.expectedVersion);
    if (
      run.version !== claim.version ||
      claim.workflow !== "PROCESSING_FAILED" ||
      run.status !== "FAILED" ||
      !transientErrors.includes(run.error)
    )
      throw new ApiError(409, "RUN_NOT_RETRYABLE");
    const [count] =
      await tx`SELECT count(*)::integer AS total FROM audit_events WHERE target=${claim.id} AND action='ANALYSIS_RETRY_REQUESTED' AND details->>'version'=${String(claim.version)}`;
    if (count.total >= 3) throw new ApiError(409, "RETRY_LIMIT_REACHED");
    const cfg = config();
    const [worker] =
      await tx`SELECT status,provider_mode,provider_model,updated_at FROM worker_heartbeats WHERE id='worker'`;
    if (
      worker?.status === "READY" &&
      Date.now() - new Date(worker.updated_at).getTime() <= 120_000 &&
      worker.provider_mode &&
      (worker.provider_mode !== cfg.LLM_MODE ||
        (cfg.LLM_MODE === "live" &&
          worker.provider_model !== cfg.OPENROUTER_MODEL))
    )
      throw new ApiError(503, "AGENT_PROVIDER_CONFIGURATION_MISMATCH");
    const nextRun = id(),
      mode = cfg.LLM_MODE;
    await tx`UPDATE agent_runs SET status='STALE',stage='SUPERSEDED_BY_RETRY',updated_at=now() WHERE id=${runId}`;
    await tx`INSERT INTO agent_runs(id,claim_id,version,mode,status,stage,input_hash) VALUES(${nextRun},${claim.id},${claim.version},${mode},'QUEUED','QUEUED',${hash(canonical({ claimId: claim.id, version: claim.version, terms: claim.terms, goods: claim.goods }))})`;
    await tx`INSERT INTO outbox(id,type,payload) VALUES(${id()},'ANALYZE_CLAIM',${tx.json({ claimId: claim.id, version: claim.version, runId: nextRun })})`;
    await tx`UPDATE claims SET workflow='EXTRACTING',updated_at=now() WHERE id=${claim.id}`;
    await audit(
      tx,
      actor,
      "ANALYSIS_RETRY_REQUESTED",
      claim.id,
      correlationId,
      { version: claim.version, retriesRunId: runId, runId: nextRun, mode },
    );
    return {
      status: 202,
      body: { runId: nextRun, status: "QUEUED", mode, retriesRunId: runId },
    };
  });
}

export async function opsTransactions(req: Request, actor: Actor) {
  operators(actor);
  const sql = getSql(),
    { limit, offset } = pagination(req);
  const status = z
    .enum(transactionStatuses)
    .optional()
    .parse(new URL(req.url).searchParams.get("status") ?? undefined);
  const filter = status ? sql`t.status=${status}` : sql`true`;
  const rows =
    await sql`SELECT t.id,t.claim_id,t.sender,t.action,t.status,t.tx_hash,t.replaces_id,t.created_at,t.updated_at,c.invoice_number,o.name AS organization_name FROM transaction_intents t JOIN claims c ON c.id=t.claim_id JOIN organizations o ON o.id=c.org_id WHERE ${filter} ORDER BY t.created_at DESC,t.id DESC LIMIT ${limit} OFFSET ${offset}`;
  const [count] =
    await sql`SELECT count(*)::integer AS total FROM transaction_intents t JOIN claims c ON c.id=t.claim_id WHERE ${filter}`;
  return json({
    items: rows.map((r) => ({
      id: r.id,
      claimId: r.claim_id,
      invoiceNumber: r.invoice_number,
      organizationName: r.organization_name,
      sender: r.sender,
      action: r.action,
      status: r.status,
      txHash: r.tx_hash,
      replacesIntentId: r.replaces_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    limit,
    offset,
    total: count.total,
  });
}

export async function opsOrganizations(req: Request, actor: Actor) {
  requireRole(actor, ["ADMIN"]);
  const sql = getSql(),
    { limit, offset } = pagination(req);
  const status = z
    .enum(["APPROVED", "PENDING", "REJECTED", "REVOKED"])
    .optional()
    .parse(new URL(req.url).searchParams.get("status") ?? undefined);
  const filter = status ? sql`o.status=${status}` : sql`true`;
  const rows =
    await sql`SELECT o.id,o.name,o.kind,o.status,o.synthetic FROM organizations o WHERE ${filter} ORDER BY o.name,o.id LIMIT ${limit} OFFSET ${offset}`;
  const [count] =
    await sql`SELECT count(*)::integer AS total FROM organizations o WHERE ${filter}`;
  const members = rows.length
    ? await sql`SELECT m.id,m.organization_id,m.user_id,m.role,m.approved,COALESCE(jsonb_agg(w.address ORDER BY w.address) FILTER(WHERE w.address IS NOT NULL),'[]'::jsonb) AS wallets FROM memberships m LEFT JOIN wallets w ON w.user_id=m.user_id WHERE m.organization_id IN ${sql(rows.map((r) => r.id))} GROUP BY m.id,m.organization_id,m.user_id,m.role,m.approved ORDER BY m.role,m.id`
    : [];
  return json({
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      status: r.status,
      isSynthetic: r.synthetic,
      memberships: members
        .filter((m) => m.organization_id === r.id)
        .map((m) => ({
          id: m.id,
          userId: m.user_id,
          role: m.role,
          approved: m.approved,
          wallets: m.wallets,
        })),
    })),
    limit,
    offset,
    total: count.total,
  });
}

export async function opsAudit(req: Request, actor: Actor) {
  requireRole(actor, ["ADMIN"]);
  const sql = getSql(),
    { limit, offset } = pagination(req);
  const action = z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,99}$/)
    .optional()
    .parse(new URL(req.url).searchParams.get("action") ?? undefined);
  const filter = action ? sql`action=${action}` : sql`true`;
  const rows =
    await sql`SELECT id,actor_id,organization_id,action,target,before_hash,after_hash,correlation_id,created_at FROM audit_events WHERE ${filter} ORDER BY created_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}`;
  const [count] =
    await sql`SELECT count(*)::integer AS total FROM audit_events WHERE ${filter}`;
  return json({
    items: rows.map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      organizationId: r.organization_id,
      action: r.action,
      target: r.target,
      beforeHash: r.before_hash,
      afterHash: r.after_hash,
      correlationId: r.correlation_id,
      createdAt: r.created_at,
    })),
    limit,
    offset,
    total: count.total,
    integrityDisclosure:
      "Application append-only; database administrator can rewrite history.",
  });
}
