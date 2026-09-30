import { PgBoss } from "pg-boss";
import { mkdirSync, writeFileSync } from "node:fs";
import { getSql, closeDb } from "../../packages/db";
import { databaseTls, poolSize } from "../../packages/db/pool-config";
import {
  processClaim,
  type ProcessClaimInput,
} from "../../packages/agents/process";
import { createDocumentAnalysisProvider } from "../../packages/agents/provider";
import { indexOnce, reconcileIntents } from "../../packages/chain/indexer";
import {
  executeFundingHold,
  type HoldInput,
} from "../../packages/chain/gateway";
import { validateStartup } from "../../packages/chain/service";
import { cleanAbandonedUploads } from "../../packages/agents/maintenance";

const queues = [
  "ANALYZE_CLAIM",
  "FUNDING_HOLD",
  "RECONCILE_TRANSACTION",
] as const;
const sql = getSql();
const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL!,
  ssl: databaseTls(),
  max: poolSize("WORKER_DATABASE_POOL_MAX", 5),
  schema: "pgboss",
});
boss.on("error", () =>
  console.error(JSON.stringify({ level: "error", code: "QUEUE_ERROR" })),
);
async function drainOutbox() {
  await sql.begin(async (tx) => {
    const messages =
      await tx`SELECT * FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED`;
    for (const row of messages) {
      if (!queues.includes(row.type))
        throw new Error("OUTBOX_TYPE_NOT_ALLOWED");
      // Job insertion and the published marker share this PostgreSQL transaction.
      await boss.send(row.type, row.payload, {
        id: row.id,
        // A canonical registration may reach the indexer before the agent's
        // RPC provider sees it. Keep the hold durable across that short lag.
        retryLimit: row.type === "FUNDING_HOLD" ? 6 : 2,
        retryDelay: row.type === "FUNDING_HOLD" ? 4 : 5,
        retryBackoff: true,
        expireInSeconds: 120,
        db: {
          executeSql: async (text, values) => ({
            rows: await tx.unsafe(text, (values ?? []) as never[]),
          }),
        },
      });
      await tx`UPDATE outbox SET published_at=now() WHERE id=${row.id}`;
    }
  });
}
async function main() {
  const analysisProvider = createDocumentAnalysisProvider(); // Fail live startup visibly when key is absent.
  await validateStartup();
  if (!process.env.AGENT_PRIVATE_KEY)
    throw new Error("AGENT_SIGNER_UNAVAILABLE");
  await boss.start();
  if (process.env.APP_ENV === "local") {
    mkdirSync(".local", { recursive: true });
    writeFileSync(".local/worker.pid", String(process.pid), { mode: 0o600 });
  }
  for (const queue of queues) await boss.createQueue(queue);
  await boss.work<ProcessClaimInput>(
    "ANALYZE_CLAIM",
    { batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        try {
          await processClaim({ ...job.data, provider: analysisProvider });
        } catch (error) {
          const code =
            error instanceof Error ? error.message : "AGENT_PROCESSING_FAILED";
          // Refusal, schema, provenance and permission failures stay visibly FAILED and are not retried.
          if (
            [
              "PROVIDER_TIMEOUT",
              "PROVIDER_RATE_LIMIT",
              "PROVIDER_UNAVAILABLE",
              "PROVIDER_TRANSIENT_FAILURE",
            ].includes(code)
          )
            throw error;
          console.error(
            JSON.stringify({
              level: "error",
              event: "ANALYSIS_PERMANENT_FAILURE",
              runId: job.data.runId,
              code,
            }),
          );
        }
      }
    },
  );
  await boss.work<HoldInput>("FUNDING_HOLD", { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      try {
        await executeFundingHold(job.data);
      } catch (error) {
        const code =
          error instanceof Error ? error.message : "HOLD_GATEWAY_FAILED";
        const retryable =
          code === "HOLD_AWAITS_REGISTRATION" ||
          code === "HOLD_RPC_LOOKUP_UNCERTAIN" ||
          /TIMEOUT|UNAVAILABLE|CHAIN_CHANGED|HTTP request failed/i.test(code);
        await sql`INSERT INTO audit_events(id,actor_id,action,target,correlation_id,details) VALUES(gen_random_uuid()::text,'AGENT',${retryable ? "HOLD_ACTION_RETRY_SCHEDULED" : "HOLD_ACTION_FAILED"},${job.data.claimId},${job.data.actionId},${sql.json({ code: code.slice(0, 100) })})`;
        if (retryable) throw error;
        console.error(
          JSON.stringify({
            level: "error",
            event: "HOLD_PERMANENT_FAILURE",
            claimId: job.data.claimId,
            code: code.slice(0, 100),
          }),
        );
      }
    }
  });
  await boss.work("RECONCILE_TRANSACTION", { batchSize: 1 }, async () => {
    await reconcileIntents();
  });
  let stopping = false,
    busy = false,
    lastCleanup = 0;
  async function tick() {
    if (busy || stopping) return;
    busy = true;
    try {
      await drainOutbox();
      await indexOnce();
      await reconcileIntents();
      if (Date.now() - lastCleanup > 3600000) {
        await cleanAbandonedUploads();
        lastCleanup = Date.now();
      }
      await sql`INSERT INTO worker_heartbeats(id,status,provider_mode,provider_model) VALUES('worker','READY',${analysisProvider.mode},${process.env.OPENROUTER_MODEL ?? null}) ON CONFLICT(id) DO UPDATE SET updated_at=now(),status='READY',error_code=null,provider_mode=excluded.provider_mode,provider_model=excluded.provider_model`;
    } catch (error) {
      const code =
        error instanceof Error ? error.message.slice(0, 80) : "WORKER_ERROR";
      console.error(JSON.stringify({ level: "error", code }));
      await sql`INSERT INTO worker_heartbeats(id,status,error_code,provider_mode,provider_model) VALUES('worker','DEGRADED',${code},${analysisProvider.mode},${process.env.OPENROUTER_MODEL ?? null}) ON CONFLICT(id) DO UPDATE SET updated_at=now(),status='DEGRADED',error_code=excluded.error_code,provider_mode=excluded.provider_mode,provider_model=excluded.provider_model`;
    } finally {
      busy = false;
    }
  }
  await tick();
  const timer = setInterval(() => {
    void tick();
  }, 2000);
  console.log(
    JSON.stringify({
      level: "info",
      event: "WORKER_STARTED",
      mode: analysisProvider.mode,
      model:
        analysisProvider.mode === "live" ? process.env.OPENROUTER_MODEL : null,
    }),
  );
  const stop = async () => {
    stopping = true;
    clearInterval(timer);
    const deadline = setTimeout(() => {
      console.error(
        JSON.stringify({ level: "error", event: "WORKER_SHUTDOWN_TIMEOUT" }),
      );
      process.exit(1);
    }, 20_000);
    deadline.unref();
    try {
      await boss.stop({ graceful: true, timeout: 10_000 });
      while (busy) await new Promise((r) => setTimeout(r, 50));
      await closeDb();
      process.exit(0);
    } finally {
      clearTimeout(deadline);
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
main().catch(async (error) => {
  console.error(
    JSON.stringify({
      level: "fatal",
      code: error instanceof Error ? error.message : "WORKER_START_FAILED",
    }),
  );
  await closeDb();
  process.exit(1);
});
