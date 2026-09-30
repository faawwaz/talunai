import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { anvil } from "viem/chains";
import { mnemonicToAccount } from "viem/accounts";
import { resolve } from "node:path";

// Disposable infrastructure only. This harness never loads application .env files,
// writes deployment manifests, or connects to a configured public RPC.
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("PORT_UNAVAILABLE");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
const directory = await mkdtemp(join(tmpdir(), "talunai-api-"));
const pgPort = await freePort();
const rpcPort = await freePort();
const financialUi = process.argv.includes("--ui-financial");
const webPort = financialUi ? await freePort() : 3000;
const pg = new EmbeddedPostgres({
  databaseDir: join(directory, "pg"),
  user: "api_test",
  password: "isolated-only",
  port: pgPort,
  persistent: false,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
// Deliberately allowlist inherited environment; participant/agent/provider keys cannot leak into child tests.
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  NODE_ENV: "test",
  APP_ENV: "local",
  CHAIN_ID: "31337",
  DATABASE_URL: `postgres://api_test:isolated-only@127.0.0.1:${pgPort}/api_test`,
  RPC_HTTP_URL: `http://127.0.0.1:${rpcPort}`,
  RPC_FALLBACK_HTTP_URL: "",
  APP_ORIGIN: `http://localhost:${webPort}`,
  SIWE_DOMAIN: `localhost:${webPort}`,
  SIWE_URI: `http://localhost:${webPort}`,
  SESSION_SECRET: randomBytes(48).toString("hex"),
  CLAIM_ID_HMAC_KEY: randomBytes(48).toString("hex"),
  CHAIN_CONFIRMATIONS: "1",
  INDEXER_RESCAN_BLOCKS: "20",
  LLM_MODE: "mock",
  DOCUMENT_STORAGE_ROOT: join(directory, "documents"),
  RUN_INTEGRATION: "1",
  RUN_CHAIN_INTEGRATION: "1",
};
env.CHAIN_TEST_DATABASE_URL = env.DATABASE_URL;
let started = false;
let child: ChildProcess | undefined;
const services: ChildProcess[] = [];
async function run(args: string[]) {
  const command = spawn(process.execPath, args, { env, stdio: "inherit" });
  const code = await new Promise<number | null>((resolve, reject) => {
    command.once("error", reject);
    command.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`TEST_COMMAND_FAILED_${code}`);
}
const accounts = Array.from({ length: 8 }, (_, addressIndex) =>
  mnemonicToAccount(
    "test test test test test test test test test test test junk",
    { addressIndex },
  ),
);
const rpc = createPublicClient({
  chain: anvil,
  transport: http(env.RPC_HTTP_URL, { timeout: 300, retryCount: 0 }),
});
const wallet = createWalletClient({
  account: accounts[0],
  chain: anvil,
  transport: http(env.RPC_HTTP_URL),
});
async function artifact(name: string) {
  return JSON.parse(
    await readFile(`contracts/out/${name}.sol/${name}.json`, "utf8"),
  ) as { abi: Abi; bytecode: { object: Hex } };
}
async function deploy(name: string, args: readonly unknown[]) {
  const source = await artifact(name);
  const hash = await wallet.deployContract({
    abi: source.abi,
    bytecode: source.bytecode.object,
    args,
  });
  const receipt = await rpc.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error(`DEPLOY_FAILED_${name}`);
  if (name === "MockIDR")
    env.DEPLOYMENT_START_BLOCK = receipt.blockNumber.toString();
  return receipt.contractAddress;
}
async function write(
  name: string,
  address: Address,
  functionName: string,
  args: readonly unknown[],
) {
  const { request } = await rpc.simulateContract({
    address,
    abi: (await artifact(name)).abi,
    functionName,
    args,
    account: accounts[0],
  });
  const receipt = await rpc.waitForTransactionReceipt({
    hash: await wallet.writeContract(request),
  });
  if (receipt.status !== "success")
    throw new Error(`BOOTSTRAP_FAILED_${functionName}`);
}
try {
  await pg.initialise();
  await pg.start();
  started = true;
  await pg.createDatabase("api_test");
  child = spawn(
    process.execPath,
    [
      "scripts/foundry.mjs",
      "anvil",
      "--host",
      "127.0.0.1",
      "--port",
      String(rpcPort),
      "--chain-id",
      "31337",
      "--silent",
    ],
    { env, stdio: "ignore" },
  );
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error("ISOLATED_ANVIL_EXITED");
    try {
      ready = (await rpc.getChainId()) === 31337;
      if (ready) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!ready) throw new Error("ISOLATED_ANVIL_TIMEOUT");
  const token = await deploy("MockIDR", [accounts[0].address]);
  const registry = await deploy("RWARegistry", [
    accounts[0].address,
    accounts[4].address,
    token,
    8000n,
    150n,
    100000000n,
  ]);
  const vault = await deploy("FinancingVault", [accounts[0].address, registry]);
  const executor = await deploy("AgentExecutor", [
    accounts[0].address,
    accounts[5].address,
    registry,
    vault,
  ]);
  await write("RWARegistry", registry, "configureEndpoints", [vault, executor]);
  for (const index of [3, 7])
    await write("FinancingVault", vault, "grantRole", [
      keccak256(toHex("LENDER_ROLE")),
      accounts[index].address,
    ]);
  for (const index of [2, 3, 7])
    await write("MockIDR", token, "mint", [
      accounts[index].address,
      1000000000n,
    ]);
  Object.assign(env, {
    MOCK_IDR_ADDRESS: token,
    CONTRACT_REGISTRY_ADDRESS: registry,
    CONTRACT_VAULT_ADDRESS: vault,
    CONTRACT_AGENT_EXECUTOR_ADDRESS: executor,
  });
  await run(["--import", "tsx", "scripts/migrate.ts"]);
  await run(["--import", "tsx", "scripts/seed.ts"]);
  if (financialUi) {
    const worker = spawn(process.execPath, [resolve("dist/worker/main.js")], {
      cwd: directory,
      env: {
        ...env,
        AGENT_PRIVATE_KEY: toHex(accounts[5].getHdKey().privateKey!),
      },
      stdio: "inherit",
    });
    services.push(worker);
    const web = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(webPort),
      ],
      { env: { ...env, NODE_ENV: "production" }, stdio: "inherit" },
    );
    services.push(web);
    let webReady = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (web.exitCode !== null || worker.exitCode !== null)
        throw new Error("UI_INFRA_EXITED");
      try {
        webReady = (await fetch(`${env.APP_ORIGIN}/health/ready`)).ok;
      } catch {}
      if (webReady) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!webReady) throw new Error("UI_INFRA_TIMEOUT");
    await run(["--import", "tsx", "scripts/test-financial-ui.ts"]);
  } else {
    await run([
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/api.integration.test.ts",
      "tests/chain-indexer.integration.test.ts",
    ]);
  }
} finally {
  for (const service of services.reverse()) {
    if (service.exitCode === null) {
      service.kill("SIGTERM");
      await Promise.race([
        once(service, "exit"),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
      if (service.exitCode === null) service.kill("SIGKILL");
    }
  }
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  if (started) await pg.stop();
  await rm(directory, { recursive: true, force: true });
}
