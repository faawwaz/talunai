import { createHmac } from "node:crypto";
import { publicClient } from "../chain/config";
import { z } from "zod";
import { getSql, type DbTransaction } from "../db";
import { quote } from "../domain/finance";
import { POLICY_HASH, evaluatePolicy } from "../domain/policy";
import type { EvidenceState } from "../domain/evidence";
import { GoodsSchema } from "../domain/goods";
import { config } from "./config";
import { requireConsentRevisionSafe } from "./consent-safety";
import { pagination, claimVisibility } from "./read-models";
import {
  ApiError,
  type Actor,
  type ClaimRow,
  assertCurrentAuthorities,
  assertIndependentVerifier,
  authorizingOrganization,
  audit,
  authorizedClaim,
  canonical,
  hasRole,
  hash,
  id,
  json,
  mutate,
  readBody,
  requireRole,
  toChainClaim,
  versionCheck,
} from "./core";
import { validateDocumentEnvelope } from "../agents/documents";
import { documentStorage } from "../agents/storage";
const money = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,77})$/)
  .refine(
    (v) => /^[0-9]{1,78}$/.test(v) && BigInt(v) < 2n ** 256n,
    "UINT256_AMOUNT_REQUIRED",
  );
const createSchema = z
  .object({
    assetType: z.literal("TRADE_RECEIVABLE").default("TRADE_RECEIVABLE"),
    goods: GoodsSchema.optional(),
    organizationId: z.string().min(1).max(100),
    buyerOrganizationId: z.string().min(1).max(100),
    lenderOrganizationId: z.string().min(1).max(100).optional(),
    invoiceNamespace: z.string().min(1).max(60),
    invoiceNumber: z.string().min(1).max(100),
    acceptedOutstanding: money,
    requestedPrincipal: money,
    invoiceDueAt: z.number().int().positive(),
    fundingWindowSeconds: z.number().int().min(60).max(86400).default(86400),
  })
  .strict();
const versionSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
const editable = [
  "DRAFT",
  "NEEDS_REVIEW",
  "READY_FOR_SIGNATURES",
  "READY_FOR_REGISTRATION",
  "PROCESSING_FAILED",
  "REJECTED",
];
const freshEvidence = () => ({
  extractionStatus: "MISSING",
  issuerAuthorityStatus: "ATTESTED",
  buyerAuthorityStatus: "ATTESTED",
  buyerAcknowledgementStatus: "MISSING",
  deliveryEvidenceStatus: "MISSING",
  duplicateCheckStatus: "ATTESTED",
  externalEncumbranceCheckStatus: "NOT_INTEGRATED",
  humanReviewStatus: "MISSING",
});
export function publicClaim(c: ClaimRow) {
  return {
    ...toChainClaim(c),
    assetType: c.asset_type ?? "TRADE_RECEIVABLE",
    goods: c.goods ?? null,
    organizationId: c.org_id,
    organizationName: c.organization_name ?? null,
    buyerOrganizationName: c.buyer_organization_name ?? null,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    buyerOrganizationId: c.buyer_org_id,
    lenderOrganizationId: c.lender_organization_id ?? null,
    invoiceNumber: c.invoice_number,
    invoiceNamespace: c.invoice_namespace,
    evidence: c.evidence,
    isSynthetic: true,
    disclosures: ["SYNTHETIC_DEMO_ONLY", "EXTERNAL_ENCUMBRANCE_NOT_INTEGRATED"],
  };
}
async function walletFor(tx: DbTransaction, org: string, role: string) {
  const rows =
    await tx`SELECT w.address FROM wallets w JOIN memberships m ON m.user_id=w.user_id JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=${org} AND m.role=${role} AND m.approved=true AND o.status='APPROVED' ORDER BY w.address`;
  if (rows.length !== 1)
    throw new ApiError(422, "ORGANIZATION_AUTHORITY_REQUIRES_REVIEW");
  return rows[0].address as `0x${string}`;
}
function validateQuote(outstanding: string, principal: string) {
  const q = quote(outstanding, principal);
  if (
    BigInt(principal) <= 0n ||
    BigInt(outstanding) <= 0n ||
    BigInt(principal) > BigInt(q.advanceCap) ||
    BigInt(principal) > 100000000n ||
    BigInt(q.lenderEntitlement) > BigInt(outstanding)
  )
    throw new ApiError(422, "FINANCING_POLICY_LIMIT");
  return q;
}
async function snapshot(tx: DbTransaction, c: ClaimRow) {
  const s = publicClaim(c);
  await tx`INSERT INTO claim_versions(id,claim_id,version,snapshot,snapshot_hash) VALUES(${id()},${c.id},${c.version},${tx.json(s as never)},${hash(canonical(s))})`;
}
export async function createClaim(
  req: Request,
  actor: Actor,
  correlationId: string,
) {
  const b = createSchema.parse(await readBody(req));
  requireRole(actor, ["BORROWER"], b.organizationId);
  return mutate(req, actor, b, async (tx) => {
    const borrower = await walletFor(tx, b.organizationId, "BORROWER"),
      buyer = await walletFor(tx, b.buyerOrganizationId, "BUYER");
    if (borrower === buyer || b.organizationId === b.buyerOrganizationId)
      throw new ApiError(422, "ACTOR_CONFLICT");
    const invoiceNumber = b.invoiceNumber
        .normalize("NFKC")
        .toUpperCase()
        .replace(/\s+/g, "")
        .trim(),
      namespace = b.invoiceNamespace.normalize("NFKC").toUpperCase().trim();
    if (
      !/^[A-Z0-9/._-]+$/.test(invoiceNumber) ||
      !/^[A-Z0-9/_-]+$/.test(namespace)
    )
      throw new ApiError(422, "INVOICE_IDENTITY_REQUIRES_REVIEW");
    const cfg = config(),
      claimKey = `0x${createHmac("sha256", cfg.CLAIM_ID_HMAC_KEY)
        .update(canonical([b.organizationId, namespace, invoiceNumber]))
        .digest("hex")}`,
      now = Math.floor(Date.now() / 1000);
    const rpc = publicClient();
    let chainNow: number;
    try {
      if ((await rpc.getChainId()) !== cfg.CHAIN_ID)
        throw new Error("RPC_CHAIN_MISMATCH");
      chainNow = Number((await rpc.getBlock()).timestamp);
    } catch {
      throw new ApiError(503, "CHAIN_UNAVAILABLE");
    }
    if (cfg.APP_ENV === "testnet" && Math.abs(now - chainNow) > 120)
      throw new ApiError(503, "RPC_TIMESTAMP_STALE");
    const expiry = Math.min(now, chainNow) + b.fundingWindowSeconds,
      q = validateQuote(b.acceptedOutstanding, b.requestedPrincipal);
    if (expiry <= now || expiry <= chainNow)
      throw new ApiError(409, "FUNDING_WINDOW_EXPIRED_RESET_LOCAL_CHAIN");
    if (b.invoiceDueAt <= expiry)
      throw new ApiError(422, "INVALID_INVOICE_DUE_DATE");
    const terms = {
      borrower,
      buyer,
      token: cfg.MOCK_IDR_ADDRESS.toLowerCase(),
      acceptedOutstanding: b.acceptedOutstanding,
      principal: b.requestedPrincipal,
      fee: q.fixedFee,
      fundingDeadline: expiry,
      invoiceDueAt: b.invoiceDueAt,
      reviewExpiry: expiry,
      consentExpiry: expiry,
      evidenceCommitment: `0x${"0".repeat(64)}`,
      decisionHash: `0x${"0".repeat(64)}`,
      policyHash: POLICY_HASH,
    };
    const claimId = id();
    const rows =
      await tx`INSERT INTO claims(id,org_id,buyer_org_id,claim_key,hmac_key_version,invoice_namespace,invoice_number,terms,evidence,asset_type,goods) VALUES(${claimId},${b.organizationId},${b.buyerOrganizationId},${claimKey},${cfg.CLAIM_ID_HMAC_KEY_VERSION},${namespace},${invoiceNumber},${tx.json(terms)},${tx.json(freshEvidence())},${b.assetType},${b.goods ? tx.json(b.goods) : null}) RETURNING *`;
    if (b.lenderOrganizationId) {
      if (
        [b.organizationId, b.buyerOrganizationId].includes(
          b.lenderOrganizationId,
        )
      )
        throw new ApiError(422, "ACTOR_CONFLICT");
      const lender = await walletFor(tx, b.lenderOrganizationId, "LENDER");
      if ([borrower, buyer].includes(lender))
        throw new ApiError(422, "ACTOR_CONFLICT");
      await tx`INSERT INTO claim_access(claim_id,org_id) VALUES(${claimId},${b.lenderOrganizationId})`;
    }
    const c = rows[0] as ClaimRow;
    c.lender_organization_id = b.lenderOrganizationId ?? null;
    await snapshot(tx, c);
    await audit(
      tx,
      actor,
      "CLAIM_CREATED",
      claimId,
      correlationId,
      {},
      undefined,
      hash(canonical(publicClaim(c))),
      b.organizationId,
    );
    return { status: 201, body: publicClaim(c) };
  });
}
export async function inviteLender(
  req: Request,
  actor: Actor,
  claimId: string,
  correlationId: string,
) {
  const body = z
    .object({ organizationId: z.string().min(1).max(100) })
    .strict()
    .parse(await readBody(req));
  return mutate(req, actor, body, async (tx) => {
    const claim = await authorizedClaim(actor, claimId, tx, true);
    requireRole(actor, ["BORROWER"], claim.org_id);
    if (actor.wallet.toLowerCase() !== claim.terms.borrower.toLowerCase())
      throw new ApiError(403, "BORROWER_ONLY");
    const [existing] = await tx`SELECT org_id FROM claim_access
      WHERE claim_id=${claimId} ORDER BY org_id LIMIT 1`;
    if (existing) {
      if (existing.org_id !== body.organizationId)
        throw new ApiError(409, "LENDER_ALREADY_INVITED");
      return {
        body: {
          claimId,
          lenderOrganizationId: body.organizationId,
          access: "INVITED",
        },
      };
    }
    if (
      ![
        "DRAFT",
        "EXTRACTING",
        "NEEDS_REVIEW",
        "READY_FOR_SIGNATURES",
        "PROCESSING_FAILED",
      ].includes(claim.workflow)
    )
      throw new ApiError(409, "LENDER_INVITATION_CLOSED");
    await requireConsentRevisionSafe(tx, claimId);
    if ([claim.org_id, claim.buyer_org_id].includes(body.organizationId))
      throw new ApiError(422, "ACTOR_CONFLICT");
    const lenderWallet = await walletFor(tx, body.organizationId, "LENDER");
    if (
      [
        claim.terms.borrower.toLowerCase(),
        claim.terms.buyer.toLowerCase(),
      ].includes(lenderWallet.toLowerCase())
    )
      throw new ApiError(422, "ACTOR_CONFLICT");
    await tx`INSERT INTO claim_access(claim_id,org_id)
      VALUES(${claimId},${body.organizationId})`;
    await audit(
      tx,
      actor,
      "LENDER_INVITED",
      claimId,
      correlationId,
      { lenderOrganizationId: body.organizationId },
      undefined,
      undefined,
      claim.org_id,
    );
    return {
      status: 201,
      body: {
        claimId,
        lenderOrganizationId: body.organizationId,
        access: "INVITED",
      },
    };
  });
}
export async function listClaims(req: Request, actor: Actor) {
  const { limit, offset } = pagination(req),
    params = new URL(req.url).searchParams;
  const filters = z
    .object({
      search: z.string().trim().max(120).optional(),
      workflow: z
        .enum([
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
        ])
        .optional(),
    })
    .parse({
      search: params.get("search") ?? undefined,
      workflow: params.get("workflow") ?? undefined,
    });
  const sql = getSql(),
    scope = claimVisibility(actor);
  const pattern = filters.search
    ? `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`
    : null;
  const search = pattern ? sql`c.invoice_number ILIKE ${pattern}` : sql`true`;
  const workflow = filters.workflow
    ? sql`c.workflow=${filters.workflow}`
    : sql`true`;
  const rows =
    await sql`SELECT c.*,o.name AS organization_name,b.name AS buyer_organization_name,(SELECT access.org_id FROM claim_access access WHERE access.claim_id=c.id ORDER BY access.org_id LIMIT 1) AS lender_organization_id FROM claims c JOIN organizations o ON o.id=c.org_id JOIN organizations b ON b.id=c.buyer_org_id WHERE ${scope} AND ${search} AND ${workflow} ORDER BY c.created_at DESC,c.id LIMIT ${limit} OFFSET ${offset}`;
  const [count] =
    await sql`SELECT count(*)::integer AS total FROM claims c WHERE ${scope} AND ${search} AND ${workflow}`;
  return json({
    items: rows.map((r) => publicClaim(r as ClaimRow)),
    limit,
    offset,
    total: count.total,
  });
}

