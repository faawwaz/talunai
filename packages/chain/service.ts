import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  encodeFunctionData,
  encodeAbiParameters,
  erc20Abi,
  http,
  keccak256,
  recoverTypedDataAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import type {
  ChainPort,
  ChainClaim,
  ConsentInput,
  PrepareActionInput,
  TransactionTemplate,
} from "../api/chain-port";
import { registryAbi, vaultAbi, executorAbi } from "./contracts";
import { chainConfig, publicClient, jsonSafe } from "./config";

const fields = [
  { name: "claimKey", type: "bytes32" },
  { name: "version", type: "uint256" },
  { name: "borrower", type: "address" },
  { name: "buyer", type: "address" },
  { name: "token", type: "address" },
  { name: "acceptedOutstanding", type: "uint256" },
  { name: "principal", type: "uint256" },
  { name: "fee", type: "uint256" },
  { name: "fundingDeadline", type: "uint256" },
  { name: "invoiceDueAt", type: "uint256" },
  { name: "reviewExpiry", type: "uint256" },
  { name: "consentExpiry", type: "uint256" },
  { name: "evidenceCommitment", type: "bytes32" },
  { name: "decisionHash", type: "bytes32" },
  { name: "policyHash", type: "bytes32" },
] as const;
export function contractTerms(claim: ChainClaim) {
  const t = claim.terms;
  return {
    claimKey: claim.claimKey,
    version: BigInt(claim.version),
    borrower: t.borrower,
    buyer: t.buyer,
    token: t.token,
    acceptedOutstanding: BigInt(t.acceptedOutstanding),
    principal: BigInt(t.principal),
    fee: BigInt(t.fee),
    fundingDeadline: BigInt(t.fundingDeadline),
    invoiceDueAt: BigInt(t.invoiceDueAt),
    reviewExpiry: BigInt(t.reviewExpiry),
    consentExpiry: BigInt(t.consentExpiry),
    evidenceCommitment: t.evidenceCommitment,
    decisionHash: t.decisionHash,
    policyHash: t.policyHash,
  };
}
export const termsHash = (claim: ChainClaim) =>
  keccak256(
    encodeAbiParameters(
      [{ type: "tuple", components: fields }],
      [contractTerms(claim)],
    ),
  );
