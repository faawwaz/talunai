import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TransactionNotFoundError,
  decodeFunctionData,
  keccak256,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getSql, closeDb } from "../packages/db";
import { executeFundingHold, type HoldInput } from "../packages/chain/gateway";
import { executorAbi } from "../packages/chain/contracts";

const doubles = vi.hoisted(() => ({
  readContract: vi.fn(),
  simulateContract: vi.fn(),
  getTransactionCount: vi.fn(),
  getTransaction: vi.fn(),
  prepareTransactionRequest: vi.fn(),
  signTransaction: vi.fn(),
  sendRawTransaction: vi.fn(),
  validateStartup: vi.fn(),
  inspectObservedTransaction: vi.fn(),
}));
vi.mock("../packages/chain/config", () => ({
  chainConfig: () => ({
    chainId: 31337,
    chain: { id: 31337 },
    rpc: "http://127.0.0.1:1",
    registry: "0x1111111111111111111111111111111111111111",
    executor: "0x2222222222222222222222222222222222222222",
  }),
  publicClient: () => doubles,
  jsonSafe: (value: unknown) =>
    JSON.parse(
      JSON.stringify(value, (_, item) =>
        typeof item === "bigint" ? item.toString() : item,
      ),
    ),
}));
vi.mock("../packages/chain/service", () => ({
  validateStartup: doubles.validateStartup,
  inspectObservedTransaction: doubles.inspectObservedTransaction,
}));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createWalletClient: () => doubles,
}));

const enabled = Boolean(process.env.DATABASE_URL);
const secret = `0x${"01".padStart(64, "0")}` as Hex; // Synthetic signing key used only by mocked chain 31337.
const account = privateKeyToAccount(secret);
const claimIds: string[] = [],
  orgIds: string[] = [],
  actorIds: string[] = [];

async function setup(
  options: {
    noDispute?: boolean;
    noAttestation?: boolean;
    wrongActor?: boolean;
    noAudit?: boolean;
    expired?: boolean;
    modelAttestation?: boolean;
  } = {},
) {
  const sql = getSql(),
    claimId = randomUUID(),
    org = randomUUID(),
    buyer = randomUUID(),
    actor = randomUUID(),
    evidenceId = randomUUID(),
    actionId = randomUUID();
  claimIds.push(claimId);
  orgIds.push(org, buyer);
  actorIds.push(actor);
  const payload: HoldInput = {
    claimId,
    evidenceId,
    actionId,
    version: 1,
    reason: "Authenticated buyer reports an invoice dispute.",
  };
  await sql.begin(async (tx) => {
    await tx`insert into organizations(id,name,kind,status) values(${org},'Issuer demo','BORROWER','APPROVED'),(${buyer},'Buyer demo','BUYER','APPROVED')`;
    await tx`insert into users(id,status) values(${actor},'PROVISIONED_SYNTHETIC')`;
    await tx`insert into memberships(id,user_id,organization_id,role,approved) values(${randomUUID()},${actor},${options.wrongActor ? org : buyer},'BUYER',true)`;
    await tx`insert into claims(id,org_id,buyer_org_id,claim_key,invoice_namespace,invoice_number,version,workflow,terms,evidence,has_dispute) values(${claimId},${org},${buyer},${keccak256(`0x${randomUUID().replaceAll("-", "")}`)},'2026',${randomUUID()},1,'REGISTERED','{}','{}',${!options.noDispute})`;
    await tx`insert into documents(id,claim_id,version,original_name,storage_key,sha256,commitment,mime,byte_size,extracted_text,status,retention_at) values(${evidenceId},${claimId},1,'synthetic.txt','test-only','abc',${`0x${"3".repeat(64)}`},'text/plain',10,'synthetic','PARSED',now()+interval '1 day')`;
    if (!options.noAttestation)
      await tx`insert into attestations(id,claim_id,version,actor_id,method,kind,status,evidence_ids,expires_at) values(${actionId},${claimId},1,${actor},${options.modelAttestation ? "MODEL_OPINION" : "AUTHENTICATED_DISPUTE"},'DISPUTE','ATTESTED',${tx.json([evidenceId])},${new Date(Date.now() + (options.expired ? -10000 : 86400000))})`;
    if (!options.noAudit)
      await tx`insert into audit_events(id,actor_id,action,target,correlation_id,details) values(${randomUUID()},${actor},'DISPUTE_RECORDED',${claimId},${actionId},${tx.json({ actionId, evidenceId })})`;
  });
  return payload;
}

