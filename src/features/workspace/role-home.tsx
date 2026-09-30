"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  FileCheck2,
  Plus,
  ShieldCheck,
  CheckCheck,
} from "lucide-react";
import { useSession } from "@/features/session/provider";
import { useWorkspaceNavigation } from "./navigation";
import {
  nextClaimTask,
  type ParticipantArea,
} from "@/features/claims/next-task";
import { InlineError, RefreshButton } from "@/features/claims/shared";
import { PageHeader } from "@/components/page-header";
import { LoadingState } from "@/components/loading-state";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate, money } from "@/lib/format";
import {
  actionCopy,
  actionDeadlineLabel,
  actionTargetTab,
} from "./action-copy";

const copy = {
  borrower: {
    eyebrow: "PEMOHON",
    title: "Usaha berjalan. Piutang terpantau.",
    description:
      "Lengkapi bukti, setujui ketentuan, dan ikuti pembayaran atas invoice usaha Anda.",
    queue: "Piutang usaha Anda",
    empty: "Mulai dengan invoice yang sudah diakui",
    emptyText:
      "Siapkan invoice, bukti penyerahan barang, dan pengakuan pembeli. Kategori barang tidak menentukan kelayakan secara otomatis.",
    note: "Pencairan principal dan residual collection adalah dua penerimaan yang berbeda.",
  },
  buyer: {
    eyebrow: "PEMBELI",
    title: "Tagihan yang jelas. Pembayaran terarah.",
    description:
      "Tinjau invoice atas organisasi Anda, akui ketentuan final, lalu bayar sisa tagihan melalui kontrak.",
    queue: "Invoice organisasi Anda",
    empty: "Belum ada invoice untuk ditinjau",
    emptyText:
      "Invoice muncul setelah pemohon memilih organisasi Anda sebagai buyer. Pengakuan wallet tersedia setelah review verifier selesai.",
    note: "Pengakuan invoice tidak memindahkan token. Izin token dan pembayaran merupakan transaksi terpisah.",
  },
  lender: {
    eyebrow: "PENDANA",
    title: "Tinjau bukti sebelum mendanai.",
    description:
      "Danai invoice langsung atau tempatkan likuiditas di pool. Hasil mengikuti pembayaran buyer yang diterima.",
    queue: "Peluang pendanaan",
    empty: "Belum ada piutang dalam akses Anda",
    emptyText:
      "Akses lender mengikuti undangan dan otorisasi organisasi. Registrasi onchain belum menjamin pendanaan tersedia atau dana akan kembali.",
    note: "Satu lender membiayai seluruh principal. Tidak ada jaminan pengembalian principal atau fee.",
  },
  verifier: {
    eyebrow: "VERIFIER",
    title: "Bukti dulu. Keputusan yang dapat ditelusuri.",
    description:
      "Periksa sumber dokumen, selesaikan gates, dan catat keputusan manusia sebelum meminta persetujuan para pihak.",
    queue: "Pengajuan dalam peninjauan",
    empty: "Belum ada pengajuan untuk diperiksa",
    emptyText:
      "Pengajuan masuk ke antrean setelah analisis. Review, registrasi, dan pembukaan hold memerlukan tindakan verifier yang berbeda.",
    note: "Perubahan bukti memerlukan versi baru. Persetujuan lama harus dicabut di jaringan atau kedaluwarsa sebelum revisi.",
  },
  admin: {
    eyebrow: "ADMINISTRATOR",
    title: "Jaga kewenangan. Pantau prosesnya.",
    description:
      "Kelola akses organisasi sintetis dan pantau proses tanpa mengambil alih tanda tangan peserta.",
    queue: "Pengajuan yang dapat dipantau",
    empty: "Belum ada pengajuan",
    emptyText:
      "Tinjau permintaan akses organisasi testnet. Peran admin tidak menggantikan persetujuan verifier atau lender.",
    note: "Aktivasi membership tidak menggantikan allowlist lender onchain, KYB nyata, atau persetujuan pembiayaan.",
  },
} satisfies Record<ParticipantArea, Record<string, string>>;
const lenderReadinessCopy = {
  REQUEST_LENDER_ALLOWLIST:
    "Akses aplikasi aktif. Wallet ini masih menunggu izin pendanaan pada kontrak; minta admin mengaktifkannya.",
  GET_TEST_TOKEN:
    "Wallet belum memiliki IDRT uji untuk mendanai Deal. Minta token uji kepada operator.",
  GET_TESTNET_GAS:
    "Wallet membutuhkan tBNB untuk biaya transaksi di BSC Testnet.",
  APPROVE_TOKEN:
    "Izin token untuk vault belum tersedia. Saat membuka Deal, periksa jumlah dan setujui izin di wallet sebelum mendanai.",
  READY:
    "Akses wallet aktif. Saldo dan izin untuk setiap Deal tetap diperiksa sebelum transaksi.",
} as const;

