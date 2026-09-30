import type { Address, Hex } from "viem";
export type ClaimTerms = {
  borrower: Address;
  buyer: Address;
  token: Address;
  acceptedOutstanding: string;
  principal: string;
  fee: string;
  fundingDeadline: number;
  invoiceDueAt: number;
  reviewExpiry: number;
  consentExpiry: number;
  evidenceCommitment: Hex;
  decisionHash: Hex;
  policyHash: Hex;
};
export type ChainClaim = {
  id: string;
  claimKey: Hex;
  version: number;
  terms: ClaimTerms;
  workflow: string;
  fundingHold: boolean;
  hasDispute: boolean;
};
export const actionNames = [
  "REGISTER",
  "CANCEL",
  "APPROVE_TOKEN",
  "FUND",
  "COLLECT_BUYER_PAYMENT",
  "WITHDRAW_LENDER",
  "WITHDRAW_BORROWER",
  "CLEAR_HOLD",
  "REVOKE_CONSENT",
] as const;
export type ActionName = (typeof actionNames)[number];
export type ConsentRecord = {
  role: "BORROWER" | "BUYER";
  signer: Address;
  nonce: string;
  deadline: number;
  signature: Hex;
  termsHash: Hex;
};
export type ConsentInput = {
  claim: ChainClaim;
  role: "BORROWER" | "BUYER";
  signer: Address;
  nonce: string;
  deadline: number;
};
export type PrepareActionInput = {
  action: ActionName;
  claim: ChainClaim;
  sender: Address;
  body: { amount?: string; nonce?: string; commitment?: Hex };
  consents: ConsentRecord[];
  review: Record<string, unknown> | null;
};
export type TransactionTemplate = {
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  value: string;
  [key: string]: unknown;
};
export interface ChainPort {
  validateStartup(): Promise<unknown>;
  prepareAction(input: PrepareActionInput): Promise<TransactionTemplate>;
  prepareConsent(input: ConsentInput): Promise<Record<string, unknown>>;
  verifyConsent(
    input: ConsentInput & { signature: Hex },
  ): Promise<{ valid: boolean; termsHash: Hex }>;
  inspectObservedTransaction(input: {
    hash: Hex;
    sender: Address;
    claim?: ChainClaim;
    template?: TransactionTemplate;
  }): Promise<Record<string, unknown>>;
}