describe.skipIf(!enabled)(
  "typed hold gateway: real PostgreSQL, mocked RPC, real signed raw transactions",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
      process.env.AGENT_PRIVATE_KEY = secret;
      doubles.validateStartup.mockResolvedValue({ status: "READY" });
      doubles.readContract.mockImplementation(
        async ({ functionName }: { functionName: string }) =>
          functionName === "hasRole"
            ? true
            : [{}, `0x${"0".repeat(64)}`, 1, false],
      );
      doubles.simulateContract.mockResolvedValue({});
      doubles.getTransactionCount.mockResolvedValue(7);
      doubles.getTransaction.mockRejectedValue(
        new TransactionNotFoundError({ hash: `0x${"0".repeat(64)}` }),
      );
      doubles.prepareTransactionRequest.mockImplementation(
        async (request: Record<string, unknown>) => ({
          ...request,
          chainId: 31337,
          type: "eip1559",
          gas: 150000n,
          maxFeePerGas: 2n,
          maxPriorityFeePerGas: 1n,
        }),
      );
      doubles.signTransaction.mockImplementation(
        async (request: Parameters<typeof account.signTransaction>[0]) =>
          account.signTransaction(request),
      );
      doubles.sendRawTransaction.mockImplementation(
        async ({ serializedTransaction }: { serializedTransaction: Hex }) =>
          keccak256(serializedTransaction),
      );
      doubles.inspectObservedTransaction.mockResolvedValue({
        status: "CONFIRMED",
      });
    });
    afterAll(async () => {
      const sql = getSql();
      for (const claimId of claimIds)
        await sql.begin(async (tx) => {
          await tx`delete from transaction_intents where claim_id=${claimId}`;
          await tx`delete from attestations where claim_id=${claimId}`;
          await tx`delete from documents where claim_id=${claimId}`;
          await tx`delete from audit_events where target=${claimId}`;
          await tx`delete from claims where id=${claimId}`;
        });
      for (const actor of actorIds) {
        await sql`delete from memberships where user_id=${actor}`;
        await sql`delete from users where id=${actor}`;
      }
      for (const org of orgIds)
        await sql`delete from organizations where id=${org}`;
      await closeDb();
    });
    it.each([
      [{ noDispute: true }, "HOLD_STALE_OR_NO_DISPUTE"],
      [{ noAttestation: true }, "HOLD_NO_ATTRIBUTABLE_EVIDENCE"],
      [{ wrongActor: true }, "HOLD_AUTHORIZATION_FAILED"],
      [{ noAudit: true }, "HOLD_AUTHORIZATION_FAILED"],
      [{ expired: true }, "HOLD_NO_ATTRIBUTABLE_EVIDENCE"],
      [{ modelAttestation: true }, "HOLD_NO_ATTRIBUTABLE_EVIDENCE"],
    ] as const)(
      "rejects missing/stale/unauthorized/model-only evidence %j",
      async (options, code) => {
        const payload = await setup(options);
        await expect(executeFundingHold(payload)).rejects.toThrow(code);
        expect(doubles.signTransaction).not.toHaveBeenCalled();
        expect(doubles.sendRawTransaction).not.toHaveBeenCalled();
        expect(
          (
            await getSql()`select id from transaction_intents where id=${payload.actionId}`
          ).length,
        ).toBe(0);
      },
    );
    it("rejects other evidence and mismatched claim version", async () => {
      const payload = await setup();
      await expect(
        executeFundingHold({ ...payload, evidenceId: randomUUID() }),
      ).rejects.toThrow("HOLD_NO_ATTRIBUTABLE_EVIDENCE");
      await expect(
        executeFundingHold({ ...payload, version: 2 }),
      ).rejects.toThrow("HOLD_STALE_OR_NO_DISPUTE");
      expect(doubles.sendRawTransaction).not.toHaveBeenCalled();
    });
    it.each([
      "recipient",
      "target",
      "calldata",
      "amount",
      "execute",
      "fund",
      "mint",
      "grantRole",
      "withdraw",
      "clearHold",
    ])(
      "rejects extra privileged action field %s before contacting RPC",
      async (field) => {
        const payload = await setup();
        await expect(
          executeFundingHold({ ...payload, [field]: "attacker" }),
        ).rejects.toThrow();
        expect(doubles.validateStartup).not.toHaveBeenCalled();
        expect(doubles.signTransaction).not.toHaveBeenCalled();
      },
    );
    it("requires agent onchain role and deployment chain validation", async () => {
      const payload = await setup();
      doubles.readContract.mockResolvedValueOnce(false);
      await expect(executeFundingHold(payload)).rejects.toThrow(
        "AGENT_ROLE_MISSING",
      );
      doubles.validateStartup.mockRejectedValueOnce(
        new Error("RPC_CHAIN_MISMATCH"),
      );
      await expect(executeFundingHold(payload)).rejects.toThrow(
        "RPC_CHAIN_MISMATCH",
      );
    });
    it("only records a risk observation for an already-funded claim", async () => {
      const payload = await setup();
      doubles.readContract.mockImplementation(
        async ({ functionName }: { functionName: string }) =>
          functionName === "hasRole"
            ? true
            : [{}, `0x${"0".repeat(64)}`, 2, false],
      );
      const result = await executeFundingHold(payload);
      expect(result.status).toBe("CONFIRMED");
      const [intent] =
        await getSql()`select * from transaction_intents where id=${payload.actionId}`;
      expect(
        decodeFunctionData({ abi: executorAbi, data: intent.template.data })
          .functionName,
      ).toBe("recordRiskObservation");
      expect(intent.template.to).toBe(
        "0x2222222222222222222222222222222222222222",
      );
      expect(intent.template.value).toBe("0");
    });
    it("persists signed bytes before broadcast and resumes same nonce/hash after a crash", async () => {
      const payload = await setup();
      await expect(
        executeFundingHold(payload, { crashAfterBroadcast: true }),
      ).rejects.toThrow("TEST_CRASH_AFTER_BROADCAST");
      const [before] =
        await getSql()`select * from transaction_intents where id=${payload.actionId}`;
      expect(before.status).toBe("PREPARED");
      expect(before.tx_hash).toBe(keccak256(before.details.rawTransaction));
      expect(
        doubles.sendRawTransaction.mock.calls[0][0].serializedTransaction,
      ).toBe(before.details.rawTransaction);
      const result = await executeFundingHold(payload);
      const [after] =
        await getSql()`select * from transaction_intents where id=${payload.actionId}`;
      expect(after.details.rawTransaction).toBe(before.details.rawTransaction);
      expect(after.details.nonce).toBe(before.details.nonce);
      expect(result.hash).toBe(before.tx_hash);
      expect(doubles.signTransaction).toHaveBeenCalledTimes(1);
      expect(doubles.getTransactionCount).toHaveBeenCalledTimes(1);
      expect(
        doubles.sendRawTransaction.mock.calls[1][0].serializedTransaction,
      ).toBe(before.details.rawTransaction);
    });
    it("serializes two concurrent agent actions with distinct nonces", async () => {
      const first = await setup(),
        second = await setup();
      await Promise.all([
        executeFundingHold(first),
        executeFundingHold(second),
      ]);
      const intents =
        await getSql()`select * from transaction_intents where id in (${first.actionId},${second.actionId}) order by (details->>'nonce')::int`;
      expect(intents).toHaveLength(2);
      expect(intents[1].details.nonce).toBe(intents[0].details.nonce + 1);
      expect(doubles.signTransaction).toHaveBeenCalledTimes(2);
    });
    it("duplicate concurrent action reserves and signs only one immutable transaction", async () => {
      const payload = await setup();
      const results = await Promise.all([
        executeFundingHold(payload),
        executeFundingHold(payload),
      ]);
      expect(results[0].hash).toBe(results[1].hash);
      expect(doubles.signTransaction).toHaveBeenCalledTimes(1);
      expect(
        (
          await getSql()`select id from transaction_intents where id=${payload.actionId}`
        ).length,
      ).toBe(1);
      for (const [call] of doubles.sendRawTransaction.mock.calls)
        expect(keccak256(call.serializedTransaction)).toBe(results[0].hash);
    });
    it("cannot reuse an old action ID for another claim, role or payload", async () => {
      const payload = await setup();
      await executeFundingHold(payload);
      const other = await setup();
      await expect(
        executeFundingHold({ ...payload, claimId: other.claimId }),
      ).rejects.toThrow("HOLD_INTENT_SCOPE_MISMATCH");
      await expect(
        executeFundingHold({ ...payload, evidenceId: other.evidenceId }),
      ).rejects.toThrow("HOLD_INTENT_SCOPE_MISMATCH");
      await getSql()`update transaction_intents set actor_id='BORROWER' where id=${payload.actionId}`;
      await expect(executeFundingHold(payload)).rejects.toThrow(
        "HOLD_INTENT_SCOPE_MISMATCH",
      );
      expect(doubles.signTransaction).toHaveBeenCalledTimes(1);
    });
    it("revocation after prepare blocks unknown first broadcast, but already observed tx still reconciles", async () => {
      const payload = await setup();
      await expect(
        executeFundingHold(payload, { crashAfterBroadcast: true }),
      ).rejects.toThrow("TEST_CRASH_AFTER_BROADCAST");
      await getSql()`update attestations set revoked_at=now() where id=${payload.actionId}`;
      await expect(executeFundingHold(payload)).rejects.toThrow(
        "HOLD_NO_ATTRIBUTABLE_EVIDENCE",
      );
      expect(doubles.sendRawTransaction).toHaveBeenCalledTimes(1);
      doubles.getTransaction.mockResolvedValue({ hash: "already-broadcast" });
      expect((await executeFundingHold(payload)).status).toBe("CONFIRMED");
      expect(doubles.sendRawTransaction).toHaveBeenCalledTimes(1);
      expect(doubles.signTransaction).toHaveBeenCalledTimes(1);
    });
    it("uncertain RPC lookup never broadcasts an additional transaction", async () => {
      const payload = await setup();
      doubles.getTransaction.mockRejectedValueOnce(new Error("RPC_DOWN"));
      await expect(executeFundingHold(payload)).rejects.toThrow(
        "HOLD_RPC_LOOKUP_UNCERTAIN",
      );
      expect(doubles.sendRawTransaction).not.toHaveBeenCalled();
      expect(
        (
          await getSql()`select id from transaction_intents where id=${payload.actionId}`
        ).length,
      ).toBe(1);
    });
    it("a reverted transaction remains reverted and never signals completed hold", async () => {
      const payload = await setup();
      doubles.inspectObservedTransaction.mockResolvedValue({
        status: "REVERTED",
      });
      expect((await executeFundingHold(payload)).status).toBe("REVERTED");
      const [intent] =
        await getSql()`select * from transaction_intents where id=${payload.actionId}`;
      expect(intent.status).toBe("REVERTED");
    });
  },
);
