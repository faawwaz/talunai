import { randomUUID } from "node:crypto";
import { decodeEventLog, type Abi, type Hex } from "viem";
import { getSql, type DbTransaction } from "../db/index";
import { waterfall } from "../domain/finance";
import { registryAbi, vaultAbi, executorAbi } from "./contracts";
import { chainConfig, jsonSafe, publicClient } from "./config";
import { readHeaders } from "./receipt-backfill";
import { inspectObservedTransaction, validateStartup } from "./service";

async function auditReorg(sql: DbTransaction, from: bigint, to: bigint) {
  await sql`INSERT INTO audit_events(id,actor_id,action,target,correlation_id,details) VALUES(${randomUUID()},'INDEXER','CHAIN_REORG_REVERSAL',${String(chainConfig().chainId)},${randomUUID()},${sql.json({ from: from.toString(), to: to.toString() } as never)})`;
}
/** Reconcile pending disputed registrations after canonical chain projection.
 * A fresh outbox row is allowed after a quiet minute so exhausted jobs or a
 * crashed worker recover; the action ID remains fixed for chain idempotency.
 */
export async function enqueueUnheldDisputeHolds(
  tx: DbTransaction,
  chainId: number,
) {
  await tx`INSERT INTO outbox(id,type,payload)
    SELECT gen_random_uuid()::text,'FUNDING_HOLD',
      jsonb_build_object(
        'claimId',c.id,'version',c.version,'evidenceId',a.evidence_ids->>0,
        'actionId',a.id,'reason',coalesce(
          (SELECT old.payload->>'reason' FROM outbox old
            WHERE old.type='FUNDING_HOLD' AND old.payload->>'actionId'=a.id
            ORDER BY old.created_at LIMIT 1),
          audit.details->>'reason','Invoice evidence disputed'))
    FROM claims c
    JOIN financial_projections fp ON fp.claim_key=c.claim_key AND fp.chain_id=${chainId}
    JOIN LATERAL (
      SELECT candidate.* FROM attestations candidate
      WHERE candidate.claim_id=c.id AND candidate.version=c.version
        AND candidate.kind='DISPUTE' AND candidate.method='AUTHENTICATED_DISPUTE'
        AND candidate.status='ATTESTED' AND candidate.revoked_at IS NULL
        AND candidate.expires_at>now()
      ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1
    ) a ON true
    JOIN audit_events audit ON audit.action='DISPUTE_RECORDED'
      AND audit.target=c.id AND audit.actor_id=a.actor_id
      AND audit.details->>'actionId'=a.id
    WHERE c.has_dispute=true AND fp.state->>'registryStatus'='AVAILABLE'
      AND fp.state->>'fundingHold'='false'
      AND fp.state->>'stateConfidence'='CONFIRMED_PROJECTION'
      AND NOT EXISTS(SELECT 1 FROM outbox recent
        WHERE recent.type='FUNDING_HOLD'
          AND recent.payload->>'actionId'=a.id
          AND recent.created_at>now()-interval '60 seconds')`;
}
export async function markDegraded(reason: string) {
  const c = chainConfig(),
    sql = getSql();
  await sql`INSERT INTO indexer_checkpoints(chain_id,block_number,block_hash,degraded) VALUES(${c.chainId},${(c.startBlock - 1n).toString()},'0x',true) ON CONFLICT(chain_id) DO UPDATE SET degraded=true,updated_at=now()`;
  await sql`INSERT INTO worker_heartbeats(id,status,error_code) VALUES('indexer','DEGRADED',${reason}) ON CONFLICT(id) DO UPDATE SET status='DEGRADED',error_code=excluded.error_code,updated_at=now()`;
}
async function rebuildProjection(
  tx: DbTransaction,
  tip: bigint,
  hash: Hex,
  timestamp: bigint,
) {
  const c = chainConfig(),
    client = publicClient();
  const registered =
    await tx`SELECT DISTINCT claim_key FROM chain_events WHERE chain_id=${c.chainId} AND canonical=true AND event_name='ClaimRegistered'`;
  const keys = registered.map((r) => String(r.claim_key));
  // Event projection rebuild is inside the same transaction as canonical event/checkpoint changes.
  await tx`DELETE FROM financial_projections WHERE chain_id=${c.chainId}`;
  for (const key of keys) {
    const terms = await client.readContract({
      address: c.registry,
      abi: registryAbi,
      functionName: "getTerms",
      args: [key as Hex],
      blockNumber: tip,
    });
    const events =
      await tx`SELECT event_name,args FROM chain_events WHERE chain_id=${c.chainId} AND claim_key=${key} AND canonical=true ORDER BY block_number,log_index`;
    let funded = false,
      hold = false,
      cancelled = false,
      total = 0n,
      lw = 0n,
      bw = 0n,
      lender: string | null = null;
    for (const event of events) {
      const a = event.args;
      switch (event.event_name) {
        case "Funded":
          if (funded) throw new Error("DUPLICATE_FUNDING_EVENT");
          funded = true;
          lender = a.lender;
          break;
        case "FundingHoldSet":
          hold = true;
          break;
        case "FundingHoldCleared":
          hold = false;
          break;
        case "ClaimCancelled":
          cancelled = true;
          break;
        case "BuyerPaymentCollected":
          total += BigInt(a.amount);
          if (total !== BigInt(a.totalCollected))
            throw new Error("COLLECTION_EVENT_GAP");
          break;
        case "LenderWithdrawal":
          lw += BigInt(a.amount);
          break;
        case "BorrowerWithdrawal":
          bw += BigInt(a.amount);
          break;
      }
    }
    const amounts = waterfall({
      principal: terms.principal.toString(),
      fixedFee: terms.fee.toString(),
      acceptedOutstanding: terms.acceptedOutstanding.toString(),
      totalCollected: total.toString(),
      lenderWithdrawn: lw.toString(),
      borrowerWithdrawn: bw.toString(),
      funded,
    });
    const state = {
      chainId: c.chainId,
      isSynthetic: true,
      paymentToken: { address: c.token, symbol: "MockIDR", decimals: 0 },
      borrower: terms.borrower,
      buyer: terms.buyer,
      lender,
      acceptedOutstanding: terms.acceptedOutstanding.toString(),
      principal: terms.principal.toString(),
      fixedFee: terms.fee.toString(),
      totalCollected: total.toString(),
      lenderWithdrawn: lw.toString(),
      borrowerWithdrawn: bw.toString(),
      ...amounts,
      fundingHold: hold,
      registryStatus: cancelled ? "CANCELLED" : funded ? "FUNDED" : "AVAILABLE",
      financingOverdue:
        funded &&
        timestamp > terms.invoiceDueAt &&
        BigInt(amounts.lenderOutstanding) > 0n,
      invoiceOverdue:
        timestamp > terms.invoiceDueAt &&
        BigInt(amounts.remainingInvoiceCollection) > 0n,
      stateConfidence: "CONFIRMED_PROJECTION",
      confirmedBlock: tip.toString(),
      confirmedBlockHash: hash,
    };
    const onchain = await client.readContract({
      address: c.vault,
      abi: vaultAbi,
      functionName: "getDeal",
      args: [key as Hex],
      blockNumber: tip,
    });
    if (
      onchain.totalCollected !== total ||
      onchain.lenderWithdrawn !== lw ||
      onchain.borrowerWithdrawn !== bw ||
      onchain.funded !== funded
    )
      throw new Error("PROJECTION_RECONCILIATION_MISMATCH");
    const registryState = await client.readContract({
      address: c.registry,
      abi: registryAbi,
      functionName: "getClaim",
      args: [key as Hex],
      blockNumber: tip,
    });
    if (
      Number(registryState[2]) !== (cancelled ? 3 : funded ? 2 : 1) ||
      registryState[3] !== hold ||
      (funded && onchain.lender.toLowerCase() !== lender?.toLowerCase())
    )
      throw new Error("PROJECTION_RECONCILIATION_MISMATCH");
    await tx`INSERT INTO financial_projections(claim_key,chain_id,state,block_number,block_hash) VALUES(${key},${c.chainId},${tx.json(state as never)},${tip.toString()},${hash})`;
    await tx`UPDATE claims SET workflow=${cancelled ? "CANCELLED" : "REGISTERED"},funding_hold=${hold},updated_at=now() WHERE claim_key=${key}`;
  }
  if (keys.length)
    await tx`UPDATE claims SET workflow='REGISTRATION_PENDING',funding_hold=false WHERE workflow IN ('REGISTERED','CANCELLED') AND claim_key NOT IN ${tx(keys)}`;
  else
    await tx`UPDATE claims SET workflow='REGISTRATION_PENDING',funding_hold=false WHERE workflow IN ('REGISTERED','CANCELLED')`;
  await enqueueUnheldDisputeHolds(tx, c.chainId);
}
let validatedDeployment: string | null = null;
let validatedAt = 0;
async function validateIndexerDeployment() {
  const c = chainConfig();
  const fingerprint = JSON.stringify([
    c.chainId,
    c.registry,
    c.vault,
    c.executor,
    c.token,
    c.rpc,
    process.env.RPC_FALLBACK_HTTP_URL ?? "",
  ]);
  if (
    fingerprint === validatedDeployment &&
    Date.now() - validatedAt < 300_000
  ) {
    if ((await publicClient().getChainId()) !== c.chainId)
      throw new Error("RPC_CHAIN_MISMATCH");
    return;
  }
  // Startup checks include code and endpoint wiring. Re-running their many
  // RPC calls on every two-second index tick caused the checkpoint to lag.
  // Each tick still verifies both providers' confirmed block hashes below.
  await validateStartup();
  validatedDeployment = fingerprint;
  validatedAt = Date.now();
}

