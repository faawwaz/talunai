import { closeDb, getSql } from "../packages/db";
import { chainConfig, publicClient } from "../packages/chain/config";

const binding = chainConfig();
const client = publicClient();
const sql = getSql();

try {
  const rows = await sql`
    SELECT id,tx_hash,log_index,block_number,block_hash
    FROM chain_events
    WHERE chain_id=${binding.chainId} AND canonical=true
      AND contract_address IS NULL
    ORDER BY block_number,log_index
    LIMIT 1000
  `;
  const allowed = new Set([binding.registry, binding.vault, binding.executor]);
  const verified: Array<{ id: string; blockHash: string; address: string }> =
    [];

  for (const row of rows) {
    const receipt = await client.getTransactionReceipt({ hash: row.tx_hash });
    const block = await client.getBlock({
      blockNumber: BigInt(row.block_number),
    });
    const log = receipt.logs.find(
      (entry) => Number(entry.logIndex) === Number(row.log_index),
    );
    const address = log?.address.toLowerCase();
    if (
      receipt.status !== "success" ||
      receipt.blockNumber !== BigInt(row.block_number) ||
      receipt.blockHash !== row.block_hash ||
      block.hash !== row.block_hash ||
      !address ||
      !allowed.has(address as (typeof binding)["registry"])
    )
      throw new Error("EVENT_EMITTER_RECEIPT_MISMATCH");
    verified.push({ id: row.id, blockHash: row.block_hash, address });
  }

  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(971313370)`;
    for (const row of verified) {
      const updated = await tx`
        UPDATE chain_events SET contract_address=${row.address}
        WHERE id=${row.id} AND canonical=true
          AND block_hash=${row.blockHash} AND contract_address IS NULL
        RETURNING id
      `;
      if (updated.length !== 1)
        throw new Error("EVENT_EMITTER_CHANGED_DURING_BACKFILL");
    }
  });
  console.log(
    `Verified and attributed ${verified.length} canonical event logs.`,
  );
} finally {
  await closeDb();
}
