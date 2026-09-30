"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  CircleAlert,
  Copy,
  ExternalLink,
  FileCheck2,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useSession } from "@/features/session/provider";
import { useWorkspaceNavigation } from "./navigation";
import { TokenIdentity } from "@/components/token-identity";
import { AccessOnboarding } from "@/features/onboarding/access";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  explainError,
  explorerUrl,
  formatDate,
  labelForStatus,
  money,
} from "@/lib/format";
import type { Claim, ReviewTask } from "../../../packages/client";
import { defaultWorkspace } from "@/lib/workspace-paths";
import {
  actionCopy,
  actionDeadlineLabel,
  actionTargetTab,
} from "./action-copy";

export function WalletWelcome() {
  const { connect, walletStatus, config } = useSession();
  const busy = ["connecting", "signing"].includes(walletStatus);
  return (
    <div className="welcome-layout">
      <div className="welcome-copy">
        <p className="text-kicker">Ruang kerja pembiayaan B2B</p>
        <h1>
          Invoice yang jelas.
          <br />
          <span>Langkah yang terarah.</span>
        </h1>
        <p className="welcome-intro">
          Kelola bukti, persetujuan, dan pembayaran atas tagihan usaha yang
          telah diakui pembeli. Dalam satu ruang kerja.
        </p>
        <Button
          size="lg"
          onClick={() => void connect().catch(() => undefined)}
          disabled={busy || !config}
        >
          {busy ? (
            <LoaderCircle className="loading-spinner" size={17} />
          ) : (
            <Wallet size={17} />
          )}
          {walletStatus === "signing"
            ? "Konfirmasi pesan di wallet"
            : busy
              ? "Menghubungkan wallet…"
              : "Masuk ke workspace"}
          <ArrowRight size={17} />
        </Button>
        <Button
          asChild
          variant="outline"
          size="lg"
          className="ml-0 mt-3 sm:ml-3 sm:mt-0"
        >
          <Link href="/app/explore">
            Jelajahi pasar <ArrowRight size={17} />
          </Link>
        </Button>
        <p className="mt-4 max-w-md text-xs leading-relaxed text-muted-foreground">
          Tanda tangan login tidak memindahkan token atau menyetujui pembiayaan.
          Pengguna baru dapat mengajukan akses organisasi setelah masuk.
        </p>
        <div className="welcome-disclosure">
          <span className="size-1.5 rounded-full bg-primary" />
          <span>
            {config?.chainId === 97
              ? "BSC Testnet"
              : config?.chainId === 31337
                ? "Anvil lokal"
                : "Memuat konfigurasi"}{" "}
            · IDRT uji testnet
          </span>
        </div>
      </div>
      <section className="welcome-process" aria-label="Alur pembiayaan">
        <div className="welcome-process-heading">
          <Layers3 size={23} strokeWidth={1.5} />
          <span>Dari bukti, menuju keputusan.</span>
        </div>
        <ol>
          {[
            {
              icon: FileCheck2,
              title: "Invoice diakui buyer",
              text: "Tagihan bernominal tetap atas barang yang sudah diserahkan.",
            },
            {
              icon: ShieldCheck,
              title: "Ditinjau oleh verifier",
              text: "Bukti diperiksa. Setiap pihak menyetujui ketentuan yang sama.",
            },
            {
              icon: ArrowDownLeft,
              title: "Pendanaan & pembayaran",
              text: "Transaksi ditandatangani pengguna. Alokasi mengikuti dana yang benar-benar diterima.",
            },
          ].map(({ icon: Icon, title, text }, index) => (
            <li key={title}>
              <span className="welcome-process-number">0{index + 1}</span>
              <div>
                <Icon size={20} strokeWidth={1.6} />
                <h2>{title}</h2>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="welcome-process-footnote">
          Agent membantu pemeriksaan. Persetujuan tetap di tangan manusia.
        </p>
      </section>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="surface p-6" aria-label="Memuat data" aria-busy="true">
      <Skeleton className="mb-6 h-5 w-36" />
      {[0, 1, 2].map((x) => (
        <Skeleton key={x} className="mb-4 h-14 w-full" />
      ))}
    </div>
  );
}
function Failure({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="danger-callout">
      <CircleAlert size={18} />
      <div>
        <p className="text-sm">{explainError(error)}</p>
        {retry && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={retry}>
            <RefreshCw size={14} />
            Coba lagi
          </Button>
        )}
      </div>
    </div>
  );
}

export function WorkspaceGate({ children }: { children: ReactNode }) {
  const { user, status } = useSession();
  if (status === "loading") return <LoadingRows />;
  if (!user) return <WalletWelcome />;
  if (!defaultWorkspace(user.memberships)) return <AccessOnboarding />;
  return children;
}
function taskText(task: ReviewTask) {
  const details = task.details as {
    missing?: string[];
    reasonCodes?: string[];
  };
  return task.kind === "MISSING_EVIDENCE"
    ? "Lengkapi bukti yang diminta oleh pemeriksaan."
    : task.kind === "HUMAN_REVIEW"
      ? "Tinjau bukti dan ketentuan pengajuan ini."
      : [...(details.missing ?? []), ...(details.reasonCodes ?? [])]
          .slice(0, 2)
          .map(labelForStatus)
          .join(" · ") || "Tinjau pengajuan dan tentukan langkah berikutnya.";
}
function ClaimRows({ claims }: { claims: Claim[] }) {
  const { claimHref } = useWorkspaceNavigation();
  return (
    <>
      <ul
        className="divide-y divide-border sm:hidden"
        aria-label="Pengajuan terkini"
      >
        {claims.map((claim) => (
          <li key={claim.id} className="px-5 py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={claimHref(claim.id)}
                  className="inline-block break-all py-1 text-sm font-semibold hover:underline"
                >
                  {claim.invoiceNumber}
                </Link>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {claim.organizationName ?? "Organisasi pemohon"}
                </p>
              </div>
              <Link
                href={claimHref(claim.id)}
                aria-label={`Buka ${claim.invoiceNumber}`}
                className="inline-flex size-10 shrink-0 items-center justify-center text-primary"
              >
                <ArrowUpRight size={17} />
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  Pembiayaan diajukan
                </p>
                <p className="mt-1 font-semibold tabular-nums">
                  {money(claim.terms.principal)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    IDRT uji
                  </span>
                </p>
              </div>
              <StatusBadge
                status={claim.fundingHold ? "FUNDING_HOLD" : claim.workflow}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Jatuh tempo invoice · {formatDate(claim.terms.invoiceDueAt)}
            </p>
          </li>
        ))}
      </ul>
      <div className="table-scroll hidden sm:block">
        <table className="data-table">
          <thead>
            <tr>
              <th>Pengajuan</th>
              <th>Status pemeriksaan</th>
              <th className="text-right">Pembiayaan diajukan</th>
              <th>Jatuh tempo invoice</th>
              <th>
                <span className="sr-only">Buka</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {claims.map((claim) => (
              <tr key={claim.id}>
                <td>
                  <Link
                    className="font-semibold hover:underline"
                    href={claimHref(claim.id)}
                  >
                    {claim.invoiceNumber}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {claim.organizationName ?? "Organisasi pemohon"} ·{" "}
                    {claim.goods?.category === "PACKAGING"
                      ? "Kemasan"
                      : claim.goods?.category === "COCOA"
                        ? "Kakao"
                        : "Barang B2B"}
                  </p>
                </td>
                <td>
                  <StatusBadge
                    status={claim.fundingHold ? "FUNDING_HOLD" : claim.workflow}
                  />
                </td>
                <td className="text-right font-semibold tabular-nums">
                  {money(claim.terms.principal)}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    IDRT uji
                  </span>
                </td>
                <td className="text-muted-foreground">
                  {formatDate(claim.terms.invoiceDueAt)}
                </td>
                <td>
                  <Link
                    href={claimHref(claim.id)}
                    aria-label={`Buka ${claim.invoiceNumber}`}
                    className="inline-flex p-2 text-primary"
                  >
                    <ArrowUpRight size={17} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function OverviewPage() {
  return (
    <WorkspaceGate>
      <OverviewContent />
    </WorkspaceGate>
  );
}
function OverviewContent() {
  const { href, claimHref } = useWorkspaceNavigation();
  const { api, user } = useSession();
  const borrower = user?.memberships.some((m) => m.role === "BORROWER");
  const claims = useQuery({
    queryKey: ["dashboard", "claims", user?.userId],
    queryFn: () => api.claims(6),
  });
  const tasks = useQuery({
    queryKey: ["dashboard", "tasks", user?.userId],
    queryFn: () => api.reviewTasks(4),
  });
  const activity = useQuery({
    queryKey: ["dashboard", "activity", user?.userId],
    queryFn: () => api.agentActivity(4),
  });
  const firstTask = tasks.data?.items[0];
  const firstClaim = claims.data?.items.find((c) =>
    ["DRAFT", "NEEDS_REVIEW", "PROCESSING_FAILED"].includes(c.workflow),
  );
  const nextHref = firstTask
    ? claimHref(firstTask.claimId, "evidence")
    : firstClaim
      ? claimHref(firstClaim.id, "evidence")
      : borrower
        ? href("claims/new")
        : href("claims");
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Ruang kerja Anda"
        title="Semua langkah, lebih jelas."
        description="Pantau pengajuan dan selesaikan hal yang memerlukan perhatian Anda."
        actions={
          borrower && (
            <Button asChild>
              <Link href={href("claims/new")}>
                <Plus size={16} />
                Buat pengajuan
              </Link>
            </Button>
          )
        }
      />
      <div className="overview-lead">
        <section className="next-action-panel">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            <span className="size-1.5 rounded-full bg-primary" />
            Langkah berikutnya
          </div>
          {tasks.isPending || claims.isPending ? (
            <Skeleton className="my-7 h-12 w-3/4" />
          ) : (
            <>
              <h2>
                {firstTask
                  ? `Tindak lanjuti ${firstTask.invoiceNumber}`
                  : firstClaim
                    ? `Lengkapi bukti ${firstClaim.invoiceNumber}`
                    : borrower && !claims.data?.items.length
                      ? "Mulai dari invoice yang telah diakui."
                      : "Pengajuan Anda ada dalam satu tempat."}
              </h2>
              <p>
                {firstTask
                  ? taskText(firstTask)
                  : firstClaim
                    ? "Tambahkan bukti penyerahan barang dan pengakuan buyer agar pemeriksaan dapat dilanjutkan."
                    : borrower && !claims.data?.items.length
                      ? "Siapkan identitas invoice, deskripsi barang, dan outstanding yang disepakati bersama buyer."
                      : "Buka daftar pengajuan untuk meninjau bukti, persetujuan, dan status pembayaran terbaru."}
              </p>
              <Button variant="outline" asChild className="mt-6">
                <Link href={nextHref}>
                  {firstTask
                    ? "Tinjau tindakan"
                    : firstClaim
                      ? "Lengkapi bukti"
                      : borrower && !claims.data?.items.length
                        ? "Siapkan pengajuan"
                        : "Lihat pengajuan"}
                  <ArrowRight size={16} />
                </Link>
              </Button>
            </>
          )}
          {(tasks.error || claims.error) && (
            <Failure
              error={tasks.error || claims.error}
              retry={() => {
                void tasks.refetch();
                void claims.refetch();
              }}
            />
          )}
        </section>
        <aside className="overview-note">
          <LockKeyhole size={22} strokeWidth={1.5} className="text-primary" />
          <h2>
            Ketentuan yang disepakati.
            <br />
            Jejak yang bisa ditelusuri.
          </h2>
          <p>
            Nominal, pihak penerima, dan persetujuan terikat pada versi
            pengajuan. Agent membantu membaca bukti; pengguna menandatangani
            tindakannya sendiri.
          </p>
          <Link
            href={href("settings")}
            className="inline-flex items-center gap-2 text-xs font-semibold text-primary"
          >
            Lihat konfigurasi jaringan
            <ArrowUpRight size={14} />
          </Link>
        </aside>
      </div>
      <section className="surface">
        <div className="surface-header">
          <div>
            <h2 className="section-heading">Pengajuan terkini</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Invoice yang dapat diakses oleh organisasi Anda
            </p>
          </div>
          <Link
            href={href("claims")}
            className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-semibold text-primary"
          >
            Lihat semua
            <ArrowRight size={15} />
          </Link>
        </div>
        {claims.isPending ? (
          <div className="p-6">
            <Skeleton className="h-28 w-full" />
          </div>
        ) : claims.error ? (
          <div className="p-6">
            <Failure error={claims.error} retry={() => void claims.refetch()} />
          </div>
        ) : claims.data?.items.length ? (
          <ClaimRows claims={claims.data.items} />
        ) : (
          <EmptyState
            title="Belum ada pengajuan"
            description={
              borrower
                ? "Ajukan piutang atas barang yang telah diserahkan dan diakui buyer. Setiap pengajuan mengikuti pemeriksaan bukti yang sama."
                : "Pengajuan yang melibatkan organisasi Anda akan muncul di sini setelah ditugaskan."
            }
            action={
              borrower && (
                <Button variant="outline" asChild>
                  <Link href={href("claims/new")}>
                    <Plus size={15} />
                    Buat pengajuan pertama
                  </Link>
                </Button>
              )
            }
          />
        )}
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface">
          <div className="surface-header">
            <h2 className="section-heading">Perlu tindakan</h2>
            <Link
              href={href("tasks")}
              aria-label="Semua tindakan"
              className="p-1 text-primary"
            >
              <ArrowUpRight size={17} />
            </Link>
          </div>
          {tasks.isPending ? (
            <div className="p-6">
              <Skeleton className="h-20" />
            </div>
          ) : tasks.error ? (
            <div className="p-6">
              <Failure error={tasks.error} />
            </div>
          ) : tasks.data?.items.length ? (
            <ul className="divide-y divide-border">
              {tasks.data.items.map((task) => (
                <li key={task.id}>
                  <Link
                    href={claimHref(task.claimId, "evidence")}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-background"
                  >
                    <span className="rounded-md bg-secondary p-2 text-primary">
                      <FileCheck2 size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {task.invoiceNumber}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {labelForStatus(task.kind)}
                      </span>
                    </span>
                    <ArrowRight size={15} className="text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-6 py-8">
              <CheckCheck size={21} className="mb-3 text-primary" />
              <p className="text-sm font-medium">Tidak ada tugas terbuka.</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Permintaan bukti dan tinjauan baru akan tampil di sini.
              </p>
            </div>
          )}
        </section>
        <section className="surface">
          <div className="surface-header">
            <h2 className="section-heading">Aktivitas pemeriksaan</h2>
            <Link
              href={href("activity")}
              aria-label="Semua aktivitas agent"
              className="p-1 text-primary"
            >
              <ArrowUpRight size={17} />
            </Link>
          </div>
          {activity.isPending ? (
            <div className="p-6">
              <Skeleton className="h-20" />
            </div>
          ) : activity.error ? (
            <div className="p-6">
              <Failure error={activity.error} />
            </div>
          ) : activity.data?.items.length ? (
            <ul className="divide-y divide-border">
              {activity.data.items.map((run) => (
                <li key={run.id}>
                  <Link
                    href={claimHref(run.claimId, "evidence")}
                    className="flex items-start gap-3 px-6 py-4 hover:bg-background"
                  >
                    <Activity
                      size={15}
                      className="mt-1 shrink-0 text-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {run.invoiceNumber} · {labelForStatus(run.status)}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {formatDate(run.updatedAt, true)} ·{" "}
                        {run.mode === "mock" ? "Mock" : "Live"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-6 py-8">
              <Activity size={21} className="mb-3 text-primary" />
              <p className="text-sm font-medium">
                Pemeriksaan belum dijalankan.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Tahapan dan hasil yang benar-benar diproses akan dicatat di
                sini.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function TasksPage() {
  return (
    <WorkspaceGate>
      <TasksContent />
    </WorkspaceGate>
  );
}
function TasksContent() {
  const { area, href, claimHref } = useWorkspaceNavigation();
  const { api, user } = useSession();
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ["actions-inbox", area, user?.userId, offset],
    queryFn: () =>
      api.actionsInbox(
        area.toUpperCase() as Parameters<typeof api.actionsInbox>[0],
        20,
        offset,
      ),
    refetchInterval: 30_000,
  });
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="TINDAKAN"
        title={area === "admin" ? "Akses & pengawasan" : "Perlu tindakan"}
        description={
          area === "admin"
            ? "Kelola akses organisasi dari menu Akses. Keputusan Deal tetap diambil peran yang berwenang."
            : "Semua langkah Deal yang dapat Anda lakukan saat ini, diurutkan menurut batas waktunya."
        }
      />
      {area !== "admin" && query.data && !query.data.financialDataCurrent && (
        <p className="info-callout text-sm" role="status">
          Data pembayaran sedang disinkronkan. Tindakan terkait dana mungkin
          belum muncul; coba muat ulang setelah sinkronisasi selesai.
        </p>
      )}
      <section className="surface">
        {query.isPending ? (
          <LoadingRows />
        ) : query.error ? (
          <div className="p-6">
            <Failure error={query.error} retry={() => void query.refetch()} />
          </div>
        ) : query.data?.items.length ? (
          <>
            <ul className="divide-y divide-border">
              {query.data.items.map((task) => (
                <li
                  key={`${task.claimId}-${task.action}`}
                  className="flex flex-col justify-between gap-4 p-6 sm:flex-row sm:items-center"
                >
                  <div className="flex items-start gap-4">
                    <span className="rounded-lg bg-secondary p-3 text-primary">
                      <FileCheck2 size={19} />
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="font-semibold">{task.invoiceNumber}</h2>
                        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-primary">
                          {actionCopy(task.action).title}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {actionCopy(task.action).description}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {task.organizationName} → {task.buyerOrganizationName}
                        {" · "}
                        {actionDeadlineLabel(task.action)}{" "}
                        {formatDate(task.dueAt)}
                      </p>
                      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                        Invoice {money(task.invoiceAmount)} IDRT uji
                        {task.action === "FUND_DEAL" &&
                          ` · Dana ${money(task.principal)} · Fee tetap ${money(task.fee)}`}
                      </p>
                    </div>
                  </div>
                  <Button asChild variant="outline">
                    <Link href={claimHref(task.claimId, actionTargetTab(task))}>
                      {actionCopy(task.action).button}
                      <ArrowRight size={15} />
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
            <Pagination
              offset={offset}
              length={query.data.items.length}
              total={query.data.total}
              setOffset={setOffset}
            />
          </>
        ) : (
          <EmptyState
            title={
              area !== "admin" && query.data && !query.data.financialDataCurrent
                ? "Menunggu sinkronisasi pembayaran"
                : "Tidak ada tindakan untuk peran ini"
            }
            description={
              area === "admin"
                ? "Permintaan akses tersedia dari menu Akses."
                : "Deal yang belum memerlukan tindakan Anda tetap dapat dipantau dari daftar Deal."
            }
            icon={CheckCheck}
            action={
              <Button variant="outline" asChild>
                <Link href={href(area === "admin" ? "access" : "claims")}>
                  {area === "admin" ? "Kelola akses" : "Lihat Deal"}
                </Link>
              </Button>
            }
          />
        )}
      </section>
    </div>
  );
}
function Pagination({
  offset,
  length,
  total,
  setOffset,
}: {
  offset: number;
  length: number;
  total?: number;
  setOffset: (n: number) => void;
}) {
  return (
    <div className="surface-footer flex items-center justify-between">
      <p className="text-xs text-muted-foreground">
        {length ? `${offset + 1}–${offset + length}` : "0"}
        {total !== undefined ? ` dari ${total}` : ""} hasil
      </p>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          Sebelumnya
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={
            total !== undefined ? offset + length >= total : length < 20
          }
          onClick={() => setOffset(offset + 20)}
        >
          Berikutnya
        </Button>
      </div>
    </div>
  );
}

export function ActivityPage() {
  return (
    <WorkspaceGate>
      <ActivityContent />
    </WorkspaceGate>
  );
}
function ActivityContent() {
  const { href, claimHref } = useWorkspaceNavigation();
  const { api, user, config } = useSession();
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ["agent-activity", user?.userId, offset],
    queryFn: () => api.agentActivity(20, offset),
    refetchInterval: (q) =>
      q.state.data?.items.some((r) =>
        ["QUEUED", "RUNNING"].includes(r.status),
      ) && q.state.dataUpdateCount < 60
        ? 5000
        : false,
  });
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Pemeriksaan yang dapat ditelusuri"
        title="Aktivitas agent"
        description="Tahapan, temuan, dan tindak lanjut dari bukti yang diotorisasi."
        actions={
          <Button
            variant="outline"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw size={15} />
            Perbarui
          </Button>
        }
      />
      <div className="info-callout">
        <Activity size={18} />
        <p>
          <strong>
            {config?.llmMode === "live"
              ? "Mode live · OpenRouter"
              : "Mode mock · parser deterministik"}
          </strong>
          <br />
          Agent membaca dan membandingkan bukti. Persetujuan manusia dan tanda
          tangan pengguna tetap diperlukan.
        </p>
      </div>
      <section className="surface">
        {query.isPending ? (
          <LoadingRows />
        ) : query.error ? (
          <div className="p-6">
            <Failure error={query.error} retry={() => void query.refetch()} />
          </div>
        ) : !query.data?.items.length ? (
          <EmptyState
            icon={Activity}
            title="Belum ada aktivitas pemeriksaan"
            description="Unggah dokumen pada pengajuan lalu mulai analisis. Proses akan berjalan di worker dan tercatat di sini."
            action={
              <Button variant="outline" asChild>
                <Link href={href("claims")}>
                  Buka pengajuan
                  <ArrowRight size={15} />
                </Link>
              </Button>
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {query.data.items.map((run) => (
                <li key={run.id} className="p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Link
                      href={claimHref(run.claimId, "evidence")}
                      className="inline-flex items-center gap-2 font-semibold hover:underline"
                    >
                      {run.invoiceNumber ?? "Pengajuan"}
                      <ArrowUpRight size={15} />
                    </Link>
                    <StatusBadge status={run.status} />
                  </div>
                  <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                    {run.error
                      ? `Proses berhenti: ${labelForStatus(run.error)}. Buka bukti untuk meninjau dan mencoba kembali.`
                      : (run.result?.explanation ??
                        `Tahap saat ini: ${labelForStatus(run.stage)}. Hasil belum tersedia.`)}
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {formatDate(run.updatedAt, true)} · Versi {run.version} ·{" "}
                    {run.mode === "mock" ? "Mock" : "Live"}
                    {run.result?.provider ? ` · ${run.result.provider}` : ""}
                  </p>
                </li>
              ))}
            </ul>
            <Pagination
              offset={offset}
              length={query.data.items.length}
              setOffset={setOffset}
            />
          </>
        )}
      </section>
    </div>
  );
}

export function PaymentsPage() {
  return (
    <WorkspaceGate>
      <PaymentsContent />
    </WorkspaceGate>
  );
}
function PaymentsContent() {
  const { href, claimHref } = useWorkspaceNavigation();
  const { api, user } = useSession();
  const [offset, setOffset] = useState(0);
  const claims = useQuery({
    queryKey: ["payment-claims", user?.userId, offset],
    queryFn: () => api.claims(20, offset, { workflow: "REGISTERED" }),
  });
  const amounts = useQueries({
    queries: (claims.data?.items ?? []).map((claim) => ({
      queryKey: ["financing", claim.id],
      queryFn: () => api.financing(claim.id),
    })),
  });
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Pembukuan per pengajuan"
        title="Pembayaran"
        description="Pembiayaan lunas, invoice tertagih, dan saldo ditarik adalah tiga peristiwa yang berbeda."
      />
      <div className="info-callout">
        <ShieldCheck size={18} />
        <p>
          Nominal berasal dari proyeksi event chain terkonfirmasi. Transfer
          token langsung ke kontrak tidak dihitung sebagai pembayaran invoice.
        </p>
      </div>
      <section className="surface">
        {claims.isPending ? (
          <LoadingRows />
        ) : claims.error ? (
          <div className="p-6">
            <Failure error={claims.error} retry={() => void claims.refetch()} />
          </div>
        ) : !claims.data?.items.length ? (
          <EmptyState
            icon={ArrowDownLeft}
            title="Belum ada pengajuan terdaftar onchain"
            description="Pembayaran dan alokasi dana akan tersedia setelah registrasi terkonfirmasi. Pengajuan yang masih ditinjau dapat dilihat di daftar pengajuan."
            action={
              <Button variant="outline" asChild>
                <Link href={href("claims")}>
                  Lihat pengajuan
                  <ArrowRight size={15} />
                </Link>
              </Button>
            }
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Status pembiayaan</th>
                    <th className="text-right">Collection diterima</th>
                    <th className="text-right">Sisa invoice</th>
                    <th>Status collection</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.data.items.map((claim, i) => {
                    const finance = amounts[i];
                    return (
                      <tr key={claim.id}>
                        <td>
                          <Link
                            href={claimHref(claim.id, "payments")}
                            className="font-semibold hover:underline"
                          >
                            {claim.invoiceNumber}
                          </Link>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {claim.organizationName}
                          </p>
                        </td>
                        {finance.isPending ? (
                          <td colSpan={4}>
                            <Skeleton className="h-6" />
                          </td>
                        ) : finance.error ? (
                          <td colSpan={4}>
                            <Failure
                              error={finance.error}
                              retry={() => void finance.refetch()}
                            />
                          </td>
                        ) : (
                          <>
                            <td>
                              <StatusBadge
                                status={
                                  finance.data?.financingStatus ?? "UNFUNDED"
                                }
                              />
                              {finance.data?.stateConfidence !==
                                "CONFIRMED_PROJECTION" && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  {labelForStatus(
                                    finance.data?.stateConfidence ?? "",
                                  )}
                                </p>
                              )}
                            </td>
                            <td className="text-right font-semibold tabular-nums">
                              {money(finance.data?.totalCollected)}
                              <p className="mt-1 text-xs font-normal text-muted-foreground">
                                IDRT uji
                              </p>
                            </td>
                            <td className="text-right tabular-nums">
                              {money(finance.data?.remainingInvoiceCollection)}
                              <p className="mt-1 text-xs text-muted-foreground">
                                IDRT uji
                              </p>
                            </td>
                            <td>
                              <StatusBadge
                                status={
                                  finance.data?.collectionStatus ?? "UNPAID"
                                }
                              />
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              offset={offset}
              length={claims.data.items.length}
              setOffset={setOffset}
            />
          </>
        )}
      </section>
    </div>
  );
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <code className="break-all text-xs text-foreground">{value}</code>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0"
        aria-label="Salin alamat"
        onClick={() =>
          void navigator.clipboard
            .writeText(value)
            .then(() => {
              setCopied(true);
              setFailed(false);
              setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => setFailed(true))
        }
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </Button>
      {failed && (
        <span role="alert" className="text-xs">
          Salin alamat secara manual.
        </span>
      )}
    </span>
  );
}

export function SettingsPage() {
  const { user, config, status } = useSession();
  if (status === "loading") return <LoadingRows />;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Konfigurasi workspace"
        title="Organisasi & jaringan"
        description="Identitas yang memiliki akses dan lingkungan transaksi yang digunakan."
      />
      <section className="surface">
        <div className="surface-header">
          <h2 className="section-heading">Akun & kewenangan</h2>
          {user && <StatusBadge status={user.status} />}
        </div>
        <div className="p-6">
          {user ? (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                Wallet sesi aktif
              </p>
              <CopyValue value={user.wallet} />
              {user.memberships.length ? (
                <div className="mt-6 divide-y divide-border">
                  {user.memberships.map((m) => (
                    <div
                      key={`${m.organizationId}:${m.role}`}
                      className="flex flex-wrap items-center justify-between gap-3 py-4"
                    >
                      <div>
                        <p className="text-sm font-semibold">
                          {m.organizationName}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {labelForStatus(m.role)} · Identitas sintetis
                        </p>
                      </div>
                      <StatusBadge status={m.organizationStatus} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-5 rounded-md bg-secondary p-4 text-sm leading-relaxed">
                  Wallet telah diautentikasi. Belum ada membership organisasi
                  yang disetujui. Hubungi pengelola untuk mengaktifkan akses.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Masuk dengan wallet untuk melihat organisasi dan peran Anda.
            </p>
          )}
        </div>
      </section>
      <section className="surface">
        <div className="surface-header">
          <h2 className="section-heading">Jaringan & kontrak</h2>
          <span className="text-xs font-semibold text-primary">
            TESTNET / LOKAL
          </span>
        </div>
        {!config ? (
          <div className="p-6 text-sm text-muted-foreground">
            Konfigurasi belum tersedia. Muat ulang setelah koneksi pulih.
          </div>
        ) : (
          <div className="p-6">
            <dl className="grid gap-6 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Jaringan</dt>
                <dd className="mt-2 text-sm font-semibold">
                  {config.chainId === 97
                    ? "BNB Smart Chain Testnet"
                    : "Anvil lokal"}
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    Chain ID {config.chainId}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  Token pembayaran
                </dt>
                <dd className="mt-2 text-sm font-semibold">
                  <TokenIdentity />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  Konfirmasi indexer
                </dt>
                <dd className="mt-2 text-sm font-semibold">
                  {config.confirmations} blok
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    Bukan jaminan finalitas protokol
                  </span>
                </dd>
              </div>
            </dl>
            <div className="mt-8 divide-y divide-border">
              {Object.entries(config.contracts).map(([key, value]) => (
                <div
                  key={key}
                  className="flex flex-col justify-between gap-2 py-4 lg:flex-row lg:items-center"
                >
                  <p className="text-sm font-medium">
                    {
                      {
                        registry: "Registry piutang",
                        vault: "Kontrak pembiayaan",
                        agentExecutor: "Aksi agent terbatas",
                        token: "IDRT simulasi · MockIDR onchain",
                      }[key]
                    }
                  </p>
                  <div className="flex min-w-0 items-center gap-2">
                    <CopyValue value={value} />
                    {explorerUrl(config.chainId, "address", value) && (
                      <a
                        href={explorerUrl(config.chainId, "address", value)}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 text-primary"
                        aria-label={`Lihat ${key} di explorer`}
                      >
                        <ExternalLink size={15} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      <section className="surface p-6">
        <h2 className="section-heading">Detail lingkungan</h2>
        <div className="mt-5 grid gap-6 text-sm leading-relaxed text-muted-foreground sm:grid-cols-2">
          <p>
            Piutang perdagangan bernominal tetap, atas barang yang telah
            diserahkan dan diakui buyer. Kategori kakao dan kemasan tersedia
            dalam alur saat ini.
          </p>
          <p>
            Token uji tidak memberi hak atas barang atau jaminan pengembalian.
            Pemeriksaan eksternal dan penyelesaian sengketa belum terintegrasi.
          </p>
        </div>
      </section>
    </div>
  );
}
