import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeFunctionData,
  encodeEventTopics,
  encodeAbiParameters,
  erc20Abi,
  keccak256,
  toHex,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type {
  ChainClaim,
  ConsentInput,
  TransactionTemplate,
} from "../packages/api/chain-port";
import {
  vaultAbi,
  registryAbi,
  executorAbi,
} from "../packages/chain/contracts";

const rpc = vi.hoisted(() => ({
  getChainId: vi.fn(),
  getCode: vi.fn(),
  readContract: vi.fn(),
  getBlock: vi.fn(),
  getBlockNumber: vi.fn(),
  getTransaction: vi.fn(),
  getTransactionReceipt: vi.fn(),
  simulateContract: vi.fn(),
}));
vi.mock("../packages/chain/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../packages/chain/config")>()),
  publicClient: () => rpc,
}));
import { chainConfig } from "../packages/chain/config";
import {
  consentTypedData,
  contractTerms,
  inspectObservedTransaction,
  prepareConsent,
  termsHash,
  validateStartup,
  verifyConsent,
} from "../packages/chain/service";

const addresses = {
  registry: "0x1000000000000000000000000000000000000001",
  vault: "0x2000000000000000000000000000000000000002",
  executor: "0x3000000000000000000000000000000000000003",
  token: "0x4000000000000000000000000000000000000004",
} as const;
const borrower = privateKeyToAccount(`0x${"11".repeat(32)}`);
const buyer = privateKeyToAccount(`0x${"22".repeat(32)}`);
const lender = privateKeyToAccount(`0x${"33".repeat(32)}`);
const blockHash = keccak256(toHex("canonical-block"));
const transactionHash = keccak256(toHex("transaction"));
const now = 1800000000;
function claim(): ChainClaim {
  return {
    id: "unit-synthetic",
    claimKey: keccak256(toHex("claim")),
    version: 3,
    workflow: "READY_FOR_SIGNATURES",
    fundingHold: false,
    hasDispute: false,
    terms: {
      borrower: borrower.address,
      buyer: buyer.address,
      token: addresses.token,
      acceptedOutstanding: "100000000",
      principal: "70000000",
      fee: "1050000",
      fundingDeadline: now + 3600,
      invoiceDueAt: now + 45 * 86400,
      reviewExpiry: now + 7200,
      consentExpiry: now + 7200,
      evidenceCommitment: keccak256(toHex("salted-evidence")),
      decisionHash: keccak256(toHex("decision")),
      policyHash: keccak256(toHex("policy")),
    },
  };
}
function consent(): ConsentInput {
  const c = claim();
  return {
    claim: c,
    role: "BORROWER",
    signer: borrower.address,
    nonce: "7",
    deadline: c.terms.consentExpiry,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const [key, value] of Object.entries({
    APP_ENV: "local",
    CHAIN_ID: "31337",
    RPC_HTTP_URL: "http://127.0.0.1:18546",
    CHAIN_CONFIRMATIONS: "2",
    INDEXER_RESCAN_BLOCKS: "20",
    DEPLOYMENT_START_BLOCK: "1",
    CONTRACT_REGISTRY_ADDRESS: addresses.registry,
    CONTRACT_VAULT_ADDRESS: addresses.vault,
    CONTRACT_AGENT_EXECUTOR_ADDRESS: addresses.executor,
    MOCK_IDR_ADDRESS: addresses.token,
  }))
    vi.stubEnv(key, value);
  vi.stubEnv("RPC_FALLBACK_HTTP_URL", "");
  rpc.getChainId.mockResolvedValue(31337);
  rpc.getCode.mockImplementation(async ({ address }: { address: Address }) =>
    Object.values(addresses).includes(address as never) ? "0x6000" : undefined,
  );
  rpc.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) =>
      ({
        token: addresses.token,
        vault: addresses.vault,
        agentExecutor: addresses.executor,
        registry: addresses.registry,
        decimals: 0,
        maxAdvanceBps: 8000n,
        flatFinancingFeeBps: 150n,
        perDealPrincipalCap: 100000000n,
        nonceUnavailable: false,
      })[functionName],
  );
  rpc.getBlock.mockResolvedValue({
    hash: blockHash,
    timestamp: BigInt(now),
    number: 10n,
  });
  rpc.getBlockNumber.mockResolvedValue(10n);
});
afterEach(() => vi.unstubAllEnvs());

