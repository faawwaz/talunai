import { createHash, randomUUID } from "node:crypto";
import { getSql } from "../db";
import {
  emptyEvidence,
  type EvidenceState,
  type SourceDocument,
} from "../domain/evidence";
import { snapshotHash } from "../domain/identity";
import { evaluatePolicy } from "../domain/policy";
import {
  createDocumentAnalysisProvider,
  type DocumentAnalysisProvider,
} from "./provider";
import {
  validateAndNormalizeExtraction,
  extractDeterministic,
} from "./extraction";
import { parseDocument } from "./documents";
import { documentStorage } from "./storage";

export type ProcessClaimInput = {
  claimId: string;
  runId: string;
  version: number;
  provider?: DocumentAnalysisProvider;
};

/** pg-boss/outbox invokes this in the separate worker. Input reservation and result
 * publication use short transactions. Document parsing and inference run without
 * holding a claim row lock. The execution token prevents an old retry from
 * publishing after another worker has taken over the run. */
export async function processClaim({
  claimId,
  runId,
  version,
  provider,
}: ProcessClaimInput) {
  const sql = getSql();
  let parsingDocumentId: string | undefined;
  const executionToken = randomUUID();
  let executionAcquired = false;
  try {
    const prepared = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`claim:${claimId}`}, 0))`;
      const [run] =
        await tx`select * from agent_runs where id=${runId} and claim_id=${claimId} for update`;
      if (!run) throw new Error("AGENT_RUN_NOT_FOUND");
      if (run.status === "COMPLETED" || run.status === "STALE")
        return { kind: "done" as const, result: run.result };
      if (
        run.status === "RUNNING" &&
        new Date(run.updated_at).getTime() > Date.now() - 90_000
      )
        return { kind: "waiting" as const };
      const [claim] =
        await tx`select * from claims where id=${claimId} for update`;
      if (
        !claim ||
        claim.version !== version ||
        run.version !== version ||
        !["EXTRACTING", "DRAFT", "NEEDS_REVIEW", "PROCESSING_FAILED"].includes(
          claim.workflow,
        )
      ) {
        await tx`update agent_runs set status='STALE',stage='VERSION_CHECK',error='CLAIM_VERSION_OR_STATE_CHANGED',updated_at=now() where id=${runId}`;
        return { kind: "done" as const, result: { status: "STALE" } };
      }
      const rows =
        await tx`select * from documents where claim_id=${claimId} and version<=${version} and purpose='DEAL' order by created_at,id`;
      if (rows.length > 20) throw new Error("CLAIM_EVIDENCE_LIMIT");
      const inputHash = snapshotHash({
        claimId,
        version,
        terms: claim.terms,
        assetType: claim.asset_type,
        goods: claim.goods,
        documents: rows.map((row) => ({ id: row.id, sha256: row.sha256 })),
      });
      await tx`update agent_runs set status='RUNNING',stage='EXTRACTION',input_hash=${inputHash},execution_token=${executionToken},updated_at=now() where id=${runId}`;
      return { kind: "ready" as const, run, claim, rows, inputHash };
    });
    if (prepared.kind === "done") return prepared.result;
    if (prepared.kind === "waiting") {
      const waitUntil = Date.now() + 70_000;
      while (Date.now() < waitUntil) {
        await new Promise((resolve) => setTimeout(resolve, 125));
        const [current] =
          await sql`select status,result,error from agent_runs where id=${runId} and claim_id=${claimId}`;
        if (!current) throw new Error("AGENT_RUN_NOT_FOUND");
        if (current.status === "COMPLETED") return current.result;
        if (current.status === "STALE") return { status: "STALE" };
        if (current.status === "FAILED")
          throw new Error(current.error ?? "AGENT_PROCESSING_FAILED");
      }
      throw new Error("AGENT_RUN_IN_PROGRESS");
    }
    executionAcquired = true;
    const { rows, inputHash } = prepared;
    const maxSteps = Number(process.env.AGENT_MAX_STEPS ?? "8");
    if (maxSteps < 5 || maxSteps > 8)
      throw new Error("AGENT_STEP_CONFIGURATION_INVALID");
    const timeoutMs = Math.min(
      Number(process.env.AGENT_TIMEOUT_MS ?? "30000"),
      60_000,
    );
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1)
      throw new Error("AGENT_TIMEOUT_CONFIGURATION_INVALID");
    const processingDeadline = Date.now() + timeoutMs;
    const storage = documentStorage();
    const parsedRows: Array<{
      id: string;
      extracted_text: string;
      status: string;
    }> = [];
    for (const row of rows) {
      if (row.status !== "PENDING_PARSE" && row.status !== "STORED") continue;
      parsingDocumentId = row.id;
      const remaining = processingDeadline - Date.now();
      if (remaining <= 0) throw new Error("DOCUMENT_PROCESSING_TIMEOUT");
      const bytes = await storage.get(row.storage_key);
      if (createHash("sha256").update(bytes).digest("hex") !== row.sha256)
        throw new Error("DOCUMENT_INTEGRITY_MISMATCH");
      const parsed = await parseDocument(bytes, row.original_name, row.mime, {
        maxBytes: Math.min(
          Number(process.env.DOCUMENT_MAX_BYTES ?? "10485760"),
          10485760,
        ),
        maxPages: Math.min(Number(process.env.DOCUMENT_MAX_PAGES ?? "20"), 20),
        timeoutMs: Math.min(remaining, 10000),
      });
      row.extracted_text = parsed.text;
      row.status = parsed.status;
      parsedRows.push({
        id: row.id,
        extracted_text: parsed.text,
        status: parsed.status,
      });
      parsingDocumentId = undefined;
    }
    const docs: SourceDocument[] = rows.map((row) => ({
      id: row.id,
      text: row.extracted_text ?? "",
      pages: (row.extracted_text ?? "").split("\f").length,
      status: row.status === "PARSED" ? "PARSED" : "NEEDS_MANUAL_ENTRY",
    }));
    if (
      docs.length > 20 ||
      docs.reduce((total, doc) => total + doc.text.length, 0) > 400_000
    )
      throw new Error("CLAIM_EVIDENCE_LIMIT");
    const analysisProvider = provider ?? createDocumentAnalysisProvider();
    if (prepared.run.mode !== analysisProvider.mode)
      throw new Error("AGENT_PROVIDER_MODE_MISMATCH");
    const remaining = processingDeadline - Date.now();
    if (remaining <= 0) throw new Error("DOCUMENT_PROCESSING_TIMEOUT");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const analysis = await Promise.race([
      analysisProvider.analyze(docs),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("PROVIDER_TIMEOUT")),
          remaining,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    const extraction = validateAndNormalizeExtraction(
      analysis.extraction,
      docs,
    );
    // Independent deterministic conflict scan prevents a live model hiding conflicts
    // when the same field appears twice in labeled fixtures/documents.
    const independent = extractDeterministic(docs);
    return await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`claim:${claimId}`}, 0))`;
      const [run] =
        await tx`select * from agent_runs where id=${runId} and claim_id=${claimId} for update`;
      if (!run || run.execution_token !== executionToken)
        return { status: "SUPERSEDED" };
      const [claim] =
        await tx`select * from claims where id=${claimId} for update`;
      const currentRows =
        await tx`select id,sha256 from documents where claim_id=${claimId} and version<=${version} and purpose='DEAL' order by created_at,id`;
      const currentHash =
        claim &&
        snapshotHash({
          claimId,
          version,
          terms: claim.terms,
          assetType: claim.asset_type,
          goods: claim.goods,
          documents: currentRows.map((row) => ({
            id: row.id,
            sha256: row.sha256,
          })),
        });
      if (
        !claim ||
        claim.version !== version ||
        run.version !== version ||
        run.status !== "RUNNING" ||
        run.input_hash !== inputHash ||
        currentHash !== inputHash ||
        !["EXTRACTING", "DRAFT", "NEEDS_REVIEW", "PROCESSING_FAILED"].includes(
          claim.workflow,
        )
      ) {
        await tx`update agent_runs set status='STALE',stage='VERSION_CHECK',error='CLAIM_VERSION_OR_STATE_CHANGED',execution_token=null,updated_at=now() where id=${runId}`;
        return { status: "STALE" };
      }
      for (const row of parsedRows)
        await tx`update documents set extracted_text=${row.extracted_text},status=${row.status} where id=${row.id} and claim_id=${claimId}`;
      const evidence: EvidenceState = { ...emptyEvidence(), ...claim.evidence };
      const orgs =
        await tx`select * from organizations where id in (${claim.org_id},${claim.buyer_org_id})`;
      const issuer = orgs.find((org) => org.id === claim.org_id),
        buyer = orgs.find((org) => org.id === claim.buyer_org_id);
      evidence.issuerAuthorityStatus =
        issuer?.status === "APPROVED" ? "ATTESTED" : "MISSING";
      evidence.buyerAuthorityStatus =
        buyer?.status === "APPROVED" ? "ATTESTED" : "MISSING";
      evidence.externalEncumbranceCheckStatus = "NOT_INTEGRATED";
      evidence.extractionStatus =
        docs.length && docs.every((doc) => doc.status === "PARSED")
          ? "SUPPORTED_BY_DOCUMENT"
          : "MISSING";
      evidence.buyerAcknowledgementStatus = extraction
        .buyerAcknowledgementReference.value
        ? "SUPPORTED_BY_DOCUMENT"
        : "MISSING";
      evidence.deliveryEvidenceStatus = extraction.proofOfDeliveryReference
        .value
        ? "SUPPORTED_BY_DOCUMENT"
        : "MISSING";
      evidence.humanReviewStatus = "PENDING";
      const duplicates =
        await tx`select id from claims where org_id=${claim.org_id} and invoice_namespace=${claim.invoice_namespace} and invoice_number=${claim.invoice_number} and id<>${claimId}`;
      // Invoice namespaces and punctuation are not independent evidence of a new
      // receivable. Candidates remain blocked until an explicit alias resolution
      // exists; neither wallets nor settled/cancelled history bypass this check.
      const normalizedInvoiceAlias = String(claim.invoice_number)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      const aliases =
        await tx`select id from claims where org_id=${claim.org_id} and regexp_replace(upper(invoice_number),'[^A-Z0-9]','','g')=${normalizedInvoiceAlias} and id<>${claimId}`;
      evidence.duplicateCheckStatus = duplicates.length
        ? "REJECTED"
        : aliases.length
          ? "PENDING"
          : "ATTESTED";
      const terms = claim.terms;
      const mismatches: string[] = [];
      if (aliases.length)
        mismatches.push("NEAR_DUPLICATE_INVOICE_REQUIRES_REVIEW");
      if (
        extraction.invoiceNumber.value
          ?.normalize("NFKC")
          .toUpperCase()
          .replace(/\s+/g, "") !== claim.invoice_number
      )
        mismatches.push("INVOICE_NUMBER_MISMATCH");
      if (
        extraction.acceptedOutstandingAmount.value !== terms.acceptedOutstanding
      )
        mismatches.push("OUTSTANDING_MISMATCH");
      if (extraction.currency.value !== "IDR")
        mismatches.push("CURRENCY_NOT_IDR");
      if (
        !claim.goods ||
        extraction.goodsDescription.value
          ?.normalize("NFKC")
          .trim()
          .toLowerCase() !==
          claim.goods.description.normalize("NFKC").trim().toLowerCase()
      )
        mismatches.push("GOODS_DESCRIPTION_REQUIRES_REVIEW");
      if (
        !claim.goods ||
        (claim.goods.category !== "OTHER" &&
          extraction.goodsCategory.value !== claim.goods.category)
      )
        mismatches.push("GOODS_CATEGORY_REQUIRES_REVIEW");
      if (claim.goods?.lineItems.length === 1) {
        const item = claim.goods.lineItems[0];
        if (
          extraction.quantity.value !== item.quantity ||
          extraction.quantityUnit.value !== item.unit
        )
          mismatches.push("GOODS_QUANTITY_OR_UNIT_REQUIRES_REVIEW");
      } else {
        // Aggregate labeled extraction cannot attest multiple distinct line items.
        mismatches.push("MULTI_LINE_ITEM_RECONCILIATION_REQUIRED");
      }
      if (
        extraction.issuerName.value?.toLowerCase() !==
        issuer?.name.toLowerCase()
      )
        mismatches.push("ISSUER_NAME_REQUIRES_REVIEW");
      if (
        extraction.buyerName.value?.toLowerCase() !== buyer?.name.toLowerCase()
      )
        mismatches.push("BUYER_NAME_REQUIRES_REVIEW");
      if (
        extraction.invoiceDueDate.value !==
        new Date(terms.invoiceDueAt * 1000).toISOString().slice(0, 10)
      )
        mismatches.push("DUE_DATE_MISMATCH");
      if (
        extraction.invoiceOriginalAmount.value === null ||
        extraction.previouslyPaidAmount.value === null ||
        BigInt(extraction.invoiceOriginalAmount.value) -
          BigInt(extraction.previouslyPaidAmount.value) !==
          BigInt(terms.acceptedOutstanding)
      )
        mismatches.push("NET_OUTSTANDING_REQUIRES_REVIEW");
      const policy = evaluatePolicy({
        assetType: claim.asset_type,
        goods: claim.goods,
        acceptedOutstanding: terms.acceptedOutstanding,
        requestedPrincipal: terms.principal,
        evidence,
        evidenceIds: docs.map((doc) => doc.id),
        chainId: Number(process.env.CHAIN_ID),
        supportedToken:
          terms.token.toLowerCase() ===
          process.env.MOCK_IDR_ADDRESS?.toLowerCase(),
        hasConflict:
          mismatches.length > 0 ||
          extraction.anomalies.length > 0 ||
          independent.anomalies.length > 0,
        knownDuplicate: duplicates.length > 0,
        alreadyFinanced: false,
        fundingHold: claim.funding_hold,
        hasDispute: claim.has_dispute,
        now: Math.floor(Date.now() / 1000),
        fundingDeadline: terms.fundingDeadline,
        invoiceDueAt: terms.invoiceDueAt,
        reviewExpiry: terms.reviewExpiry,
        consentExpiry: terms.consentExpiry,
      });
      const workflow =
        policy.outcome === "ELIGIBLE_FOR_HUMAN_APPROVAL"
          ? "READY_FOR_SIGNATURES"
          : policy.outcome === "REJECTED"
            ? "REJECTED"
            : "NEEDS_REVIEW";
      const explanation =
        policy.outcome === "ELIGIBLE_FOR_HUMAN_APPROVAL"
          ? "Dokumen sintetis memenuhi pemeriksaan deterministik; review manusia dan tanda tangan ketentuan tetap wajib."
          : `Perlu tindak lanjut: ${[...policy.reasonCodes, ...mismatches].join(", ")}.`;
      const result = {
        mode: analysisProvider.mode,
        provider: analysis.provider,
        model: analysis.model,
        latencyMs: analysis.latencyMs,
        usage: analysis.usage ?? null,
        policy,
        evidence,
        explanation,
        evidenceIds: docs.map((doc) => doc.id),
        conflicts: [
          ...mismatches,
          ...extraction.anomalies.map((item) => item.code),
        ],
        workflow,
      };
      // Evidence commitment is already versioned by ingestion. Human review creates
      // a new signed version and binds this policy snapshot in decisionHash.
      await tx`insert into extracted_fields(id,claim_id,version,fields) values(${randomUUID()},${claimId},${version},${tx.json(extraction)})`;
      await tx`insert into policy_snapshots(id,claim_id,version,result) values(${randomUUID()},${claimId},${version},${tx.json(policy)})`;
      await tx`update claims set workflow=${workflow},evidence=${tx.json(evidence)},updated_at=now() where id=${claimId} and version=${version}`;
      await tx`update consent_records set revoked=true where claim_id=${claimId} and version=${version}`;
      const stageResults = [
        {
          stage: "READ_AUTHORIZED_EVIDENCE",
          result: { documentIds: docs.map((doc) => doc.id), inputHash },
        },
        {
          stage: "EXTRACT",
          result: {
            provider: analysis.provider,
            model: analysis.model,
            latencyMs: analysis.latencyMs,
            usage: analysis.usage ?? null,
            missingFields: extraction.missingFields,
          },
        },
        {
          stage: "CHECK_EVIDENCE",
          result: {
            evidence,
            mismatches,
            anomalyCodes: extraction.anomalies.map((item) => item.code),
          },
        },
        { stage: "DETERMINISTIC_POLICY", result: policy },
        {
          stage: "REQUEST_HUMAN_ACTION",
          result: {
            workflow,
            explanation,
            evidenceIds: docs.map((doc) => doc.id),
          },
        },
      ];
      for (const [index, stage] of stageResults.entries())
        await tx`insert into agent_steps(id,run_id,step,stage,result) values(${randomUUID()},${runId},${index + 1},${stage.stage},${tx.json(stage.result)})`;
      await tx`update review_tasks set status='SUPERSEDED' where claim_id=${claimId} and version=${version} and status='OPEN'`;
      const taskRole =
        evidence.buyerAcknowledgementStatus === "MISSING"
          ? "BUYER"
          : "VERIFIER";
      const taskKind =
        taskRole === "BUYER" ? "MISSING_BUYER_ACKNOWLEDGEMENT" : "HUMAN_REVIEW";
      await tx`insert into review_tasks(id,claim_id,version,role,kind,status,details) values(${randomUUID()},${claimId},${version},${taskRole},${taskKind},'OPEN',${tx.json({ explanation, reasonCodes: policy.reasonCodes, missingFields: extraction.missingFields })})`;
      await tx`insert into audit_events(id,actor_id,action,target,before_hash,after_hash,reason,correlation_id,details) values(${randomUUID()},'AGENT','ANALYSIS_COMPLETED',${claimId},${inputHash},${snapshotHash(result)},${explanation},${runId},${tx.json({ version, mode: analysisProvider.mode, policyHash: policy.policyHash, evidenceIds: docs.map((doc) => doc.id) })})`;
      await tx`update agent_runs set mode=${analysisProvider.mode},status='COMPLETED',stage='AWAITING_HUMAN',result=${tx.json(result)},error=null,execution_token=null,updated_at=now() where id=${runId}`;
      return result;
    });
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : "AGENT_PROCESSING_FAILED";
    if (code === "AGENT_RUN_IN_PROGRESS" || !executionAcquired)
      throw new Error(code);
    // Do not log raw provider errors/documents. Failures are visible; no live-to-mock fallback.
    await sql.begin(async (tx) => {
      const [active] =
        await tx`select id from agent_runs where id=${runId} and execution_token=${executionToken} for update`;
      if (!active) return;
      const failedMode =
        code === "AGENT_PROVIDER_MODE_MISMATCH"
          ? ""
          : (provider?.mode ?? process.env.LLM_MODE);
      await tx`update agent_runs set mode=case when ${failedMode ?? ""} in ('mock','live') then ${failedMode ?? ""} else mode end,status='FAILED',stage='FAILED',error=${code},execution_token=null,updated_at=now() where id=${runId} and status<>'COMPLETED'`;
      await tx`update claims set workflow='PROCESSING_FAILED',updated_at=now() where id=${claimId} and version=${version} and workflow='EXTRACTING'`;
      if (parsingDocumentId)
        await tx`update documents set status='PARSE_FAILED' where id=${parsingDocumentId} and claim_id=${claimId}`;
      await tx`insert into audit_events(id,actor_id,action,target,reason,correlation_id,details) values(${randomUUID()},'AGENT','ANALYSIS_FAILED',${claimId},${code},${runId},${tx.json({ version })})`;
    });
    throw new Error(code);
  }
}
