import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex, zeroHash } from "viem";
import { getSql, closeDb } from "../packages/db";
import { secretHash } from "../packages/api/core";
import { handleRequest } from "../packages/api/handler";
import {
  createSyntheticOrganization,
  reviewAccessRequest,
} from "../packages/api/onboarding";

const rpc = vi.hoisted(() => ({
  chainId: 97,
  unavailable: false,
  serviceWallets: new Map<string, string>(),
}));
vi.mock("../packages/chain/config", async (original) => ({
  ...(await original<typeof import("../packages/chain/config")>()),
  publicClient: () => ({
    getChainId: async () => {
      if (rpc.unavailable) throw new Error("RPC unavailable");
      return rpc.chainId;
    },
    readContract: async ({ args }: { args: [string, string] }) =>
      rpc.serviceWallets.get(args[1]) === args[0],
  }),
}));
const origin = "https://onboarding.test";
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
async function request(user: string, role = "BORROWER") {
  const result = await call(user, "/v1/access-request", "POST", {
    organizationName: `Synthetic ${user}`,
    requestedRole: role,
  });
  expect(result.status).toBe(201);
  return result.data.request;
}
async function organization(role = "BORROWER") {
  const result = await call("operator", "/v1/organizations/demo", "POST", {
    name: `Synthetic Org ${randomUUID()}`,
    identityKey: randomUUID(),
    kind: role,
    reason: "A distinct synthetic entity reviewed manually.",
  });
  expect(result.status).toBe(201);
  return result.data.organization;
}
const reason =
  "Manual synthetic identity and wallet authority review completed.";
