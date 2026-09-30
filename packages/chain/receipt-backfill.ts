import { randomUUID } from "node:crypto";
import { decodeEventLog, keccak256, type Abi, type Hex } from "viem";
import { getSql } from "../db";
import { registryAbi, vaultAbi, executorAbi } from "./contracts";
import { chainConfig, jsonSafe, publicClient } from "./config";
import { validateStartup } from "./service";

type RpcReply<T> = { id: number; result?: T; error?: { message?: string } };
type Header = {
  number: Hex;
  hash: Hex;
  parentHash: Hex;
  logsBloom: Hex;
};
type ReceiptLog = {
  address: Hex;
  blockHash: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  logIndex: Hex;
  data: Hex;
  topics: Hex[];
};
type Receipt = {
  blockHash: Hex;
  blockNumber: Hex;
  transactionIndex: Hex;
  transactionHash: Hex;
  logsBloom: Hex;
  logs: ReceiptLog[];
};
type BlockWithTransactions = Header & { transactions: Hex[] };

function backfillRpc() {
  return (
    process.env.RECEIPT_BACKFILL_RPC_HTTP_URL ??
    process.env.ARCHIVE_RPC_HTTP_URL ??
    process.env.RPC_FALLBACK_HTTP_URL ??
    chainConfig().rpc
  );
}

let preflightPromise: Promise<void> | undefined;
function preflight() {
  preflightPromise ??= (async () => {
    const c = chainConfig();
    const [reportedChainId] = await rpcBatch<Hex>(
      backfillRpc(),
      "eth_chainId",
      [[]],
    );
    if (Number(reportedChainId) !== c.chainId)
      throw new Error("RECEIPT_BACKFILL_WRONG_CHAIN");
    await validateStartup();
  })();
  return preflightPromise;
}

async function rpcBatch<T>(
  url: string,
  method: string,
  params: unknown[][],
): Promise<T[]> {
  if (params.length < 1 || params.length > 100)
    throw new Error("RECEIPT_BACKFILL_BATCH_LIMIT");
  const request = params.map((args, id) => ({
    jsonrpc: "2.0",
    id,
    method,
    params: args,
  }));
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`RECEIPT_BACKFILL_HTTP_${response.status}`);
  const replies = (await response.json()) as RpcReply<T>[];
  if (!Array.isArray(replies) || replies.length !== params.length)
    throw new Error("RECEIPT_BACKFILL_INCOMPLETE_BATCH");
  const ordered = new Array<T>(params.length);
  const seen = new Set<number>();
  for (const reply of replies) {
    if (
      !Number.isInteger(reply.id) ||
      reply.id < 0 ||
      reply.id >= params.length ||
      seen.has(reply.id) ||
      reply.error ||
      reply.result == null
    )
      throw new Error(
        `RECEIPT_BACKFILL_RPC_RESPONSE:${reply.error?.message?.slice(0, 80) ?? "INVALID"}`,
      );
    ordered[reply.id] = reply.result;
    seen.add(reply.id);
  }
  return ordered;
}

function bloomMayContain(bloom: Hex, address: Hex) {
  if (!/^0x[0-9a-fA-F]{512}$/.test(bloom))
    throw new Error("RECEIPT_BACKFILL_INVALID_BLOOM");
  const bytes = Buffer.from(bloom.slice(2), "hex");
  const hash = keccak256(address);
  for (let i = 0; i < 3; i++) {
    const bit = Number.parseInt(hash.slice(2 + i * 4, 6 + i * 4), 16) & 2047;
    if ((bytes[255 - (bit >> 3)] & (1 << (bit & 7))) === 0) return false;
  }
  return true;
}

