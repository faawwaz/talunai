"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Layers3,
  ListTodo,
  Radio,
  ShieldCheck,
} from "lucide-react";
import { useSession } from "@/features/session/provider";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { Button } from "@/components/ui/button";
import { formatDate, labelForStatus } from "@/lib/format";
import { OperatorGate, HealthBadge, OpsFailure, OpsReload } from "./shared";
import { RunRows } from "./runs";

export function AgentOverviewPage() {
  return (
    <OperatorGate>
      <OverviewContent />
    </OperatorGate>
  );
}

function OverviewContent() {
  const { api, user } = useSession();
  const status = useQuery({
    queryKey: ["ops-status", user?.userId],
    queryFn: () => api.opsStatus(),
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });
  const recent = useQuery({
    queryKey: ["ops-runs", user?.userId, "recent"],
    queryFn: () => api.opsRuns({ limit: 5, offset: 0 }),
  });
  const data = status.data;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operasional agent"
        title="Ruang kendali"
        description="Pantau pemeriksaan, kesehatan worker, dan pencatatan chain dari data operasional yang tersimpan."
        actions={
          <OpsReload
            busy={status.isFetching || recent.isFetching}
            onClick={() => {
              void status.refetch();
              void recent.refetch();
            }}
          />
        }
      />
      {status.isPending ? (
        <section className="surface">
          <LoadingState label="Memuat kondisi operasional…" />
        </section>
      ) : status.error || !data ? (
        <OpsFailure
          error={status.error ?? "Kondisi operasional tidak tersedia."}
          retry={() => void status.refetch()}
        />
      ) : (
        <>
          <section className="context-band flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <ShieldCheck size={20} className="mt-0.5 shrink-0 text-primary" />
              <div>
                <h2 className="text-sm font-semibold">
                  {data.status === "READY"
                    ? "Worker dan indexer terpantau aktif"
                    : data.status === "DEGRADED"
                      ? "Ada kondisi yang perlu ditangani"
                      : "Status sistem belum dapat dipastikan"}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {data.status === "READY"
                    ? "Kondisi ini berasal dari heartbeat terbaru. Keberhasilan setiap aksi tetap mengikuti hasil proses dan konfirmasi chain."
                    : "Periksa heartbeat dan riwayat proses sebelum menyiapkan exposure baru. Koneksi belum dapat dianggap sehat."}
                </p>
              </div>
            </div>
            <HealthBadge status={data.status} />
          </section>
          <section className="surface">
            <div className="surface-header">
              <h2 className="text-sm font-semibold">Kesehatan sistem</h2>
              <span className="text-xs text-muted-foreground">
                Chain {data.chainId}
              </span>
            </div>
            <div className="divide-y divide-border">
              <div className="flex min-w-0 flex-col gap-4 p-5 sm:flex-row sm:p-6">
                <Radio
                  size={19}
                  className="shrink-0 text-primary"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">Worker</h3>
                    <HealthBadge status={data.worker.status} />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Menjalankan pemeriksaan dokumen, pekerjaan persisten, dan
                    rekonsiliasi transaksi.
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Provider:{" "}
                    <span className="font-medium text-foreground">
                      {data.worker.mode === "live"
                        ? "OpenRouter live"
                        : data.worker.mode === "mock"
                          ? "Parser deterministik (mock)"
                          : "Belum teramati"}
                    </span>
                    {data.worker.mode === "live" && data.worker.model
                      ? ` · ${data.worker.model}`
                      : ""}
                  </p>
                  {data.worker.configurationMatch === false && (
                    <p className="mt-2 text-xs text-destructive">
                      Mode atau model worker berbeda dari konfigurasi web.
                      Samakan konfigurasi sebelum menjalankan pemeriksaan baru.
                    </p>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    Heartbeat:{" "}
                    {data.worker.updatedAt
                      ? formatDate(data.worker.updatedAt, true)
                      : "Belum ada heartbeat tersimpan"}
                  </p>
                  {data.worker.errorCode && (
                    <p className="mt-2 break-words text-xs text-destructive">
                      {labelForStatus(data.worker.errorCode)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-4 p-5 sm:flex-row sm:p-6">
                <Layers3
                  size={19}
                  className="shrink-0 text-primary"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">Indexer chain</h3>
                    <HealthBadge status={data.indexer.status} />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Checkpoint terkonfirmasi:{" "}
                    <span className="font-semibold text-foreground tabular-nums">
                      {data.indexer.blockNumber ?? "Belum tercatat"}
                    </span>
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Diperbarui:{" "}
                    {data.indexer.updatedAt
                      ? formatDate(data.indexer.updatedAt, true)
                      : "Belum ada checkpoint"}
                  </p>
                  {data.indexer.blockHash && (
                    <p className="mt-2 break-all text-xs text-muted-foreground">
                      Block hash: {data.indexer.blockHash}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-4 p-5 sm:flex-row sm:p-6">
                <ListTodo
                  size={19}
                  className="shrink-0 text-primary"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h3 className="text-sm font-semibold">
                      Pengiriman pekerjaan
                    </h3>
                    <p className="text-sm font-semibold tabular-nums">
                      {data.queues.pending} menunggu
                    </p>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Pekerjaan tersimpan di outbox PostgreSQL dan belum
                    diserahkan ke antrean worker.
                  </p>
                  {data.queues.oldestPendingAt && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Paling lama sejak{" "}
                      {formatDate(data.queues.oldestPendingAt, true)}
                    </p>
                  )}
                  {data.queues.byType.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                      {data.queues.byType.map((queue) => (
                        <li key={queue.type}>
                          {labelForStatus(queue.type)}:{" "}
                          <span className="font-semibold tabular-nums">
                            {queue.pending}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
            <p className="surface-footer text-xs leading-relaxed text-muted-foreground">
              Diamati {formatDate(data.observedAt, true)} · Heartbeat dianggap
              terlambat setelah {data.freshnessThresholdSeconds} detik. Tidak
              ada estimasi lag chain tanpa data block head.
            </p>
          </section>
          <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(240px,1fr)]">
            <section className="surface">
              <div className="surface-header">
                <h2 className="text-sm font-semibold">Pemeriksaan terbaru</h2>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/agent/runs">
                    Semua proses
                    <ArrowRight size={14} />
                  </Link>
                </Button>
              </div>
              {recent.isPending ? (
                <LoadingState label="Memuat proses terbaru…" />
              ) : recent.error ? (
                <div className="p-6">
                  <OpsFailure
                    error={recent.error}
                    retry={() => void recent.refetch()}
                  />
                </div>
              ) : recent.data?.items.length ? (
                <RunRows runs={recent.data.items} />
              ) : (
                <EmptyState
                  title="Belum ada pemeriksaan"
                  description="Proses yang dijalankan dari pengajuan akan muncul di sini beserta status sebenarnya."
                />
              )}
            </section>
            <aside className="space-y-6">
              <section className="surface">
                <div className="surface-header">
                  <h2 className="text-sm font-semibold">Riwayat pemeriksaan</h2>
                </div>
                <dl className="space-y-4 p-5 sm:p-6">
                  {(
                    [
                      ["QUEUED", "Dalam antrean"],
                      ["RUNNING", "Sedang diperiksa"],
                      ["COMPLETED", "Selesai"],
                      ["FAILED", "Gagal"],
                      ["STALE", "Versi kedaluwarsa"],
                    ] as const
                  ).map(([key, label]) => (
                    <div
                      className="flex justify-between gap-3 text-sm"
                      key={key}
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-semibold tabular-nums">
                        {data.runs[key]}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="surface">
                <div className="surface-header">
                  <h2 className="text-sm font-semibold">
                    Pemantauan transaksi
                  </h2>
                </div>
                <dl className="space-y-4 p-5 sm:p-6">
                  <div className="flex justify-between gap-3 text-sm">
                    <dt className="text-muted-foreground">Belum final</dt>
                    <dd className="font-semibold tabular-nums">
                      {data.transactions.pending}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 text-sm">
                    <dt className="text-muted-foreground">
                      Perlu rekonsiliasi
                    </dt>
                    <dd className="font-semibold tabular-nums">
                      {data.transactions.unknown}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 text-sm">
                    <dt className="text-muted-foreground">Reverted</dt>
                    <dd className="font-semibold tabular-nums">
                      {data.transactions.reverted}
                    </dd>
                  </div>
                </dl>
                <div className="surface-footer">
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/agent/transactions">
                      Lihat transaksi
                      <ArrowRight size={14} />
                    </Link>
                  </Button>
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
