import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getSql, closeDb } from "../packages/db";
import { secretHash } from "../packages/api/core";
import { handleRequest } from "../packages/api/handler";
import { openApi } from "../packages/api/openapi";
import { setChainPortForTests } from "../packages/api/actions";
const observedTransactions = new Map<string, Record<string, unknown> | Error>();
const origin = "https://roles.test";
const sessions = new Map<
  string,
  { wallet: string; cookie: string; csrf: string }
>();
let pg: EmbeddedPostgres,
  directory: string,
  started = false;
const savedEnv = { ...process.env };
async function call(
  user: string | null,
  path: string,
  method = "GET",
  body?: unknown,
  key = randomUUID(),
  headers: Record<string, string> = {},
) {
  const session = user ? sessions.get(user) : null;
  const res = await handleRequest(
    new Request(origin + path, {
      method,
      headers: {
        Origin: origin,
        "Idempotency-Key": key,
        "Content-Type": "application/json",
        ...(session
          ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
          : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
  return { status: res.status, data: await res.json() };
}
async function newUser(name: string = randomUUID(), role?: string) {
  const sql = getSql(),
    wallet = privateKeyToAccount(generatePrivateKey()).address.toLowerCase(),
    token = randomUUID(),
    csrf = randomUUID();
  await sql`INSERT INTO users(id,status) VALUES(${name},'PENDING')`;
  await sql`INSERT INTO wallets(address,user_id) VALUES(${wallet},${name})`;
  await sql`INSERT INTO sessions(token_hash,user_id,wallet,csrf_hash,expires_at) VALUES(${secretHash(token)},${name},${wallet},${secretHash(csrf)},now()+interval '1 hour')`;
  sessions.set(name, { wallet, cookie: `talunai_session=${token}`, csrf });
  if (role) {
    await sql`INSERT INTO organizations(id,name,kind,status,synthetic) VALUES(${`org-${name}`},${`Synthetic ${name}`},${role},'APPROVED',true)`;
    await sql`INSERT INTO memberships(id,user_id,organization_id,role,approved) VALUES(${randomUUID()},${name},${`org-${name}`},${role},true)`;
  }
  return name;
}
beforeAll(async () => {
  setChainPortForTests({
    validateStartup: async () => true,
    prepareAction: async () => {
      throw new Error("SHOULD_NOT_RESIMULATE_OR_SEND");
    },
    prepareConsent: async () => {
      throw new Error("UNUSED");
    },
    verifyConsent: async () => {
      throw new Error("UNUSED");
    },
    inspectObservedTransaction: async ({ hash }) => {
      const result = observedTransactions.get(hash) ?? {
        status: "DROPPED_OR_UNKNOWN",
        hash,
      };
      if (result instanceof Error) throw result;
      return result;
    },
  });
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("PORT");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  directory = await mkdtemp(join(tmpdir(), "talunai-roles-ops-"));
  pg = new EmbeddedPostgres({
    databaseDir: join(directory, "db"),
    user: "roles-ops",
    password: "isolated-only",
    port,
    persistent: false,
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  started = true;
  await pg.createDatabase("roles-ops");
  Object.assign(process.env, {
    DATABASE_URL: `postgres://roles-ops:isolated-only@127.0.0.1:${port}/roles-ops`,
    APP_ENV: "testnet",
    CHAIN_ID: "97",
    APP_ORIGIN: origin,
    SIWE_DOMAIN: "roles.test",
    SIWE_URI: origin,
    SESSION_SECRET: "isolated-roles-ops-session-".repeat(3),
    CLAIM_ID_HMAC_KEY: "isolated-roles-ops-hmac-".repeat(3),
    CONTRACT_REGISTRY_ADDRESS: `0x${"1".repeat(40)}`,
    CONTRACT_VAULT_ADDRESS: `0x${"2".repeat(40)}`,
    CONTRACT_AGENT_EXECUTOR_ADDRESS: `0x${"3".repeat(40)}`,
    MOCK_IDR_ADDRESS: `0x${"4".repeat(40)}`,
    RPC_HTTP_URL: "http://127.0.0.1:1",
    DEPLOYMENT_START_BLOCK: "0",
    CHAIN_CONFIRMATIONS: "2",
    INDEXER_RESCAN_BLOCKS: "64",
    LLM_MODE: "mock",
  });
  await closeDb();
  const sql = getSql();
  for (const name of (
    await readdir(new URL("../packages/db/migrations/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await sql.unsafe(
      await readFile(
        new URL(`../packages/db/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  await newUser("operator", "ADMIN");
  for (const role of ["BORROWER", "BUYER", "LENDER", "VERIFIER"])
    await newUser(role.toLowerCase(), role);
  await newUser("pending");
}, 60000);
afterAll(async () => {
  await closeDb();
  if (started) await pg.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
  process.env = savedEnv;
});

async function failedRun(
  error = "PROVIDER_TIMEOUT",
  version = 1,
  currentVersion = 1,
) {
  const sql = getSql(),
    claimId = randomUUID(),
    runId = randomUUID();
  await sql`INSERT INTO claims(id,org_id,buyer_org_id,claim_key,invoice_namespace,invoice_number,version,workflow,terms,evidence) VALUES(${claimId},'org-borrower','org-buyer',${claimId},'2026',${claimId},${currentVersion},'PROCESSING_FAILED','{}','{}')`;
  await sql`INSERT INTO agent_runs(id,claim_id,version,mode,status,stage,input_hash,error,result) VALUES(${runId},${claimId},${version},'live','FAILED','FAILED','input-hash',${error},${sql.json({ provider: "openrouter", model: "model-recorded-on-run", explanation: "Provider did not complete analysis.", secret: "DO_NOT_EXPOSE", rawText: "PRIVATE_DOCUMENT" })})`;
  return { claimId, runId };
}

async function intentForReplacement(
  status = "SUBMITTED",
  nonce: number | null = 7,
) {
  const { claimId } = await failedRun(),
    intentId = randomUUID(),
    sql = getSql();
  const originalHash = `0x${"a".repeat(64)}`,
    wallet = sessions.get("borrower")!.wallet;
  await sql`UPDATE claims SET workflow='REGISTERED' WHERE id=${claimId}`;
  await sql`INSERT INTO transaction_intents(id,claim_id,actor_id,sender,action,status,template,tx_hash,details) VALUES(${intentId},${claimId},'borrower',${wallet},'FUND',${status},${sql.json({ chainId: 97, from: wallet, to: `0x${"2".repeat(40)}`, data: "0x1234", value: "0" })},${originalHash},${sql.json(nonce === null ? {} : { nonce })})`;
  return {
    claimId,
    intentId,
    path: `/v1/transactions/${intentId}/replacement`,
    originalHash,
  };
}

describe("operator APIs: actual isolated PostgreSQL, no RPC or participant keys", () => {
  const endpoints = [
    "/v1/ops/status",
    "/v1/ops/agent-runs",
    "/v1/ops/transactions",
    "/v1/ops/organizations",
    "/v1/ops/audit",
  ];
  it("rejects anonymous, pending and all three participant roles on every ops collection", async () => {
    for (const path of endpoints) {
      expect((await call(null, path)).status).toBe(401);
      for (const actor of ["pending", "borrower", "buyer", "lender"])
        expect((await call(actor, path)).status).toBe(403);
    }
  });
  it("allows real ADMIN and limits VERIFIER to operational views", async () => {
    for (const path of endpoints)
      expect((await call("operator", path)).status).toBe(200);
    for (const path of endpoints.slice(0, 3))
      expect((await call("verifier", path)).status).toBe(200);
    for (const path of endpoints.slice(3))
      expect((await call("verifier", path)).status).toBe(403);
  });
  it("does not fabricate a healthy worker/indexer when there are no observations", async () => {
    const response = await call("operator", "/v1/ops/status");
    expect(response.data.status).toBe("UNAVAILABLE");
    expect(response.data.worker).toEqual({
      status: "UNAVAILABLE",
      updatedAt: null,
      errorCode: null,
      mode: null,
      model: null,
      configuredMode: "mock",
      configurationMatch: null,
    });
    expect(response.data.indexer.blockNumber).toBeNull();
  });
  it("reports persisted freshness/degraded state, exact large block numbers and durable outbox counts", async () => {
    const sql = getSql();
    await sql`INSERT INTO worker_heartbeats(id,status,provider_mode) VALUES('worker','READY','mock')`;
    await sql`INSERT INTO indexer_checkpoints(chain_id,block_number,block_hash) VALUES(97,90071992547409930,'observed-block-hash')`;
    await sql`INSERT INTO outbox(id,type,payload) VALUES(${randomUUID()},'ANALYZE_CLAIM','{}')`;
    const live = (await call("verifier", "/v1/ops/status")).data;
    expect(live.status).toBe("READY");
    expect(live.worker).toMatchObject({
      mode: "mock",
      model: null,
      configuredMode: "mock",
      configurationMatch: true,
    });
    expect(live.indexer.blockNumber).toBe("90071992547409930");
    expect(live.queues).toMatchObject({
      source: "POSTGRES_OUTBOX",
      pending: 1,
    });
    await sql`UPDATE worker_heartbeats SET updated_at=now()-interval '3 minutes' WHERE id='worker'`;
    expect((await call("verifier", "/v1/ops/status")).data.worker.status).toBe(
      "STALE",
    );
    await sql`UPDATE worker_heartbeats SET status='DEGRADED',error_code='https://private-secret-provider' WHERE id='worker'`;
    const degraded = (await call("operator", "/v1/ops/status")).data;
    expect(degraded.status).toBe("DEGRADED");
    expect(degraded.worker.errorCode).toBe("REDACTED_ERROR");
  });
  it("degrades worker status when its actual provider mode differs from web config", async () => {
    const sql = getSql();
    await sql`INSERT INTO worker_heartbeats(id,status,provider_mode,provider_model) VALUES('worker','READY','live','qwen/qwen3.5-flash-02-23') ON CONFLICT(id) DO UPDATE SET status='READY',provider_mode='live',provider_model='qwen/qwen3.5-flash-02-23',updated_at=now()`;
    const response = await call("operator", "/v1/ops/status");
    expect(response.data.status).toBe("DEGRADED");
    expect(response.data.worker).toMatchObject({
      status: "DEGRADED",
      mode: "live",
      configuredMode: "mock",
      configurationMatch: false,
    });
    const { claimId } = await failedRun();
    await sql`UPDATE claims SET workflow='DRAFT' WHERE id=${claimId}`;
    const request = await call(
      "borrower",
      `/v1/claims/${claimId}/analyze`,
      "POST",
      { expectedVersion: 1 },
    );
    expect(request.status).toBe(503);
    expect(request.data.error.code).toBe(
      "AGENT_PROVIDER_CONFIGURATION_MISMATCH",
    );
    await sql`UPDATE worker_heartbeats SET provider_mode='mock',provider_model=null,error_code=null WHERE id='worker'`;
  });
  it("checks membership and organization revocation on every request including normal claims", async () => {
    const { claimId } = await failedRun();
    expect((await call("borrower", `/v1/claims/${claimId}`)).status).toBe(200);
    await getSql()`UPDATE organizations SET status='REVOKED' WHERE id='org-borrower'`;
    expect((await call("borrower", `/v1/claims/${claimId}`)).status).toBe(404);
    expect((await call("borrower", "/v1/me")).data.memberships).toEqual([]);
    await getSql()`UPDATE organizations SET status='APPROVED' WHERE id='org-borrower'`;
    await getSql()`UPDATE memberships SET approved=false WHERE user_id='verifier'`;
    expect((await call("verifier", "/v1/ops/status")).status).toBe(403);
    await getSql()`UPDATE memberships SET approved=true WHERE user_id='verifier'`;
  });
  it("denies a suspended account even when its session and membership remain valid", async () => {
    await getSql()`UPDATE users SET status='SUSPENDED' WHERE id='borrower'`;
    try {
      const denied = await call("borrower", "/v1/me");
      expect(denied.status).toBe(403);
      expect(denied.data.error.code).toBe("ACCOUNT_INACTIVE");
      expect((await call("borrower", "/v1/claims")).status).toBe(403);
    } finally {
      await getSql()`UPDATE users SET status='PENDING' WHERE id='borrower'`;
    }
  });
  it("a borrower role in another issuer cannot analyze a claim visible through buyer membership", async () => {
    const user = await newUser("dual-role", "BORROWER"),
      { claimId } = await failedRun();
    await getSql()`INSERT INTO memberships(id,user_id,organization_id,role,approved) VALUES(${randomUUID()},${user},'org-buyer','BUYER',true)`;
    expect((await call(user, `/v1/claims/${claimId}`)).status).toBe(200);
    expect(
      (
        await call(user, `/v1/claims/${claimId}/analyze`, "POST", {
          expectedVersion: 1,
        })
      ).status,
    ).toBe(403);
  });
  it("bounds filters/pagination and rejects unknown methods without executing mutations", async () => {
    for (const path of [
      "/v1/ops/agent-runs?status=APPROVED",
      "/v1/ops/transactions?status=SUCCESS",
      "/v1/ops/organizations?limit=101",
      "/v1/ops/audit?offset=1000001",
      "/v1/ops/audit?action=x%20OR%20true",
    ])
      expect((await call("operator", path)).status).toBe(422);
    expect((await call("operator", "/v1/ops/status", "POST", {})).status).toBe(
      404,
    );
    expect(
      (
        await call("operator", "/v1/ops/status", "POST", {}, randomUUID(), {
          "X-CSRF-Token": "",
        })
      ).status,
    ).toBe(403);
  });
  it("shows persisted run metadata and bounded steps without model/private document extras", async () => {
    const { runId } = await failedRun();
    await getSql()`INSERT INTO agent_steps(id,run_id,step,stage,result) VALUES(${randomUUID()},${runId},1,'EXTRACT','{"provider":"openrouter","model":"actual-recorded","documentIds":["evidence-reference"],"rawText":"PRIVATE_DOCUMENT"}')`;
    const detail = await call("verifier", `/v1/ops/agent-runs/${runId}`);
    expect(detail.status).toBe(200);
    expect(detail.data).toMatchObject({
      provider: "openrouter",
      model: "model-recorded-on-run",
      mode: "live",
      retryable: true,
      errorCode: "PROVIDER_TIMEOUT",
    });
    expect(detail.data.steps[0]).toMatchObject({
      model: "actual-recorded",
      evidenceIds: ["evidence-reference"],
    });
    expect(JSON.stringify(detail.data)).not.toMatch(
      /PRIVATE_DOCUMENT|DO_NOT_EXPOSE|rawText/,
    );
    expect((await call("borrower", `/v1/ops/agent-runs/${runId}`)).status).toBe(
      403,
    );
    const list = await call(
      "operator",
      "/v1/ops/agent-runs?status=FAILED&limit=1",
    );
    expect(list.data.items).toHaveLength(1);
    expect(list.data.total).toBeGreaterThan(1);
  });
  it("includes in-progress analysis in run filters and health counts", async () => {
    const { runId } = await failedRun();
    await getSql()`UPDATE agent_runs SET status='RUNNING',stage='EXTRACTION' WHERE id=${runId}`;
    const list = await call("operator", "/v1/ops/agent-runs?status=RUNNING");
    expect(
      list.data.items.some((item: { id: string }) => item.id === runId),
    ).toBe(true);
    const status = await call("operator", "/v1/ops/status");
    expect(status.data.runs.RUNNING).toBeGreaterThanOrEqual(1);
  });
  it("ops transactions omit signature/calldata while audit omits private reason/details", async () => {
    const { claimId } = await failedRun(),
      sql = getSql();
    await sql`INSERT INTO transaction_intents(id,claim_id,actor_id,sender,action,status,template,details) VALUES(${randomUUID()},${claimId},'borrower',${sessions.get("borrower")!.wallet},'REGISTER','PREPARED','{"data":"private-signature"}','{"rawTransaction":"private-raw"}')`;
    await sql`INSERT INTO audit_events(id,actor_id,action,target,correlation_id,reason,details) VALUES(${randomUUID()},'borrower','TEST_AUDIT',${claimId},${randomUUID()},'private-document-text','{"secret":"private-secret"}')`;
    const transactions = await call(
      "operator",
      "/v1/ops/transactions?status=PREPARED",
    );
    expect(transactions.data.items[0]).toMatchObject({
      claimId,
      status: "PREPARED",
    });
    expect(JSON.stringify(transactions.data)).not.toMatch(
      /private-|template|details/,
    );
    const audit = await call("operator", "/v1/ops/audit?action=TEST_AUDIT");
    expect(audit.data.items).toHaveLength(1);
    expect(JSON.stringify(audit.data)).not.toMatch(/private-|reason|details/);
    const orgs = (await call("operator", "/v1/ops/organizations")).data.items;
    expect(
      orgs.find((o: { id: string }) => o.id === "org-borrower").memberships[0]
        .wallets,
    ).toEqual([sessions.get("borrower")!.wallet]);
  });
  it("retry requires CSRF/operator authority and rejects extra action fields", async () => {
    const { runId } = await failedRun(),
      path = `/v1/ops/agent-runs/${runId}/retry`,
      body = { expectedVersion: 1 };
    expect((await call("borrower", path, "POST", body)).status).toBe(403);
    expect(
      (
        await call("operator", path, "POST", body, randomUUID(), {
          "X-CSRF-Token": "",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("operator", path, "POST", body, randomUUID(), {
          Origin: "https://evil.test",
        })
      ).status,
    ).toBe(403);
    expect(
      (await call("operator", path, "POST", { ...body, recipient: "evil" }))
        .status,
    ).toBe(422);
  });
  it("retry atomically persists one new run/outbox and idempotent result, never an approval", async () => {
    const { runId, claimId } = await failedRun(),
      sql = getSql(),
      path = `/v1/ops/agent-runs/${runId}/retry`,
      key = randomUUID();
    const results = await Promise.all([
      call("operator", path, "POST", { expectedVersion: 1 }, key),
      call("operator", path, "POST", { expectedVersion: 1 }, key),
    ]);
    expect(results[0].status).toBe(202);
    expect(results[1].data).toEqual(results[0].data);
    expect(
      (
        await sql`SELECT status,stage,error FROM agent_runs WHERE id=${runId}`
      )[0],
    ).toMatchObject({
      status: "STALE",
      stage: "SUPERSEDED_BY_RETRY",
      error: "PROVIDER_TIMEOUT",
    });
    expect(
      await sql`SELECT id FROM outbox WHERE payload->>'runId'=${results[0].data.runId}`,
    ).toHaveLength(1);
    expect(
      (await sql`SELECT workflow FROM claims WHERE id=${claimId}`)[0].workflow,
    ).toBe("EXTRACTING");
    expect(
      await sql`SELECT id FROM review_decisions WHERE claim_id=${claimId}`,
    ).toHaveLength(0);
    expect(
      (await call("operator", path, "POST", { expectedVersion: 2 }, key))
        .status,
    ).toBe(409);
    expect(
      (await call("verifier", path, "POST", { expectedVersion: 1 })).status,
    ).toBe(409);
  });
  it("permanent/stale failure never becomes retryable and manual retries are bounded", async () => {
    for (const error of [
      "PROVIDER_REFUSAL",
      "SCHEMA_INVALID",
      "SIGNATURE_INVALID",
      "AGENT_PROCESSING_FAILED",
    ]) {
      const { runId } = await failedRun(error);
      expect(
        (await call("operator", `/v1/ops/agent-runs/${runId}`)).data.retryable,
      ).toBe(false);
      expect(
        (
          await call("operator", `/v1/ops/agent-runs/${runId}/retry`, "POST", {
            expectedVersion: 1,
          })
        ).data.error.code,
      ).toBe("RUN_NOT_RETRYABLE");
    }
    const stale = await failedRun("PROVIDER_TIMEOUT", 1, 2);
    expect(
      (
        await call(
          "operator",
          `/v1/ops/agent-runs/${stale.runId}/retry`,
          "POST",
          { expectedVersion: 2 },
        )
      ).status,
    ).toBe(409);
    const bounded = await failedRun();
    for (let i = 0; i < 3; i++)
      await getSql()`INSERT INTO audit_events(id,actor_id,action,target,correlation_id,details) VALUES(${randomUUID()},'operator','ANALYSIS_RETRY_REQUESTED',${bounded.claimId},${randomUUID()},'{"version":1}')`;
    expect(
      (await call("operator", `/v1/ops/agent-runs/${bounded.runId}`)).data
        .retryable,
    ).toBe(false);
    expect(
      (
        await call(
          "operator",
          `/v1/ops/agent-runs/${bounded.runId}/retry`,
          "POST",
          { expectedVersion: 1 },
        )
      ).data.error.code,
    ).toBe("RETRY_LIMIT_REACHED");
  });
  it("distinct retry keys racing for one failed run create only one replacement", async () => {
    const { runId, claimId } = await failedRun();
    const outcomes = await Promise.all([
      call("operator", `/v1/ops/agent-runs/${runId}/retry`, "POST", {
        expectedVersion: 1,
      }),
      call("verifier", `/v1/ops/agent-runs/${runId}/retry`, "POST", {
        expectedVersion: 1,
      }),
    ]);
    expect(outcomes.map((r) => r.status).sort()).toEqual([202, 409]);
    expect(
      await getSql()`SELECT id FROM agent_runs WHERE claim_id=${claimId} AND status='QUEUED'`,
    ).toHaveLength(1);
  });
  it("every ops success response is explicitly documented instead of a generic object", () => {
    for (const [path, methods] of Object.entries(openApi.paths))
      if (path.startsWith("/v1/ops/")) {
        for (const operation of Object.values(methods)) {
          const op = operation as {
            responses: Record<
              string,
              {
                content?: {
                  "application/json": { schema: Record<string, unknown> };
                };
              }
            >;
          };
          expect(
            op.responses["200"]?.content?.["application/json"].schema ??
              op.responses["202"].content?.["application/json"].schema,
          ).toHaveProperty("$ref");
        }
      }
  });
  it("replacement recovery cannot overwrite terminal intents, trust a pending hash or skip nonce verification", async () => {
    const hash = `0x${"b".repeat(64)}`,
      body = { hash };
    for (const status of ["CONFIRMED", "REVERTED", "REPLACED"]) {
      const { path } = await intentForReplacement(status);
      expect((await call("borrower", path, "POST", body)).data.error.code).toBe(
        "INVALID_REPLACEMENT",
      );
    }
    const original = await intentForReplacement();
    expect((await call("buyer", original.path, "POST", body)).status).toBe(404);
    expect(
      (
        await call("borrower", original.path, "POST", body, randomUUID(), {
          "X-CSRF-Token": "",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("borrower", original.path, "POST", {
          ...body,
          recipient: "evil",
        })
      ).status,
    ).toBe(422);
    expect(
      (await call("borrower", original.path, "POST", body)).data.error.code,
    ).toBe("REPLACEMENT_TRANSACTION_NOT_OBSERVED");
    observedTransactions.set(hash, { status: "SUBMITTED", nonce: 7 });
    expect(
      (await call("borrower", original.path, "POST", body)).data.error.code,
    ).toBe("REPLACEMENT_AWAITING_RECEIPT");
    observedTransactions.set(hash, { status: "CONFIRMED", nonce: 8 });
    expect(
      (await call("borrower", original.path, "POST", body)).data.error.code,
    ).toBe("REPLACEMENT_NONCE_NOT_VERIFIED");
    const noNonce = await intentForReplacement("DROPPED_OR_UNKNOWN", null);
    expect(
      (await call("borrower", noNonce.path, "POST", body)).data.error.code,
    ).toBe("REPLACEMENT_NONCE_NOT_VERIFIED");
    observedTransactions.set(hash, new Error("TRANSACTION_TEMPLATE_MISMATCH"));
    expect(
      (await call("borrower", original.path, "POST", body)).data.error.code,
    ).toBe("CHAIN_VALIDATION_FAILED");
    expect(
      (
        await getSql()`SELECT status FROM transaction_intents WHERE id=${original.intentId}`
      )[0].status,
    ).toBe("SUBMITTED");
    expect(
      await getSql()`SELECT id FROM transaction_intents WHERE replaces_id=${original.intentId}`,
    ).toHaveLength(0);
  });
  it("already-mined replacement inherits exact trusted template without prepare/send and links one successor", async () => {
    const source = await intentForReplacement(),
      hash = `0x${"c".repeat(64)}`,
      sql = getSql();
    observedTransactions.set(hash, {
      status: "CONFIRMED",
      nonce: 7,
      hash,
      method: "fundAndDisburse",
    });
    const [first, same] = await Promise.all([
      call("borrower", source.path, "POST", { hash }),
      call("borrower", source.path, "POST", { hash }),
    ]);
    expect(first.status).toBe(202);
    expect(same.status).toBe(202);
    expect(same.data.intentId).toBe(first.data.intentId);
    const [old] =
      await sql`SELECT status,tx_hash,template FROM transaction_intents WHERE id=${source.intentId}`;
    expect(old).toMatchObject({
      status: "REPLACED",
      tx_hash: source.originalHash,
    });
    expect(
      (
        await call("borrower", "/v1/transactions/observe", "POST", {
          intentId: source.intentId,
          hash: source.originalHash,
        })
      ).data.error.code,
    ).toBe("INTENT_REPLACED");
    const rows =
      await sql`SELECT * FROM transaction_intents WHERE replaces_id=${source.intentId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "CONFIRMED",
      action: "FUND",
      tx_hash: hash,
      template: old.template,
    });
    expect(
      await sql`SELECT id FROM outbox WHERE payload->>'intentId'=${rows[0].id}`,
    ).toHaveLength(1);
    expect(
      await sql`SELECT id FROM audit_events WHERE target=${source.claimId} AND action='TRANSACTION_REPLACEMENT_OBSERVED'`,
    ).toHaveLength(1);
  });
  it("consent invalidation evidence follows canonical current-chain signer/nonce events and rewinds on reorg", async () => {
    const { claimId } = await failedRun(),
      sql = getSql(),
      signer = sessions.get("borrower")!.wallet,
      txHash = `0x${"e".repeat(64)}`,
      eventId = randomUUID();
    await sql`INSERT INTO consent_records(id,claim_id,version,role,signer,nonce,deadline,signature,terms_hash) VALUES(${randomUUID()},${claimId},1,'BORROWER',${signer},'79',2000000000,'PRIVATE_SIGNATURE','terms-hash')`;
    const evidence = () => call("borrower", `/v1/claims/${claimId}/evidence`);
    expect((await evidence()).data.consents[0]).toMatchObject({
      nonce: "79",
      revoked: false,
      onchainInvalidation: null,
    });
    await sql`INSERT INTO chain_events(id,chain_id,tx_hash,log_index,block_number,block_hash,contract_address,event_name,args,canonical) VALUES(${eventId},97,${txHash},1,777,'block-hash',${process.env.CONTRACT_REGISTRY_ADDRESS!.toLowerCase()},'ConsentNonceInvalidated',${sql.json({ signer, nonce: "79" })},true)`;
    const response = (await evidence()).data;
    expect(response.consents[0]).toMatchObject({
      revoked: false,
      onchainInvalidation: {
        txHash,
        blockNumber: "777",
        blockHash: "block-hash",
      },
    });
    expect(JSON.stringify(response)).not.toContain("PRIVATE_SIGNATURE");
    await sql`UPDATE chain_events SET canonical=false WHERE id=${eventId}`;
    expect((await evidence()).data.consents[0].onchainInvalidation).toBeNull();
    await sql`UPDATE chain_events SET canonical=true,chain_id=31337 WHERE id=${eventId}`;
    expect((await evidence()).data.consents[0].onchainInvalidation).toBeNull();
  });
});
