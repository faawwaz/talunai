import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  createWalletClient,
  erc20Abi,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { handleRequest } from "../packages/api/handler";
import { chainConfig, publicClient } from "../packages/chain/config";
import { getSql, closeDb } from "../packages/db";
import { poolAbi, poolAddress } from "../packages/pool/read";
import { poll, registered, sessions } from "./demo-lib";
import type { ChainClaim } from "../packages/api/chain-port";

if (process.env.APP_ENV !== "testnet" || process.env.CHAIN_ID !== "97")
  throw new Error("SYNTHETIC_TESTNET_ONLY");
if (process.env.LLM_MODE !== "mock")
  throw new Error("SMOKE_REQUIRES_EXPLICIT_SYNTHETIC_ANALYSIS_MODE");
const base = JSON.parse(readFileSync("deployments/bsc-testnet.json", "utf8"));
const pool = JSON.parse(
  readFileSync("deployments/pool-a-bsc-testnet.json", "utf8"),
);
const c = chainConfig();
const client = publicClient();
const adminKey = process.env.DEMO_ADMIN_PRIVATE_KEY as Hex | undefined;
const lenderKey = process.env.DEMO_LENDER_PRIVATE_KEY as Hex | undefined;
if (!adminKey || !lenderKey) throw new Error("TESTNET_ACTOR_KEYS_REQUIRED");
const admin = privateKeyToAccount(adminKey);
const lender = privateKeyToAccount(lenderKey);
if (
  admin.address.toLowerCase() !== base.actors.admin.toLowerCase() ||
  lender.address.toLowerCase() !== base.actors.lender.toLowerCase() ||
  poolAddress.toLowerCase() !== pool.address.toLowerCase() ||
  pool.asset.toLowerCase() !== c.token.toLowerCase()
)
  throw new Error("SMOKE_MANIFEST_ACTOR_MISMATCH");
