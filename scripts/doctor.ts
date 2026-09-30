import { closeDb, getSql } from "../packages/db";
import { chainConfig, publicClient } from "../packages/chain/config";
import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";

const origin = process.env.APP_ORIGIN ?? "http://127.0.0.1:3000";
const results: boolean[] = [];
let latestChainBlock: bigint | null = null;

function failureCode(error: unknown) {
  if (!(error instanceof Error)) return "unavailable";
  if (/^[A-Z][A-Z0-9_:]{2,80}$/.test(error.message)) return error.message;
  const cause = error.cause as { code?: unknown } | undefined;
  return typeof cause?.code === "string" ? cause.code : "unavailable";
}

async function check(label: string, action: () => Promise<string>) {
  try {
    console.log(`OK   ${label}: ${await action()}`);
    results.push(true);
  } catch (error) {
    console.log(`FAIL ${label}: ${failureCode(error)}`);
    results.push(false);
  }
}

async function healthStatus(path: string, timeoutMs: number) {
  const url = new URL(path, origin);
  if (
    url.protocol === "https:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  ) {
    const ca = await readFile(".local/testnet-tls/localhost.pem");
    return new Promise<number>((resolve, reject) => {
      const request = httpsRequest(url, { ca }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.setTimeout(timeoutMs, () =>
        request.destroy(new Error("WEB_TIMEOUT")),
      );
      request.once("error", reject);
      request.end();
    });
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "manual",
  });
  return response.status;
}

console.log(`Talunai origin: ${origin}`);
console.log(
  `Web startup: ${new URL(origin).protocol === "https:" ? "npm run dev:https" : "npm run dev"}`,
);

await check("web", async () => {
  const status = await healthStatus("/health/live", 5_000);
  if (status !== 200) throw new Error("WEB_UNAVAILABLE");
  return `${status} ${new URL(origin).host}`;
});

await check("database", async () => {
  const [row] = await getSql()`select current_database() as database`;
  return String(row.database);
});

await check("worker and indexer", async () => {
  const sql = getSql();
  const [[worker], [checkpoint]] = await Promise.all([
    sql`select status,updated_at from worker_heartbeats where id='worker'`,
    sql`select block_number,degraded,updated_at from indexer_checkpoints where chain_id=${Number(process.env.CHAIN_ID)}`,
  ]);
  if (
    !worker ||
    worker.status !== "READY" ||
    Date.now() - new Date(worker.updated_at).getTime() > 120_000
  )
    throw new Error("WORKER_UNAVAILABLE");
  if (
    !checkpoint ||
    checkpoint.degraded ||
    Date.now() - new Date(checkpoint.updated_at).getTime() > 120_000
  )
    throw new Error("INDEXER_UNAVAILABLE");
  return `ready; indexed block ${checkpoint.block_number}`;
});

await check("agent provider", async () => {
  const [worker] =
    await getSql()`select status,provider_mode,provider_model,updated_at from worker_heartbeats where id='worker'`;
  const expectedMode = process.env.LLM_MODE;
  if (!worker || !["mock", "live"].includes(expectedMode ?? ""))
    throw new Error("AGENT_MODE_MISSING");
  if (
    worker.status !== "READY" ||
    Date.now() - new Date(worker.updated_at).getTime() > 120_000
  )
    throw new Error("WORKER_UNAVAILABLE");
  if (worker.provider_mode !== expectedMode)
    throw new Error("AGENT_MODE_MISMATCH");
  if (expectedMode === "live") {
    // Live worker startup validates its own key. The web env intentionally
    // never receives that secret; inspect its fresh heartbeat instead.
    if (worker.provider_model !== process.env.OPENROUTER_MODEL)
      throw new Error("AGENT_MODEL_MISMATCH");
    return `live; ${worker.provider_model}`;
  }
  return "mock; deterministic checks";
});

await check("chain RPC", async () => {
  const configured = chainConfig();
  const client = publicClient();
  const [chainId, block] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockTag: "latest" }),
  ]);
  if (
    chainId !== configured.chainId ||
    Number(block.timestamp) * 1000 < Date.now() - 120_000
  )
    throw new Error("CHAIN_UNAVAILABLE");
  latestChainBlock = block.number;
  return `chain ${chainId}; block ${block.number}`;
});

await check("indexer lag", async () => {
  if (latestChainBlock === null) throw new Error("CHAIN_UNAVAILABLE");
  const [checkpoint] =
    await getSql()`select block_number from indexer_checkpoints where chain_id=${chainConfig().chainId}`;
  if (!checkpoint) throw new Error("INDEXER_UNAVAILABLE");
  const lag = latestChainBlock - BigInt(checkpoint.block_number);
  if (lag > 200n) throw new Error("INDEXER_LAGGING");
  return `${lag < 0n ? 0n : lag} blocks behind head`;
});

await check("application readiness", async () => {
  const status = await healthStatus("/health/ready", 20_000);
  if (status !== 200) throw new Error("APPLICATION_NOT_READY");
  return `${status}`;
});

try {
  await closeDb();
} catch {
  // The individual database check already reported the failure.
}
if (results.some((ready) => !ready)) process.exitCode = 1;
