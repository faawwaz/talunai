import {
  EXTRACTION_KEYS,
  emptyField,
  validateExtraction,
  type Extraction,
  type SourceDocument,
} from "../domain/evidence";
import {
  parseDocumentDate,
  parseLocalizedMoney,
  parseLocalizedDecimal,
} from "../domain/money";

const labels: Record<(typeof EXTRACTION_KEYS)[number], string[]> = {
  issuerName: ["issuername", "penerbit", "penjual"],
  buyerName: ["buyername", "buyer", "pembeli"],
  invoiceNumber: ["invoicenumber", "nomor invoice", "nomor faktur"],
  issueDate: ["issuedate", "tanggal invoice"],
  invoiceDueDate: ["invoiceduedate", "jatuh tempo"],
  currency: ["currency", "mata uang"],
  invoiceOriginalAmount: ["invoiceoriginalamount", "nilai invoice awal"],
  previouslyPaidAmount: ["previouslypaidamount", "sudah dibayar"],
  acceptedOutstandingAmount: [
    "acceptedoutstandingamount",
    "outstanding diakui",
  ],
  goodsDescription: [
    "goodsdescription",
    "deskripsi barang",
    "commodity",
    "komoditas",
  ],
  goodsCategory: ["goodscategory", "kategori barang"],
  quantity: ["quantity", "kuantitas"],
  quantityUnit: ["quantityunit", "satuan"],
  purchaseOrderReference: ["purchaseorderreference", "referensi po"],
  proofOfDeliveryReference: ["proofofdeliveryreference", "bukti penyerahan"],
  buyerAcknowledgementReference: [
    "buyeracknowledgementreference",
    "pengakuan buyer",
  ],
};
const moneyFields = new Set([
  "invoiceOriginalAmount",
  "previouslyPaidAmount",
  "acceptedOutstandingAmount",
]);

function metadata(text: string) {
  const locale = /^(?:locale|lokal):\s*(id-ID|en-US)\s*$/im.exec(text)?.[1] as
    "id-ID" | "en-US" | undefined;
  const format =
    /^(?:dateFormat|format tanggal):\s*(YYYY-MM-DD|DD\/MM\/YYYY|MM\/DD\/YYYY)\s*$/im.exec(
      text,
    )?.[1] as "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY" | undefined;
  return { locale, format };
}

/** Converts cited raw values independently; the provider cannot choose amounts or dates. */
export function canonicalFieldValue(
  key: (typeof EXTRACTION_KEYS)[number],
  raw: string,
  document: SourceDocument,
): string {
  const { locale, format } = metadata(document.text);
  const value = raw.trim();
  if (moneyFields.has(key)) {
    if (/^\d+$/.test(value))
      return parseLocalizedMoney(value, locale ?? "id-ID");
    if (!locale) throw new Error("EXPLICIT_LOCALE_REQUIRED");
    return parseLocalizedMoney(value, locale);
  }
  if (key === "quantity") {
    if (!locale && !/^\d+$/.test(value))
      throw new Error("EXPLICIT_LOCALE_REQUIRED");
    return parseLocalizedDecimal(value, locale ?? "id-ID");
  }
  if (key === "issueDate" || key === "invoiceDueDate")
    return parseDocumentDate(value, format);
  if (key === "currency") return value.toUpperCase();
  if (key === "quantityUnit") {
    const units: Record<string, string> = {
      kilogram: "kg",
      kg: "kg",
      ton: "ton",
      tonne: "ton",
      pcs: "pcs",
      unit: "unit",
      buah: "pcs",
      lembar: "lembar",
      box: "box",
      karton: "karton",
      meter: "m",
      m: "m",
      liter: "l",
      l: "l",
    };
    const unit = units[value.toLowerCase()];
    if (!unit) throw new Error("UNSUPPORTED_QUANTITY_UNIT");
    return unit;
  }
  return value;
}

