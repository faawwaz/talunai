"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, FileCheck2, Plus, Trash2 } from "lucide-react";
import { useSession } from "@/features/session/provider";
import { useWorkspaceNavigation } from "@/features/workspace/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { TokenIdentity } from "@/components/token-identity";
import { LoadingState } from "@/components/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatDate, money } from "@/lib/format";
import type {
  Claim,
  GoodsCategory,
  GoodsMetadata,
} from "../../../packages/client";
import { GoodsSchema } from "../../../packages/domain/goods";
import { quote } from "../../../packages/domain/finance";
import {
  ClaimSessionGate,
  DetailFacts,
  InlineError,
  NextClaimAction,
  RefreshButton,
  SectionTitle,
  SyntheticNote,
  useClaimRoles,
  useRefreshClaim,
} from "./shared";
import { ClaimEvidence } from "./evidence";
import { ClaimTerms } from "./terms";
import { ClaimPayments } from "./payments";
import { ClaimActivity } from "./activity";
import { WorkflowTrail } from "./workflow-trail";

export type ClaimTab =
  "summary" | "evidence" | "terms" | "payments" | "activity";
const tabs: { key: ClaimTab; label: string; path: string }[] = [
  { key: "summary", label: "Ringkasan", path: "" },
  { key: "evidence", label: "Bukti", path: "/evidence" },
  { key: "terms", label: "Ketentuan", path: "/terms" },
  { key: "payments", label: "Pembayaran", path: "/payments" },
  { key: "activity", label: "Aktivitas", path: "/activity" },
];

