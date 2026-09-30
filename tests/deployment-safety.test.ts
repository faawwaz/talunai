import { describe, expect, it } from "vitest";
import { mnemonicToAccount } from "viem/accounts";
import { localMnemonic } from "../scripts/actors";
import {
  assertDistinctActors,
  configuredAgentAddress,
  deploymentGasBudget,
  privateKeyAddress,
  testOnlyAddress,
} from "../scripts/deployment-safety";
const agentKey = `0x${"11".repeat(32)}`;
const otherKey = `0x${"22".repeat(32)}`;
const agent = privateKeyAddress(agentKey);
const other = privateKeyAddress(otherKey);
describe("testnet deployment configuration", () => {
  it("uses the configured worker wallet for agent instead of a built-in demo account", () => {
    expect(
      configuredAgentAddress(
        { CHAIN_ID: "31337" },
        { CHAIN_ID: "31337", AGENT_PRIVATE_KEY: agentKey },
      ),
    ).toBe(agent);
  });
  it("supports address-only agent deployment with the key kept in the worker", () => {
    expect(
      configuredAgentAddress(
        { CHAIN_ID: "97", AGENT_ADDRESS: agent },
        { CHAIN_ID: "97", AGENT_PRIVATE_KEY: agentKey },
      ),
    ).toBe(agent);
  });
  it("rejects deployment/worker address mismatch before broadcasting", () => {
    expect(() =>
      configuredAgentAddress(
        { CHAIN_ID: "97", AGENT_ADDRESS: other },
        { CHAIN_ID: "97", AGENT_PRIVATE_KEY: agentKey },
      ),
    ).toThrow("AGENT_DEPLOYMENT_WORKER_MISMATCH");
  });
  it("does not silently read a worker key from a different chain", () => {
    expect(
      configuredAgentAddress(
        { CHAIN_ID: "97" },
        { CHAIN_ID: "31337", AGENT_PRIVATE_KEY: agentKey },
      ),
    ).toBeUndefined();
  });
  it("rejects public Anvil wallets on public testnet", () => {
    const local = mnemonicToAccount(localMnemonic, { addressIndex: 5 }).address;
    expect(() => testOnlyAddress(local, 97)).toThrow(
      "PUBLIC_ANVIL_KEY_FORBIDDEN_ON_TESTNET",
    );
  });
  it("rejects zero addresses and all other chains", () => {
    expect(() => testOnlyAddress(`0x${"0".repeat(40)}`, 97)).toThrow(
      "INVALID_DEPLOYMENT_ACTOR_ADDRESS",
    );
    expect(() => testOnlyAddress(agent, 56)).toThrow("UNSUPPORTED_CHAIN");
  });
  it("does not let the agent share a privileged participant wallet", () => {
    expect(() => assertDistinctActors({ agent, admin: agent }, 97)).toThrow(
      "DEMO_ACTORS_MUST_BE_DISTINCT",
    );
    expect(() =>
      assertDistinctActors({ agent, admin: other }, 97),
    ).not.toThrow();
  });
  it("redacts invalid key material from errors", () => {
    expect(() => privateKeyAddress("private-value-do-not-log")).toThrow(
      /^INVALID_TEST_PRIVATE_KEY$/,
    );
  });
  it("computes an explicit conservative budget without floating point", () => {
    expect(deploymentGasBudget(100000000n)).toEqual({
      deployerWei: 2400000000000000n,
      agentWei: 200000000000000n,
    });
    expect(() => deploymentGasBudget(0n)).toThrow("INVALID_GAS_PRICE");
  });
});
