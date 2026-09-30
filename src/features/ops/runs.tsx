"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileSearch,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useSession } from "@/features/session/provider";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDate, labelForStatus } from "@/lib/format";
import {
  TalunaiApiError,
  type OpsRun,
  type OpsRunDetail,
  type OpsRetryResult,
  type OpsRunStatus,
} from "../../../packages/client";
import {
  OperatorGate,
  operatorClaimHref,
  OpsFailure,
  OpsPagination,
  OpsReload,
  OpsMetadata,
} from "./shared";

const runStatusOptions: Record<OpsRunStatus, string> = {
  QUEUED: "Dalam antrean",
  RUNNING: "Sedang diperiksa",
  COMPLETED: "Selesai",
  FAILED: "Gagal",
  STALE: "Versi kedaluwarsa",
};

export function RunRows({ runs }: { runs: OpsRun[] }) {
  return (
    <ul className="divide-y divide-border">
      {runs.map((run) => (
        <li key={run.id}>
          <Link
            href={`/agent/runs/${encodeURIComponent(run.id)}`}
            className="group flex min-w-0 items-start gap-4 px-5 py-5 transition-colors hover:bg-secondary/40 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-primary sm:px-6"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="break-words text-sm font-semibold">
                  {run.invoiceNumber}
                </span>
                <StatusBadge status={run.status} />
              </div>
              <p className="mt-2 break-words text-sm text-muted-foreground">
                {run.organizationName}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Versi {run.version}
                  {run.version !== run.currentVersion &&
                    ` · versi terbaru ${run.currentVersion}`}
                </span>
                <span>{labelForStatus(run.stage)}</span>
                <span>
                  {run.mode === "mock"
                    ? "Mock · parser deterministik"
                    : run.provider === "openrouter"
                      ? "OpenRouter live"
                      : run.status === "FAILED"
                        ? "OpenRouter · hasil gagal"
                        : "OpenRouter · menunggu hasil"}
                </span>
                <span>{formatDate(run.updatedAt, true)}</span>
              </div>
              {run.errorCode && (
                <p className="mt-2 break-words text-xs text-destructive">
                  {labelForStatus(run.errorCode)}
                </p>
              )}
            </div>
            <ArrowRight
              size={16}
              className="mt-1 shrink-0 text-muted-foreground group-hover:text-primary"
              aria-hidden="true"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AgentRunsPage() {
  return (
    <OperatorGate>
      <RunsContent />
    </OperatorGate>
  );
}

function RunsContent() {
  const { api, user } = useSession();
  const [status, setStatus] = useState<OpsRunStatus | "">("");
  const [offset, setOffset] = useState(0);
  const runs = useQuery({
    queryKey: ["ops-runs", user?.userId, status, offset],
    queryFn: () =>
      api.opsRuns({ status: status || undefined, limit: 20, offset }),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        ["QUEUED", "RUNNING"].includes(item.status),
      )
        ? 5000
        : false,
    refetchIntervalInBackground: false,
  });
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operasional agent"
        title="Proses pemeriksaan"
        description="Jejak ekstraksi, evaluasi kebijakan, dan penjelasan yang benar-benar tersimpan."
        actions={
          <OpsReload
            busy={runs.isFetching}
            onClick={() => void runs.refetch()}
          />
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Label htmlFor="ops-run-status">Status proses</Label>
          <Select
            id="ops-run-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as OpsRunStatus | "");
              setOffset(0);
            }}
          >
            <option value="">Semua status</option>
            {Object.entries(runStatusOptions).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          Persetujuan akhir tetap oleh manusia
        </p>
      </div>
      <section className="surface">
        {runs.isPending ? (
          <LoadingState label="Memuat riwayat proses…" />
        ) : runs.error ? (
          <div className="p-6">
            <OpsFailure error={runs.error} retry={() => void runs.refetch()} />
          </div>
        ) : !runs.data?.items.length ? (
          <EmptyState
            icon={FileSearch}
            title="Belum ada proses pada tampilan ini"
            description="Pemeriksaan yang dijalankan dari pengajuan akan tercatat di sini. Ubah filter untuk melihat status lain."
          />
        ) : (
          <>
            <RunRows runs={runs.data.items} />
            <OpsPagination
              offset={offset}
              length={runs.data.items.length}
              total={runs.data.total}
              onChange={setOffset}
            />
          </>
        )}
      </section>
    </div>
  );
}

export function AgentRunDetailPage({ id }: { id: string }) {
  return (
    <OperatorGate>
      <RunDetailContent id={id} />
    </OperatorGate>
  );
}

function RunDetailContent({ id }: { id: string }) {
  const { api, user } = useSession();
  const run = useQuery({
    queryKey: ["ops-run", user?.userId, id],
    queryFn: () => api.opsRun(id),
    refetchInterval: (query) =>
      ["QUEUED", "RUNNING"].includes(query.state.data?.status ?? "")
        ? 5000
        : false,
    refetchIntervalInBackground: false,
  });
  if (run.isPending) return <LoadingState label="Memuat detail proses…" />;
  if (run.error || !run.data)
    return (
      <div className="page-stack">
        <Button variant="ghost" asChild className="self-start">
          <Link href="/agent/runs">
            <ArrowLeft size={15} />
            Semua proses
          </Link>
        </Button>
        <OpsFailure
          error={run.error ?? "Detail proses tidak tersedia."}
          retry={() => void run.refetch()}
        />
      </div>
    );
  const data = run.data;
  const canReview = Boolean(
    user?.memberships.some((membership) => membership.role === "VERIFIER"),
  );
  return (
    <div className="page-stack">
      <Button variant="ghost" asChild className="self-start">
        <Link href="/agent/runs">
          <ArrowLeft size={15} />
          Semua proses
        </Link>
      </Button>
      <PageHeader
        eyebrow="Detail pemeriksaan"
        title={data.invoiceNumber}
        description={data.organizationName}
        actions={
          <div className="flex flex-wrap gap-2">
            <OpsReload
              busy={run.isFetching}
              onClick={() => void run.refetch()}
            />
            <Button asChild variant="outline">
              <Link href={operatorClaimHref(user, data.claimId, "evidence")}>
                Buka bukti
                <ArrowRight size={15} />
              </Link>
            </Button>
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={data.status} />
        <span className="text-xs text-muted-foreground">
          Diperbarui {formatDate(data.updatedAt, true)}
        </span>
      </div>
      {data.version !== data.currentVersion && (
        <p className="context-band text-sm leading-relaxed">
          Proses ini memeriksa versi {data.version}. Pengajuan sekarang berada
          di versi {data.currentVersion}; hasil ini tetap disimpan sebagai
          riwayat.
        </p>
      )}
      {data.status === "COMPLETED" && data.version === data.currentVersion && (
        <section
          aria-label="Langkah berikutnya"
          className="context-band flex flex-col justify-between gap-4 sm:flex-row sm:items-center"
        >
          <div>
            <p className="text-sm font-semibold">Lanjutkan review manusia</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Cocokkan temuan dengan dokumen asli. Agent tidak menyetujui
              pembiayaan atau memindahkan dana.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link
              href={operatorClaimHref(
                user,
                data.claimId,
                canReview ? "terms" : "evidence",
              )}
            >
              {canReview ? "Tinjau pengajuan" : "Periksa bukti"}
              <ArrowRight size={15} />
            </Link>
          </Button>
        </section>
      )}
      {data.errorCode && (
        <section className="danger-callout" role="status">
          <div>
            <h2 className="text-sm font-semibold">
              Pemeriksaan belum berhasil
            </h2>
            <p className="mt-1 text-sm">{labelForStatus(data.errorCode)}</p>
            <p className="mt-2 break-all text-xs">Kode: {data.errorCode}</p>
          </div>
        </section>
      )}
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
        <div className="min-w-0 space-y-6">
          <section className="surface">
            <div className="surface-header">
              <h2 className="text-sm font-semibold">Hasil pemeriksaan</h2>
            </div>
            <div className="space-y-5 p-5 sm:p-6">
              {data.explanation ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {data.explanation}
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {data.status === "QUEUED"
                    ? "Penjelasan akan tersedia setelah worker menyimpan hasil pemeriksaan. Status antrean belum berarti proses selesai."
                    : "Tidak ada penjelasan tersimpan untuk proses ini."}
                </p>
              )}
              {data.reasonCodes.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground">
                    Alasan kebijakan
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {data.reasonCodes.map((code) => (
                      <li key={code} className="text-sm">
                        {labelForStatus(code)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.evidenceIds.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground">
                    Referensi bukti
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {data.evidenceIds.map((evidence) => (
                      <li key={evidence} className="break-all text-xs">
                        <Link
                          className="text-primary underline decoration-primary/30 underline-offset-4"
                          href={operatorClaimHref(
                            user,
                            data.claimId,
                            "evidence",
                          )}
                        >
                          {evidence}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
          <section className="surface">
            <div className="surface-header">
              <h2 className="text-sm font-semibold">Tahap yang tercatat</h2>
              <span className="text-xs text-muted-foreground">
                {data.steps.length} tahap
              </span>
            </div>
            {data.steps.length ? (
              <ol className="divide-y divide-border">
                {data.steps
                  .slice()
                  .sort((a, b) => a.step - b.step)
                  .map((step) => (
                    <li key={step.id} className="flex min-w-0 gap-4 p-5 sm:p-6">
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold tabular-nums"
                        aria-hidden="true"
                      >
                        {step.step}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap justify-between gap-2">
                          <h3 className="text-sm font-semibold">
                            {labelForStatus(step.stage)}
                          </h3>
                          <time
                            className="text-xs text-muted-foreground"
                            dateTime={step.createdAt}
                          >
                            {formatDate(step.createdAt, true)}
                          </time>
                        </div>
                        {step.explanation && (
                          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                            {step.explanation}
                          </p>
                        )}
                        {(step.provider ||
                          step.model ||
                          step.latencyMs !== null) && (
                          <p className="mt-3 break-words text-xs text-muted-foreground">
                            {[
                              step.provider,
                              step.model,
                              step.latencyMs !== null
                                ? `${step.latencyMs} ms`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        {step.reasonCodes.length > 0 && (
                          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                            {step.reasonCodes.map((code) => (
                              <li key={code}>{labelForStatus(code)}</li>
                            ))}
                          </ul>
                        )}
                        {step.evidenceIds.length > 0 && (
                          <p className="mt-3 break-all text-xs text-muted-foreground">
                            Bukti: {step.evidenceIds.join(", ")}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
              </ol>
            ) : (
              <div className="p-6 text-sm text-muted-foreground">
                Worker belum menyimpan tahap untuk proses ini.
              </div>
            )}
          </section>
        </div>
        <aside className="min-w-0 space-y-6">
          <section className="surface">
            <div className="surface-header">
              <h2 className="text-sm font-semibold">Rincian eksekusi</h2>
            </div>
            <dl className="grid gap-5 p-5 sm:p-6">
              <OpsMetadata label="Tahap terakhir">
                {labelForStatus(data.stage)}
              </OpsMetadata>
              <OpsMetadata label="Versi yang diperiksa">
                Versi {data.version}
              </OpsMetadata>
              <OpsMetadata label="Mode ekstraksi">
                {data.mode === "live" ? "Live" : "Mock"}
              </OpsMetadata>
              <OpsMetadata label="Provider">
                {data.provider ?? "Belum tercatat"}
              </OpsMetadata>
              <OpsMetadata label="Model">
                {data.model ?? "Belum tercatat"}
              </OpsMetadata>
              <OpsMetadata label="Durasi provider">
                {data.latencyMs === null
                  ? "Belum tercatat"
                  : `${data.latencyMs} ms`}
              </OpsMetadata>
              <OpsMetadata label="Mulai tercatat">
                {formatDate(data.createdAt, true)}
              </OpsMetadata>
              <OpsMetadata label="ID proses">{data.id}</OpsMetadata>
              <OpsMetadata label="Commitment input">
                {data.inputHash || "Belum tercatat"}
              </OpsMetadata>
            </dl>
          </section>
          <RetryRun key={data.id} run={data} />
        </aside>
      </div>
    </div>
  );
}

function RetryRun({ run }: { run: OpsRunDetail }) {
  const { api } = useSession();
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<OpsRetryResult | null>(null);
  const attempt = useRef<string | null>(null);
  const sending = useRef(false);
  if (!run.retryable && !result) return null;
  async function retry() {
    if (sending.current || result) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    attempt.current ??= crypto.randomUUID();
    try {
      const accepted = await api.retryOpsRun(
        run.id,
        { expectedVersion: run.currentVersion },
        attempt.current,
      );
      setResult(accepted);
      await cache.invalidateQueries({ queryKey: ["ops-runs"] });
      await cache.invalidateQueries({ queryKey: ["ops-status"] });
    } catch (err) {
      const code = err instanceof TalunaiApiError ? err.code : "";
      setError(
        code === "RUN_NOT_RETRYABLE"
          ? "Proses ini tidak lagi dapat dijadwalkan ulang. Perbarui halaman untuk memeriksa status dan versi terbaru."
          : code.includes("STALE") || code.includes("VERSION")
            ? "Versi atau status pengajuan sudah berubah. Perbarui halaman sebelum menjadwalkan ulang."
            : code.includes("RETRY_LIMIT")
              ? "Batas percobaan ulang untuk versi ini sudah tercapai. Tinjau penyebab kegagalan pada pengajuan."
              : err,
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="surface p-5 sm:p-6">
      <h2 className="text-sm font-semibold">
        {result
          ? "Percobaan ulang tersimpan"
          : "Gangguan sementara dapat dicoba ulang"}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {result
          ? "Pekerjaan baru telah masuk antrean persisten. Hasil sebelumnya tetap tersimpan."
          : "Worker akan memeriksa ulang versi pengajuan yang sama. Percobaan ini tidak memberikan persetujuan atau mengirim pendanaan."}
      </p>
      {error !== null && (
        <div className="mt-4">
          <OpsFailure error={error} />
        </div>
      )}
      {result ? (
        <Button variant="outline" asChild className="mt-4">
          <Link href={`/agent/runs/${encodeURIComponent(result.runId)}`}>
            <Check size={15} />
            Lihat proses baru
            <ArrowRight size={15} />
          </Link>
        </Button>
      ) : (
        <Button
          variant="outline"
          className="mt-4"
          disabled={busy}
          onClick={() => void retry()}
        >
          {busy ? (
            <LoaderCircle size={15} className="loading-spinner" />
          ) : (
            <RefreshCw size={15} />
          )}
          {busy ? "Menyimpan pekerjaan…" : "Jadwalkan ulang pemeriksaan"}
        </Button>
      )}
    </section>
  );
}
