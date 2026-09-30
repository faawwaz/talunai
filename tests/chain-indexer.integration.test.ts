import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { parseEnv } from "node:util";
import postgres from "postgres";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  encodeFunctionData,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { anvil } from "viem/chains";
import { mnemonicToAccount } from "viem/accounts";
import { closeDb, getSql } from "../packages/db";
import { registryAbi, vaultAbi, mockIdrAbi } from "../packages/chain/contracts";
import { indexOnce, reconcileIntents } from "../packages/chain/indexer";
import { observe, observeReplacement } from "../packages/api/actions";
import type { Actor } from "../packages/api/core";
import {
  consentTypedData,
  contractTerms,
  termsHash,
  validateStartup,
} from "../packages/chain/service";
import type { ChainClaim } from "../packages/api/chain-port";

// Opt in explicitly: this suite owns a temporary database and its own Anvil process.
// RUN_CHAIN_INTEGRATION=1 npx vitest run tests/chain-indexer.integration.test.ts
const enabled = process.env.RUN_CHAIN_INTEGRATION === "1";
const run = enabled ? describe : describe.skip;
const mnemonic = "test test test test test test test test test test test junk";
const actors = Array.from({ length: 6 }, (_, addressIndex) =>
  mnemonicToAccount(mnemonic, { addressIndex }),
);
const [admin, borrower, buyer, lender, verifier, agent] = actors;
let child: ChildProcess | undefined;
let proxy: Server | undefined;
let adminSql: ReturnType<typeof postgres> | undefined;
let ownedDatabase: string | undefined;
let rpcUrl: string;
let upstreamUrl: string;
let token: Address, registry: Address, vault: Address, executor: Address;
let deploymentStartBlock: bigint;
let nonce = 0n;
let client: ReturnType<typeof createPublicClient>;
let testClient: ReturnType<typeof createTestClient>;
let wrongChain = false;
let dropFundingHoldLogs = false;
let conflictAfterProjectionRead = false;
let sawProjectionRead = false;
const originalEnv = { ...process.env };

