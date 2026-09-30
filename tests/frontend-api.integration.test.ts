import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createServer as httpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getSql, closeDb } from "../packages/db";
import { handleRequest } from "../packages/api/handler";
import { processClaim } from "../packages/agents/process";
import { POLICY_HASH } from "../packages/domain/policy";
import { chainService, termsHash } from "../packages/chain/service";
import { setChainPortForTests } from "../packages/api/actions";
import { enqueueUnheldDisputeHolds } from "../packages/chain/indexer";
import { canonical, hash } from "../packages/api/core";
import type { GoodsMetadata } from "../packages/domain/goods";
import { TalunaiClient, TalunaiApiError } from "../packages/client";

// This suite starts its own temporary PostgreSQL cluster and a read-only SIWE RPC stub.
// It never loads .env files, calls public BSC, runs a worker, or writes financial state.
const origin = "https://frontend-api.test";
const actors = Object.fromEntries(
  ["borrower", "buyer", "lender", "other", "verifier", "pending"].map(
    (role) => [role, privateKeyToAccount(generatePrivateKey())],
  ),
);
const ids = {
  claim: randomUUID(),
  otherClaim: randomUUID(),
  document: randomUUID(),
  run: randomUUID(),
  otherRun: randomUUID(),
  intent: randomUUID(),
  otherIntent: randomUUID(),
  task: randomUUID(),
};
type Login = { cookie: string; csrf: string; response: Response };
let pg: EmbeddedPostgres | undefined,
  rpc: Server | undefined,
  directory: string | undefined,
  started = false;
