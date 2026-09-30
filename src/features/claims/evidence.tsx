"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Download,
  FileText,
  Play,
  Upload,
  Clock3,
} from "lucide-react";
import { useSession } from "@/features/session/provider";
import { useWorkspaceNavigation } from "@/features/workspace/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { formatDate, labelForStatus } from "@/lib/format";
import {
  TalunaiApiError,
  type Claim,
  type DocumentMetadata,
} from "../../../packages/client";
import {
  InlineError,
  SectionTitle,
  useClaimRoles,
  useRefreshClaim,
} from "./shared";

const evidenceLabels: Record<string, string> = {
  extractionStatus: "Ekstraksi dokumen",
  issuerAuthorityStatus: "Kewenangan penerbit",
  buyerAuthorityStatus: "Kewenangan buyer",
  buyerAcknowledgementStatus: "Pengakuan buyer",
  deliveryEvidenceStatus: "Bukti penyerahan",
  duplicateCheckStatus: "Pemeriksaan duplikasi",
  externalEncumbranceCheckStatus: "Pemeriksaan jaminan eksternal",
  humanReviewStatus: "Peninjauan manusia",
};
const fieldLabels = {
  issuerName: "Penerbit invoice",
  buyerName: "Buyer",
  invoiceNumber: "Nomor invoice",
  issueDate: "Tanggal terbit",
  invoiceDueDate: "Jatuh tempo",
  currency: "Mata uang",
  invoiceOriginalAmount: "Nilai invoice awal",
  previouslyPaidAmount: "Pembayaran sebelumnya",
  acceptedOutstandingAmount: "Outstanding diakui",
  goodsDescription: "Deskripsi barang",
  goodsCategory: "Kategori barang",
  quantity: "Kuantitas",
  quantityUnit: "Satuan",
  purchaseOrderReference: "Referensi PO",
  proofOfDeliveryReference: "Referensi penyerahan",
  buyerAcknowledgementReference: "Referensi pengakuan buyer",
} as const;