export function assertCompleteReceipts(
  header: Header,
  block: BlockWithTransactions,
  receipts: Receipt[],
) {
  if (
    block.hash.toLowerCase() !== header.hash.toLowerCase() ||
    !Array.isArray(block.transactions) ||
    block.transactions.length !== receipts.length
  )
    throw new Error("RECEIPT_BACKFILL_TRANSACTION_COUNT_MISMATCH");
  const bloom = Buffer.alloc(256);
  const seen = new Set<number>();
  for (const receipt of receipts) {
    if (
      receipt.blockHash.toLowerCase() !== header.hash.toLowerCase() ||
      BigInt(receipt.blockNumber) !== BigInt(header.number)
    )
      throw new Error("RECEIPT_BACKFILL_RECEIPT_BLOCK_MISMATCH");
    const index = Number(receipt.transactionIndex);
    if (
      !Number.isSafeInteger(index) ||
      seen.has(index) ||
      block.transactions[index]?.toLowerCase() !==
        receipt.transactionHash.toLowerCase()
    )
      throw new Error("RECEIPT_BACKFILL_RECEIPT_INDEX_MISMATCH");
    seen.add(index);
    if (!/^0x[0-9a-fA-F]{512}$/.test(receipt.logsBloom))
      throw new Error("RECEIPT_BACKFILL_INVALID_BLOOM");
    const source = Buffer.from(receipt.logsBloom.slice(2), "hex");
    for (let i = 0; i < bloom.length; i++) bloom[i] |= source[i];
    for (const log of receipt.logs)
      if (
        log.blockHash.toLowerCase() !== header.hash.toLowerCase() ||
        BigInt(log.blockNumber) !== BigInt(header.number)
      )
        throw new Error("RECEIPT_BACKFILL_LOG_BLOCK_MISMATCH");
  }
  for (let i = 0; i < receipts.length; i++)
    if (!seen.has(i)) throw new Error("RECEIPT_BACKFILL_RECEIPT_INDEX_GAP");
  if (`0x${bloom.toString("hex")}` !== header.logsBloom.toLowerCase())
    throw new Error("RECEIPT_BACKFILL_BLOCK_BLOOM_MISMATCH");
}

export async function readHeaders(url: string, from: bigint, to: bigint) {
  const batches: Promise<Header[]>[] = [];
  for (let n = from; n <= to; n += 100n) {
    const end = n + 99n < to ? n + 99n : to;
    const params: unknown[][] = [];
    for (let at = n; at <= end; at++) params.push([`0x${at.toString(16)}`]);
    batches.push(rpcBatch<Header>(url, "eth_getHeaderByNumber", params));
  }
  return (await Promise.all(batches)).flat();
}

