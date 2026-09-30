import { z } from "zod";
import { getSql } from "../db";
import { config } from "./config";
import { ApiError, type Actor, hasRole, json } from "./core";
import { pagination } from "./read-models";

const inboxRole = z.enum(["BORROWER", "BUYER", "LENDER", "VERIFIER", "ADMIN"]);

/** One paginated, object-scoped action queue; payment actions require a fresh projection. */
export async function actionInbox(req: Request, actor: Actor) {
  const requested = inboxRole
    .optional()
    .parse(new URL(req.url).searchParams.get("role") ?? undefined);
  if (requested && !hasRole(actor, requested))
    throw new ApiError(403, "ROLE_FORBIDDEN");
  const { limit, offset } = pagination(req);
  if (requested === "ADMIN" || actor.memberships.length === 0)
    return json({
      items: [],
      total: 0,
      limit,
      offset,
      financialDataCurrent: false,
    });
  const sql = getSql();
  const cfg = config();
  const borrowerOrganizations = actor.memberships
    .filter(
      (membership) =>
        membership.role === "BORROWER" &&
        (!requested || requested === "BORROWER"),
    )
    .map((membership) => membership.organizationId);
  const buyerOrganizations = actor.memberships
    .filter(
      (membership) =>
        membership.role === "BUYER" && (!requested || requested === "BUYER"),
    )
    .map((membership) => membership.organizationId);
  const lenderOrganizations = actor.memberships
    .filter(
      (membership) =>
        membership.role === "LENDER" && (!requested || requested === "LENDER"),
    )
    .map((membership) => membership.organizationId);
  const verifier =
    (!requested || requested === "VERIFIER") && hasRole(actor, "VERIFIER");
  const actorOrganizations = [
    ...new Set(
      actor.memberships.map((membership) => membership.organizationId),
    ),
  ];
  const borrowerScope = borrowerOrganizations.length
    ? sql`c.org_id IN ${sql(borrowerOrganizations)}`
    : sql`false`;
  const buyerScope = buyerOrganizations.length
    ? sql`c.buyer_org_id IN ${sql(buyerOrganizations)}`
    : sql`false`;
  const lenderScope = lenderOrganizations.length
    ? sql`EXISTS(SELECT 1 FROM claim_access access WHERE access.claim_id=c.id AND access.org_id IN ${sql(lenderOrganizations)})`
    : sql`false`;
  const verifierScope = verifier
    ? sql`c.org_id NOT IN ${sql(actorOrganizations)}
      AND c.buyer_org_id NOT IN ${sql(actorOrganizations)}
      AND NOT EXISTS(SELECT 1 FROM claim_access access WHERE access.claim_id=c.id AND access.org_id IN ${sql(actorOrganizations)})
      AND NOT EXISTS(SELECT 1 FROM chain_events funded WHERE funded.chain_id=${cfg.CHAIN_ID}
        AND funded.claim_key=c.claim_key AND funded.canonical=true
        AND funded.event_name='Funded' AND lower(funded.args->>'lender')=${actor.wallet.toLowerCase()})`
    : sql`false`;
  const freshProjection = sql`fp.chain_id=${cfg.CHAIN_ID}
    AND fp.state->>'stateConfidence'='CONFIRMED_PROJECTION'
    AND fp.updated_at>now()-interval '120 seconds'
    AND EXISTS(SELECT 1 FROM indexer_checkpoints cp WHERE cp.chain_id=${cfg.CHAIN_ID}
      AND cp.degraded=false AND cp.updated_at>now()-interval '120 seconds'
      AND cp.block_number>=fp.block_number)`;
  const validConsent = (role: "BORROWER" | "BUYER") => sql`EXISTS(
    SELECT 1 FROM consent_records cr WHERE cr.claim_id=c.id AND cr.version=c.version
      AND cr.role=${role} AND cr.revoked=false AND cr.deadline>extract(epoch from now())
      AND NOT EXISTS(SELECT 1 FROM chain_events invalidated
        WHERE invalidated.chain_id=${cfg.CHAIN_ID}
          AND invalidated.contract_address=${cfg.CONTRACT_REGISTRY_ADDRESS.toLowerCase()}
          AND invalidated.canonical=true AND invalidated.event_name='ConsentNonceInvalidated'
          AND lower(invalidated.args->>'signer')=lower(cr.signer)
          AND invalidated.args->>'nonce'=cr.nonce
          AND EXISTS(SELECT 1 FROM indexer_checkpoints cp
            WHERE cp.chain_id=invalidated.chain_id AND cp.degraded=false
              AND cp.block_number>=invalidated.block_number
              AND cp.updated_at>now()-interval '120 seconds'))
  )`;
  const reviewed = sql`c.evidence->>'humanReviewStatus'='ATTESTED'
    AND EXISTS(SELECT 1 FROM review_decisions review WHERE review.claim_id=c.id
      AND review.version=c.version AND review.decision='APPROVE'
      AND review.expires_at>now())`;
  const candidates = sql`
    SELECT c.id AS claim_id,'BORROWER'::text AS role,
      'INVITE_LENDER'::text AS action,'summary'::text AS tab,
      (c.terms->>'fundingDeadline')::bigint AS due_at,c.updated_at
    FROM claims c WHERE ${borrowerScope}
      AND c.workflow IN ('DRAFT','EXTRACTING','NEEDS_REVIEW',
        'READY_FOR_SIGNATURES','PROCESSING_FAILED')
      AND NOT EXISTS(SELECT 1 FROM claim_access access WHERE access.claim_id=c.id)
    UNION ALL
    SELECT c.id AS claim_id,'BORROWER'::text AS role,
      'COMPLETE_EVIDENCE'::text AS action,'evidence'::text AS tab,
      (c.terms->>'fundingDeadline')::bigint AS due_at,c.updated_at
    FROM claims c WHERE ${borrowerScope}
      AND c.workflow IN ('DRAFT','PROCESSING_FAILED') AND c.has_dispute=false
    UNION ALL
    SELECT c.id,'BORROWER','SIGN_TERMS','terms',
      (c.terms->>'consentExpiry')::bigint,c.updated_at
    FROM claims c WHERE ${borrowerScope} AND c.workflow='READY_FOR_SIGNATURES'
      AND c.has_dispute=false AND c.funding_hold=false AND ${reviewed}
      AND EXISTS(SELECT 1 FROM claim_access access WHERE access.claim_id=c.id)
      AND NOT ${validConsent("BORROWER")}
    UNION ALL
    SELECT c.id,'BUYER','CONFIRM_INVOICE','terms',
      (c.terms->>'consentExpiry')::bigint,c.updated_at
    FROM claims c WHERE ${buyerScope} AND c.workflow='READY_FOR_SIGNATURES'
      AND c.has_dispute=false AND c.funding_hold=false AND ${reviewed}
      AND EXISTS(SELECT 1 FROM claim_access access WHERE access.claim_id=c.id)
      AND NOT ${validConsent("BUYER")}
    UNION ALL
    SELECT c.id,'VERIFIER','REVIEW_DEAL','terms',
      (c.terms->>'reviewExpiry')::bigint,c.updated_at
    FROM claims c WHERE ${verifierScope}
      AND c.workflow IN ('NEEDS_REVIEW','READY_FOR_SIGNATURES')
      AND EXISTS(SELECT 1 FROM review_tasks task WHERE task.claim_id=c.id
        AND task.role='VERIFIER' AND task.status='OPEN')
    UNION ALL
    SELECT c.id,'VERIFIER','REGISTER_DEAL','terms',
      (c.terms->>'fundingDeadline')::bigint,c.updated_at
    FROM claims c WHERE ${verifierScope}
      AND c.workflow='READY_FOR_REGISTRATION' AND c.has_dispute=false
      AND c.funding_hold=false AND ${reviewed}
      AND EXISTS(SELECT 1 FROM claim_access access WHERE access.claim_id=c.id)
      AND ${validConsent("BORROWER")} AND ${validConsent("BUYER")}
    UNION ALL
    SELECT c.id,'LENDER','FUND_DEAL','payments',
      (c.terms->>'fundingDeadline')::bigint,c.updated_at
    FROM claims c JOIN financial_projections fp ON fp.claim_key=c.claim_key
    WHERE ${lenderScope} AND ${freshProjection}
      AND c.workflow='REGISTERED' AND c.has_dispute=false
      AND c.funding_hold=false AND fp.state->>'registryStatus'='AVAILABLE'
      AND fp.state->>'financingStatus'='UNFUNDED'
      AND (c.terms->>'fundingDeadline')::bigint>extract(epoch from now())
      AND (c.terms->>'reviewExpiry')::bigint>extract(epoch from now())
      AND (c.terms->>'consentExpiry')::bigint>extract(epoch from now())
      AND c.org_id NOT IN ${sql(actorOrganizations)}
      AND c.buyer_org_id NOT IN ${sql(actorOrganizations)}
      AND lower(c.terms->>'borrower')<>${actor.wallet.toLowerCase()}
      AND lower(c.terms->>'buyer')<>${actor.wallet.toLowerCase()}
    UNION ALL
    SELECT c.id,'BUYER','PAY_INVOICE','payments',
      (c.terms->>'invoiceDueAt')::bigint,c.updated_at
    FROM claims c JOIN financial_projections fp ON fp.claim_key=c.claim_key
    WHERE ${buyerScope} AND ${freshProjection} AND c.workflow='REGISTERED'
      AND fp.state->>'registryStatus'='FUNDED'
      AND (fp.state->>'remainingInvoiceCollection')::numeric>0
      AND lower(c.terms->>'buyer')=${actor.wallet.toLowerCase()}
    UNION ALL
    SELECT c.id,'LENDER','WITHDRAW_RETURN','payments',
      (c.terms->>'invoiceDueAt')::bigint,c.updated_at
    FROM claims c JOIN financial_projections fp ON fp.claim_key=c.claim_key
    WHERE ${lenderScope} AND ${freshProjection} AND c.workflow='REGISTERED'
      AND (fp.state->>'lenderClaimable')::numeric>0
      AND lower(fp.state->>'lender')=${actor.wallet.toLowerCase()}
    UNION ALL
    SELECT c.id,'BORROWER','WITHDRAW_BALANCE','payments',
      (c.terms->>'invoiceDueAt')::bigint,c.updated_at
    FROM claims c JOIN financial_projections fp ON fp.claim_key=c.claim_key
    WHERE ${borrowerScope} AND ${freshProjection} AND c.workflow='REGISTERED'
      AND (fp.state->>'borrowerResidualClaimable')::numeric>0
      AND lower(c.terms->>'borrower')=${actor.wallet.toLowerCase()}
  `;
  const rows = await sql`WITH actions AS (${candidates})
    SELECT actions.*,c.workflow,c.invoice_number,c.terms,
      issuer.name AS organization_name,buyer.name AS buyer_organization_name
    FROM actions JOIN claims c ON c.id=actions.claim_id
      JOIN organizations issuer ON issuer.id=c.org_id
      JOIN organizations buyer ON buyer.id=c.buyer_org_id
    ORDER BY actions.due_at,actions.updated_at,actions.claim_id,actions.role
    LIMIT ${limit} OFFSET ${offset}`;
  const [count] = await sql`WITH actions AS (${candidates})
    SELECT count(*)::integer AS total FROM actions`;
  const [checkpoint] =
    await sql`SELECT degraded,updated_at FROM indexer_checkpoints
    WHERE chain_id=${cfg.CHAIN_ID}`;
  return json({
    items: rows.map((row) => ({
      claimId: row.claim_id,
      role: row.role,
      action: row.action,
      tab: row.tab,
      invoiceNumber: row.invoice_number,
      organizationName: row.organization_name,
      buyerOrganizationName: row.buyer_organization_name,
      principal: row.terms.principal,
      invoiceAmount: row.terms.acceptedOutstanding,
      fee: row.terms.fee,
      dueAt: Number(row.due_at),
      workflow: row.workflow,
      updatedAt: row.updated_at,
    })),
    total: count.total,
    limit,
    offset,
    financialDataCurrent: Boolean(
      checkpoint &&
      !checkpoint.degraded &&
      Date.now() - new Date(checkpoint.updated_at).getTime() <= 120_000,
    ),
  });
}