describe("chain startup rejects unsafe configuration", () => {
  it("checks live RPC chain, deployed endpoints, token and deterministic policy", async () => {
    await expect(validateStartup()).resolves.toEqual({
      chainId: 31337,
      status: "READY",
    });
    expect(rpc.getCode).toHaveBeenCalledTimes(4);
    expect(rpc.readContract).toHaveBeenCalledTimes(11);
  });
  it("rejects RPC chain mismatch before building any transaction", async () => {
    rpc.getChainId.mockResolvedValue(56);
    await expect(validateStartup()).rejects.toThrow("RPC_CHAIN_MISMATCH");
    expect(rpc.simulateContract).not.toHaveBeenCalled();
  });
  it.each(["56", "1", "42161"])("rejects unsupported chain %s", (chain) => {
    vi.stubEnv("CHAIN_ID", chain);
    expect(() => chainConfig()).toThrow("UNSUPPORTED_CHAIN");
  });
  it("rejects missing deployment code and a substituted token", async () => {
    rpc.getCode.mockResolvedValueOnce(undefined);
    await expect(validateStartup()).rejects.toThrow("DEPLOYMENT_CODE_MISSING");
    rpc.getCode.mockResolvedValue("0x6000");
    rpc.readContract.mockResolvedValueOnce(buyer.address);
    await expect(validateStartup()).rejects.toThrow(
      "DEPLOYMENT_CONFIGURATION_MISMATCH",
    );
  });
  it("rejects mainnet, local/testnet mismatch, zero addresses and invalid confirmations", () => {
    vi.stubEnv("CHAIN_ID", "97");
    expect(() => chainConfig()).toThrow("LOCAL_CHAIN_REQUIRED");
    vi.stubEnv("CHAIN_ID", "31337");
    vi.stubEnv("MOCK_IDR_ADDRESS", `0x${"0".repeat(40)}`);
    expect(() => chainConfig()).toThrow("CONFIG_ADDRESS");
    vi.stubEnv("MOCK_IDR_ADDRESS", addresses.token);
    vi.stubEnv("CHAIN_CONFIRMATIONS", "0");
    expect(() => chainConfig()).toThrow("INVALID_CONFIRMATIONS");
  });
});

