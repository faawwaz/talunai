import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
if (process.env.APP_ENV !== "local" || process.env.CHAIN_ID !== "31337")
  throw new Error("LOCAL_COMPOSE_ONLY");
const client = createPublicClient({
  transport: http(process.env.RPC_HTTP_URL, { timeout: 1000, retryCount: 0 }),
});
let ready = false;
for (let i = 0; i < 30; i++) {
  try {
    if ((await client.getChainId()) === 31337) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
if (!ready) throw new Error("ANVIL_NOT_READY");
for (const script of [
  "scripts/migrate.ts",
  "scripts/deploy.ts",
  "scripts/seed.ts",
]) {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
writeFileSync(".local/compose.env", readFileSync(".env.local", "utf8"), {
  mode: 0o600,
});
console.log(
  "Public contract configuration saved to .local/compose/compose.env on host. Start web and worker with this env file.",
);