export function consentTypedData(input: ConsentInput) {
  const c = chainConfig();
  const primaryType =
    input.role === "BORROWER" ? "BorrowerConsent" : "BuyerAcknowledgement";
  if (
    input.signer.toLowerCase() !==
    (input.role === "BORROWER"
      ? input.claim.terms.borrower
      : input.claim.terms.buyer
    ).toLowerCase()
  )
    throw new Error("CONSENT_SIGNER_MISMATCH");
  if (input.deadline !== input.claim.terms.consentExpiry)
    throw new Error("CONSENT_EXPIRY_MISMATCH");
  return {
    domain: {
      name: "TALUNAI RWARegistry",
      version: "1",
      chainId: c.chainId,
      verifyingContract: c.registry,
    },
    primaryType,
    types: {
      [primaryType]: [
        { name: "claimKey", type: "bytes32" },
        { name: "version", type: "uint256" },
        { name: "termsHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    message: {
      claimKey: input.claim.claimKey,
      version: BigInt(input.claim.version),
      termsHash: termsHash(input.claim),
      nonce: BigInt(input.nonce),
      deadline: BigInt(input.deadline),
    },
  };
}
export async function validateStartup() {
  const c = chainConfig(),
    client = publicClient();
  const fallback =
    c.chainId === 97 && process.env.RPC_FALLBACK_HTTP_URL
      ? createPublicClient({
          chain: c.chain,
          transport: http(process.env.RPC_FALLBACK_HTTP_URL, {
            timeout: 10_000,
            retryCount: 0,
          }),
        })
      : null;
  const readClient = fallback ?? client;
  if ((await readClient.getChainId()) !== c.chainId)
    throw new Error(
      fallback ? "FALLBACK_CHAIN_MISMATCH" : "RPC_CHAIN_MISMATCH",
    );
  if (fallback && (await client.getChainId()) !== c.chainId)
    throw new Error("RPC_CHAIN_MISMATCH");
  const codes = await Promise.all(
    [c.registry, c.vault, c.executor, c.token].map((address) =>
      readClient.getCode({ address }),
    ),
  );
  if (codes.some((code) => !code)) throw new Error("DEPLOYMENT_CODE_MISSING");
  const reads = await Promise.all([
    readClient.readContract({
      address: c.registry,
      abi: registryAbi,
      functionName: "token",
    }),
    readClient.readContract({
      address: c.registry,
      abi: registryAbi,
      functionName: "vault",
    }),
    readClient.readContract({
      address: c.registry,
      abi: registryAbi,
      functionName: "agentExecutor",
    }),
    readClient.readContract({
      address: c.vault,
      abi: vaultAbi,
      functionName: "token",
    }),
    readClient.readContract({
      address: c.vault,
      abi: vaultAbi,
      functionName: "registry",
    }),
    readClient.readContract({
      address: c.executor,
      abi: executorAbi,
      functionName: "registry",
    }),
    readClient.readContract({
      address: c.executor,
      abi: executorAbi,
      functionName: "vault",
    }),
    readClient.readContract({
      address: c.token,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    readClient.readContract({
      address: c.registry,
      abi: registryAbi,
      functionName: "maxAdvanceBps",
    }),
    readClient.readContract({
      address: c.registry,
      abi: registryAbi,
      functionName: "flatFinancingFeeBps",
    }),
    readClient.readContract({
      address: c.registry,
      abi: registryAbi,
      functionName: "perDealPrincipalCap",
    }),
  ]);
  const expected = [
    c.token,
    c.vault,
    c.executor,
    c.token,
    c.registry,
    c.registry,
    c.vault,
    "0",
    "8000",
    "150",
    "100000000",
  ];
  if (
    reads.some((v, i) => String(v).toLowerCase() !== expected[i].toLowerCase())
  )
    throw new Error("DEPLOYMENT_CONFIGURATION_MISMATCH");
  if (fallback) {
    const [a, b] = await Promise.all([
      client.getBlockNumber(),
      fallback.getBlockNumber(),
    ]);
    const shared = (a < b ? a : b) - BigInt(c.confirmations);
    if (shared >= 0n) {
      const [x, y] = await Promise.all([
        client.getBlock({ blockNumber: shared }),
        fallback.getBlock({ blockNumber: shared }),
      ]);
      if (x.hash !== y.hash) throw new Error("RPC_CANONICAL_CONFLICT");
    }
  }
  return { chainId: c.chainId, status: "READY" };
}
export async function prepareConsent(
  input: ConsentInput,
): Promise<Record<string, unknown>> {
  await validateStartup();
  const c = chainConfig(),
    client = publicClient();
  if (await client.getCode({ address: input.signer }))
    throw new Error("UNSUPPORTED_ACCOUNT_TYPE");
  if (
    await client.readContract({
      address: c.registry,
      abi: registryAbi,
      functionName: "nonceUnavailable",
      args: [input.signer, BigInt(input.nonce)],
    })
  )
    throw new Error("CONSENT_NONCE_UNAVAILABLE");
  if (BigInt(input.deadline) <= (await client.getBlock()).timestamp)
    throw new Error("CONSENT_EXPIRED");
  return jsonSafe(consentTypedData(input));
}
export async function verifyConsent(input: ConsentInput & { signature: Hex }) {
  await prepareConsent(input);
  const recovered = await recoverTypedDataAddress({
    ...consentTypedData(input),
    signature: input.signature,
  });
  return {
    valid: recovered.toLowerCase() === input.signer.toLowerCase(),
    termsHash: termsHash(input.claim),
  };
}
export async function prepareAction(
  input: PrepareActionInput,
): Promise<TransactionTemplate> {
  await validateStartup();
  const c = chainConfig(),
    client = publicClient(),
    key = input.claim.claimKey;
  if (input.claim.terms.token.toLowerCase() !== c.token)
    throw new Error("TOKEN_MISMATCH");
  let to: Address = c.vault,
    abi: Abi = vaultAbi,
    functionName: string,
    args: readonly unknown[];
  switch (input.action) {
    case "REGISTER": {
      to = c.registry;
      abi = registryAbi;
      functionName = "registerApprovedClaim";
      const borrower = input.consents.find((x) => x.role === "BORROWER"),
        buyer = input.consents.find((x) => x.role === "BUYER");
      if (!borrower || !buyer || !input.review)
        throw new Error("APPROVALS_MISSING");
      if (
        borrower.termsHash !== termsHash(input.claim) ||
        buyer.termsHash !== termsHash(input.claim)
      )
        throw new Error("CONSENT_TERMS_CHANGED");
      args = [
        contractTerms(input.claim),
        {
          nonce: BigInt(borrower.nonce),
          deadline: BigInt(borrower.deadline),
          signature: borrower.signature,
        },
        {
          nonce: BigInt(buyer.nonce),
          deadline: BigInt(buyer.deadline),
          signature: buyer.signature,
        },
      ];
      break;
    }
    case "CANCEL":
      to = c.registry;
      abi = registryAbi;
      functionName = "cancelBeforeFunding";
      args = [key];
      break;
    case "APPROVE_TOKEN":
      to = c.token;
      abi = erc20Abi;
      functionName = "approve";
      args = [
        c.vault,
        BigInt(input.body.amount ?? input.claim.terms.principal),
      ];
      break;
    case "FUND":
      functionName = "fundAndDisburse";
      args = [key];
      break;
    case "COLLECT_BUYER_PAYMENT":
      if (!input.body.amount) throw new Error("AMOUNT_REQUIRED");
      functionName = "collectBuyerPayment";
      args = [key, BigInt(input.body.amount)];
      break;
    case "WITHDRAW_LENDER":
      functionName = "withdrawLender";
      args = [key];
      break;
    case "WITHDRAW_BORROWER":
      functionName = "withdrawBorrowerResidual";
      args = [key];
      break;
    case "CLEAR_HOLD":
      if (!input.review || !input.body.commitment)
        throw new Error("FRESH_REVIEW_REQUIRED");
      to = c.registry;
      abi = registryAbi;
      functionName = "clearFundingHold";
      args = [
        key,
        input.body.commitment,
        BigInt(input.claim.terms.reviewExpiry),
      ];
      break;
    case "REVOKE_CONSENT":
      if (input.body.nonce === undefined) throw new Error("NONCE_REQUIRED");
      to = c.registry;
      abi = registryAbi;
      functionName = "invalidateConsentNonce";
      args = [BigInt(input.body.nonce)];
      break;
  }
  await client.simulateContract({
    address: to,
    abi,
    functionName,
    args,
    account: input.sender,
  });
  return {
    chainId: c.chainId,
    from: input.sender,
    to,
    data: encodeFunctionData({ abi, functionName, args }),
    value: "0",
    simulationBlock: (await client.getBlockNumber()).toString(),
    action: input.action,
  };
}
export async function inspectObservedTransaction(input: {
  hash: Hex;
  sender: Address;
  claim?: ChainClaim;
  template?: TransactionTemplate;
}): Promise<Record<string, unknown>> {
  const c = chainConfig(),
    client = publicClient();
  if ((await client.getChainId()) !== c.chainId)
    throw new Error("RPC_CHAIN_MISMATCH");
  let tx;
  try {
    tx = await client.getTransaction({ hash: input.hash });
  } catch {
    return { status: "DROPPED_OR_UNKNOWN", hash: input.hash };
  }
  if (
    tx.from.toLowerCase() !== input.sender.toLowerCase() ||
    !tx.to ||
    ![c.registry, c.vault, c.token, c.executor].includes(
      tx.to.toLowerCase() as Address,
    )
  )
    throw new Error("TRANSACTION_ATTRIBUTION_MISMATCH");
  if (
    input.template &&
    (tx.to.toLowerCase() !== input.template.to.toLowerCase() ||
      tx.input !== input.template.data ||
      tx.value !== BigInt(input.template.value))
  )
    throw new Error("TRANSACTION_TEMPLATE_MISMATCH");
  const abi =
    tx.to.toLowerCase() === c.registry
      ? registryAbi
      : tx.to.toLowerCase() === c.vault
        ? vaultAbi
        : tx.to.toLowerCase() === c.executor
          ? executorAbi
          : erc20Abi;
  const decoded = decodeFunctionData({ abi: abi as Abi, data: tx.input });
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: input.hash });
  } catch {
    return {
      status: "SUBMITTED",
      hash: input.hash,
      nonce: tx.nonce,
      method: decoded.functionName,
    };
  }
  const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (canonical.hash !== receipt.blockHash)
    return { status: "DROPPED_OR_UNKNOWN", hash: input.hash, reason: "REORG" };
  const confirmations =
    (await client.getBlockNumber()) - receipt.blockNumber + 1n;
  if (receipt.status === "success") {
    const args = decoded.args ?? [];
    let eventName: string;
    let expected: Record<string, unknown>;
    let requirePositiveAmount = false;
    const claimKey =
      decoded.functionName === "registerApprovedClaim"
        ? (args[0] as ReturnType<typeof contractTerms>).claimKey
        : args[0];
    const claimMethods = new Set([
      "registerApprovedClaim",
      "cancelBeforeFunding",
      "setFundingHold",
      "clearFundingHold",
      "fundAndDisburse",
      "collectBuyerPayment",
      "withdrawLender",
      "withdrawBorrowerResidual",
      "proposeFundingHold",
      "recordRiskObservation",
    ]);
    if (
      input.claim &&
      claimMethods.has(decoded.functionName) &&
      String(claimKey).toLowerCase() !== input.claim.claimKey.toLowerCase()
    )
      throw new Error("TRANSACTION_EVENT_ATTRIBUTION_MISMATCH");
    switch (decoded.functionName) {
      case "registerApprovedClaim": {
        const terms = args[0] as ReturnType<typeof contractTerms>;
        eventName = "ClaimRegistered";
        expected = {
          claimKey: terms.claimKey,
          termsHash: keccak256(
            encodeAbiParameters(
              [{ type: "tuple", components: fields }],
              [terms],
            ),
          ),
          borrower: terms.borrower,
          buyer: terms.buyer,
          version: terms.version,
        };
        break;
      }
      case "cancelBeforeFunding":
        eventName = "ClaimCancelled";
        expected = { claimKey: args[0], actor: input.sender };
        break;
      case "setFundingHold":
        eventName = "FundingHoldSet";
        expected = {
          claimKey: args[0],
          actor: input.sender,
          evidenceCommitment: args[1],
        };
        break;
      case "clearFundingHold":
        eventName = "FundingHoldCleared";
        expected = {
          claimKey: args[0],
          verifier: input.sender,
          reviewHash: args[1],
          reviewExpiry: args[2],
        };
        break;
      case "invalidateConsentNonce":
        eventName = "ConsentNonceInvalidated";
        expected = { signer: input.sender, nonce: args[0] };
        break;
      case "approve":
        eventName = "Approval";
        expected = { owner: input.sender, spender: args[0], value: args[1] };
        break;
      case "fundAndDisburse": {
        const terms = input.claim
          ? contractTerms(input.claim)
          : await client.readContract({
              address: c.registry,
              abi: registryAbi,
              functionName: "getTerms",
              args: [args[0] as Hex],
              blockNumber: receipt.blockNumber,
            });
        eventName = "Funded";
        expected = {
          claimKey: args[0],
          lender: input.sender,
          borrower: terms.borrower,
          principal: terms.principal,
        };
        break;
      }
      case "collectBuyerPayment":
        eventName = "BuyerPaymentCollected";
        expected = { claimKey: args[0], buyer: input.sender, amount: args[1] };
        requirePositiveAmount = true;
        break;
      case "withdrawLender":
        eventName = "LenderWithdrawal";
        expected = { claimKey: args[0], lender: input.sender };
        requirePositiveAmount = true;
        break;
      case "withdrawBorrowerResidual":
        eventName = "BorrowerWithdrawal";
        expected = { claimKey: args[0], borrower: input.sender };
        requirePositiveAmount = true;
        break;
      case "proposeFundingHold":
        eventName = "AgentFundingHold";
        expected = {
          claimKey: args[0],
          actionId: args[1],
          evidenceCommitment: args[2],
        };
        break;
      case "recordRiskObservation":
        eventName = "RiskObservation";
        expected = {
          claimKey: args[0],
          actionId: args[1],
          evidenceCommitment: args[2],
        };
        break;
      default:
        throw new Error("TRANSACTION_EVENT_ATTRIBUTION_MISMATCH");
    }
    const matches = receipt.logs.filter((log) => {
      if (log.address.toLowerCase() !== tx.to!.toLowerCase()) return false;
      try {
        const event = decodeEventLog({
          abi: abi as Abi,
          data: log.data,
          topics: log.topics,
        });
        if (event.eventName !== eventName || !event.args) return false;
        const values = event.args as unknown as Record<string, unknown>;
        return (
          Object.entries(expected).every(
            ([key, value]) =>
              String(values[key]).toLowerCase() === String(value).toLowerCase(),
          ) &&
          (!requirePositiveAmount || BigInt(String(values.amount)) > 0n)
        );
      } catch {
        return false;
      }
    });
    if (matches.length !== 1)
      throw new Error("TRANSACTION_EVENT_ATTRIBUTION_MISMATCH");
    // Receipt retrieval, event validation, and optional term reads cross RPC boundaries.
    if (
      (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !==
      receipt.blockHash
    )
      return {
        status: "DROPPED_OR_UNKNOWN",
        hash: input.hash,
        reason: "REORG",
      };
  }
  return {
    status:
      receipt.status === "reverted"
        ? "REVERTED"
        : confirmations >= BigInt(c.confirmations)
          ? "CONFIRMED"
          : "MINED",
    hash: input.hash,
    nonce: tx.nonce,
    method: decoded.functionName,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    confirmations: confirmations.toString(),
  };
}
export const chainService: ChainPort = {
  validateStartup,
  prepareAction,
  prepareConsent,
  verifyConsent,
  inspectObservedTransaction,
};
