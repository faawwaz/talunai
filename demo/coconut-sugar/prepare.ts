import assert from "node:assert/strict";
import { getSql } from "../../packages/db";
import {
  accounts,
  artifact,
  checkpoint,
  exportTruth,
  getScenario,
  instance,
  save,
  sessions,
  spec,
  state,
  validateEnvironment,
} from "./common";
import { generateDocuments } from "./documents";
import { ensureServices } from "./services";
import { bootstrapWallets, verifyChain } from "./chain";

export async function prepare(documentsOnly = false, capture = true) {
  await generateDocuments();
  const s = await state();
  await exportTruth(s);
  if (documentsOnly) {
    console.log(
      "PDF dan manifest disiapkan; belum menjalankan API, LLM, atau transaksi.",
    );
    return s;
  }
  validateEnvironment();
  const a = await accounts();
  await ensureServices(capture);
  await verifyChain(a);
  const auth = await sessions(a);
  const names = {
    borrower: spec.supplier,
    buyer: spec.buyer,
    lender: spec.lender,
  };
  for (const role of ["borrower", "buyer", "lender"] as const) {
    const identityKey = `talunai-coconut-${role}`;
    let organizationId = s.organizations[role];
    if (!organizationId) {
      const [existing] =
        await getSql()`SELECT organization_id FROM synthetic_organization_identities WHERE identity_key=${identityKey}`;
      if (existing) organizationId = existing.organization_id;
      else {
        const created = await auth.admin.request<{
          organization: { id: string };
        }>(
          "/v1/organizations/demo",
          "POST",
          {
            identityKey,
            name: names[role],
            kind: role.toUpperCase(),
            reason:
              "Organisasi khusus case gula kelapa Talunai; seluruh transaksi dan identitas peserta bersifat simulasi.",
          },
          `case:organization:${identityKey}`,
        );
        organizationId = created.organization.id;
      }
      assert.ok(organizationId);
      s.organizations[role] = organizationId;
      await checkpoint(s, `ORGANIZATION_${role.toUpperCase()}`);
    }
    const me = await auth[role].request<{
      memberships: Array<{ organizationId: string; role: string }>;
    }>("/v1/me");
    if (
      me.memberships.some(
        (m) =>
          m.organizationId === organizationId && m.role === role.toUpperCase(),
      )
    )
      continue;
    assert.equal(me.memberships.length, 0, "CASE_WALLET_AUTHORITY_CONFLICT");
    const pending = await auth[role].request<{
      request: { id: string; version: number; status: string } | null;
    }>("/v1/access-request");
    let access = pending.request;
    if (!access || access.status === "REJECTED") {
      const result = await auth[role].request<{
        request: { id: string; version: number; status: string };
      }>(
        "/v1/access-request",
        "POST",
        {
          organizationName: names[role],
          requestedRole: role.toUpperCase(),
          note: "Akun development-only untuk case invoice gula kelapa. Bukan perwakilan perusahaan nyata.",
        },
        `case:access:${a[role].address.toLowerCase()}`,
      );
      access = result.request;
    }
    assert.equal(access.status, "PENDING", "CASE_ACCESS_REVIEW_REQUIRED");
    await auth.admin.request(
      `/v1/access-requests/${access.id}/review`,
      "POST",
      {
        expectedVersion: access.version,
        decision: "APPROVE",
        organizationId,
        reason:
          "Wallet peserta simulasi diperiksa oleh operator; kewenangan hanya untuk organisasi case ini.",
      },
      `case:approve:${access.id}`,
    );
    const approved = await auth[role].request<typeof me>("/v1/me");
    assert.ok(
      approved.memberships.some(
        (m) =>
          m.organizationId === organizationId && m.role === role.toUpperCase(),
      ),
      "MEMBERSHIP_NOT_ACTIVE",
    );
    await checkpoint(s, `ACCESS_${role.toUpperCase()}_APPROVED`, {
      organizationId,
      address: a[role].address,
      mechanism: "AUTHENTICATED_ADMIN_API",
    });
  }
  if (s.executionStatus !== "COMPLETED" && !s.claimId)
    await bootstrapWallets(s, a);
  if (s.executionStatus !== "COMPLETED") s.executionStatus = "PREPARED";
  await checkpoint(
    s,
    s.executionStatus === "COMPLETED" ? "COMPLETED" : "PREPARED",
  );
  await save(artifact("prepare-result.json"), {
    status: s.executionStatus,
    instance,
    organizations: s.organizations,
    scenario: await getScenario(),
    isSynthetic: true,
    chainId: 97,
    token: "MockIDR",
    providerMode: "live",
    privateKeysInPublicArtifacts: false,
  });
  await exportTruth(s);
  return s;
}