export async function indexOnce(options: { crashBeforeCommit?: boolean } = {}) {
  const c = chainConfig(),
    client = publicClient(),
    sql = getSql();
  try {
    await validateIndexerDeployment();
    return await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(971313370)`;
      const head = await client.getBlockNumber({ cacheTime: 0 });
      const tip = head - BigInt(c.confirmations) + 1n;
      if (tip < c.startBlock)
        return { head: head.toString(), tip: tip.toString(), events: 0 };
      const [checkpoint] =
        await tx`SELECT * FROM indexer_checkpoints WHERE chain_id=${c.chainId} FOR UPDATE`;
      // Deep reorg is sticky: an operator must rebuild after investigating the RPC/deployment.
      const [heartbeat] =
        await tx`SELECT error_code FROM worker_heartbeats WHERE id='indexer'`;
      if (heartbeat?.error_code === "REORG_BEYOND_RECOVERY")
        throw new Error("REORG_BEYOND_RECOVERY");
      let previous = checkpoint
        ? BigInt(checkpoint.block_number)
        : c.startBlock - 1n;
      const floor =
        previous - BigInt(c.rescan) > c.startBlock
          ? previous - BigInt(c.rescan)
          : c.startBlock;
      let rewind: bigint | null = null;
      if (checkpoint && previous >= c.startBlock) {
        let canonical: Hex | null = null;
        if (previous <= head)
          canonical = (await client.getBlock({ blockNumber: previous })).hash;
        if (canonical !== checkpoint.block_hash) {
          const headers =
            await tx`SELECT block_number,block_hash FROM chain_blocks WHERE chain_id=${c.chainId} AND block_number>=${floor.toString()} ORDER BY block_number DESC`;
          for (const header of headers) {
            const n = BigInt(header.block_number);
            if (n > head) continue;
            if (
              (await client.getBlock({ blockNumber: n })).hash ===
              header.block_hash
            ) {
              rewind = n;
              break;
            }
          }
          if (rewind === null) {
            if (floor === c.startBlock) rewind = c.startBlock - 1n;
            else throw new Error("REORG_BEYOND_RECOVERY");
          }
          await auditReorg(tx, previous, rewind);
          await tx`UPDATE chain_events SET canonical=false WHERE chain_id=${c.chainId} AND block_number>${rewind.toString()}`;
          await tx`DELETE FROM chain_blocks WHERE chain_id=${c.chainId} AND block_number>${rewind.toString()}`;
          previous = rewind;
        }
      }
      const from =
        previous - BigInt(c.rescan) + 1n > c.startBlock
          ? previous - BigInt(c.rescan) + 1n
          : c.startBlock;
      const to = tip > previous + 500n ? previous + 500n : tip;
      if (to < from) throw new Error("REORG_BEYOND_RECOVERY");
      const logs = await client.getLogs({
        address: [c.registry, c.vault, c.executor],
        fromBlock: from,
        toBlock: to,
      });
      // Overlap rescanning replaces canonical membership, including vanished logs.
      await tx`UPDATE chain_events SET canonical=false WHERE chain_id=${c.chainId} AND block_number>=${from.toString()} AND block_number<=${to.toString()}`;
      let count = 0;
      for (const log of logs) {
        if (
          !log.blockHash ||
          log.blockNumber === null ||
          !log.transactionHash ||
          log.logIndex === null
        )
          continue;
        const abi: Abi =
          log.address.toLowerCase() === c.registry
            ? registryAbi
            : log.address.toLowerCase() === c.vault
              ? vaultAbi
              : executorAbi;
        let decoded;
        try {
          decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
        } catch {
          continue;
        }
        if (!decoded.eventName) continue;
        const args = jsonSafe(decoded.args) as unknown as Record<
          string,
          unknown
        >;
        await tx`INSERT INTO chain_events(id,chain_id,tx_hash,log_index,block_number,block_hash,contract_address,claim_key,event_name,args,canonical) VALUES(${`${c.chainId}:${log.transactionHash}:${log.logIndex}`},${c.chainId},${log.transactionHash},${log.logIndex},${log.blockNumber.toString()},${log.blockHash},${log.address.toLowerCase()},${args.claimKey ? String(args.claimKey) : null},${decoded.eventName},${tx.json(args as never)},true) ON CONFLICT(chain_id,tx_hash,log_index) DO UPDATE SET canonical=true,block_hash=excluded.block_hash,block_number=excluded.block_number,contract_address=excluded.contract_address,args=excluded.args`;
        count++;
      }
      const block = await client.getBlock({ blockNumber: to });
      const headerNumbers: bigint[] = [];
      for (
        let n =
          to - BigInt(c.rescan) > c.startBlock
            ? to - BigInt(c.rescan)
            : c.startBlock;
        n <= to;
        n++
      )
        headerNumbers.push(n);
      const headers: Array<{
        chain_id: number;
        block_number: string;
        block_hash: Hex;
      }> = [];
      if (c.chainId === 97 && process.env.RPC_FALLBACK_HTTP_URL) {
        const fetched = await readHeaders(
          process.env.RPC_FALLBACK_HTTP_URL,
          headerNumbers[0],
          to,
        );
        for (let i = 0; i < fetched.length; i++) {
          const header = fetched[i];
          if (
            BigInt(header.number) !== headerNumbers[i] ||
            (i > 0 &&
              header.parentHash.toLowerCase() !==
                fetched[i - 1].hash.toLowerCase())
          )
            throw new Error("INDEXER_HEADER_GAP_OR_REORG");
          headers.push({
            chain_id: c.chainId,
            block_number: headerNumbers[i].toString(),
            block_hash: header.hash,
          });
        }
        if (fetched[fetched.length - 1].hash !== block.hash)
          throw new Error("RPC_CANONICAL_CONFLICT");
      } else {
        // Local Anvil and deployments without an independent RPC still verify
        // each header with bounded concurrency.
        for (let i = 0; i < headerNumbers.length; i += 8) {
          const numbers = headerNumbers.slice(i, i + 8);
          const blocks = await Promise.all(
            numbers.map((n) =>
              n === to
                ? Promise.resolve(block)
                : client.getBlock({ blockNumber: n }),
            ),
          );
          headers.push(
            ...blocks.map((b, index) => ({
              chain_id: c.chainId,
              block_number: numbers[index].toString(),
              block_hash: b.hash,
            })),
          );
        }
      }
      await tx`INSERT INTO chain_blocks ${tx(headers)} ON CONFLICT(chain_id,block_number) DO UPDATE SET block_hash=excluded.block_hash`;
      if ((await client.getBlock({ blockNumber: to })).hash !== block.hash)
        throw new Error("CHAIN_CHANGED_DURING_SCAN");
      await rebuildProjection(tx, to, block.hash!, block.timestamp);
      if ((await client.getBlock({ blockNumber: to })).hash !== block.hash)
        throw new Error("CHAIN_CHANGED_DURING_SCAN");
      if (options.crashBeforeCommit)
        throw new Error("TEST_CRASH_BEFORE_PROJECTION_COMMIT");
      await tx`INSERT INTO indexer_checkpoints(chain_id,block_number,block_hash,degraded) VALUES(${c.chainId},${to.toString()},${block.hash},false) ON CONFLICT(chain_id) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash,degraded=false,updated_at=now()`;
      await tx`INSERT INTO worker_heartbeats(id,status) VALUES('indexer','READY') ON CONFLICT(id) DO UPDATE SET status='READY',error_code=null,updated_at=now()`;
      return {
        head: head.toString(),
        tip: to.toString(),
        events: count,
        reorg: rewind !== null,
      };
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "INDEXER_FAILED";
    await markDegraded(
      reason.startsWith("TEST_") ? "INTERRUPTED" : reason.slice(0, 100),
    );
    throw error;
  }
}
export async function reconcileIntents() {
  const sql = getSql(),
    c = chainConfig();
  const [checkpoint] =
    await sql`SELECT block_number FROM indexer_checkpoints WHERE chain_id=${c.chainId}`;
  const floor = checkpoint
    ? BigInt(checkpoint.block_number) > BigInt(c.rescan)
      ? BigInt(checkpoint.block_number) - BigInt(c.rescan)
      : 0n
    : 0n;
  // Confirmed receipts older than the indexer's reorg window retain their
  // canonical evidence in DB. Polling every historic receipt each tick made
  // the worker lag, and deep reorgs already fail closed in indexOnce.
  const intents = await sql`SELECT * FROM transaction_intents
    WHERE tx_hash IS NOT NULL
      AND status IN ('PREPARED','SUBMITTED','MINED','DROPPED_OR_UNKNOWN','CONFIRMED')
      AND (status<>'CONFIRMED' OR
        CASE WHEN details->>'blockNumber' ~ '^[0-9]+$'
          THEN (details->>'blockNumber')::numeric >= ${floor.toString()}::numeric
          ELSE true END)
    ORDER BY updated_at ASC,id LIMIT 100`;
  // Many confirmed intents can exist in a live workspace. Bound independent
  // observations so one slow RPC cannot postpone the indexer heartbeat.
  for (let i = 0; i < intents.length; i += 8) {
    await Promise.all(
      intents.slice(i, i + 8).map(async (intent) => {
        const result = await inspectObservedTransaction({
          hash: intent.tx_hash as Hex,
          sender: intent.sender,
          template: intent.template,
        });
        // A replacement may have been attached while the RPC read was in
        // flight. Never erase parent/child history with a stale observation.
        await sql`UPDATE transaction_intents SET status=${String(result.status)},details=COALESCE(details,'{}'::jsonb)||${sql.json(result as never)},updated_at=now() WHERE id=${intent.id} AND tx_hash=${intent.tx_hash} AND status<>'REPLACED'`;
      }),
    );
  }
}
