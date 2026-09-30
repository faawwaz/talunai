"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { tableFeatures, useTable, type ColumnDef } from "@tanstack/react-table";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FileText,
  Plus,
  Search,
} from "lucide-react";
import { useSession } from "@/features/session/provider";
import { useWorkspaceNavigation } from "@/features/workspace/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatDate, money } from "@/lib/format";
import type { Claim, Workflow } from "../../../packages/client";
import { ClaimSessionGate, InlineError, RefreshButton } from "./shared";

const features = tableFeatures({});
const emptyClaims: Claim[] = [];

export function ClaimsList() {
  return (
    <ClaimSessionGate>
      <ClaimsListContent />
    </ClaimSessionGate>
  );
}

function ClaimsListContent() {
  const navigation = useWorkspaceNavigation();
  const { api, user } = useSession();
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [workflow, setWorkflow] = useState<Workflow | "">("");
  const [page, setPage] = useState(0);
  const limit = 15;
  const query = useQuery({
    queryKey: [
      "claims",
      { search: submittedSearch, workflow, page },
      user?.userId,
    ],
    queryFn: () =>
      api.claims(limit, page * limit, {
        search: submittedSearch || undefined,
        workflow: workflow || undefined,
      }),
  });
  const canCreate =
    navigation.area === "borrower" &&
    user?.memberships.some((m) => m.role === "BORROWER");
  const columns = useMemo<ColumnDef<typeof features, Claim>[]>(
    () => [
      {
        accessorKey: "invoiceNumber",
        header: "Invoice",
        cell: ({ row }) => (
          <Link
            className="group block py-1 font-semibold text-foreground hover:text-primary"
            href={navigation.claimHref(row.original.id)}
          >
            {row.original.invoiceNumber}
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Versi {row.original.version} · {row.original.invoiceNamespace}
            </span>
          </Link>
        ),
      },
      {
        accessorKey: "buyerOrganizationName",
        header: "Buyer",
        cell: ({ row }) => (
          <span className="block max-w-[220px] truncate">
            {row.original.buyerOrganizationName ??
              row.original.buyerOrganizationId}
          </span>
        ),
      },
      {
        id: "outstanding",
        header: "Outstanding invoice",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {money(row.original.terms.acceptedOutstanding)}
          </span>
        ),
      },
      {
        id: "principal",
        header: "Principal",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {money(row.original.terms.principal)}
          </span>
        ),
      },
      ...(navigation.area === "lender"
        ? [
            {
              id: "fee",
              header: "Fee tetap",
              cell: ({ row }: { row: { original: Claim } }) => (
                <span className="tabular-nums">
                  {money(row.original.terms.fee)}
                </span>
              ),
            },
          ]
        : []),
      {
        accessorKey: "workflow",
        header: "Tahap",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge status={row.original.workflow} />
            {(row.original.hasDispute || row.original.fundingHold) && (
              <StatusBadge status="HOLD" />
            )}
          </div>
        ),
      },
      {
        id: "due",
        header: "Jatuh tempo",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {formatDate(row.original.terms.invoiceDueAt)}
          </span>
        ),
      },
      {
        id: "open",
        header: "",
        cell: ({ row }) => (
          <Link
            href={navigation.claimHref(row.original.id)}
            className="inline-flex size-9 items-center justify-center rounded-md hover:bg-secondary"
            aria-label={`Buka invoice ${row.original.invoiceNumber}`}
          >
            <ArrowRight size={17} />
          </Link>
        ),
      },
    ],
    [navigation],
  );
  const table = useTable({
    features,
    data: query.data?.items ?? emptyClaims,
    columns,
  });
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="PEMBIAYAAN PERDAGANGAN"
        title={
          navigation.area === "verifier"
            ? "Antrean pengajuan"
            : navigation.area === "buyer"
              ? "Invoice organisasi Anda"
              : navigation.area === "lender"
                ? "Peluang pendanaan"
                : "Piutang usaha"
        }
        description={
          navigation.area === "verifier"
            ? "Telusuri bukti, ambil keputusan review, dan lanjutkan registrasi ketika semua persetujuan terpenuhi."
            : navigation.area === "buyer"
              ? "Pengakuan dan pembayaran atas invoice yang mencantumkan organisasi Anda sebagai buyer."
              : navigation.area === "lender"
                ? "Tinjau ketentuan dan kesiapan aktual. Muncul di daftar tidak berarti otomatis dapat didanai."
                : "Bukti, persetujuan, dan perkembangan setiap invoice dalam satu tempat."
        }
        actions={
          canCreate ? (
            <Button asChild>
              <Link href={navigation.href("/claims/new")}>
                <Plus size={16} />
                Ajukan piutang
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 sm:px-6">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setPage(0);
              setSubmittedSearch(search.trim());
            }}
            className="relative flex w-full items-center gap-2 sm:max-w-sm"
          >
            <Search
              size={16}
              className="pointer-events-none absolute left-3 text-muted-foreground"
            />
            <Input
              aria-label="Cari nomor invoice"
              placeholder="Cari nomor invoice…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
            <Button type="submit" variant="secondary" size="sm">
              Cari
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Filter tahap piutang"
              value={workflow}
              onChange={(event) => {
                setWorkflow(event.target.value as Workflow | "");
                setPage(0);
              }}
              className="min-w-40"
            >
              <option value="">Semua tahap</option>
              <option value="DRAFT">Draft</option>
              <option value="EXTRACTING">Sedang dianalisis</option>
              <option value="NEEDS_REVIEW">Perlu ditinjau</option>
              <option value="READY_FOR_SIGNATURES">Menunggu persetujuan</option>
              <option value="READY_FOR_REGISTRATION">Siap registrasi</option>
              <option value="REGISTRATION_PENDING">
                Registrasi menunggu konfirmasi
              </option>
              <option value="PROCESSING_FAILED">Pemeriksaan gagal</option>
              <option value="REGISTERED">Terdaftar</option>
              <option value="CANCELLED">Dibatalkan</option>
              <option value="REJECTED">Ditolak</option>
            </Select>
            <RefreshButton
              onClick={() => void query.refetch()}
              busy={query.isFetching}
            />
          </div>
        </div>
        {query.isPending ? (
          <LoadingState />
        ) : query.error ? (
          <div className="p-6">
            <InlineError
              error={query.error}
              onRefresh={() => void query.refetch()}
            />
          </div>
        ) : !query.data?.items.length ? (
          <EmptyState
            icon={FileText}
            title={
              submittedSearch || workflow
                ? "Tidak ada invoice yang cocok"
                : "Mulai dari satu invoice"
            }
            description={
              submittedSearch || workflow
                ? "Coba nomor invoice lain atau tampilkan semua tahap."
                : "Ajukan piutang perdagangan B2B setelah barang diserahkan dan invoice diakui buyer. Dokumen akan melalui analisis dan peninjauan manusia."
            }
            action={
              submittedSearch || workflow ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setSubmittedSearch("");
                    setWorkflow("");
                  }}
                >
                  Hapus filter
                </Button>
              ) : canCreate ? (
                <Button asChild>
                  <Link href={navigation.href("/claims/new")}>
                    Ajukan piutang pertama
                    <ArrowRight size={16} />
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table w-full text-left text-sm">
                <thead>
                  {table.getHeaderGroups().map((group) => (
                    <tr key={group.id}>
                      {group.headers.map((header) => (
                        <th
                          key={header.id}
                          className={`whitespace-nowrap px-5 py-3 text-xs font-medium text-muted-foreground ${["outstanding", "principal"].includes(header.column.id) ? "text-right" : ""}`}
                        >
                          {header.isPlaceholder ? null : (
                            <table.FlexRender header={header} />
                          )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-border transition-colors hover:bg-background/60"
                    >
                      {row.getAllCells().map((cell) => (
                        <td
                          key={cell.id}
                          className={`px-5 py-4 ${["outstanding", "principal"].includes(cell.column.id) ? "text-right" : ""}`}
                        >
                          <table.FlexRender cell={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-border px-6 py-4">
              <p className="text-xs text-muted-foreground">
                {page * limit + 1}–{page * limit + query.data.items.length} dari{" "}
                {query.data.total ?? page * limit + query.data.items.length}{" "}
                piutang
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Halaman sebelumnya"
                  onClick={() => setPage((value) => value - 1)}
                  disabled={!page}
                >
                  <ChevronLeft size={16} />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Halaman berikutnya"
                  onClick={() => setPage((value) => value + 1)}
                  disabled={
                    query.data.items.length < limit ||
                    (query.data.total !== undefined &&
                      (page + 1) * limit >= query.data.total)
                  }
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Hanya piutang yang dapat diakses organisasi Anda. Semua nominal adalah
        IDRT uji.
      </p>
    </div>
  );
}
