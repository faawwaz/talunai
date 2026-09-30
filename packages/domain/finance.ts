import { amount, ceilDiv } from "./money";

export const POLICY = Object.freeze({
  version: "talunai-demo-v2-goods",
  assetType: "TRADE_RECEIVABLE",
  demoGoodsCategories: ["COCOA", "PACKAGING"],
  maxAdvanceBps: 8000,
  flatFinancingFeeBps: 150,
  perDealPrincipalCap: "100000000",
  maxFundingWindowSeconds: 86400,
});

export function quote(outstanding: string, principal: string) {
  const a = amount(outstanding),
    p = amount(principal);
  const advanceCap = (a * BigInt(POLICY.maxAdvanceBps)) / 10000n;
  const fee = ceilDiv(p * BigInt(POLICY.flatFinancingFeeBps), 10000n);
  return {
    acceptedOutstanding: a.toString(),
    principal: p.toString(),
    advanceCap: advanceCap.toString(),
    fixedFee: fee.toString(),
    lenderEntitlement: (p + fee).toString(),
    isSynthetic: true,
    feeKind: "FLAT_SYNTHETIC_NOT_APR" as const,
  };
}

export function waterfall(input: {
  principal: string;
  fixedFee: string;
  acceptedOutstanding: string;
  totalCollected: string;
  lenderWithdrawn?: string;
  borrowerWithdrawn?: string;
  funded?: boolean;
}) {
  const p = amount(input.principal),
    f = amount(input.fixedFee),
    a = amount(input.acceptedOutstanding),
    c = amount(input.totalCollected);
  const lw = amount(input.lenderWithdrawn ?? "0"),
    bw = amount(input.borrowerWithdrawn ?? "0");
  if (c > a || p + f > a) throw new Error("INVALID_ACCOUNTING");
  const principalAllocated = c < p ? c : p;
  const availableFee = c > p ? c - p : 0n;
  const feeAllocated = availableFee < f ? availableFee : f;
  const lenderAllocated = principalAllocated + feeAllocated;
  const borrowerAllocated = c - lenderAllocated;
  if (lw > lenderAllocated || bw > borrowerAllocated)
    throw new Error("WITHDRAWAL_EXCEEDS_ALLOCATION");
  return {
    principalAllocated: principalAllocated.toString(),
    feeAllocated: feeAllocated.toString(),
    lenderAllocated: lenderAllocated.toString(),
    borrowerAllocated: borrowerAllocated.toString(),
    lenderClaimable: (lenderAllocated - lw).toString(),
    borrowerResidualClaimable: (borrowerAllocated - bw).toString(),
    remainingInvoiceCollection: (a - c).toString(),
    lenderOutstanding: (p + f - lenderAllocated).toString(),
    financingStatus:
      input.funded === false
        ? "UNFUNDED"
        : c >= p + f
          ? "REPAID"
          : c === 0n
            ? "ACTIVE"
            : "PARTIALLY_RECOVERED",
    collectionStatus:
      c === a ? "FULLY_COLLECTED" : c === 0n ? "UNPAID" : "PARTIALLY_COLLECTED",
  };
}
