import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import { type Hex } from "viem";
import { DemoSession } from "../../scripts/demo-lib";
import { actor } from "../../scripts/actors";
import { handleRequest } from "../../packages/api/handler";

export const root = resolve(import.meta.dirname, "../..");
const instanceArg = process.argv.find((arg) => arg.startsWith("--instance="));
export const instance = instanceArg?.slice("--instance=".length) ?? "hero";
assert.match(instance, /^[a-z0-9][a-z0-9-]{0,39}$/);
export const output = resolve(root, "demo-artifacts/coconut-sugar", instance);
export const privateOutput = resolve(root, ".local/coconut-sugar");
export const spec = JSON.parse(
  await readFile(resolve(root, "demo/coconut-sugar/spec.json"), "utf8"),
) as {
  caseKey: string;
  disclosure: string;
  supplier: string;
  buyer: string;
  lender: string;
  product: string;
  category: "OTHER";
  quantity: string;
  unit: string;
  packageCount: number;
  packageWeightKg: number;
  unitPriceIdr: string;
  invoiceAmountIdr: string;
  previouslyPaidIdr: string;
  outstandingIdr: string;
  principalIdr: string;
  feeBps: number;
  feeIdr: string;
  lenderEntitlementIdr: string;
  supplierResidualIdr: string;
  paymentTermDays: number;
  fundingWindowSeconds: number;
  settlementTiming: string;
  taxAssumption: string;
  bankAssumption: string;
  chainId: number;
  token: string;
  officialIdrtIntegrated: boolean;
};
export const research = JSON.parse(
  await readFile(resolve(root, "demo/coconut-sugar/research.json"), "utf8"),
);
export const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export const json = (value: unknown) =>
  JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n";
