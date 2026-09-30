import { readFileSync, openSync, closeSync } from "node:fs";
import { spawn } from "node:child_process";
import { parseEnv } from "node:util";
function workerEnvironment() {
  return {
    PATH: process.env.PATH,
    NODE_ENV: process.env.NODE_ENV,
    ...parseEnv(readFileSync(".env.worker", "utf8")),
  };
}
export async function stopLocalWorker() {
  if (process.env.APP_ENV !== "local" || process.env.CHAIN_ID !== "31337")
    throw new Error("WORKER_CONTROL_LOCAL_ONLY");
  const pid = Number(readFileSync(".local/worker.pid", "utf8"));
  if (!Number.isInteger(pid) || pid < 2) throw new Error("WORKER_PID_INVALID");
  const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
  if (
    !cmd.includes("apps/worker/main.ts") &&
    !cmd.includes("dist/worker/main.js")
  )
    throw new Error("WORKER_PID_DOES_NOT_MATCH_TALUNAI");
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      console.log(
        `Stopped local TALUNAI worker ${pid} for crash/restart demonstration.`,
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("WORKER_STOP_TIMEOUT");
}
export function resumeLocalWorker() {
  const fd = openSync(".local/worker-resumed.log", "a");
  const child = spawn(
    process.execPath,
    ["--env-file=.env.worker", "--import", "tsx", "apps/worker/main.ts"],
    { detached: true, stdio: ["ignore", fd, fd], env: workerEnvironment() },
  );
  closeSync(fd);
  child.unref();
  console.log(`Restarted local TALUNAI worker process ${child.pid}.`);
}
export async function runIndexerChild(crash = false) {
  return new Promise<number>((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--env-file=.env.worker",
        "--import",
        "tsx",
        "scripts/index-once.ts",
        ...(crash ? ["--crash-before-commit"] : []),
      ],
      { stdio: "inherit", env: workerEnvironment() },
    );
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}
