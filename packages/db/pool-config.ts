export function poolSize(key: string, fallback: number) {
  const value =
    process.env[key] === undefined ? fallback : Number(process.env[key]);
  if (!Number.isSafeInteger(value) || value < 1 || value > 32)
    throw new Error(`INVALID_POOL_SIZE:${key}`);
  return value;
}
import { X509Certificate } from "node:crypto";

export function databaseTls() {
  const encoded = process.env.DATABASE_SSL_CA_BASE64;
  if (!encoded) return undefined;
  const ca = Buffer.from(encoded, "base64").toString("utf8");
  try {
    new X509Certificate(ca);
  } catch {
    throw new Error("INVALID_DATABASE_SSL_CA");
  }
  return { ca, rejectUnauthorized: true };
}