export async function patchClaim(
  req: Request,
  actor: Actor,
  claimId: string,
  correlationId: string,
) {
  const b = z
    .object({
      expectedVersion: z.number().int().positive(),
      goods: GoodsSchema.optional(),
      acceptedOutstanding: money.optional(),
      requestedPrincipal: money.optional(),
      invoiceDueAt: z.number().int().positive().optional(),
      fundingWindowSeconds: z.number().int().min(60).max(86400).optional(),
    })
    .strict()
    .parse(await readBody(req));
  return mutate(req, actor, b, async (tx) => {
    const c = await authorizedClaim(actor, claimId, tx, true);
    requireRole(actor, ["BORROWER"], c.org_id);
    versionCheck(c, b.expectedVersion);
    if (!editable.includes(c.workflow))
      throw new ApiError(409, "CLAIM_IMMUTABLE");
    await requireConsentRevisionSafe(tx, claimId);
    const now = Math.floor(Date.now() / 1000);
    let renewedExpiry: number | undefined;
    if (
      b.fundingWindowSeconds !== undefined ||
      Math.min(
        c.terms.fundingDeadline,
        c.terms.reviewExpiry,
        c.terms.consentExpiry,
      ) <= now
    ) {
      const cfg = config();
      let chainNow: number;
      try {
        const rpc = publicClient();
        if ((await rpc.getChainId()) !== cfg.CHAIN_ID)
          throw new Error("RPC_CHAIN_MISMATCH");
        chainNow = Number((await rpc.getBlock()).timestamp);
      } catch {
        throw new ApiError(503, "CHAIN_UNAVAILABLE");
      }
      if (cfg.APP_ENV === "testnet" && Math.abs(now - chainNow) > 120)
        throw new ApiError(503, "RPC_TIMESTAMP_STALE");
      renewedExpiry =
        Math.min(now, chainNow) + (b.fundingWindowSeconds ?? 86400);
      if (renewedExpiry <= now || renewedExpiry <= chainNow)
        throw new ApiError(409, "FUNDING_WINDOW_EXPIRED_RESET_LOCAL_CHAIN");
    }
    const before = hash(canonical(publicClaim(c))),
      outstanding = b.acceptedOutstanding ?? c.terms.acceptedOutstanding,
      principal = b.requestedPrincipal ?? c.terms.principal,
      q = validateQuote(outstanding, principal),
      terms = {
        ...c.terms,
        acceptedOutstanding: outstanding,
        principal,
        fee: q.fixedFee,
        invoiceDueAt: b.invoiceDueAt ?? c.terms.invoiceDueAt,
        fundingDeadline: renewedExpiry ?? c.terms.fundingDeadline,
        reviewExpiry: renewedExpiry ?? c.terms.reviewExpiry,
        consentExpiry: renewedExpiry ?? c.terms.consentExpiry,
        decisionHash: `0x${"0".repeat(64)}`,
      };
    if (terms.invoiceDueAt <= terms.fundingDeadline)
      throw new ApiError(422, "INVALID_INVOICE_DUE_DATE");
    await tx`UPDATE consent_records SET revoked=true WHERE claim_id=${claimId}`;
    await tx`UPDATE attestations SET revoked_at=now() WHERE claim_id=${claimId} AND revoked_at IS NULL`;
    await tx`UPDATE review_tasks SET status='SUPERSEDED' WHERE claim_id=${claimId} AND status='OPEN'`;
    const rows =
      await tx`UPDATE claims SET version=version+1,terms=${tx.json(terms)},goods=${b.goods ? tx.json(b.goods) : c.goods ? tx.json(c.goods) : null},evidence=${tx.json(freshEvidence())},workflow='DRAFT',updated_at=now() WHERE id=${claimId} RETURNING *`;
    const next = rows[0] as ClaimRow;
    await snapshot(tx, next);
    await audit(
      tx,
      actor,
      "CLAIM_EDITED",
      claimId,
      correlationId,
      {},
      before,
      hash(canonical(publicClaim(next))),
      c.org_id,
    );
    return { body: publicClaim(next) };
  });
}
export async function uploadDocument(
  req: Request,
  actor: Actor,
  claimId: string,
  correlationId: string,
) {
  const cfg = config(),
    length = Number(req.headers.get("content-length") ?? 0);
  if (length > cfg.DOCUMENT_MAX_BYTES + 65536)
    throw new ApiError(413, "DOCUMENT_SIZE_LIMIT");
  // Read a bounded multipart stream before handing it to the native parser.
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(422, "DOCUMENT_REQUIRED");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cfg.DOCUMENT_MAX_BYTES + 65536) {
      await reader.cancel();
      throw new ApiError(413, "DOCUMENT_SIZE_LIMIT");
    }
    chunks.push(value);
  }
  const bounded = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: Buffer.concat(chunks),
  });
  let form: FormData;
  try {
    form = await bounded.formData();
  } catch {
    throw new ApiError(422, "INVALID_MULTIPART");
  }
  const file = form.get("file"),
    version = Number(form.get("expectedVersion")),
    purpose = form.get("purpose") ?? "DEAL";
  if (
    !(file instanceof File) ||
    !Number.isInteger(version) ||
    !["DEAL", "DISPUTE"].includes(String(purpose))
  )
    throw new ApiError(422, "DOCUMENT_REQUIRED");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const c = await authorizedClaim(actor, claimId);
  if (purpose === "DISPUTE") {
    requireRole(actor, ["BUYER"], c.buyer_org_id);
    if (actor.wallet.toLowerCase() !== c.terms.buyer.toLowerCase())
      throw new ApiError(403, "BUYER_ONLY");
    if (["CANCELLED", "REJECTED"].includes(c.workflow))
      throw new ApiError(409, "CLAIM_IMMUTABLE");
  } else requireRole(actor, ["BORROWER"], c.org_id);
  try {
    validateDocumentEnvelope(bytes, file.name, file.type, {
      maxBytes: cfg.DOCUMENT_MAX_BYTES,
      maxPages: cfg.DOCUMENT_MAX_PAGES,
    });
  } catch (e) {
    throw new ApiError(
      422,
      e instanceof Error ? e.message : "DOCUMENT_INVALID",
    );
  }
  const parsed = {
    mime: file.type,
    text: null,
    status: "PENDING_PARSE",
    pages: null,
  };
  const storage = documentStorage();
  const stored = await storage.put(bytes);
  let committed = false;
  try {
    const response = await mutate(
      req,
      actor,
      {
        expectedVersion: version,
        purpose,
        name: file.name,
        mime: file.type,
        sha256: stored.sha256,
      },
      async (tx) => {
        const current = await authorizedClaim(actor, claimId, tx, true);
        versionCheck(current, version);
        if (purpose === "DISPUTE") {
          if (["CANCELLED", "REJECTED"].includes(current.workflow))
            throw new ApiError(409, "CLAIM_IMMUTABLE");
          const docId = id();
          await tx`INSERT INTO documents(id,claim_id,version,purpose,original_name,storage_key,sha256,commitment,mime,byte_size,status,retention_at)
            VALUES(${docId},${claimId},${version},'DISPUTE',${file.name},${stored.storageKey},${stored.sha256},${stored.commitment},${parsed.mime},${bytes.length},'AVAILABLE',now()+interval '30 days')`;
          await audit(
            tx,
            actor,
            "DISPUTE_EVIDENCE_UPLOADED",
            claimId,
            correlationId,
            { documentId: docId, sha256: stored.sha256 },
            undefined,
            undefined,
            current.buyer_org_id,
          );
          committed = true;
          return {
            status: 201,
            body: {
              documentId: docId,
              purpose: "DISPUTE",
              status: "AVAILABLE",
              version,
              sha256: stored.sha256,
              pages: parsed.pages,
            },
          };
        }
        if (!editable.includes(current.workflow))
          throw new ApiError(409, "CLAIM_IMMUTABLE");
        await requireConsentRevisionSafe(tx, claimId);
        const docId = id();
        await tx`INSERT INTO documents(id,claim_id,version,original_name,storage_key,sha256,commitment,mime,byte_size,extracted_text,status,retention_at) VALUES(${docId},${claimId},${version + 1},${file.name},${stored.storageKey},${stored.sha256},${stored.commitment},${parsed.mime},${bytes.length},${parsed.text},${parsed.status},now()+interval '30 days')`;
        const docs =
          await tx`SELECT commitment FROM documents WHERE claim_id=${claimId} AND purpose='DEAL' ORDER BY id`;
        const terms = {
          ...current.terms,
          evidenceCommitment: `0x${hash(canonical(docs.map((d) => d.commitment)))}`,
          decisionHash: `0x${"0".repeat(64)}`,
        };
        const evidence = freshEvidence();
        await tx`UPDATE consent_records SET revoked=true WHERE claim_id=${claimId}`;
        await tx`UPDATE attestations SET revoked_at=now() WHERE claim_id=${claimId} AND revoked_at IS NULL`;
        const rows =
          await tx`UPDATE claims SET version=version+1,workflow='DRAFT',terms=${tx.json(terms)},evidence=${tx.json(evidence)},updated_at=now() WHERE id=${claimId} RETURNING *`;
        await snapshot(tx, rows[0] as ClaimRow);
        await audit(
          tx,
          actor,
          "DOCUMENT_UPLOADED",
          claimId,
          correlationId,
          { documentId: docId, sha256: stored.sha256 },
          undefined,
          undefined,
          current.org_id,
        );
        committed = true;
        return {
          status: 201,
          body: {
            documentId: docId,
            status: parsed.status,
            version: version + 1,
            sha256: stored.sha256,
            pages: parsed.pages,
          },
        };
      },
    );
    if (!committed) await storage.remove(stored.storageKey);
    return response;
  } catch (e) {
    await storage.remove(stored.storageKey);
    throw e;
  }
}
export async function readDocument(actor: Actor, documentId: string) {
  const rows = await getSql()`SELECT * FROM documents WHERE id=${documentId}`;
  if (!rows.length) throw new ApiError(404, "DOCUMENT_NOT_FOUND");
  const doc = rows[0];
  await authorizedClaim(actor, doc.claim_id);
  const bytes = await documentStorage().get(doc.storage_key);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": doc.mime,
      "content-disposition": `attachment; filename="document${doc.mime === "application/pdf" ? ".pdf" : ".txt"}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
export async function analyze(
  req: Request,
  actor: Actor,
  claimId: string,
  correlationId: string,
) {
  const b = versionSchema.parse(await readBody(req));
  return mutate(req, actor, b, async (tx) => {
    const c = await authorizedClaim(actor, claimId, tx, true);
    if (!hasRole(actor, "VERIFIER")) requireRole(actor, ["BORROWER"], c.org_id);
    versionCheck(c, b.expectedVersion);
    if (!editable.includes(c.workflow))
      throw new ApiError(409, "INVALID_WORKFLOW_STATE");
    await requireConsentRevisionSafe(tx, claimId);
    const runId = id(),
      cfg = config();
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
    await tx`INSERT INTO agent_runs(id,claim_id,version,mode,status,stage,input_hash) VALUES(${runId},${claimId},${c.version},${cfg.LLM_MODE},'QUEUED','QUEUED',${hash(canonical(publicClaim(c)))})`;
    await tx`INSERT INTO outbox(id,type,payload) VALUES(${id()},'ANALYZE_CLAIM',${tx.json({ claimId, runId, version: c.version })})`;
    await tx`UPDATE claims SET workflow='EXTRACTING',updated_at=now() WHERE id=${claimId}`;
    await audit(
      tx,
      actor,
      "ANALYSIS_REQUESTED",
      claimId,
      correlationId,
      { runId, mode: cfg.LLM_MODE },
      undefined,
      undefined,
      hasRole(actor, "VERIFIER")
        ? authorizingOrganization(actor, "VERIFIER")
        : c.org_id,
    );
    return {
      status: 202,
      body: { runId, status: "QUEUED", mode: cfg.LLM_MODE },
    };
  });
}
export async function review(
  req: Request,
  actor: Actor,
  claimId: string,
  correlationId: string,
) {
  const b = z
    .object({
      expectedVersion: z.number().int().positive(),
      decision: z.enum(["APPROVE", "REJECT"]),
      reason: z.string().min(5).max(2000),
      evidenceIds: z.array(z.string().uuid()).min(1),
      attestations: z
        .array(
          z.enum([
            "buyerAcknowledgementStatus",
            "deliveryEvidenceStatus",
            "extractionStatus",
          ]),
        )
        .default([]),
      resolvesDispute: z.boolean().optional(),
    })
    .strict()
    .parse(await readBody(req));
  requireRole(actor, ["VERIFIER"]);
  return mutate(req, actor, b, async (tx) => {
    const c = await authorizedClaim(actor, claimId, tx, true);
    versionCheck(c, b.expectedVersion);
    await assertIndependentVerifier(tx, actor, c);
    if (c.terms.reviewExpiry <= Date.now() / 1000)
      throw new ApiError(409, "REVIEW_EXPIRED");
    if (
      c.workflow === "REGISTERED" &&
      b.resolvesDispute === true &&
      b.decision === "APPROVE"
    ) {
      if (!c.has_dispute && !c.funding_hold)
        throw new ApiError(409, "NO_HOLD_OR_DISPUTE");
      const source =
        await tx`SELECT id FROM documents WHERE claim_id=${claimId} AND id IN ${tx(b.evidenceIds)}`;
      if (source.length !== new Set(b.evidenceIds).size)
        throw new ApiError(422, "EVIDENCE_REFERENCE_INVALID");
      const reviewId = id(),
        commitment = hash(
          canonical({
            reviewId,
            claimId,
            version: c.version,
            actor: actor.userId,
            evidenceIds: b.evidenceIds,
            reason: b.reason,
          }),
        );
      await tx`INSERT INTO review_decisions(id,claim_id,version,actor_id,decision,reason,expires_at,snapshot_hash) VALUES(${reviewId},${claimId},${c.version},${actor.userId},'APPROVE',${b.reason},${new Date(c.terms.reviewExpiry * 1000)},${commitment})`;
      await tx`UPDATE attestations SET revoked_at=now() WHERE claim_id=${claimId} AND kind='DISPUTE' AND revoked_at IS NULL`;
      await tx`UPDATE claims SET has_dispute=false,updated_at=now() WHERE id=${claimId}`;
      await audit(
        tx,
        actor,
        "DISPUTE_RESOLVED_BY_REVIEW",
        claimId,
        correlationId,
        {
          reviewId,
          evidenceIds: b.evidenceIds,
          reviewCommitment: `0x${commitment}`,
        },
        undefined,
        undefined,
        authorizingOrganization(actor, "VERIFIER"),
      );
      return {
        body: {
          claimId,
          version: c.version,
          reviewId,
          reviewCommitment: `0x${commitment}`,
          onchainHold: "REQUIRES_VERIFIER_CLEAR_TRANSACTION",
        },
      };
    }
    if (b.resolvesDispute === true && c.workflow !== "REGISTERED") {
      if (b.decision !== "APPROVE" || !c.has_dispute || c.funding_hold)
        throw new ApiError(409, "DISPUTE_RESOLUTION_NOT_READY");
      if (c.workflow === "REGISTRATION_PENDING")
        throw new ApiError(409, "REGISTRATION_CONFIRMATION_REQUIRED");
      const source =
        await tx`SELECT id FROM documents WHERE claim_id=${claimId} AND id IN ${tx(b.evidenceIds)}`;
      if (source.length !== new Set(b.evidenceIds).size)
        throw new ApiError(422, "EVIDENCE_REFERENCE_INVALID");
      const reviewId = id();
      await tx`INSERT INTO review_decisions(id,claim_id,version,actor_id,decision,reason,expires_at,snapshot_hash)
        VALUES(${reviewId},${claimId},${c.version},${actor.userId},'RESOLVE_DISPUTE',${b.reason},${new Date(c.terms.reviewExpiry * 1000)},${hash(canonical({ claimId, version: c.version, reviewId, evidenceIds: b.evidenceIds, reason: b.reason }))})`;
      await tx`UPDATE attestations SET revoked_at=now() WHERE claim_id=${claimId} AND kind='DISPUTE' AND revoked_at IS NULL`;
      await tx`UPDATE claims SET has_dispute=false,updated_at=now() WHERE id=${claimId}`;
      await audit(
        tx,
        actor,
        "PRE_REGISTRATION_DISPUTE_RESOLVED",
        claimId,
        correlationId,
        {
          reviewId,
          evidenceIds: b.evidenceIds,
        },
        undefined,
        undefined,
        authorizingOrganization(actor, "VERIFIER"),
      );
      return {
        body: {
          claimId,
          version: c.version,
          reviewId,
          hasDispute: false,
          workflow: c.workflow,
          nextAction: ["NEEDS_REVIEW", "READY_FOR_SIGNATURES"].includes(
            c.workflow,
          )
            ? "REVIEW_DEAL"
            : "RUN_CHECKS",
          onchainHold: "NOT_REQUIRED_BEFORE_REGISTRATION",
        },
      };
    }
    if (!["NEEDS_REVIEW", "READY_FOR_SIGNATURES"].includes(c.workflow))
      throw new ApiError(409, "ANALYSIS_REQUIRED");
    if (c.has_dispute || c.funding_hold)
      throw new ApiError(409, "HOLD_OR_DISPUTE");
    await requireConsentRevisionSafe(tx, claimId);
    const docs =
      await tx`SELECT id FROM documents WHERE claim_id=${claimId} AND id IN ${tx(b.evidenceIds)}`;
    if (docs.length !== new Set(b.evidenceIds).size)
      throw new ApiError(422, "EVIDENCE_REFERENCE_INVALID");
    const evidence: Record<string, string> = {
      ...c.evidence,
      humanReviewStatus: b.decision === "APPROVE" ? "ATTESTED" : "REJECTED",
    };
    for (const kind of b.attestations) evidence[kind] = "ATTESTED";
    const policies =
      await tx`SELECT result FROM policy_snapshots WHERE claim_id=${claimId} AND version=${c.version} ORDER BY created_at DESC LIMIT 1`;
    if (!policies.length) throw new ApiError(409, "POLICY_REQUIRED");
    const policy = policies[0].result;
    if (
      b.decision === "APPROVE" &&
      (policy.outcome === "REJECTED" ||
        policy.reasonCodes?.includes("MATERIAL_EVIDENCE_CONFLICT") ||
        !["SUPPORTED_BY_DOCUMENT", "ATTESTED"].includes(
          evidence.buyerAcknowledgementStatus,
        ) ||
        !["SUPPORTED_BY_DOCUMENT", "ATTESTED"].includes(
          evidence.deliveryEvidenceStatus,
        ) ||
        !["SUPPORTED_BY_DOCUMENT", "ATTESTED"].includes(
          evidence.extractionStatus,
        ))
    )
      throw new ApiError(422, "EVIDENCE_GATES_UNMET");
    if (b.decision === "APPROVE") {
      await assertCurrentAuthorities(tx, c);
      const independent = evaluatePolicy({
        assetType: c.asset_type,
        goods: c.goods,
        acceptedOutstanding: c.terms.acceptedOutstanding,
        requestedPrincipal: c.terms.principal,
        evidence: evidence as EvidenceState,
        evidenceIds: b.evidenceIds,
        chainId: config().CHAIN_ID,
        supportedToken:
          c.terms.token.toLowerCase() ===
          config().MOCK_IDR_ADDRESS.toLowerCase(),
        hasConflict:
          policy.reasonCodes?.includes("MATERIAL_EVIDENCE_CONFLICT") ?? false,
        knownDuplicate: false,
        alreadyFinanced: false,
        fundingHold: c.funding_hold,
        hasDispute: c.has_dispute,
        now: Math.floor(Date.now() / 1000),
        fundingDeadline: c.terms.fundingDeadline,
        invoiceDueAt: c.terms.invoiceDueAt,
        reviewExpiry: c.terms.reviewExpiry,
        consentExpiry: c.terms.consentExpiry,
      });
      if (independent.outcome !== "ELIGIBLE_FOR_HUMAN_APPROVAL")
        throw new ApiError(422, "EVIDENCE_GATES_UNMET", {
          reasonCodes: independent.reasonCodes,
        });
    }
    const reviewId = id(),
      terms = {
        ...c.terms,
        policyHash: POLICY_HASH,
        decisionHash: `0x${hash(canonical({ policy, policyHash: POLICY_HASH, assetType: c.asset_type, goods: c.goods, reviewId, actor: actor.userId, version: c.version + 1, evidenceIds: b.evidenceIds, decision: b.decision }))}`,
      };
    const rows =
      await tx`UPDATE claims SET version=version+1,terms=${tx.json(terms)},evidence=${tx.json(evidence)},workflow=${b.decision === "APPROVE" ? "READY_FOR_SIGNATURES" : "REJECTED"},updated_at=now() WHERE id=${claimId} RETURNING *`;
    const next = rows[0] as ClaimRow;
    await tx`INSERT INTO review_decisions(id,claim_id,version,actor_id,decision,reason,expires_at,snapshot_hash) VALUES(${reviewId},${claimId},${next.version},${actor.userId},${b.decision},${b.reason},${new Date(c.terms.reviewExpiry * 1000)},${hash(canonical(publicClaim(next)))})`;
    for (const kind of b.attestations)
      await tx`INSERT INTO attestations(id,claim_id,version,actor_id,method,kind,status,evidence_ids,expires_at) VALUES(${id()},${claimId},${next.version},${actor.userId},'SYNTHETIC_HUMAN_REVIEW',${kind},'ATTESTED',${tx.json(b.evidenceIds)},${new Date(c.terms.reviewExpiry * 1000)})`;
    await tx`UPDATE consent_records SET revoked=true WHERE claim_id=${claimId}`;
    await tx`UPDATE review_tasks SET status='RESOLVED' WHERE claim_id=${claimId} AND status='OPEN'`;
    await snapshot(tx, next);
    await audit(
      tx,
      actor,
      "HUMAN_REVIEW",
      claimId,
      correlationId,
      { decision: b.decision, reviewId },
      undefined,
      undefined,
      authorizingOrganization(actor, "VERIFIER"),
    );
    return { body: publicClaim(next) };
  });
}
export async function dispute(
  req: Request,
  actor: Actor,
  claimId: string,
  correlationId: string,
) {
  const b = z
    .object({
      expectedVersion: z.number().int().positive(),
      reason: z.string().min(5).max(2000),
      evidenceId: z.string().uuid(),
    })
    .strict()
    .parse(await readBody(req));
  return mutate(req, actor, b, async (tx) => {
    const c = await authorizedClaim(actor, claimId, tx, true);
    versionCheck(c, b.expectedVersion);
    if (
      !hasRole(actor, "VERIFIER") &&
      !hasRole(actor, "BUYER", c.buyer_org_id) &&
      !hasRole(actor, "BORROWER", c.org_id)
    )
      throw new ApiError(403, "DISPUTE_FORBIDDEN");
    const docs =
      await tx`SELECT id FROM documents WHERE id=${b.evidenceId} AND claim_id=${claimId}`;
    if (!docs.length) throw new ApiError(422, "EVIDENCE_REFERENCE_INVALID");
    const actionId = id();
    await tx`UPDATE claims SET has_dispute=true,updated_at=now() WHERE id=${claimId}`;
    await tx`INSERT INTO attestations(id,claim_id,version,actor_id,method,kind,status,evidence_ids,expires_at) VALUES(${actionId},${claimId},${c.version},${actor.userId},'AUTHENTICATED_DISPUTE','DISPUTE','ATTESTED',${tx.json([b.evidenceId])},${new Date(c.terms.invoiceDueAt * 1000)})`;
    // A pending registration has no onchain object to hold yet. The indexer
    // enqueues the durable hold as soon as registration is canonical.
    const registered = c.workflow === "REGISTERED";
    if (registered)
      await tx`INSERT INTO outbox(id,type,payload) VALUES(${id()},'FUNDING_HOLD',${tx.json({ claimId, version: c.version, evidenceId: b.evidenceId, actionId, reason: b.reason })})`;
    await audit(
      tx,
      actor,
      "DISPUTE_RECORDED",
      claimId,
      correlationId,
      {
        actionId,
        evidenceId: b.evidenceId,
        reason: b.reason,
      },
      undefined,
      undefined,
      hasRole(actor, "BUYER", c.buyer_org_id)
        ? c.buyer_org_id
        : hasRole(actor, "BORROWER", c.org_id)
          ? c.org_id
          : authorizingOrganization(actor, "VERIFIER"),
    );
    return {
      status: 202,
      body: {
        actionId,
        hasDispute: true,
        onchainHold:
          registered || c.workflow === "REGISTRATION_PENDING"
            ? "PENDING"
            : "NOT_REQUIRED_BEFORE_REGISTRATION",
      },
    };
  });
}
