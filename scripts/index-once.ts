import { indexOnce, reconcileIntents } from "../packages/chain/indexer";
import { closeDb } from "../packages/db";
const crash = process.argv.includes("--crash-before-commit");
if (
  crash &&
  (process.env.APP_ENV !== "local" || process.env.CHAIN_ID !== "31337")
)
  throw new Error("FAILPOINT_LOCAL_ONLY");
try {
  console.log(JSON.stringify(await indexOnce({ crashBeforeCommit: crash })));
  await reconcileIntents();
} catch (error) {
  console.error(error instanceof Error ? error.message : "INDEXER_FAILED");
  process.exitCode = 1;
} finally {
  await closeDb();
}