describe("EIP-712 exact term and authority binding", () => {
  it("verifies a real EOA signature and reports the complete terms hash", async () => {
    const input = consent();
    const signature = await borrower.signTypedData(consentTypedData(input));
    await expect(verifyConsent({ ...input, signature })).resolves.toEqual({
      valid: true,
      termsHash: termsHash(input.claim),
    });
  });
  it("binds consent type, nonce, version, principal, recipient, evidence and deployment", async () => {
    const input = consent();
    const signature = await borrower.signTypedData(consentTypedData(input));
    const changed: ConsentInput[] = [
      { ...input, nonce: "8" },
      { ...input, claim: { ...input.claim, version: 4 } },
      {
        ...input,
        claim: {
          ...input.claim,
          terms: { ...input.claim.terms, principal: "60000000", fee: "900000" },
        },
      },
      {
        ...input,
        claim: {
          ...input.claim,
          terms: { ...input.claim.terms, buyer: addresses.executor },
        },
      },
      {
        ...input,
        claim: {
          ...input.claim,
          terms: {
            ...input.claim.terms,
            evidenceCommitment: keccak256(toHex("other-evidence")),
          },
        },
      },
      { ...input, role: "BUYER", signer: buyer.address },
    ];
    for (const modified of changed)
      expect((await verifyConsent({ ...modified, signature })).valid).toBe(
        false,
      );
    vi.stubEnv("CONTRACT_REGISTRY_ADDRESS", addresses.executor);
    // RPC configuration must be reconfigured to a second real registry before signature validation.
    const original = consentTypedData(input);
    vi.stubEnv("CONTRACT_REGISTRY_ADDRESS", addresses.registry);
    expect(original.domain.verifyingContract).not.toBe(
      consentTypedData(input).domain.verifyingContract,
    );
    const { recoverTypedDataAddress } = await import("viem");
    expect(
      (await recoverTypedDataAddress({ ...original, signature })).toLowerCase(),
    ).not.toBe(borrower.address.toLowerCase());
  });
  it("binds chain ID and disallows cross-role signer substitution", async () => {
    const input = consent();
    const signature = await borrower.signTypedData(consentTypedData(input));
    vi.stubEnv("APP_ENV", "testnet");
    vi.stubEnv("CHAIN_ID", "97");
    const { recoverTypedDataAddress } = await import("viem");
    expect(
      (
        await recoverTypedDataAddress({ ...consentTypedData(input), signature })
      ).toLowerCase(),
    ).not.toBe(borrower.address.toLowerCase());
    expect(() => consentTypedData({ ...input, signer: buyer.address })).toThrow(
      "CONSENT_SIGNER_MISMATCH",
    );
    expect(() =>
      consentTypedData({ ...input, deadline: input.deadline + 1 }),
    ).toThrow("CONSENT_EXPIRY_MISMATCH");
  });
  it("rejects expired/revoked nonce and unsupported contract wallet explicitly", async () => {
    const input = consent();
    rpc.readContract.mockImplementation(
      async ({ functionName }: { functionName: string }) =>
        ({
          token: addresses.token,
          vault: addresses.vault,
          agentExecutor: addresses.executor,
          registry: addresses.registry,
          decimals: 0,
          maxAdvanceBps: 8000n,
          flatFinancingFeeBps: 150n,
          perDealPrincipalCap: 100000000n,
          nonceUnavailable: true,
        })[functionName],
    );
    await expect(prepareConsent(input)).rejects.toThrow(
      "CONSENT_NONCE_UNAVAILABLE",
    );
    rpc.readContract.mockImplementation(
      async ({ functionName }: { functionName: string }) =>
        ({
          token: addresses.token,
          vault: addresses.vault,
          agentExecutor: addresses.executor,
          registry: addresses.registry,
          decimals: 0,
          maxAdvanceBps: 8000n,
          flatFinancingFeeBps: 150n,
          perDealPrincipalCap: 100000000n,
          nonceUnavailable: false,
        })[functionName],
    );
    rpc.getBlock.mockResolvedValue({ timestamp: BigInt(input.deadline + 1) });
    await expect(prepareConsent(input)).rejects.toThrow("CONSENT_EXPIRED");
    rpc.getCode.mockResolvedValue("0x6000");
    await expect(prepareConsent(input)).rejects.toThrow(
      "UNSUPPORTED_ACCOUNT_TYPE",
    );
  });
  it("retains financial integers beyond Number.MAX_SAFE_INTEGER exactly", () => {
    const c = claim();
    c.terms.acceptedOutstanding = "100000000000000000000000000000000001";
    expect(contractTerms(c).acceptedOutstanding).toBe(
      100000000000000000000000000000000001n,
    );
    const changed = structuredClone(c);
    changed.terms.acceptedOutstanding = "100000000000000000000000000000000002";
    expect(termsHash(changed)).not.toBe(termsHash(c));
  });
});

function eventLog(
  abi: Abi,
  eventName: string,
  address: Address,
  args: Record<string, unknown>,
) {
  const event = abi.find(
    (item): item is AbiEvent =>
      item.type === "event" && item.name === eventName,
  );
  if (!event) throw new Error("TEST_EVENT_NOT_FOUND");
  const plain = event.inputs.filter((input) => !input.indexed);
  return {
    address,
    topics: encodeEventTopics({ abi, eventName, args }),
    data: encodeAbiParameters(
      plain,
      plain.map((input) => args[input.name!]),
    ),
  };
}

