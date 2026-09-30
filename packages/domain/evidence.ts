import { z } from "zod";

export const EvidenceStatus = z.enum([
  "MISSING",
  "PENDING",
  "SUPPORTED_BY_DOCUMENT",
  "ATTESTED",
  "REJECTED",
  "STALE",
  "NOT_INTEGRATED",
]);
export type EvidenceStatus = z.infer<typeof EvidenceStatus>;
export const EVIDENCE_KEYS = [
  "extractionStatus",
  "issuerAuthorityStatus",
  "buyerAuthorityStatus",
  "buyerAcknowledgementStatus",
  "deliveryEvidenceStatus",
  "duplicateCheckStatus",
  "externalEncumbranceCheckStatus",
  "humanReviewStatus",
] as const;
export type EvidenceState = Record<
  (typeof EVIDENCE_KEYS)[number],
  EvidenceStatus
>;
export const emptyEvidence = (): EvidenceState => ({
  extractionStatus: "PENDING",
  issuerAuthorityStatus: "MISSING",
  buyerAuthorityStatus: "MISSING",
  buyerAcknowledgementStatus: "MISSING",
  deliveryEvidenceStatus: "MISSING",
  duplicateCheckStatus: "PENDING",
  externalEncumbranceCheckStatus: "NOT_INTEGRATED",
  humanReviewStatus: "PENDING",
});

export const FieldSchema = z
  .object({
    value: z.string().nullable(),
    rawText: z.string().nullable(),
    documentId: z.string().nullable(),
    page: z.number().int().positive().nullable(),
    line: z.number().int().positive().nullable(),
  })
  .strict();
export const EXTRACTION_KEYS = [
  "issuerName",
  "buyerName",
  "invoiceNumber",
  "issueDate",
  "invoiceDueDate",
  "currency",
  "invoiceOriginalAmount",
  "previouslyPaidAmount",
  "acceptedOutstandingAmount",
  "goodsDescription",
  "goodsCategory",
  "quantity",
  "quantityUnit",
  "purchaseOrderReference",
  "proofOfDeliveryReference",
  "buyerAcknowledgementReference",
] as const;
const fields = Object.fromEntries(
  EXTRACTION_KEYS.map((key) => [key, FieldSchema]),
) as Record<(typeof EXTRACTION_KEYS)[number], typeof FieldSchema>;
export const ExtractionSchema = z
  .object({
    ...fields,
    anomalies: z.array(
      z
        .object({
          code: z.string(),
          documentId: z.string(),
          rawText: z.string(),
        })
        .strict(),
    ),
    missingFields: z.array(z.enum(EXTRACTION_KEYS)),
  })
  .strict();
export type Extraction = z.infer<typeof ExtractionSchema>;
export type SourceDocument = {
  id: string;
  text: string;
  pages: number;
  status: "PARSED" | "NEEDS_MANUAL_ENTRY";
};
export const emptyField = () => ({
  value: null,
  rawText: null,
  documentId: null,
  page: null,
  line: null,
});

/** Schema conformance is insufficient: every citation must exist in authorized source text. */
export function validateExtraction(
  value: unknown,
  documents: SourceDocument[],
): Extraction {
  const parsed = ExtractionSchema.parse(value);
  const source = new Map(documents.map((doc) => [doc.id, doc]));
  for (const key of EXTRACTION_KEYS) {
    const field = parsed[key];
    if (field.value === null) continue;
    const document = field.documentId
      ? source.get(field.documentId)
      : undefined;
    if (!document || !field.rawText || !document.text.includes(field.rawText))
      throw new Error("UNSUPPORTED_EVIDENCE_REFERENCE");
    if (field.page !== null && field.page > document.pages)
      throw new Error("INVALID_EVIDENCE_LOCATION");
    if (
      field.line !== null &&
      document.text.split("\n")[field.line - 1]?.includes(field.rawText) !==
        true
    )
      throw new Error("INVALID_EVIDENCE_LOCATION");
  }
  for (const anomaly of parsed.anomalies) {
    if (!source.get(anomaly.documentId)?.text.includes(anomaly.rawText))
      throw new Error("UNSUPPORTED_EVIDENCE_REFERENCE");
  }
  return parsed;
}
