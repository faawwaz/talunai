import { createHash, createHmac, randomBytes } from "node:crypto";

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function snapshotHash(value: unknown): `0x${string}` {
  return `0x${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}
export function normalizeInvoiceNumber(number: string): string {
  const normalized = number
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (
    !normalized ||
    normalized.length > 160 ||
    !/^[A-Z0-9/_.-]+$/.test(normalized)
  )
    throw new Error("INVALID_INVOICE_NUMBER");
  return normalized;
}
export function claimIdentity(
  orgId: string,
  namespace: string,
  invoiceNumber: string,
): string {
  if (!orgId || !namespace || namespace.length > 80)
    throw new Error("INVALID_CLAIM_IDENTITY");
  return stableJson([
    orgId,
    namespace.normalize("NFKC").trim().toUpperCase(),
    normalizeInvoiceNumber(invoiceNumber),
  ]);
}
/** Canonical DB unique(org, namespace, normalized number) MUST survive key rotation. */
export function deriveClaimKey(
  orgId: string,
  namespace: string,
  invoiceNumber: string,
  hmacKey: string,
): `0x${string}` {
  if (Buffer.byteLength(hmacKey) < 32) throw new Error("WEAK_HMAC_KEY");
  return `0x${createHmac("sha256", hmacKey)
    .update(claimIdentity(orgId, namespace, invoiceNumber))
    .digest("hex")}`;
}
export function documentCommitment(bytes: Uint8Array, salt = randomBytes(32)) {
  return {
    salt: salt.toString("hex"),
    commitment:
      `0x${createHash("sha256").update(salt).update(bytes).digest("hex")}` as const,
  };
}
