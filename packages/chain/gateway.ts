import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  toHex,
  decodeFunctionData,
  TransactionNotFoundError,
  type Hex,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { getSql, type DbTransaction } from "../db";
import { chainConfig, publicClient, jsonSafe } from "./config";
import { executorAbi, registryAbi } from "./contracts";
import { inspectObservedTransaction, validateStartup } from "./service";
const HoldSchema = z
  .object({
    claimId: z.string().uuid(),
    version: z.number().int().positive(),
    evidenceId: z.string().uuid(),
    actionId: z.string().uuid(),
    reason: z.string().min(5).max(2000),
  })
  .strict();
export type HoldInput = z.infer<typeof HoldSchema>;
async function validateFreshEvidence(tx: DbTransaction, payload: HoldInput) {
  const [claim] =
    await tx`SELECT * FROM claims WHERE id=${payload.claimId} FOR UPDATE`;
  if (!claim || claim.version !== payload.version || !claim.has_dispute)
    throw new Error("HOLD_STALE_OR_NO_DISPUTE");
  const [attestation] =
    await tx`SELECT * FROM attestations WHERE id=${payload.actionId} AND claim_id=${payload.claimId} AND version=${payload.version} AND kind='DISPUTE' AND method='AUTHENTICATED_DISPUTE' AND status='ATTESTED' AND revoked_at IS NULL AND expires_at>now()`;
  if (!attestation || !attestation.evidence_ids.includes(payload.evidenceId))
    throw new Error("HOLD_NO_ATTRIBUTABLE_EVIDENCE");
  const [doc] =
    await tx`SELECT id,commitment FROM documents WHERE id=${payload.evidenceId} AND claim_id=${payload.claimId}`;
  const [audit] =
    await tx`SELECT id FROM audit_events WHERE action='DISPUTE_RECORDED' AND target=${payload.claimId} AND actor_id=${attestation.actor_id} AND details->>'actionId'=${payload.actionId}`;
  const authorities =
    await tx`SELECT organization_id,role FROM memberships WHERE user_id=${attestation.actor_id} AND approved=true`;
  if (
    !doc ||
    !audit ||
    !authorities.some(
      (m) =>
        m.role === "VERIFIER" ||
        (m.role === "BUYER" && m.organization_id === claim.buyer_org_id) ||
        (m.role === "BORROWER" && m.organization_id === claim.org_id),
    )
  )
    throw new Error("HOLD_AUTHORIZATION_FAILED");
  return { claim, doc };
}
/** No arbitrary target, calldata, recipient, monetary amount or model opinion is accepted. */
export async function executeFundingHold(
  input: HoldInput,
  options: { crashAfterBroadcast?: boolean } = {},
) {
  const payload = HoldSchema.parse(input),
    c = chainConfig(),
    client = publicClient(),
    sql = getSql();
  await validateStartup();
  const key = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("AGENT_SIGNER_UNAVAILABLE");
  const account = privateKeyToAccount(key);
  if (c.chainId === 97) {
    for (let i = 0; i < 10; i++)
      if (
        account.address ===
        mnemonicToAccount(
          "test test test test test test test test test test test junk",
          { addressIndex: i },
        ).address
      )
        throw new Error("PUBLIC_ANVIL_KEY_FORBIDDEN_ON_TESTNET");
  }
  if (
    !(await client.readContract({
      address: c.executor,
      abi: executorAbi,
      functionName: "hasRole",
      args: [keccak256(toHex("AGENT_ROLE")), account.address],
    }))
  )
    throw new Error("AGENT_ROLE_MISSING");
  const wallet = createWalletClient({
    account,
    chain: c.chain,
    transport: http(c.rpc, { timeout: 10000, retryCount: 0 }),
  });
  const intent = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-nonce:${c.chainId}:${account.address}`},0))`;
    const old =
      await tx`SELECT * FROM transaction_intents WHERE id=${payload.actionId}`;
    if (old.length) {
      const previous = old[0];
      if (
        previous.claim_id !== payload.claimId ||
        previous.actor_id !== "AGENT" ||
        previous.sender !== account.address.toLowerCase() ||
        !["proposeFundingHold", "recordRiskObservation"].includes(
          previous.action,
        ) ||
        previous.template.to.toLowerCase() !== c.executor ||
        previous.template.from.toLowerCase() !==
          account.address.toLowerCase() ||
        previous.template.chainId !== c.chainId ||
        previous.details?.holdPayloadHash !==
          keccak256(toHex(JSON.stringify(payload))) ||
        !previous.details.rawTransaction ||
        keccak256(previous.details.rawTransaction) !== previous.tx_hash
      )
        throw new Error("HOLD_INTENT_SCOPE_MISMATCH");
      const decoded = decodeFunctionData({
        abi: executorAbi,
        data: previous.template.data,
      });
      if (
        decoded.functionName !== previous.action ||
        !decoded.args ||
        decoded.args[1] !== keccak256(toHex(payload.actionId)) ||
        decoded.args[2] !== previous.details.evidenceCommitment
      )
        throw new Error("HOLD_INTENT_SCOPE_MISMATCH");
      const [subject] =
        await tx`SELECT claim_key FROM claims WHERE id=${payload.claimId}`;
      if (!subject || decoded.args[0] !== subject.claim_key)
        throw new Error("HOLD_INTENT_SCOPE_MISMATCH");
      return previous;
    }
    const { claim, doc } = await validateFreshEvidence(tx, payload);
    const registered = await client.readContract({
      address: c.registry,
      abi: registryAbi,
      functionName: "getClaim",
      args: [claim.claim_key],
    });
    if (Number(registered[2]) === 0)
      throw new Error("HOLD_AWAITS_REGISTRATION");
    const functionName =
      Number(registered[2]) === 2
        ? "recordRiskObservation"
        : "proposeFundingHold";
    const commitment = keccak256(
      toHex(
        JSON.stringify({
          actionId: payload.actionId,
          claimKey: claim.claim_key,
          version: payload.version,
          evidenceCommitment: doc.commitment,
        }),
      ),
    );
    const actionId = keccak256(toHex(payload.actionId));
    const args = [claim.claim_key, actionId, commitment] as const;
    await client.simulateContract({
      address: c.executor,
      abi: executorAbi,
      functionName,
      args,
      account,
    });
    const data = encodeFunctionData({ abi: executorAbi, functionName, args });
    const pending = await client.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });
    const [reserved] =
      await tx`SELECT max((details->>'nonce')::bigint) AS nonce FROM transaction_intents WHERE actor_id='AGENT' AND sender=${account.address.toLowerCase()} AND template->>'chainId'=${String(c.chainId)} AND details ? 'rawTransaction'`;
    const nonce = Math.max(
      pending,
      reserved?.nonce === null ? 0 : Number(reserved.nonce) + 1,
    );
    const request = await wallet.prepareTransactionRequest({
      to: c.executor,
      data,
      value: 0n,
      nonce,
    });
    const rawTransaction = await wallet.signTransaction(request),
      txHash = keccak256(rawTransaction);
    const template = {
      chainId: c.chainId,
      from: account.address,
      to: c.executor,
      data,
      value: "0",
    };
    const [saved] =
      await tx`INSERT INTO transaction_intents(id,claim_id,actor_id,sender,action,status,template,tx_hash,details) VALUES(${payload.actionId},${payload.claimId},'AGENT',${account.address.toLowerCase()},${functionName},'PREPARED',${tx.json(template)},${txHash},${tx.json(jsonSafe({ rawTransaction, nonce, actionId, evidenceCommitment: commitment, holdPayloadHash: keccak256(toHex(JSON.stringify(payload))) }))}) RETURNING *`;
    return saved;
  });
  // Reconcile broadcasts already observed onchain even if evidence was revoked meanwhile.
  // If no transaction is known, re-check authorization and freshness under the claim lock
  // before broadcasting the previously committed bytes. No retry ever creates a new nonce.
  let transactionKnown = false;
  try {
    await client.getTransaction({ hash: intent.tx_hash });
    transactionKnown = true;
  } catch (error) {
    if (!(error instanceof TransactionNotFoundError))
      throw new Error("HOLD_RPC_LOOKUP_UNCERTAIN");
  }
  let status = "SUBMITTED";
  if (!transactionKnown && !["CONFIRMED", "REVERTED"].includes(intent.status)) {
    try {
      await sql.begin(async (tx) => {
        await validateFreshEvidence(tx, payload);
        const decoded = decodeFunctionData({
          abi: executorAbi,
          data: intent.template.data,
        });
        if (
          decoded.functionName !== "proposeFundingHold" &&
          decoded.functionName !== "recordRiskObservation"
        )
          throw new Error("HOLD_INTENT_SCOPE_MISMATCH");
        const args = [
          decoded.args[0],
          decoded.args[1],
          decoded.args[2],
        ] as const;
        await client.simulateContract({
          address: c.executor,
          abi: executorAbi,
          functionName: decoded.functionName,
          args,
          account,
        });
        try {
          await wallet.sendRawTransaction({
            serializedTransaction: intent.details.rawTransaction,
          });
        } catch {
          status = "DROPPED_OR_UNKNOWN";
        }
      });
    } catch (error) {
      if (intent.status === "PREPARED") throw error;
      // A previously submitted transaction may still surface later. Keep reconciling;
      // revoked evidence cannot authorize another broadcast.
      status = "DROPPED_OR_UNKNOWN";
    }
  }
  if (options.crashAfterBroadcast)
    throw new Error("TEST_CRASH_AFTER_BROADCAST");
  const observed = await inspectObservedTransaction({
    hash: intent.tx_hash,
    sender: account.address,
    template: intent.template,
  });
  status = String(observed.status ?? status);
  await sql.begin(async (tx) => {
    await tx`UPDATE transaction_intents SET status=${status},details=details||${tx.json(observed as never)},updated_at=now() WHERE id=${intent.id}`;
    await tx`INSERT INTO audit_events(id,actor_id,action,target,correlation_id,details) VALUES(${randomUUID()},'AGENT','AGENT_HOLD_TRANSACTION',${payload.claimId},${payload.actionId},${tx.json({ intentId: intent.id, hash: intent.tx_hash, status })})`;
  });
  return { intentId: intent.id, hash: intent.tx_hash, status };
}
