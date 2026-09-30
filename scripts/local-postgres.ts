import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
if (process.env.APP_ENV && process.env.APP_ENV !== "local")
  throw new Error("LOCAL_ONLY");
const databaseDir = resolve(".local/postgres");
mkdirSync(".local", { recursive: true });
const pg = new EmbeddedPostgres({
  databaseDir,
  user: "talunai",
  password: "talunai-local-only",
  port: 55432,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: (message: unknown) => console.error(String(message)),
});
async function main() {
  if (!existsSync(`${databaseDir}/PG_VERSION`)) await pg.initialise();
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();
  const existing = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = 'talunai'",
  );
  if (existing.rowCount === 0) await pg.createDatabase("talunai");
  await client.end();
  console.log(
    "Local PostgreSQL ready at 127.0.0.1:55432, database talunai (synthetic demo only).",
  );
  let stopped = false;
  const stop = async () => {
    if (!stopped) {
      stopped = true;
      await pg.stop();
      process.exit(0);
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  setInterval(() => {}, 30_000);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
