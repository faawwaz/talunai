/** Publish only allowlisted, synthetic case evidence. No DB, keys, LLM or RPC. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

const root = "demo-artifacts/coconut-sugar/hero";
const read = async (name: string) =>
  JSON.parse(await readFile(`${root}/${name}`, "utf8"));
const [truth, summary, agent, extracted, evidence, final, allocated] =
  await Promise.all(
    [
      "demo-truth.json",
      "case-summary.json",
      "agent-run.json",
      "agent-extraction.json",
      "evidence.json",
      "financing-final.json",
      "settlement-before-withdrawal.json",
    ].map(read),
  );
assert.equal(truth.executionStatus, "COMPLETED");
assert.equal(truth.ACTUAL_PRODUCT_BEHAVIOR.runtimeProven, true);
assert.equal(summary.submissionEvidence.ready, true);
assert.equal(agent.mode, "live");
assert.equal(agent.status, "COMPLETED");
assert.equal(agent.result.provider, "openrouter");
assert.deepEqual(agent.result.conflicts, []);
assert.equal(evidence.review.decision, "APPROVE");
assert.equal(final.claimId, truth.ACTUAL_PRODUCT_BEHAVIOR.claimId);
assert.equal(agent.claimId, final.claimId);
assert.equal(extracted.claimId, final.claimId);
assert.equal(extracted.runId, agent.id);
assert.equal(final.chainId, 97);
const a = summary.assumptions;
assert.equal(final.principal, a.principalIdr);
assert.equal(final.fixedFee, a.feeIdr);
assert.equal(final.totalCollected, a.invoiceAmountIdr);
assert.equal(final.lenderWithdrawn, a.lenderEntitlementIdr);
assert.equal(final.borrowerWithdrawn, a.supplierResidualIdr);
assert.equal(
  BigInt(final.totalCollected),
  BigInt(final.lenderWithdrawn) + BigInt(final.borrowerWithdrawn),
);
const observations = truth.ACTUAL_PRODUCT_BEHAVIOR.observations;
const stage = (name: string) => {
  const value = observations.find(
    (item: { stage: string }) => item.stage === name,
  );
  assert.ok(value, `Missing actual stage: ${name}`);
  return value;
};
for (const role of ["BORROWER", "BUYER"]) {
  assert.ok(
    evidence.consents.some(
      (c: { role: string; version: number; revoked: boolean }) =>
        c.role === role && c.version === evidence.review.version && !c.revoked,
    ),
  );
}
const transactions: Record<
  string,
  { hash: string; blockNumber: string; observedAt: string }
> = {};
for (const [key, action] of Object.entries({
  registered: "VERIFIER_REGISTER",
  funded: "LENDER_FUND",
  paid: "BUYER_COLLECT_BUYER_PAYMENT",
  lender: "LENDER_WITHDRAW_LENDER",
  supplier: "BORROWER_WITHDRAW_BORROWER",
})) {
  const tx = truth.ACTUAL_PRODUCT_BEHAVIOR.transactions.find(
    (t: { action: string }) => t.action === action,
  );
  assert.ok(tx && tx.status === "CONFIRMED");
  const receipt = await read(`transactions/${action}.receipt.json`);
  assert.equal(receipt.status, "success");
  assert.equal(receipt.transactionHash, tx.hash);
  assert.equal(receipt.blockHash, tx.blockHash);
  transactions[key] = {
    hash: tx.hash,
    blockNumber: tx.blockNumber,
    observedAt: stage(action).observedAt,
  };
}
const publicDir = "public/demo/coconut-sugar";
await mkdir(publicDir, { recursive: true });
const documents = [];
for (const [filename, title] of [
  ["invoice.pdf", "Invoice"],
  ["delivery-note.pdf", "Bukti pengiriman"],
  ["buyer-acknowledgement.pdf", "Pengakuan buyer"],
]) {
  const bytes = await readFile(`${root}/documents/${filename}`);
  documents.push({
    title,
    url: `/demo/coconut-sugar/${filename}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  await copyFile(`${root}/documents/${filename}`, `${publicDir}/${filename}`);
}
// Preview is rendered from the actual archived PDF, never a generated invoice.
execFileSync("pdftoppm", [
  "-f",
  "1",
  "-singlefile",
  "-scale-to",
  "1100",
  "-png",
  `${root}/documents/invoice.pdf`,
  `${publicDir}/invoice-preview`,
]);
await sharp(`${publicDir}/invoice-preview.png`)
  .webp({ quality: 88 })
  .toFile(`${publicDir}/invoice-preview.webp`);
const { unlink } = await import("node:fs/promises");
await unlink(`${publicDir}/invoice-preview.png`);
const cleanName = (value: string) =>
  value.replace(/ \((Fiktif|Simulasi) Talunai\)$/, "");
const finance = (v: Record<string, string>) =>
  Object.fromEntries(
    [
      "totalCollected",
      "lenderAllocated",
      "lenderClaimable",
      "lenderWithdrawn",
      "borrowerResidualClaimable",
      "borrowerWithdrawn",
      "remainingInvoiceCollection",
      "financingStatus",
      "collectionStatus",
    ].map((k) => [k, v[k]]),
  );
const fields = extracted.extraction;
for (const [key, expected] of Object.entries({
  invoiceOriginalAmount: a.invoiceAmountIdr,
  invoiceDueDate: a.dueDate,
  buyerName: a.buyer,
  proofOfDeliveryReference: a.deliveryReference,
  buyerAcknowledgementReference: a.acknowledgementReference,
}))
  assert.equal(fields[key].value, expected);
const snapshot = {
  schemaVersion: 1,
  source: root,
  executionStatus: "COMPLETED",
  recordedAt: truth.generatedAt,
  deal: {
    id: final.claimId,
    invoiceNumber: a.invoiceNumber,
    supplier: cleanName(a.supplier),
    buyer: cleanName(a.buyer),
    product: a.product,
    quantity: a.quantity,
    unit: a.unit,
    issueDate: a.issueDate,
    dueDate: a.dueDate,
    paymentTermDays: a.paymentTermDays,
    invoiceAmount: a.invoiceAmountIdr,
    principal: final.principal,
    fee: final.fixedFee,
    feeBps: a.feeBps,
    lenderEntitlement: final.lenderWithdrawn,
    supplierResidual: final.borrowerWithdrawn,
    version: evidence.review.version,
  },
  network: {
    chainId: 97,
    name: "BNB Chain Testnet",
    displayToken: "IDRT uji",
    contractToken: final.paymentToken.symbol,
    tokenAddress: final.paymentToken.address,
    officialIdrtIntegrated: false,
  },
  documents,
  agent: {
    runId: agent.id,
    provider: agent.result.provider,
    model: agent.result.model,
    mode: agent.mode,
    completedAt: agent.updatedAt,
    workflow: agent.result.workflow,
    conflicts: agent.result.conflicts,
    missingFields: fields.missingFields,
    checks: [
      {
        label: "Nilai invoice cocok",
        detail: "Sesuai nilai tagihan yang diajukan.",
        field: "invoiceOriginalAmount",
        value: fields.invoiceOriginalAmount.value,
      },
      {
        label: "Pengakuan buyer ditemukan",
        detail: "Nilai dan jatuh tempo didukung dokumen buyer.",
        field: "buyerAcknowledgementReference",
        value: fields.buyerAcknowledgementReference.value,
      },
      {
        label: "Bukti pengiriman tersedia",
        detail: "Referensi penyerahan cocok dengan invoice.",
        field: "proofOfDeliveryReference",
        value: fields.proofOfDeliveryReference.value,
      },
      {
        label: "Jatuh tempo konsisten",
        detail: "Tanggal pada bukti sesuai ketentuan deal.",
        field: "invoiceDueDate",
        value: fields.invoiceDueDate.value,
      },
    ],
  },
  review: {
    decision: evidence.review.decision,
    recordedAt: evidence.review.createdAt,
    version: evidence.review.version,
  },
  consents: ["BORROWER", "BUYER"].map((role) => ({
    role,
    version: evidence.review.version,
    recordedAt: stage(`${role}_TERMS_SIGNED`).observedAt,
  })),
  financing: {
    funded: finance(stage("SUPPLIER_RECEIVED_CAPITAL").data.financing),
    allocated: finance(allocated),
    completed: finance(final),
  },
  transactions,
};
await writeFile(
  "src/features/demo/case-snapshot.json",
  JSON.stringify(snapshot, null, 2) + "\n",
);
console.log(
  `Published ${final.claimId}: ${documents.length} PDFs, 5 verified receipt references, live agent result. No secrets or signatures exported.`,
);
