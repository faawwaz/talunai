import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { TypedDataDefinition } from "viem";
import type {
  AgentRun,
  AgentStep,
  Claim,
  Financing,
} from "../../packages/client";
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
  sha256,
  spec,
  waitFor,
} from "./common";
import { prepare } from "./prepare";
import {
  applicationTransaction,
  reconcileJournal,
  tokenBalances,
} from "./chain";
import { exportAgentEvidence } from "./agent";
import { ProductCapture } from "./capture";
import { exportSummary } from "./summary";

export async function runCase(capture = true) {
  const s = await prepare(false, capture);
  const a = await accounts(),
    auth = await sessions(a),
    scenario = await getScenario();
  const images = new ProductCapture(a, capture);
  const claim = () => auth.borrower.request<Claim>(`/v1/claims/${s.claimId!}`);
  const financing = () =>
    auth.borrower.request<Financing>(`/v1/claims/${s.claimId!}/financing`);
  const exportExecution = async (f: Financing) => {
    await save(artifact("deal-final.json"), await claim());
    await save(artifact("financing-final.json"), f);
    for (const suffix of ["evidence", "audit?limit=100"])
      await save(
        artifact(suffix.startsWith("audit") ? "audit.json" : "evidence.json"),
        await auth.borrower.request(`/v1/claims/${s.claimId!}/${suffix}`),
      );
    const actorPages = await Promise.all(
      (["borrower", "buyer", "verifier", "lender"] as const).map(
        async (role) => ({
          role,
          page: await auth[role].request<{
            items: Array<Record<string, unknown> & { id: string }>;
          }>(`/v1/claims/${s.claimId!}/transactions?limit=100`),
        }),
      ),
    );
    const intents = new Map(
      actorPages.flatMap(({ page }) =>
        page.items.map((item) => [item.id, item] as const),
      ),
    );
    for (const transaction of s.transactions)
      if (transaction.intentId)
        assert.ok(
          intents.has(transaction.intentId),
          "APPLICATION_INTENT_EVIDENCE_MISSING",
        );
    await save(artifact("transaction-intents.json"), {
      source: "ACTOR_AUTHORIZED_API_RESPONSES",
      actorScopes: actorPages.map(({ role, page }) => ({
        role,
        count: page.items.length,
      })),
      items: [...intents.values()],
      total: intents.size,
    });
  };
  try {
    if (s.claimId) await reconcileJournal(s, a, auth, await claim());
    if (s.executionStatus === "COMPLETED") {
      const recorded = await auth.borrower.request<
        AgentRun & { steps: AgentStep[] }
      >(`/v1/agent-runs/${s.runId!}`);
      await exportAgentEvidence(s, recorded);
      const fresh = await financing();
      assertFinal(fresh);
      await checkpoint(s, "COMPLETED");
      await images.take("lender", s.claimId!, "08-completed", "payments");
      await exportExecution(fresh);
      await exportSummary(s, fresh);
      await exportTruth(s);
      console.log(
        "Case sudah selesai; verifikasi ulang state canonical, tanpa membuat transaksi baru.",
      );
      return s;
    }
    s.executionStatus = "RUNNING";
    if (!s.claimId) {
      const [existing] =
        await getSql()`SELECT id FROM claims WHERE org_id=${s.organizations.borrower!} AND invoice_namespace=${scenario.issueDate.slice(0, 4)} AND invoice_number=${scenario.invoiceNumber}`;
      if (existing) s.claimId = existing.id;
      else {
        const created = await auth.borrower.request<Claim>(
          "/v1/claims",
          "POST",
          {
            assetType: "TRADE_RECEIVABLE",
            goods: {
              category: "OTHER",
              description: spec.product,
              lineItems: [
                {
                  description: spec.product,
                  quantity: spec.quantity,
                  unit: spec.unit,
                },
              ],
            },
            organizationId: s.organizations.borrower,
            buyerOrganizationId: s.organizations.buyer,
            lenderOrganizationId: s.organizations.lender,
            invoiceNamespace: scenario.issueDate.slice(0, 4),
            invoiceNumber: scenario.invoiceNumber,
            acceptedOutstanding: spec.outstandingIdr,
            requestedPrincipal: spec.principalIdr,
            invoiceDueAt: scenario.invoiceDueAt,
            fundingWindowSeconds: spec.fundingWindowSeconds,
          },
          `case:${instance}:create:${scenario.invoiceNumber}`,
        );
        s.claimId = created.id;
      }
      await checkpoint(s, "DEAL_CREATED", await claim());
      await reconcileJournal(s, a, auth, await claim());
    }
    let current = await claim();
    assert.equal(current.organizationId, s.organizations.borrower);
    assert.equal(current.buyerOrganizationId, s.organizations.buyer);
    assert.equal(
      current.terms.borrower.toLowerCase(),
      a.borrower.address.toLowerCase(),
    );
    assert.equal(
      current.terms.buyer.toLowerCase(),
      a.buyer.address.toLowerCase(),
    );
    assert.equal(current.terms.acceptedOutstanding, spec.outstandingIdr);
    assert.equal(current.terms.principal, spec.principalIdr);
    assert.equal(current.terms.fee, spec.feeIdr);
    if (current.workflow === "DRAFT")
      await images.take("borrower", current.id, "01-problem");
    for (const filename of [
      "invoice.pdf",
      "delivery-note.pdf",
      "buyer-acknowledgement.pdf",
    ]) {
      if (s.documents.some((doc) => doc.filename === filename)) continue;
      const bytes = await readFile(artifact(`documents/${filename}`));
      const digest = sha256(bytes);
      // Recover a completed upload after a process crash without replaying a different expectedVersion.
      const [existing] =
        await getSql()`SELECT id,version FROM documents WHERE claim_id=${current.id} AND original_name=${filename} AND sha256=${digest} AND purpose='DEAL'`;
      let document: { documentId: string; version: number };
      if (existing)
        document = { documentId: existing.id, version: existing.version };
      else {
        current = await claim();
        const form = new FormData();
        form.set("expectedVersion", String(current.version));
        form.set(
          "file",
          new File([bytes], filename, { type: "application/pdf" }),
        );
        document = await auth.borrower.request(
          `/v1/claims/${current.id}/documents`,
          "POST",
          form,
          `case:${instance}:upload:${current.id}:${filename}:${digest}`,
        );
      }
      s.documents.push({ ...document, filename, sha256: digest });
      await checkpoint(s, `UPLOADED_${filename.replaceAll(".", "_")}`);
    }
    current = await claim();
    if (["DRAFT", "PROCESSING_FAILED"].includes(current.workflow))
      await images.take("borrower", current.id, "02-supplier-deal", "evidence");
    if (!s.runId) {
      const [existingRun] =
        await getSql()`SELECT id,mode FROM agent_runs WHERE claim_id=${current.id} AND version=${current.version} ORDER BY created_at DESC LIMIT 1`;
      if (existingRun) {
        assert.equal(existingRun.mode, "live", "MOCK_RUN_FORBIDDEN");
        s.runId = existingRun.id;
      } else {
        const requested = await auth.borrower.request<{ runId: string }>(
          `/v1/claims/${current.id}/analyze`,
          "POST",
          { expectedVersion: current.version },
          `case:${instance}:analysis:${current.id}:${current.version}`,
        );
        s.runId = requested.runId;
      }
      await checkpoint(s, "LIVE_AGENT_REQUESTED");
    }
    // Recover only an explicit retry of the same version after an interrupted checkpoint.
    // A stale result caused by changed evidence/terms must remain blocked.
    const recordedRun = await auth.borrower.request<AgentRun>(
      `/v1/agent-runs/${s.runId!}`,
    );
    if (
      recordedRun.status === "STALE" &&
      recordedRun.stage === "SUPERSEDED_BY_RETRY"
    ) {
      current = await claim();
      assert.equal(
        recordedRun.version,
        current.version,
        "AGENT_VERSION_CHANGED",
      );
      const [replacement] =
        await getSql()`SELECT id,mode FROM agent_runs WHERE claim_id=${current.id} AND version=${current.version} AND id<>${recordedRun.id} ORDER BY created_at DESC,id DESC LIMIT 1`;
      assert.ok(replacement, "AGENT_RETRY_REPLACEMENT_REQUIRED");
      assert.equal(replacement.mode, "live", "MOCK_RUN_FORBIDDEN");
      s.runId = replacement.id;
      await checkpoint(s, "LIVE_AGENT_RETRY_RECOVERED", {
        previousRunId: recordedRun.id,
        runId: s.runId,
        version: current.version,
      });
    }
    const transientProviderErrors = new Set([
      "PROVIDER_TIMEOUT",
      "PROVIDER_RATE_LIMIT",
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_TRANSIENT_FAILURE",
    ]);
    let analysis: AgentRun & { steps: AgentStep[] };
    let retryAttempts = 0;
    while (true) {
      analysis = await waitFor(
        () =>
          auth.borrower.request<AgentRun & { steps: AgentStep[] }>(
            `/v1/agent-runs/${s.runId!}`,
          ),
        (r) => ["COMPLETED", "FAILED", "STALE"].includes(r.status),
        "OpenRouter agent run",
      );
      if (
        analysis.status !== "FAILED" ||
        !transientProviderErrors.has(analysis.error ?? "")
      )
        break;
      current = await claim();
      assert.equal(analysis.version, current.version, "AGENT_VERSION_CHANGED");
      assert.equal(
        current.workflow,
        "PROCESSING_FAILED",
        "AGENT_RETRY_STATE_CHANGED",
      );
      const operational = await auth.admin.request<{
        version: number;
        currentVersion: number;
        retryable: boolean;
      }>(`/v1/ops/agent-runs/${analysis.id}`);
      assert.equal(
        operational.version,
        current.version,
        "AGENT_VERSION_CHANGED",
      );
      assert.equal(
        operational.currentVersion,
        current.version,
        "AGENT_VERSION_CHANGED",
      );
      assert.ok(operational.retryable, "LIVE_AGENT_RETRY_NOT_ELIGIBLE");
      assert.ok(retryAttempts < 3, "LIVE_AGENT_RETRY_LIMIT_REACHED");
      const retried = await auth.admin.request<{ runId: string; mode: string }>(
        `/v1/ops/agent-runs/${analysis.id}/retry`,
        "POST",
        { expectedVersion: current.version },
        `case:${instance}:retry:${analysis.id}:${current.version}`,
      );
      assert.equal(retried.mode, "live", "MOCK_RUN_FORBIDDEN");
      s.runId = retried.runId;
      retryAttempts += 1;
      await checkpoint(s, "LIVE_AGENT_RETRY_REQUESTED", {
        previousRunId: analysis.id,
        runId: s.runId,
        version: current.version,
        reason: analysis.error,
        authorization: "ADMIN_RETRY_API",
      });
    }
    assert.equal(
      analysis.status,
      "COMPLETED",
      `LIVE_AGENT_FAILED:${analysis.error ?? analysis.status}`,
    );
    await exportAgentEvidence(s, analysis);
    if (
      !s.stageRecords.some((item) => item.stage === "LIVE_CHECKS_COMPLETED")
    ) {
      await images.take("borrower", current.id, "04-agent-checks", "evidence");
      await checkpoint(s, "LIVE_CHECKS_COMPLETED", {
        runId: s.runId,
        mode: analysis.mode,
        provider: analysis.result?.provider,
        model: analysis.result?.model,
        checks: analysis.steps,
      });
    }
    current = await claim();
    if (
      current.workflow !== "REGISTERED" &&
      current.workflow !== "REGISTRATION_PENDING"
    ) {
      const [review] =
        await getSql()`SELECT id,decision,reason FROM review_decisions WHERE claim_id=${current.id} AND version=${current.version} AND decision='APPROVE' AND expires_at>now() ORDER BY created_at DESC LIMIT 1`;
      if (!review) {
        await images.take(
          "verifier",
          current.id,
          "04b-verifier-review",
          "evidence",
        );
        current = await auth.verifier.request<Claim>(
          `/v1/claims/${current.id}/review`,
          "POST",
          {
            expectedVersion: current.version,
            decision: "APPROVE",
            reason:
              "Aktor verifikator demo meninjau tiga PDF sintetis, nominal net, kuantitas, PO, delivery, dan hasil pemeriksaan live. Bukan verifikasi legal/credit Unilever.",
            evidenceIds: s.documents.map((d) => d.documentId),
            attestations: [
              "buyerAcknowledgementStatus",
              "deliveryEvidenceStatus",
              "extractionStatus",
            ],
          },
          `case:${instance}:review:${current.id}:${current.version}`,
        );
        await checkpoint(s, "VERIFIER_APPROVED", {
          version: current.version,
          scriptedDemoActor: true,
          evidence: current.evidence,
        });
      }
      await images.take("buyer", current.id, "03-buyer-confirm", "terms");
      for (const role of ["borrower", "buyer"] as const) {
        const signedRole = role === "borrower" ? "BORROWER" : "BUYER";
        const [consent] =
          await getSql()`SELECT role,signer,terms_hash,nonce FROM consent_records WHERE claim_id=${current.id} AND version=${current.version} AND role=${signedRole} AND revoked=false`;
        if (consent) {
          assert.equal(
            consent.signer.toLowerCase(),
            a[role].address.toLowerCase(),
          );
          continue;
        }
        const nonce = BigInt(
          `0x${sha256(`${instance}:${current.id}:${current.version}:${role}`)}`,
        ).toString();
        const prepared = await auth[role].request<{
          typedData: TypedDataDefinition;
        }>(
          `/v1/claims/${current.id}/consents/prepare`,
          "POST",
          { expectedVersion: current.version, role: signedRole, nonce },
          `case:${instance}:consent-prepare:${current.id}:${current.version}:${role}`,
        );
        const signature = await a[role].signTypedData(prepared.typedData);
        await auth[role].request(
          `/v1/claims/${current.id}/consents`,
          "POST",
          {
            expectedVersion: current.version,
            role: signedRole,
            nonce,
            signature,
          },
          `case:${instance}:consent-submit:${current.id}:${current.version}:${role}`,
        );
        await checkpoint(s, `${signedRole}_TERMS_SIGNED`, {
          version: current.version,
          signer: a[role].address,
          signatureHash: sha256(signature),
          actualVerifiedSignature: true,
        });
      }
      await images.take("buyer", current.id, "03b-buyer-confirmed", "terms");
      current = await claim();
      await applicationTransaction(s, auth.verifier, current, "REGISTER");
    } else if (s.transactions.some((tx) => tx.action === "VERIFIER_REGISTER")) {
      await applicationTransaction(s, auth.verifier, current, "REGISTER");
    }
    current = await waitFor(
      claim,
      (c) => c.workflow === "REGISTERED",
      "canonical registration projection",
    );
    let f = await financing();
    assert.equal(
      f.stateConfidence,
      "CONFIRMED_PROJECTION",
      "CONFIRMED_PROJECTION_REQUIRED",
    );
    if (f.financingStatus === "UNFUNDED") {
      await images.take("lender", current.id, "05-ready-to-fund");
      if (!s.baselines) {
        s.baselines = await tokenBalances(a);
        await checkpoint(s, "PRE_FUNDING_BALANCES", s.baselines);
      }
      await applicationTransaction(s, auth.lender, current, "APPROVE_TOKEN", {
        amount: spec.principalIdr,
      });
      await applicationTransaction(s, auth.lender, current, "FUND");
      f = await waitFor(
        financing,
        (v) =>
          v.financingStatus === "ACTIVE" &&
          v.stateConfidence === "CONFIRMED_PROJECTION",
        "funding projection",
      );
      const balances = await tokenBalances(a);
      assert.equal(
        BigInt(balances.borrower) - BigInt(s.baselines.borrower),
        BigInt(spec.principalIdr),
        "SUPPLIER_FUNDING_NOT_RECEIVED",
      );
      await checkpoint(s, "SUPPLIER_RECEIVED_CAPITAL", {
        amount: spec.principalIdr,
        balances,
        financing: f,
      });
    }
    assert.equal(
      f.lender?.toLowerCase(),
      a.lender.address.toLowerCase(),
      "FUNDED_BY_DIFFERENT_LENDER",
    );
    if (f.totalCollected === "0") {
      // Recover a failed capture while this funded state still exists.
      await images.take("borrower", current.id, "06-funded", "payments");
      await applicationTransaction(s, auth.buyer, current, "APPROVE_TOKEN", {
        amount: spec.outstandingIdr,
      });
      await applicationTransaction(
        s,
        auth.buyer,
        current,
        "COLLECT_BUYER_PAYMENT",
        { amount: spec.outstandingIdr },
      );
      f = await waitFor(
        financing,
        (v) =>
          v.totalCollected === spec.outstandingIdr &&
          v.stateConfidence === "CONFIRMED_PROJECTION",
        "buyer payment projection",
      );
      assert.equal(f.lenderClaimable, spec.lenderEntitlementIdr);
      assert.equal(f.borrowerResidualClaimable, spec.supplierResidualIdr);
      await checkpoint(s, "SETTLEMENT_ALLOCATED", f);
    }
    if (
      f.totalCollected === spec.outstandingIdr &&
      f.lenderWithdrawn === "0" &&
      f.borrowerWithdrawn === "0"
    ) {
      assert.equal(f.lenderClaimable, spec.lenderEntitlementIdr);
      assert.equal(f.borrowerResidualClaimable, spec.supplierResidualIdr);
      await save(artifact("settlement-before-withdrawal.json"), f);
      await images.take("lender", current.id, "07-settled", "payments");
      await images.take(
        "borrower",
        current.id,
        "07b-supplier-residual",
        "payments",
      );
    }
    assert.equal(
      f.totalCollected,
      spec.outstandingIdr,
      "PARTIAL_PAYMENT_REQUIRES_REVIEW",
    );
    if (f.lenderWithdrawn !== spec.lenderEntitlementIdr) {
      await applicationTransaction(s, auth.lender, current, "WITHDRAW_LENDER");
      f = await waitFor(
        financing,
        (v) => v.lenderWithdrawn === spec.lenderEntitlementIdr,
        "lender withdrawal projection",
      );
    }
    if (f.borrowerWithdrawn !== spec.supplierResidualIdr) {
      await applicationTransaction(
        s,
        auth.borrower,
        current,
        "WITHDRAW_BORROWER",
      );
      f = await waitFor(
        financing,
        (v) => v.borrowerWithdrawn === spec.supplierResidualIdr,
        "supplier withdrawal projection",
      );
    }
    assertFinal(f);
    assert.ok(s.baselines, "FUNDING_BALANCE_BASELINE_REQUIRED");
    const balances = await tokenBalances(a);
    assert.equal(
      BigInt(balances.borrower) - BigInt(s.baselines.borrower),
      BigInt(spec.principalIdr) + BigInt(spec.supplierResidualIdr),
    );
    assert.equal(
      BigInt(balances.lender) - BigInt(s.baselines.lender),
      BigInt(spec.feeIdr),
    );
    assert.equal(
      BigInt(s.baselines.buyer) - BigInt(balances.buyer),
      BigInt(spec.outstandingIdr),
    );
    await exportExecution(f);
    await checkpoint(s, "COMPLETED", {
      financing: f,
      tokenBalanceChangesVerified: true,
      balances,
    });
    s.executionStatus = "COMPLETED";
    await checkpoint(s, "COMPLETED");
    await images.take("lender", current.id, "08-completed", "payments");
    await exportSummary(s, f);
    await exportTruth(s);
    return s;
  } finally {
    await images.close();
  }
}
function assertFinal(f: Financing) {
  assert.equal(f.stateConfidence, "CONFIRMED_PROJECTION");
  assert.equal(f.totalCollected, spec.outstandingIdr);
  assert.equal(f.collectionStatus, "FULLY_COLLECTED");
  assert.equal(f.financingStatus, "REPAID");
  assert.equal(f.lenderWithdrawn, spec.lenderEntitlementIdr);
  assert.equal(f.borrowerWithdrawn, spec.supplierResidualIdr);
  assert.equal(f.lenderClaimable, "0");
  assert.equal(f.borrowerResidualClaimable, "0");
}
