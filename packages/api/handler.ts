import { getSql } from "../db";
import { publicClient } from "../chain/config";
import { quote } from "../domain/finance";
import { config } from "./config";
import {
  assertReadyState,
  type ReadinessCheckpoint,
  type ReadinessHeartbeat,
} from "./readiness";
import { authenticate, challenge, logout, verify } from "./auth";
import { ApiError, authorizedClaim, failure, id, json } from "./core";
import {
  analyze,
  createClaim,
  dispute,
  inviteLender,
  listClaims,
  patchClaim,
  publicClaim,
  readDocument,
  review,
  uploadDocument,
} from "./claims";
import {
  consentPrepare,
  consentSubmit,
  financing,
  observe,
  observeReplacement,
  prepareAction,
} from "./actions";
import { openApi } from "./openapi";
import { actionInbox } from "./action-inbox";
import {
  readPoolCandidate,
  readPoolEventFeed,
  readPoolExplore,
} from "../pool/read";
import {
  opsStatus,
  opsRuns,
  opsRun,
  retryOpsRun,
  opsTransactions,
  opsOrganizations,
  opsAudit,
} from "./ops";
import {
  createAccessRequest,
  getAccessRequest,
  listAccessRequests,
  listAccessOrganizations,
  reviewAccessRequestApi,
  createSyntheticOrganizationApi,
  lenderReadiness,
} from "./onboarding";
import {
  currentUser,
  approvedOrganizations,
  documentMetadata,
  agentRuns,
  agentRun,
  transactionIntents,
  actorReviewTasks,
  marketDeals,
} from "./read-models";
export async function handleRequest(req: Request): Promise<Response> {
  const correlationId = id();
  try {
    const path = new URL(req.url).pathname.replace(/\/$/, ""),
      method = req.method;
    if (path === "/health/live" && method === "GET")
      return json({ status: "alive" });
    if (path === "/health/ready" && method === "GET") {
      try {
        const c = config();
        const rpc = publicClient();
        const [observedChainId, head, checkpoints, heartbeats] =
          await Promise.all([
            rpc.getChainId(),
            rpc.getBlockNumber({ cacheTime: 0 }),
            getSql()`SELECT block_number,degraded,updated_at FROM indexer_checkpoints WHERE chain_id=${c.CHAIN_ID}`,
            getSql()`SELECT status,updated_at FROM worker_heartbeats WHERE id='worker'`,
          ]);
        assertReadyState({
          configuredChainId: c.CHAIN_ID,
          observedChainId,
          head,
          checkpoint: checkpoints[0] as ReadinessCheckpoint | undefined,
          worker: heartbeats[0] as ReadinessHeartbeat | undefined,
          now: Date.now(),
        });
        return json({ status: "ready" });
      } catch {
        return json({ status: "unavailable" }, 503);
      }
    }
    if (path === "/v1/openapi" && method === "GET") return json(openApi);
    if (path === "/v1/explore" && method === "GET") {
      const params = new URL(req.url).searchParams;
      const wallet = params.get("wallet") ?? undefined;
      if (wallet && !/^0x[0-9a-fA-F]{40}$/.test(wallet))
        throw new ApiError(400, "INVALID_WALLET");
      return json(await readPoolExplore(wallet, params.get("events") !== "0"));
    }
    if (path === "/v1/explore/events" && method === "GET")
      return json(await readPoolEventFeed());
    if (path === "/v1/explore/candidate" && method === "GET") {
      const key = new URL(req.url).searchParams.get("key") ?? "";
      if (!/^0x[0-9a-fA-F]{64}$/.test(key))
        throw new ApiError(400, "INVALID_CLAIM_KEY");
      return json(await readPoolCandidate(key));
    }
    if (path === "/v1/config" && method === "GET") {
      const c = config();
      return json({
        chainId: c.CHAIN_ID,
        appEnv: c.APP_ENV,
        appOrigin: c.APP_ORIGIN,
        contracts: {
          registry: c.CONTRACT_REGISTRY_ADDRESS,
          vault: c.CONTRACT_VAULT_ADDRESS,
          agentExecutor: c.CONTRACT_AGENT_EXECUTOR_ADDRESS,
          token: c.MOCK_IDR_ADDRESS,
        },
        paymentToken: { symbol: "MockIDR", decimals: 0 },
        isSynthetic: true,
        llmMode: c.LLM_MODE,
        confirmations: c.CHAIN_CONFIRMATIONS,
        accountTypes: ["EOA"],
        disclosures: [
          "SYNTHETIC_NO_VALUE",
          "NOT_LEGAL_RWA_TITLE",
          "NO_CALIBRATED_CREDIT_MODEL",
          "NOT_AUDITED",
          "EXTERNAL_ENCUMBRANCE_NOT_INTEGRATED",
        ],
      });
    }
    if (path === "/v1/auth/challenge" && method === "POST")
      return await challenge(req);
    if (path === "/v1/auth/verify" && method === "POST")
      return await verify(req);
    const actor = await authenticate(req);
    if (path === "/v1/auth/logout" && method === "POST")
      return await logout(req, actor);
    if (path === "/v1/me" && method === "GET") return await currentUser(actor);
    if (path === "/v1/actions/inbox" && method === "GET")
      return await actionInbox(req, actor);
    if (path === "/v1/lender/readiness" && method === "GET")
      return await lenderReadiness(actor);
    if (path === "/v1/market/deals" && method === "GET")
      return await marketDeals(req, actor);
    if (path === "/v1/ops/status" && method === "GET")
      return await opsStatus(actor);
    if (path === "/v1/ops/agent-runs" && method === "GET")
      return await opsRuns(req, actor);
    if (path === "/v1/ops/transactions" && method === "GET")
      return await opsTransactions(req, actor);
    if (path === "/v1/ops/organizations" && method === "GET")
      return await opsOrganizations(req, actor);
    if (path === "/v1/ops/audit" && method === "GET")
      return await opsAudit(req, actor);
    const opsRunMatch = path.match(
      /^\/v1\/ops\/agent-runs\/([0-9a-f-]+)(\/retry)?$/,
    );
    if (opsRunMatch && !opsRunMatch[2] && method === "GET")
      return await opsRun(actor, opsRunMatch[1]);
    if (opsRunMatch?.[2] && method === "POST")
      return await retryOpsRun(req, actor, opsRunMatch[1], correlationId);
    if (path === "/v1/access-request" && method === "GET")
      return await getAccessRequest(actor);
    if (path === "/v1/access-request" && method === "POST")
      return await createAccessRequest(req, actor, correlationId);
    if (path === "/v1/access-requests" && method === "GET")
      return await listAccessRequests(req, actor);
    if (path === "/v1/access-organizations" && method === "GET")
      return await listAccessOrganizations(req, actor);
    if (path === "/v1/organizations/demo" && method === "POST")
      return await createSyntheticOrganizationApi(req, actor);
    const accessReview = path.match(
      /^\/v1\/access-requests\/([0-9a-f-]+)\/review$/,
    );
    if (accessReview && method === "POST")
      return await reviewAccessRequestApi(req, actor, accessReview[1]);
    if (path === "/v1/organizations" && method === "GET")
      return await approvedOrganizations(req, actor);
    if (path === "/v1/agent-runs" && method === "GET")
      return await agentRuns(req, actor);
    if (path === "/v1/claims" && method === "POST")
      return await createClaim(req, actor, correlationId);
    if (path === "/v1/claims" && method === "GET")
      return await listClaims(req, actor);
    if (path === "/v1/transactions/observe" && method === "POST")
      return await observe(req, actor, correlationId);
    const replacement = path.match(
      /^\/v1\/transactions\/([0-9a-f-]+)\/replacement$/,
    );
    if (replacement && method === "POST")
      return await observeReplacement(
        req,
        actor,
        replacement[1],
        correlationId,
      );
    const document = path.match(/^\/v1\/documents\/([0-9a-f-]+)$/);
    if (document && method === "GET")
      return await readDocument(actor, document[1]);
    const run = path.match(/^\/v1\/agent-runs\/([0-9a-f-]+)$/);
    if (run && method === "GET") return await agentRun(actor, run[1]);
    if (path === "/v1/review-tasks" && method === "GET")
      return await actorReviewTasks(req, actor);
    const match = path.match(/^\/v1\/claims\/([0-9a-f-]+)(?:\/(.+))?$/);
    if (match) {
      const claimId = match[1],
        suffix = match[2] ?? "";
      if (!suffix && method === "GET")
        return json(publicClaim(await authorizedClaim(actor, claimId)));
      if (!suffix && method === "PATCH")
        return await patchClaim(req, actor, claimId, correlationId);
      if (suffix === "lenders" && method === "POST")
        return await inviteLender(req, actor, claimId, correlationId);
      if (suffix === "agent-runs" && method === "GET")
        return await agentRuns(req, actor, claimId);
      if (suffix === "transactions" && method === "GET")
        return await transactionIntents(req, actor, claimId);
      if (suffix === "documents" && method === "POST")
        return await uploadDocument(req, actor, claimId, correlationId);
      if (suffix === "analyze" && method === "POST")
        return await analyze(req, actor, claimId, correlationId);
      if (suffix === "review" && method === "POST")
        return await review(req, actor, claimId, correlationId);
      if (suffix === "disputes" && method === "POST")
        return await dispute(req, actor, claimId, correlationId);
      if (suffix === "consents/prepare" && method === "POST")
        return await consentPrepare(req, actor, claimId);
      if (suffix === "consents" && method === "POST")
        return await consentSubmit(req, actor, claimId, correlationId);
      if (suffix === "actions/prepare" && method === "POST")
        return await prepareAction(req, actor, claimId, correlationId);
      if (suffix === "financing" && method === "GET")
        return await financing(actor, claimId);
      if (suffix === "evidence" && method === "GET") {
        const c = await authorizedClaim(actor, claimId),
          sql = getSql();
        const docs =
          await sql`SELECT id,version,purpose,original_name,mime,byte_size,status,created_at,retention_at FROM documents WHERE claim_id=${claimId} ORDER BY created_at`;
        const policies =
          await sql`SELECT result FROM policy_snapshots WHERE claim_id=${claimId} ORDER BY created_at DESC LIMIT 1`;
        const attestations =
          await sql`SELECT id,version,actor_id,method,kind,status,evidence_ids,expires_at,revoked_at,created_at FROM attestations WHERE claim_id=${claimId} ORDER BY created_at`;
        const consents =
          await sql`SELECT cr.role,cr.version,cr.signer,cr.nonce,cr.deadline,cr.terms_hash,cr.revoked,ce.tx_hash AS invalidation_hash,ce.block_number AS invalidation_block,ce.block_hash AS invalidation_block_hash FROM consent_records cr LEFT JOIN LATERAL (SELECT tx_hash,block_number,block_hash FROM chain_events WHERE chain_id=${config().CHAIN_ID} AND contract_address=${config().CONTRACT_REGISTRY_ADDRESS.toLowerCase()} AND canonical=true AND event_name='ConsentNonceInvalidated' AND lower(args->>'signer')=lower(cr.signer) AND args->>'nonce'=cr.nonce ORDER BY block_number DESC,log_index DESC LIMIT 1) ce ON true WHERE cr.claim_id=${claimId} ORDER BY cr.version DESC,cr.role`;
        const extractedFields =
          await sql`SELECT id,version,fields FROM extracted_fields WHERE claim_id=${claimId} ORDER BY version DESC,id DESC LIMIT 20`;
        const [review] =
          await sql`SELECT id,version,actor_id,decision,reason,expires_at,created_at FROM review_decisions WHERE claim_id=${claimId} ORDER BY created_at DESC,id DESC LIMIT 1`;
        return json({
          claimId,
          version: c.version,
          evidence: c.evidence,
          documents: docs.map(documentMetadata),
          extractedFields,
          consents: consents.map((record) => ({
            role: record.role,
            version: record.version,
            signer: record.signer,
            nonce: record.nonce,
            deadline: record.deadline,
            termsHash: record.terms_hash,
            revoked: record.revoked,
            onchainInvalidation: record.invalidation_hash
              ? {
                  txHash: record.invalidation_hash,
                  blockNumber: String(record.invalidation_block),
                  blockHash: record.invalidation_block_hash,
                }
              : null,
            stateConfidence: "RECORDED_OFFCHAIN",
          })),
          review: review
            ? {
                id: review.id,
                version: review.version,
                actorId: review.actor_id,
                decision: review.decision,
                reason: review.reason,
                expiresAt: review.expires_at,
                createdAt: review.created_at,
              }
            : null,
          attestations,
          policy: policies[0]?.result ?? null,
        });
      }
      if (suffix === "offer" && method === "GET") {
        const c = await authorizedClaim(actor, claimId);
        return json({
          claimId,
          version: c.version,
          ...quote(c.terms.acceptedOutstanding, c.terms.principal),
          fundingDeadline: c.terms.fundingDeadline,
          invoiceDueAt: c.terms.invoiceDueAt,
          reviewExpiry: c.terms.reviewExpiry,
          consentExpiry: c.terms.consentExpiry,
          terms: c.terms,
          disclosures: [
            "SIMULATION_ONLY",
            "FLAT_FEE_NOT_APR",
            "NO_RETURN_GUARANTEE",
          ],
          eligibleIsNotApproval: true,
        });
      }
      if (suffix === "audit" && method === "GET") {
        await authorizedClaim(actor, claimId);
        const u = new URL(req.url),
          limit = Math.min(
            100,
            Math.max(1, Number(u.searchParams.get("limit") ?? 20)),
          ),
          offset = Math.max(0, Number(u.searchParams.get("offset") ?? 0));
        if (!Number.isInteger(limit) || !Number.isInteger(offset))
          throw new ApiError(422, "INVALID_PAGINATION");
        const rows =
          await getSql()`SELECT * FROM audit_events WHERE target=${claimId} ORDER BY created_at,id LIMIT ${limit} OFFSET ${offset}`;
        return json({
          items: rows,
          limit,
          offset,
          integrityDisclosure:
            "Application append-only; database administrator can rewrite history.",
        });
      }
    }
    throw new ApiError(404, "NOT_FOUND");
  } catch (e) {
    return failure(e, correlationId);
  }
}
