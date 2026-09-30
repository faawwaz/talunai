import { beforeEach, describe, expect, it } from "vitest";
import { encodeFunctionData, erc20Abi, keccak256, toHex } from "viem";
import {
  assertConsentPayload,
  assertTransactionPayload,
  displayedTermsHash,
} from "../src/lib/wallet-guards";
import { consentTypedData, termsHash } from "../packages/chain/service";
import { vaultAbi, registryAbi, mockIdrAbi } from "../packages/chain/contracts";
import type {
  Claim,
  CurrentUser,
  PublicConfig,
  TransactionTemplate,
} from "../packages/client";
const address = (digit: string) => `0x${digit.repeat(40)}` as const;
const config: PublicConfig = {
  chainId: 31337,
  appEnv: "local",
  contracts: {
    registry: address("1"),
    vault: address("2"),
    agentExecutor: address("3"),
    token: address("4"),
  },
  paymentToken: { symbol: "MockIDR", decimals: 0 },
  isSynthetic: true,
  llmMode: "mock",
  confirmations: 2,
  accountTypes: ["EOA"],
  disclosures: [],
};
const now = Math.floor(Date.now() / 1000);
const claim: Claim = {
  id: "claim",
  assetType: "TRADE_RECEIVABLE",
  goods: null,
  claimKey: keccak256(toHex("claim")),
  version: 4,
  workflow: "READY_FOR_SIGNATURES",
  organizationId: "org1",
  buyerOrganizationId: "org2",
  invoiceNumber: "INV001",
  invoiceNamespace: "2026",
  evidence: {},
  fundingHold: false,
  hasDispute: false,
  isSynthetic: true,
  terms: {
    borrower: address("5"),
    buyer: address("6"),
    token: config.contracts.token,
    acceptedOutstanding: "100000000",
    principal: "70000000",
    fee: "1050000",
    fundingDeadline: now + 3600,
    invoiceDueAt: now + 45 * 86400,
    reviewExpiry: now + 3600,
    consentExpiry: now + 3600,
    evidenceCommitment: keccak256(toHex("evidence")),
    decisionHash: keccak256(toHex("decision")),
    policyHash: keccak256(toHex("policy")),
  },
};
const user: CurrentUser = {
  userId: "user",
  wallet: claim.terms.borrower,
  status: "APPROVED",
  memberships: [],
};
beforeEach(() => {
  Object.assign(process.env, {
    APP_ENV: "local",
    CHAIN_ID: "31337",
    RPC_HTTP_URL: "http://127.0.0.1:8545",
    CHAIN_CONFIRMATIONS: "2",
    INDEXER_RESCAN_BLOCKS: "20",
    DEPLOYMENT_START_BLOCK: "0",
    CONTRACT_REGISTRY_ADDRESS: config.contracts.registry,
    CONTRACT_VAULT_ADDRESS: config.contracts.vault,
    CONTRACT_AGENT_EXECUTOR_ADDRESS: config.contracts.agentExecutor,
    MOCK_IDR_ADDRESS: config.contracts.token,
  });
});
function consent() {
  return consentTypedData({
    claim,
    role: "BORROWER",
    signer: user.wallet,
    nonce: "7",
    deadline: claim.terms.consentExpiry,
  });
}
function transaction(): TransactionTemplate {
  return {
    chainId: 31337,
    from: user.wallet,
    to: config.contracts.vault,
    data: encodeFunctionData({
      abi: vaultAbi,
      functionName: "fundAndDisburse",
      args: [claim.claimKey],
    }),
    value: "0",
    action: "FUND",
  };
}
describe("wallet payload defense independent of API", () => {
  it("revokes only the nonce explicitly reviewed by the signer", () => {
    const tx = {
      ...transaction(),
      to: config.contracts.registry,
      action: "REVOKE_CONSENT",
      data: encodeFunctionData({
        abi: registryAbi,
        functionName: "invalidateConsentNonce",
        args: [7n],
      }),
    };
    expect(() =>
      assertTransactionPayload(
        tx,
        { claim, action: "REVOKE_CONSENT", nonce: "7" },
        user,
        config,
      ),
    ).not.toThrow();
    expect(() =>
      assertTransactionPayload(
        tx,
        { claim, action: "REVOKE_CONSENT", nonce: "8" },
        user,
        config,
      ),
    ).toThrow("TRANSACTION_TEMPLATE_MISMATCH");
    expect(() =>
      assertTransactionPayload(
        tx,
        { claim, action: "REVOKE_CONSENT" },
        user,
        config,
      ),
    ).toThrow("TRANSACTION_TEMPLATE_MISMATCH");
  });
  it("browser terms commitment equals backend commitment exactly", () =>
    expect(displayedTermsHash(claim)).toBe(termsHash(claim)));
  it("accepts actual backend EIP712 and rejects changed domain/version/recipient/amount/type", () => {
    expect(() =>
      assertConsentPayload(consent(), claim, user, config),
    ).not.toThrow();
    expect(() =>
      assertConsentPayload(
        { ...consent(), domain: { ...consent().domain, version: "2" } },
        claim,
        user,
        config,
      ),
    ).toThrow();
    expect(() =>
      assertConsentPayload(
        { ...consent(), domain: { ...consent().domain, chainId: 97 } },
        claim,
        user,
        config,
      ),
    ).toThrow();
    expect(() =>
      assertConsentPayload(
        consent(),
        { ...claim, terms: { ...claim.terms, principal: "60000000" } },
        user,
        config,
      ),
    ).toThrow();
    expect(() =>
      assertConsentPayload(
        consent(),
        claim,
        { ...user, wallet: claim.terms.buyer },
        config,
      ),
    ).toThrow();
    expect(() =>
      assertConsentPayload(
        { ...consent(), primaryType: "BuyerAcknowledgement" },
        claim,
        user,
        config,
      ),
    ).toThrow();
  });
  it("rejects wrong claim version and altered schema", () => {
    expect(() =>
      assertConsentPayload(consent(), { ...claim, version: 5 }, user, config),
    ).toThrow();
    expect(() =>
      assertConsentPayload(
        {
          ...consent(),
          types: { BorrowerConsent: [{ name: "amount", type: "uint256" }] },
        },
        claim,
        user,
        config,
      ),
    ).toThrow();
  });
  it("accepts exact funding but rejects unrelated claim and calldata even at configured address", () => {
    expect(() =>
      assertTransactionPayload(
        transaction(),
        { claim, action: "FUND" },
        user,
        config,
      ),
    ).not.toThrow();
    expect(() =>
      assertTransactionPayload(
        {
          ...transaction(),
          data: encodeFunctionData({
            abi: vaultAbi,
            functionName: "fundAndDisburse",
            args: [keccak256(toHex("other"))],
          }),
        },
        { claim, action: "FUND" },
        user,
        config,
      ),
    ).toThrow();
    expect(() =>
      assertTransactionPayload(
        {
          ...transaction(),
          to: config.contracts.token,
          data: encodeFunctionData({
            abi: mockIdrAbi,
            functionName: "mint",
            args: [user.wallet, 1n],
          }),
        },
        { claim, action: "FUND" },
        user,
        config,
      ),
    ).toThrow();
    expect(() =>
      assertTransactionPayload(
        {
          ...transaction(),
          to: config.contracts.registry,
          data: encodeFunctionData({
            abi: registryAbi,
            functionName: "grantRole",
            args: [keccak256(toHex("ADMIN")), user.wallet],
          }),
        },
        { claim, action: "FUND" },
        user,
        config,
      ),
    ).toThrow();
  });
  it("approves only displayed exact amount to configured vault", () => {
    const tx = {
      ...transaction(),
      to: config.contracts.token,
      action: "APPROVE_TOKEN",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [config.contracts.vault, 70000000n],
      }),
    };
    expect(() =>
      assertTransactionPayload(
        tx,
        { claim, action: "APPROVE_TOKEN" },
        user,
        config,
      ),
    ).not.toThrow();
    expect(() =>
      assertTransactionPayload(
        {
          ...tx,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [config.contracts.vault, 2n ** 256n - 1n],
          }),
        },
        { claim, action: "APPROVE_TOKEN" },
        user,
        config,
      ),
    ).toThrow();
    expect(() =>
      assertTransactionPayload(
        {
          ...tx,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [address("7"), 70000000n],
          }),
        },
        { claim, action: "APPROVE_TOKEN" },
        user,
        config,
      ),
    ).toThrow();
  });
  it("cannot send native value, wrong sender, wrong chain or executor actions", () => {
    for (const altered of [
      { ...transaction(), value: "1" },
      { ...transaction(), from: address("7") },
      { ...transaction(), chainId: 56 },
      { ...transaction(), to: config.contracts.agentExecutor },
    ])
      expect(() =>
        assertTransactionPayload(
          altered,
          { claim, action: "FUND" },
          user,
          config,
        ),
      ).toThrow();
  });
});
