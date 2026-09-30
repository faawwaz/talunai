import receipt from "../../../deployments/bsc-testnet-flow-smoke.json";
import checks from "../../../deployments/bsc-testnet-landing-checks.json";

if (checks.chainId !== 97 || checks.claimKey !== receipt.claimKey)
  throw new Error("LANDING_CHECKS_PROOF_MISMATCH");

export const landingChecks = checks;

// Public, synthetic transaction evidence already published in the repository.
// This is an archived completed cycle, never an open funding opportunity.
const principal = BigInt(receipt.principal);
const fee = BigInt(receipt.fee);
const acceptedOutstanding = BigInt(checks.acceptedOutstanding);
const buyerPayment = BigInt(receipt.buyerPaid);
if (
  BigInt(checks.invoiceOriginalAmount) - BigInt(checks.previouslyPaidAmount) !==
    acceptedOutstanding ||
  buyerPayment !== acceptedOutstanding
)
  throw new Error("LANDING_INVOICE_BALANCE_MISMATCH");

export const landingEvidence = {
  claimKey: receipt.claimKey,
  dealLabel: `Deal ${receipt.claimId.slice(0, 8).toUpperCase()}`,
  verifiedAt: receipt.verifiedAt,
  principal: principal.toString(),
  fee: fee.toString(),
  invoiceOriginalAmount: checks.invoiceOriginalAmount,
  previouslyPaidAmount: checks.previouslyPaidAmount,
  invoiceDueAt: checks.invoiceDueAt,
  acceptedOutstanding: acceptedOutstanding.toString(),
  buyerPayment: buyerPayment.toString(),
  lenderReceives: (principal + fee).toString(),
  supplierResidual: (buyerPayment - principal - fee).toString(),
  feePercent: Number((fee * 10_000n) / principal) / 100,
  transactions: {
    registered: transaction("REGISTER"),
    funded: transaction("POOL_FUND_CLAIM"),
    paid: transaction("COLLECT_BUYER_PAYMENT"),
    lender: transaction("POOL_HARVEST"),
    supplier: transaction("WITHDRAW_BORROWER"),
  },
};

function transaction(action: string) {
  const tx = receipt.transactions.find((item) => item.action === action);
  if (!tx) throw new Error(`LANDING_PROOF_MISSING:${action}`);
  return `https://testnet.bscscan.com/tx/${tx.hash}`;
}

export function rupiah(value: string) {
  return `Rp${new Intl.NumberFormat("id-ID").format(BigInt(value))}`;
}