export async function backfillReceiptsOnce() {
  const c = chainConfig();
  const url = backfillRpc();
  await preflight();
  const client = publicClient();
  const sql = getSql();
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(971313370)`;
    const [checkpoint] =
      await tx`SELECT block_number,block_hash FROM indexer_checkpoints WHERE chain_id=${c.chainId} FOR UPDATE`;
    if (!checkpoint) throw new Error("RECEIPT_BACKFILL_CHECKPOINT_MISSING");
    const previous = BigInt(checkpoint.block_number);
    if (previous < c.startBlock - 1n)
      throw new Error("RECEIPT_BACKFILL_INVALID_CHECKPOINT");
    const head = await client.getBlockNumber({ cacheTime: 0 });
    const confirmed = head - BigInt(c.confirmations) + 1n;
    // Keep the final window for the ordinary indexer, which rebuilds every
    // financial projection against a recent confirmed on-chain state.
    const recoveryTip = confirmed - 500n;
    const from = previous + 1n;
    if (from > recoveryTip)
      return {
        from: from.toString(),
        to: previous.toString(),
        events: 0,
        done: true,
      };
    const to = previous + 500n < recoveryTip ? previous + 500n : recoveryTip;
    const headers = await readHeaders(url, from, to);
    let parent = String(checkpoint.block_hash).toLowerCase();
    const addresses = [c.registry, c.vault, c.executor];
    const candidate: Header[] = [];
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      if (
        !header ||
        BigInt(header.number) !== from + BigInt(i) ||
        !/^0x[0-9a-fA-F]{64}$/.test(header.hash) ||
        header.parentHash.toLowerCase() !== parent
      )
        throw new Error("RECEIPT_BACKFILL_HEADER_GAP_OR_REORG");
      parent = header.hash.toLowerCase();
      if (
        addresses.some((address) => bloomMayContain(header.logsBloom, address))
      )
        candidate.push(header);
    }
    const receiptsByBlock = await Promise.all(
      candidate.map(async (header) => {
        const [[block], [receipts]] = await Promise.all([
          rpcBatch<BlockWithTransactions>(url, "eth_getBlockByNumber", [
            [header.number, false],
          ]),
          rpcBatch<Receipt[]>(url, "eth_getBlockReceipts", [[header.number]]),
        ]);
        if (!Array.isArray(receipts))
          throw new Error("RECEIPT_BACKFILL_RECEIPTS_MISSING");
        assertCompleteReceipts(header, block, receipts);
        return receipts;
      }),
    );
    const rows = headers.map((header) => ({
      chain_id: c.chainId,
      block_number: BigInt(header.number).toString(),
      block_hash: header.hash,
    }));
    await tx`INSERT INTO chain_blocks ${tx(rows)} ON CONFLICT(chain_id,block_number) DO UPDATE SET block_hash=excluded.block_hash`;
    await tx`UPDATE chain_events SET canonical=false WHERE chain_id=${c.chainId} AND block_number>=${from.toString()} AND block_number<=${to.toString()}`;
    let events = 0;
    for (let i = 0; i < candidate.length; i++) {
      const header = candidate[i];
      for (const receipt of receiptsByBlock[i]) {
        for (const log of receipt.logs) {
          const emittingAddress = log.address.toLowerCase();
          if (
            !addresses.includes(emittingAddress as (typeof addresses)[number])
          )
            continue;
          const abi: Abi =
            emittingAddress === c.registry
              ? registryAbi
              : emittingAddress === c.vault
                ? vaultAbi
                : executorAbi;
          let decoded;
          try {
            decoded = decodeEventLog({
              abi,
              data: log.data,
              topics: log.topics as [Hex, ...Hex[]],
            });
          } catch {
            continue;
          }
          if (!decoded.eventName) continue;
          const args = jsonSafe(decoded.args) as unknown as Record<
            string,
            unknown
          >;
          await tx`INSERT INTO chain_events(id,chain_id,tx_hash,log_index,block_number,block_hash,contract_address,claim_key,event_name,args,canonical) VALUES(${`${c.chainId}:${log.transactionHash}:${Number(log.logIndex)}`},${c.chainId},${log.transactionHash},${Number(log.logIndex)},${BigInt(header.number).toString()},${header.hash},${emittingAddress},${args.claimKey ? String(args.claimKey) : null},${decoded.eventName},${tx.json(args as never)},true) ON CONFLICT(chain_id,tx_hash,log_index) DO UPDATE SET canonical=true,block_hash=excluded.block_hash,block_number=excluded.block_number,contract_address=excluded.contract_address,args=excluded.args`;
          events++;
        }
      }
    }
    const last = headers[headers.length - 1];
    // This cursor is verified but financial projections remain unavailable
    // until indexOnce validates them against current contract state.
    await tx`UPDATE indexer_checkpoints SET block_number=${to.toString()},block_hash=${last.hash},degraded=true,updated_at=now() WHERE chain_id=${c.chainId}`;
    await tx`INSERT INTO worker_heartbeats(id,status,error_code) VALUES('indexer','DEGRADED','RECEIPT_BACKFILL') ON CONFLICT(id) DO UPDATE SET status='DEGRADED',error_code='RECEIPT_BACKFILL',updated_at=now()`;
    await tx`INSERT INTO audit_events(id,actor_id,action,target,correlation_id,details) VALUES(${randomUUID()},'INDEXER','CHAIN_RECEIPT_BACKFILL',${String(c.chainId)},${randomUUID()},${tx.json({ from: from.toString(), to: to.toString(), candidateBlocks: candidate.length, events } as never)})`;
    return {
      from: from.toString(),
      to: to.toString(),
      candidateBlocks: candidate.length,
      events,
      done: false,
    };
  });
}
