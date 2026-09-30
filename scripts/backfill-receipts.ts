import { backfillReceiptsOnce } from "../packages/chain/receipt-backfill";
import { indexOnce } from "../packages/chain/indexer";
import { closeDb } from "../packages/db";

if (process.env.APP_ENV !== "testnet" || process.env.CHAIN_ID !== "97")
  throw new Error("RECEIPT_BACKFILL_TESTNET_ONLY");

try {
  for (;;) {
    const result = await backfillReceiptsOnce();
    console.log(JSON.stringify(result));
    if (result.done) break;
  }
  // The normal indexer verifies all canonical claim events against live
  // registry/vault state before clearing the degraded readiness flag.
  for (;;) {
    const result = await indexOnce();
    console.log(JSON.stringify({ projection: result }));
    if (BigInt(result.head) - BigInt(result.tip) < 500n) break;
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message.split("\n")[0] : "BACKFILL_FAILED",
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
