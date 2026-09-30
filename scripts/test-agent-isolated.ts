import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("ISOLATED_PORT_UNAVAILABLE");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function run(args: string[], env: NodeJS.ProcessEnv) {
  const command = spawn(process.execPath, args, { env, stdio: "inherit" });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    command.once("error", reject);
    command.once("exit", resolve);
  });
  if (exitCode !== 0)
    throw new Error(`ISOLATED_TEST_COMMAND_FAILED:${exitCode}`);
}

const directory = await mkdtemp(join(tmpdir(), "talunai-agent-test-"));
const port = await availablePort();
const database = new EmbeddedPostgres({
  databaseDir: join(directory, "pg"),
  user: "agent_test",
  password: "isolated-only",
  port,
  persistent: false,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
  NODE_ENV: "test",
  APP_ENV: "local",
  CHAIN_ID: "31337",
  LLM_MODE: "mock",
  DATABASE_URL: `postgres://agent_test:isolated-only@127.0.0.1:${port}/agent_test`,
};
let started = false;
try {
  await database.initialise();
  await database.start();
  started = true;
  await database.createDatabase("agent_test");
  await run(["--import", "tsx", "scripts/migrate.ts"], env);
  await run(
    ["node_modules/vitest/vitest.mjs", "run", "tests/agents-db.test.ts"],
    env,
  );
} finally {
  if (started) await database.stop();
  await rm(directory, { recursive: true, force: true });
}