export function injectionAnomalies(documents: SourceDocument[]) {
  const pattern =
    /ignore (?:all |previous |the )?instructions|abaikan (?:aturan|instruksi)|(?:cairkan|payout|transfer|bayar).{0,60}(?:wallet|0x[a-f0-9]{40})|(?:system|developer)\s*(?:prompt|message)|grant.{0,20}(?:admin|role)/i;
  return documents.flatMap((document) =>
    document.text
      .split("\n")
      .filter((line) => pattern.test(line))
      .map((rawText) => ({
        code: "UNTRUSTED_INSTRUCTION_DETECTED",
        documentId: document.id,
        rawText,
      })),
  );
}

/** Payment instructions are evidence to compare, never a source of payout addresses. */
export function paymentInstructionAnomalies(documents: SourceDocument[]) {
  const entries = documents.flatMap((document) =>
    document.text.split("\n").flatMap((rawText) => {
      const match =
        /^(?:paymentInstructions?|instruksi pembayaran|rekening pembayaran|paymentAccount|rekening tujuan):\s*(.+)$/i.exec(
          rawText.trim(),
        );
      return match
        ? [
            {
              documentId: document.id,
              rawText,
              normalized: match[1]
                .normalize("NFKC")
                .trim()
                .replace(/\s+/g, " ")
                .toUpperCase(),
            },
          ]
        : [];
    }),
  );
  if (new Set(entries.map((entry) => entry.normalized)).size <= 1) return [];
  return entries.map(({ documentId, rawText }) => ({
    code: "CONFLICT_PAYMENT_INSTRUCTIONS",
    documentId,
    rawText,
  }));
}

/** Explicit fixture provider: parses actual labeled source text, never returns a canned invoice. */
export function extractDeterministic(documents: SourceDocument[]): Extraction {
  const result = {
    ...Object.fromEntries(EXTRACTION_KEYS.map((key) => [key, emptyField()])),
    anomalies: [
      ...injectionAnomalies(documents),
      ...paymentInstructionAnomalies(documents),
    ],
    missingFields: [],
  } as unknown as Extraction;
  for (const document of documents) {
    document.text.split("\n").forEach((line, index) => {
      const match = /^([^:]{1,80}):\s*(.*?)\s*$/.exec(line);
      if (
        !match ||
        !match[2] ||
        /^(null|unknown|tidak diketahui)$/i.test(match[2])
      )
        return;
      const key = EXTRACTION_KEYS.find((field) =>
        labels[field].includes(match[1].trim().toLowerCase()),
      );
      if (!key) return;
      let value: string;
      try {
        value = canonicalFieldValue(key, match[2], document);
      } catch (error) {
        result.anomalies.push({
          code: error instanceof Error ? error.message : "INVALID_VALUE",
          documentId: document.id,
          rawText: match[2],
        });
        return;
      }
      if (result[key].value !== null && result[key].value !== value) {
        result.anomalies.push({
          code: `CONFLICT_${key}`,
          documentId: document.id,
          rawText: match[2],
        });
        return;
      }
      result[key] = {
        value,
        rawText: match[2],
        documentId: document.id,
        page: document.text.slice(0, document.text.indexOf(line)).split("\f")
          .length,
        line: index + 1,
      };
    });
  }
  result.missingFields = EXTRACTION_KEYS.filter(
    (key) => result[key].value === null,
  );
  return validateExtraction(result, documents);
}

export function validateAndNormalizeExtraction(
  value: unknown,
  documents: SourceDocument[],
): Extraction {
  const parsed = validateExtraction(value, documents);
  for (const key of EXTRACTION_KEYS) {
    const field = parsed[key];
    if (field.value === null) continue;
    const document = documents.find((doc) => doc.id === field.documentId)!;
    const actual = canonicalFieldValue(key, field.rawText!, document);
    if (actual !== field.value)
      throw new Error("EXTRACTION_VALUE_NOT_SUPPORTED_BY_SOURCE");
  }
  parsed.missingFields = EXTRACTION_KEYS.filter(
    (key) => parsed[key].value === null,
  );
  parsed.anomalies.push(
    ...[
      ...injectionAnomalies(documents),
      ...paymentInstructionAnomalies(documents),
    ].filter(
      (a) =>
        !parsed.anomalies.some(
          (b) =>
            b.code === a.code &&
            b.documentId === a.documentId &&
            b.rawText === a.rawText,
        ),
    ),
  );
  return parsed;
}
