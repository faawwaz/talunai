import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { chainConfig, publicClient } from "../../packages/chain/config";
import {
  mockIdrAbi,
  registryAbi,
  vaultAbi,
} from "../../packages/chain/contracts";
import type { Claim } from "../../packages/client";
import {
  artifact,
  checkpoint,
  instance,
  privateOutput,
  read,
  save,
  spec,
  type CaseSession,
  type CaseState,
  type Role,
  type TransactionRecord,
} from "./common";

export async function verifyChain(a: Record<Role, PrivateKeyAccount>) {
  const c = chainConfig(),
    client = publicClient();
  assert.equal(await client.getChainId(), 97, "RPC_CHAIN_MISMATCH");
  const [symbol, decimals, adminRole, verifierRole] = await Promise.all([
    client.readContract({
      address: c.token,
      abi: erc20Abi,
      functionName: "symbol",
    }),
    client.readContract({
      address: c.token,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    client.readContract({
      address: c.vault,
      abi: vaultAbi,
      functionName: "hasRole",
      args: [toHex(new Uint8Array(32)), a.admin.address],
    }),
    client.readContract({
      address: c.registry,
      abi: registryAbi,
      functionName: "hasRole",
      args: [keccak256(toHex("VERIFIER_ROLE")), a.verifier.address],
    }),
  ]);
  assert.equal(symbol, "MockIDR", "CASE_TOKEN_MISMATCH");
  assert.equal(decimals, 0, "CASE_TOKEN_DECIMALS_MISMATCH");
  assert.equal(adminRole, true, "CASE_VAULT_ADMIN_REQUIRED");
  assert.equal(verifierRole, true, "CASE_VERIFIER_CHAIN_ROLE_REQUIRED");
  await save(artifact("chain-configuration.json"), {
    network: "BNB Chain Testnet",
    chainId: 97,
    token: { address: c.token, symbol, decimals, hasRealMoneyValue: false },
    registry: c.registry,
    vault: c.vault,
    agentExecutor: c.executor,
    confirmations: c.confirmations,
    checkedAt: new Date().toISOString(),
  });
}
const signedPath = () =>
  resolve(privateOutput, `signed-transactions-${instance}.json`);
async function receipt(tx: TransactionRecord, s: CaseState) {
  const c = chainConfig(),
    client = publicClient();
  const r = await client.waitForTransactionReceipt({
    hash: tx.hash,
    confirmations: c.confirmations,
    timeout: 180_000,
  });
  assert.equal(r.status, "success", `TX_REVERTED:${tx.action}`);
  const block = await client.getBlock({ blockNumber: r.blockNumber });
  assert.equal(block.hash, r.blockHash, "RECEIPT_NOT_CANONICAL");
  tx.status = "CONFIRMED";
  tx.blockNumber = r.blockNumber.toString();
  tx.blockHash = r.blockHash;
  tx.explorerUrl = `https://testnet.bscscan.com/tx/${tx.hash}`;
  await save(artifact(`transactions/${tx.action}.receipt.json`), r);
  await checkpoint(s, tx.action, {
    transactionHash: tx.hash,
    blockNumber: tx.blockNumber,
    receiptStatus: r.status,
    canonical: true,
  });
}
async function broadcast(
  s: CaseState,
  account: PrivateKeyAccount,
  action: string,
  request: { to: Address; data?: Hex; value?: bigint },
  intentId?: string,
) {
  const c = chainConfig();
  const wallet = createWalletClient({
    account,
    chain: c.chain,
    transport: http(c.rpc, { timeout: 15_000, retryCount: 0 }),
  });
  let tx = s.transactions.find((item) => item.action === action);
  if (!tx) {
    const prepared = await wallet.prepareTransactionRequest({
      account,
      ...request,
    });
    const serialized = await wallet.signTransaction(prepared);
    tx = {
      action,
      hash: keccak256(serialized),
      status: "SIGNED",
      ...(intentId ? { intentId } : {}),
    };
    const signed = (await read<Record<string, Hex>>(signedPath())) ?? {};
    signed[tx.hash] = serialized;
    await save(signedPath(), signed, true);
    s.transactions.push(tx);
    // Persist the signed hash before sending, so a restart cannot create a second economic action.
    await checkpoint(s, `SIGNED_${action}`);
  }
  if (tx.status !== "CONFIRMED") {
    const existing = await publicClient()
      .getTransactionReceipt({ hash: tx.hash })
      .catch((e: Error) => {
        if (e.name === "TransactionReceiptNotFoundError") return null;
        throw e;
      });
    if (!existing) {
      const signed = await read<Record<string, Hex>>(signedPath());
      assert.ok(signed?.[tx.hash], "SIGNED_TRANSACTION_JOURNAL_REQUIRED");
      await wallet
        .sendRawTransaction({ serializedTransaction: signed[tx.hash] })
        .catch((e: Error) => {
          if (
            !/already known|already imported|known transaction/i.test(e.message)
          )
            throw e;
        });
    }
  }
  await receipt(tx, s);
  return tx;
}
export async function applicationTransaction(
  s: CaseState,
  session: CaseSession,
  claim: Claim,
  action: string,
  extra: Record<string, unknown> = {},
) {
  const label = `${session.role.toUpperCase()}_${action}`;
  const existing = s.transactions.find((tx) => tx.action === label);
  let tx: TransactionRecord;
  if (existing) {
    tx = await broadcast(
      s,
      session.account,
      label,
      { to: chainConfig().vault },
      existing.intentId,
    );
  } else {
    const prepared = await session.request<{
      intentId: string;
      transaction: { to: Address; data: Hex; value: string };
    }>(
      `/v1/claims/${claim.id}/actions/prepare`,
      "POST",
      { expectedVersion: claim.version, action, ...extra },
      `case:${instance}:${claim.id}:${claim.version}:${label}`,
    );
    const allowed = [
      chainConfig().registry,
      chainConfig().vault,
      chainConfig().token,
    ];
    assert.ok(
      allowed.includes(prepared.transaction.to.toLowerCase() as Address),
      "TRANSACTION_RECIPIENT_NOT_ALLOWED",
    );
    assert.equal(prepared.transaction.value, "0", "UNEXPECTED_NATIVE_VALUE");
    tx = await broadcast(
      s,
      session.account,
      label,
      {
        to: prepared.transaction.to,
        data: prepared.transaction.data,
        value: 0n,
      },
      prepared.intentId,
    );
  }
  assert.ok(tx.intentId);
  await session.request(
    "/v1/transactions/observe",
    "POST",
    { intentId: tx.intentId, hash: tx.hash },
    `case:${instance}:observe:${tx.hash}`,
  );
  return tx;
}

export async function reconcileJournal(
  s: CaseState,
  a: Record<Role, PrivateKeyAccount>,
  auth: Record<Role, CaseSession>,
  claim: Claim,
) {
  for (const tx of s.transactions) {
    const role = (["borrower", "buyer", "lender", "verifier"] as const).find(
      (value) => tx.action.startsWith(`${value.toUpperCase()}_`),
    );
    if (role && tx.intentId) {
      await applicationTransaction(
        s,
        auth[role],
        claim,
        tx.action.slice(role.length + 1),
      );
    } else {
      await broadcast(s, a.admin, tx.action, { to: chainConfig().vault });
    }
  }
}
export async function bootstrapWallets(
  s: CaseState,
  a: Record<Role, PrivateKeyAccount>,
) {
  const c = chainConfig(),
    client = publicClient();
  const gasPrice = await client.getGasPrice();
  const gasUnits: Record<Exclude<Role, "admin">, bigint> = {
    borrower: 250_000n,
    buyer: 450_000n,
    lender: 800_000n,
    verifier: 800_000n,
  };
  const needed: Array<{ role: Exclude<Role, "admin">; value: bigint }> = [];
  for (const role of ["borrower", "buyer", "lender", "verifier"] as const) {
    const target = gasPrice * gasUnits[role];
    const balance = await client.getBalance({ address: a[role].address });
    if (balance < target) needed.push({ role, value: target - balance });
  }
  const adminBalance = await client.getBalance({ address: a.admin.address });
  assert.ok(
    adminBalance >=
      needed.reduce((sum, n) => sum + n.value, 0n) + gasPrice * 1_200_000n,
    "ADMIN_TESTNET_GAS_SHORTFALL",
  );
  for (const n of needed)
    await broadcast(s, a.admin, `TOPUP_${n.role.toUpperCase()}`, {
      to: a[n.role].address,
      value: n.value,
    });
  const lenderRole = keccak256(toHex("LENDER_ROLE"));
  if (
    !(await client.readContract({
      address: c.vault,
      abi: vaultAbi,
      functionName: "hasRole",
      args: [lenderRole, a.lender.address],
    }))
  ) {
    await client.simulateContract({
      address: c.vault,
      abi: vaultAbi,
      functionName: "grantRole",
      args: [lenderRole, a.lender.address],
      account: a.admin,
    });
    await broadcast(s, a.admin, "ALLOWLIST_CASE_LENDER", {
      to: c.vault,
      data: encodeFunctionData({
        abi: vaultAbi,
        functionName: "grantRole",
        args: [lenderRole, a.lender.address],
      }),
    });
  }
  for (const [role, amount] of [
    ["lender", BigInt(spec.principalIdr)],
    ["buyer", BigInt(spec.outstandingIdr)],
  ] as const) {
    const balance = await client.readContract({
      address: c.token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [a[role].address],
    });
    if (balance >= amount) continue;
    // MockIDR mint is a real testnet transaction, never a UI balance assignment.
    await client.simulateContract({
      address: c.token,
      abi: mockIdrAbi,
      functionName: "mint",
      args: [a[role].address, amount - balance],
      account: a.admin,
    });
    await broadcast(s, a.admin, `MINT_CASE_${role.toUpperCase()}`, {
      to: c.token,
      data: encodeFunctionData({
        abi: mockIdrAbi,
        functionName: "mint",
        args: [a[role].address, amount - balance],
      }),
    });
  }
}
export async function tokenBalances(a: Record<Role, PrivateKeyAccount>) {
  const c = chainConfig(),
    client = publicClient();
  const values: Record<string, string> = {};
  for (const role of ["borrower", "buyer", "lender"] as const)
    values[role] = (
      await client.readContract({
        address: c.token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [a[role].address],
      })
    ).toString();
  return values;
}
