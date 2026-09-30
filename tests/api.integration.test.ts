import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createWalletClient, createPublicClient, http } from "viem";
import { foundry } from "viem/chains";
import {
  mnemonicToAccount,
  privateKeyToAccount,
  generatePrivateKey,
} from "viem/accounts";
import { handleRequest } from "../packages/api/handler";
import { getSql } from "../packages/db";
import { hash } from "../packages/api/core";
const enabled = process.env.RUN_INTEGRATION === "1";
const origin = "http://localhost:3000";
const account = (index: number) =>
  mnemonicToAccount(
    "test test test test test test test test test test test junk",
    { addressIndex: index },
  );
type Session = { cookie: string; csrf: string };
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  session?: Session,
  key = randomUUID(),
  headers: Record<string, string> = {},
) {
  const response = await handleRequest(
    new Request(origin + path, {
      method,
      headers: {
        Origin: origin,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(session
          ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
          : {}),
        "Idempotency-Key": key,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  let data;
  try {
    data = await response.clone().json();
  } catch {
    data = null;
  }
  return { response, data, status: response.status };
}
async function login(index: number): Promise<Session> {
  return loginSigner(account(index));
}
async function loginSigner(
  a: Pick<ReturnType<typeof account>, "address" | "signMessage">,
): Promise<Session> {
  const challenge = await call("/v1/auth/challenge", "POST", {
    address: a.address,
    chainId: 31337,
  });
  expect(challenge.status).toBe(200);
  const browser = challenge.response.headers.get("set-cookie")!.split(";")[0];
  const signature = await a.signMessage({ message: challenge.data.message });
  const verify = await call(
    "/v1/auth/verify",
    "POST",
    {
      challengeId: challenge.data.challengeId,
      message: challenge.data.message,
      signature,
    },
    undefined,
    randomUUID(),
    { Cookie: browser },
  );
  expect(verify.status).toBe(200);
  return {
    cookie: verify.response.headers.get("set-cookie")!.split(";")[0],
    csrf: verify.data.csrfToken,
  };
}
const create = (invoiceNumber = randomUUID()) => ({
  assetType: "TRADE_RECEIVABLE" as const,
  goods: {
    category: "COCOA" as const,
    description: "kakao",
    lineItems: [{ description: "kakao", quantity: "10", unit: "ton" }],
  },
  organizationId: "org-borrower",
  buyerOrganizationId: "org-buyer",
  lenderOrganizationId: "org-lender",
  invoiceNamespace: "2026",
  invoiceNumber,
  acceptedOutstanding: "100000000",
  requestedPrincipal: "70000000",
  invoiceDueAt: Math.floor(Date.now() / 1000) + 45 * 86400,
});
describe.skipIf(!enabled)(
  "API PostgreSQL + EOA Anvil integration (RUN_INTEGRATION=1)",
  () => {
    let borrower: Session, lender: Session, other: Session, verifier: Session;
    beforeAll(async () => {
      expect(process.env.CHAIN_ID).toBe("31337");
      [borrower, lender, other, verifier] = await Promise.all([
        login(1),
        login(3),
        login(7),
        login(4),
      ]);
    }, 30000);
    it("valid login, me, logout revocation; new wallet remains pending", async () => {
      const pending = await login(6);
      const me = await call("/v1/me", "GET", undefined, pending);
      expect(me.data.memberships).toEqual([]);
      expect((await call("/v1/claims", "POST", create(), pending)).status).toBe(
        403,
      );
      expect((await call("/v1/auth/logout", "POST", {}, pending)).status).toBe(
        200,
      );
      expect((await call("/v1/me", "GET", undefined, pending)).status).toBe(
        401,
      );
    });
    it("SIWE concurrent verification consumes nonce exactly once and replay fails", async () => {
      const a = account(8),
        c = await call("/v1/auth/challenge", "POST", {
          address: a.address,
          chainId: 31337,
        }),
        signature = await a.signMessage({ message: c.data.message }),
        body = {
          challengeId: c.data.challengeId,
          message: c.data.message,
          signature,
        },
        headers = {
          Cookie: c.response.headers.get("set-cookie")!.split(";")[0],
        };
      const responses = await Promise.all([
        call("/v1/auth/verify", "POST", body, undefined, randomUUID(), headers),
        call("/v1/auth/verify", "POST", body, undefined, randomUUID(), headers),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
      expect(
        (
          await call(
            "/v1/auth/verify",
            "POST",
            body,
            undefined,
            randomUUID(),
            headers,
          )
        ).status,
      ).toBe(401);
    });
    it("wrong chain, origin and account type cannot authenticate", async () => {
      expect(
        (
          await call("/v1/auth/challenge", "POST", {
            address: account(9).address,
            chainId: 56,
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await call("/v1/auth/challenge", "POST", {
            address: account(9).address,
            chainId: 31337,
            accountType: "ERC1271",
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await call(
            "/v1/auth/challenge",
            "POST",
            { address: account(9).address, chainId: 31337 },
            undefined,
            randomUUID(),
            { Origin: "https://evil.invalid" },
          )
        ).status,
      ).toBe(403);
    });
    it("wrong domain URI address chain or dates in signed message are rejected against full issued challenge", async () => {
      const a = account(9),
        c = await call("/v1/auth/challenge", "POST", {
          address: a.address,
          chainId: 31337,
        }),
        headers = {
          Cookie: c.response.headers.get("set-cookie")!.split(";")[0],
        };
      for (const message of [
        c.data.message.replace("localhost:3000 wants", "evil.invalid wants"),
        c.data.message.replace(
          "URI: http://localhost:3000",
          "URI: https://evil.invalid",
        ),
        c.data.message.replace(a.address, account(8).address),
        c.data.message.replace("Chain ID: 31337", "Chain ID: 97"),
        c.data.message.replace(
          /Expiration Time:.+/,
          "Expiration Time: 2001-01-01T00:00:00.000Z",
        ),
      ]) {
        const signature = await a.signMessage({ message });
        expect(
          (
            await call(
              "/v1/auth/verify",
              "POST",
              { challengeId: c.data.challengeId, message, signature },
              undefined,
              randomUUID(),
              headers,
            )
          ).status,
        ).toBe(401);
      }
    });
    it("invalid signature leaves challenge unconsumed and creates no session", async () => {
      const a = account(10),
        c = await call("/v1/auth/challenge", "POST", {
          address: a.address,
          chainId: 31337,
        }),
        headers = {
          Cookie: c.response.headers.get("set-cookie")!.split(";")[0],
        },
        wrong = await account(11).signMessage({ message: c.data.message });
      expect(
        (
          await call(
            "/v1/auth/verify",
            "POST",
            {
              challengeId: c.data.challengeId,
              message: c.data.message,
              signature: wrong,
            },
            undefined,
            randomUUID(),
            headers,
          )
        ).status,
      ).toBe(401);
      const rows =
        await getSql()`SELECT consumed_at FROM siwe_challenges WHERE id=${c.data.challengeId}`;
      expect(rows[0].consumed_at).toBeNull();
    });
    it("expiration enforced independently in database and contract accounts reject explicitly", async () => {
      const a = account(12),
        c = await call("/v1/auth/challenge", "POST", {
          address: a.address,
          chainId: 31337,
        });
      await getSql()`UPDATE siwe_challenges SET expires_at=now()-interval '1 second' WHERE id=${c.data.challengeId}`;
      const signature = await a.signMessage({ message: c.data.message });
      expect(
        (
          await call(
            "/v1/auth/verify",
            "POST",
            {
              challengeId: c.data.challengeId,
              message: c.data.message,
              signature,
            },
            undefined,
            randomUUID(),
            { Cookie: c.response.headers.get("set-cookie")!.split(";")[0] },
          )
        ).status,
      ).toBe(401);
      const contract = await call("/v1/auth/challenge", "POST", {
        address: process.env.MOCK_IDR_ADDRESS,
        chainId: 31337,
      });
      const out = await call(
        "/v1/auth/verify",
        "POST",
        {
          challengeId: contract.data.challengeId,
          message: contract.data.message,
          signature,
        },
        undefined,
        randomUUID(),
        { Cookie: contract.response.headers.get("set-cookie")!.split(";")[0] },
      );
      expect(out.status).toBe(422);
      expect(out.data.error.code).toBe("ACCOUNT_TYPE_UNSUPPORTED");
    });
    it("CSRF, origin and body role escalation are rejected", async () => {
      expect(
        (
          await call("/v1/claims", "POST", create(), borrower, randomUUID(), {
            "X-CSRF-Token": "wrong",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call("/v1/claims", "POST", create(), borrower, randomUUID(), {
            Origin: "https://evil.invalid",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call(
            "/v1/claims",
            "POST",
            { ...create(), role: "ADMIN" },
            lender,
          )
        ).status,
      ).toBe(422);
      expect((await call("/v1/claims", "POST", create(), lender)).status).toBe(
        403,
      );
    });
    it("idempotency actor+route+body, concurrency duplicate identity and HMAC rotation preserve uniqueness", async () => {
      const b = create(),
        key = randomUUID(),
        first = await call("/v1/claims", "POST", b, borrower, key),
        same = await call("/v1/claims", "POST", b, borrower, key);
      expect(first.status).toBe(201);
      expect(same.data.id).toBe(first.data.id);
      expect(
        (
          await call(
            "/v1/claims",
            "POST",
            { ...b, requestedPrincipal: "60000000" },
            borrower,
            key,
          )
        ).status,
      ).toBe(409);
      const races = await Promise.all([
        call("/v1/claims", "POST", create(b.invoiceNumber), borrower),
        call("/v1/claims", "POST", create(b.invoiceNumber), borrower),
      ]);
      expect(races.map((r) => r.status)).toEqual([409, 409]);
      const fresh = create(),
        creation = await Promise.all([
          call("/v1/claims", "POST", fresh, borrower),
          call("/v1/claims", "POST", fresh, borrower),
        ]);
      expect(creation.map((r) => r.status).sort()).toEqual([201, 409]);
      const prior = process.env.CLAIM_ID_HMAC_KEY;
      process.env.CLAIM_ID_HMAC_KEY =
        "rotated-local-integration-only-key-12345";
      try {
        expect((await call("/v1/claims", "POST", b, borrower)).status).toBe(
          409,
        );
      } finally {
        process.env.CLAIM_ID_HMAC_KEY = prior;
      }
    });
    it("exact finance amounts, isolated lender visibility and recipient cannot be supplied", async () => {
      const made = await call("/v1/claims", "POST", create(), borrower);
      expect(made.data.terms.fee).toBe("1050000");
      expect(made.data.terms.borrower).toBe(account(1).address.toLowerCase());
      expect(
        (await call(`/v1/claims/${made.data.id}`, "GET", undefined, other))
          .status,
      ).toBe(404);
      expect(
        (await call(`/v1/claims/${made.data.id}`, "GET", undefined, lender))
          .status,
      ).toBe(200);
      expect(
        (
          await call(
            `/v1/claims/${made.data.id}`,
            "PATCH",
            { expectedVersion: 1, borrower: account(6).address },
            borrower,
          )
        ).status,
      ).toBe(422);
      expect(
        (
          await call(
            "/v1/claims",
            "POST",
            { ...create(), requestedPrincipal: "80000001" },
            borrower,
          )
        ).status,
      ).toBe(422);
      expect(
        (
          await call(
            "/v1/claims",
            "POST",
            { ...create(), requestedPrincipal: 70000000 },
            borrower,
          )
        ).status,
      ).toBe(422);
    });
    it("private upload increments version, revokes old consents and enqueues persistent outbox before 202", async () => {
      const made = await call("/v1/claims", "POST", create(), borrower),
        claimId = made.data.id;
      const db = getSql();
      await db`INSERT INTO consent_records(id,claim_id,version,role,signer,nonce,deadline,signature,terms_hash) VALUES(${randomUUID()},${claimId},1,'BORROWER',${account(1).address.toLowerCase()},'0',${Math.floor(Date.now() / 1000) - 1},${"0x" + "0".repeat(130)},${"0x" + hash("test-consent")})`;
      await db`INSERT INTO review_decisions(id,claim_id,version,actor_id,decision,reason,expires_at,snapshot_hash) VALUES(${randomUUID()},${claimId},1,'user-verifier','APPROVE','Synthetic test previous review',now()+interval '1 hour',${hash("previous")})`;
      const form = new FormData();
      form.set("expectedVersion", "1");
      form.set(
        "file",
        new File(
          [
            "isSynthetic: true\ngoodsDescription: kakao\ngoodsCategory: COCOA\nquantity: 10\nquantityUnit: ton\nInvoice sintetis untuk pengujian",
          ],
          "evidence.txt",
          {
            type: "text/plain",
          },
        ),
      );
      const uploaded = await handleRequest(
        new Request(`${origin}/v1/claims/${claimId}/documents`, {
          method: "POST",
          headers: {
            Origin: origin,
            Cookie: borrower.cookie,
            "X-CSRF-Token": borrower.csrf,
            "Idempotency-Key": randomUUID(),
          },
          body: form,
        }),
      );
      expect(uploaded.status).toBe(201);
      const doc = await uploaded.json();
      expect(doc.version).toBe(2);
      expect(doc.status).toBe("PENDING_PARSE");
      const priorConsents =
        await db`SELECT revoked FROM consent_records WHERE claim_id=${claimId}`;
      expect(priorConsents[0].revoked).toBe(true);
      const currentReviews =
        await db`SELECT id FROM review_decisions WHERE claim_id=${claimId} AND version=2`;
      expect(currentReviews).toHaveLength(0);
      expect(
        (await call(`/v1/documents/${doc.documentId}`, "GET", undefined, other))
          .status,
      ).toBe(404);
      expect(
        (
          await call(
            `/v1/documents/${doc.documentId}`,
            "GET",
            undefined,
            borrower,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await call(
            `/v1/claims/${claimId}/analyze`,
            "POST",
            { expectedVersion: 1 },
            borrower,
          )
        ).status,
      ).toBe(409);
      const analysis = await call(
        `/v1/claims/${claimId}/analyze`,
        "POST",
        { expectedVersion: 2 },
        borrower,
      );
      expect(analysis.status).toBe(202);
      const rows =
        await getSql()`SELECT * FROM outbox WHERE payload->>'runId'=${analysis.data.runId}`;
      expect(rows).toHaveLength(1);
      expect(
        (
          await call(
            `/v1/agent-runs/${analysis.data.runId}`,
            "GET",
            undefined,
            other,
          )
        ).status,
      ).toBe(404);
    });
    it("registered hold needs explicit fresh human review; borrower cannot clear and immutable terms survive", async () => {
      const made = await call("/v1/claims", "POST", create(), borrower),
        claimId = made.data.id,
        docId = randomUUID(),
        actionId = randomUUID(),
        sql = getSql();
      await sql`INSERT INTO documents(id,claim_id,version,original_name,storage_key,sha256,commitment,mime,byte_size,status,retention_at) VALUES(${docId},${claimId},1,'synthetic.txt',${randomUUID() + ".bin"},${hash("x")},${"0x" + hash("x")},'text/plain',1,'PARSED',now()+interval '1 day')`;
      await sql`UPDATE claims SET workflow='REGISTERED',has_dispute=true,funding_hold=true WHERE id=${claimId}`;
      await sql`INSERT INTO attestations(id,claim_id,version,actor_id,method,kind,status,evidence_ids,expires_at) VALUES(${actionId},${claimId},1,'user-buyer','AUTHENTICATED_DISPUTE','DISPUTE','ATTESTED',${sql.json([docId])},now()+interval '1 day')`;
      const review = {
        expectedVersion: 1,
        decision: "APPROVE",
        reason:
          "Synthetic evidence independently reviewed and dispute resolved.",
        evidenceIds: [docId],
        resolvesDispute: true,
      };
      expect(
        (await call(`/v1/claims/${claimId}/review`, "POST", review, borrower))
          .status,
      ).toBe(403);
      expect(
        (
          await call(
            `/v1/claims/${claimId}/review`,
            "POST",
            { ...review, resolvesDispute: false },
            verifier,
          )
        ).status,
      ).toBe(409);
      const resolved = await call(
        `/v1/claims/${claimId}/review`,
        "POST",
        review,
        verifier,
      );
      expect(resolved.status).toBe(200);
      const rows = await sql`SELECT * FROM claims WHERE id=${claimId}`;
      expect(rows[0].version).toBe(1);
      expect(rows[0].terms).toEqual(made.data.terms);
      expect(rows[0].has_dispute).toBe(false);
      expect(rows[0].funding_hold).toBe(true);
    });
    it("another borrower cannot read private documents and unrelated buyer cannot prepare acknowledgement", async () => {
      const sql = getSql(),
        uid = `test-user-${randomUUID()}`,
        org = `test-org-${randomUUID()}`,
        wallet = account(13).address.toLowerCase();
      const existing =
        await sql`SELECT user_id FROM wallets WHERE address=${wallet}`;
      const userId = existing[0]?.user_id ?? uid;
      await sql`INSERT INTO users(id,status) VALUES(${userId},'PROVISIONED_SYNTHETIC') ON CONFLICT(id) DO NOTHING`;
      await sql`INSERT INTO wallets(address,user_id) VALUES(${wallet},${userId}) ON CONFLICT(address) DO NOTHING`;
      await sql`INSERT INTO organizations(id,name,kind,status) VALUES(${org},'Another fictional cooperative','BORROWER','APPROVED')`;
      await sql`INSERT INTO memberships(id,user_id,organization_id,role,approved) VALUES(${randomUUID()},${userId},${org},'BORROWER',true)`;
      const stranger = await login(13),
        made = await call("/v1/claims", "POST", create(), borrower),
        docId = randomUUID();
      await sql`INSERT INTO documents(id,claim_id,version,original_name,storage_key,sha256,commitment,mime,byte_size,status,retention_at) VALUES(${docId},${made.data.id},1,'synthetic.txt',${randomUUID() + ".bin"},${hash("x")},${"0x" + hash("x")},'text/plain',1,'PENDING_PARSE',now()+interval '1 day')`;
      expect(
        (await call(`/v1/documents/${docId}`, "GET", undefined, stranger))
          .status,
      ).toBe(404);
      const otherBuyerUser = `test-user-${randomUUID()}`,
        otherBuyerOrg = `test-org-${randomUUID()}`,
        buyerWallet = account(14).address.toLowerCase(),
        existingBuyer =
          await sql`SELECT user_id FROM wallets WHERE address=${buyerWallet}`,
        buyerUser = existingBuyer[0]?.user_id ?? otherBuyerUser;
      await sql`INSERT INTO users(id,status) VALUES(${buyerUser},'PROVISIONED_SYNTHETIC') ON CONFLICT(id) DO NOTHING`;
      await sql`INSERT INTO wallets(address,user_id) VALUES(${buyerWallet},${buyerUser}) ON CONFLICT(address) DO NOTHING`;
      await sql`INSERT INTO organizations(id,name,kind,status) VALUES(${otherBuyerOrg},'Another fictional buyer','BUYER','APPROVED')`;
      await sql`INSERT INTO memberships(id,user_id,organization_id,role,approved) VALUES(${randomUUID()},${buyerUser},${otherBuyerOrg},'BUYER',true)`;
      const unrelatedBuyer = await login(14);
      expect(
        (
          await call(
            `/v1/claims/${made.data.id}/consents/prepare`,
            "POST",
            { expectedVersion: 1, role: "BUYER", nonce: "1" },
            unrelatedBuyer,
          )
        ).status,
      ).toBe(404);
    });
    it("oversized streamed JSON rejects before body processing", async () => {
      const body = JSON.stringify({ padding: "x".repeat(70000) });
      const response = await handleRequest(
        new Request(origin + "/v1/auth/challenge", {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body,
        }),
      );
      expect(response.status).toBe(413);
    });
    it("different actual transaction nonce cannot mark an older intent REPLACED", async () => {
      const made = await call(
          "/v1/claims",
          "POST",
          { ...create(), lenderOrganizationId: "org-lenderTwo" },
          borrower,
        ),
        claimId = made.data.id;
      const prepared = await call(
        `/v1/claims/${claimId}/actions/prepare`,
        "POST",
        { expectedVersion: 1, action: "APPROVE_TOKEN", amount: "70000000" },
        other,
      );
      expect(prepared.status).toBe(200);
      const client = createWalletClient({
          account: account(7),
          chain: foundry,
          transport: http(process.env.RPC_HTTP_URL),
        }),
        rpc = createPublicClient({
          chain: foundry,
          transport: http(process.env.RPC_HTTP_URL),
        }),
        template = prepared.data.transaction;
      const hashOne = await client.sendTransaction({
        to: template.to,
        data: template.data,
        value: 0n,
      });
      await rpc.waitForTransactionReceipt({ hash: hashOne });
      const one = await rpc.getTransaction({ hash: hashOne });
      const hashTwo = await client.sendTransaction({
        to: template.to,
        data: template.data,
        value: 0n,
      });
      await rpc.waitForTransactionReceipt({ hash: hashTwo });
      const sql = getSql();
      await sql`UPDATE transaction_intents SET tx_hash=${hashOne},status='SUBMITTED',details=${sql.json({ nonce: one.nonce })} WHERE id=${prepared.data.intentId}`;
      const newer = await call(
        `/v1/claims/${claimId}/actions/prepare`,
        "POST",
        { expectedVersion: 1, action: "APPROVE_TOKEN", amount: "70000000" },
        other,
      );
      expect(newer.status).toBe(200);
      const result = await call(
        "/v1/transactions/observe",
        "POST",
        {
          intentId: newer.data.intentId,
          hash: hashTwo,
          replacesIntentId: prepared.data.intentId,
        },
        other,
      );
      expect(result.status).toBe(409);
      expect(result.data.error.code).toBe("REPLACEMENT_NONCE_NOT_VERIFIED");
      const old =
        await sql`SELECT status FROM transaction_intents WHERE id=${prepared.data.intentId}`;
      expect(old[0].status).toBe("SUBMITTED");
    });

    it("wallet rotation preserves issuer identity and cannot refinance the same invoice", async () => {
      const sql = getSql(),
        first = privateKeyToAccount(generatePrivateKey()),
        second = privateKeyToAccount(generatePrivateKey()),
        uid = `test-user-${randomUUID()}`,
        org = `test-org-${randomUUID()}`;
      await sql`INSERT INTO users(id,status) VALUES(${uid},'PROVISIONED_SYNTHETIC')`;
      await sql`INSERT INTO wallets(address,user_id) VALUES(${first.address.toLowerCase()},${uid})`;
      await sql`INSERT INTO organizations(id,name,kind,status) VALUES(${org},'Rotation synthetic issuer','BORROWER','APPROVED')`;
      await sql`INSERT INTO memberships(id,user_id,organization_id,role,approved) VALUES(${randomUUID()},${uid},${org},'BORROWER',true)`;
      const initial = await loginSigner(first),
        input = { ...create(), organizationId: org };
      expect((await call("/v1/claims", "POST", input, initial)).status).toBe(
        201,
      );
      await sql`UPDATE wallets SET address=${second.address.toLowerCase()} WHERE address=${first.address.toLowerCase()} AND user_id=${uid}`;
      await sql`UPDATE sessions SET revoked_at=now() WHERE user_id=${uid}`;
      const rotated = await loginSigner(second),
        duplicate = await call("/v1/claims", "POST", input, rotated);
      expect(duplicate.status).toBe(409);
      expect(duplicate.data.error.code).toBe("CONFLICT_REQUIRES_REVIEW");
      const rows =
        await sql`SELECT id FROM claims WHERE org_id=${org} AND invoice_number=${input.invoiceNumber.toUpperCase()}`;
      expect(rows).toHaveLength(1);
    });
    it("bank callback and fabricated financial patch cannot create a withdrawable balance", async () => {
      const made = await call("/v1/claims", "POST", create(), borrower),
        claimId = made.data.id,
        before = await call(
          `/v1/claims/${claimId}/financing`,
          "GET",
          undefined,
          borrower,
        );
      expect(
        (
          await call(
            "/v1/bank/callback",
            "POST",
            {
              claimId,
              status: "SETTLED",
              amount: "100000000",
              bankReceipt: "synthetic screenshot",
            },
            borrower,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            `/v1/claims/${claimId}`,
            "PATCH",
            {
              expectedVersion: 1,
              totalCollected: "100000000",
              financingStatus: "REPAID",
              lenderClaimable: "71050000",
            },
            borrower,
          )
        ).status,
      ).toBe(422);
      const after = await call(
        `/v1/claims/${claimId}/financing`,
        "GET",
        undefined,
        borrower,
      );
      expect(after.data).toEqual(before.data);
      expect(after.data.lenderClaimable).toBe("0");
    });
    it("unknown buyer cannot be promoted from a document or request", async () => {
      const result = await call(
        "/v1/claims",
        "POST",
        { ...create(), buyerOrganizationId: "unknown-fictional-buyer" },
        borrower,
      );
      expect(result.status).toBe(422);
      expect(result.data.error.code).toBe(
        "ORGANIZATION_AUTHORITY_REQUIRES_REVIEW",
      );
    });
    it("RPC unavailable prevents funding template and persists no intent", async () => {
      const made = await call("/v1/claims", "POST", create(), borrower),
        claimId = made.data.id,
        sql = getSql(),
        prior = process.env.RPC_HTTP_URL;
      process.env.RPC_HTTP_URL = "http://127.0.0.1:1";
      try {
        const result = await call(
          `/v1/claims/${claimId}/actions/prepare`,
          "POST",
          { expectedVersion: 1, action: "FUND" },
          lender,
        );
        expect(result.status).toBe(503);
        expect(["CHAIN_UNAVAILABLE", "INDEXER_NOT_FRESH"]).toContain(
          result.data.error.code,
        );
        const intents =
          await sql`SELECT id FROM transaction_intents WHERE claim_id=${claimId}`;
        expect(intents).toHaveLength(0);
        const direct = await call(
          `/v1/claims/${claimId}/actions/prepare`,
          "POST",
          { expectedVersion: 1, action: "APPROVE_TOKEN", amount: "70000000" },
          lender,
        );
        expect(direct.status).toBe(503);
        expect(direct.data.error.code).toBe("CHAIN_UNAVAILABLE");
      } finally {
        process.env.RPC_HTTP_URL = prior;
      }
    });
  },
);
