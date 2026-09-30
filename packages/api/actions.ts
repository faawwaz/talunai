import { z } from "zod";
import { getSql, type DbTransaction } from "../db";
import { chainService, termsHash } from "../chain/service";
import { goodsPolicyReasons } from "../domain/goods";
import { POLICY_HASH } from "../domain/policy";
import { config } from "./config";
import { activeConsentAttempts } from "./consent-safety";
import { actionNames, type ChainPort, type ConsentRecord } from "./chain-port";
import {
  ApiError,
  type Actor,
  assertCurrentAuthorities,
  assertIndependentVerifier,
  assertGrantedLender,
  authorizingOrganization,
  audit,
  authorizedClaim,
  hasRole,
  id,
  json,
  mutate,
  readBody,
  requireRole,
  toChainClaim,
  versionCheck,
} from "./core";
let chain: ChainPort = chainService;
/** Explicit injection for integration harnesses; production defaults to the real viem adapter. */
export function setChainPortForTests(port: ChainPort) {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY");
  chain = port;
}
const nonce = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,77})$/)
  .refine(
    (v) => /^[0-9]{1,78}$/.test(v) && BigInt(v) < 2n ** 256n,
    "UINT256_REQUIRED",
  );
const consentSchema = z.object({
  expectedVersion: z.number().int().positive(),
  role: z.enum(["BORROWER", "BUYER"]),
  nonce,
});
const hex = z.string().regex(/^0x[0-9a-fA-F]{130}$/);
function signerRole(
  actor: Actor,
  c: Awaited<ReturnType<typeof authorizedClaim>>,
  role: "BORROWER" | "BUYER",
) {
  requireRole(actor, [role], role === "BORROWER" ? c.org_id : c.buyer_org_id);
  if (
    actor.wallet.toLowerCase() !==
    (role === "BORROWER" ? c.terms.borrower : c.terms.buyer).toLowerCase()
  )
    throw new ApiError(403, "CONSENT_SIGNER_MISMATCH");
}
async function requireConsentReview(
  tx: DbTransaction,
  c: Awaited<ReturnType<typeof authorizedClaim>>,
) {
  const reviews =
    await tx`SELECT id FROM review_decisions WHERE claim_id=${c.id} AND version=${c.version} AND decision='APPROVE' AND expires_at>now() LIMIT 1`;
  if (
    !reviews.length ||
    c.evidence.humanReviewStatus !== "ATTESTED" ||
    c.terms.policyHash !== POLICY_HASH
  )
    throw new ApiError(409, "CURRENT_REVIEW_REQUIRED");
}
async function requireLenderInvitation(tx: DbTransaction, claimId: string) {
  const [grant] =
    await tx`SELECT 1 FROM claim_access WHERE claim_id=${claimId} LIMIT 1`;
  if (!grant) throw new ApiError(409, "LENDER_INVITATION_REQUIRED");
}
async function wrapChain<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const message = e instanceof Error ? e.message : "";
    if (
      /RPC_|DEPLOYMENT_|CONFIG|fetch|timed? ?out|HTTP request failed/i.test(
        message,
      )
    )
      throw new ApiError(503, "CHAIN_UNAVAILABLE");
    throw new ApiError(409, "CHAIN_VALIDATION_FAILED");
  }
}
export async function consentPrepare(
  req: Request,
  actor: Actor,
  claimId: string,
) {
  const b = consentSchema.strict().parse(await readBody(req));
  return mutate(req, actor, b, async (tx) => {
    const c = await authorizedClaim(actor, claimId, tx, true);
    versionCheck(c, b.expectedVersion);
    signerRole(actor, c, b.role);
    if (
      c.workflow !== "READY_FOR_SIGNATURES" &&
      c.workflow !== "READY_FOR_REGISTRATION"
    )
      throw new ApiError(409, "CONSENT_NOT_READY");
    if (c.has_dispute || c.funding_hold)
      throw new ApiError(409, "HOLD_OR_DISPUTE");
    await requireLenderInvitation(tx, claimId);
    await requireConsentReview(tx, c);
    const active = await activeConsentAttempts(tx, claimId, c.version, b.role);
    if (active.some((attempt) => attempt.nonce !== b.nonce))
      throw new ApiError(409, "CONSENT_REVOCATION_REQUIRED", {
        pendingConsents: active.map(({ role, nonce, deadline }) => ({
          role,
          nonce,
          deadline,
        })),
      });
    const typedData = await wrapChain(() =>
      chain.prepareConsent({
        claim: toChainClaim(c),
        role: b.role,
        signer: actor.wallet,
        nonce: b.nonce,
        deadline: c.terms.consentExpiry,
      }),
    );
    const cfg = config();
    const expectedTermsHash = termsHash(toChainClaim(c));
    await tx`INSERT INTO consent_issuances(id,claim_id,version,role,signer,nonce,deadline,terms_hash,chain_id,registry_address)
      VALUES(${id()},${claimId},${c.version},${b.role},${actor.wallet.toLowerCase()},${b.nonce},${c.terms.consentExpiry},${expectedTermsHash},${cfg.CHAIN_ID},${cfg.CONTRACT_REGISTRY_ADDRESS.toLowerCase()})
      ON CONFLICT DO NOTHING`;
    const [issued] =
      await tx`SELECT claim_id,version,role,deadline,terms_hash FROM consent_issuances
      WHERE chain_id=${cfg.CHAIN_ID} AND registry_address=${cfg.CONTRACT_REGISTRY_ADDRESS.toLowerCase()}
        AND signer=${actor.wallet.toLowerCase()} AND nonce=${b.nonce}`;
    if (
      !issued ||
      issued.claim_id !== claimId ||
      issued.version !== c.version ||
      issued.role !== b.role ||
      issued.deadline !== c.terms.consentExpiry ||
      issued.terms_hash !== expectedTermsHash
    )
      throw new ApiError(409, "CONSENT_NONCE_ALREADY_ISSUED");
    return { body: { claimId, version: c.version, role: b.role, typedData } };
  });
}
export async function consentSubmit(
  req: Request,
  actor: Actor,
  claimId: string,
  correlationId: string,
) {
  const b = consentSchema
    .extend({ signature: hex })
    .strict()
    .parse(await readBody(req));
  return mutate(req, actor, b, async (tx) => {
    const c = await authorizedClaim(actor, claimId, tx, true);
    versionCheck(c, b.expectedVersion);
    signerRole(actor, c, b.role);
    if (
      !["READY_FOR_SIGNATURES", "READY_FOR_REGISTRATION"].includes(c.workflow)
    )
      throw new ApiError(409, "CONSENT_NOT_READY");
    if (c.has_dispute || c.funding_hold)
      throw new ApiError(409, "HOLD_OR_DISPUTE");
    await requireLenderInvitation(tx, claimId);
    await requireConsentReview(tx, c);
    const verified = await wrapChain(() =>
      chain.verifyConsent({
        claim: toChainClaim(c),
        role: b.role,
        signer: actor.wallet,
        nonce: b.nonce,
        deadline: c.terms.consentExpiry,
        signature: b.signature as `0x${string}`,
      }),
    );
    if (!verified.valid) throw new ApiError(422, "CONSENT_SIGNATURE_INVALID");
    const cfg = config();
    const [issued] = await tx`SELECT id FROM consent_issuances
      WHERE claim_id=${claimId} AND version=${c.version} AND role=${b.role}
        AND signer=${actor.wallet.toLowerCase()} AND nonce=${b.nonce}
        AND deadline=${c.terms.consentExpiry} AND terms_hash=${verified.termsHash}
        AND chain_id=${cfg.CHAIN_ID} AND registry_address=${cfg.CONTRACT_REGISTRY_ADDRESS.toLowerCase()}`;
    if (!issued) throw new ApiError(409, "CONSENT_ISSUANCE_REQUIRED");
    const [selected] =
      await tx`SELECT id,signer,nonce,deadline,signature,terms_hash FROM consent_records
      WHERE claim_id=${claimId} AND version=${c.version} AND role=${b.role} AND revoked=false`;
    if (selected) {
      if (
        selected.signer.toLowerCase() !== actor.wallet.toLowerCase() ||
        selected.nonce !== b.nonce ||
        selected.signature.toLowerCase() !== b.signature.toLowerCase() ||
        selected.deadline !== c.terms.consentExpiry ||
        selected.terms_hash !== verified.termsHash
      ) {
        const active = await activeConsentAttempts(
          tx,
          claimId,
          c.version,
          b.role,
        );
        if (active.some((attempt) => attempt.nonce === selected.nonce))
          throw new ApiError(409, "CONSENT_REVOCATION_REQUIRED", {
            pendingConsents: active.map(({ role, nonce, deadline }) => ({
              role,
              nonce,
              deadline,
            })),
          });
        await tx`UPDATE consent_records SET revoked=true WHERE id=${selected.id}`;
        await tx`INSERT INTO consent_records(id,claim_id,version,role,signer,nonce,deadline,signature,terms_hash)
          VALUES(${id()},${claimId},${c.version},${b.role},${actor.wallet.toLowerCase()},${b.nonce},${c.terms.consentExpiry},${b.signature},${verified.termsHash})`;
      }
    } else {
      await tx`INSERT INTO consent_records(id,claim_id,version,role,signer,nonce,deadline,signature,terms_hash)
        VALUES(${id()},${claimId},${c.version},${b.role},${actor.wallet.toLowerCase()},${b.nonce},${c.terms.consentExpiry},${b.signature},${verified.termsHash})`;
    }
    const consents =
      await tx`SELECT role FROM consent_records WHERE claim_id=${claimId} AND version=${c.version} AND revoked=false`;
    const state =
      consents.length === 2 ? "READY_FOR_REGISTRATION" : "READY_FOR_SIGNATURES";
    await tx`UPDATE claims SET workflow=${state},updated_at=now() WHERE id=${claimId}`;
    await audit(
      tx,
      actor,
      "CONSENT_RECORDED",
      claimId,
      correlationId,
      { role: b.role, version: c.version, termsHash: verified.termsHash },
      undefined,
      undefined,
      b.role === "BORROWER" ? c.org_id : c.buyer_org_id,
    );
    return {
      body: {
        claimId,
        version: c.version,
        workflow: state,
        consentRole: b.role,
        termsHash: verified.termsHash,
      },
    };
  });
}
export async function prepareAction(
  req: Request,
  actor: Actor,
  claimId: string,
  correlationId: string,
) {
  const b = z
    .object({
      expectedVersion: z.number().int().positive(),
      action: z.enum(actionNames),
      amount: nonce.optional(),
      nonce: nonce.optional(),
    })
    .strict()
    .parse(await readBody(req));
  return mutate(req, actor, b, async (tx) => {
    const c = await authorizedClaim(actor, claimId, tx, true);
    versionCheck(c, b.expectedVersion);
    const asBorrower =
        hasRole(actor, "BORROWER", c.org_id) &&
        actor.wallet === c.terms.borrower.toLowerCase(),
      asBuyer =
        hasRole(actor, "BUYER", c.buyer_org_id) &&
        actor.wallet === c.terms.buyer.toLowerCase();
    switch (b.action) {
      case "REGISTER":
      case "CLEAR_HOLD":
        requireRole(actor, ["VERIFIER"]);
        await assertIndependentVerifier(tx, actor, c);
        if (b.action === "REGISTER") await requireLenderInvitation(tx, claimId);
        break;
      case "FUND":
        requireRole(actor, ["LENDER"]);
        await assertGrantedLender(tx, actor, c);
        break;
      case "WITHDRAW_LENDER":
        requireRole(actor, ["LENDER"]);
        break;
      case "COLLECT_BUYER_PAYMENT":
        if (!asBuyer) throw new ApiError(403, "BUYER_ONLY");
        if (!b.amount || BigInt(b.amount) === 0n)
          throw new ApiError(422, "POSITIVE_AMOUNT_REQUIRED");
        break;
      case "WITHDRAW_BORROWER":
        if (!asBorrower) throw new ApiError(403, "BORROWER_ONLY");
        break;
      case "CANCEL":
        if (!asBorrower && !asBuyer && !hasRole(actor, "VERIFIER"))
          throw new ApiError(403, "CANCEL_FORBIDDEN");
        break;
      case "REVOKE_CONSENT":
        if (!asBorrower && !asBuyer) throw new ApiError(403, "SIGNER_ONLY");
        if (b.nonce === undefined) throw new ApiError(422, "NONCE_REQUIRED");
        break;
      case "APPROVE_TOKEN":
        if (!asBuyer && !hasRole(actor, "LENDER"))
          throw new ApiError(403, "TOKEN_APPROVAL_FORBIDDEN");
        if (
          !b.amount ||
          BigInt(b.amount) <= 0n ||
          BigInt(b.amount) >
            (asBuyer
              ? BigInt(c.terms.acceptedOutstanding)
              : BigInt(c.terms.principal))
        )
          throw new ApiError(422, "APPROVAL_AMOUNT_LIMIT");
        break;
    }
    if (["REGISTER", "FUND"].includes(b.action)) {
      const goodsReasons = goodsPolicyReasons(c.asset_type, c.goods);
      if (goodsReasons.length)
        throw new ApiError(422, "GOODS_REVIEW_REQUIRED", {
          reasonCodes: goodsReasons,
        });
      await assertCurrentAuthorities(tx, c);
      const aliases =
        await tx`SELECT id FROM claims WHERE org_id=${c.org_id} AND id<>${c.id} AND regexp_replace(invoice_number,'[^A-Z0-9]','','g')=regexp_replace(${c.invoice_number},'[^A-Z0-9]','','g') LIMIT 1`;
      if (aliases.length)
        throw new ApiError(409, "INVOICE_ALIAS_REQUIRES_REVIEW");
      if (c.has_dispute || c.funding_hold)
        throw new ApiError(409, "HOLD_OR_DISPUTE");
      if (
        Math.min(
          c.terms.fundingDeadline,
          c.terms.reviewExpiry,
          c.terms.consentExpiry,
        ) <=
        Date.now() / 1000
      )
        throw new ApiError(409, "TERMS_EXPIRED");
      const checkpoints =
        await tx`SELECT * FROM indexer_checkpoints WHERE chain_id=${Number(process.env.CHAIN_ID)}`;
      if (
        !checkpoints.length ||
        checkpoints[0].degraded ||
        new Date(checkpoints[0].updated_at).getTime() < Date.now() - 120000
      )
        throw new ApiError(503, "INDEXER_NOT_FRESH");
    }
    if (b.action === "REGISTER" && c.workflow !== "READY_FOR_REGISTRATION")
      throw new ApiError(409, "REGISTRATION_NOT_READY");
    const reviews =
      await tx`SELECT * FROM review_decisions WHERE claim_id=${claimId} AND version=${c.version} AND decision='APPROVE' AND expires_at>now() ORDER BY created_at DESC LIMIT 1`;
    const review = reviews[0] ?? null;
    if (["REGISTER", "CLEAR_HOLD"].includes(b.action) && !review)
      throw new ApiError(409, "CURRENT_REVIEW_REQUIRED");
    if (b.action === "CLEAR_HOLD") {
      const disputes =
        await tx`SELECT created_at FROM attestations WHERE claim_id=${claimId} AND kind='DISPUTE' ORDER BY created_at DESC LIMIT 1`;
      if (
        disputes.length &&
        new Date(review!.created_at) <= new Date(disputes[0].created_at)
      )
        throw new ApiError(409, "FRESH_REVIEW_REQUIRED");
    }
    const rows =
      await tx`SELECT * FROM consent_records WHERE claim_id=${claimId} AND version=${c.version} AND revoked=false`;
    const consents: ConsentRecord[] = rows.map((r) => ({
      role: r.role,
      signer: r.signer,
      nonce: r.nonce,
      deadline: r.deadline,
      signature: r.signature,
      termsHash: r.terms_hash,
    }));
    const template = await wrapChain(() =>
      chain.prepareAction({
        action: b.action,
        claim: toChainClaim(c),
        sender: actor.wallet,
        body: {
          amount: b.amount,
          nonce: b.nonce,
          ...(b.action === "CLEAR_HOLD"
            ? { commitment: `0x${review!.snapshot_hash}` as `0x${string}` }
            : {}),
        },
        consents,
        review,
      }),
    );
    const intentId = id();
    await tx`INSERT INTO transaction_intents(id,claim_id,actor_id,sender,action,status,template) VALUES(${intentId},${claimId},${actor.userId},${actor.wallet},${b.action},'PREPARED',${tx.json(template as never)})`;
    let actionOrganization: string | null = null;
    switch (b.action) {
      case "COLLECT_BUYER_PAYMENT":
        actionOrganization = c.buyer_org_id;
        break;
      case "WITHDRAW_BORROWER":
        actionOrganization = c.org_id;
        break;
      case "REGISTER":
      case "CLEAR_HOLD":
        actionOrganization = authorizingOrganization(actor, "VERIFIER");
        break;
      case "FUND":
      case "WITHDRAW_LENDER":
        actionOrganization = authorizingOrganization(actor, "LENDER");
        break;
      case "APPROVE_TOKEN":
        actionOrganization = asBuyer
          ? c.buyer_org_id
          : authorizingOrganization(actor, "LENDER");
        break;
      case "REVOKE_CONSENT":
      case "CANCEL":
        actionOrganization = asBorrower
          ? c.org_id
          : asBuyer
            ? c.buyer_org_id
            : authorizingOrganization(actor, "VERIFIER");
        break;
    }
    await audit(
      tx,
      actor,
      "TRANSACTION_PREPARED",
      claimId,
      correlationId,
      { intentId, action: b.action },
      undefined,
      undefined,
      actionOrganization,
    );
    return {
      body: {
        intentId,
        status: "PREPARED",
        transaction: template,
        warning: "USER_MUST_SIGN; SIMULATION_IS_NOT_CONFIRMATION",
      },
    };
  });
}
export async function observe(
  req: Request,
  actor: Actor,
  correlationId: string,
) {
  const b = z
    .object({
      intentId: z.string().uuid(),
      hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      replacesIntentId: z.string().uuid().optional(),
    })
    .strict()
    .parse(await readBody(req));
  return mutate(req, actor, b, async (tx) => {
    const rows =
      await tx`SELECT * FROM transaction_intents WHERE id=${b.intentId} AND actor_id=${actor.userId} FOR UPDATE`;
    if (!rows.length) throw new ApiError(404, "INTENT_NOT_FOUND");
    const intent = rows[0];
    const c = await authorizedClaim(actor, intent.claim_id, tx);
    if (intent.status === "REPLACED")
      throw new ApiError(409, "INTENT_REPLACED");
    if (intent.tx_hash && intent.tx_hash !== b.hash)
      throw new ApiError(409, "INTENT_HASH_ALREADY_SET");
    let replaces: { details?: { nonce?: number } } | undefined;
    if (b.replacesIntentId) {
      const old =
        await tx`SELECT * FROM transaction_intents WHERE id=${b.replacesIntentId} AND actor_id=${actor.userId} AND claim_id=${c.id} AND action=${intent.action}`;
      if (
        !old.length ||
        ["CONFIRMED", "REVERTED", "REPLACED"].includes(old[0].status) ||
        old[0].sender !== actor.wallet ||
        old[0].tx_hash === b.hash ||
        old[0].template.to !== intent.template.to ||
        old[0].template.data !== intent.template.data
      )
        throw new ApiError(409, "INVALID_REPLACEMENT");
      replaces = old[0];
    }
    const inspected = await wrapChain(() =>
      chain.inspectObservedTransaction({
        hash: b.hash as `0x${string}`,
        sender: actor.wallet,
        claim: toChainClaim(c),
        template: intent.template,
      }),
    );
    if (
      replaces &&
      (typeof replaces.details?.nonce !== "number" ||
        replaces.details.nonce !== inspected.nonce)
    )
      throw new ApiError(409, "REPLACEMENT_NONCE_NOT_VERIFIED");
    await tx`UPDATE transaction_intents SET tx_hash=${b.hash},status=${String(inspected.status)},details=${tx.json(inspected as never)},replaces_id=${b.replacesIntentId ?? null},updated_at=now() WHERE id=${b.intentId}`;
    if (b.replacesIntentId)
      await tx`UPDATE transaction_intents SET status='REPLACED',updated_at=now() WHERE id=${b.replacesIntentId}`;
    if (intent.action === "REGISTER" && inspected.status !== "REVERTED")
      await tx`UPDATE claims SET workflow='REGISTRATION_PENDING',updated_at=now() WHERE id=${c.id} AND workflow='READY_FOR_REGISTRATION'`;
    await tx`INSERT INTO outbox(id,type,payload) VALUES(${id()},'RECONCILE_TRANSACTION',${tx.json({ intentId: b.intentId, claimId: c.id, hash: b.hash })})`;
    await audit(tx, actor, "TRANSACTION_OBSERVED", c.id, correlationId, {
      intentId: b.intentId,
      hash: b.hash,
      status: inspected.status,
    });
    return {
      status: 202,
      body: {
        intentId: b.intentId,
        ...inspected,
        stateConfidence: "RECEIPT_HINT_PENDING_INDEXER",
      },
    };
  });
}

