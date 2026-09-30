import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseDocument } from "../../packages/agents/documents";
import { extractDeterministic } from "../../packages/agents/extraction";
import { quote, waterfall } from "../../packages/domain/finance";
import { artifact, getScenario, save, spec, validateEconomics } from "./common";
import { generateDocuments } from "./documents";

export async function validateDocuments() {
  await generateDocuments();
  validateEconomics();
  const scenario = await getScenario();
  const docs = [];
  for (const filename of [
    "invoice.pdf",
    "delivery-note.pdf",
    "buyer-acknowledgement.pdf",
  ]) {
    const bytes = await readFile(artifact(`documents/${filename}`));
    const parsed = await parseDocument(bytes, filename, "application/pdf");
    assert.equal(parsed.status, "PARSED");
    assert.equal(parsed.pages, 1);
    assert.match(parsed.text, /SIMULASI DEMO\s*-\s*BUKAN TRANSAKSI NYATA/);
    assert.ok(parsed.text.includes(scenario.invoiceNumber));
    docs.push({ id: filename, ...parsed });
    await save(artifact(`qa/${filename}.parsed.json`), parsed);
  }
  const extraction = extractDeterministic(docs);
  const expected: Record<string, string> = {
    issuerName: spec.supplier,
    buyerName: spec.buyer,
    invoiceNumber: scenario.invoiceNumber,
    issueDate: scenario.issueDate,
    invoiceDueDate: scenario.dueDate,
    currency: "IDR",
    invoiceOriginalAmount: spec.invoiceAmountIdr,
    previouslyPaidAmount: spec.previouslyPaidIdr,
    acceptedOutstandingAmount: spec.outstandingIdr,
    goodsDescription: spec.product,
    quantity: spec.quantity,
    quantityUnit: spec.unit,
    purchaseOrderReference: scenario.purchaseOrderReference,
    proofOfDeliveryReference: scenario.deliveryReference,
    buyerAcknowledgementReference: scenario.acknowledgementReference,
  };
  for (const [field, value] of Object.entries(expected))
    assert.equal(
      extraction[field as keyof typeof extraction] &&
        (extraction[field as keyof typeof extraction] as { value: unknown })
          .value,
      value,
      `PDF_EXTRACTION_MISMATCH:${field}`,
    );
  assert.deepEqual(extraction.anomalies, []);
  assert.ok(docs[0].text.includes(scenario.paymentTerms));
  assert.equal(
    quote(spec.outstandingIdr, spec.principalIdr).fixedFee,
    spec.feeIdr,
  );
  const input = {
    principal: spec.principalIdr,
    fixedFee: spec.feeIdr,
    acceptedOutstanding: spec.outstandingIdr,
  };
  const partial = waterfall({ ...input, totalCollected: "50000000" });
  assert.equal(partial.lenderClaimable, "50000000");
  assert.equal(partial.borrowerResidualClaimable, "0");
  const full = waterfall({ ...input, totalCollected: spec.outstandingIdr });
  assert.equal(full.lenderClaimable, spec.lenderEntitlementIdr);
  assert.equal(full.borrowerResidualClaimable, spec.supplierResidualIdr);
  const final = waterfall({
    ...input,
    totalCollected: spec.outstandingIdr,
    lenderWithdrawn: spec.lenderEntitlementIdr,
    borrowerWithdrawn: spec.supplierResidualIdr,
  });
  assert.equal(final.lenderClaimable, "0");
  assert.equal(final.borrowerResidualClaimable, "0");
  assert.throws(
    () => waterfall({ ...input, totalCollected: "100000001" }),
    /INVALID_ACCOUNTING/,
  );
  const changed = docs.map((doc) => ({ ...doc }));
  changed[2].text = changed[2].text.replace(
    /Outstanding diakui: 100\.000\.000/,
    "Outstanding diakui: 99.000.000",
  );
  assert.ok(
    extractDeterministic(changed).anomalies.length > 0,
    "CONFLICT_NOT_DETECTED",
  );
  await save(artifact("qa/offline-validation.json"), {
    status: "PASSED",
    checks: [
      "3 actual PDFs parsed by Talunai parser",
      "Invoice identities/dates/amounts/quantity/references matched",
      "Disclosure visible in PDF text",
      "Conflicting outstanding amount detected",
      "Product fee quote and partial/full/withdrawn waterfall matched",
      "Overpayment rejected",
    ],
    actualOpenRouterRunTested: false,
    actualBlockchainExecutionTested: false,
    extraction,
    expectedWaterfall: full,
  });
  console.log(
    "PASS: PDF parser, provenance-ready fields, conflict detection, dan financial model. Ini bukan bukti eksekusi LLM/chain.",
  );
}
