import { describe, expect, it } from "vitest";
import {
  amount,
  parseDocumentDate,
  parseLocalizedMoney,
  quantityInKg,
} from "../packages/domain/money";
import { quote, waterfall } from "../packages/domain/finance";
import { evaluatePolicy, type PolicyInput } from "../packages/domain/policy";
import { emptyEvidence } from "../packages/domain/evidence";
import {
  deriveClaimKey,
  documentCommitment,
  normalizeInvoiceNumber,
} from "../packages/domain/identity";

const policyInput = (): PolicyInput => ({
  assetType: "TRADE_RECEIVABLE",
  goods: {
    category: "COCOA",
    description: "kakao",
    lineItems: [{ description: "kakao", quantity: "10", unit: "ton" }],
  },
  acceptedOutstanding: "100000000",
  requestedPrincipal: "70000000",
  evidence: {
    ...emptyEvidence(),
    extractionStatus: "SUPPORTED_BY_DOCUMENT",
    issuerAuthorityStatus: "ATTESTED",
    buyerAuthorityStatus: "ATTESTED",
    buyerAcknowledgementStatus: "SUPPORTED_BY_DOCUMENT",
    deliveryEvidenceStatus: "SUPPORTED_BY_DOCUMENT",
    duplicateCheckStatus: "ATTESTED",
  },
  evidenceIds: ["document-1"],
  chainId: 31337,
  supportedToken: true,
  hasConflict: false,
  knownDuplicate: false,
  alreadyFinanced: false,
  fundingHold: false,
  hasDispute: false,
  now: 1_800_000_000,
  fundingDeadline: 1_800_080_000,
  invoiceDueAt: 1_804_000_000,
  reviewExpiry: 1_800_080_000,
  consentExpiry: 1_800_080_000,
});

describe("exact money and explicit locales", () => {
  it("rejects integers beyond the onchain uint256 domain without Number conversion", () => {
    const maximum = (1n << 256n) - 1n;
    expect(amount(maximum.toString())).toBe(maximum);
    expect(() => amount((maximum + 1n).toString())).toThrow(
      "AMOUNT_EXCEEDS_UINT256",
    );
  });
  it("quotes the specified simulation and rounds a fractional fee upward", () => {
    expect(quote("100000000", "70000000")).toMatchObject({
      principal: "70000000",
      advanceCap: "80000000",
      fixedFee: "1050000",
      lenderEntitlement: "71050000",
    });
    expect(quote("100", "1").fixedFee).toBe("1");
    expect(amount("9007199254740993")).toBe(9007199254740993n);
  });
  it.each(["-1", "1.2", "1e6", " 100", "01", "NaN"])(
    "rejects invalid integer %s",
    (value) => expect(() => amount(value)).toThrow(),
  );
  it("handles separators according to stated locale without guessing", () => {
    expect(parseLocalizedMoney("1.000", "id-ID")).toBe("1000");
    expect(parseLocalizedMoney("1,000", "en-US")).toBe("1000");
    expect(parseLocalizedMoney("1.000", "en-US")).toBe("1");
    expect(() => parseLocalizedMoney("1.000,50", "id-ID")).toThrow(
      "FRACTIONAL_MOCK_IDR_UNSUPPORTED",
    );
    expect(() => parseLocalizedMoney("1.00.000", "id-ID")).toThrow();
    expect(quantityInKg("1,5", "ton", "id-ID")).toBe("1500");
    expect(quantityInKg("1.25", "kg", "en-US")).toBe("1.25");
  });
  it("requires declared slash-date format and rejects impossible dates", () => {
    expect(() => parseDocumentDate("01/02/2026")).toThrow("AMBIGUOUS");
    expect(parseDocumentDate("01/02/2026", "DD/MM/YYYY")).toBe("2026-02-01");
    expect(parseDocumentDate("01/02/2026", "MM/DD/YYYY")).toBe("2026-01-02");
    expect(() => parseDocumentDate("2026-02-30")).toThrow("INVALID_DATE");
  });
});

