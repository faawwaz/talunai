import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { privateKeyAddress } from "./deployment-safety";

const manifest = JSON.parse(
  readFileSync("deployments/bsc-testnet.json", "utf8"),
);
const verified = JSON.parse(
  readFileSync("deployments/bsc-testnet.verification.json", "utf8"),
);
const web = parseEnv(readFileSync(".env.web.testnet", "utf8"));
const worker = parseEnv(readFileSync(".env.worker.testnet", "utf8"));
if (!worker.AGENT_PRIVATE_KEY || !web.DATABASE_URL)
  throw new Error("RUNTIME_CONFIGURATION_REQUIRED");
if (
  manifest.chainId !== 97 ||
  verified.chainId !== 97 ||
  verified.startupChecks !== "PASS" ||
  web.CHAIN_ID !== "97" ||
  worker.CHAIN_ID !== "97"
)
  throw new Error("VERIFIED_TESTNET_DEPLOYMENT_REQUIRED");
if (
  Object.keys(web).some(
    (key) => key.includes("PRIVATE_KEY") || key === "OPENROUTER_API_KEY",
  )
)
  throw new Error("WEB_ENV_CONTAINS_WORKER_SECRET");
if (
  Object.keys(worker).some(
    (key) =>
      key.startsWith("DEMO_") ||
      ["SESSION_SECRET", "CLAIM_ID_HMAC_KEY"].includes(key),
  )
)
  throw new Error("WORKER_ENV_CONTAINS_UNNEEDED_SECRET");
if (privateKeyAddress(worker.AGENT_PRIVATE_KEY) !== manifest.actors.agent)
  throw new Error("AGENT_DEPLOYMENT_WORKER_MISMATCH");
if (
  verified.agent !== manifest.actors.agent ||
  Date.now() - Date.parse(verified.verifiedAt) > 300000
)
  throw new Error("FRESH_MATCHING_SMOKE_REPORT_REQUIRED");
for (const [envKey, field] of Object.entries({
  CONTRACT_REGISTRY_ADDRESS: "registry",
  CONTRACT_VAULT_ADDRESS: "vault",
  CONTRACT_AGENT_EXECUTOR_ADDRESS: "executor",
  MOCK_IDR_ADDRESS: "token",
}))
  if (
    verified.contracts?.[field]?.toLowerCase() !==
      manifest[field].toLowerCase() ||
    web[envKey]?.toLowerCase() !== manifest[field].toLowerCase() ||
    worker[envKey]?.toLowerCase() !== manifest[field].toLowerCase()
  )
    throw new Error("MANIFEST_RUNTIME_MISMATCH");
// HTTPS remains mandatory even when the backend is served on localhost.
web.APP_ORIGIN ||= "https://localhost:3000";
const origin = new URL(web.APP_ORIGIN);
if (origin.protocol !== "https:" || origin.origin !== web.APP_ORIGIN)
  throw new Error("HTTPS_ORIGIN_REQUIRED");
web.SIWE_DOMAIN = origin.host;
web.SIWE_URI = web.APP_ORIGIN;
const dbUrl = new URL(web.DATABASE_URL);
const dbName = dbUrl.pathname.slice(1);
if (
  !/^talunai_bsc_[0-9]+$/.test(dbName) ||
  web.DATABASE_URL !== worker.DATABASE_URL
)
  throw new Error("ISOLATED_TESTNET_DATABASE_REQUIRED");
const oldWeb = existsSync(".env.local")
  ? parseEnv(readFileSync(".env.local", "utf8"))
  : {};
if (oldWeb.DATABASE_URL === web.DATABASE_URL && oldWeb.CHAIN_ID !== "97")
  throw new Error("LOCAL_DATABASE_REUSE_FORBIDDEN");
const adminUrl = new URL(dbUrl);
adminUrl.pathname = "/postgres";
const sql = postgres(adminUrl.toString(), { max: 1 });
try {
  const rows =
    await sql`SELECT datname FROM pg_database WHERE datname=${dbName}`;
  if (!rows.length) await sql`CREATE DATABASE ${sql(dbName)}`;
} finally {
  await sql.end();
}
const childEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  NODE_ENV: "development",
  ...web,
};
for (const script of ["scripts/migrate.ts", "scripts/seed.ts"]) {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: childEnv,
  });
  if (result.status !== 0) throw new Error("TESTNET_DATABASE_SETUP_FAILED");
}
const backup = `.local/runtime-before-bsc-${Date.now()}`;
mkdirSync(backup, { recursive: true, mode: 0o700 });
for (const file of [".env.local", ".env.worker"])
  if (existsSync(file)) {
    copyFileSync(file, `${backup}/${file}`);
    chmodSync(`${backup}/${file}`, 0o600);
  }
const serialize = (env: Record<string, string | undefined>) =>
  "# Testnet97 runtime; private, never commit.\n" +
  Object.entries(env)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n") +
  "\n";
for (const file of [".env.web.testnet", ".env.local"]) {
  writeFileSync(file, serialize(web), { mode: 0o600 });
  chmodSync(file, 0o600);
}
writeFileSync(".env.worker", serialize(worker), { mode: 0o600 });
chmodSync(".env.worker", 0o600);
writeFileSync(
  "deployments/bsc-testnet.activation.json",
  JSON.stringify(
    {
      chainId: 97,
      status: "RUNTIME_CONFIGURED",
      agent: manifest.actors.agent,
      appOrigin: web.APP_ORIGIN,
      previousRuntimeBackup: backup,
      isolatedDatabase: true,
      configuredAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
const planPath = "deployments/bsc-testnet.plan.json";
if (existsSync(planPath)) {
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  plan.status = "DEPLOYED_RUNTIME_CONFIGURED";
  plan.deploymentManifest = "deployments/bsc-testnet.json";
  plan.requirements = [];
  writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n");
}
console.log(
  JSON.stringify({
    status: "RUNTIME_CONFIGURED",
    chainId: 97,
    appOrigin: web.APP_ORIGIN,
    previousRuntimeBackup: backup,
    next: "Restart web with npm run dev:https and worker with npm run start:worker",
  }),
);