/** Recover a wallet speed-up that is already mined, without simulating or sending the action again. */
export async function observeReplacement(
  req: Request,
  actor: Actor,
  intentId: string,
  correlationId: string,
) {
  const body = z
    .object({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) })
    .strict()
    .parse(await readBody(req));
  return mutate(req, actor, body, async (tx) => {
    const [original] =
      await tx`SELECT * FROM transaction_intents WHERE id=${intentId} AND actor_id=${actor.userId} FOR UPDATE`;
    if (!original) throw new ApiError(404, "INTENT_NOT_FOUND");
    const claim = await authorizedClaim(actor, original.claim_id, tx);
    if (
      original.sender.toLowerCase() !== actor.wallet.toLowerCase() ||
      original.template.chainId !== config().CHAIN_ID
    )
      throw new ApiError(409, "INVALID_REPLACEMENT");
    const [existing] =
      await tx`SELECT id,status,tx_hash FROM transaction_intents WHERE replaces_id=${intentId} AND actor_id=${actor.userId} ORDER BY created_at DESC,id DESC LIMIT 1`;
    if (existing && existing.tx_hash?.toLowerCase() === body.hash.toLowerCase())
      return {
        status: 202,
        body: {
          intentId: existing.id,
          replacesIntentId: intentId,
          status: existing.status,
          hash: existing.tx_hash,
          stateConfidence: "RECEIPT_HINT_PENDING_INDEXER",
        },
      };
    if (
      existing ||
      !original.tx_hash ||
      original.tx_hash.toLowerCase() === body.hash.toLowerCase() ||
      ["CONFIRMED", "REVERTED", "REPLACED"].includes(original.status)
    )
      throw new ApiError(409, "INVALID_REPLACEMENT");
    let originalNonce: unknown = original.details?.nonce;
    if (!Number.isSafeInteger(originalNonce) || Number(originalNonce) < 0) {
      const checkedOriginal = await wrapChain(() =>
        chain.inspectObservedTransaction({
          hash: original.tx_hash,
          sender: actor.wallet,
          claim: toChainClaim(claim),
          template: original.template,
        }),
      );
      originalNonce = checkedOriginal.nonce;
    }
    if (!Number.isSafeInteger(originalNonce) || Number(originalNonce) < 0)
      throw new ApiError(409, "REPLACEMENT_NONCE_NOT_VERIFIED");
    const observed = await wrapChain(() =>
      chain.inspectObservedTransaction({
        hash: body.hash as `0x${string}`,
        sender: actor.wallet,
        claim: toChainClaim(claim),
        template: original.template,
      }),
    );
    if (observed.status === "DROPPED_OR_UNKNOWN")
      throw new ApiError(409, "REPLACEMENT_TRANSACTION_NOT_OBSERVED");
    if (observed.nonce !== originalNonce)
      throw new ApiError(409, "REPLACEMENT_NONCE_NOT_VERIFIED");
    // A mempool replacement can disappear while the original still mines. Keep
    // the original history intact until there is a canonical receipt to inspect.
    if (observed.status === "SUBMITTED")
      throw new ApiError(409, "REPLACEMENT_AWAITING_RECEIPT");
    if (!["MINED", "CONFIRMED", "REVERTED"].includes(String(observed.status)))
      throw new ApiError(409, "INVALID_REPLACEMENT");
    const successorId = id();
    await tx`INSERT INTO transaction_intents(id,claim_id,actor_id,sender,action,status,template,tx_hash,replaces_id,details) VALUES(${successorId},${claim.id},${actor.userId},${original.sender},${original.action},${String(observed.status)},${tx.json(original.template)},${body.hash},${intentId},${tx.json(observed as never)})`;
    await tx`UPDATE transaction_intents SET status='REPLACED',updated_at=now() WHERE id=${intentId}`;
    await tx`INSERT INTO outbox(id,type,payload) VALUES(${id()},'RECONCILE_TRANSACTION',${tx.json({ intentId: successorId, claimId: claim.id, hash: body.hash })})`;
    await audit(
      tx,
      actor,
      "TRANSACTION_REPLACEMENT_OBSERVED",
      claim.id,
      correlationId,
      {
        intentId: successorId,
        replacesIntentId: intentId,
        hash: body.hash,
        status: observed.status,
      },
    );
    return {
      status: 202,
      body: {
        intentId: successorId,
        replacesIntentId: intentId,
        status: observed.status,
        hash: body.hash,
        stateConfidence: "RECEIPT_HINT_PENDING_INDEXER",
      },
    };
  });
}
export async function financing(actor: Actor, claimId: string) {
  const c = await authorizedClaim(actor, claimId),
    rows =
      await getSql()`SELECT * FROM financial_projections WHERE claim_key=${c.claim_key}`,
    checkpoints =
      await getSql()`SELECT degraded,updated_at FROM indexer_checkpoints WHERE chain_id=${Number(process.env.CHAIN_ID)}`;
  const degraded =
    !checkpoints.length ||
    checkpoints[0].degraded ||
    new Date(checkpoints[0].updated_at).getTime() < Date.now() - 120000;
  return json(
    rows.length
      ? {
          claimId,
          isSynthetic: true,
          ...rows[0].state,
          hasDispute: c.has_dispute,
          blockNumber: rows[0].block_number,
          blockHash: rows[0].block_hash,
          indexerDegraded: degraded,
          stateConfidence: degraded
            ? "DEGRADED_LAST_CONFIRMED_PROJECTION"
            : "CONFIRMED_PROJECTION",
        }
      : {
          claimId,
          isSynthetic: true,
          stateConfidence: "NO_CONFIRMED_PROJECTION",
          financingStatus: "UNFUNDED",
          collectionStatus: "UNPAID",
          acceptedOutstanding: c.terms.acceptedOutstanding,
          principal: c.terms.principal,
          fixedFee: c.terms.fee,
          totalCollected: "0",
          lenderWithdrawn: "0",
          borrowerWithdrawn: "0",
          lenderClaimable: "0",
          borrowerResidualClaimable: "0",
          remainingInvoiceCollection: c.terms.acceptedOutstanding,
        },
  );
}