async function freePort() {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("NO_TEST_PORT");
  const port = addr.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
function wallet(account = admin) {
  return createWalletClient({
    chain: anvil,
    transport: http(upstreamUrl),
    account,
  });
}
async function mined(hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
  return receipt;
}
async function contractWrite(
  account: typeof admin,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
) {
  const result = await client.simulateContract({
    address,
    abi,
    functionName,
    args,
    account,
  });
  return mined(await wallet(account).writeContract(result.request));
}
async function deploy(name: string, args: readonly unknown[]) {
  const artifact = JSON.parse(
    await readFile(
      new URL(`../contracts/out/${name}.sol/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as { abi: Abi; bytecode: { object: Hex } };
  const receipt = await mined(
    await wallet().deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args,
    }),
  );
  if (!receipt.contractAddress) throw new Error("TEST_DEPLOYMENT_FAILED");
  if (name === "MockIDR") deploymentStartBlock = receipt.blockNumber;
  return receipt.contractAddress;
}
async function registerClaim() {
  const time = Number((await client.getBlock()).timestamp);
  const claim: ChainClaim = {
    id: randomUUID(),
    claimKey: keccak256(toHex(randomUUID())),
    version: 1,
    workflow: "READY_FOR_REGISTRATION",
    fundingHold: false,
    hasDispute: false,
    terms: {
      borrower: borrower.address,
      buyer: buyer.address,
      token,
      acceptedOutstanding: "100000000",
      principal: "70000000",
      fee: "1050000",
      fundingDeadline: time + 3600,
      invoiceDueAt: time + 45 * 86400,
      reviewExpiry: time + 7200,
      consentExpiry: time + 7200,
      evidenceCommitment: keccak256(toHex(randomUUID())),
      decisionHash: keccak256(toHex("review")),
      policyHash: keccak256(toHex("policy")),
    },
  };
  const current = nonce++;
  const borrowerSignature = await borrower.signTypedData(
    consentTypedData({
      claim,
      role: "BORROWER",
      signer: borrower.address,
      nonce: current.toString(),
      deadline: claim.terms.consentExpiry,
    }),
  );
  const buyerSignature = await buyer.signTypedData(
    consentTypedData({
      claim,
      role: "BUYER",
      signer: buyer.address,
      nonce: current.toString(),
      deadline: claim.terms.consentExpiry,
    }),
  );
  expect(
    await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "hashTerms",
      args: [contractTerms(claim)],
    }),
  ).toBe(termsHash(claim));
  await contractWrite(
    verifier,
    registry,
    registryAbi,
    "registerApprovedClaim",
    [
      contractTerms(claim),
      {
        nonce: current,
        deadline: BigInt(claim.terms.consentExpiry),
        signature: borrowerSignature,
      },
      {
        nonce: current,
        deadline: BigInt(claim.terms.consentExpiry),
        signature: buyerSignature,
      },
    ],
  );
  return claim;
}
async function projection(key: Hex) {
  const [row] =
    await getSql()`SELECT state FROM financial_projections WHERE claim_key=${key}`;
  if (!row) throw new Error("PROJECTION_MISSING");
  return row.state as Record<string, unknown>;
}
async function counts() {
  const [row] =
    await getSql()`SELECT count(*)::integer AS events,count(*) FILTER(WHERE canonical)::integer AS canonical FROM chain_events`;
  return row;
}

run("canonical chain indexer on isolated PostgreSQL + real Anvil", () => {
  beforeAll(async () => {
    // An explicit disposable database must never require reading application secrets.
    const databaseUrl =
      process.env.CHAIN_TEST_DATABASE_URL ??
      parseEnv(
        await readFile(new URL("../.env.local", import.meta.url), "utf8"),
      ).DATABASE_URL;
    if (!databaseUrl)
      throw new Error("CHAIN_TEST_DATABASE_URL_OR_LOCAL_ENV_REQUIRED");
    adminSql = postgres(databaseUrl, { max: 1 });
    ownedDatabase = `talunai_chain_${process.pid}_${Date.now()}`;
    await adminSql.unsafe(`CREATE DATABASE "${ownedDatabase}"`);
    const dbUrl = new URL(databaseUrl);
    dbUrl.pathname = `/${ownedDatabase}`;
    await closeDb();
    process.env.DATABASE_URL = dbUrl.toString();
    const sql = getSql();
    for (const file of (
      await readdir(new URL("../packages/db/migrations/", import.meta.url))
    )
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await sql.unsafe(
        await readFile(
          new URL(`../packages/db/migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    const port = await freePort();
    upstreamUrl = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      [
        "scripts/foundry.mjs",
        "anvil",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--chain-id",
        "31337",
        "--silent",
      ],
      { stdio: "ignore" },
    );
    child.on("error", () => {});
    client = createPublicClient({
      chain: anvil,
      transport: http(upstreamUrl, { timeout: 300, retryCount: 0 }),
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error("ISOLATED_ANVIL_EXITED");
      try {
        ready = (await client.getChainId()) === 31337;
        if (ready) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error("ISOLATED_ANVIL_TIMEOUT");
    testClient = createTestClient({
      chain: anvil,
      mode: "anvil",
      transport: http(upstreamUrl),
    });
    // Real JSON-RPC proxy adversarially duplicates/reverses getLogs. No mocked financial state.
    proxy = createHttpServer(async (req, res) => {
      try {
        let body = "";
        for await (const chunk of req) body += String(chunk);
        const payload = JSON.parse(body) as {
          id: number;
          method: string;
          params?: Array<Record<string, string>>;
        };
        const response = await fetch(upstreamUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        const data = (await response.json()) as { result: unknown };
        if (payload.method === "eth_getLogs" && Array.isArray(data.result)) {
          let logs = data.result;
          if (dropFundingHoldLogs)
            logs = logs.filter(
              (log) =>
                log.topics?.[0] !==
                keccak256(toHex("FundingHoldSet(bytes32,address,bytes32)")),
            );
          data.result = [...logs, ...logs].reverse();
        }
        if (
          conflictAfterProjectionRead &&
          payload.method === "eth_call" &&
          payload.params?.[0]?.data?.startsWith(
            keccak256(toHex("getDeal(bytes32)")).slice(0, 10),
          )
        )
          sawProjectionRead = true;
        if (
          conflictAfterProjectionRead &&
          sawProjectionRead &&
          payload.method === "eth_getBlockByNumber" &&
          data.result &&
          typeof data.result === "object"
        )
          (data.result as Record<string, unknown>).hash = keccak256(
            toHex("conflicting-canonical-header"),
          );
        if (wrongChain && payload.method === "eth_chainId")
          data.result = "0x38";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      } catch {
        res.writeHead(502);
        res.end();
      }
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const proxyAddr = proxy.address();
    if (!proxyAddr || typeof proxyAddr === "string")
      throw new Error("NO_PROXY_PORT");
    rpcUrl = `http://127.0.0.1:${proxyAddr.port}`;
    token = await deploy("MockIDR", [admin.address]);
    registry = await deploy("RWARegistry", [
      admin.address,
      verifier.address,
      token,
      8000n,
      150n,
      100000000n,
    ]);
    vault = await deploy("FinancingVault", [admin.address, registry]);
    executor = await deploy("AgentExecutor", [
      admin.address,
      agent.address,
      registry,
      vault,
    ]);
    await contractWrite(admin, registry, registryAbi, "configureEndpoints", [
      vault,
      executor,
    ]);
    await contractWrite(admin, vault, vaultAbi, "grantRole", [
      keccak256(toHex("LENDER_ROLE")),
      lender.address,
    ]);
    await contractWrite(admin, token, mockIdrAbi, "mint", [
      lender.address,
      10000000000n,
    ]);
    await contractWrite(admin, token, mockIdrAbi, "mint", [
      buyer.address,
      10000000000n,
    ]);
    await contractWrite(lender, token, mockIdrAbi, "approve", [
      vault,
      10000000000n,
    ]);
    await contractWrite(buyer, token, mockIdrAbi, "approve", [
      vault,
      10000000000n,
    ]);
    Object.assign(process.env, {
      APP_ENV: "local",
      CHAIN_ID: "31337",
      RPC_HTTP_URL: rpcUrl,
      RPC_FALLBACK_HTTP_URL: "",
      CHAIN_CONFIRMATIONS: "1",
      INDEXER_RESCAN_BLOCKS: "20",
      CONTRACT_REGISTRY_ADDRESS: registry,
      CONTRACT_VAULT_ADDRESS: vault,
      CONTRACT_AGENT_EXECUTOR_ADDRESS: executor,
      MOCK_IDR_ADDRESS: token,
      DEPLOYMENT_START_BLOCK: deploymentStartBlock.toString(),
    });
    await validateStartup();
    await indexOnce();
  }, 120000);
  afterAll(async () => {
    await closeDb();
    if (proxy) {
      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy!.close(() => resolve()));
    }
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    if (adminSql && ownedDatabase) {
      await adminSql.unsafe(
        `DROP DATABASE IF EXISTS "${ownedDatabase}" WITH (FORCE)`,
      );
      await adminSql.end();
    }
    for (const key of Object.keys(process.env))
      if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }, 30000);

  it("deploys Paris bytecode and validates TypeScript-to-Solidity exact signed terms", async () => {
    await expect(validateStartup()).resolves.toEqual({
      chainId: 31337,
      status: "READY",
    });
    const claim = await registerClaim();
    await indexOnce();
    expect(await projection(claim.claimKey)).toMatchObject({
      principal: "70000000",
      fixedFee: "1050000",
      financingStatus: "UNFUNDED",
      stateConfidence: "CONFIRMED_PROJECTION",
    });
  });
  it("deduplicates duplicate/out-of-order logs and repeated jobs without crediting twice", async () => {
    const claim = await registerClaim();
    await contractWrite(lender, vault, vaultAbi, "fundAndDisburse", [
      claim.claimKey,
    ]);
    await contractWrite(buyer, vault, vaultAbi, "collectBuyerPayment", [
      claim.claimKey,
      50000000n,
    ]);
    await indexOnce();
    const first = await counts();
    await indexOnce();
    await indexOnce();
    expect(await counts()).toEqual(first);
    expect(await projection(claim.claimKey)).toMatchObject({
      totalCollected: "50000000",
      lenderClaimable: "50000000",
      borrowerResidualClaimable: "0",
      remainingInvoiceCollection: "50000000",
    });
    const duplicates =
      await getSql()`SELECT tx_hash,log_index FROM chain_events GROUP BY chain_id,tx_hash,log_index HAVING count(*)>1`;
    expect(duplicates).toHaveLength(0);
  });
  it("rolls back crash before projection commit, then recovers each mined payment exactly once", async () => {
    const claim = await registerClaim();
    await contractWrite(lender, vault, vaultAbi, "fundAndDisburse", [
      claim.claimKey,
    ]);
    await indexOnce();
    const before = await counts();
    const [checkpoint] =
      await getSql()`SELECT block_number FROM indexer_checkpoints WHERE chain_id=31337`;
    await contractWrite(buyer, vault, vaultAbi, "collectBuyerPayment", [
      claim.claimKey,
      71050000n,
    ]);
    await expect(indexOnce({ crashBeforeCommit: true })).rejects.toThrow(
      "TEST_CRASH_BEFORE_PROJECTION_COMMIT",
    );
    expect(await counts()).toEqual(before);
    expect((await projection(claim.claimKey)).totalCollected).toBe("0");
    const [after] =
      await getSql()`SELECT block_number,degraded FROM indexer_checkpoints WHERE chain_id=31337`;
    expect(after.block_number).toBe(checkpoint.block_number);
    expect(after.degraded).toBe(true);
    await indexOnce();
    await indexOnce();
    expect(await projection(claim.claimKey)).toMatchObject({
      totalCollected: "71050000",
      financingStatus: "REPAID",
      collectionStatus: "PARTIALLY_COLLECTED",
      remainingInvoiceCollection: "28950000",
    });
  });
  it("rebuilds projections from deployment events and reconciles withdrawals against the contract", async () => {
    const claim = await registerClaim();
    await contractWrite(lender, vault, vaultAbi, "fundAndDisburse", [
      claim.claimKey,
    ]);
    await contractWrite(buyer, vault, vaultAbi, "collectBuyerPayment", [
      claim.claimKey,
      100000000n,
    ]);
    await contractWrite(lender, vault, vaultAbi, "withdrawLender", [
      claim.claimKey,
    ]);
    await indexOnce();
    const before = await projection(claim.claimKey);
    await getSql()`DELETE FROM financial_projections`;
    await indexOnce();
    expect(await projection(claim.claimKey)).toEqual(before);
    expect(before).toMatchObject({
      lenderWithdrawn: "71050000",
      lenderClaimable: "0",
      borrowerResidualClaimable: "28950000",
      financingStatus: "REPAID",
      collectionStatus: "FULLY_COLLECTED",
    });
  });
  it("rewinds a real Anvil reorg, retains audit reversal, and replays the replacement payment", async () => {
    const claim = await registerClaim();
    await contractWrite(lender, vault, vaultAbi, "fundAndDisburse", [
      claim.claimKey,
    ]);
    await indexOnce();
    const snapshot = await testClient.snapshot();
    const orphan = await contractWrite(
      buyer,
      vault,
      vaultAbi,
      "collectBuyerPayment",
      [claim.claimKey, 50000000n],
    );
    await indexOnce();
    expect((await projection(claim.claimKey)).totalCollected).toBe("50000000");
    await testClient.revert({ id: snapshot });
    await testClient.setNextBlockTimestamp({
      timestamp: (await client.getBlock()).timestamp + 30n,
    });
    await contractWrite(buyer, vault, vaultAbi, "collectBuyerPayment", [
      claim.claimKey,
      20000000n,
    ]);
    const result = await indexOnce();
    expect(result.reorg).toBe(true);
    expect(await projection(claim.claimKey)).toMatchObject({
      totalCollected: "20000000",
      lenderClaimable: "20000000",
      remainingInvoiceCollection: "80000000",
    });
    const old =
      await getSql()`SELECT canonical FROM chain_events WHERE tx_hash=${orphan.transactionHash} AND event_name='BuyerPaymentCollected'`;
    expect(old).toHaveLength(1);
    expect(old[0].canonical).toBe(false);
    const audits =
      await getSql()`SELECT id FROM audit_events WHERE action='CHAIN_REORG_REVERSAL'`;
    expect(audits.length).toBeGreaterThan(0);
    await indexOnce();
    expect((await projection(claim.claimKey)).totalCollected).toBe("20000000");
  });
  it("rejects omitted funding-hold events by reconciling registry state", async () => {
    const claim = await registerClaim();
    await indexOnce();
    await contractWrite(verifier, registry, registryAbi, "setFundingHold", [
      claim.claimKey,
      keccak256(toHex("authorized-dispute")),
    ]);
    const before = await counts();
    dropFundingHoldLogs = true;
    try {
      await expect(indexOnce()).rejects.toThrow(
        "PROJECTION_RECONCILIATION_MISMATCH",
      );
    } finally {
      dropFundingHoldLogs = false;
    }
    expect(await counts()).toEqual(before);
    expect((await projection(claim.claimKey)).fundingHold).toBe(false);
    await indexOnce();
    expect((await projection(claim.claimKey)).fundingHold).toBe(true);
  });
  it("rechecks canonical hash after projection RPC reads and rolls back conflicting scans", async () => {
    const before = await counts();
    conflictAfterProjectionRead = true;
    sawProjectionRead = false;
    try {
      await expect(indexOnce()).rejects.toThrow("CHAIN_CHANGED_DURING_SCAN");
    } finally {
      conflictAfterProjectionRead = false;
      sawProjectionRead = false;
    }
    expect(await counts()).toEqual(before);
    await indexOnce();
  });
  it("marks wrong-chain RPC degraded without committing financial changes", async () => {
    const before = await counts();
    wrongChain = true;
    try {
      await expect(indexOnce()).rejects.toThrow("RPC_CHAIN_MISMATCH");
    } finally {
      wrongChain = false;
    }
    expect(await counts()).toEqual(before);
    const [row] =
      await getSql()`SELECT degraded FROM indexer_checkpoints WHERE chain_id=31337`;
    expect(row.degraded).toBe(true);
    await indexOnce();
    const [recovered] =
      await getSql()`SELECT degraded FROM indexer_checkpoints WHERE chain_id=31337`;
    expect(recovered.degraded).toBe(false);
  });
  it("persists an actual same-nonce gas replacement relationship and reconciles the mined successor", async () => {
    const claim = await registerClaim(),
      sql = getSql(),
      issuerOrg = randomUUID(),
      buyerOrg = randomUUID(),
      userId = randomUUID();
    const scopedActor: Actor = {
      userId,
      wallet: buyer.address.toLowerCase() as Address,
      sessionHash: "synthetic-controller-test",
      memberships: [{ organizationId: buyerOrg, role: "BUYER" }],
    };
    await sql`INSERT INTO organizations(id,name,kind,status) VALUES(${issuerOrg},'Synthetic issuer','BORROWER','APPROVED'),(${buyerOrg},'Synthetic buyer','BUYER','APPROVED')`;
    await sql`INSERT INTO users(id,status) VALUES(${userId},'PROVISIONED_SYNTHETIC')`;
    await sql`INSERT INTO claims(id,org_id,buyer_org_id,claim_key,invoice_namespace,invoice_number,version,workflow,terms,evidence) VALUES(${claim.id},${issuerOrg},${buyerOrg},${claim.claimKey},'2026',${randomUUID()},1,'REGISTERED',${sql.json(claim.terms)},'{}')`;
    const data = encodeFunctionData({
      abi: mockIdrAbi,
      functionName: "approve",
      args: [vault, 10000000000n],
    });
    const template = {
      chainId: 31337,
      from: scopedActor.wallet,
      to: token,
      data,
      value: "0",
      action: "APPROVE_TOKEN",
    };
    const firstId = randomUUID();
    await sql`INSERT INTO transaction_intents(id,claim_id,actor_id,sender,action,status,template) VALUES(${firstId},${claim.id},${userId},${scopedActor.wallet},'APPROVE_TOKEN','PREPARED',${sql.json(template)})`;
    const sendObservation = (
      intentId: string,
      hash: Hex,
      replacesIntentId?: string,
    ) =>
      observe(
        new Request("http://localhost:3000/v1/transactions/observe", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": randomUUID(),
          },
          body: JSON.stringify({
            intentId,
            hash,
            ...(replacesIntentId ? { replacesIntentId } : {}),
          }),
        }),
        scopedActor,
        randomUUID(),
      );
    const pendingNonce = await client.getTransactionCount({
      address: buyer.address,
      blockTag: "pending",
    });
    await testClient.setAutomine(false);
    try {
      const firstHash = await wallet(buyer).sendTransaction({
        to: token,
        data,
        value: 0n,
        nonce: pendingNonce,
        gas: 100000n,
        type: "legacy",
        gasPrice: 2000000000n,
      });
      const firstObservation = await sendObservation(firstId, firstHash);
      expect(firstObservation.status).toBe(202);
      expect(await firstObservation.json()).toMatchObject({
        status: "SUBMITTED",
        nonce: pendingNonce,
      });
      const replacementHash = await wallet(buyer).sendTransaction({
        to: token,
        data,
        value: 0n,
        nonce: pendingNonce,
        gas: 100000n,
        type: "legacy",
        gasPrice: 4000000000n,
      });
      expect(replacementHash).not.toBe(firstHash);
      const recover = () =>
        observeReplacement(
          new Request(
            `http://localhost:3000/v1/transactions/${firstId}/replacement`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "idempotency-key": randomUUID(),
              },
              body: JSON.stringify({ hash: replacementHash }),
            },
          ),
          scopedActor,
          firstId,
          randomUUID(),
        );
      await expect(recover()).rejects.toMatchObject({
        code: "REPLACEMENT_AWAITING_RECEIPT",
      });
      await testClient.mine({ blocks: 1 });
      await mined(replacementHash);
      const replacementObservation = await recover();
      expect(replacementObservation.status).toBe(202);
      const replacementBody = await replacementObservation.json();
      const secondId = replacementBody.intentId;
      const [old] =
        await sql`SELECT status FROM transaction_intents WHERE id=${firstId}`;
      expect(old.status).toBe("REPLACED");
      const [successor] =
        await sql`SELECT replaces_id,status FROM transaction_intents WHERE id=${secondId}`;
      expect(successor.replaces_id).toBe(firstId);
      expect(["MINED", "CONFIRMED"]).toContain(successor.status);
      await reconcileIntents();
      const [final] =
        await sql`SELECT status,replaces_id,details FROM transaction_intents WHERE id=${secondId}`;
      expect(final.status).toBe("CONFIRMED");
      expect(final.replaces_id).toBe(firstId);
      expect(final.details.nonce).toBe(pendingNonce);
      await expect(
        client.getTransactionReceipt({ hash: firstHash }),
      ).rejects.toThrow();
    } finally {
      await testClient.setAutomine(true);
    }
    await indexOnce();
  });
  it("stops on reorg beyond recovery window and keeps the degraded state sticky", async () => {
    process.env.INDEXER_RESCAN_BLOCKS = "4";
    const snapshot = await testClient.snapshot();
    await testClient.mine({ blocks: 10 });
    await indexOnce();
    await testClient.revert({ id: snapshot });
    await testClient.setNextBlockTimestamp({
      timestamp: (await client.getBlock()).timestamp + 100n,
    });
    await testClient.mine({ blocks: 11 });
    await expect(indexOnce()).rejects.toThrow("REORG_BEYOND_RECOVERY");
    const [row] =
      await getSql()`SELECT degraded FROM indexer_checkpoints WHERE chain_id=31337`;
    expect(row.degraded).toBe(true);
    await expect(indexOnce()).rejects.toThrow("REORG_BEYOND_RECOVERY");
  });
});
