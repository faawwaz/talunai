import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  formatEther,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { anvil, bscTestnet } from "viem/chains";
import { actor } from "./actors";
import {
  assertDistinctActors,
  configuredAgentAddress,
  deploymentGasBudget,
} from "./deployment-safety";
const chainId = Number(process.env.CHAIN_ID);
if (chainId !== 31337 && chainId !== 97) throw new Error("UNSUPPORTED_CHAIN");
const expectedChain = process.argv
  .find((arg) => arg.startsWith("--expected-chain="))
  ?.split("=")[1];
if (expectedChain && Number(expectedChain) !== chainId)
  throw new Error("DEPLOY_COMMAND_CHAIN_MISMATCH");
const chain = chainId === 31337 ? anvil : bscTestnet;
const transport = http(process.env.RPC_HTTP_URL ?? "http://127.0.0.1:8545");
const publicClient = createPublicClient({ chain, transport });
if ((await publicClient.getChainId()) !== chainId)
  throw new Error("RPC_CHAIN_MISMATCH");
const admin = actor("admin"),
  verifier = actor("verifier"),
  lender = actor("lender"),
  buyer = actor("buyer");
const workerEnvFile = chainId === 97 ? ".env.worker.testnet" : ".env.worker";
const workerEnv = existsSync(workerEnvFile)
  ? parseEnv(readFileSync(workerEnvFile, "utf8"))
  : {};
const agentAddress =
  configuredAgentAddress(process.env, workerEnv) ?? actor("agent").address;
const actors = {
  admin: admin.address,
  verifier: verifier.address,
  agent: agentAddress,
  lender: lender.address,
  buyer: buyer.address,
  borrower: actor("borrower").address,
};
assertDistinctActors(actors, chainId);
const [adminBalance, agentBalance, gasPrice, blockNumber] = await Promise.all([
  publicClient.getBalance({ address: admin.address }),
  publicClient.getBalance({ address: agentAddress }),
  publicClient.getGasPrice(),
  publicClient.getBlockNumber(),
]);
const budget = deploymentGasBudget(gasPrice);
const existingManifestPath = `deployments/${chainId === 31337 ? "anvil" : "bsc-testnet"}.json`;
const deploymentExists = existsSync(existingManifestPath);
const preflight = {
  deploymentExists,
  chainId,
  blockNumber: blockNumber.toString(),
  agent: agentAddress,
  deployer: admin.address,
  deployerBalanceTBNB: formatEther(adminBalance),
  agentBalanceTBNB: formatEther(agentBalance),
  gasPriceWei: gasPrice.toString(),
  budgetKind: "CONSERVATIVE_BUDGET_NOT_GAS_ESTIMATE",
  deployerBudgetTBNB: formatEther(budget.deployerWei),
  agentBudgetTBNB: formatEther(budget.agentWei),
  readyToDeploy: adminBalance >= budget.deployerWei,
  agentCanOperate: agentBalance >= budget.agentWei,
};
console.log(JSON.stringify(preflight, null, 2));
if (process.argv.includes("--check")) {
  mkdirSync(".local", { recursive: true });
  writeFileSync(
    `.local/${chainId}-deployment-preflight.json`,
    JSON.stringify(preflight, null, 2) + "\n",
  );
  process.exit(deploymentExists || preflight.readyToDeploy ? 0 : 2);
}
if (!preflight.readyToDeploy)
  throw new Error("DEPLOYER_TEST_GAS_REQUIRED_NO_TRANSACTION_SENT");
const manifestPath = `deployments/${chainId === 31337 ? "anvil" : "bsc-testnet"}.json`;
if (chainId === 97 && existsSync(manifestPath))
  throw new Error("EXISTING_TESTNET_DEPLOYMENT_REQUIRES_EXPLICIT_MIGRATION");
const wallet = createWalletClient({ chain, transport, account: admin });
type Artifact = { abi: Abi; bytecode: { object: Hex } };
const artifact = (name: string): Artifact =>
  JSON.parse(readFileSync(`contracts/out/${name}.sol/${name}.json`, "utf8"));
const transactions: Array<{
  name: string;
  address?: Address;
  txHash: Hex;
  blockNumber: string;
}> = [];
const pendingPath = `deployments/${chainId === 31337 ? "anvil" : "bsc-testnet"}.pending.json`;
if (chainId === 97 && existsSync(pendingPath))
  throw new Error("PENDING_DEPLOYMENT_REQUIRES_RECEIPT_RECONCILIATION");
