import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  keccak256,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import {
  assertDistinctActors,
  configuredAgentAddress,
  deploymentGasBudget,
  privateKeyAddress,
} from "./deployment-safety";

if (process.env.CHAIN_ID !== "97" || process.env.APP_ENV !== "testnet")
  throw new Error("TESTNET_ONLY");
const worker = parseEnv(readFileSync(".env.worker.testnet", "utf8"));
const agentAddress = configuredAgentAddress(process.env, worker);
if (
  !agentAddress ||
  !process.env.DEMO_ADMIN_PRIVATE_KEY ||
  !worker.AGENT_PRIVATE_KEY
)
  throw new Error("TESTNET_ACTORS_REQUIRED");
const deployer = privateKeyAddress(process.env.DEMO_ADMIN_PRIVATE_KEY);
assertDistinctActors({ agent: agentAddress, deployer }, 97);
const account = privateKeyToAccount(worker.AGENT_PRIVATE_KEY as Hex);
const transport = http(process.env.RPC_HTTP_URL, {
  timeout: 15000,
  retryCount: 0,
});
const client = createPublicClient({ chain: bscTestnet, transport });
if ((await client.getChainId()) !== 97) throw new Error("RPC_CHAIN_MISMATCH");
const journal = ".local/testnet-deployer-gas.json";
if (existsSync(journal)) {
  const old = JSON.parse(readFileSync(journal, "utf8"));
  if (old.chainId !== 97 || old.from !== agentAddress || old.to !== deployer)
    throw new Error("GAS_TRANSFER_JOURNAL_MISMATCH");
  const receipt = await client.waitForTransactionReceipt({
    hash: old.hash,
    confirmations: 3,
    timeout: 120000,
  });
  if (receipt.status !== "success")
    throw new Error("PREVIOUS_GAS_TRANSFER_REVERTED");
  console.log(
    JSON.stringify({
      status: "ALREADY_CONFIRMED",
      hash: old.hash,
      to: deployer,
    }),
  );
  process.exit(0);
}
const gasPrice = await client.getGasPrice();
const budget = deploymentGasBudget(gasPrice);
const balance = await client.getBalance({ address: deployer });
if (balance >= budget.deployerWei) {
  console.log(
    JSON.stringify({
      status: "ALREADY_FUNDED",
      to: deployer,
      balanceTBNB: formatEther(balance),
    }),
  );
  process.exit(0);
}
const value = budget.deployerWei - balance;
const gas = await client.estimateGas({ account, to: deployer, value });
const agentBalance = await client.getBalance({ address: agentAddress });
if (agentBalance < value + gas * gasPrice + budget.agentWei)
  throw new Error("INSUFFICIENT_TEST_GAS_WITH_AGENT_RESERVE");
const wallet = createWalletClient({ chain: bscTestnet, transport, account });
const nonce = await client.getTransactionCount({
  address: agentAddress,
  blockTag: "pending",
});
const raw = await wallet.signTransaction({
  chain: bscTestnet,
  to: deployer,
  value,
  gas,
  gasPrice,
  nonce,
  type: "legacy",
});
const hash = keccak256(raw);
mkdirSync(".local", { recursive: true });
// Durable intent before sending. An uncertain broadcast never creates another transfer automatically.
writeFileSync(
  journal,
  JSON.stringify(
    {
      chainId: 97,
      from: agentAddress,
      to: deployer,
      valueWei: value.toString(),
      valueTBNB: formatEther(value),
      hash,
      nonce,
      raw,
      state: "PREPARED",
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
await client.sendRawTransaction({ serializedTransaction: raw });
const receipt = await client.waitForTransactionReceipt({
  hash,
  confirmations: 3,
  timeout: 120000,
});
if (receipt.status !== "success") throw new Error("TEST_GAS_TRANSFER_REVERTED");
console.log(
  JSON.stringify({
    chainId: 97,
    status: "CONFIRMED",
    to: deployer,
    amountTBNB: formatEther(value),
    hash,
    blockNumber: receipt.blockNumber.toString(),
  }),
);