const adminWallet = createWalletClient({
  chain: c.chain,
  transport: http(c.rpc),
  account: admin,
});
const lenderWallet = createWalletClient({
  chain: c.chain,
  transport: http(c.rpc),
  account: lender,
});
const transactions: Array<{
  action: string;
  hash: Hex;
  blockNumber: string;
}> = [];
const progressPath = ".local/testnet-pool-flow-progress.json";
let claim: ChainClaim | undefined;
function progress(stage: string) {
  mkdirSync(".local", { recursive: true });
  writeFileSync(
    progressPath,
    JSON.stringify(
      {
        stage,
        claimId: claim?.id ?? null,
        claimKey: claim?.claimKey ?? null,
        transactions,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
}
async function confirmed(action: string, hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({
    hash,
    confirmations: c.confirmations,
    timeout: 120_000,
  });
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (receipt.status !== "success" || block.hash !== receipt.blockHash)
    throw new Error(`SMOKE_TX_NOT_CANONICAL:${action}`);
  transactions.push({
    action,
    hash,
    blockNumber: receipt.blockNumber.toString(),
  });
  progress(action);
  console.log(
    JSON.stringify({ action, hash, block: receipt.blockNumber.toString() }),
  );
}
async function poolWrite(
  action: string,
  account: typeof admin,
  wallet: typeof adminWallet,
  functionName: "fundClaim" | "harvest" | "redeem" | "deposit",
  args: readonly unknown[],
) {
  const simulation = await client.simulateContract({
    address: poolAddress,
    abi: poolAbi,
    functionName,
    args: args as never,
    account,
  });
  const hash = await wallet.writeContract(simulation.request);
  await confirmed(action, hash);
}
async function topUp(name: string, amount: bigint) {
  const key = process.env[`DEMO_${name}_PRIVATE_KEY`] as Hex | undefined;
  if (!key) throw new Error(`SMOKE_KEY_MISSING:${name}`);
  const account = privateKeyToAccount(key);
  if (
    account.address.toLowerCase() !==
    base.actors[name.toLowerCase()].toLowerCase()
  )
    throw new Error(`SMOKE_ACTOR_MISMATCH:${name}`);
  const balance = await client.getBalance({ address: account.address });
  if (balance >= amount) return;
  const hash = await adminWallet.sendTransaction({
    to: account.address,
    value: amount - balance,
  });
  await confirmed(`TOPUP_${name}`, hash);
}

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith(`${process.env.APP_ORIGIN}/`))
    return handleRequest(new Request(url, init));
  return nativeFetch(input, init);
};

try {
  assert.equal(await client.getChainId(), 97);
  const [stats, shares, buyerBalance] = await Promise.all([
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "poolStats",
    }),
    client.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "balanceOf",
      args: [lender.address],
    }),
    client.readContract({
      address: c.token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [base.actors.buyer as Address],
    }),
  ]);
  if (
    stats[0] < 1_000_000_000n ||
    stats[6] !== 0n ||
    shares !== 1_000_000_000n ||
    buyerBalance < 100_000_000n
  )
    throw new Error("SMOKE_POOL_OR_BUYER_PREFLIGHT_FAILED");
  const [checkpoint] =
    await getSql()`SELECT degraded,updated_at FROM indexer_checkpoints WHERE chain_id=97`;
  if (
    !checkpoint ||
    checkpoint.degraded ||
    Date.now() - new Date(checkpoint.updated_at).getTime() > 120_000
  )
    throw new Error("SMOKE_INDEXER_NOT_READY");
  const [heartbeat] =
    await getSql()`SELECT status,provider_mode,updated_at FROM worker_heartbeats WHERE id='worker'`;
  if (
    !heartbeat ||
    heartbeat.status !== "READY" ||
    heartbeat.provider_mode !== "mock" ||
    Date.now() - new Date(heartbeat.updated_at).getTime() > 120_000
  )
    throw new Error("SMOKE_WORKER_NOT_READY");
  const gasTargets = [
    ["VERIFIER", parseEther("0.00035")],
    ["BUYER", parseEther("0.00012")],
    ["BORROWER", parseEther("0.00008")],
    ["LENDER", parseEther("0.00012")],
  ] as const;
  let topUpValue = 0n;
  for (const [name, target] of gasTargets) {
    const key = process.env[`DEMO_${name}_PRIVATE_KEY`] as Hex | undefined;
    if (!key) throw new Error(`SMOKE_KEY_MISSING:${name}`);
    const address = privateKeyToAccount(key).address;
    if (address.toLowerCase() !== base.actors[name.toLowerCase()].toLowerCase())
      throw new Error(`SMOKE_ACTOR_MISMATCH:${name}`);
    const balance = await client.getBalance({ address });
    if (balance < target) topUpValue += target - balance;
  }
  const gasPrice = await client.getGasPrice();
  const adminGasBudget = gasPrice * (4n * 21_000n + 3_000_000n);
  const margin = parseEther("0.0002");
  const adminBalance = await client.getBalance({ address: admin.address });
  if (adminBalance < topUpValue + adminGasBudget + margin)
    throw new Error("SMOKE_ADMIN_GAS_BUDGET_SHORTFALL");
  console.log(
    JSON.stringify({
      preflight: "ADMIN_GAS_BUDGET_PASS",
      topUpValueWei: topUpValue.toString(),
      adminGasBudgetWei: adminGasBudget.toString(),
      marginWei: margin.toString(),
      adminBalanceWei: adminBalance.toString(),
    }),
  );
  // Exactly the gas needed for synthetic actor actions; no token minting.
  await topUp("VERIFIER", parseEther("0.00035"));
  await topUp("BUYER", parseEther("0.00012"));
  await topUp("BORROWER", parseEther("0.00008"));
  await topUp("LENDER", parseEther("0.00012"));
  const s = await sessions();
  const result = await registered(s, `pool-${randomUUID().slice(0, 8)}`);
  claim = result.claim;
  progress("REGISTERED");
  if (
    claim.terms.principal !== "70000000" ||
    claim.terms.fee !== "1050000" ||
    claim.terms.acceptedOutstanding !== "100000000"
  )
    throw new Error("SMOKE_TERMS_UNEXPECTED");
  await poolWrite("POOL_FUND_CLAIM", admin, adminWallet, "fundClaim", [
    claim.claimKey,
  ]);
  await poll(
    () =>
      s.buyer.request<Record<string, unknown>>(
        `/v1/claims/${claim!.id}/financing`,
      ),
    (f) => f.financingStatus === "ACTIVE",
    "pool funding projection",
  );
  await s.buyer.transaction(claim, "APPROVE_TOKEN", { amount: "100000000" });
  await s.buyer.transaction(claim, "COLLECT_BUYER_PAYMENT", {
    amount: "100000000",
  });
  await poll(
    () =>
      s.buyer.request<Record<string, unknown>>(
        `/v1/claims/${claim!.id}/financing`,
      ),
    (f) => f.collectionStatus === "FULLY_COLLECTED",
    "buyer payment projection",
  );
  await poolWrite("POOL_HARVEST", admin, adminWallet, "harvest", [
    claim.claimKey,
  ]);
  await s.borrower.transaction(claim, "WITHDRAW_BORROWER");
  const beforeRedeem = await client.readContract({
    address: poolAddress,
    abi: poolAbi,
    functionName: "poolStats",
  });
  if (
    beforeRedeem[0] !== 1_001_050_000n ||
    beforeRedeem[3] !== 1_050_000n ||
    beforeRedeem[6] !== 0n
  )
    throw new Error("SMOKE_POOL_ECONOMICS_MISMATCH");
  await poolWrite("POOL_REDEEM", lender, lenderWallet, "redeem", [shares]);
  const redeemed = await client.readContract({
    address: c.token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [lender.address],
  });
  if (redeemed !== 1_001_050_000n)
    throw new Error("SMOKE_REDEMPTION_AMOUNT_MISMATCH");
  const approval = await lenderWallet.writeContract({
    address: c.token,
    abi: erc20Abi,
    functionName: "approve",
    args: [poolAddress, redeemed],
  });
  await confirmed("APPROVE_POOL_REDEPOSIT", approval);
  await poolWrite("POOL_REDEPOSIT", lender, lenderWallet, "deposit", [
    redeemed,
    pool.riskDisclosureHash,
  ]);
  const finalStats = await client.readContract({
    address: poolAddress,
    abi: poolAbi,
    functionName: "poolStats",
  });
  if (finalStats[0] !== 1_001_050_000n || finalStats[6] !== 0n)
    throw new Error("SMOKE_FINAL_POOL_BALANCE_MISMATCH");
  const intents =
    await getSql()`SELECT action,tx_hash FROM transaction_intents WHERE claim_id=${claim.id} AND tx_hash IS NOT NULL ORDER BY created_at,id`;
  for (const intent of intents) {
    const receipt = await client.getTransactionReceipt({
      hash: intent.tx_hash as Hex,
    });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (receipt.status !== "success" || block.hash !== receipt.blockHash)
      throw new Error(`SMOKE_INTENT_RECEIPT_FAILED:${intent.action}`);
    transactions.push({
      action: String(intent.action),
      hash: intent.tx_hash as Hex,
      blockNumber: receipt.blockNumber.toString(),
    });
  }
  transactions.sort((a, b) =>
    BigInt(a.blockNumber) < BigInt(b.blockNumber)
      ? -1
      : BigInt(a.blockNumber) > BigInt(b.blockNumber)
        ? 1
        : 0,
  );
  const report = {
    chainId: 97,
    isSynthetic: true,
    providerMode: "mock",
    claimId: claim.id,
    claimKey: claim.claimKey,
    principal: claim.terms.principal,
    fee: claim.terms.fee,
    buyerPaid: "100000000",
    lenderRedeemed: redeemed.toString(),
    finalPoolIdle: finalStats[0].toString(),
    transactions,
    verifiedAt: new Date().toISOString(),
  };
  writeFileSync(
    "deployments/bsc-testnet-flow-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  progress("COMPLETE");
  console.log(JSON.stringify({ result: "PASS", ...report }));
} catch (error) {
  progress("FAILED");
  console.error(
    error instanceof Error ? error.message.split("\n")[0] : "SMOKE_FAILED",
  );
  process.exitCode = 1;
} finally {
  globalThis.fetch = nativeFetch;
  await closeDb();
}