function recordPending(name: string, hash: Hex) {
  if (chainId !== 97) return;
  mkdirSync("deployments", { recursive: true });
  writeFileSync(
    pendingPath,
    JSON.stringify(
      {
        project: "TALUNAI",
        chainId,
        status: "DEPLOYMENT_IN_PROGRESS",
        actors,
        transactions,
        pending: { name, txHash: hash },
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
}
async function deploy(name: string, args: readonly unknown[]) {
  const a = artifact(name);
  const hash = await wallet.deployContract({
    abi: a.abi,
    bytecode: a.bytecode.object,
    args,
  });
  recordPending(name, hash);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: chainId === 97 ? 3 : 1,
  });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error(`DEPLOY_FAILED:${name}`);
  transactions.push({
    name,
    address: receipt.contractAddress,
    txHash: hash,
    blockNumber: receipt.blockNumber.toString(),
  });
  console.log(
    `${name}: ${receipt.contractAddress} tx=${hash} block=${receipt.blockNumber}`,
  );
  return receipt.contractAddress;
}
async function call(
  name: string,
  address: Address,
  functionName: string,
  args: readonly unknown[],
) {
  const { request } = await publicClient.simulateContract({
    address,
    abi: artifact(name).abi,
    functionName,
    args,
    account: admin,
  });
  const hash = await wallet.writeContract(request);
  recordPending(functionName, hash);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: chainId === 97 ? 3 : 1,
  });
  if (receipt.status !== "success") throw new Error("BOOTSTRAP_FAILED");
  transactions.push({
    name: functionName,
    txHash: hash,
    blockNumber: receipt.blockNumber.toString(),
  });
}
const token = await deploy("MockIDR", [admin.address]);
const registry = await deploy("RWARegistry", [
  admin.address,
  verifier.address,
  token,
  8000n,
  150n,
  100000000n,
]);
const vault = await deploy("FinancingVault", [admin.address, registry]);
const executor = await deploy("AgentExecutor", [
  admin.address,
  agentAddress,
  registry,
  vault,
]);
await call("RWARegistry", registry, "configureEndpoints", [vault, executor]);
await call("FinancingVault", vault, "grantRole", [
  keccak256(toHex("LENDER_ROLE")),
  lender.address,
]);
if (chainId === 31337)
  await call("FinancingVault", vault, "grantRole", [
    keccak256(toHex("LENDER_ROLE")),
    actor("lenderTwo").address,
  ]);
await call("MockIDR", token, "mint", [lender.address, 1000000000n]);
await call("MockIDR", token, "mint", [buyer.address, 1000000000n]);
const manifest = {
  project: "TALUNAI",
  chainId,
  isSynthetic: true,
  createdAt: new Date().toISOString(),
  compiler: "0.8.28",
  evmVersion: "paris",
  registry,
  vault,
  executor,
  token,
  deploymentStartBlock: transactions[0].blockNumber,
  actors,
  transactions,
};
mkdirSync("deployments", { recursive: true });
mkdirSync(".local", { recursive: true });
const name = chainId === 31337 ? "anvil" : "bsc-testnet";
writeFileSync(
  `deployments/${name}.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
writeFileSync(
  ".local/deployment.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
const envFile = chainId === 31337 ? ".env.local" : ".env.testnet";
let env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const updates = {
  CONTRACT_REGISTRY_ADDRESS: registry,
  CONTRACT_VAULT_ADDRESS: vault,
  CONTRACT_AGENT_EXECUTOR_ADDRESS: executor,
  MOCK_IDR_ADDRESS: token,
  DEPLOYMENT_START_BLOCK: manifest.deploymentStartBlock,
};
for (const [key, value] of Object.entries(updates)) {
  env = env.replace(new RegExp(`^${key}=.*\\n?`, "gm"), "");
  env += `${key}=${value}\n`;
}
writeFileSync(envFile, env, { mode: 0o600 });
if (chainId === 31337 && existsSync(".env.worker")) {
  let workerEnv = readFileSync(".env.worker", "utf8");
  for (const [key, value] of Object.entries(updates)) {
    workerEnv = workerEnv.replace(new RegExp(`^${key}=.*\\n?`, "gm"), "");
    workerEnv += `${key}=${value}\n`;
  }
  writeFileSync(".env.worker", workerEnv, { mode: 0o600 });
}
if (chainId === 97) {
  for (const file of [".env.web.testnet", ".env.worker.testnet"]) {
    if (!existsSync(file)) continue;
    const staged = parseEnv(readFileSync(file, "utf8"));
    if (staged.CHAIN_ID !== "97") throw new Error("STAGED_ENV_CHAIN_MISMATCH");
    let content = readFileSync(file, "utf8");
    for (const [key, value] of Object.entries(updates)) {
      content = content.replace(new RegExp(`^${key}=.*\\n?`, "gm"), "");
      content += `${key}=${value}\n`;
    }
    writeFileSync(file, content, { mode: 0o600 });
  }
  writeFileSync(
    pendingPath,
    JSON.stringify(
      { project: "TALUNAI", chainId, status: "DEPLOYED", actors, transactions },
      null,
      2,
    ) + "\n",
  );
}
console.log(
  `Saved actual deployment manifest deployments/${name}.json. Runtime has no participant private keys.`,
);
