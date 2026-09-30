import { readdir, readFile } from "node:fs/promises";
import { getSql, closeDb } from "../packages/db/index";
const sql = getSql();
await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
for (const name of (
  await readdir(new URL("../packages/db/migrations/", import.meta.url))
)
  .filter((n) => n.endsWith(".sql"))
  .sort()) {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(716253819)`;
    const applied =
      await tx`SELECT name FROM schema_migrations WHERE name=${name}`;
    if (applied.length) return;
    await tx.unsafe(
      await readFile(
        new URL(`../packages/db/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
    await tx`INSERT INTO schema_migrations(name) VALUES(${name})`;
    console.log(`Applied ${name}`);
  });
}
await closeDb();