beforeAll(async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("PORT");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  directory = await mkdtemp(join(tmpdir(), "talunai-onboarding-"));
  pg = new EmbeddedPostgres({
    databaseDir: join(directory, "db"),
    user: "onboarding",
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
  await pg.createDatabase("onboarding");
  Object.assign(process.env, {
    DATABASE_URL: `postgres://onboarding:isolated-only@127.0.0.1:${port}/onboarding`,
    APP_ENV: "testnet",
    CHAIN_ID: "97",
    APP_ORIGIN: origin,
    SIWE_DOMAIN: "onboarding.test",
    SIWE_URI: origin,
    SESSION_SECRET: "isolated-onboarding-session-".repeat(3),
    CLAIM_ID_HMAC_KEY: "isolated-onboarding-hmac-".repeat(3),
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
  await newUser("seed-borrower", "BORROWER");
}, 60000);
afterAll(async () => {
  await closeDb();
  if (started) await pg.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
  process.env = savedEnv;
});

describe("onboarding backed by isolated PostgreSQL; role reads mocked, no public chain writes", () => {
  it("requires session and creates an attributable pending request without membership", async () => {
    expect((await call(null, "/v1/access-request")).status).toBe(401);
    const u = await newUser(),
      r = await request(u);
    expect(r).toMatchObject({
      status: "PENDING",
      version: 1,
      isSynthetic: true,
    });
    expect((await call(u, "/v1/me")).data.memberships).toEqual([]);
    expect((await call(u, "/v1/organizations")).status).toBe(403);
    expect(
      await getSql()`SELECT * FROM audit_events WHERE target=${r.id}`,
    ).toHaveLength(1);
  });
  it("isolates own requests from other users", async () => {
    const a = await newUser(),
      b = await newUser();
    const r = await request(a);
    expect((await call(a, "/v1/access-request")).data.request.id).toBe(r.id);
    expect((await call(b, "/v1/access-request")).data.request).toBeNull();
    expect((await call(b, "/v1/access-requests")).status).toBe(403);
    expect((await call(b, "/v1/access-organizations")).status).toBe(403);
  });
  it("rejects ADMIN/VERIFIER roles and user/wallet/org ID spoofing", async () => {
    const u = await newUser();
    for (const field of [
      { requestedRole: "ADMIN" },
      { requestedRole: "VERIFIER" },
      { userId: "operator" },
      { wallet: sessions.get("operator")!.wallet },
      { organizationId: "org-seed-borrower" },
    ]) {
      expect(
        (
          await call(u, "/v1/access-request", "POST", {
            organizationName: "Synthetic participant",
            requestedRole: "BORROWER",
            ...field,
          })
        ).status,
      ).toBe(422);
    }
  });
  it("enforces CSRF and origin", async () => {
    const u = await newUser(),
      body = {
        organizationName: "Synthetic participant",
        requestedRole: "BUYER",
      };
    expect(
      (
        await call(u, "/v1/access-request", "POST", body, randomUUID(), {
          "X-CSRF-Token": "wrong",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(u, "/v1/access-request", "POST", body, randomUUID(), {
          Origin: "https://evil.test",
        })
      ).status,
    ).toBe(403);
  });
  it("idempotently replays a logical request and rejects different body", async () => {
    const u = await newUser(),
      key = randomUUID(),
      body = {
        organizationName: "Synthetic participant",
        requestedRole: "BUYER",
      };
    const first = await call(u, "/v1/access-request", "POST", body, key),
      again = await call(u, "/v1/access-request", "POST", body, key);
    expect(again).toEqual(first);
    expect(
      (
        await call(
          u,
          "/v1/access-request",
          "POST",
          { ...body, requestedRole: "LENDER" },
          key,
        )
      ).data.error.code,
    ).toBe("IDEMPOTENCY_CONFLICT");
  });
  it("concurrent pending requests produce one row", async () => {
    const u = await newUser(),
      body = {
        organizationName: "Synthetic racing request",
        requestedRole: "BORROWER",
      };
    const results = await Promise.all([
      call(u, "/v1/access-request", "POST", body),
      call(u, "/v1/access-request", "POST", body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await getSql()`SELECT * FROM access_requests WHERE user_id=${u}`,
    ).toHaveLength(1);
  });
  it("refuses agent and other chain service wallets without revealing keys", async () => {
    for (const role of ["AGENT_ROLE", "VERIFIER_ROLE", "DEMO_MINTER_ROLE"]) {
      const u = await newUser();
      rpc.serviceWallets.set(sessions.get(u)!.wallet, keccak256(toHex(role)));
      expect((await call(u, "/v1/access-request")).data.restrictedWallet).toBe(
        true,
      );
      expect(
        (
          await call(u, "/v1/access-request", "POST", {
            organizationName: "Invalid service participant",
            requestedRole: "BORROWER",
          })
        ).data.error.code,
      ).toBe("PARTICIPANT_WALLET_REQUIRED");
    }
    expect(
      (await call("operator", "/v1/access-request")).data.restrictedWallet,
    ).toBe(true);
    const chainAdmin = await newUser();
    rpc.serviceWallets.set(sessions.get(chainAdmin)!.wallet, zeroHash);
    expect(
      (await call(chainAdmin, "/v1/access-request")).data.restrictedWallet,
    ).toBe(true);
  });
  it("fails closed on wrong chain or unavailable RPC", async () => {
    const u = await newUser();
    rpc.chainId = 56;
    expect((await call(u, "/v1/access-request")).status).toBe(503);
    rpc.chainId = 97;
    rpc.unavailable = true;
    expect((await call(u, "/v1/access-request")).data.error.code).toBe(
      "ACCESS_ROLE_CHECK_UNAVAILABLE",
    );
    rpc.unavailable = false;
  });
  it("cannot review or create organizations as a participant", async () => {
    const u = await newUser(),
      r = await request(u);
    expect(
      (
        await call(u, `/v1/access-requests/${r.id}/review`, "POST", {
          expectedVersion: 1,
          decision: "APPROVE",
          reason,
          organizationId: "org-seed-borrower",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(u, "/v1/organizations/demo", "POST", {
          name: "Spoofed company",
          identityKey: "spoofed",
          kind: "BORROWER",
          reason,
        })
      ).status,
    ).toBe(403);
  });
  it("canonical names/aliases/identity keys prevent duplicate organization creation", async () => {
    const identityKey = randomUUID(),
      name = `Canonical Organization ${randomUUID()}`;
    await createSyntheticOrganization({
      operatorUserId: "operator",
      identityKey,
      name,
      aliases: ["Unique Invoice Supplier Alias"],
      kind: "BORROWER",
      reason,
    });
    await expect(
      createSyntheticOrganization({
        operatorUserId: "operator",
        identityKey: randomUUID(),
        name: name.toUpperCase().replaceAll(" ", "-"),
        kind: "BORROWER",
        reason,
      }),
    ).rejects.toMatchObject({ code: "CANONICAL_ORGANIZATION_ALREADY_EXISTS" });
    await expect(
      createSyntheticOrganization({
        operatorUserId: "operator",
        identityKey: randomUUID(),
        name: "Unique Invoice Supplier Alias",
        kind: "BORROWER",
        reason,
      }),
    ).rejects.toMatchObject({ code: "CANONICAL_ORGANIZATION_ALREADY_EXISTS" });
    await expect(
      createSyntheticOrganization({
        operatorUserId: "operator",
        identityKey,
        name: "Different name same identity",
        kind: "BORROWER",
        reason,
      }),
    ).rejects.toMatchObject({ code: "CANONICAL_ORGANIZATION_ALREADY_EXISTS" });
  });
  it("does not replace seeded wallet authorities or approve mismatched organizations", async () => {
    const u = await newUser(),
      r = await request(u),
      wrong = await organization("BUYER");
    const route = `/v1/access-requests/${r.id}/review`,
      body = { expectedVersion: 1, decision: "APPROVE", reason };
    expect(
      (
        await call("operator", route, "POST", {
          ...body,
          organizationId: "org-seed-borrower",
        })
      ).data.error.code,
    ).toBe("ORGANIZATION_AUTHORITY_ALREADY_ASSIGNED");
    expect(
      (
        await call("operator", route, "POST", {
          ...body,
          organizationId: wrong.id,
        })
      ).data.error.code,
    ).toBe("APPROVED_SYNTHETIC_ORGANIZATION_REQUIRED");
    expect(
      await getSql()`SELECT * FROM memberships WHERE organization_id='org-seed-borrower'`,
    ).toHaveLength(1);
    expect((await call(u, "/v1/me")).data.memberships).toEqual([]);
  });
  it("approves a reviewed exact organization once under race and preserves audit", async () => {
    const u = await newUser(),
      r = await request(u),
      org = await organization();
    const body = {
        expectedVersion: 1,
        decision: "APPROVE",
        organizationId: org.id,
        reason,
      },
      route = `/v1/access-requests/${r.id}/review`;
    const results = await Promise.all([
      call("operator", route, "POST", body),
      call("operator", route, "POST", body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await call(u, "/v1/me")).data.memberships).toHaveLength(1);
    expect((await call(u, "/v1/me")).data.memberships[0].organizationId).toBe(
      org.id,
    );
    expect((await call(u, "/v1/access-request")).data.request).toMatchObject({
      status: "APPROVED",
      version: 2,
      organizationId: org.id,
    });
    expect(
      await getSql()`SELECT * FROM audit_events WHERE target=${r.id} AND action='ACCESS_REQUEST_APPROVED'`,
    ).toHaveLength(1);
    expect(
      (
        await call(
          "operator",
          "/v1/access-organizations?role=BORROWER&limit=100",
        )
      ).data.items.find((v: { id: string }) => v.id === org.id).occupied,
    ).toBe(true);
  });
  it("operator rejection is visible and permits another request", async () => {
    const u = await newUser(),
      r = await request(u);
    await reviewAccessRequest({
      requestId: r.id,
      expectedVersion: 1,
      decision: "REJECT",
      reason,
      operatorUserId: "operator",
    });
    expect((await call(u, "/v1/access-request")).data.request).toMatchObject({
      status: "REJECTED",
      reviewReason: reason,
    });
    const next = await request(u);
    expect(next.id).not.toBe(r.id);
    await expect(
      reviewAccessRequest({
        requestId: r.id,
        expectedVersion: 1,
        decision: "REJECT",
        reason,
        operatorUserId: "operator",
      }),
    ).rejects.toMatchObject({ code: "ACCESS_REQUEST_STALE" });
  });
  it("two different applicants cannot acquire the same organization under a race", async () => {
    const first = await request(await newUser()),
      second = await request(await newUser()),
      org = await organization();
    const results = await Promise.all(
      [first, second].map((r) =>
        call("operator", `/v1/access-requests/${r.id}/review`, "POST", {
          expectedVersion: 1,
          decision: "APPROVE",
          organizationId: org.id,
          reason,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await getSql()`SELECT * FROM memberships WHERE organization_id=${org.id} AND approved=true`,
    ).toHaveLength(1);
  });
  it("does not authorize another wallet attached after the application", async () => {
    const u = await newUser(),
      r = await request(u),
      org = await organization();
    const secondWallet =
      privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
    await getSql()`INSERT INTO wallets(address,user_id) VALUES(${secondWallet},${u})`;
    expect(
      (
        await call("operator", `/v1/access-requests/${r.id}/review`, "POST", {
          expectedVersion: 1,
          decision: "APPROVE",
          organizationId: org.id,
          reason,
        })
      ).data.error.code,
    ).toBe("WALLET_AUTHORITY_REVIEW_REQUIRED");
    expect((await call(u, "/v1/me")).data.memberships).toEqual([]);
  });
  it("organization creation is idempotent and cannot accept privileged roles from its body", async () => {
    const key = randomUUID(),
      body = {
        name: `Idempotent Company ${randomUUID()}`,
        identityKey: randomUUID(),
        kind: "BORROWER",
        reason,
      };
    const first = await call(
      "operator",
      "/v1/organizations/demo",
      "POST",
      body,
      key,
    );
    expect(first.status).toBe(201);
    expect(
      await call("operator", "/v1/organizations/demo", "POST", body, key),
    ).toEqual(first);
    expect(
      (
        await call("operator", "/v1/organizations/demo", "POST", {
          ...body,
          kind: "ADMIN",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call("operator", "/v1/organizations/demo", "POST", {
          ...body,
          operatorUserId: "another-operator",
        })
      ).status,
    ).toBe(422);
  });
  it("rechecks onchain role at approval after a pending request", async () => {
    const u = await newUser(),
      r = await request(u),
      org = await organization();
    rpc.serviceWallets.set(
      sessions.get(u)!.wallet,
      keccak256(toHex("AGENT_ROLE")),
    );
    expect(
      (
        await call("operator", `/v1/access-requests/${r.id}/review`, "POST", {
          expectedVersion: 1,
          decision: "APPROVE",
          organizationId: org.id,
          reason,
        })
      ).data.error.code,
    ).toBe("PARTICIPANT_WALLET_REQUIRED");
    expect((await call(u, "/v1/me")).data.memberships).toEqual([]);
  });
  it("lender access keeps a separate onchain allowlist gate", async () => {
    const u = await newUser(),
      r = await request(u, "LENDER"),
      org = await organization("LENDER"),
      key = randomUUID();
    const body = {
        expectedVersion: 1,
        decision: "APPROVE",
        organizationId: org.id,
        reason,
      },
      route = `/v1/access-requests/${r.id}/review`;
    const result = await call("operator", route, "POST", body, key);
    expect(result.data).toMatchObject({
      chainTransactionSent: false,
      remainingGate: "ONCHAIN_LENDER_ALLOWLIST_REQUIRED",
    });
    expect(await call("operator", route, "POST", body, key)).toEqual(result);
  });
  it("admin lists paginate and filter actual requests only", async () => {
    const result = await call(
      "operator",
      "/v1/access-requests?status=PENDING&limit=2&offset=0",
    );
    expect(result.status).toBe(200);
    expect(result.data.items).toHaveLength(2);
    expect(
      result.data.items.every(
        (r: { status: string; wallet: string; userId: string }) =>
          r.status === "PENDING" && r.wallet && r.userId,
      ),
    ).toBe(true);
    expect(result.data.total).toBeGreaterThan(2);
  });
  it("rejects operator mutations when their organization is revoked after login", async () => {
    const admin = await newUser("revoked-operator", "ADMIN"),
      u = await newUser(),
      r = await request(u),
      org = await organization();
    await getSql()`UPDATE organizations SET status='REJECTED' WHERE id=${`org-${admin}`}`;
    expect((await call(admin, "/v1/access-requests")).status).toBe(403);
    expect((await call(admin, "/v1/access-organizations")).status).toBe(403);
    const creation = await call(admin, "/v1/organizations/demo", "POST", {
      name: `Revoked Operator ${randomUUID()}`,
      identityKey: randomUUID(),
      kind: "BORROWER",
      reason,
    });
    expect(creation.status).toBe(403);
    expect(creation.data.error.code).toBe("ROLE_FORBIDDEN");
    const approval = await call(
      admin,
      `/v1/access-requests/${r.id}/review`,
      "POST",
      {
        expectedVersion: 1,
        decision: "APPROVE",
        organizationId: org.id,
        reason,
      },
    );
    expect(approval.status).toBe(403);
    expect(approval.data.error.code).toBe("ROLE_FORBIDDEN");
    expect((await call(u, "/v1/access-request")).data.request.status).toBe(
      "PENDING",
    );
    expect((await call(u, "/v1/me")).data.memberships).toEqual([]);
  });
  it("attributes authenticated admin writes to their session wallet, not another linked wallet", async () => {
    const admin = await newUser("multiwallet-operator", "ADMIN"),
      expectedWallet = sessions.get(admin)!.wallet;
    await getSql()`INSERT INTO wallets(address,user_id) VALUES('0x0000000000000000000000000000000000000001',${admin})`;
    const created = await call(admin, "/v1/organizations/demo", "POST", {
      name: `Attributed Organization ${randomUUID()}`,
      identityKey: randomUUID(),
      kind: "BORROWER",
      reason,
    });
    expect(created.status).toBe(201);
    const [creationAudit] =
      await getSql()`SELECT details FROM audit_events WHERE target=${created.data.organization.id} AND action='SYNTHETIC_ORGANIZATION_PROVISIONED'`;
    expect(creationAudit.details).toMatchObject({
      operatorWallet: expectedWallet,
      mechanism: "AUTHENTICATED_ADMIN_API",
    });
    const u = await newUser(),
      r = await request(u);
    expect(
      (
        await call(admin, `/v1/access-requests/${r.id}/review`, "POST", {
          expectedVersion: 1,
          decision: "APPROVE",
          organizationId: created.data.organization.id,
          reason,
        })
      ).status,
    ).toBe(200);
    const [reviewAudit] =
      await getSql()`SELECT details FROM audit_events WHERE target=${r.id} AND action='ACCESS_REQUEST_APPROVED'`;
    expect(reviewAudit.details).toMatchObject({
      operatorWallet: expectedWallet,
      mechanism: "AUTHENTICATED_ADMIN_API",
    });
  });
});