describe("transaction observation never treats hints as finality", () => {
  function transaction() {
    const data = encodeFunctionData({
      abi: vaultAbi,
      functionName: "fundAndDisburse",
      args: [claim().claimKey],
    });
    const template: TransactionTemplate = {
      chainId: 31337,
      from: lender.address,
      to: addresses.vault,
      data,
      value: "0",
    };
    rpc.getTransaction.mockResolvedValue({
      from: lender.address,
      to: addresses.vault,
      input: data,
      value: 0n,
      nonce: 4,
    });
    rpc.getTransactionReceipt.mockResolvedValue({
      status: "success",
      blockNumber: 10n,
      blockHash,
      logs: [
        eventLog(vaultAbi, "Funded", addresses.vault, {
          claimKey: claim().claimKey,
          lender: lender.address,
          borrower: borrower.address,
          principal: 70000000n,
        }),
      ],
    });
    return {
      hash: transactionHash,
      sender: lender.address,
      claim: claim(),
      template,
    };
  }
  it("classifies timeout/unknown broadcast without reporting failure or success", async () => {
    const input = transaction();
    rpc.getTransaction.mockRejectedValue(new Error("timeout"));
    await expect(inspectObservedTransaction(input)).resolves.toMatchObject({
      status: "DROPPED_OR_UNKNOWN",
    });
  });
  it("rejects sender, target, calldata and value mismatch", async () => {
    const input = transaction();
    await expect(
      inspectObservedTransaction({ ...input, sender: buyer.address }),
    ).rejects.toThrow("TRANSACTION_ATTRIBUTION_MISMATCH");
    for (const template of [
      { ...input.template, to: addresses.registry },
      { ...input.template, data: "0x" as Hex },
      { ...input.template, value: "1" },
    ])
      await expect(
        inspectObservedTransaction({ ...input, template }),
      ).rejects.toThrow("TRANSACTION_TEMPLATE_MISMATCH");
  });
  it("distinguishes submitted, mined, confirmed and reverted", async () => {
    const input = transaction();
    rpc.getTransactionReceipt.mockRejectedValueOnce(new Error("pending"));
    await expect(inspectObservedTransaction(input)).resolves.toMatchObject({
      status: "SUBMITTED",
    });
    await expect(inspectObservedTransaction(input)).resolves.toMatchObject({
      status: "MINED",
    });
    rpc.getBlockNumber.mockResolvedValue(11n);
    await expect(inspectObservedTransaction(input)).resolves.toMatchObject({
      status: "CONFIRMED",
    });
    rpc.getTransactionReceipt.mockResolvedValue({
      status: "reverted",
      blockNumber: 10n,
      blockHash,
      logs: [],
    });
    await expect(inspectObservedTransaction(input)).resolves.toMatchObject({
      status: "REVERTED",
    });
  });
  it("requires matching event claim, payer, beneficiary, principal and exact emitting contract", async () => {
    const input = transaction();
    const expected = {
      claimKey: claim().claimKey,
      lender: lender.address,
      borrower: borrower.address,
      principal: 70000000n,
    };
    const variants = [
      [],
      [eventLog(vaultAbi, "Funded", addresses.registry, expected)],
      [
        eventLog(vaultAbi, "Funded", addresses.vault, {
          ...expected,
          claimKey: keccak256(toHex("another-claim")),
        }),
      ],
      [
        eventLog(vaultAbi, "Funded", addresses.vault, {
          ...expected,
          lender: buyer.address,
        }),
      ],
      [
        eventLog(vaultAbi, "Funded", addresses.vault, {
          ...expected,
          borrower: buyer.address,
        }),
      ],
      [
        eventLog(vaultAbi, "Funded", addresses.vault, {
          ...expected,
          principal: 70000001n,
        }),
      ],
      [
        eventLog(vaultAbi, "Funded", addresses.vault, expected),
        eventLog(vaultAbi, "Funded", addresses.vault, expected),
      ],
    ];
    for (const logs of variants) {
      rpc.getTransactionReceipt.mockResolvedValue({
        status: "success",
        blockNumber: 10n,
        blockHash,
        logs,
      });
      await expect(inspectObservedTransaction(input)).rejects.toThrow(
        "TRANSACTION_EVENT_ATTRIBUTION_MISMATCH",
      );
    }
  });
  it("binds approvals and nonce revocations to the actual owner and nonce", async () => {
    const template: TransactionTemplate = {
      chainId: 31337,
      from: buyer.address,
      to: addresses.token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [addresses.vault, 123n],
      }),
      value: "0",
    };
    rpc.getTransaction.mockResolvedValue({
      from: buyer.address,
      to: addresses.token,
      input: template.data,
      value: 0n,
      nonce: 1,
    });
    rpc.getTransactionReceipt.mockResolvedValue({
      status: "success",
      blockNumber: 10n,
      blockHash,
      logs: [
        eventLog(erc20Abi, "Approval", addresses.token, {
          owner: buyer.address,
          spender: addresses.vault,
          value: 123n,
        }),
      ],
    });
    await expect(
      inspectObservedTransaction({
        hash: transactionHash,
        sender: buyer.address,
        template,
      }),
    ).resolves.toMatchObject({ status: "MINED" });
    rpc.getTransactionReceipt.mockResolvedValue({
      status: "success",
      blockNumber: 10n,
      blockHash,
      logs: [
        eventLog(erc20Abi, "Approval", addresses.token, {
          owner: borrower.address,
          spender: addresses.vault,
          value: 123n,
        }),
      ],
    });
    await expect(
      inspectObservedTransaction({
        hash: transactionHash,
        sender: buyer.address,
        template,
      }),
    ).rejects.toThrow("TRANSACTION_EVENT_ATTRIBUTION_MISMATCH");
    template.to = addresses.registry;
    template.data = encodeFunctionData({
      abi: registryAbi,
      functionName: "invalidateConsentNonce",
      args: [9n],
    });
    rpc.getTransaction.mockResolvedValue({
      from: buyer.address,
      to: template.to,
      input: template.data,
      value: 0n,
      nonce: 2,
    });
    rpc.getTransactionReceipt.mockResolvedValue({
      status: "success",
      blockNumber: 10n,
      blockHash,
      logs: [
        eventLog(registryAbi, "ConsentNonceInvalidated", addresses.registry, {
          signer: buyer.address,
          nonce: 9n,
        }),
      ],
    });
    await expect(
      inspectObservedTransaction({
        hash: transactionHash,
        sender: buyer.address,
        template,
      }),
    ).resolves.toMatchObject({ status: "MINED" });
    rpc.getTransactionReceipt.mockResolvedValue({
      status: "success",
      blockNumber: 10n,
      blockHash,
      logs: [
        eventLog(registryAbi, "ConsentNonceInvalidated", addresses.registry, {
          signer: buyer.address,
          nonce: 10n,
        }),
      ],
    });
    await expect(
      inspectObservedTransaction({
        hash: transactionHash,
        sender: buyer.address,
        template,
      }),
    ).rejects.toThrow("TRANSACTION_EVENT_ATTRIBUTION_MISMATCH");
  });
  it("binds registry registration, cancellation and human hold review events to exact terms", async () => {
    const c = claim(),
      t = contractTerms(c),
      reviewHash = keccak256(toHex("fresh-review"));
    const consent = {
      nonce: 1n,
      deadline: BigInt(c.terms.consentExpiry),
      signature: "0x00" as Hex,
    };
    const cases = [
      {
        method: "registerApprovedClaim",
        args: [t, consent, consent],
        event: "ClaimRegistered",
        eventArgs: {
          claimKey: c.claimKey,
          termsHash: termsHash(c),
          borrower: borrower.address,
          buyer: buyer.address,
          version: 3n,
        },
      },
      {
        method: "cancelBeforeFunding",
        args: [c.claimKey],
        event: "ClaimCancelled",
        eventArgs: { claimKey: c.claimKey, actor: lender.address },
      },
      {
        method: "clearFundingHold",
        args: [c.claimKey, reviewHash, BigInt(c.terms.reviewExpiry)],
        event: "FundingHoldCleared",
        eventArgs: {
          claimKey: c.claimKey,
          verifier: lender.address,
          reviewHash,
          reviewExpiry: BigInt(c.terms.reviewExpiry),
        },
      },
    ];
    for (const item of cases) {
      const data = encodeFunctionData({
        abi: registryAbi as Abi,
        functionName: item.method,
        args: item.args,
      });
      rpc.getTransaction.mockResolvedValue({
        from: lender.address,
        to: addresses.registry,
        input: data,
        value: 0n,
        nonce: 3,
      });
      rpc.getTransactionReceipt.mockResolvedValue({
        status: "success",
        blockNumber: 10n,
        blockHash,
        logs: [
          eventLog(registryAbi, item.event, addresses.registry, item.eventArgs),
        ],
      });
      await expect(
        inspectObservedTransaction({
          hash: transactionHash,
          sender: lender.address,
          claim: c,
        }),
      ).resolves.toMatchObject({ status: "MINED" });
      rpc.getTransactionReceipt.mockResolvedValue({
        status: "success",
        blockNumber: 10n,
        blockHash,
        logs: [],
      });
      await expect(
        inspectObservedTransaction({
          hash: transactionHash,
          sender: lender.address,
          claim: c,
        }),
      ).rejects.toThrow("TRANSACTION_EVENT_ATTRIBUTION_MISMATCH");
    }
  });
  it("checks collection, earned withdrawals and agent action commitments against their events", async () => {
    const key = claim().claimKey,
      actionId = keccak256(toHex("agent-action")),
      evidenceCommitment = keccak256(toHex("evidence"));
    const cases: Array<{
      abi: Abi;
      target: Address;
      method: string;
      args: readonly unknown[];
      event: string;
      eventArgs: Record<string, unknown>;
      sender: Address;
    }> = [
      {
        abi: vaultAbi,
        target: addresses.vault,
        method: "collectBuyerPayment",
        args: [key, 50n],
        event: "BuyerPaymentCollected",
        eventArgs: {
          claimKey: key,
          buyer: buyer.address,
          amount: 50n,
          totalCollected: 50n,
        },
        sender: buyer.address,
      },
      {
        abi: vaultAbi,
        target: addresses.vault,
        method: "withdrawLender",
        args: [key],
        event: "LenderWithdrawal",
        eventArgs: { claimKey: key, lender: lender.address, amount: 50n },
        sender: lender.address,
      },
      {
        abi: vaultAbi,
        target: addresses.vault,
        method: "withdrawBorrowerResidual",
        args: [key],
        event: "BorrowerWithdrawal",
        eventArgs: { claimKey: key, borrower: borrower.address, amount: 10n },
        sender: borrower.address,
      },
      {
        abi: executorAbi,
        target: addresses.executor,
        method: "proposeFundingHold",
        args: [key, actionId, evidenceCommitment],
        event: "AgentFundingHold",
        eventArgs: { claimKey: key, actionId, evidenceCommitment },
        sender: lender.address,
      },
      {
        abi: executorAbi,
        target: addresses.executor,
        method: "recordRiskObservation",
        args: [key, actionId, evidenceCommitment],
        event: "RiskObservation",
        eventArgs: { claimKey: key, actionId, evidenceCommitment },
        sender: lender.address,
      },
    ];
    for (const c of cases) {
      const data = encodeFunctionData({
        abi: c.abi,
        functionName: c.method,
        args: c.args,
      });
      rpc.getTransaction.mockResolvedValue({
        from: c.sender,
        to: c.target,
        input: data,
        value: 0n,
        nonce: 3,
      });
      rpc.getTransactionReceipt.mockResolvedValue({
        status: "success",
        blockNumber: 10n,
        blockHash,
        logs: [eventLog(c.abi, c.event, c.target, c.eventArgs)],
      });
      await expect(
        inspectObservedTransaction({
          hash: transactionHash,
          sender: c.sender,
          claim: claim(),
        }),
      ).resolves.toMatchObject({ status: "MINED" });
      rpc.getTransactionReceipt.mockResolvedValue({
        status: "success",
        blockNumber: 10n,
        blockHash,
        logs: [
          eventLog(c.abi, c.event, c.target, {
            ...c.eventArgs,
            claimKey: keccak256(toHex("wrong-claim")),
          }),
        ],
      });
      await expect(
        inspectObservedTransaction({
          hash: transactionHash,
          sender: c.sender,
          claim: claim(),
        }),
      ).rejects.toThrow("TRANSACTION_EVENT_ATTRIBUTION_MISMATCH");
    }
  });
  it("marks receipts from orphan blocks unknown", async () => {
    const input = transaction();
    rpc.getBlock.mockResolvedValue({
      hash: keccak256(toHex("replacement-block")),
    });
    await expect(inspectObservedTransaction(input)).resolves.toMatchObject({
      status: "DROPPED_OR_UNKNOWN",
      reason: "REORG",
    });
  });
});