describe("waterfall independent financing, collection and withdrawals", () => {
  const base = {
    principal: "70000000",
    fixedFee: "1050000",
    acceptedOutstanding: "100000000",
  };
  it("allocates partial principal first", () =>
    expect(waterfall({ ...base, totalCollected: "50000000" })).toMatchObject({
      lenderAllocated: "50000000",
      feeAllocated: "0",
      borrowerAllocated: "0",
      lenderOutstanding: "21050000",
      remainingInvoiceCollection: "50000000",
      financingStatus: "PARTIALLY_RECOVERED",
    }));
  it("financing repaid is distinct from full collection and withdrawal", () =>
    expect(
      waterfall({
        ...base,
        totalCollected: "71050000",
        lenderWithdrawn: "50000000",
      }),
    ).toMatchObject({
      financingStatus: "REPAID",
      collectionStatus: "PARTIALLY_COLLECTED",
      remainingInvoiceCollection: "28950000",
      lenderClaimable: "21050000",
    }));
  it("full collection allocates residual exactly", () =>
    expect(waterfall({ ...base, totalCollected: "100000000" })).toMatchObject({
      lenderAllocated: "71050000",
      borrowerResidualClaimable: "28950000",
      collectionStatus: "FULLY_COLLECTED",
    }));
  it("rejects overpayment and withdrawal beyond allocation", () => {
    expect(() => waterfall({ ...base, totalCollected: "100000001" })).toThrow();
    expect(() =>
      waterfall({
        ...base,
        totalCollected: "50000000",
        lenderWithdrawn: "50000001",
      }),
    ).toThrow();
  });
  it("preserves conservation and coverage across 1000 deterministic random accounting states", () => {
    let seed = 813;
    for (let i = 0; i < 1000; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const c = BigInt(seed % 100000001);
      const first = waterfall({ ...base, totalCollected: c.toString() });
      const lw = BigInt(first.lenderAllocated) / 3n,
        bw = BigInt(first.borrowerAllocated) / 2n;
      const result = waterfall({
        ...base,
        totalCollected: c.toString(),
        lenderWithdrawn: lw.toString(),
        borrowerWithdrawn: bw.toString(),
      });
      expect(
        BigInt(result.principalAllocated) +
          BigInt(result.feeAllocated) +
          BigInt(result.borrowerAllocated),
      ).toBe(c);
      expect(
        BigInt(result.lenderClaimable) +
          BigInt(result.borrowerResidualClaimable),
      ).toBe(c - lw - bw);
    }
  });
});

describe("deterministic simulation policy", () => {
  it("eligible never grants funding authority; records external check unavailable", () => {
    const result = evaluatePolicy(policyInput());
    expect(result.outcome).toBe("ELIGIBLE_FOR_HUMAN_APPROVAL");
    expect(result.outstandingGates).toContain("HUMAN_APPROVAL_REQUIRED");
    expect(result.disclosures).toContain("EXTERNAL_ENCUMBRANCE_NOT_INTEGRATED");
  });
  it("does not reduce requested principal to the cap", () => {
    const result = evaluatePolicy({
      ...policyInput(),
      requestedPrincipal: "80000001",
    });
    expect(result.outcome).toBe("REJECTED");
    expect(result.quote.principal).toBe("80000001");
  });
  it.each(["hasConflict", "fundingHold", "hasDispute"] as const)(
    "%s blocks readiness",
    (field) =>
      expect(evaluatePolicy({ ...policyInput(), [field]: true }).outcome).toBe(
        "NEEDS_REVIEW",
      ),
  );
  it.each(["knownDuplicate", "alreadyFinanced"] as const)(
    "%s rejects recycled invoices",
    (field) =>
      expect(evaluatePolicy({ ...policyInput(), [field]: true }).outcome).toBe(
        "REJECTED",
      ),
  );
  it.each([56, 1, 137])("rejects chain %s", (chainId) =>
    expect(evaluatePolicy({ ...policyInput(), chainId }).outcome).toBe(
      "REJECTED",
    ),
  );
  it("requires buyer acknowledgement and delivery; PO alone is insufficient", () => {
    const input = policyInput();
    input.evidence.buyerAcknowledgementStatus = "MISSING";
    input.evidence.deliveryEvidenceStatus = "MISSING";
    expect(evaluatePolicy(input).reasonCodes).toEqual(
      expect.arrayContaining([
        "BUYER_ACKNOWLEDGEMENT_REQUIRED",
        "DELIVERY_EVIDENCE_REQUIRED",
      ]),
    );
  });
  it("rejects token mismatch, stale approval and expired funding", () => {
    expect(
      evaluatePolicy({ ...policyInput(), supportedToken: false }).outcome,
    ).toBe("REJECTED");
    expect(
      evaluatePolicy({ ...policyInput(), now: 1_800_080_001 }).reasonCodes,
    ).toContain("EXPIRED_TERMS_OR_APPROVAL");
  });
});

describe("canonical identity and privacy commitments", () => {
  it("identity ignores file, amount and wallet and normalizes invoice numbering", () => {
    expect(normalizeInvoiceNumber(" kakao /2026/001 ")).toBe("KAKAO/2026/001");
    expect(
      deriveClaimKey("approved-org", "2026", "kakao /2026/001", "x".repeat(32)),
    ).toBe(
      deriveClaimKey("approved-org", "2026", "KAKAO/2026/001", "x".repeat(32)),
    );
  });
  it("random salt makes repeated public commitments different", () =>
    expect(documentCommitment(Buffer.from("invoice")).commitment).not.toBe(
      documentCommitment(Buffer.from("invoice")).commitment,
    ));
});
