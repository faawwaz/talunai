import type { DbTransaction } from "../db";
import { config } from "./config";
import { ApiError } from "./core";

type Attempt = {
  role: "BORROWER" | "BUYER";
  signer: string;
  nonce: string;
  deadline: number;
};

/**
 * An issued typed-data envelope may have been signed even if no signature was
 * submitted. DB revocation never proves that its nonce is invalid onchain.
 * The indexer only stores canonical events at a confirmed block.
 */
export async function activeConsentAttempts(
  tx: DbTransaction,
  claimId: string,
  version?: number,
  role?: "BORROWER" | "BUYER",
): Promise<Attempt[]> {
  const cfg = config();
  const rows = await tx`
    SELECT DISTINCT a.role,a.signer,a.nonce,a.deadline
    FROM (
      SELECT claim_id,version,role,signer,nonce,deadline,chain_id,registry_address
      FROM consent_issuances
      UNION ALL
      SELECT claim_id,version,role,signer,nonce,deadline,
        ${cfg.CHAIN_ID}::integer AS chain_id,
        ${cfg.CONTRACT_REGISTRY_ADDRESS}::text AS registry_address
      FROM consent_records
    ) a
    WHERE a.claim_id=${claimId}
      AND (${version ?? null}::integer IS NULL OR a.version=${version ?? null})
      AND (${role ?? null}::text IS NULL OR a.role=${role ?? null})
      AND a.deadline>extract(epoch from now())
      AND NOT EXISTS (
        SELECT 1 FROM chain_events e
        WHERE e.chain_id=a.chain_id AND e.canonical=true
          AND e.event_name='ConsentNonceInvalidated'
          AND lower(e.contract_address)=lower(a.registry_address)
          AND lower(e.args->>'signer')=lower(a.signer)
          AND e.args->>'nonce'=a.nonce
          AND EXISTS (
            SELECT 1 FROM indexer_checkpoints cp
            WHERE cp.chain_id=e.chain_id AND cp.degraded=false
              AND cp.block_number>=e.block_number
              AND cp.updated_at>now()-interval '120 seconds'
          )
      )
    ORDER BY a.deadline,a.role,a.nonce
  `;
  return rows.map((r) => ({
    role: r.role as Attempt["role"],
    signer: String(r.signer),
    nonce: String(r.nonce),
    deadline: Number(r.deadline),
  }));
}

export async function requireConsentRevisionSafe(
  tx: DbTransaction,
  claimId: string,
) {
  const attempts = await activeConsentAttempts(tx, claimId);
  if (attempts.length)
    throw new ApiError(409, "CONSENT_REVOCATION_REQUIRED", {
      pendingConsents: attempts.map(({ role, nonce, deadline }) => ({
        role,
        nonce,
        deadline,
      })),
    });
}