export function ClaimEvidence({ claim }: { claim: Claim }) {
  const { api } = useSession();
  const navigation = useWorkspaceNavigation();
  const roles = useClaimRoles(claim);
  const refresh = useRefreshClaim(claim.id);
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const evidence = useQuery({
    queryKey: ["evidence", claim.id],
    queryFn: () => api.evidence(claim.id),
  });
  const runs = useQuery({
    queryKey: ["agent-runs", claim.id, 5],
    queryFn: () => api.agentRuns(claim.id, 5),
    refetchInterval: (query) =>
      claim.workflow === "EXTRACTING" && query.state.dataUpdateCount < 60
        ? 3000
        : false,
  });
  const latestRun = runs.data?.items[0];
  const run = useQuery({
    queryKey: ["agent-run", latestRun?.id],
    queryFn: () => api.agentRun(latestRun!.id),
    enabled: Boolean(latestRun?.id),
    refetchInterval: (query) =>
      ["QUEUED", "RUNNING"].includes(query.state.data?.status ?? "") &&
      query.state.dataUpdateCount < 60
        ? 3000
        : false,
  });
  const lastSettledRun = useRef<string | null>(null);
  useEffect(() => {
    if (!run.data || ["QUEUED", "RUNNING"].includes(run.data.status)) return;
    const key = `${run.data.id}:${run.data.status}`;
    if (lastSettledRun.current === key) return;
    lastSettledRun.current = key;
    void refresh();
  }, [run.data, refresh]);
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Pilih dokumen terlebih dahulu.");
      return api.uploadDocument(
        claim.id,
        file,
        claim.version,
        crypto.randomUUID(),
      );
    },
    onSuccess: async () => {
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await refresh();
    },
  });
  const revisionDetails =
    upload.error instanceof TalunaiApiError &&
    upload.error.code === "CONSENT_REVOCATION_REQUIRED"
      ? (upload.error.details as {
          pendingConsents?: Array<{
            role: string;
            nonce: string;
            deadline: number;
          }>;
        } | null)
      : null;
  const pendingRevisionConsents = Array.isArray(
    revisionDetails?.pendingConsents,
  )
    ? revisionDetails.pendingConsents
    : [];
  const analyze = useMutation({
    mutationFn: () => api.analyze(claim.id, claim.version, crypto.randomUUID()),
    onSuccess: async () => {
      await refresh();
    },
  });
  const download = useMutation({
    mutationFn: async (doc: DocumentMetadata) => {
      const blob = await api.downloadDocument(doc.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = doc.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  const editable = [
    "DRAFT",
    "NEEDS_REVIEW",
    "READY_FOR_SIGNATURES",
    "READY_FOR_REGISTRATION",
    "PROCESSING_FAILED",
    "REJECTED",
  ].includes(claim.workflow);
  const currentRun = run.data ?? latestRun;
  const runIsCurrent = currentRun?.version === claim.version;
  const runStatus = currentRun?.status;
  const currentPolicy =
    runIsCurrent && runStatus === "COMPLETED"
      ? (currentRun.result?.policy ?? null)
      : null;
  const currentSnapshotIndex =
    evidence.data?.extractedFields.findIndex(
      (snapshot) => snapshot.version === claim.version,
    ) ?? -1;
  const selectFile = (next: File | undefined) => {
    setLocalError(null);
    if (!next) return;
    if (next.size > 10 * 1024 * 1024) {
      setLocalError("Ukuran dokumen maksimal 10 MiB.");
      return;
    }
    if (!/\.(pdf|txt|json)$/i.test(next.name)) {
      setLocalError("Gunakan PDF teks, TXT UTF-8, atau JSON sintetis.");
      return;
    }
    setFile(next);
  };
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_330px]">
      <div className="space-y-7">
        <section id="dokumen-pendukung" className="surface scroll-mt-24 p-6">
          <SectionTitle
            title="Dokumen pendukung"
            description="Dokumen disimpan privat dan hanya dapat dibaca oleh pihak yang berwenang."
          />
          {evidence.isPending ? (
            <LoadingState />
          ) : evidence.error ? (
            <InlineError
              error={evidence.error}
              onRefresh={() => void evidence.refetch()}
            />
          ) : !evidence.data?.documents.length ? (
            <div className="rounded-md bg-background px-5 py-8 text-center">
              <FileText size={23} className="mx-auto mb-3 text-primary" />
              <p className="text-sm font-medium">Belum ada dokumen</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Tambahkan invoice, bukti penyerahan, dan pengakuan buyer untuk
                mendukung claim ini.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {evidence.data.documents.map((doc) => (
                <li key={doc.id} className="flex items-start gap-3 py-4">
                  <FileText
                    size={19}
                    className="mt-1 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-medium"
                      title={doc.name}
                    >
                      {doc.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {(doc.sizeBytes / 1024).toLocaleString("id-ID", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      KiB · {formatDate(doc.createdAt)} · v{doc.version}
                    </p>
                    <div className="mt-2">
                      <StatusBadge status={doc.status} />
                      {doc.purpose === "DISPUTE" && (
                        <span className="ml-2 text-xs font-medium text-muted-foreground">
                          Bukti sengketa · tidak mengubah ketentuan Deal
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Unduh ${doc.name}`}
                    onClick={() => download.mutate(doc)}
                    disabled={download.isPending}
                  >
                    <Download size={17} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {roles.borrower && editable && (
            <div className="mt-6 border-t border-border pt-6">
              <label
                htmlFor="evidence-upload"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  selectFile(event.dataTransfer.files[0]);
                }}
                className="flex cursor-pointer flex-col items-center rounded-lg border border-dashed border-[#7A8B80] bg-background px-5 py-7 text-center transition-colors hover:bg-secondary focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary"
              >
                <Upload size={21} className="mb-3 text-primary" />
                <span className="text-sm font-medium">
                  {file ? file.name : "Pilih atau letakkan dokumen di sini"}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  PDF teks, TXT, JSON sintetis · maks. 10 MiB · 20 halaman PDF
                </span>
                <input
                  ref={inputRef}
                  id="evidence-upload"
                  type="file"
                  accept=".pdf,.txt,.json"
                  onChange={(event) => selectFile(event.target.files?.[0])}
                  className="sr-only"
                />
              </label>
              {localError && (
                <p role="alert" className="mt-2 text-sm text-red-700">
                  {localError}
                </p>
              )}
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                  Dokumen baru dapat membuat versi Deal baru. Persetujuan lama
                  perlu dicabut di wallet atau menunggu kedaluwarsa sebelum
                  revisi disimpan. PDF scan membutuhkan penanganan manual.
                </p>
                <Button
                  variant="secondary"
                  disabled={!file || upload.isPending}
                  onClick={() => upload.mutate()}
                >
                  {upload.isPending ? "Menyimpan…" : "Simpan dokumen"}
                </Button>
              </div>
            </div>
          )}
          <div className="mt-4">
            <InlineError
              error={upload.error || download.error}
              onRefresh={() => void refresh()}
            />
            {upload.error instanceof TalunaiApiError &&
              upload.error.code === "CONSENT_REVOCATION_REQUIRED" && (
                <div className="mt-3 space-y-2 text-sm">
                  {pendingRevisionConsents.length > 0 && (
                    <p className="text-muted-foreground">
                      Perlu dicabut atau menunggu kedaluwarsa:{" "}
                      {pendingRevisionConsents
                        .map(
                          (consent) =>
                            `${labelForStatus(consent.role)} · nonce ${consent.nonce} · ${formatDate(consent.deadline, true)}`,
                        )
                        .join("; ")}
                      .
                    </p>
                  )}
                  <Link
                    href={navigation.claimHref(claim.id, "terms")}
                    className="inline-flex items-center gap-1.5 font-semibold text-primary"
                  >
                    Buka persetujuan untuk pencabutan
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </div>
              )}
          </div>
        </section>
        <section className="surface p-6">
          <SectionTitle
            title="Analisis bukti"
            description="Temuan otomatis membantu verifier memeriksa sumber. Hasil ini tidak menyetujui pembiayaan."
            action={
              (roles.borrower || roles.verifier) && editable ? (
                <Button
                  onClick={() => analyze.mutate()}
                  disabled={
                    analyze.isPending || !evidence.data?.documents.length
                  }
                >
                  <Play size={14} />
                  {analyze.isPending
                    ? "Menjadwalkan…"
                    : latestRun
                      ? "Analisis ulang"
                      : "Mulai analisis"}
                </Button>
              ) : undefined
            }
          />
          <InlineError
            error={analyze.error || runs.error || run.error}
            onRefresh={() => void refresh()}
          />
          {!latestRun ? (
            <p className="py-4 text-sm text-muted-foreground">
              Analisis belum dijalankan. Unggah dokumen, lalu mulai analisis.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-background p-4">
                <div>
                  <p className="text-sm font-medium">
                    {runIsCurrent
                      ? currentPolicy?.outcome === "ELIGIBLE_FOR_HUMAN_APPROVAL"
                        ? "Siap ditinjau verifier"
                        : currentPolicy?.outcome === "NEEDS_REVIEW"
                          ? "Perlu pemeriksaan lanjutan"
                          : currentPolicy?.outcome === "REJECTED"
                            ? "Tidak memenuhi kebijakan saat ini"
                            : labelForStatus(
                                currentRun?.stage ?? latestRun.stage,
                              )
                      : "Hasil versi sebelumnya"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {currentRun?.mode === "mock"
                      ? "Parser deterministik (mock)"
                      : currentRun?.result?.provider === "openrouter"
                        ? "OpenRouter live"
                        : runStatus === "FAILED"
                          ? "OpenRouter belum menghasilkan hasil"
                          : "OpenRouter dijadwalkan, hasil belum tersedia"}{" "}
                    · Versi {currentRun?.version ?? latestRun.version}
                  </p>
                </div>
                <StatusBadge status={runStatus ?? latestRun.status} />
              </div>
              {!runIsCurrent && (
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Pengajuan sekarang versi {claim.version}. Jalankan pemeriksaan
                  lagi agar temuan sesuai dengan dokumen dan ketentuan terbaru.
                </p>
              )}
              {(run.data?.error || latestRun.error) && (
                <p role="alert" className="mt-3 text-sm text-red-700">
                  Analisis belum berhasil:{" "}
                  {labelForStatus(run.data?.error ?? latestRun.error ?? "")}.
                  Hasil ini tidak memberikan persetujuan.
                </p>
              )}
              {currentPolicy && (
                <div className="mt-4 border-t border-border pt-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {roles.verifier
                      ? "Bandingkan nilai dengan dokumen asli sebelum memberi keputusan."
                      : "Verifier akan membandingkan hasil ini dengan dokumen asli sebelum memberi keputusan."}
                  </p>
                  <p className="mt-4 text-xs font-semibold text-muted-foreground">
                    {currentPolicy.reasonCodes.length
                      ? "Alasan yang perlu diperiksa"
                      : "Temuan kebijakan"}
                  </p>
                  {currentPolicy.reasonCodes.length ? (
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {currentPolicy.reasonCodes.map((code) => (
                        <li key={code}>{labelForStatus(code)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Tidak ada ketidaksesuaian otomatis. Verifier tetap harus
                      membandingkan kutipan dengan dokumen asli.
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <a href="#nilai-sumber-ekstraksi">Periksa sumber bukti</a>
                    </Button>
                    {roles.borrower &&
                      editable &&
                      currentPolicy.reasonCodes.length > 0 && (
                        <Button variant="outline" size="sm" asChild>
                          <a href="#dokumen-pendukung">Lengkapi dokumen</a>
                        </Button>
                      )}
                    {roles.verifier &&
                      ["NEEDS_REVIEW", "READY_FOR_SIGNATURES"].includes(
                        claim.workflow,
                      ) &&
                      claim.evidence.humanReviewStatus !== "ATTESTED" && (
                        <Button size="sm" asChild>
                          <Link href={navigation.claimHref(claim.id, "terms")}>
                            Tinjau dan putuskan <ArrowRight size={14} />
                          </Link>
                        </Button>
                      )}
                  </div>
                </div>
              )}
              {Boolean(run.data?.steps.length) && (
                <details className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-medium text-foreground">
                    Lihat tahap proses ({run.data?.steps.length})
                  </summary>
                  <ol className="mt-3 space-y-2">
                    {run.data?.steps.map((step) => (
                      <li key={step.id}>
                        {String(step.step).padStart(2, "0")} ·{" "}
                        {labelForStatus(step.stage)} ·{" "}
                        {formatDate(step.createdAt)}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {["QUEUED", "RUNNING"].includes(
                run.data?.status ?? latestRun.status,
              ) && (
                <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 size={14} />
                  Status diperbarui otomatis selama halaman aktif. Muat ulang
                  jika penantian berlanjut.
                </p>
              )}
            </>
          )}
        </section>
        <section
          id="nilai-sumber-ekstraksi"
          className="surface scroll-mt-24 p-6"
        >
          <SectionTitle
            title="Nilai dan sumber ekstraksi"
            description="Bandingkan nilai terstruktur dengan kutipan asli. Teks dokumen adalah bukti yang ditinjau, bukan instruksi untuk menjalankan tindakan."
          />
          {evidence.isPending ? (
            <p className="text-sm text-muted-foreground">Memuat referensi…</p>
          ) : evidence.error ? (
            <InlineError
              error={evidence.error}
              onRefresh={() => void evidence.refetch()}
            />
          ) : !evidence.data?.extractedFields.length ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              Belum ada ekstraksi tersimpan. Setelah analisis selesai, setiap
              nilai yang ditemukan ditampilkan beserta dokumen sumbernya. Nilai
              yang tidak diketahui tetap kosong.
            </p>
          ) : (
            <div className="space-y-5">
              {evidence.data.extractedFields.map((snapshot, index) => (
                <details
                  key={snapshot.id}
                  open={index === currentSnapshotIndex}
                  className="border-t border-border pt-4 first:border-t-0 first:pt-0"
                >
                  <summary className="cursor-pointer text-sm font-semibold">
                    Hasil ekstraksi versi {snapshot.version}
                    {snapshot.version !== claim.version
                      ? " · riwayat, periksa terhadap versi ketentuan terbaru"
                      : " · versi saat ini"}
                  </summary>
                  <dl className="mt-4 divide-y divide-border">
                    {Object.entries(fieldLabels).map(([key, label]) => {
                      const field =
                        snapshot.fields[key as keyof typeof fieldLabels];
                      const source = evidence.data?.documents.find(
                        (document) => document.id === field.documentId,
                      );
                      return (
                        <div
                          key={key}
                          className="grid gap-2 py-4 sm:grid-cols-[155px_minmax(0,1fr)]"
                        >
                          <dt className="text-xs text-muted-foreground">
                            {label}
                          </dt>
                          <dd className="min-w-0">
                            <p className="break-words text-sm font-medium tabular-nums">
                              {field.value ?? "Tidak ditemukan"}
                            </p>
                            {field.rawText && (
                              <blockquote className="mt-2 whitespace-pre-wrap break-words rounded-md bg-background px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                                {field.rawText}
                              </blockquote>
                            )}
                            {source && (
                              <button
                                type="button"
                                onClick={() => download.mutate(source)}
                                disabled={download.isPending}
                                className="mt-2 text-left text-xs text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
                              >
                                {source.name}
                                {field.page ? ` · halaman ${field.page}` : ""}
                                {field.line ? ` · baris ${field.line}` : ""} ·
                                unduh sumber
                              </button>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                  {snapshot.fields.anomalies.length > 0 && (
                    <div className="danger-callout mt-4">
                      <p className="text-sm font-semibold">
                        Anomali yang tercatat
                      </p>
                      <ul className="mt-2 space-y-2 text-xs leading-relaxed">
                        {snapshot.fields.anomalies.map((anomaly, index) => (
                          <li key={`${anomaly.code}-${index}`}>
                            <span className="font-medium">
                              {labelForStatus(anomaly.code)}
                            </span>
                            <p className="mt-1 whitespace-pre-wrap break-words">
                              {anomaly.rawText}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </details>
              ))}
            </div>
          )}
        </section>
      </div>
      <aside>
        <section className="surface p-6">
          <SectionTitle
            title="Kesiapan bukti"
            description="Setiap pemeriksaan memiliki status tersendiri."
          />
          <dl className="space-y-5">
            {Object.entries(evidence.data?.evidence ?? claim.evidence).map(
              ([key, status]) => (
                <div key={key}>
                  <dt className="mb-2 text-sm text-muted-foreground">
                    {evidenceLabels[key] ?? labelForStatus(key)}
                  </dt>
                  <dd>
                    <StatusBadge status={status} />
                  </dd>
                </div>
              ),
            )}
          </dl>
          {Boolean(currentPolicy?.outstandingGates.length) && (
            <div className="mt-6 border-t border-border pt-4">
              <p className="text-sm font-medium">
                Catatan saat analisis terakhir
              </p>
              <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
                {currentPolicy?.outstandingGates.map((gate) => (
                  <li key={gate} className="flex gap-2">
                    <span aria-hidden="true">·</span>
                    {evidenceLabels[gate] ?? labelForStatus(gate)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-6 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
            Pemeriksaan jaminan di bank atau platform lain belum terintegrasi.
            Bukti dan attestation tidak menghilangkan risiko penipuan atau
            kolusi.
          </p>
        </section>
      </aside>
    </div>
  );
}
