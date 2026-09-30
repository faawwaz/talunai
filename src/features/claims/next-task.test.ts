import { describe, expect, it } from "vitest";
import type { Claim, Financing } from "../../../packages/client";
import { nextClaimTask } from "./next-task";

const now = 1_800_000_000;
const claim = {
  id: "synthetic-claim",
  assetType: "TRADE_RECEIVABLE",
  goods: null,
  claimKey: `0x${"1".repeat(64)}`,
  version: 1,
  organizationId: "issuer",
  buyerOrganizationId: "buyer",
  invoiceNumber: "INV-01",
  invoiceNamespace: "2026",
  isSynthetic: true,
  workflow: "READY_FOR_SIGNATURES",
  fundingHold: false,
  hasDispute: false,
  evidence: { humanReviewStatus: "PENDING" },
  terms: {
    borrower: `0x${"1".repeat(40)}`,
    buyer: `0x${"2".repeat(40)}`,
    token: `0x${"3".repeat(40)}`,
    acceptedOutstanding: "100000000",
    principal: "70000000",
    fee: "1050000",
    invoiceDueAt: now + 45 * 86400,
    evidenceCommitment: `0x${"2".repeat(64)}`,
    decisionHash: `0x${"3".repeat(64)}`,
    policyHash: `0x${"4".repeat(64)}`,
    fundingDeadline: now + 1000,
    reviewExpiry: now + 1000,
    consentExpiry: now + 1000,
  },
} as Claim;
const financing = {
  claimId: claim.id,
  isSynthetic: true,
  stateConfidence: "CONFIRMED_PROJECTION",
  financingStatus: "ACTIVE",
  collectionStatus: "UNPAID",
  registryStatus: "FUNDED",
  principal: "70000000",
  fixedFee: "1050000",
  acceptedOutstanding: "100000000",
  totalCollected: "0",
  lender: `0x${"4".repeat(40)}`,
  lenderWithdrawn: "0",
  lenderClaimable: "0",
  borrowerResidualClaimable: "0",
  remainingInvoiceCollection: "100000000",
} as Financing;

describe("role next action follows consent and financial prerequisites", () => {
  it("does not prompt buyer signature while human review is pending", () => {
    const task = nextClaimTask("buyer", claim, now);
    expect(task.actionable).toBe(false);
    expect(task.tab).toBe("evidence");
    expect(task.title).toContain("verifier");
    expect(nextClaimTask("verifier", claim, now).actionable).toBe(true);
  });
  it("enables the participant consent journey only after human review", () => {
    const approved = {
      ...claim,
      evidence: { humanReviewStatus: "ATTESTED" },
    } as Claim;
    expect(nextClaimTask("buyer", approved, now)).toMatchObject({
      tab: "terms",
      actionable: true,
    });
    expect(nextClaimTask("lender", approved, now).actionable).toBe(false);
  });
  it("never treats ready registration or submitted transaction as lender funding eligibility", () => {
    expect(
      nextClaimTask(
        "lender",
        { ...claim, workflow: "READY_FOR_REGISTRATION" },
        now,
      ).actionable,
    ).toBe(false);
    expect(
      nextClaimTask(
        "lender",
        { ...claim, workflow: "REGISTRATION_PENDING" },
        now,
      ),
    ).toMatchObject({ tab: "activity", actionable: false });
  });
  it("keeps collection and withdrawal accessible after funding deadlines", () => {
    const registered = { ...claim, workflow: "REGISTERED" } as Claim;
    expect(
      nextClaimTask("buyer", registered, now + 5000, financing),
    ).toMatchObject({
      tab: "payments",
      actionable: true,
    });
    expect(
      nextClaimTask("lender", registered, now + 5000, financing).title,
    ).toContain("Menunggu pembayaran");
  });
  it("does not claim funding or payment status until projection is confirmed", () => {
    const registered = { ...claim, workflow: "REGISTERED" } as Claim;
    expect(nextClaimTask("lender", registered, now)).toMatchObject({
      title: "Memeriksa pembayaran Deal",
      actionable: false,
    });
    expect(
      nextClaimTask("lender", registered, now, {
        ...financing,
        stateConfidence: "DEGRADED_LAST_CONFIRMED_PROJECTION",
      }),
    ).toMatchObject({ actionable: false });
  });
  it("separates lender entitlement from full invoice collection", () => {
    const registered = { ...claim, workflow: "REGISTERED" } as Claim;
    const partiallyPaid = {
      ...financing,
      financingStatus: "REPAID",
      collectionStatus: "PARTIALLY_COLLECTED",
      totalCollected: "71050000",
      remainingInvoiceCollection: "28950000",
    } as Financing;
    expect(nextClaimTask("buyer", registered, now, partiallyPaid).title).toBe(
      "Bayar invoice",
    );
    expect(
      nextClaimTask("borrower", registered, now, partiallyPaid).title,
    ).toBe("Invoice dibayar sebagian");
    expect(
      nextClaimTask("buyer", registered, now, {
        ...partiallyPaid,
        collectionStatus: "FULLY_COLLECTED",
        remainingInvoiceCollection: "0",
      }).title,
    ).toBe("Invoice sudah dibayar penuh");
  });
  it("stops funding guidance at the earliest signed deadline", () => {
    const registered = { ...claim, workflow: "REGISTERED" } as Claim;
    const available = {
      ...financing,
      financingStatus: "UNFUNDED",
      registryStatus: "AVAILABLE",
    } as Financing;
    expect(nextClaimTask("lender", registered, now, available)).toMatchObject({
      title: "Deal siap didanai",
      actionable: true,
    });
    expect(
      nextClaimTask(
        "lender",
        { ...registered, terms: { ...registered.terms, reviewExpiry: now } },
        now,
        available,
      ),
    ).toMatchObject({
      title: "Masa pendanaan berakhir",
      tab: "activity",
      actionable: false,
    });
  });
  it("hold never suggests automatic reversal of already disbursed funds", () => {
    const held = { ...claim, fundingHold: true };
    expect(nextClaimTask("lender", held, now).actionable).toBe(false);
    expect(nextClaimTask("verifier", held, now).actionable).toBe(true);
    expect(nextClaimTask("buyer", held, now).description).toContain(
      "tetap berjalan",
    );
    expect(
      nextClaimTask(
        "buyer",
        { ...held, workflow: "REGISTERED" },
        now,
        financing,
      ),
    ).toMatchObject({ title: "Bayar invoice", actionable: true });
  });
  it("expired pre-registration terms do not prompt a fresh signature", () => {
    const task = nextClaimTask("buyer", claim, now + 1000);
    expect(task.actionable).toBe(false);
    expect(task.title).toContain("berakhir");
  });
});
