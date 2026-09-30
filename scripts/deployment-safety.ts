import { getAddress, isAddress, type Address, type Hex } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { localMnemonic } from "./actors";

export type DeploymentEnv = Record<string, string | undefined>;

export function testOnlyAddress(value: string, chainId: number): Address {
  if (chainId !== 97 && chainId !== 31337) throw new Error("UNSUPPORTED_CHAIN");
  if (!isAddress(value) || /^0x0{40}$/i.test(value))
    throw new Error("INVALID_DEPLOYMENT_ACTOR_ADDRESS");
  const address = getAddress(value);
  if (chainId === 97)
    for (let i = 0; i < 10; i++)
      if (
        address ===
        mnemonicToAccount(localMnemonic, { addressIndex: i }).address
      )
        throw new Error("PUBLIC_ANVIL_KEY_FORBIDDEN_ON_TESTNET");
  return address;
}

export function privateKeyAddress(key: string): Address {
  try {
    return privateKeyToAccount(key as Hex).address;
  } catch {
    // Do not include invalid private-key input in the thrown error.
    throw new Error("INVALID_TEST_PRIVATE_KEY");
  }
}

export function configuredAgentAddress(
  env: DeploymentEnv,
  worker: DeploymentEnv = {},
): Address | undefined {
  const chainId = Number(env.CHAIN_ID);
  const values: string[] = [];
  if (env.AGENT_ADDRESS) values.push(env.AGENT_ADDRESS);
  for (const key of [env.DEMO_AGENT_PRIVATE_KEY, env.AGENT_PRIVATE_KEY])
    if (key) values.push(privateKeyAddress(key));
  if (worker.CHAIN_ID === env.CHAIN_ID && worker.AGENT_PRIVATE_KEY)
    values.push(privateKeyAddress(worker.AGENT_PRIVATE_KEY));
  const addresses = values.map((value) => testOnlyAddress(value, chainId));
  if (new Set(addresses).size > 1)
    throw new Error("AGENT_DEPLOYMENT_WORKER_MISMATCH");
  return addresses[0];
}

export function assertDistinctActors(
  actors: Record<string, string>,
  chainId: number,
) {
  const addresses = Object.values(actors).map((value) =>
    testOnlyAddress(value, chainId),
  );
  if (new Set(addresses).size !== addresses.length)
    throw new Error("DEMO_ACTORS_MUST_BE_DISTINCT");
}

export function deploymentGasBudget(gasPrice: bigint) {
  if (gasPrice <= 0n) throw new Error("INVALID_GAS_PRICE");
  // Conservative funding budget, not eth_estimateGas or a guaranteed cost.
  return {
    deployerWei: 12_000_000n * gasPrice * 2n,
    agentWei: 1_000_000n * gasPrice * 2n,
  };
}