export function ClaimDetail({
  id,
  tab = "summary",
}: {
  id: string;
  tab?: ClaimTab;
}) {
  return (
    <ClaimSessionGate>
      <ClaimWorkspace key={id} id={id} tab={tab} />
    </ClaimSessionGate>
  );
}
function ClaimWorkspace({ id, tab }: { id: string; tab: ClaimTab }) {
  const navigation = useWorkspaceNavigation();
  const { api, user } = useSession();
  const query = useQuery({
    queryKey: ["claim", id],
    queryFn: () => api.claim(id),
    refetchInterval: (query) =>
      ["EXTRACTING", "REGISTRATION_PENDING"].includes(
        query.state.data?.workflow ?? "",
      ) && query.state.dataUpdateCount < 60
        ? 3000
        : false,
  });
  const refresh = useRefreshClaim(id);
  if (query.isPending) return <LoadingState />;
  if (query.error || !query.data)
    return (
      <InlineError error={query.error} onRefresh={() => void query.refetch()} />
    );
  const claim = query.data;
  return (
    <div className="page-stack">
      <Link
        href={navigation.href("/claims")}
        className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft size={15} />
        Semua piutang
      </Link>
      <PageHeader
        eyebrow="PIUTANG PERDAGANGAN B2B"
        title={claim.invoiceNumber}
        description={
          <span>
            {claim.organizationName ?? claim.organizationId}
            <span aria-hidden="true" className="mx-2 text-muted-foreground/50">
              →
            </span>
            <span className="sr-only"> kepada </span>
            {claim.buyerOrganizationName ?? claim.buyerOrganizationId}
          </span>
        }
        actions={
          <div className="flex items-center gap-3">
            <StatusBadge status={claim.workflow} />
            <RefreshButton
              onClick={() => void refresh()}
              busy={query.isFetching}
            />
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span>Versi {claim.version}</span>
        <span>Invoice {claim.invoiceNamespace}</span>
        <TokenIdentity compact />
        {user?.memberships.some(
          (membership) => membership.role === "ADMIN",
        ) && (
          <Link
            href={`/admin/explore?claimKey=${claim.claimKey}#market-operator`}
            className="font-semibold text-primary hover:underline"
          >
            Periksa pendanaan pool
          </Link>
        )}
        {claim.createdAt && <span>Dibuat {formatDate(claim.createdAt)}</span>}
      </div>
      <WorkflowTrail claim={claim} />
      <nav
        aria-label="Bagian piutang"
        className="-mt-2 flex gap-6 overflow-x-auto border-b border-border"
      >
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={navigation.claimHref(
              id,
              item.key === "summary" ? undefined : item.key,
            )}
            aria-current={tab === item.key ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-0.5 py-4 text-sm font-medium transition-colors ${tab === item.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {tab === "summary" && <ClaimSummary claim={claim} />}
      {tab === "evidence" && <ClaimEvidence claim={claim} />}
      {tab === "terms" && <ClaimTerms claim={claim} />}
      {tab === "payments" && <ClaimPayments claim={claim} />}
      {tab === "activity" && <ClaimActivity claim={claim} />}
    </div>
  );
}

function ClaimSummary({ claim }: { claim: Claim }) {
  const navigation = useWorkspaceNavigation();
  const { api } = useSession();
  const roles = useClaimRoles(claim);
  const refresh = useRefreshClaim(claim.id);
  const financing = useQuery({
    queryKey: ["financing", claim.id],
    queryFn: () => api.financing(claim.id),
  });
  const canInviteLender =
    roles.borrower &&
    !claim.lenderOrganizationId &&
    [
      "DRAFT",
      "EXTRACTING",
      "NEEDS_REVIEW",
      "READY_FOR_SIGNATURES",
      "PROCESSING_FAILED",
    ].includes(claim.workflow);
  const lenderOrganizations = useQuery({
    queryKey: ["organizations", claim.organizationId, "lenders"],
    queryFn: () =>
      api.organizations({
        issuerOrganizationId: claim.organizationId,
        role: "LENDER",
        limit: 100,
      }),
    enabled: canInviteLender,
  });
  const [selectedLender, setSelectedLender] = useState("");
  const inviteLender = useMutation({
    mutationFn: () =>
      api.inviteLender(claim.id, selectedLender, crypto.randomUUID()),
    onSuccess: async () => {
      setSelectedLender("");
      await refresh();
    },
  });
  const [principal, setPrincipal] = useState(claim.terms.principal);
  const [outstanding, setOutstanding] = useState(
    claim.terms.acceptedOutstanding,
  );
  const [edited, setEdited] = useState(false);
  const dateForInput = (seconds: number) =>
    new Date((seconds + 7 * 3600) * 1000).toISOString().slice(0, 10);
  const [editVersion, setEditVersion] = useState(claim.version);
  const [originalDueDate, setOriginalDueDate] = useState(
    dateForInput(claim.terms.invoiceDueAt),
  );
  const [dueDate, setDueDate] = useState(originalDueDate);
  const [category, setCategory] = useState<GoodsCategory | "">(
    claim.goods?.category ?? "",
  );
  const [goodsDescription, setGoodsDescription] = useState(
    claim.goods?.description ?? "",
  );
  const [lineItems, setLineItems] = useState<GoodsMetadata["lineItems"]>(
    () =>
      claim.goods?.lineItems.map((item) => ({ ...item })) ?? [
        { description: "", quantity: "", unit: "" },
      ],
  );
  const [editErrors, setEditErrors] = useState<string[]>([]);
  const resetDraft = (fresh: Claim) => {
    setEditVersion(fresh.version);
    setPrincipal(fresh.terms.principal);
    setOutstanding(fresh.terms.acceptedOutstanding);
    const date = dateForInput(fresh.terms.invoiceDueAt);
    setOriginalDueDate(date);
    setDueDate(date);
    setCategory(fresh.goods?.category ?? "");
    setGoodsDescription(fresh.goods?.description ?? "");
    setLineItems(
      fresh.goods?.lineItems.map((item) => ({ ...item })) ?? [
        { description: "", quantity: "", unit: "" },
      ],
    );
    setEditErrors([]);
  };
  const reloadDraft = useMutation({
    mutationFn: () => api.claim(claim.id),
    onSuccess: (fresh) => {
      resetDraft(fresh);
      setEdited(false);
      void refresh();
    },
  });
  const validateDraft = () => {
    const errors: string[] = [];
    if (
      !/^[1-9]\d{0,77}$/.test(principal) ||
      !/^[1-9]\d{0,77}$/.test(outstanding)
    )
      errors.push(
        "Outstanding dan principal harus bilangan bulat positif tanpa pemisah ribuan.",
      );
    else {
      try {
        const offer = quote(outstanding, principal);
        if (
          BigInt(principal) > BigInt(offer.advanceCap) ||
          BigInt(principal) > 100000000n
        )
          errors.push(
            `Principal maksimal ${money(offer.advanceCap)} dan tidak lebih dari 100.000.000 IDRT uji.`,
          );
      } catch {
        errors.push("Nominal melebihi rentang bilangan yang didukung.");
      }
    }
    const proposedDue = Math.floor(
      new Date(`${dueDate}T23:59:00+07:00`).getTime() / 1000,
    );
    if (
      !dueDate ||
      !Number.isFinite(proposedDue) ||
      (dueDate !== originalDueDate &&
        proposedDue <= claim.terms.fundingDeadline)
    )
      errors.push("Jatuh tempo invoice harus setelah batas pendanaan.");
    const parsed = GoodsSchema.safeParse({
      category,
      description: goodsDescription,
      lineItems,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "category")
          errors.push("Pilih kategori barang yang diserahkan.");
        else if (issue.path[0] === "description")
          errors.push("Isi deskripsi barang, maksimal 500 karakter.");
        else if (issue.path[2] === "quantity")
          errors.push(
            `Periksa jumlah rincian ${Number(issue.path[1]) + 1}: positif, desimal dengan titik, maksimal 6 angka desimal.`,
          );
        else if (issue.path[2] === "unit")
          errors.push(
            `Isi satuan rincian ${Number(issue.path[1]) + 1}, maksimal 32 karakter.`,
          );
        else
          errors.push(
            "Lengkapi nama setiap rincian barang, maksimal 500 karakter dan 30 rincian.",
          );
      }
    }
    setEditErrors([...new Set(errors)]);
    return errors.length === 0;
  };
  const edit = useMutation({
    mutationFn: () =>
      api.patchClaim(
        claim.id,
        {
          expectedVersion: editVersion,
          requestedPrincipal: principal,
          acceptedOutstanding: outstanding,
          goods: GoodsSchema.parse({
            category,
            description: goodsDescription,
            lineItems,
          }),
          ...(dueDate !== originalDueDate
            ? {
                invoiceDueAt: Math.floor(
                  new Date(`${dueDate}T23:59:00+07:00`).getTime() / 1000,
                ),
              }
            : {}),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async (fresh) => {
      resetDraft(fresh);
      setEdited(true);
      await refresh();
    },
  });
  const canEdit =
    roles.borrower &&
    [
      "DRAFT",
      "NEEDS_REVIEW",
      "READY_FOR_SIGNATURES",
      "READY_FOR_REGISTRATION",
      "PROCESSING_FAILED",
      "REJECTED",
    ].includes(claim.workflow);
  return (
    <div className="space-y-7">
      <NextClaimAction claim={claim} />
      {canInviteLender && (
        <section className="surface p-6" aria-label="Undang pendana">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold">Pilih pendana Deal ini</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Satu organisasi pendana mendapat akses ke detail dan dapat
              mempertimbangkan pendanaan. Undangan tidak memindahkan dana.
            </p>
          </div>
          {lenderOrganizations.isPending ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Memuat organisasi pendana…
            </p>
          ) : lenderOrganizations.error ? (
            <div className="mt-4">
              <InlineError
                error={lenderOrganizations.error}
                onRefresh={() => void lenderOrganizations.refetch()}
              />
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="field-group min-w-0 flex-1">
                  <Label htmlFor="deal-lender-org">Organisasi pendana</Label>
                  <Select
                    id="deal-lender-org"
                    value={selectedLender}
                    onChange={(event) => setSelectedLender(event.target.value)}
                  >
                    <option value="">Pilih organisasi</option>
                    {lenderOrganizations.data?.items
                      .filter((item) => item.kind === "LENDER")
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </Select>
                </div>
                <Button
                  disabled={!selectedLender || inviteLender.isPending}
                  onClick={() => inviteLender.mutate()}
                >
                  {inviteLender.isPending ? "Mengundang…" : "Berikan akses"}
                </Button>
              </div>
              {!lenderOrganizations.data?.items.some(
                (item) => item.kind === "LENDER",
              ) && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Belum ada organisasi pendana aktif. Minta admin meninjau
                  aksesnya.
                </p>
              )}
            </>
          )}
          <div className="mt-3">
            <InlineError
              error={inviteLender.error}
              onRefresh={() => void refresh()}
            />
          </div>
        </section>
      )}
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_350px]">
        <section className="surface p-6 sm:p-7">
          <SectionTitle
            title="Detail invoice"
            action={
              <Button asChild variant="ghost" size="sm">
                <Link href={navigation.claimHref(claim.id, "terms")}>
                  Lihat ketentuan
                  <ArrowRight size={14} />
                </Link>
              </Button>
            }
          />
          <DetailFacts
            items={[
              {
                label: "Penerbit",
                value: claim.organizationName ?? claim.organizationId,
              },
              {
                label: "Buyer",
                value: claim.buyerOrganizationName ?? claim.buyerOrganizationId,
              },
              {
                label: "Outstanding invoice",
                value: money(claim.terms.acceptedOutstanding),
              },
              {
                label: "Principal diajukan",
                value: money(claim.terms.principal),
              },
              { label: "Fee flat", value: money(claim.terms.fee) },
              {
                label: "Jatuh tempo invoice",
                value: formatDate(claim.terms.invoiceDueAt),
              },
              {
                label: "Jendela pendanaan berakhir",
                value: formatDate(claim.terms.fundingDeadline, true),
              },
            ]}
          />
          <div className="mt-5">
            <SyntheticNote />
          </div>
        </section>
        <aside className="space-y-6">
          <section className="surface p-6">
            <SectionTitle
              title="Posisi finansial"
              description="Berdasarkan event chain yang terkonfirmasi."
            />
            {financing.isPending ? (
              <LoadingState />
            ) : financing.error ? (
              <InlineError
                error={financing.error}
                onRefresh={() => void financing.refetch()}
              />
            ) : (
              financing.data && (
                <div className="space-y-5">
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      Pembiayaan
                    </p>
                    <StatusBadge status={financing.data.financingStatus} />
                  </div>
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      Collection invoice
                    </p>
                    <StatusBadge status={financing.data.collectionStatus} />
                  </div>
                  <div className="border-t border-border pt-4">
                    <p className="text-xs text-muted-foreground">
                      Collection diterima
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">
                      {money(financing.data.totalCollected)}
                    </p>
                  </div>
                  {financing.data.stateConfidence !==
                    "CONFIRMED_PROJECTION" && (
                    <p className="text-xs text-muted-foreground">
                      {financing.data.stateConfidence ===
                      "NO_CONFIRMED_PROJECTION"
                        ? "Belum ada proyeksi terkonfirmasi."
                        : "Menampilkan pembukuan terakhir; sinkronisasi perlu diperiksa."}
                    </p>
                  )}
                </div>
              )
            )}
          </section>
          <div className="flex items-start gap-3 px-1 text-xs leading-relaxed text-muted-foreground">
            <FileCheck2 size={19} className="mt-0.5 shrink-0 text-primary" />
            <p>
              Registrasi membuat bukti dan persetujuan dapat diaudit. Registrasi
              ini tidak menerbitkan kepemilikan barang atau jaminan legal.
            </p>
          </div>
        </aside>
      </div>
      {claim.goods && (
        <section className="surface p-6 sm:p-7">
          <SectionTitle
            title="Barang dalam transaksi"
            description="Deskripsi barang merupakan metadata pendukung piutang; nilai pembiayaan mengikuti outstanding invoice yang diakui."
          />
          <DetailFacts
            items={[
              {
                label: "Kategori",
                value:
                  claim.goods.category === "COCOA"
                    ? "Kakao"
                    : claim.goods.category === "PACKAGING"
                      ? "Kemasan"
                      : "Barang lainnya · perlu review",
              },
              { label: "Deskripsi", value: claim.goods.description },
            ]}
          />
          {claim.goods.lineItems.length > 0 && (
            <div className="table-scroll mt-5">
              <table className="data-table w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="py-3 text-xs font-medium text-muted-foreground">
                      Barang
                    </th>
                    <th className="py-3 text-xs font-medium text-muted-foreground">
                      Kuantitas
                    </th>
                    <th className="py-3 text-xs font-medium text-muted-foreground">
                      Satuan
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {claim.goods.lineItems.map((item, index) => (
                    <tr key={index} className="border-t border-border">
                      <td className="py-3">{item.description}</td>
                      <td className="py-3 tabular-nums">{item.quantity}</td>
                      <td className="py-3">{item.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {canEdit && (
        <details className="surface p-6">
          <summary className="cursor-pointer text-sm font-semibold">
            Revisi detail pengajuan
          </summary>
          <p className="mt-3 text-sm text-muted-foreground">
            Revisi membuat versi baru dan membatalkan review serta tanda tangan
            lama. Dokumen harus mendukung nominal, kategori, jumlah barang, dan
            tanggal yang direvisi.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setEdited(false);
              if (validateDraft()) edit.mutate();
            }}
            className="mt-5 grid gap-4 sm:grid-cols-2"
          >
            <div className="field-group">
              <Label htmlFor="edit-outstanding">Outstanding invoice</Label>
              <Input
                id="edit-outstanding"
                inputMode="numeric"
                value={outstanding}
                onChange={(event) => setOutstanding(event.target.value)}
              />
            </div>
            <div className="field-group">
              <Label htmlFor="edit-principal">Principal</Label>
              <Input
                id="edit-principal"
                inputMode="numeric"
                value={principal}
                onChange={(event) => setPrincipal(event.target.value)}
              />
            </div>
            <div className="field-group">
              <Label htmlFor="edit-due-date">Jatuh tempo invoice</Label>
              <Input
                id="edit-due-date"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
              <p className="field-hint">
                Tanggal baru disimpan pukul 23.59 WIB. Batas pendanaan tetap{" "}
                {formatDate(claim.terms.fundingDeadline, true)} WIB.
              </p>
            </div>
            <div className="field-group">
              <Label htmlFor="edit-goods-category">Kategori barang</Label>
              <Select
                id="edit-goods-category"
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as GoodsCategory | "")
                }
              >
                <option value="">Pilih kategori</option>
                <option value="COCOA">Kakao</option>
                <option value="PACKAGING">Kemasan</option>
                <option value="OTHER">Barang lainnya</option>
              </Select>
              {category === "OTHER" && (
                <p className="field-hint">
                  Kategori lainnya memerlukan peninjauan manual.
                </p>
              )}
            </div>
            <div className="field-group sm:col-span-2">
              <Label htmlFor="edit-goods-description">Deskripsi barang</Label>
              <Textarea
                id="edit-goods-description"
                value={goodsDescription}
                onChange={(event) => setGoodsDescription(event.target.value)}
                maxLength={500}
              />
            </div>
            <div className="space-y-4 sm:col-span-2">
              {lineItems.map((item, index) => (
                <fieldset
                  key={index}
                  className="rounded-md border border-border p-4"
                >
                  <legend className="px-1 text-xs font-semibold">
                    Rincian {index + 1}
                  </legend>
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    {(["description", "quantity", "unit"] as const).map(
                      (key) => (
                        <div key={key} className="field-group">
                          <Label htmlFor={`edit-line-${index}-${key}`}>
                            {key === "description"
                              ? "Item"
                              : key === "quantity"
                                ? "Jumlah"
                                : "Satuan"}{" "}
                            {index + 1}
                          </Label>
                          <Input
                            id={`edit-line-${index}-${key}`}
                            value={item[key]}
                            onChange={(event) =>
                              setLineItems((current) =>
                                current.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? { ...row, [key]: event.target.value }
                                    : row,
                                ),
                              )
                            }
                            inputMode={
                              key === "quantity" ? "decimal" : undefined
                            }
                            maxLength={
                              key === "description"
                                ? 500
                                : key === "unit"
                                  ? 32
                                  : 37
                            }
                          />
                        </div>
                      ),
                    )}
                  </div>
                  {lineItems.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-3"
                      onClick={() =>
                        setLineItems((current) =>
                          current.filter((_, rowIndex) => rowIndex !== index),
                        )
                      }
                    >
                      <Trash2 size={14} />
                      Hapus rincian {index + 1}
                    </Button>
                  )}
                </fieldset>
              ))}
              <p className="field-hint">
                Jumlah positif menggunakan titik untuk desimal. Satuan harus
                sama dengan invoice.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={lineItems.length >= 30}
                onClick={() =>
                  setLineItems((current) => [
                    ...current,
                    { description: "", quantity: "", unit: "" },
                  ])
                }
              >
                <Plus size={14} />
                Tambah rincian
              </Button>
            </div>
            {editErrors.length > 0 && (
              <ul
                role="alert"
                className="space-y-1 text-sm text-red-700 sm:col-span-2"
              >
                {editErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}
            {claim.version !== editVersion && (
              <p className="info-callout text-sm sm:col-span-2">
                Data server sudah berubah ke versi {claim.version}. Draft isian
                Anda masih berdasarkan versi {editVersion}. Muat nilai server
                terbaru, tinjau perubahan, lalu isi ulang revisi yang
                diperlukan.
              </p>
            )}
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              <Button
                variant="outline"
                disabled={
                  edit.isPending ||
                  reloadDraft.isPending ||
                  claim.version !== editVersion
                }
                type="submit"
              >
                {edit.isPending ? "Menyimpan revisi…" : "Simpan versi baru"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={edit.isPending || reloadDraft.isPending}
                onClick={() => reloadDraft.mutate()}
              >
                {reloadDraft.isPending
                  ? "Memuat…"
                  : "Muat nilai server terbaru"}
              </Button>
            </div>
            <p className="field-hint sm:col-span-2">
              Memuat nilai server akan mengganti isian yang belum disimpan.
              Pengiriman yang gagal tetap mempertahankan isian Anda.
            </p>
          </form>
          {edited && (
            <p role="status" className="mt-3 text-sm text-primary">
              Versi baru tersimpan. Jalankan ulang pemeriksaan bukti.
            </p>
          )}
          <div className="mt-4">
            <InlineError
              error={edit.error || reloadDraft.error}
              onRefresh={() => void refresh()}
            />
          </div>
        </details>
      )}
    </div>
  );
}
