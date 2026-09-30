import postgres from "postgres";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";

const rpc = process.env.ARCHIVE_RPC_HTTP_URL ?? process.env.RPC_HTTP_URL;
if (!rpc || !process.env.DATABASE_URL)
  throw new Error("RPC_OR_DATABASE_MISSING");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const [checkpoint] =
    await sql`SELECT block_number,block_hash FROM indexer_checkpoints WHERE chain_id=97`;
  if (!checkpoint) throw new Error("INDEXER_CHECKPOINT_MISSING");
  const client = createPublicClient({
    chain: bscTestnet,
    transport: http(rpc, { timeout: 15_000, retryCount: 0 }),
  });
  const chainId = await client.getChainId();
  if (chainId !== 97) throw new Error("ARCHIVE_RPC_WRONG_CHAIN");
  const fromBlock = BigInt(checkpoint.block_number) + 1n;
  const toBlock = fromBlock + 9n;
  const block = await client.getBlock({
    blockNumber: BigInt(checkpoint.block_number),
  });
  if (block.hash.toLowerCase() !== String(checkpoint.block_hash).toLowerCase())
    throw new Error("ARCHIVE_RPC_CHECKPOINT_MISMATCH");
  const [logs, head] = await Promise.all([
    client.getLogs({
      address: [
        process.env.CONTRACT_REGISTRY_ADDRESS,
        process.env.CONTRACT_VAULT_ADDRESS,
        process.env.CONTRACT_AGENT_EXECUTOR_ADDRESS,
      ] as Address[],
      fromBlock,
      toBlock,
    }),
    client.getBlockNumber(),
  ]);
  console.log(
    JSON.stringify(
      {
        chainId,
        historicalLogsReadable: true,
        checkpoint: checkpoint.block_number,
        testedRange: [fromBlock.toString(), toBlock.toString()],
        eventsInRange: logs.length,
        pendingBlocks: (head - BigInt(checkpoint.block_number)).toString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      historicalLogsReadable: false,
      reason:
        error instanceof Error ? error.message.split("\n")[0] : "UNKNOWN_ERROR",
    }),
  );
  process.exitCode = 2;
} finally {
  await sql.end();
}
