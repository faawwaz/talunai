import type { EvidenceState } from "./evidence";
import { POLICY, quote } from "./finance";
import { snapshotHash } from "./identity";
import { amount } from "./money";
import { goodsPolicyReasons, type GoodsMetadata } from "./goods";

export type PolicyInput = {
  assetType?: string;
  goods?: GoodsMetadata | null;
  acceptedOutstanding: string;
  requestedPrincipal: string;
  evidence: EvidenceState;
  evidenceIds: string[];
  chainId: number;
  supportedToken: boolean;
  hasConflict: boolean;
  knownDuplicate: boolean;
  alreadyFinanced: boolean;
  fundingHold: boolean;
  hasDispute: boolean;
  now: number;
  fundingDeadline: number;
  invoiceDueAt: number;
  reviewExpiry: number;
  consentExpiry: number;
};
export const POLICY_HASH = snapshotHash(POLICY);
export function evaluatePolicy(input: PolicyInput) {
  const reasons: string[] = [],
    reject: string[] = [];
  reasons.push(...goodsPolicyReasons(input.assetType, input.goods));
  const calculated = quote(input.acceptedOutstanding, input.requestedPrincipal);
  const p = amount(input.requestedPrincipal),
    a = amount(input.acceptedOutstanding);
  if (a <= 0n || p <= 0n) reject.push("NON_POSITIVE_AMOUNT");
  if (p > amount(calculated.advanceCap)) reject.push("ADVANCE_CAP_EXCEEDED");
  if (p > amount(POLICY.perDealPrincipalCap)) reject.push("DEAL_CAP_EXCEEDED");
  if (amount(calculated.lenderEntitlement) > a)
    reject.push("ENTITLEMENT_EXCEEDS_OUTSTANDING");
  if (![97, 31337].includes(input.chainId)) reject.push("UNSUPPORTED_CHAIN");
  if (!input.supportedToken) reject.push("UNSUPPORTED_TOKEN");
  if (input.knownDuplicate || input.alreadyFinanced)
    reject.push("DUPLICATE_OR_FINANCED");
  if (input.hasConflict) reasons.push("MATERIAL_EVIDENCE_CONFLICT");
  if (input.fundingHold || input.hasDispute) reasons.push("HOLD_OR_DISPUTE");
  if (input.evidence.issuerAuthorityStatus !== "ATTESTED")
    reasons.push("ISSUER_AUTHORITY_REQUIRED");
  if (input.evidence.buyerAuthorityStatus !== "ATTESTED")
    reasons.push("BUYER_AUTHORITY_REQUIRED");
  if (
    !["ATTESTED", "SUPPORTED_BY_DOCUMENT"].includes(
      input.evidence.buyerAcknowledgementStatus,
    )
  )
    reasons.push("BUYER_ACKNOWLEDGEMENT_REQUIRED");
  if (
    !["ATTESTED", "SUPPORTED_BY_DOCUMENT"].includes(
      input.evidence.deliveryEvidenceStatus,
    )
  )
    reasons.push("DELIVERY_EVIDENCE_REQUIRED");
  if (
    !["ATTESTED", "SUPPORTED_BY_DOCUMENT"].includes(
      input.evidence.extractionStatus,
    )
  )
    reasons.push("EXTRACTION_REVIEW_REQUIRED");
  if (
    !["ATTESTED", "SUPPORTED_BY_DOCUMENT"].includes(
      input.evidence.duplicateCheckStatus,
    )
  )
    reasons.push("DUPLICATE_REVIEW_REQUIRED");
  if (Object.values(input.evidence).includes("REJECTED"))
    reject.push("REJECTED_EVIDENCE");
  if (Object.values(input.evidence).includes("STALE"))
    reasons.push("STALE_EVIDENCE");
  if (
    input.fundingDeadline <= input.now ||
    input.reviewExpiry <= input.now ||
    input.consentExpiry <= input.now
  )
    reasons.push("EXPIRED_TERMS_OR_APPROVAL");
  if (
    input.fundingDeadline > input.now + POLICY.maxFundingWindowSeconds ||
    input.fundingDeadline > Math.min(input.reviewExpiry, input.consentExpiry)
  )
    reject.push("INVALID_FUNDING_WINDOW");
  if (input.invoiceDueAt <= input.fundingDeadline)
    reject.push("INVALID_INVOICE_DUE_DATE");
  const reasonCodes = [...reject, ...reasons];
  return {
    outcome: reject.length
      ? ("REJECTED" as const)
      : reasons.length
        ? ("NEEDS_REVIEW" as const)
        : ("ELIGIBLE_FOR_HUMAN_APPROVAL" as const),
    reasonCodes,
    evidenceIds: input.evidenceIds,
    policyVersion: POLICY.version,
    policyHash: POLICY_HASH,
    inputSnapshotHash: snapshotHash(input),
    quote: calculated,
    outstandingGates: [
      ...reasonCodes,
      ...(input.evidence.humanReviewStatus === "ATTESTED"
        ? []
        : ["HUMAN_APPROVAL_REQUIRED"]),
      "EXACT_TERM_BORROWER_AND_BUYER_CONSENTS",
      "LENDER_SIGNED_FUNDING",
    ],
    disclosures: [
      "SYNTHETIC_DEMO_ONLY",
      "EXTERNAL_ENCUMBRANCE_NOT_INTEGRATED",
      "ELIGIBLE_IS_NOT_DISBURSEMENT_AUTHORIZATION",
      "DEMO_POLICY_NOT_CALIBRATED_ACROSS_SECTORS",
    ],
  };
}