export function RoleHome({ area }: { area: ParticipantArea }) {
  const { api, user } = useSession();
  const navigation = useWorkspaceNavigation();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const interval = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      30_000,
    );
    return () => window.clearInterval(interval);
  }, []);
  const claims = useQuery({
    queryKey: ["role-home", area, "claims", user?.userId],
    queryFn: () => api.claims(12),
    enabled: Boolean(user),
  });
  const inbox = useQuery({
    queryKey: ["actions-inbox", area, user?.userId, 0],
    queryFn: () =>
      api.actionsInbox(
        area.toUpperCase() as Parameters<typeof api.actionsInbox>[0],
        8,
      ),
    enabled: Boolean(user),
    refetchInterval: 30_000,
  });
  const lenderReadiness = useQuery({
    queryKey: ["lender-readiness", user?.wallet],
    queryFn: () => api.lenderReadiness(),
    enabled: Boolean(user) && area === "lender",
    refetchInterval: 30_000,
  });
  const registeredClaims = (claims.data?.items ?? []).filter(
    (claim) => claim.workflow === "REGISTERED",
  );
  const financingQueries = useQueries({
    queries: registeredClaims.map((claim) => ({
      queryKey: ["financing", claim.id],
      queryFn: () => api.financing(claim.id),
      enabled: Boolean(user),
      refetchInterval: 15_000,
    })),
  });
  const financingByClaim = new Map(
    registeredClaims.map((claim, index) => [
      claim.id,
      financingQueries[index]?.data,
    ]),
  );
  const taskFor = (claim: (typeof registeredClaims)[number]) =>
    nextClaimTask(
      area,
      claim,
      now,
      financingByClaim.get(claim.id),
      user?.wallet,
    );
  const text = copy[area];
  const openTasks = inbox.data?.items ?? [];
  const visibleClaims = (claims.data?.items ?? []).filter((claim) => {
    if (area !== "borrower" && area !== "buyer") return true;
    const organizationId =
      area === "borrower" ? claim.organizationId : claim.buyerOrganizationId;
    return user?.memberships.some(
      (membership) =>
        membership.role.toLowerCase() === area &&
        membership.organizationId === organizationId,
    );
  });
  const prioritized = [...visibleClaims].sort(
    (a, b) => Number(taskFor(b).actionable) - Number(taskFor(a).actionable),
  );
  const next = openTasks[0];
  const refresh = () => {
    void claims.refetch();
    void inbox.refetch();
    if (area === "lender") void lenderReadiness.refetch();
    for (const query of financingQueries) void query.refetch();
  };
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={text.eyebrow}
        title={text.title}
        description={text.description}
        actions={
          area === "borrower" && inbox.data?.total === 0 ? (
            <Button asChild>
              <Link href={navigation.href("/claims/new")}>
                <Plus size={16} />
                Ajukan piutang
              </Link>
            </Button>
          ) : area === "admin" ? (
            <Button asChild>
              <Link href={navigation.href("/access")}>
                <ShieldCheck size={16} />
                Tinjau permintaan akses
              </Link>
            </Button>
          ) : (
            <RefreshButton
              onClick={refresh}
              busy={claims.isFetching || inbox.isFetching}
            />
          )
        }
      />
      {area === "lender" && lenderReadiness.error && (
        <InlineError
          error={lenderReadiness.error}
          onRefresh={() => void lenderReadiness.refetch()}
        />
      )}
      {area === "lender" && lenderReadiness.data && (
        <section className="info-callout text-sm" aria-label="Kesiapan wallet">
          <p className="font-semibold">Kesiapan wallet pendana</p>
          <p className="mt-1">
            {lenderReadinessCopy[lenderReadiness.data.nextAction]}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            IDRT uji {money(lenderReadiness.data.tokenBalance)} · diperiksa pada
            blok {lenderReadiness.data.blockNumber}
          </p>
        </section>
      )}
      {inbox.isPending ? (
        <LoadingState />
      ) : inbox.error ? (
        <InlineError
          error={inbox.error}
          onRefresh={() => void inbox.refetch()}
        />
      ) : next ? (
        <section className="flex flex-col gap-6 rounded-lg bg-secondary p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div className="max-w-2xl">
            <p className="text-kicker">
              TINDAKAN BERIKUTNYA · {next.invoiceNumber}
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">
              {actionCopy(next.action).title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {actionCopy(next.action).description}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              {next.organizationName} → {next.buyerOrganizationName} ·{" "}
              {actionDeadlineLabel(next.action)} {formatDate(next.dueAt)}
            </p>
            {next.action === "FUND_DEAL" && (
              <div className="mt-5 border-t border-border pt-4">
                <p className="text-kicker mb-3">
                  KETENTUAN PENDANAAN · IDRT UJI
                </p>
                <dl className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Principal</dt>
                    <dd className="mt-1 text-base font-semibold tabular-nums">
                      {money(next.principal)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Fee tetap</dt>
                    <dd className="mt-1 text-base font-semibold tabular-nums">
                      {money(next.fee)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Hak maksimum pendana
                    </dt>
                    <dd className="mt-1 text-base font-semibold tabular-nums">
                      {money(
                        (BigInt(next.principal) + BigInt(next.fee)).toString(),
                      )}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Hak ini bergantung pada pembayaran buyer yang benar-benar
                  diterima. Fee tetap bukan APY atau imbal hasil terjamin.
                </p>
              </div>
            )}
          </div>
          <Button asChild className="shrink-0">
            <Link
              href={navigation.claimHref(next.claimId, actionTargetTab(next))}
            >
              {actionCopy(next.action).button}
              <ArrowRight size={16} />
            </Link>
          </Button>
        </section>
      ) : (
        <EmptyState
          icon={FileCheck2}
          title={
            area !== "admin" && inbox.data && !inbox.data.financialDataCurrent
              ? "Menunggu sinkronisasi pembayaran"
              : "Tidak ada tindakan untuk peran ini"
          }
          description={
            area === "admin"
              ? "Permintaan akses dan pengelolaan organisasi tersedia di menu Akses."
              : "Lihat daftar Deal untuk memantau status atau membuka pengajuan baru."
          }
          action={
            area === "borrower" ? (
              <Button asChild>
                <Link href={navigation.href("/claims/new")}>
                  Buat pengajuan pertama
                  <ArrowRight size={16} />
                </Link>
              </Button>
            ) : area === "lender" ? (
              <Button variant="outline" asChild>
                <Link href="/lender/explore">Jelajahi pasar</Link>
              </Button>
            ) : undefined
          }
        />
      )}
      {area !== "admin" && inbox.data && !inbox.data.financialDataCurrent && (
        <p className="info-callout text-sm" role="status">
          Data pembayaran sedang disinkronkan. Tindakan terkait dana mungkin
          belum tampil. Muat ulang setelah sinkronisasi selesai.
        </p>
      )}
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="surface overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-5">
            <h2 className="text-base font-semibold">{text.queue}</h2>
            <Link
              href={navigation.href("/claims")}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary"
            >
              Lihat semua
              <ArrowRight size={14} />
            </Link>
          </div>
          {claims.isPending ? (
            <div className="px-6 py-8">
              <LoadingState />
            </div>
          ) : claims.error ? (
            <div className="p-6">
              <InlineError
                error={claims.error}
                onRefresh={() => void claims.refetch()}
              />
            </div>
          ) : !prioritized.length ? (
            <p className="px-6 py-8 text-sm text-muted-foreground">
              Pengajuan yang berada dalam kewenangan Anda akan muncul di sini.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {prioritized.map((claim) => {
                const task = taskFor(claim);
                const financing = financingByClaim.get(claim.id);
                const displayStatus =
                  claim.workflow !== "REGISTERED" ||
                  financing?.stateConfidence !== "CONFIRMED_PROJECTION"
                    ? claim.workflow
                    : financing.registryStatus === "CANCELLED"
                      ? "CANCELLED"
                      : financing.financingStatus === "UNFUNDED" &&
                          Math.min(
                            claim.terms.fundingDeadline,
                            claim.terms.reviewExpiry,
                            claim.terms.consentExpiry,
                          ) <= now
                        ? "FUNDING_EXPIRED"
                        : financing.collectionStatus === "FULLY_COLLECTED"
                          ? "FULLY_COLLECTED"
                          : financing.collectionStatus === "PARTIALLY_COLLECTED"
                            ? "PARTIALLY_COLLECTED"
                            : financing.financingStatus === "UNFUNDED"
                              ? "AVAILABLE"
                              : "ACTIVE";
                return (
                  <li key={claim.id}>
                    <Link
                      href={navigation.claimHref(claim.id, task.tab)}
                      className="group grid gap-3 px-6 py-5 transition-colors hover:bg-background sm:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-sm font-semibold group-hover:text-primary">
                            {claim.invoiceNumber}
                          </span>
                          <StatusBadge
                            status={
                              claim.fundingHold || claim.hasDispute
                                ? "FUNDING_HOLD"
                                : displayStatus
                            }
                          />
                        </div>
                        <p className="mt-2 truncate text-xs text-muted-foreground">
                          {claim.organizationName ?? claim.organizationId} →{" "}
                          {claim.buyerOrganizationName ??
                            claim.buyerOrganizationId}
                        </p>
                        <p className="mt-2 text-xs text-primary">
                          {task.title}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-5 sm:block sm:text-right">
                        <p className="text-sm font-semibold tabular-nums">
                          {money(claim.terms.principal)}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            IDRT uji
                          </span>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Principal{" "}
                          {area === "lender" ? "kontraktual" : "diajukan"}
                        </p>
                        {area === "lender" && (
                          <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                            Fee tetap {money(claim.terms.fee)} IDRT uji
                          </p>
                        )}
                        <p className="mt-2 text-xs text-muted-foreground">
                          Jatuh tempo {formatDate(claim.terms.invoiceDueAt)}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
            Menampilkan maksimal 12 Deal terbaru. Buka semua Deal untuk melihat
            pekerjaan yang lebih lama. Nominal adalah ketentuan, bukan saldo
            wallet.
          </p>
        </section>
        <aside className="space-y-6">
          <section className="surface p-6">
            <div className="flex items-center gap-2">
              <CheckCheck size={17} className="text-primary" />
              <h2 className="text-sm font-semibold">Tugas yang tercatat</h2>
            </div>
            {inbox.isPending ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Memuat tugas…
              </p>
            ) : inbox.error ? (
              <div className="mt-4">
                <InlineError
                  error={inbox.error}
                  onRefresh={() => void inbox.refetch()}
                />
              </div>
            ) : !openTasks.length ? (
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Tidak ada tindakan untuk peran ini saat ini. Status Deal tetap
                dapat ditinjau dari daftar Deal.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {openTasks.map((task) => (
                  <li key={`${task.claimId}-${task.action}`}>
                    <Link
                      href={navigation.claimHref(
                        task.claimId,
                        actionTargetTab(task),
                      )}
                      className="block py-3 hover:text-primary"
                    >
                      <p className="text-sm font-medium">
                        {actionCopy(task.action).title}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {task.invoiceNumber} · {task.organizationName}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {inbox.data && inbox.data.total > openTasks.length && (
              <p className="mt-3 text-xs text-muted-foreground">
                {inbox.data.total} tindakan tersedia; {openTasks.length}{" "}
                ditampilkan di sini.
              </p>
            )}
            <Link
              href={navigation.href("/tasks")}
              className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-primary"
            >
              Buka antrean tugas
              <ArrowRight size={14} />
            </Link>
          </section>
          {area === "lender" && (
            <section
              className="surface p-5"
              aria-label="Pendanaan melalui pool"
            >
              <p className="text-kicker">LIKUIDITAS POOL</p>
              <h2 className="mt-2 text-sm font-semibold">Lihat posisi pool</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Pool lama hanya menampilkan posisi, penarikan, hasil, dan
                riwayat onchain. Deposit dan alokasi baru ditutup.
              </p>
              <Link
                href="/lender/explore#market-position"
                className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary"
              >
                Buka pasar & posisi <ArrowRight size={14} />
              </Link>
            </section>
          )}
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            {text.note}
          </p>
        </aside>
      </div>
    </div>
  );
}
