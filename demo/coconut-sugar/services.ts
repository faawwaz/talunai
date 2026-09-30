import assert from "node:assert/strict";
import { Socket } from "node:net";
import { request as httpsRequest } from "node:https";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readdir, readFile, readlink } from "node:fs/promises";
import { resolve } from "node:path";
import { getSql } from "../../packages/db";
import { chainConfig, publicClient } from "../../packages/chain/config";
import { backfillReceiptsOnce } from "../../packages/chain/receipt-backfill";
import { indexOnce } from "../../packages/chain/indexer";
import { artifact, privateOutput, root, save, waitFor } from "./common";

async function connected(port: number) {
  return new Promise<boolean>((done, reject) => {
    const socket = new Socket();
    socket.setTimeout(1200);
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      done(false);
    });
    socket.once("error", (e: NodeJS.ErrnoException) => {
      socket.destroy();
      if (e.code === "EPERM" || e.code === "EACCES")
        reject(new Error("NETWORK_SOCKET_DENIED"));
      else done(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}
async function start(name: string, args: string[], env: NodeJS.ProcessEnv) {
  await mkdir(privateOutput, { recursive: true });
  const fd = openSync(resolve(privateOutput, `${name}.log`), "a", 0o600);
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  await new Promise<void>((ok, bad) => {
    child.once("spawn", ok);
    child.once("error", bad);
  });
  child.unref();
  await save(
    resolve(privateOutput, `${name}.process.json`),
    { pid: child.pid, command: args, startedAt: new Date().toISOString() },
    true,
  );
}
async function workerProcesses() {
  const found: number[] = [];
  for (const dir of await readdir("/proc")) {
    if (!/^\d+$/.test(dir)) continue;
    try {
      const cmd = await readFile(`/proc/${dir}/cmdline`, "utf8");
      if (
        (cmd.includes("apps/worker/main.ts") ||
          cmd.includes("dist/worker/main.js")) &&
        (await readlink(`/proc/${dir}/cwd`)) === root
      )
        found.push(Number(dir));
    } catch {
      /* Processes can end during inspection. */
    }
  }
  return found;
}
async function webConfig() {
  const url = new URL("/v1/config", process.env.APP_ORIGIN);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  return new Promise<{ llmMode?: string; chainId?: number }>((ok, bad) => {
    const req = httpsRequest(
      url,
      { rejectUnauthorized: false, timeout: 10_000 },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            if (res.statusCode !== 200)
              throw new Error("WEB_CONFIG_UNAVAILABLE");
            ok(JSON.parse(body));
          } catch (e) {
            bad(e);
          }
        });
      },
    );
    req.once("error", bad);
    req.once("timeout", () => req.destroy(new Error("WEB_CONFIG_TIMEOUT")));
    req.end();
  });
}
async function indexerNeedsRecovery() {
  const c = chainConfig();
  const [checkpoint] =
    await getSql()`SELECT block_number FROM indexer_checkpoints WHERE chain_id=${c.chainId}`;
  if (!checkpoint || c.chainId !== 97) return false;
  const head = await publicClient().getBlockNumber({ cacheTime: 0 });
  return head - BigInt(checkpoint.block_number) > 500n;
}
async function recoverIndexer() {
  console.log(
    "Memulihkan riwayat chain dari header dan receipt terverifikasi...",
  );
  const startedAt = new Date().toISOString();
  let windows = 0,
    events = 0;
  const started = Date.now();
  for (;;) {
    assert.ok(
      Date.now() - started < 30 * 60_000,
      "CASE_INDEXER_RECOVERY_TIME_LIMIT",
    );
    const result = await backfillReceiptsOnce();
    windows += 1;
    events += result.events;
    await save(artifact("indexer-recovery.json"), {
      source: "ACTUAL_CANONICAL_HEADERS_AND_RECEIPTS",
      startedAt,
      updatedAt: new Date().toISOString(),
      windows,
      events,
      checkpoint: result.to,
      financialProjectionReady: false,
    });
    if (windows % 20 === 0 || result.done)
      console.log(
        `Recovery: block ${result.to}; ${windows} window terverifikasi.`,
      );
    if (result.done) break;
  }
  for (;;) {
    const result = await indexOnce();
    if (BigInt(result.head) - BigInt(result.tip) < 500n) {
      await save(artifact("indexer-recovery.json"), {
        source: "ACTUAL_CANONICAL_HEADERS_AND_RECEIPTS",
        startedAt,
        completedAt: new Date().toISOString(),
        windows,
        events,
        projection: result,
        financialProjectionReady: true,
      });
      break;
    }
  }
}
export async function ensureServices(capture = true) {
  const db = new URL(process.env.DATABASE_URL!);
  assert.ok(
    ["localhost", "127.0.0.1"].includes(db.hostname),
    "CASE_LOCAL_DB_ONLY",
  );
  const dbPort = Number(db.port || 5432);
  if (!(await connected(dbPort))) {
    assert.equal(dbPort, 55432, "START_CONFIGURED_DATABASE_EXTERNALLY");
    await start("postgres", ["--import", "tsx", "scripts/local-postgres.ts"], {
      PATH: process.env.PATH,
      APP_ENV: "local",
      NODE_ENV: "development",
    });
    await waitFor(() => connected(dbPort), Boolean, "postgres startup", 30_000);
  }
  const sql = getSql();
  const [schema] = await sql`SELECT to_regclass('public.claims') AS claims`;
  assert.ok(schema?.claims, "CASE_DATABASE_SCHEMA_MISSING_RUN_DB_MIGRATE");
  const [heartbeat] =
    await sql`SELECT status,provider_mode,provider_model,updated_at FROM worker_heartbeats WHERE id='worker'`;
  const workers = await workerProcesses();
  const needsRecovery = await indexerNeedsRecovery();
  const matches =
    heartbeat?.provider_mode === "live" &&
    heartbeat?.provider_model === process.env.OPENROUTER_MODEL;
  if (!matches || needsRecovery) {
    for (const pid of workers) process.kill(pid, "SIGTERM");
    if (workers.length)
      await waitFor(
        workerProcesses,
        (pids) => pids.length === 0,
        "old worker graceful shutdown",
        25_000,
      );
  }
  if (needsRecovery) await recoverIndexer();
  if (!matches || !workers.length || needsRecovery) {
    // Load only worker configuration, never give web the OpenRouter or signer keys.
    await start(
      "worker",
      ["--env-file=.env.worker", "--import", "tsx", "apps/worker/main.ts"],
      { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV },
    );
  }
  await waitFor(
    async () =>
      (
        await sql`SELECT status,provider_mode,provider_model,updated_at FROM worker_heartbeats WHERE id='worker'`
      )[0],
    (h) =>
      h?.status === "READY" &&
      h.provider_mode === "live" &&
      h.provider_model === process.env.OPENROUTER_MODEL &&
      Date.now() - new Date(h.updated_at).getTime() < 30_000,
    "live worker/indexer readiness",
    120_000,
  );
  if (!capture) return;
  const port = Number(new URL(process.env.APP_ORIGIN!).port || 443);
  if (!(await connected(port))) {
    await start(
      "web",
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
        "--experimental-https",
        "--experimental-https-key",
        ".local/testnet-tls/localhost-key.pem",
        "--experimental-https-cert",
        ".local/testnet-tls/localhost.pem",
      ],
      {
        PATH: process.env.PATH,
        NODE_ENV: "development",
        LLM_MODE: "live",
        OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
      },
    );
    await waitFor(() => connected(port), Boolean, "web startup", 45_000);
  }
  const config = await webConfig();
  assert.equal(config.chainId, 97, "WEB_CHAIN_MISMATCH");
  assert.equal(config.llmMode, "live", "WEB_RESTART_REQUIRED_FOR_LIVE_MODE");
}
