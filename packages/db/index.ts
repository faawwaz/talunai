import postgres from "postgres";
import type { TransactionSql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { poolSize, databaseTls } from "./pool-config";
let client: ReturnType<typeof postgres> | undefined;
let ormClient: ReturnType<typeof postgres> | undefined;
let orm: ReturnType<typeof drizzle<typeof schema>> | undefined;
export function getSql() {
  if (!client) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
    client = postgres(process.env.DATABASE_URL, {
      ssl: databaseTls(),
      max: poolSize("DATABASE_POOL_MAX", process.env.VERCEL === "1" ? 2 : 12),
      idle_timeout: 20,
      connect_timeout: 10,
      transform: { undefined: null },
    });
  }
  return client;
}
export function getDb() {
  if (!orm) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
    // Drizzle changes postgres date codecs; isolate its pool from raw transactional SQL.
    ormClient = postgres(process.env.DATABASE_URL, {
      ssl: databaseTls(),
      max: poolSize(
        "DATABASE_ORM_POOL_MAX",
        process.env.VERCEL === "1" ? 1 : 4,
      ),
      idle_timeout: 20,
      connect_timeout: 10,
    });
    orm = drizzle(ormClient, { schema });
  }
  return orm;
}
export async function closeDb() {
  if (client) {
    await client.end();
    client = undefined;
  }
  if (ormClient) {
    await ormClient.end();
    ormClient = undefined;
    orm = undefined;
  }
}
export type DbSql = ReturnType<typeof getSql>;
export type DbTransaction = TransactionSql;
