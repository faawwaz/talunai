import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";

// Disposable database only; never reads the application's .env files.
const directory = await mkdtemp(join(tmpdir(), "talunai-workflow-"));
const server = createServer();
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("PORT_UNAVAILABLE");
const port = address.port;
await new Promise<void>((resolve) => server.close(() => resolve()));
const pg = new EmbeddedPostgres({
  databaseDir: join(directory, "pg"),
  user: "workflow_test",
  password: "isolated-only",
  port,
  persistent: false,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
let started = false;
const env = {
  ...process.env,
  DATABASE_URL: `postgres://workflow_test:isolated-only@127.0.0.1:${port}/workflow_test`,
};
async function run(args: string[]) {
  const child = spawn(process.execPath, args, { env, stdio: "inherit" });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`TEST_COMMAND_FAILED_${code}`);
}
try {
  await pg.initialise();
  await pg.start();
  started = true;
  await pg.createDatabase("workflow_test");
  await run(["--import", "tsx", "scripts/migrate.ts"]);
  await run([
    "node_modules/vitest/vitest.mjs",
    "run",
    "tests/agents-db.test.ts",
  ]);
} finally {
  if (started) await pg.stop();
  await rm(directory, { recursive: true, force: true });
}