const savedEnv: Record<string, string | undefined> = {};
const sessions: Record<string, Login> = {};
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("PORT_UNAVAILABLE");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  session?: Login,
  extra: Record<string, string> = {},
) {
  const response = await handleRequest(
    new Request(origin + path, {
      method,
      headers: {
        Origin: origin,
        ...(session
          ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
          : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        "Idempotency-Key": randomUUID(),
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  return {
    response,
    status: response.status,
    data: await response.clone().json(),
  };
}
async function login(role: string): Promise<Login> {
  const account = actors[role],
    challenge = await call("/v1/auth/challenge", "POST", {
      address: account.address,
      chainId: 97,
    });
  expect(challenge.status).toBe(200);
  const browser = challenge.response.headers.getSetCookie()[0].split(";")[0];
  const signature = await account.signMessage({
    message: challenge.data.message,
  });
  const verified = await call(
    "/v1/auth/verify",
    "POST",
    {
      challengeId: challenge.data.challengeId,
      message: challenge.data.message,
      signature,
    },
    undefined,
    { Cookie: browser },
  );
  expect(verified.status).toBe(200);
  return {
    cookie: verified.response.headers
      .getSetCookie()
      .filter((c) => !c.includes("Max-Age=0"))
      .map((c) => c.split(";")[0])
      .join("; "),
    csrf: verified.data.csrfToken,
    response: verified.response,
  };
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "talunai-frontend-api-"));
  const port = await freePort();
  pg = new EmbeddedPostgres({
    databaseDir: join(directory, "postgres"),
    user: "frontend_test",
    password: "isolated-test-only",
    port,
    persistent: false,
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  started = true;
  await pg.createDatabase("frontend_test");
  rpc = httpServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const input = JSON.parse(text);
    const result =
      input.method === "eth_chainId"
        ? "0x61"
        : input.method === "eth_getCode"
          ? "0x"
          : input.method === "eth_getBlockByNumber"
            ? {
                number: "0x1",
                hash: `0x${"1".repeat(64)}`,
                parentHash: `0x${"0".repeat(64)}`,
                nonce: "0x0000000000000000",
                sha3Uncles: `0x${"0".repeat(64)}`,
                logsBloom: `0x${"0".repeat(512)}`,
                transactionsRoot: `0x${"0".repeat(64)}`,
                stateRoot: `0x${"0".repeat(64)}`,
                receiptsRoot: `0x${"0".repeat(64)}`,
                miner: `0x${"0".repeat(40)}`,
                difficulty: "0x0",
                totalDifficulty: "0x0",
                extraData: "0x",
                size: "0x0",
                gasLimit: "0x1c9c380",
                gasUsed: "0x0",
                timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
                transactions: [],
                uncles: [],
              }
            : undefined;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        result === undefined
          ? {
              jsonrpc: "2.0",
              id: input.id,
              error: {
                code: -32601,
                message: "Only read-only auth methods supported",
              },
            }
          : { jsonrpc: "2.0", id: input.id, result },
      ),
    );
  });
  await new Promise<void>((resolve) => rpc!.listen(0, "127.0.0.1", resolve));
  const rpcAddress = rpc.address();
  if (!rpcAddress || typeof rpcAddress === "string")
    throw new Error("RPC_STUB_ADDRESS");
  const env = {
    DATABASE_URL: `postgres://frontend_test:isolated-test-only@127.0.0.1:${port}/frontend_test`,
    APP_ENV: "testnet",
    APP_ORIGIN: origin,
    SIWE_DOMAIN: "frontend-api.test",
    SIWE_URI: origin,
    SESSION_SECRET: "isolated-session-secret-".repeat(3),
    CLAIM_ID_HMAC_KEY: "isolated-claim-key-".repeat(3),
    CHAIN_ID: "97",
    RPC_HTTP_URL: `http://127.0.0.1:${rpcAddress.port}`,
    CONTRACT_REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000001",
    CONTRACT_VAULT_ADDRESS: "0x0000000000000000000000000000000000000002",
    CONTRACT_AGENT_EXECUTOR_ADDRESS:
      "0x0000000000000000000000000000000000000003",
    MOCK_IDR_ADDRESS: "0x0000000000000000000000000000000000000004",
    LLM_MODE: "mock",
    DEPLOYMENT_START_BLOCK: "0",
    CHAIN_CONFIRMATIONS: "2",
    INDEXER_RESCAN_BLOCKS: "64",
    DOCUMENT_STORAGE_ROOT: join(directory, "documents"),
    AGENT_MAX_STEPS: "8",
    AGENT_TIMEOUT_MS: "30000",
  };
  for (const [key, value] of Object.entries(env)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
  await closeDb();
  const sql = getSql();
  for (const name of (
    await readdir(new URL("../packages/db/migrations/", import.meta.url))
  )
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await sql.unsafe(
      await readFile(
        new URL(`../packages/db/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  for (const [role, account] of Object.entries(actors)) {
    await sql`INSERT INTO users(id,status) VALUES(${`user-${role}`},${role === "pending" ? "PENDING" : "PROVISIONED_SYNTHETIC"})`;
    await sql`INSERT INTO wallets(address,user_id) VALUES(${account.address.toLowerCase()},${`user-${role}`})`;
    if (role === "pending") continue;
    const kind = role === "other" ? "BORROWER" : role.toUpperCase();
    await sql`INSERT INTO organizations(id,name,kind,status,synthetic) VALUES(${`org-${role}`},${`Synthetic ${role}`},${kind},'APPROVED',true)`;
    await sql`INSERT INTO memberships(id,user_id,organization_id,role,approved) VALUES(${randomUUID()},${`user-${role}`},${`org-${role}`},${kind},true)`;
  }
  await sql`INSERT INTO organizations(id,name,kind,status,synthetic) VALUES('org-unapproved','Hidden pending buyer','BUYER','PENDING',true),('org-empty','Approved but no authority','BUYER','APPROVED',true)`;
  const terms = {
    borrower: actors.borrower.address.toLowerCase(),
    buyer: actors.buyer.address.toLowerCase(),
    token: env.MOCK_IDR_ADDRESS,
    acceptedOutstanding: "100000000",
    principal: "70000000",
    fee: "1050000",
    fundingDeadline: 1900000000,
    invoiceDueAt: 1904000000,
    reviewExpiry: 1900000000,
    consentExpiry: 1900000000,
    evidenceCommitment: `0x${"0".repeat(64)}`,
    decisionHash: `0x${"0".repeat(64)}`,
    policyHash: `0x${"0".repeat(64)}`,
  };
  for (const [claimId, org, number, workflow] of [
    [ids.claim, "org-borrower", "COCOA-001", "DRAFT"],
    [ids.otherClaim, "org-other", "SECRET-OTHER-002", "NEEDS_REVIEW"],
  ])
    await sql`INSERT INTO claims(id,org_id,buyer_org_id,claim_key,invoice_namespace,invoice_number,terms,evidence,workflow) VALUES(${claimId},${org},'org-buyer',${`0x${claimId.replaceAll("-", "").padEnd(64, "0")}`},'2026',${number},${sql.json(terms)},${sql.json({ externalEncumbranceCheckStatus: "NOT_INTEGRATED" })},${workflow})`;
  await sql`INSERT INTO claim_access(claim_id,org_id) VALUES(${ids.claim},'org-lender')`;
  await sql`INSERT INTO documents(id,claim_id,version,original_name,storage_key,sha256,commitment,mime,byte_size,extracted_text,status,retention_at) VALUES(${ids.document},${ids.claim},1,'Kakao invoice.pdf','private-storage-location',${"a".repeat(64)},${"0x" + "b".repeat(64)},'application/pdf',2500,'Private document body never belongs in metadata','PARSED',now()+interval '30 days')`;
  for (const [runId, claimId] of [
    [ids.run, ids.claim],
    [ids.otherRun, ids.otherClaim],
  ])
    await sql`INSERT INTO agent_runs(id,claim_id,version,mode,status,stage,input_hash,result) VALUES(${runId},${claimId},1,'mock','COMPLETED','POLICY',${"a".repeat(64)},${sql.json({ explanation: "Synthetic evidence needs review", evidenceIds: [ids.document] })})`;
  await sql`INSERT INTO agent_steps(id,run_id,step,stage,result) VALUES(${randomUUID()},${ids.run},1,'EXTRACTION',${sql.json({ missingFields: [] })})`;
  const template = {
    chainId: 97,
    from: actors.borrower.address,
    to: env.CONTRACT_REGISTRY_ADDRESS,
    data: "0x",
    value: "0",
  };
  for (const [intentId, actor] of [
    [ids.intent, "borrower"],
    [ids.otherIntent, "buyer"],
  ])
    await sql`INSERT INTO transaction_intents(id,claim_id,actor_id,sender,action,status,template) VALUES(${intentId},${ids.claim},${`user-${actor}`},${actors[actor].address.toLowerCase()},'CANCEL','PREPARED',${sql.json(template)})`;
  await sql`INSERT INTO review_tasks(id,claim_id,version,role,kind,status,details) VALUES(${ids.task},${ids.claim},1,'BORROWER','MISSING_EVIDENCE','OPEN',${sql.json({ reasonCodes: ["BUYER_ACKNOWLEDGEMENT_REQUIRED"] })})`;
  for (const role of Object.keys(actors)) sessions[role] = await login(role);
}, 60000);
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await closeDb();
  if (rpc) await new Promise<void>((resolve) => rpc!.close(() => resolve()));
  if (pg && started) await pg.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}, 30000);

describe("frontend read API with isolated PostgreSQL and synthetic read-only SIWE RPC", () => {
  it("login sets a readable Secure CSRF cookie and keeps opaque session HttpOnly", () => {
    const cookies = sessions.borrower.response.headers.getSetCookie(),
      session = cookies.find((c) => c.startsWith("talunai_session="))!,
      csrf = cookies.find((c) => c.startsWith("talunai_csrf="))!;
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Strict");
    expect(session).toContain("Secure");
    expect(csrf).toContain(`talunai_csrf=${sessions.borrower.csrf}`);
    expect(csrf).not.toContain("HttpOnly");
    expect(csrf).toContain("SameSite=Strict");
    expect(csrf).toContain("Secure");
    expect(csrf).not.toContain("Domain=");
  });
  it("me returns approved membership names and real persisted user status without promoting pending users", async () => {
    const me = await call("/v1/me", "GET", undefined, sessions.borrower);
    expect(me.data.status).toBe("PROVISIONED_SYNTHETIC");
    expect(me.data.memberships[0]).toMatchObject({
      organizationId: "org-borrower",
      organizationName: "Synthetic borrower",
      organizationKind: "BORROWER",
      organizationStatus: "APPROVED",
      role: "BORROWER",
    });
    const pending = await call("/v1/me", "GET", undefined, sessions.pending);
    expect(pending.data.status).toBe("PENDING");
    expect(pending.data.memberships).toEqual([]);
  });
  it("counterpart directory exposes only approved uniquely authorized buyer/lender options to issuer borrower", async () => {
    const result = await call(
      "/v1/organizations?issuerOrganizationId=org-borrower",
      "GET",
      undefined,
      sessions.borrower,
    );
    expect(result.status).toBe(200);
    expect(result.data.items.map((o: { id: string }) => o.id).sort()).toEqual([
      "org-buyer",
      "org-lender",
    ]);
    expect(JSON.stringify(result.data)).not.toContain("address");
    const filtered = await call(
      "/v1/organizations?issuerOrganizationId=org-borrower&role=BUYER",
      "GET",
      undefined,
      sessions.borrower,
    );
    expect(filtered.data.items.map((o: { id: string }) => o.id)).toEqual([
      "org-buyer",
    ]);
  });
  it("unapproved, lender and unrelated issuer directory access is denied; arbitrary role filters fail", async () => {
    expect(
      (await call("/v1/organizations", "GET", undefined, sessions.pending))
        .status,
    ).toBe(403);
    expect(
      (await call("/v1/organizations", "GET", undefined, sessions.lender))
        .status,
    ).toBe(403);
    expect(
      (
        await call(
          "/v1/organizations?issuerOrganizationId=org-other",
          "GET",
          undefined,
          sessions.borrower,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "/v1/organizations?role=ADMIN",
          "GET",
          undefined,
          sessions.borrower,
        )
      ).status,
    ).toBe(422);
    expect((await call("/v1/organizations")).status).toBe(401);
  });
  it("claim list searches actual authorized server rows and has joined organization metadata", async () => {
    const own = await call(
      "/v1/claims?search=COCOA&workflow=DRAFT",
      "GET",
      undefined,
      sessions.borrower,
    );
    expect(own.data.total).toBe(1);
    expect(own.data.items[0]).toMatchObject({
      id: ids.claim,
      organizationName: "Synthetic borrower",
      buyerOrganizationName: "Synthetic buyer",
    });
    expect(
      (
        await call(
          "/v1/claims?search=SECRET",
          "GET",
          undefined,
          sessions.borrower,
        )
      ).data.total,
    ).toBe(0);
    expect(
      (await call("/v1/claims?search=%25", "GET", undefined, sessions.borrower))
        .data.total,
    ).toBe(0);
    expect(
      (
        await call(
          "/v1/claims?workflow=ADMIN",
          "GET",
          undefined,
          sessions.borrower,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await call(
          `/v1/claims/${ids.claim}`,
          "GET",
          undefined,
          sessions.borrower,
        )
      ).data.organizationName,
    ).toBe("Synthetic borrower");
  });
  it("document metadata includes real display fields and never storage paths, salt, hashes or private text", async () => {
    const result = await call(
        `/v1/claims/${ids.claim}/evidence`,
        "GET",
        undefined,
        sessions.borrower,
      ),
      doc = result.data.documents[0];
    expect(doc).toMatchObject({
      id: ids.document,
      name: "Kakao invoice.pdf",
      mediaType: "application/pdf",
      sizeBytes: 2500,
      status: "PARSED",
      downloadUrl: `/v1/documents/${ids.document}`,
    });
    expect(doc.createdAt).toMatch(/^\d{4}-/);
    expect(doc.retentionAt).toMatch(/^\d{4}-/);
    for (const key of ["storage_key", "extracted_text", "sha256", "salt"])
      expect(doc).not.toHaveProperty(key);
    expect(
      (
        await call(
          `/v1/claims/${ids.claim}/evidence`,
          "GET",
          undefined,
          sessions.other,
        )
      ).status,
    ).toBe(404);
  });
  it("claim-scoped runs and detailed steps require object authorization; global activity is actor-scoped", async () => {
    const runs = await call(
      `/v1/claims/${ids.claim}/agent-runs`,
      "GET",
      undefined,
      sessions.borrower,
    );
    expect(runs.data.items).toHaveLength(1);
    expect(runs.data.items[0]).toMatchObject({
      id: ids.run,
      claimId: ids.claim,
      mode: "mock",
    });
    const run = await call(
      `/v1/agent-runs/${ids.run}`,
      "GET",
      undefined,
      sessions.borrower,
    );
    expect(run.data.steps[0].createdAt).toMatch(/^\d{4}-/);
    expect(
      (
        await call(
          `/v1/agent-runs/${ids.otherRun}`,
          "GET",
          undefined,
          sessions.borrower,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call("/v1/agent-runs", "GET", undefined, sessions.borrower)
      ).data.items.map((r: { id: string }) => r.id),
    ).toEqual([ids.run]);
    expect(
      (await call("/v1/agent-runs", "GET", undefined, sessions.pending)).data
        .items,
    ).toEqual([]);
    expect(
      (await call("/v1/agent-runs", "GET", undefined, sessions.verifier)).data
        .total,
    ).toBe(2);
  });
  it("transaction history restores only user-owned intents even when another actor can read same claim", async () => {
    const own = await call(
      `/v1/claims/${ids.claim}/transactions`,
      "GET",
      undefined,
      sessions.borrower,
    );
    expect(own.data.items.map((i: { id: string }) => i.id)).toEqual([
      ids.intent,
    ]);
    expect(own.data.items[0]).toMatchObject({
      status: "PREPARED",
      claimId: ids.claim,
      txHash: null,
    });
    const buyer = await call(
      `/v1/claims/${ids.claim}/transactions`,
      "GET",
      undefined,
      sessions.buyer,
    );
    expect(buyer.data.items.map((i: { id: string }) => i.id)).toEqual([
      ids.otherIntent,
    ]);
    expect(
      (
        await call(
          `/v1/claims/${ids.claim}/transactions`,
          "GET",
          undefined,
          sessions.verifier,
        )
      ).data.items,
    ).toEqual([]);
    expect(
      (
        await call(
          `/v1/claims/${ids.claim}/transactions`,
          "GET",
          undefined,
          sessions.other,
        )
      ).status,
    ).toBe(404);
  });
  it("review tasks retain role/object filtering and expose typed display fields", async () => {
    const tasks = await call(
      "/v1/review-tasks",
      "GET",
      undefined,
      sessions.borrower,
    );
    expect(tasks.data.items[0]).toMatchObject({
      id: ids.task,
      claimId: ids.claim,
      invoiceNumber: "COCOA-001",
      organizationName: "Synthetic borrower",
    });
    expect(
      (await call("/v1/review-tasks", "GET", undefined, sessions.lender)).data
        .items,
    ).toEqual([]);
    expect(
      (await call("/v1/review-tasks", "GET", undefined, sessions.other)).data
        .items,
    ).toEqual([]);
  });
  it("CSRF cookie alone never authorizes mutation, and wrong Origin is rejected", async () => {
    expect(
      (
        await call("/v1/auth/logout", "POST", {}, sessions.borrower, {
          "X-CSRF-Token": "",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("/v1/auth/logout", "POST", {}, sessions.borrower, {
          "X-CSRF-Token": "attacker",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("/v1/auth/logout", "POST", {}, sessions.borrower, {
          Origin: "https://attacker.test",
        })
      ).status,
    ).toBe(403);
  });
  it("fresh browser client restores CSRF after reload without setting forbidden Origin and logout clears both cookies", async () => {
    const session = await login("borrower");
    vi.stubGlobal("document", { cookie: `talunai_csrf=${session.csrf}` });
    const seen: RequestInit[] = [];
    let logoutResponse: Response | undefined;
    const browserFetch: typeof fetch = async (input, init) => {
      seen.push(init ?? {});
      const headers = new Headers(init?.headers);
      headers.set("Origin", origin);
      headers.set("Cookie", session.cookie);
      const result = await handleRequest(
        new Request(String(input), { ...init, headers }),
      );
      logoutResponse = result;
      return result;
    };
    const client = new TalunaiClient(origin, browserFetch);
    expect((await client.logout()).loggedOut).toBe(true);
    expect(new Headers(seen[0].headers).has("Origin")).toBe(false);
    expect(new Headers(seen[0].headers).get("X-CSRF-Token")).toBe(session.csrf);
    expect(seen[0].credentials).toBe("include");
    const cleared = logoutResponse!.headers.getSetCookie();
    for (const name of ["talunai_session", "talunai_csrf"])
      expect(cleared.find((c) => c.startsWith(`${name}=`))).toContain(
        "Max-Age=0",
      );
    expect((await call("/v1/me", "GET", undefined, session)).status).toBe(401);
  });
  it("client reports structured API, non-JSON upstream and network errors without exposing response HTML", async () => {
    const structured = new TalunaiClient(origin, async () =>
      Response.json(
        {
          error: { code: "STALE_VERSION", details: { currentVersion: 2 } },
          correlationId: "test-correlation",
        },
        { status: 409 },
      ),
    );
    await expect(structured.me()).rejects.toMatchObject({
      status: 409,
      code: "STALE_VERSION",
      correlationId: "test-correlation",
      details: { currentVersion: 2 },
    });
    const html = new TalunaiClient(
      origin,
      async () =>
        new Response("<html>private upstream page</html>", { status: 502 }),
    );
    await expect(html.me()).rejects.toMatchObject({
      status: 502,
      code: "HTTP_ERROR",
    });
    const invalid = new TalunaiClient(
      origin,
      async () => new Response("not JSON", { status: 200 }),
    );
    await expect(invalid.me()).rejects.toMatchObject({
      status: 200,
      code: "INVALID_RESPONSE",
    });
    const network = new TalunaiClient(origin, async () => {
      throw new TypeError("fetch failed");
    });
    await expect(network.me()).rejects.toBeInstanceOf(TalunaiApiError);
    await expect(network.me()).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_UNAVAILABLE",
    });
  });
  it("invokes the browser fetch adapter without binding the client as its receiver", async () => {
    const nativeStyleFetch: typeof fetch = async function (this: unknown) {
      if (this !== undefined)
        throw new TypeError("Illegal invocation: invalid fetch receiver");
      return Response.json({ status: "PENDING", memberships: [] });
    };
    const client = new TalunaiClient(origin, nativeStyleFetch);
    expect((await client.me()).status).toBe("PENDING");
  });
  const packaging: GoodsMetadata = {
    category: "PACKAGING",
    description: "Corrugated cardboard cartons",
    lineItems: [
      {
        description: "Corrugated cardboard cartons",
        quantity: "2000",
        unit: "pcs",
      },
    ],
  };
  const cocoa: GoodsMetadata = {
    category: "COCOA",
    description: "Dried cocoa beans",
    lineItems: [
      { description: "Dried cocoa beans", quantity: "1000", unit: "kg" },
    ],
  };
  function draft(goods?: GoodsMetadata) {
    return {
      organizationId: "org-borrower",
      buyerOrganizationId: "org-buyer",
      lenderOrganizationId: "org-lender",
      invoiceNamespace: "2026",
      invoiceNumber: `GOODS-${randomUUID()}`,
      acceptedOutstanding: "100000000",
      requestedPrincipal: "70000000",
      invoiceDueAt: Math.floor(Date.now() / 1000) + 45 * 86400,
      fundingWindowSeconds: 82800,
      ...(goods ? { goods } : {}),
    };
  }
  it("persists generic delivered-goods metadata; omitted metadata remains unclassified and unsupported asset types are rejected", async () => {
    const created = await call(
      "/v1/claims",
      "POST",
      draft(packaging),
      sessions.borrower,
    );
    expect(created.status).toBe(201);
    expect(created.data.assetType).toBe("TRADE_RECEIVABLE");
    expect(created.data.goods).toEqual(packaging);
    const [snapshot] =
      await getSql()`SELECT snapshot FROM claim_versions WHERE claim_id=${created.data.id} AND version=1`;
    expect(snapshot.snapshot.goods).toEqual(packaging);
    const omitted = await call(
      "/v1/claims",
      "POST",
      draft(),
      sessions.borrower,
    );
    expect(omitted.status).toBe(201);
    expect(omitted.data.goods).toBeNull();
    expect(
      (
        await call(
          "/v1/claims",
          "POST",
          { ...draft(packaging), assetType: "PURCHASE_ORDER" },
          sessions.borrower,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await call(
          "/v1/claims",
          "POST",
          {
            ...draft(packaging),
            goods: {
              ...packaging,
              lineItems: [
                { description: "Boxes", quantity: "-1", unit: "pcs" },
              ],
            },
          },
          sessions.borrower,
        )
      ).status,
    ).toBe(422);
  });
  it("goods edits create a new snapshot and revoke old consent; registered goods are immutable", async () => {
    const created = await call(
        "/v1/claims",
        "POST",
        draft(packaging),
        sessions.borrower,
      ),
      claimId = created.data.id,
      sql = getSql();
    await sql`INSERT INTO consent_records(id,claim_id,version,role,signer,nonce,deadline,signature,terms_hash) VALUES(${randomUUID()},${claimId},1,'BORROWER',${actors.borrower.address.toLowerCase()},'1',${created.data.terms.consentExpiry},${"0x" + "1".repeat(130)},${"0x" + "2".repeat(64)})`;
    await sql`INSERT INTO review_decisions(id,claim_id,version,actor_id,decision,reason,expires_at,snapshot_hash) VALUES(${randomUUID()},${claimId},1,'user-verifier','APPROVE','Previous synthetic review',now()+interval '1 hour',${"3".repeat(64)})`;
    const revised = { ...packaging, description: "Printed corrugated cartons" };
    const blocked = await call(
      `/v1/claims/${claimId}`,
      "PATCH",
      { expectedVersion: 1, goods: revised },
      sessions.borrower,
    );
    expect(blocked.status).toBe(409);
    expect(blocked.data.error.code).toBe("CONSENT_REVOCATION_REQUIRED");
    await sql`INSERT INTO indexer_checkpoints(chain_id,block_number,block_hash)
      VALUES(97,778,'confirmed-block') ON CONFLICT(chain_id) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash,degraded=false,updated_at=now()`;
    await sql`INSERT INTO chain_events(id,chain_id,tx_hash,log_index,block_number,block_hash,contract_address,event_name,args,canonical)
      VALUES(${randomUUID()},97,${`0x${"e".repeat(64)}`},0,777,'confirmed-block',${process.env.CONTRACT_REGISTRY_ADDRESS!.toLowerCase()},'ConsentNonceInvalidated',${sql.json({ signer: actors.borrower.address.toLowerCase(), nonce: "1" })},true)`;
    const patched = await call(
      `/v1/claims/${claimId}`,
      "PATCH",
      { expectedVersion: 1, goods: revised },
      sessions.borrower,
    );
    expect(patched.status).toBe(200);
    expect(patched.data.version).toBe(2);
    expect(patched.data.goods).toEqual(revised);
    expect(patched.data.terms.principal).toBe(created.data.terms.principal);
    const [consent] =
      await sql`SELECT revoked FROM consent_records WHERE claim_id=${claimId}`;
    expect(consent.revoked).toBe(true);
    const [snapshot] =
      await sql`SELECT snapshot FROM claim_versions WHERE claim_id=${claimId} AND version=2`;
    expect(snapshot.snapshot.goods).toEqual(revised);
    // Local isolated workflow fixture only. No financial projection or chain is modified.
    await sql`UPDATE claims SET workflow='REGISTERED' WHERE id=${claimId}`;
    expect(
      (
        await call(
          `/v1/claims/${claimId}`,
          "PATCH",
          { expectedVersion: 2, goods: packaging },
          sessions.borrower,
        )
      ).status,
    ).toBe(409);
    const [after] = await sql`SELECT goods FROM claims WHERE id=${claimId}`;
    expect(after.goods).toEqual(revised);
  });
  it.each(["COCOA", "PACKAGING"] as const)(
    "runs the same authorized upload, extraction, policy and human-review flow for %s",
    async (category) => {
      const goods = category === "PACKAGING" ? packaging : cocoa,
        input = draft(goods),
        created = await call("/v1/claims", "POST", input, sessions.borrower);
      expect(created.status).toBe(201);
      const text = [
        "isSynthetic: true",
        "locale: en-US",
        "dateFormat: YYYY-MM-DD",
        "issuerName: Synthetic borrower",
        "buyerName: Synthetic buyer",
        `invoiceNumber: ${input.invoiceNumber}`,
        `issueDate: ${new Date().toISOString().slice(0, 10)}`,
        `invoiceDueDate: ${new Date(input.invoiceDueAt * 1000).toISOString().slice(0, 10)}`,
        "currency: IDR",
        "invoiceOriginalAmount: 100000000",
        "previouslyPaidAmount: 0",
        "acceptedOutstandingAmount: 100000000",
        `goodsDescription: ${goods.description}`,
        `goodsCategory: ${goods.category}`,
        `quantity: ${goods.lineItems[0].quantity}`,
        `quantityUnit: ${goods.lineItems[0].unit}`,
        "purchaseOrderReference: PO-SYNTHETIC",
        "proofOfDeliveryReference: POD-SYNTHETIC",
        "buyerAcknowledgementReference: ACK-SYNTHETIC",
      ].join("\n");
      const form = new FormData();
      form.set("expectedVersion", "1");
      form.set(
        "file",
        new File([text], "delivered-goods.txt", { type: "text/plain" }),
      );
      const upload = await handleRequest(
        new Request(`${origin}/v1/claims/${created.data.id}/documents`, {
          method: "POST",
          headers: {
            Origin: origin,
            Cookie: sessions.borrower.cookie,
            "X-CSRF-Token": sessions.borrower.csrf,
            "Idempotency-Key": randomUUID(),
          },
          body: form,
        }),
      );
      expect(upload.status).toBe(201);
      const document = await upload.json();
      const analyze = await call(
        `/v1/claims/${created.data.id}/analyze`,
        "POST",
        { expectedVersion: document.version },
        sessions.borrower,
      );
      expect(analyze.status).toBe(202);
      await processClaim({
        claimId: created.data.id,
        runId: analyze.data.runId,
        version: document.version,
      });
      const run = await call(
        `/v1/agent-runs/${analyze.data.runId}`,
        "GET",
        undefined,
        sessions.borrower,
      );
      expect(run.data.status).toBe("COMPLETED");
      expect(run.data.result.policy.outcome).toBe(
        "ELIGIBLE_FOR_HUMAN_APPROVAL",
      );
      expect(run.data.mode).toBe("mock");
      for (const endpoint of ["consents/prepare", "consents"]) {
        const premature = await call(
          `/v1/claims/${created.data.id}/${endpoint}`,
          "POST",
          {
            expectedVersion: document.version,
            role: "BORROWER",
            nonce: "44",
            ...(endpoint === "consents"
              ? { signature: `0x${"1".repeat(130)}` }
              : {}),
          },
          sessions.borrower,
        );
        expect(premature.status).toBe(409);
        expect(premature.data.error.code).toBe("CURRENT_REVIEW_REQUIRED");
      }
      // A legacy unregistered draft can carry an old policy hash. Final human
      // review must bind the current policy, goods snapshot and new version.
      const sql = getSql();
      await sql`UPDATE claims SET terms=jsonb_set(terms,'{policyHash}',${sql.json(`0x${"0".repeat(64)}`)}) WHERE id=${created.data.id}`;
      const body = {
        expectedVersion: document.version,
        decision: "APPROVE",
        reason:
          "Delivered goods and buyer acknowledgement reviewed in isolated synthetic test.",
        evidenceIds: [document.documentId],
      };
      expect(
        (
          await call(
            `/v1/claims/${created.data.id}/review`,
            "POST",
            body,
            sessions.borrower,
          )
        ).status,
      ).toBe(403);
      const reviewed = await call(
        `/v1/claims/${created.data.id}/review`,
        "POST",
        body,
        sessions.verifier,
      );
      expect(reviewed.status).toBe(200);
      expect(reviewed.data.goods).toEqual(goods);
      expect(reviewed.data.workflow).toBe("READY_FOR_SIGNATURES");
      expect(reviewed.data.version).toBe(document.version + 1);
      expect(reviewed.data.terms.policyHash).toBe(POLICY_HASH);
      const evidence = await call(
        `/v1/claims/${created.data.id}/evidence`,
        "GET",
        undefined,
        sessions.buyer,
      );
      expect(evidence.data.review.decision).toBe("APPROVE");
      expect(evidence.data.review.version).toBe(reviewed.data.version);
      expect(evidence.data.consents).toEqual([]);
      expect(reviewed.data.terms.decisionHash).toBe(
        `0x${hash(
          canonical({
            policy: run.data.result.policy,
            policyHash: POLICY_HASH,
            assetType: "TRADE_RECEIVABLE",
            goods,
            reviewId: evidence.data.review.id,
            actor: "user-verifier",
            version: reviewed.data.version,
            evidenceIds: [document.documentId],
            decision: "APPROVE",
          }),
        )}`,
      );
    },
  );
  it("unclassified goods block funding; other delivered goods are not rejected by sector", async () => {
    const unknown = await call(
      `/v1/claims/${ids.claim}/actions/prepare`,
      "POST",
      { expectedVersion: 1, action: "FUND" },
      sessions.lender,
    );
    expect(unknown.status).toBe(422);
    expect(unknown.data.error.code).toBe("GOODS_REVIEW_REQUIRED");
    const otherGoods = { ...packaging, category: "OTHER" },
      created = await call(
        "/v1/claims",
        "POST",
        { ...draft(), goods: otherGoods },
        sessions.borrower,
      );
    expect(created.status).toBe(201);
    const other = await call(
      `/v1/claims/${created.data.id}`,
      "GET",
      undefined,
      sessions.borrower,
    );
    expect(other.status).toBe(200);
    expect(other.data.goods).toEqual(otherGoods);
    const sql = getSql();
    const rows =
      await sql`SELECT id FROM transaction_intents WHERE claim_id=${created.data.id}`;
    expect(rows).toHaveLength(0);
  });
  it("blocks a version change after consent payload issuance until canonical nonce invalidation", async () => {
    const created = await call(
      "/v1/claims",
      "POST",
      draft(cocoa),
      sessions.borrower,
    );
    expect(created.status).toBe(201);
    const sql = getSql();
    const nonce = `73${Math.floor(Math.random() * 1000000)}`;
    const eventId = randomUUID();
    const signature = `0x${"a".repeat(130)}`;
    const signer = actors.borrower.address.toLowerCase();
    await sql`INSERT INTO consent_issuances(id,claim_id,version,role,signer,nonce,deadline,terms_hash,chain_id,registry_address)
      VALUES(${randomUUID()},${created.data.id},1,'BORROWER',${signer},${nonce},${created.data.terms.consentExpiry},'issued-terms',97,${process.env.CONTRACT_REGISTRY_ADDRESS!.toLowerCase()})`;
    await sql`INSERT INTO consent_records(id,claim_id,version,role,signer,nonce,deadline,signature,terms_hash)
      VALUES(${randomUUID()},${created.data.id},1,'BORROWER',${signer},${nonce},${created.data.terms.consentExpiry},${signature},'issued-terms')`;
    const revise = (version: number) =>
      call(
        `/v1/claims/${created.data.id}`,
        "PATCH",
        { expectedVersion: version, goods: packaging },
        sessions.borrower,
      );
    const blocked = await revise(1);
    expect(blocked.status).toBe(409);
    expect(blocked.data.error).toMatchObject({
      code: "CONSENT_REVOCATION_REQUIRED",
      details: { pendingConsents: [{ role: "BORROWER", nonce }] },
    });
    await sql`INSERT INTO indexer_checkpoints(chain_id,block_number,block_hash)
      VALUES(97,778,'confirmed-block') ON CONFLICT(chain_id) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash,degraded=false,updated_at=now()`;
    await sql`INSERT INTO chain_events(id,chain_id,tx_hash,log_index,block_number,block_hash,contract_address,event_name,args,canonical)
      VALUES(${eventId},97,${`0x${"d".repeat(64)}`},0,777,'confirmed-block',${`0x${"9".repeat(40)}`},'ConsentNonceInvalidated',${sql.json({ signer, nonce })},true)`;
    expect((await revise(1)).data.error.code).toBe(
      "CONSENT_REVOCATION_REQUIRED",
    );
    await sql`UPDATE chain_events SET contract_address=${process.env.CONTRACT_REGISTRY_ADDRESS!.toLowerCase()} WHERE id=${eventId}`;
    await sql`UPDATE indexer_checkpoints SET degraded=true WHERE chain_id=97`;
    expect((await revise(1)).data.error.code).toBe(
      "CONSENT_REVOCATION_REQUIRED",
    );
    await sql`UPDATE indexer_checkpoints SET degraded=false,updated_at=now() WHERE chain_id=97`;
    const revised = await revise(1);
    expect(revised.status).toBe(200);
    expect(revised.data.version).toBe(2);
    const [historic] =
      await sql`SELECT revoked,signature FROM consent_records WHERE claim_id=${created.data.id}`;
    expect(historic).toMatchObject({ revoked: true, signature });
    await sql`UPDATE chain_events SET canonical=false WHERE id=${eventId}`;
    const reorgBlocked = await revise(2);
    expect(reorgBlocked.status).toBe(409);
    expect(reorgBlocked.data.error.code).toBe("CONSENT_REVOCATION_REQUIRED");
  });
  it("renews expired pre-registration signing and funding windows on an editable deal", async () => {
    const created = await call(
      "/v1/claims",
      "POST",
      draft(cocoa),
      sessions.borrower,
    );
    expect(created.status).toBe(201);
    const sql = getSql();
    const expired = Math.floor(Date.now() / 1000) - 1;
    await sql`UPDATE claims SET terms=jsonb_set(jsonb_set(jsonb_set(terms,'{fundingDeadline}',${sql.json(expired)}),'{reviewExpiry}',${sql.json(expired)}),'{consentExpiry}',${sql.json(expired)}) WHERE id=${created.data.id}`;
    const renewed = await call(
      `/v1/claims/${created.data.id}`,
      "PATCH",
      { expectedVersion: 1, goods: packaging },
      sessions.borrower,
    );
    expect(renewed.status).toBe(200);
    expect(renewed.data.version).toBe(2);
    expect(renewed.data.terms.fundingDeadline).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    );
    expect(renewed.data.terms.reviewExpiry).toBe(
      renewed.data.terms.fundingDeadline,
    );
    expect(renewed.data.terms.consentExpiry).toBe(
      renewed.data.terms.fundingDeadline,
    );
  });
  it("persists consent issuance before response and preserves both signatures when a signer replaces an invalidated nonce", async () => {
    const created = await call(
      "/v1/claims",
      "POST",
      draft(cocoa),
      sessions.borrower,
    );
    expect(created.status).toBe(201);
    const sql = getSql();
    await sql`UPDATE claims SET workflow='READY_FOR_SIGNATURES',
      terms=jsonb_set(terms,'{policyHash}',${sql.json(POLICY_HASH)}),
      evidence=jsonb_set(evidence,'{humanReviewStatus}',${sql.json("ATTESTED")})
      WHERE id=${created.data.id}`;
    await sql`INSERT INTO review_decisions(id,claim_id,version,actor_id,decision,reason,expires_at,snapshot_hash)
      VALUES(${randomUUID()},${created.data.id},1,'user-verifier','APPROVE','Isolated valid review',now()+interval '1 hour','review-snapshot')`;
    setChainPortForTests({
      ...chainService,
      prepareConsent: async ({ nonce }) => ({ nonce }),
      verifyConsent: async ({ claim }) => ({
        valid: true,
        termsHash: termsHash(claim),
      }),
    });
    try {
      const request = (suffix: string, nonce: string, signature?: string) =>
        call(
          `/v1/claims/${created.data.id}/consents${suffix}`,
          "POST",
          {
            expectedVersion: 1,
            role: "BORROWER",
            nonce,
            ...(signature ? { signature } : {}),
          },
          sessions.borrower,
        );
      const firstSignature = `0x${"1".repeat(130)}`;
      const secondSignature = `0x${"2".repeat(130)}`;
      const missingIssuance = await request("", "9001", firstSignature);
      expect(missingIssuance.status).toBe(409);
      expect(missingIssuance.data.error.code).toBe("CONSENT_ISSUANCE_REQUIRED");
      expect((await request("/prepare", "9001")).status).toBe(200);
      const [issuance] =
        await sql`SELECT signer,nonce,terms_hash FROM consent_issuances WHERE claim_id=${created.data.id}`;
      expect(issuance).toMatchObject({
        signer: actors.borrower.address.toLowerCase(),
        nonce: "9001",
      });
      expect(issuance.terms_hash).toMatch(/^0x[0-9a-f]{64}$/);
      expect((await request("", "9001", firstSignature)).status).toBe(200);
      const blocked = await request("/prepare", "9002");
      expect(blocked.status).toBe(409);
      expect(blocked.data.error.code).toBe("CONSENT_REVOCATION_REQUIRED");
      await sql`INSERT INTO chain_events(id,chain_id,tx_hash,log_index,block_number,block_hash,contract_address,event_name,args,canonical)
        VALUES(${randomUUID()},97,${`0x${"c".repeat(64)}`},0,778,'confirmed-block',${process.env.CONTRACT_REGISTRY_ADDRESS!.toLowerCase()},'ConsentNonceInvalidated',${sql.json({ signer: actors.borrower.address.toLowerCase(), nonce: "9001" })},true)`;
      expect((await request("/prepare", "9002")).status).toBe(200);
      expect((await request("", "9002", secondSignature)).status).toBe(200);
      const records =
        await sql`SELECT nonce,signature,revoked FROM consent_records WHERE claim_id=${created.data.id} ORDER BY nonce`;
      expect(records).toMatchObject([
        { nonce: "9001", signature: firstSignature, revoked: true },
        { nonce: "9002", signature: secondSignature, revoked: false },
      ]);
    } finally {
      setChainPortForTests(chainService);
    }
  });
  it("resolves a pre-registration buyer dispute with attributed verifier review and no impossible chain hold", async () => {
    const created = await call(
      "/v1/claims",
      "POST",
      draft(cocoa),
      sessions.borrower,
    );
    expect(created.status).toBe(201);
    const sql = getSql();
    const documentId = randomUUID();
    await sql`INSERT INTO documents(id,claim_id,version,original_name,storage_key,sha256,commitment,mime,byte_size,status,retention_at)
      VALUES(${documentId},${created.data.id},1,'invoice.txt','isolated-test-document','digest','commitment','text/plain',1,'PARSED',now()+interval '1 day')`;
    const disputed = await call(
      `/v1/claims/${created.data.id}/disputes`,
      "POST",
      {
        expectedVersion: 1,
        reason: "Buyer disputes the stated invoice amount.",
        evidenceId: documentId,
      },
      sessions.buyer,
    );
    expect(disputed.status).toBe(202);
    expect(disputed.data.onchainHold).toBe("NOT_REQUIRED_BEFORE_REGISTRATION");
    expect(
      await sql`SELECT id FROM outbox WHERE type='FUNDING_HOLD' AND payload->>'claimId'=${created.data.id}`,
    ).toHaveLength(0);
    const resolved = await call(
      `/v1/claims/${created.data.id}/review`,
      "POST",
      {
        expectedVersion: 1,
        decision: "APPROVE",
        reason: "Buyer correction was checked against the original invoice.",
        evidenceIds: [documentId],
        resolvesDispute: true,
      },
      sessions.verifier,
    );
    expect(resolved.status).toBe(200);
    expect(resolved.data).toMatchObject({
      hasDispute: false,
      nextAction: "RUN_CHECKS",
      onchainHold: "NOT_REQUIRED_BEFORE_REGISTRATION",
    });
    const [claim] =
      await sql`SELECT has_dispute,version,workflow FROM claims WHERE id=${created.data.id}`;
    expect(claim).toMatchObject({
      has_dispute: false,
      version: 1,
      workflow: "DRAFT",
    });
    const [decision] =
      await sql`SELECT decision FROM review_decisions WHERE claim_id=${created.data.id}`;
    expect(decision.decision).toBe("RESOLVE_DISPUTE");
  });
  it("rejects a verifier who is economically tied to the granted lender", async () => {
    const created = await call(
      "/v1/claims",
      "POST",
      draft(cocoa),
      sessions.borrower,
    );
    expect(created.status).toBe(201);
    const sql = getSql();
    const membershipId = randomUUID();
    await sql`INSERT INTO memberships(id,user_id,organization_id,role,approved)
      VALUES(${membershipId},'user-verifier','org-lender','LENDER',true)`;
    try {
      const reviewed = await call(
        `/v1/claims/${created.data.id}/review`,
        "POST",
        {
          expectedVersion: 1,
          decision: "APPROVE",
          reason: "Verifier must not approve an economically linked deal.",
          evidenceIds: [ids.document],
        },
        sessions.verifier,
      );
      expect(reviewed.status).toBe(403);
      expect(reviewed.data.error.code).toBe("REVIEWER_CONFLICT");
      for (const action of ["REGISTER", "CLEAR_HOLD"]) {
        const prepared = await call(
          `/v1/claims/${created.data.id}/actions/prepare`,
          "POST",
          { expectedVersion: 1, action },
          sessions.verifier,
        );
        expect(prepared.status).toBe(403);
        expect(prepared.data.error.code).toBe("REVIEWER_CONFLICT");
      }
    } finally {
      await sql`DELETE FROM memberships WHERE id=${membershipId}`;
    }
    await sql`INSERT INTO chain_events(id,chain_id,tx_hash,log_index,block_number,block_hash,claim_key,event_name,args,canonical)
      VALUES(${randomUUID()},97,${`0x${"f".repeat(64)}`},0,779,'confirmed-block',${created.data.claimKey},'Funded',${sql.json({ lender: actors.verifier.address.toLowerCase() })},true)`;
    const reviewedAfterRoleRemoval = await call(
      `/v1/claims/${created.data.id}/review`,
      "POST",
      {
        expectedVersion: 1,
        decision: "APPROVE",
        reason: "Historical funding interest still creates a conflict.",
        evidenceIds: [ids.document],
      },
      sessions.verifier,
    );
    expect(reviewedAfterRoleRemoval.status).toBe(403);
    expect(reviewedAfterRoleRemoval.data.error.code).toBe("REVIEWER_CONFLICT");
  });
  it("attributes a deal edit to its authorizing organization when the actor has another membership", async () => {
    const created = await call(
      "/v1/claims",
      "POST",
      draft(cocoa),
      sessions.borrower,
    );
    expect(created.status).toBe(201);
    const sql = getSql();
    const membershipId = randomUUID();
    await sql`INSERT INTO memberships(id,user_id,organization_id,role,approved)
      VALUES(${membershipId},'user-borrower','org-other','BORROWER',true)`;
    try {
      const edited = await call(
        `/v1/claims/${created.data.id}`,
        "PATCH",
        { expectedVersion: 1, goods: packaging },
        sessions.borrower,
      );
      expect(edited.status).toBe(200);
      const [event] = await sql`SELECT organization_id FROM audit_events
        WHERE target=${created.data.id} AND action='CLAIM_EDITED'`;
      expect(event.organization_id).toBe("org-borrower");
    } finally {
      await sql`DELETE FROM memberships WHERE id=${membershipId}`;
    }
  });
  it("lets a borrower invite one approved lender and exposes only confirmed financeable market terms", async () => {
    const { lenderOrganizationId, ...withoutLender } = draft(cocoa);
    expect(lenderOrganizationId).toBe("org-lender");
    const created = await call(
      "/v1/claims",
      "POST",
      withoutLender,
      sessions.borrower,
    );
    expect(created.status).toBe(201);
    expect(created.data.lenderOrganizationId).toBeNull();
    await getSql()`UPDATE claims SET workflow='READY_FOR_SIGNATURES' WHERE id=${created.data.id}`;
    const blockedConsent = await call(
      `/v1/claims/${created.data.id}/consents/prepare`,
      "POST",
      { expectedVersion: 1, role: "BORROWER", nonce: "8801" },
      sessions.borrower,
    );
    expect(blockedConsent.data.error.code).toBe("LENDER_INVITATION_REQUIRED");
    await getSql()`UPDATE claims SET workflow='READY_FOR_REGISTRATION' WHERE id=${created.data.id}`;
    const blockedRegister = await call(
      `/v1/claims/${created.data.id}/actions/prepare`,
      "POST",
      { expectedVersion: 1, action: "REGISTER" },
      sessions.verifier,
    );
    expect(blockedRegister.data.error.code).toBe("LENDER_INVITATION_REQUIRED");
    await getSql()`UPDATE claims SET workflow='READY_FOR_SIGNATURES' WHERE id=${created.data.id}`;
    expect(
      (
        await call(
          `/v1/claims/${created.data.id}`,
          "GET",
          undefined,
          sessions.lender,
        )
      ).status,
    ).toBe(404);
    const path = `/v1/claims/${created.data.id}/lenders`;
    const invited = await call(
      path,
      "POST",
      { organizationId: "org-lender" },
      sessions.borrower,
    );
    expect(invited.status).toBe(201);
    expect(invited.data.lenderOrganizationId).toBe("org-lender");
    expect(
      (
        await call(
          path,
          "POST",
          { organizationId: "org-lender" },
          sessions.borrower,
        )
      ).status,
    ).toBe(200);
    const detail = await call(
      `/v1/claims/${created.data.id}`,
      "GET",
      undefined,
      sessions.lender,
    );
    expect(detail.status).toBe(200);
    expect(detail.data.lenderOrganizationId).toBe("org-lender");
    const sql = getSql();
    await sql`UPDATE claims SET workflow='REGISTERED' WHERE id=${created.data.id}`;
    await sql`INSERT INTO financial_projections(claim_key,chain_id,state,block_number,block_hash)
      VALUES(${created.data.claimKey},97,${sql.json({ registryStatus: "AVAILABLE", financingStatus: "UNFUNDED", fundingHold: false, stateConfidence: "CONFIRMED_PROJECTION" })},778,'confirmed-block')`;
    await sql`INSERT INTO indexer_checkpoints(chain_id,block_number,block_hash)
      VALUES(97,778,'confirmed-block') ON CONFLICT(chain_id) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash,degraded=false,updated_at=now()`;
    const market = await call(
      "/v1/market/deals?limit=10&offset=0",
      "GET",
      undefined,
      sessions.lender,
    );
    expect(market.status).toBe(200);
    const item = market.data.items.find(
      (entry: { id: string }) => entry.id === created.data.id,
    );
    expect(item).toMatchObject({
      principal: "70000000",
      invoiceAmount: "100000000",
      fee: "1050000",
      status: "READY_TO_FUND",
      hasAccess: true,
      stateConfidence: "CONFIRMED_PROJECTION",
    });
    expect(item).not.toHaveProperty("invoiceNumber");
    expect(item).not.toHaveProperty("organizationName");
    for (const expiryField of [
      "fundingDeadline",
      "reviewExpiry",
      "consentExpiry",
    ]) {
      const [before] =
        await sql`SELECT terms->>${expiryField} AS deadline FROM claims WHERE id=${created.data.id}`;
      await sql`UPDATE claims SET terms=jsonb_set(terms,ARRAY[${expiryField}],'1'::jsonb) WHERE id=${created.data.id}`;
      const expired = await call(
        "/v1/market/deals",
        "GET",
        undefined,
        sessions.lender,
      );
      expect(expired.status).toBe(200);
      expect(
        expired.data.items.some(
          (entry: { id: string }) => entry.id === created.data.id,
        ),
      ).toBe(false);
      await sql`UPDATE claims SET terms=jsonb_set(terms,ARRAY[${expiryField}],to_jsonb(${before.deadline}::bigint)) WHERE id=${created.data.id}`;
    }
    expect(
      (await call("/v1/market/deals", "GET", undefined, sessions.other)).status,
    ).toBe(403);
  });
  it("paginates actionable Deals within the requested role and hides stale financial actions", async () => {
    const borrower = await call(
      "/v1/actions/inbox?role=BORROWER&limit=1&offset=0",
      "GET",
      undefined,
      sessions.borrower,
    );
    expect(borrower.status).toBe(200);
    expect(borrower.data.total).toBeGreaterThanOrEqual(1);
    expect(borrower.data.items).toHaveLength(1);
    expect(borrower.data.items[0].role).toBe("BORROWER");
    const borrowerAll = await call(
      "/v1/actions/inbox?role=BORROWER&limit=100",
      "GET",
      undefined,
      sessions.borrower,
    );
    expect(borrowerAll.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "BORROWER",
          action: "COMPLETE_EVIDENCE",
          tab: "evidence",
        }),
      ]),
    );
    const buyer = await call(
      "/v1/actions/inbox?role=BUYER",
      "GET",
      undefined,
      sessions.borrower,
    );
    expect(buyer.status).toBe(403);
    const lender = await call(
      "/v1/actions/inbox?role=LENDER",
      "GET",
      undefined,
      sessions.lender,
    );
    expect(lender.status).toBe(200);
    expect(
      lender.data.items.every(
        (item: { role: string }) => item.role === "LENDER",
      ),
    ).toBe(true);
    const created = await call(
      "/v1/claims",
      "POST",
      draft(cocoa),
      sessions.borrower,
    );
    expect(created.status).toBe(201);
    const sql = getSql();
    await sql`UPDATE claims SET workflow='REGISTERED' WHERE id=${created.data.id}`;
    await sql`INSERT INTO financial_projections(claim_key,chain_id,state,block_number,block_hash)
      VALUES(${created.data.claimKey},97,${sql.json({ registryStatus: "AVAILABLE", financingStatus: "UNFUNDED", fundingHold: false, stateConfidence: "CONFIRMED_PROJECTION" })},780,'confirmed-block')`;
    await sql`INSERT INTO indexer_checkpoints(chain_id,block_number,block_hash,degraded)
      VALUES(97,780,'confirmed-block',false) ON CONFLICT(chain_id) DO UPDATE SET
        block_number=excluded.block_number,degraded=false,updated_at=now()`;
    const financeable = await call(
      "/v1/actions/inbox?role=LENDER",
      "GET",
      undefined,
      sessions.lender,
    );
    expect(financeable.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claimId: created.data.id,
          action: "FUND_DEAL",
          tab: "payments",
        }),
      ]),
    );
    await sql`UPDATE indexer_checkpoints SET degraded=true WHERE chain_id=97`;
    const stale = await call(
      "/v1/actions/inbox?role=LENDER",
      "GET",
      undefined,
      sessions.lender,
    );
    expect(stale.data.financialDataCurrent).toBe(false);
    expect(
      stale.data.items.some(
        (item: { claimId: string }) => item.claimId === created.data.id,
      ),
    ).toBe(false);
    await sql`UPDATE indexer_checkpoints SET degraded=false,updated_at=now() WHERE chain_id=97`;
  });
  it("defers a registration-pending dispute hold and reconciles it after confirmed registration", async () => {
    const created = await call(
      "/v1/claims",
      "POST",
      draft(cocoa),
      sessions.borrower,
    );
    expect(created.status).toBe(201);
    const sql = getSql();
    const evidenceId = randomUUID();
    await sql`INSERT INTO documents(id,claim_id,version,original_name,storage_key,sha256,commitment,mime,byte_size,status,retention_at)
      VALUES(${evidenceId},${created.data.id},1,'dispute.txt','isolated-dispute-document','digest','commitment','text/plain',1,'PARSED',now()+interval '1 day')`;
    await sql`UPDATE claims SET workflow='REGISTRATION_PENDING' WHERE id=${created.data.id}`;
    const disputed = await call(
      `/v1/claims/${created.data.id}/disputes`,
      "POST",
      {
        expectedVersion: 1,
        reason: "Buyer disputes the delivered quantity.",
        evidenceId,
      },
      sessions.buyer,
    );
    expect(disputed.status).toBe(202);
    expect(disputed.data.onchainHold).toBe("PENDING");
    expect(
      await sql`SELECT id FROM outbox WHERE type='FUNDING_HOLD' AND payload->>'claimId'=${created.data.id}`,
    ).toHaveLength(0);
    await sql`INSERT INTO financial_projections(claim_key,chain_id,state,block_number,block_hash)
      VALUES(${created.data.claimKey},97,${sql.json({ registryStatus: "AVAILABLE", fundingHold: false, stateConfidence: "CONFIRMED_PROJECTION" })},779,'confirmed-block')`;
    await sql.begin(async (tx) => enqueueUnheldDisputeHolds(tx, 97));
    const first =
      await sql`SELECT id,payload FROM outbox WHERE type='FUNDING_HOLD' AND payload->>'claimId'=${created.data.id}`;
    expect(first).toHaveLength(1);
    expect(first[0].payload).toMatchObject({
      actionId: disputed.data.actionId,
      evidenceId,
      reason: "Buyer disputes the delivered quantity.",
    });
    await sql.begin(async (tx) => enqueueUnheldDisputeHolds(tx, 97));
    expect(
      await sql`SELECT id FROM outbox WHERE type='FUNDING_HOLD' AND payload->>'claimId'=${created.data.id}`,
    ).toHaveLength(1);
    await sql`UPDATE outbox SET created_at=now()-interval '61 seconds' WHERE id=${first[0].id}`;
    await sql.begin(async (tx) => enqueueUnheldDisputeHolds(tx, 97));
    expect(
      await sql`SELECT id FROM outbox WHERE type='FUNDING_HOLD' AND payload->>'claimId'=${created.data.id}`,
    ).toHaveLength(2);
    await sql`UPDATE financial_projections SET state=jsonb_set(state,'{fundingHold}','true'::jsonb) WHERE claim_key=${created.data.claimKey}`;
    await sql`UPDATE outbox SET created_at=now()-interval '61 seconds' WHERE payload->>'claimId'=${created.data.id}`;
    await sql.begin(async (tx) => enqueueUnheldDisputeHolds(tx, 97));
    expect(
      await sql`SELECT id FROM outbox WHERE type='FUNDING_HOLD' AND payload->>'claimId'=${created.data.id}`,
    ).toHaveLength(2);
  });
  it("lets the fixed buyer attach dispute evidence without changing signed Deal terms", async () => {
    const created = await call(
      "/v1/claims",
      "POST",
      draft(cocoa),
      sessions.borrower,
    );
    expect(created.status).toBe(201);
    const form = new FormData();
    form.set(
      "file",
      new File(
        ["Buyer received fewer units than invoiced."],
        "buyer-note.txt",
        { type: "text/plain" },
      ),
    );
    form.set("expectedVersion", String(created.data.version));
    form.set("purpose", "DISPUTE");
    const upload = async (session: Login) => {
      const response = await handleRequest(
        new Request(`${origin}/v1/claims/${created.data.id}/documents`, {
          method: "POST",
          headers: {
            Origin: origin,
            Cookie: session.cookie,
            "X-CSRF-Token": session.csrf,
            "Idempotency-Key": randomUUID(),
          },
          body: form,
        }),
      );
      return { status: response.status, data: await response.json() };
    };
    expect((await upload(sessions.borrower)).status).toBe(403);
    const buyerUpload = await upload(sessions.buyer);
    expect(buyerUpload.status).toBe(201);
    expect(buyerUpload.data).toMatchObject({
      purpose: "DISPUTE",
      version: created.data.version,
    });
    const [claim] =
      await getSql()`SELECT version,terms FROM claims WHERE id=${created.data.id}`;
    expect(claim.version).toBe(created.data.version);
    expect(claim.terms).toEqual(created.data.terms);
    const evidence = await call(
      `/v1/claims/${created.data.id}/evidence`,
      "GET",
      undefined,
      sessions.buyer,
    );
    expect(evidence.status).toBe(200);
    expect(evidence.data.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: buyerUpload.data.documentId,
          purpose: "DISPUTE",
        }),
      ]),
    );
    const disputed = await call(
      `/v1/claims/${created.data.id}/disputes`,
      "POST",
      {
        expectedVersion: created.data.version,
        reason: "Buyer received fewer units than invoiced.",
        evidenceId: buyerUpload.data.documentId,
      },
      sessions.buyer,
    );
    expect(disputed.status).toBe(202);
  });
});
