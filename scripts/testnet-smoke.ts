import { readFileSync, writeFileSync } from "node:fs";
import { formatEther, keccak256, toHex } from "viem";
import { publicClient, chainConfig } from "../packages/chain/config";
import { validateStartup } from "../packages/chain/service";
import {
  executorAbi,
  mockIdrAbi,
  registryAbi,
  vaultAbi,
} from "../packages/chain/contracts";
if (process.env.CHAIN_ID !== "97" || process.env.APP_ENV !== "testnet")
  throw new Error("TESTNET_ONLY");
const manifest = JSON.parse(
  readFileSync("deployments/bsc-testnet.json", "utf8"),
);
const c = chainConfig();
const client = publicClient();
await validateStartup();
for (const key of ["registry", "vault", "executor", "token"] as const)
  if (c[key].toLowerCase() !== manifest[key].toLowerCase())
    throw new Error("MANIFEST_RUNTIME_MISMATCH");
const agent = manifest.actors.agent;
const adminRole = `0x${"0".repeat(64)}` as const;
const checks = [
  {
    contract: c.executor,
    abi: executorAbi,
    role: keccak256(toHex("AGENT_ROLE")),
    expected: true,
    name: "agentCanHold",
  },
  {
    contract: c.executor,
    abi: executorAbi,
    role: adminRole,
    expected: false,
    name: "agentIsExecutorAdmin",
  },
  {
    contract: c.registry,
    abi: registryAbi,
    role: adminRole,
    expected: false,
    name: "agentIsRegistryAdmin",
  },
  {
    contract: c.registry,
    abi: registryAbi,
    role: keccak256(toHex("VERIFIER_ROLE")),
    expected: false,
    name: "agentCanVerify",
  },
  {
    contract: c.vault,
    abi: vaultAbi,
    role: adminRole,
    expected: false,
    name: "agentIsVaultAdmin",
  },
  {
    contract: c.vault,
    abi: vaultAbi,
    role: keccak256(toHex("LENDER_ROLE")),
    expected: false,
    name: "agentCanFund",
  },
  {
    contract: c.token,
    abi: mockIdrAbi,
    role: adminRole,
    expected: false,
    name: "agentIsTokenAdmin",
  },
  {
    contract: c.token,
    abi: mockIdrAbi,
    role: keccak256(toHex("DEMO_MINTER_ROLE")),
    expected: false,
    name: "agentCanMint",
  },
];
const roles: Record<string, boolean> = {};
for (const check of checks) {
  const actual = await client.readContract({
    address: check.contract,
    abi: check.abi,
    functionName: "hasRole",
    args: [check.role, agent],
  });
  if (actual !== check.expected)
    throw new Error(`AGENT_ROLE_BOUNDARY_FAILED:${check.name}`);
  roles[check.name] = actual;
}
const tip = await client.getBlockNumber();
let gasCost = 0n;
for (const tx of manifest.transactions) {
  const receipt = await client.getTransactionReceipt({ hash: tx.txHash });
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (
    receipt.status !== "success" ||
    receipt.blockHash !== block.hash ||
    tip - receipt.blockNumber + 1n < 3n
  )
    throw new Error("DEPLOYMENT_NOT_CONFIRMED_CANONICAL");
  if (receipt.from.toLowerCase() !== manifest.actors.admin.toLowerCase())
    throw new Error("DEPLOYER_MISMATCH");
  if (
    tx.address &&
    receipt.contractAddress?.toLowerCase() !== tx.address.toLowerCase()
  )
    throw new Error("RECEIPT_ADDRESS_MISMATCH");
  gasCost += receipt.gasUsed * receipt.effectiveGasPrice;
}
const balances = await Promise.all([
  client.getBalance({ address: agent }),
  client.getBalance({ address: manifest.actors.admin }),
]);
const report = {
  project: "TALUNAI",
  chainId: 97,
  isSynthetic: true,
  verifiedAt: new Date().toISOString(),
  verificationBlock: tip.toString(),
  requiredConfirmations: 3,
  startupChecks: "PASS",
  agent,
  contracts: {
    registry: c.registry,
    vault: c.vault,
    executor: c.executor,
    token: c.token,
  },
  roles,
  confirmedTransactions: manifest.transactions.length,
  deploymentGasCostTBNB: formatEther(gasCost),
  agentBalanceTBNB: formatEther(balances[0]),
  deployerBalanceTBNB: formatEther(balances[1]),
  scope:
    "DEPLOYMENT_BOOTSTRAP_AND_ROLE_READBACK; NO_PUBLIC_TESTNET_FINANCING_FLOW_CLAIMED",
};
writeFileSync(
  "deployments/bsc-testnet.verification.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