export async function save(path: string, value: unknown, privateFile = false) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, json(value), { mode: privateFile ? 0o600 : 0o644 });
  await rename(tmp, path);
  if (privateFile) await chmod(path, 0o600);
}
export async function read<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export const artifact = (name: string) => resolve(output, name);
export type Role = "borrower" | "buyer" | "lender" | "verifier" | "admin";
export type Scenario = {
  instance: string;
  issueDate: string;
  dueDate: string;
  invoiceDueAt: number;
  invoiceNumber: string;
  purchaseOrderReference: string;
  deliveryReference: string;
  acknowledgementReference: string;
  paymentTerms: string;
};
export type TransactionRecord = {
  action: string;
  hash: Hex;
  status: "SIGNED" | "CONFIRMED";
  intentId?: string;
  blockNumber?: string;
  blockHash?: string;
  explorerUrl?: string;
};
export type CaseState = {
  executionStatus:
    "NOT_EXECUTED" | "PREPARED" | "RUNNING" | "COMPLETED" | "BLOCKED";
  stage: string;
  organizations: Partial<Record<Role, string>>;
  documents: Array<{
    documentId: string;
    version: number;
    filename: string;
    sha256: string;
  }>;
  transactions: TransactionRecord[];
  claimId?: string;
  runId?: string;
  baselines?: Record<string, string>;
  stageRecords: Array<{ stage: string; observedAt: string; data: unknown }>;
};
export async function state() {
  return (
    (await read<CaseState>(artifact("case-state.json"))) ?? {
      executionStatus: "NOT_EXECUTED",
      stage: "DOCUMENTS",
      organizations: {},
      documents: [],
      transactions: [],
      stageRecords: [],
    }
  );
}
export async function checkpoint(s: CaseState, stage: string, data?: unknown) {
  s.stage = stage;
  if (data !== undefined)
    s.stageRecords.push({ stage, observedAt: new Date().toISOString(), data });
  await save(artifact("case-state.json"), s);
  console.log(json({ stage, claimId: s.claimId ?? null }).trim());
}
export async function getScenario(): Promise<Scenario> {
  const existing = await read<Scenario>(artifact("scenario.json"));
  if (existing) return existing;
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const issueDate = midnight.toISOString().slice(0, 10);
  const due = new Date(midnight.getTime() + spec.paymentTermDays * 86400_000);
  const stamp = issueDate.replaceAll("-", "");
  const suffix = instance.toUpperCase();
  const scenario: Scenario = {
    instance,
    issueDate,
    dueDate: due.toISOString().slice(0, 10),
    invoiceDueAt: due.getTime() / 1000,
    invoiceNumber: `INV/GKN/${stamp}/${suffix}`,
    purchaseOrderReference: `PO/DEMO/GKN/${stamp}/${suffix}`,
    deliveryReference: `DN/DEMO/GKN/${stamp}/${suffix}`,
    acknowledgementReference: `ACK/DEMO/GKN/${stamp}/${suffix}`,
    paymentTerms: `NET ${spec.paymentTermDays} hari sejak tanggal invoice`,
  };
  await save(artifact("scenario.json"), scenario);
  return scenario;
}
export function validateEconomics() {
  for (const name of [
    "quantity",
    "unitPriceIdr",
    "invoiceAmountIdr",
    "previouslyPaidIdr",
    "outstandingIdr",
    "principalIdr",
    "feeIdr",
    "lenderEntitlementIdr",
    "supplierResidualIdr",
  ] as const)
    assert.match(spec[name], /^(0|[1-9][0-9]*)$/);
  assert.equal(
    BigInt(spec.quantity) * BigInt(spec.unitPriceIdr),
    BigInt(spec.invoiceAmountIdr),
  );
  assert.equal(
    BigInt(spec.packageCount * spec.packageWeightKg),
    BigInt(spec.quantity),
  );
  assert.equal(
    BigInt(spec.invoiceAmountIdr) - BigInt(spec.previouslyPaidIdr),
    BigInt(spec.outstandingIdr),
  );
  assert.equal(
    (BigInt(spec.principalIdr) * BigInt(spec.feeBps)) / 10_000n,
    BigInt(spec.feeIdr),
  );
  assert.equal(
    BigInt(spec.principalIdr) + BigInt(spec.feeIdr),
    BigInt(spec.lenderEntitlementIdr),
  );
  assert.equal(
    BigInt(spec.outstandingIdr) - BigInt(spec.lenderEntitlementIdr),
    BigInt(spec.supplierResidualIdr),
  );
  assert.equal(spec.chainId, 97);
  assert.equal(spec.token, "MockIDR");
}
export async function accounts(): Promise<Record<Role, PrivateKeyAccount>> {
  const path = resolve(privateOutput, "wallets.json");
  let keys = await read<Record<"borrower" | "buyer" | "lender", Hex>>(path);
  if (!keys) {
    keys = {
      borrower: generatePrivateKey(),
      buyer: generatePrivateKey(),
      lender: generatePrivateKey(),
    };
    await save(path, keys, true);
  }
  const keySchema = z.string().regex(/^0x[0-9a-f]{64}$/);
  for (const value of Object.values(keys)) keySchema.parse(value);
  const configuredAccount = (role: "admin" | "verifier") => {
    const supplied = process.env[`DEMO_${role.toUpperCase()}_PRIVATE_KEY`];
    keySchema.parse(supplied);
    const account = privateKeyToAccount(supplied as Hex);
    assert.equal(account.address, actor(role).address);
    return account;
  };
  const result = {
    borrower: privateKeyToAccount(keys.borrower),
    buyer: privateKeyToAccount(keys.buyer),
    lender: privateKeyToAccount(keys.lender),
    verifier: configuredAccount("verifier"),
    admin: configuredAccount("admin"),
  };
  assert.equal(
    new Set(Object.values(result).map((a) => a.address.toLowerCase())).size,
    5,
    "ACTOR_CONFLICT",
  );
  const names: Record<Role, string> = {
    borrower: "Raka Prasetya",
    buyer: "Dimas Pratama",
    lender: "Nadia Putri",
    verifier: "Ayu Wulandari",
    admin: "Operator Talunai",
  };
  await save(
    artifact("identities.json"),
    Object.entries(result).map(([role, a]) => ({
      role: role.toUpperCase(),
      address: a.address,
      narrativeName: names[role as Role],
      isSynthetic: true,
      isActualEmployee: false,
      privateKeyExported: false,
      note: "Nama manusia adalah aktor narasi fiktif. Produk saat ini menampilkan organisasi/wallet, bukan profil manusia.",
    })),
  );
  return result;
}
export function validateEnvironment() {
  assert.equal(process.env.APP_ENV, "testnet", "CASE_REQUIRES_TESTNET");
  assert.equal(process.env.CHAIN_ID, "97", "CASE_REQUIRES_CHAIN_97");
  assert.equal(process.env.LLM_MODE, "live", "CASE_REQUIRES_LIVE_PROVIDER");
  assert.ok(process.env.OPENROUTER_API_KEY, "OPENROUTER_KEY_REQUIRED");
  const origin = new URL(process.env.APP_ORIGIN!);
  assert.ok(
    ["localhost", "127.0.0.1"].includes(origin.hostname),
    "CASE_LOCAL_APP_ONLY",
  );
  assert.equal(origin.protocol, "https:");
}
let bridgeInstalled = false;
export function installApiBridge() {
  if (bridgeInstalled) return;
  bridgeInstalled = true;
  const nativeFetch = globalThis.fetch;
  const origin = new URL(process.env.APP_ORIGIN!).origin;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      url.origin === origin &&
      (url.pathname.startsWith("/v1/") || url.pathname.startsWith("/health/"))
    )
      return handleRequest(new Request(input, init));
    return nativeFetch(input, init);
  };
}
export class CaseSession extends DemoSession {
  declare account: PrivateKeyAccount;
  constructor(role: Role, account: PrivateKeyAccount) {
    super(role);
    this.account = account;
  }
  override async request<T = Record<string, unknown>>(
    path: string,
    method = "GET",
    body?: unknown,
    key: string = randomUUID(),
    expected?: number,
  ): Promise<T> {
    const digest = sha256(key);
    const stableUuid =
      `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}` as ReturnType<
        typeof randomUUID
      >;
    return super.request<T>(path, method, body, stableUuid, expected);
  }
}
export async function sessions(a: Record<Role, PrivateKeyAccount>) {
  installApiBridge();
  const result = {} as Record<Role, CaseSession>;
  for (const role of [
    "admin",
    "verifier",
    "borrower",
    "buyer",
    "lender",
  ] as const)
    result[role] = await new CaseSession(role, a[role]).login();
  return result;
}
export async function waitFor<T>(
  readValue: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  timeout = 150_000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await readValue();
    if (predicate(value)) return value;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`CASE_WAIT_TIMEOUT:${label}`);
}
export function safeError(e: unknown) {
  const error = e as NodeJS.ErrnoException;
  if (error.code === "EPERM" || error.code === "EACCES")
    return "NETWORK_OR_PROCESS_PERMISSION_DENIED";
  return String(error.message ?? "CASE_FAILED")
    .replace(/sk-or-v1-[a-zA-Z0-9-]+/g, "[REDACTED]")
    .replace(/0x[a-fA-F0-9]{64}/g, "[HASH_OR_SECRET_REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[DATABASE_URL_REDACTED]")
    .slice(0, 1200);
}
export async function exportTruth(s: CaseState) {
  await save(artifact("demo-truth.json"), {
    schemaVersion: 1,
    caseKey: spec.caseKey,
    instance,
    generatedAt: new Date().toISOString(),
    executionStatus: s.executionStatus,
    stage: s.stage,
    PUBLIC_FACT: research.sources,
    SYNTHETIC_CASE_DATA: {
      ...spec,
      ...(await getScenario()),
      supplierIsFictitious: true,
      buyerIsRepresentedByDemoAccount: true,
      actualUnileverOrder: false,
    },
    ACTUAL_PRODUCT_BEHAVIOR: {
      implementation:
        "SIWE + organization RBAC; live OpenRouter extraction and deterministic checks; independent verifier; EIP-712 consent; registry/vault execution; canonical projection",
      observations: s.stageRecords,
      transactions: s.transactions.filter((tx) => tx.status === "CONFIRMED"),
      claimId: s.claimId ?? null,
      runId: s.runId ?? null,
      runtimeProven: s.executionStatus === "COMPLETED",
    },
    TESTNET: {
      chainId: 97,
      network: "BNB Chain Testnet",
      token: "MockIDR",
      displayedSettlementLabel: "IDRT",
      displayedLabelIsSimulation: true,
      simulatedAssetNoRealValue: true,
      officialIdrtIntegrated: false,
    },
    PLANNED:
      s.executionStatus === "COMPLETED"
        ? []
        : [
            "Eksekusi penuh case baru dan capture screenshot belum terbukti sampai run selesai",
          ],
    boundaries: [
      "Tidak menyatakan hubungan bisnis/endorsement Unilever",
      "Bukan pemeriksaan KYB/legal title atau credit/default guarantee",
      "Agent tidak menyetujui pendanaan",
      "Tempo 45 hari dan harga kontrak adalah asumsi",
      "Video lama tidak otomatis menjadi bukti case baru",
    ],
  });
}
