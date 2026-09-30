import { existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { mnemonicToAccount } from "viem/accounts";
import { localMnemonic } from "./actors";
if (existsSync(".env.local")) {
  await splitWorkerSecrets();
  console.log(".env.local preserved; worker secrets separated.");
  process.exit(0);
}
mkdirSync(".local", { recursive: true });
const agent = mnemonicToAccount(localMnemonic, { addressIndex: 5 });
const key = agent.getHdKey().privateKey!;
writeFileSync(
  ".env.local",
  `# Generated local-only synthetic demo configuration; do not commit.
NODE_ENV=development
APP_ENV=local
DATABASE_URL=postgres://talunai:talunai-local-only@127.0.0.1:55432/talunai
APP_ORIGIN=http://localhost:3000
SIWE_DOMAIN=localhost:3000
SIWE_URI=http://localhost:3000
SESSION_SECRET=${randomBytes(48).toString("hex")}
CLAIM_ID_HMAC_KEY=${randomBytes(48).toString("hex")}
CLAIM_ID_HMAC_KEY_VERSION=1
CHAIN_ID=31337
RPC_HTTP_URL=http://127.0.0.1:8545
CHAIN_CONFIRMATIONS=1
INDEXER_RESCAN_BLOCKS=20
AGENT_PRIVATE_KEY=0x${Buffer.from(key).toString("hex")}
LLM_MODE=mock
OPENROUTER_MODEL=qwen/qwen3.5-flash-02-23
DOCUMENT_STORAGE_ROOT=./.local/documents
DOCUMENT_MAX_BYTES=10485760
DOCUMENT_MAX_PAGES=20
AGENT_MAX_STEPS=8
AGENT_TIMEOUT_MS=30000
`,
  { mode: 0o600 },
);
console.log(
  "Created private .env.local for chain 31337. Run local PostgreSQL and Anvil, then deploy:local.",
);

async function splitWorkerSecrets() {
  const web = readFileSync(".env.local", "utf8");
  const workerKeys = [
    "DATABASE_URL",
    "APP_ENV",
    "CHAIN_ID",
    "RPC_HTTP_URL",
    "RPC_FALLBACK_HTTP_URL",
    "CHAIN_CONFIRMATIONS",
    "INDEXER_RESCAN_BLOCKS",
    "CONTRACT_REGISTRY_ADDRESS",
    "CONTRACT_VAULT_ADDRESS",
    "CONTRACT_AGENT_EXECUTOR_ADDRESS",
    "MOCK_IDR_ADDRESS",
    "DEPLOYMENT_START_BLOCK",
    "AGENT_PRIVATE_KEY",
    "LLM_MODE",
    "OPENROUTER_API_KEY",
    "OPENROUTER_MODEL",
    "DOCUMENT_STORAGE_ROOT",
    "DOCUMENT_MAX_BYTES",
    "DOCUMENT_MAX_PAGES",
    "AGENT_MAX_STEPS",
    "AGENT_TIMEOUT_MS",
  ];
  if (!existsSync(".env.worker"))
    writeFileSync(
      ".env.worker",
      "# Worker-only synthetic demo configuration. Never commit.\n" +
        web
          .split("\n")
          .filter((line) => workerKeys.includes(line.split("=")[0]))
          .join("\n") +
        "\n",
      { mode: 0o600 },
    );
  writeFileSync(
    ".env.local",
    web
      .split("\n")
      .filter(
        (line) =>
          !["AGENT_PRIVATE_KEY", "OPENROUTER_API_KEY"].includes(
            line.split("=")[0],
          ),
      )
      .join("\n"),
    { mode: 0o600 },
  );
}
await splitWorkerSecrets();
