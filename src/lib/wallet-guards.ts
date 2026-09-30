import {
  decodeFunctionData,
  encodeAbiParameters,
  erc20Abi,
  getAbiItem,
  keccak256,
  type Abi,
} from "viem";
import { registryAbi, vaultAbi } from "../../packages/chain/contracts";
import type {
  ActionName,
  Claim,
  CurrentUser,
  PublicConfig,
  TransactionTemplate,
} from "../../packages/client";

function displayedContractTerms(claim: Claim) {
  const t = claim.terms;
  return {
    ...t,
    claimKey: claim.claimKey,
    version: BigInt(claim.version),
    acceptedOutstanding: BigInt(t.acceptedOutstanding),
    principal: BigInt(t.principal),
    fee: BigInt(t.fee),
    fundingDeadline: BigInt(t.fundingDeadline),
    invoiceDueAt: BigInt(t.invoiceDueAt),
    reviewExpiry: BigInt(t.reviewExpiry),
    consentExpiry: BigInt(t.consentExpiry),
  };
}
export function displayedTermsHash(claim: Claim) {
  const parameter = getAbiItem({
    abi: registryAbi,
    name: "registerApprovedClaim",
  }).inputs[0];
  return keccak256(
    encodeAbiParameters([parameter], [displayedContractTerms(claim)]),
  );
}
const consentFields = [
  { name: "claimKey", type: "bytes32" },
  { name: "version", type: "uint256" },
  { name: "termsHash", type: "bytes32" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
];
export function assertConsentPayload(
  payload: Record<string, unknown>,
  claim: Claim,
  user: CurrentUser,
  config: PublicConfig,
) {
  const domain = payload.domain as Record<string, unknown> | undefined;
  const message = payload.message as Record<string, unknown> | undefined;
  const primary = String(payload.primaryType);
  const types = payload.types as Record<string, unknown> | undefined;
  const party =
    primary === "BorrowerConsent"
      ? claim.terms.borrower
      : primary === "BuyerAcknowledgement"
        ? claim.terms.buyer
        : undefined;
  if (
    !domain ||
    !message ||
    domain.name !== "TALUNAI RWARegistry" ||
    domain.version !== "1" ||
    Number(domain.chainId) !== config.chainId ||
    String(domain.verifyingContract).toLowerCase() !==
      config.contracts.registry.toLowerCase() ||
    party?.toLowerCase() !== user.wallet.toLowerCase() ||
    message.claimKey !== claim.claimKey ||
    String(message.version) !== String(claim.version) ||
    message.termsHash !== displayedTermsHash(claim) ||
    String(message.deadline) !== String(claim.terms.consentExpiry) ||
    BigInt(String(message.deadline)) <= BigInt(Math.floor(Date.now() / 1000)) ||
    !/^(0|[1-9]\d*)$/.test(String(message.nonce)) ||
    BigInt(String(message.nonce)) >= 2n ** 256n ||
    JSON.stringify(types?.[primary]) !== JSON.stringify(consentFields) ||
    Object.keys(types ?? {}).some((key) => key !== primary) ||
    Object.keys(message).sort().join() !==
      "claimKey,deadline,nonce,termsHash,version"
  )
    throw new Error("CONSENT_DOMAIN_MISMATCH");
}
export type TransactionContext = {
  claim: Claim;
  action: ActionName;
  amount?: string;
  nonce?: string;
};
const routes: Record<
  ActionName,
  { target: "registry" | "vault" | "token"; method: string }
> = {
  REGISTER: { target: "registry", method: "registerApprovedClaim" },
  CANCEL: { target: "registry", method: "cancelBeforeFunding" },
  APPROVE_TOKEN: { target: "token", method: "approve" },
  FUND: { target: "vault", method: "fundAndDisburse" },
  COLLECT_BUYER_PAYMENT: { target: "vault", method: "collectBuyerPayment" },
  WITHDRAW_LENDER: { target: "vault", method: "withdrawLender" },
  WITHDRAW_BORROWER: { target: "vault", method: "withdrawBorrowerResidual" },
  CLEAR_HOLD: { target: "registry", method: "clearFundingHold" },
  REVOKE_CONSENT: { target: "registry", method: "invalidateConsentNonce" },
};
export function assertTransactionPayload(
  template: TransactionTemplate,
  context: TransactionContext,
  user: CurrentUser,
  config: PublicConfig,
) {
  const route = routes[context.action];
  if (
    !route ||
    template.action !== context.action ||
    template.chainId !== config.chainId ||
    template.from.toLowerCase() !== user.wallet.toLowerCase() ||
    template.to.toLowerCase() !==
      config.contracts[route.target].toLowerCase() ||
    BigInt(template.value) !== 0n
  )
    throw new Error("TRANSACTION_TEMPLATE_MISMATCH");
  const abi: Abi =
    route.target === "registry"
      ? registryAbi
      : route.target === "vault"
        ? vaultAbi
        : erc20Abi;
  const decoded = decodeFunctionData({ abi, data: template.data });
  if (decoded.functionName !== route.method)
    throw new Error("TRANSACTION_TEMPLATE_MISMATCH");
  const args = decoded.args ?? [];
  if (context.action === "APPROVE_TOKEN") {
    if (
      String(args[0]).toLowerCase() !== config.contracts.vault.toLowerCase() ||
      String(args[1]) !== (context.amount ?? context.claim.terms.principal)
    )
      throw new Error("TRANSACTION_TEMPLATE_MISMATCH");
  } else if (context.action === "REGISTER") {
    const parameter = getAbiItem({
      abi: registryAbi,
      name: "registerApprovedClaim",
    }).inputs[0];
    if (
      keccak256(
        encodeAbiParameters(
          [parameter],
          [args[0] as ReturnType<typeof displayedContractTerms>],
        ),
      ) !== displayedTermsHash(context.claim)
    )
      throw new Error("TRANSACTION_TEMPLATE_MISMATCH");
  } else if (context.action === "REVOKE_CONSENT") {
    if (context.nonce === undefined || String(args[0]) !== context.nonce)
      throw new Error("TRANSACTION_TEMPLATE_MISMATCH");
  } else if (args[0] !== context.claim.claimKey)
    throw new Error("TRANSACTION_TEMPLATE_MISMATCH");
  if (
    context.action === "COLLECT_BUYER_PAYMENT" &&
    String(args[1]) !== context.amount
  )
    throw new Error("TRANSACTION_TEMPLATE_MISMATCH");
}
