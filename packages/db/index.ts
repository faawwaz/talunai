import postgres from "postgres";
import type { TransactionSql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { poolSize, databaseTls } from "./pool-config";
import { after } from "next/server.js";
let client: ReturnType<typeof postgres> | undefined;
let ormClient: ReturnType<typeof postgres> | undefined;
let orm: ReturnType<typeof drizzle<typeof schema>> | undefined;
function allowIdleConnectionsToClose() {
  if (process.env.VERCEL !== "1") return;
  // Fluid Compute can suspend before postgres.js idle timers fire. Keep the
  // request alive briefly AFTER its response so idle sessions are released.
  // Never end a shared pool: another request may still be using it.
  after(() => new Promise<void>((resolve) => setTimeout(resolve, 2500)));
}
export function getSql() {
  allowIdleConnectionsToClose();
  if (!client) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
    client = postgres(process.env.DATABASE_URL, {
      ssl: databaseTls(),
      max: poolSize("DATABASE_POOL_MAX", process.env.VERCEL === "1" ? 1 : 12),
      idle_timeout: process.env.VERCEL === "1" ? 2 : 20,
      connect_timeout: 10,
      transform: { undefined: null },
    });
  }
  return client;
}
export function getDb() {
  allowIdleConnectionsToClose();
  if (!orm) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
    // Drizzle changes postgres date codecs; isolate its pool from raw transactional SQL.
    ormClient = postgres(process.env.DATABASE_URL, {
      ssl: databaseTls(),
      max: poolSize(
        "DATABASE_ORM_POOL_MAX",
        process.env.VERCEL === "1" ? 1 : 4,
      ),
      idle_timeout: process.env.VERCEL === "1" ? 2 : 20,
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
