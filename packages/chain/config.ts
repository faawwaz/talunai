import {
  createPublicClient,
  fallback,
  http,
  isAddress,
  type Address,
  type Hex,
  type Chain,
} from "viem";
import { anvil, bscTestnet } from "viem/chains";
function required(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`CONFIG_MISSING:${key}`);
  return value;
}
function address(key: string): Address {
  const value = required(key);
  if (!isAddress(value) || /^0x0{40}$/i.test(value))
    throw new Error(`CONFIG_ADDRESS:${key}`);
  return value.toLowerCase() as Address;
}
export function chainConfig() {
  const chainId = Number(required("CHAIN_ID"));
  if (chainId !== 31337 && chainId !== 97) throw new Error("UNSUPPORTED_CHAIN");
  if (process.env.APP_ENV === "local" && chainId !== 31337)
    throw new Error("LOCAL_CHAIN_REQUIRED");
  if (process.env.APP_ENV === "testnet" && chainId !== 97)
    throw new Error("TESTNET_CHAIN_REQUIRED");
  const rpc = required("RPC_HTTP_URL");
  const confirmations = Number(
    process.env.CHAIN_CONFIRMATIONS ?? (chainId === 31337 ? 1 : 3),
  );
  const rescan = Number(process.env.INDEXER_RESCAN_BLOCKS ?? 64);
  if (
    !Number.isSafeInteger(confirmations) ||
    confirmations < 1 ||
    !Number.isSafeInteger(rescan) ||
    rescan < confirmations + 1
  )
    throw new Error("INVALID_CONFIRMATIONS");
  return {
    chainId,
    chain: (chainId === 31337 ? anvil : bscTestnet) as Chain,
    rpc,
    confirmations,
    rescan,
    registry: address("CONTRACT_REGISTRY_ADDRESS"),
    vault: address("CONTRACT_VAULT_ADDRESS"),
    executor: address("CONTRACT_AGENT_EXECUTOR_ADDRESS"),
    token: address("MOCK_IDR_ADDRESS"),
    startBlock: BigInt(required("DEPLOYMENT_START_BLOCK")),
  };
}
export function publicClient() {
  const config = chainConfig();
  const primary = http(config.rpc, { timeout: 10_000, retryCount: 0 });
  const backup =
    config.chainId === 97 && process.env.RPC_FALLBACK_HTTP_URL
      ? http(process.env.RPC_FALLBACK_HTTP_URL, {
          timeout: 10_000,
          retryCount: 0,
        })
      : null;
  return createPublicClient({
    chain: config.chain,
    transport: backup ? fallback([primary, backup]) : primary,
  });
}
export const jsonSafe = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
export const asHex = (value: string) => value as Hex;
