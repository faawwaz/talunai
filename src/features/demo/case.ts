import { z } from "zod";
import snapshot from "./case-snapshot.json";

const amount = z.string().regex(/^\d+$/);
const hash = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const financialState = z.object({
  totalCollected: amount,
  lenderAllocated: amount,
  lenderClaimable: amount,
  lenderWithdrawn: amount,
  borrowerResidualClaimable: amount,
  borrowerWithdrawn: amount,
  remainingInvoiceCollection: amount,
  financingStatus: z.enum(["ACTIVE", "REPAID"]),
  collectionStatus: z.enum(["UNPAID", "FULLY_COLLECTED"]),
});
const transaction = z.object({
  hash,
  blockNumber: amount,
  observedAt: z.iso.datetime(),
});
export const DemoCaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.string(),
    executionStatus: z.literal("COMPLETED"),
    recordedAt: z.iso.datetime(),
    deal: z.object({
      id: z.uuid(),
      invoiceNumber: z.string().min(1),
      supplier: z.string().min(1),
      buyer: z.string().min(1),
      product: z.string(),
      quantity: amount,
      unit: z.string(),
      issueDate: z.iso.date(),
      dueDate: z.iso.date(),
      paymentTermDays: z.number().positive(),
      invoiceAmount: amount,
      principal: amount,
      fee: amount,
      feeBps: z.number().int(),
      lenderEntitlement: amount,
      supplierResidual: amount,
      version: z.number().int(),
    }),
    network: z.object({
      chainId: z.literal(97),
      name: z.literal("BNB Chain Testnet"),
      displayToken: z.literal("IDRT uji"),
      contractToken: z.literal("MockIDR"),
      tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      officialIdrtIntegrated: z.literal(false),
    }),
    documents: z
      .array(
        z.object({
          title: z.string(),
          url: z.string().regex(/^\/demo\/coconut-sugar\/[a-z-]+\.pdf$/),
          sha256: z.string().length(64),
        }),
      )
      .length(3),
    agent: z.object({
      runId: z.uuid(),
      provider: z.literal("openrouter"),
      model: z.string(),
      mode: z.literal("live"),
      completedAt: z.iso.datetime(),
      workflow: z.literal("READY_FOR_SIGNATURES"),
      conflicts: z.array(z.string()).length(0),
      missingFields: z.array(z.string()),
      checks: z
        .array(
          z.object({
            label: z.string(),
            detail: z.string(),
            field: z.string(),
            value: z.string(),
          }),
        )
        .length(4),
    }),
    review: z.object({
      decision: z.literal("APPROVE"),
      recordedAt: z.iso.datetime(),
      version: z.number().int(),
    }),
    consents: z
      .array(
        z.object({
          role: z.enum(["BORROWER", "BUYER"]),
          version: z.number().int(),
          recordedAt: z.iso.datetime(),
        }),
      )
      .length(2),
    financing: z.object({
      funded: financialState,
      allocated: financialState,
      completed: financialState,
    }),
    transactions: z.object({
      registered: transaction,
      funded: transaction,
      paid: transaction,
      lender: transaction,
      supplier: transaction,
    }),
  })
  .superRefine((v, ctx) => {
    const d = v.deal,
      f = v.financing;
    const valid =
      BigInt(d.principal) + BigInt(d.fee) === BigInt(d.lenderEntitlement) &&
      BigInt(d.lenderEntitlement) + BigInt(d.supplierResidual) ===
        BigInt(d.invoiceAmount) &&
      BigInt(d.fee) * 10000n === BigInt(d.principal) * BigInt(d.feeBps) &&
      f.allocated.totalCollected === d.invoiceAmount &&
      f.completed.totalCollected === d.invoiceAmount &&
      f.allocated.lenderClaimable === d.lenderEntitlement &&
      f.allocated.borrowerResidualClaimable === d.supplierResidual &&
      f.completed.lenderWithdrawn === d.lenderEntitlement &&
      f.completed.borrowerWithdrawn === d.supplierResidual &&
      f.completed.lenderClaimable === "0" &&
      f.completed.borrowerResidualClaimable === "0" &&
      v.consents.every((c) => c.version === v.review.version) &&
      new Set(v.consents.map((c) => c.role)).size === 2;
    if (!valid)
      ctx.addIssue({
        code: "custom",
        message: "Canonical case evidence is inconsistent",
      });
  });
export type DemoCase = z.infer<typeof DemoCaseSchema>;
export type DemoTransaction = keyof DemoCase["transactions"];
export function readDemoCase(value: unknown = snapshot): DemoCase | null {
  const result = DemoCaseSchema.safeParse(value);
  return result.success ? result.data : null;
}
export function transactionUrl(data: DemoCase, key: DemoTransaction) {
  return `https://testnet.bscscan.com/tx/${data.transactions[key].hash}`;
}
export const rupiah = (value: string) =>
  `Rp${BigInt(value).toLocaleString("id-ID")}`;
export const caseDate = (value: string) =>
  new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
