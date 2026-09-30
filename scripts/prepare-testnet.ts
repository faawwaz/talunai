import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { generatePrivateKey } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import {
  assertDistinctActors,
  privateKeyAddress,
  testOnlyAddress,
  type DeploymentEnv,
} from "./deployment-safety";

function readEnv(file: string): DeploymentEnv {
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
}
function saveEnv(file: string, env: DeploymentEnv, description: string) {
  writeFileSync(
    file,
    `# ${description}\n# Private test-only configuration. Never commit.\n` +
      Object.entries(env)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join("\n") +
      "\n",
    { mode: 0o600 },
  );
  chmodSync(file, 0o600);
}
const source = readEnv(".env.worker");
if (!source.AGENT_PRIVATE_KEY)
  throw new Error("AGENT_PRIVATE_KEY_REQUIRED_IN_WORKER_ENV");
const agent = testOnlyAddress(privateKeyAddress(source.AGENT_PRIVATE_KEY), 97);
if (existsSync("deployments/bsc-testnet.json"))
  throw new Error("EXISTING_TESTNET_DEPLOYMENT_REQUIRES_EXPLICIT_MIGRATION");
const deployment = readEnv(".env.testnet");
deployment.APP_ENV = "testnet";
deployment.CHAIN_ID = "97";
deployment.RPC_HTTP_URL ||= "https://bsc-testnet-rpc.publicnode.com";
deployment.RPC_FALLBACK_HTTP_URL ||= bscTestnet.rpcUrls.default.http[0];
deployment.CHAIN_CONFIRMATIONS ||= "3";
deployment.INDEXER_RESCAN_BLOCKS ||= "64";
deployment.AGENT_ADDRESS = agent;
// Deployment only needs the public agent address. Its signer stays in the worker.
delete deployment.AGENT_PRIVATE_KEY;
delete deployment.DEMO_AGENT_PRIVATE_KEY;
const roles = [
  "admin",
  "verifier",
  "borrower",
  "buyer",
  "lender",
  "lenderTwo",
] as const;
const actors: Record<string, string> = { agent };
for (const role of roles) {
  const keyName = `DEMO_${role.toUpperCase()}_PRIVATE_KEY`;
  deployment[keyName] ||= generatePrivateKey();
  actors[role] = testOnlyAddress(privateKeyAddress(deployment[keyName]!), 97);
}
assertDistinctActors(actors, 97);
const oldWeb = readEnv(".env.web.testnet");
const oldWorker = readEnv(".env.worker.testnet");
if (!oldWeb.DATABASE_URL && !source.DATABASE_URL)
  throw new Error("DATABASE_URL_REQUIRED");
const database = new URL(oldWeb.DATABASE_URL || source.DATABASE_URL!);
if (!oldWeb.DATABASE_URL) database.pathname = `/talunai_bsc_${Date.now()}`;
const common: DeploymentEnv = {
  APP_ENV: "testnet",
  CHAIN_ID: "97",
  RPC_HTTP_URL: deployment.RPC_HTTP_URL,
  RPC_FALLBACK_HTTP_URL: deployment.RPC_FALLBACK_HTTP_URL,
  CHAIN_CONFIRMATIONS: deployment.CHAIN_CONFIRMATIONS,
  INDEXER_RESCAN_BLOCKS: deployment.INDEXER_RESCAN_BLOCKS,
  DATABASE_URL: database.toString(),
  LLM_MODE: source.LLM_MODE || "mock",
  OPENROUTER_MODEL: source.OPENROUTER_MODEL || "qwen/qwen3.5-flash-02-23",
  DOCUMENT_STORAGE_ROOT: "./.local/documents-testnet",
  DOCUMENT_MAX_BYTES: source.DOCUMENT_MAX_BYTES || "10485760",
  DOCUMENT_MAX_PAGES: source.DOCUMENT_MAX_PAGES || "20",
};
const web: DeploymentEnv = {
  ...common,
  APP_ORIGIN: oldWeb.APP_ORIGIN || "",
  SIWE_DOMAIN: oldWeb.SIWE_DOMAIN || "",
  SIWE_URI: oldWeb.SIWE_URI || "",
  SESSION_SECRET: oldWeb.SESSION_SECRET || randomBytes(48).toString("hex"),
  CLAIM_ID_HMAC_KEY:
    oldWeb.CLAIM_ID_HMAC_KEY || randomBytes(48).toString("hex"),
  CLAIM_ID_HMAC_KEY_VERSION: "1",
};
for (const [role, address] of Object.entries(actors))
  if (role !== "agent") web[`SEED_${role.toUpperCase()}_ADDRESS`] = address;
const worker: DeploymentEnv = {
  ...common,
  AGENT_PRIVATE_KEY: source.AGENT_PRIVATE_KEY,
  OPENROUTER_API_KEY: source.OPENROUTER_API_KEY || oldWorker.OPENROUTER_API_KEY,
  AGENT_MAX_STEPS: source.AGENT_MAX_STEPS || "8",
  AGENT_TIMEOUT_MS: source.AGENT_TIMEOUT_MS || "30000",
};
saveEnv(
  ".env.testnet",
  deployment,
  "BSC97 deployment CLI only; participant keys never enter API/worker.",
);
saveEnv(
  ".env.web.testnet",
  web,
  "STAGED web config. Set HTTPS APP_ORIGIN/SIWE fields before activation. Contract addresses await real deployment receipts.",
);
saveEnv(
  ".env.worker.testnet",
  worker,
  "STAGED worker config. Contract addresses await real deployment receipts.",
);
mkdirSync("deployments", { recursive: true });
const plan = {
  project: "TALUNAI",
  status: "PREPARED_NOT_DEPLOYED",
  chainId: 97,
  isSynthetic: true,
  preparedAt: new Date().toISOString(),
  actors,
  requirements: [
    "DEPLOYER_TBNB_FOR_GAS",
    "AGENT_TBNB_FOR_HOLD",
    "REAL_DEPLOYMENT_RECEIPTS",
    "HTTPS_WEB_ORIGIN",
    "FRESH_TESTNET_DATABASE_MIGRATION_AND_SEED",
  ],
};
writeFileSync(
  "deployments/bsc-testnet.plan.json",
  JSON.stringify(plan, null, 2) + "\n",
);
console.log(JSON.stringify(plan, null, 2));
