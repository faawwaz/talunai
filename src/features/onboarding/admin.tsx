"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronRight,
  Inbox,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useSession } from "@/features/session/provider";
import { WorkspaceGate } from "@/features/workspace/pages";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { explainError, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  TalunaiApiError,
  type AdminAccessRequest,
  type AccessOrganization,
  type CreateAccessOrganizationInput,
  type ReviewAccessInput,
  type ReviewAccessResult,
} from "../../../packages/client";

const roleLabels = {
  BORROWER: "Pemohon pembiayaan",
  BUYER: "Pembeli barang",
  LENDER: "Pendana",
};
const statusLabels = {
  PENDING: "Menunggu tinjauan",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
};

function reviewError(error: unknown) {
  if (error instanceof TalunaiApiError) {
    const messages: Record<string, string> = {
      ACCESS_REQUEST_STALE:
        "Permohonan ini sudah berubah atau ditinjau pengelola lain. Perbarui daftar sebelum melanjutkan.",
      ORGANIZATION_AUTHORITY_ALREADY_ASSIGNED:
        "Organisasi ini sudah memiliki wallet peserta. Pilih organisasi yang sesuai dan belum terhubung; jangan membuat identitas baru untuk organisasi yang sama.",
      APPROVED_SYNTHETIC_ORGANIZATION_REQUIRED:
        "Pilih organisasi simulasi yang telah disetujui dan memiliki peran yang sesuai.",
      CANONICAL_ORGANIZATION_REQUIRED:
        "Pilih organisasi kanonik untuk peserta ini sebelum menyetujui akses.",
      PARTICIPANT_WALLET_REQUIRED:
        "Wallet pengelola sistem tidak dapat diberi akses peserta. Minta pemohon menggunakan wallet peserta terpisah.",
      WALLET_AUTHORITY_REVIEW_REQUIRED:
        "Hubungan wallet dengan akun perlu diperiksa lebih lanjut. Akses belum diberikan.",
      ACCESS_ALREADY_GRANTED:
        "Akun ini sudah memiliki akses organisasi. Perbarui daftar untuk melihat status terbaru.",
      ORGANIZATION_IDENTITY_EXISTS:
        "ID organisasi ini sudah terdaftar. Gunakan organisasi yang telah ada, jangan mengganti ID untuk melewati pemeriksaan duplikat.",
      ORGANIZATION_NAME_EXISTS:
        "Nama organisasi ini sudah terdaftar. Periksa organisasi yang telah ada sebelum melanjutkan.",
    };
    if (messages[error.code]) return messages[error.code];
  }
  return explainError(error);
}

function InlineError({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="danger-callout text-sm" role="alert">
      <div>
        <p>{typeof error === "string" ? error : reviewError(error)}</p>
        {retry && (
          <Button className="mt-2" variant="ghost" size="sm" onClick={retry}>
            <RefreshCw size={14} />
            Perbarui data
          </Button>
        )}
      </div>
    </div>
  );
}

export function AccessAdminPage() {
  return (
    <WorkspaceGate>
      <AdminGate />
    </WorkspaceGate>
  );
}

function AdminGate() {
  const { user } = useSession();
  if (
    !user?.memberships.some(
      (m) => m.role === "ADMIN" && m.organizationStatus === "APPROVED",
    )
  ) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Akses organisasi" title="Halaman pengelola" />
        <section className="surface">
          <EmptyState
            icon={ShieldCheck}
            title="Tinjauan akses tersedia untuk admin"
            description="Pengelola yang berwenang meninjau permohonan dan menghubungkan wallet dengan organisasi yang sesuai."
            action={
              <Button asChild variant="outline">
                <Link href="/app">
                  <ArrowLeft size={16} />
                  Kembali ke workspace
                </Link>
              </Button>
            }
          />
        </section>
      </div>
    );
  }
  return <AdminContent />;
}

function AdminContent() {
  const { api, user } = useSession();
  const cache = useQueryClient();
  const [status, setStatus] = useState<AdminAccessRequest["status"]>("PENDING");
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewAccessResult | null>(null);
  const requests = useQuery({
    queryKey: ["access-requests", user?.userId, status, offset],
    queryFn: () => api.accessRequests({ status, limit: 20, offset }),
  });
  const items = requests.data?.items ?? [];
  const selected = items.find((item) => item.id === selectedId);

  async function reviewed(next: ReviewAccessResult) {
    setResult(next);
    setSelectedId(null);
    await cache.invalidateQueries({ queryKey: ["access-requests"] });
    await cache.invalidateQueries({ queryKey: ["access-organizations"] });
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Pengelolaan workspace"
        title="Akses organisasi"
        description="Tinjau permohonan, periksa wallet, lalu hubungkan peserta ke organisasi yang tepat."
        actions={
          <Button
            variant="outline"
            onClick={() => void requests.refetch()}
            disabled={requests.isFetching}
          >
            <RefreshCw
              size={15}
              className={requests.isFetching ? "loading-spinner" : undefined}
            />
            Perbarui
          </Button>
        }
      />
      {result && (
        <section role="status" className="context-band flex items-start gap-3">
          <Check size={19} className="mt-0.5 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold">
              {result.request.status === "APPROVED"
                ? "Akses organisasi disetujui"
                : "Keputusan penolakan tersimpan"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.request.organizationName}.{" "}
              {result.request.status === "APPROVED"
                ? "Peserta dapat memperbarui status untuk masuk ke workspace."
                : "Alasan tinjauan dapat dibaca oleh pemohon."}
            </p>
            {result.remainingGate && (
              <p className="mt-2 text-sm">
                Pendana masih perlu masuk allowlist kontrak sebelum dapat
                melakukan funding. Persetujuan ini tidak mengirim transaksi
                onchain.
              </p>
            )}
          </div>
        </section>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Label htmlFor="access-status" className="whitespace-nowrap">
            Status
          </Label>
          <Select
            id="access-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as AdminAccessRequest["status"]);
              setOffset(0);
              setSelectedId(null);
            }}
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          Identitas sintetis · Persetujuan tercatat di audit
        </p>
      </div>
      {requests.error ? (
        <InlineError
          error={requests.error}
          retry={() => void requests.refetch()}
        />
      ) : requests.isPending ? (
        <section className="surface">
          <LoadingState label="Memuat permohonan akses…" />
        </section>
      ) : !items.length ? (
        <section className="surface">
          <EmptyState
            icon={Inbox}
            title={
              status === "PENDING"
                ? "Tidak ada permohonan menunggu"
                : "Belum ada permohonan pada status ini"
            }
            description={
              status === "PENDING"
                ? "Permohonan baru dari peserta akan muncul di sini. Identitas dan kewenangan tetap ditinjau sebelum akses diberikan."
                : "Pilih status lain untuk meninjau permohonan akses organisasi."
            }
          />
        </section>
      ) : (
        <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.4fr)]">
          <section
            className="surface min-w-0"
            aria-label="Daftar permohonan akses"
          >
            <div className="surface-header">
              <h2 className="text-sm font-semibold">{statusLabels[status]}</h2>
              <span className="text-xs text-muted-foreground">
                {requests.data?.total ?? items.length} permohonan
              </span>
            </div>
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={selectedId === item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      "flex w-full min-w-0 items-start gap-4 px-5 py-5 text-left transition-colors hover:bg-secondary/50 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-primary",
                      selectedId === item.id && "bg-secondary",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold">
                        {item.organizationName}
                      </p>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {roleLabels[item.requestedRole]}
                      </p>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Diajukan {formatDate(item.createdAt)}
                      </p>
                    </div>
                    <ChevronRight
                      size={16}
                      className="mt-0.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
            <div className="surface-footer flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {offset + 1}–{offset + items.length}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => {
                    setOffset(Math.max(0, offset - 20));
                    setSelectedId(null);
                  }}
                >
                  Sebelumnya
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={
                    requests.data?.total !== undefined
                      ? offset + items.length >= requests.data.total
                      : items.length < 20
                  }
                  onClick={() => {
                    setOffset(offset + 20);
                    setSelectedId(null);
                  }}
                >
                  Berikutnya
                </Button>
              </div>
            </div>
          </section>
          {selected ? (
            <RequestDetail
              key={`${selected.id}:${selected.version}`}
              request={selected}
              onReviewed={reviewed}
              refresh={() => void requests.refetch()}
            />
          ) : (
            <section className="surface">
              <EmptyState
                icon={ShieldCheck}
                title="Pilih permohonan untuk ditinjau"
                description="Periksa nama organisasi, peran, dan alamat wallet peserta sebelum mengambil keputusan."
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function RequestDetail({
  request,
  onReviewed,
  refresh,
}: {
  request: AdminAccessRequest;
  onReviewed: (result: ReviewAccessResult) => Promise<void>;
  refresh: () => void;
}) {
  const { api, user } = useSession();
  const [organizationId, setOrganizationId] = useState("");
  const [reason, setReason] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<ReviewAccessInput["decision"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const [orgOffset, setOrgOffset] = useState(0);
  const [createdOrganization, setCreatedOrganization] =
    useState<AccessOrganization | null>(null);
  const organizations = useQuery({
    queryKey: [
      "access-organizations",
      user?.userId,
      request.requestedRole,
      orgOffset,
    ],
    queryFn: () =>
      api.accessOrganizations({
        role: request.requestedRole,
        limit: 100,
        offset: orgOffset,
      }),
    enabled: request.status === "PENDING",
  });
  const organizationItems = [
    ...(createdOrganization ? [createdOrganization] : []),
    ...(organizations.data?.items ?? []).filter(
      (org) => org.id !== createdOrganization?.id,
    ),
  ];

  async function decide(decision: ReviewAccessInput["decision"]) {
    if (sending.current) return;
    if (reason.trim().length < 10) {
      setError(
        "Tuliskan alasan tinjauan minimal 10 karakter agar keputusan dapat dipahami peserta.",
      );
      return;
    }
    if (
      decision === "APPROVE" &&
      !organizationItems.some(
        (org) => org.id === organizationId && !org.occupied,
      )
    ) {
      setError(
        "Pilih organisasi yang sesuai dan belum memiliki wallet peserta.",
      );
      return;
    }
    const input: ReviewAccessInput = {
      expectedVersion: request.version,
      decision,
      reason: reason.trim(),
      ...(decision === "APPROVE" ? { organizationId } : {}),
    };
    const body = JSON.stringify(input);
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    sending.current = true;
    setBusy(decision);
    setError(null);
    try {
      await onReviewed(
        await api.reviewAccess(request.id, input, attempt.current.key),
      );
    } catch (err) {
      setError(reviewError(err));
    } finally {
      sending.current = false;
      setBusy(null);
    }
  }

  return (
    <section className="surface min-w-0" aria-label="Detail permohonan akses">
      <div className="surface-header">
        <div>
          <p className="text-kicker">
            Tinjauan akses · Versi {request.version}
          </p>
          <h2 className="mt-2 break-words text-xl font-semibold tracking-tight">
            {request.organizationName}
          </h2>
        </div>
      </div>
      <div className="space-y-6 p-5 sm:p-7">
        <dl className="space-y-4 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">Peran yang diminta</dt>
            <dd className="font-medium">{roleLabels[request.requestedRole]}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Wallet peserta</dt>
            <dd
              className="mt-2 break-all rounded-md bg-background px-3 py-3 font-medium tabular-nums"
              data-testid="access-review-wallet"
            >
              {request.wallet}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">Tanggal pengajuan</dt>
            <dd>{formatDate(request.createdAt)}</dd>
          </div>
        </dl>
        {request.note && (
          <div>
            <h3 className="text-sm font-medium">Catatan pemohon</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
              {request.note}
            </p>
          </div>
        )}
        {request.status !== "PENDING" ? (
          <div className="border-t border-border pt-5">
            <h3 className="text-sm font-semibold">
              {statusLabels[request.status]}
            </h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {request.reviewReason}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Ditinjau {formatDate(request.reviewedAt)}
            </p>
            {request.organizationId && (
              <p className="mt-2 break-all text-xs text-muted-foreground">
                ID organisasi: {request.organizationId}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="border-t border-border pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Label htmlFor="review-organization">
                  Hubungkan ke organisasi
                </Label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowCreate(!showCreate)}
                  disabled={busy !== null}
                  aria-expanded={showCreate}
                  aria-controls="create-access-organization"
                >
                  <Plus size={14} />
                  {showCreate ? "Tutup form baru" : "Organisasi baru"}
                </Button>
              </div>
              <p className="mb-3 mt-2 text-xs leading-relaxed text-muted-foreground">
                Gunakan identitas organisasi yang telah diperiksa. Organisasi
                dengan wallet aktif tidak dapat dialihkan ke pemohon ini.
              </p>
              {organizations.isPending ? (
                <LoadingState compact label="Memuat organisasi…" />
              ) : organizations.error ? (
                <InlineError
                  error={organizations.error}
                  retry={() => void organizations.refetch()}
                />
              ) : (
                <>
                  <Select
                    id="review-organization"
                    value={organizationId}
                    disabled={busy !== null}
                    onChange={(event) => setOrganizationId(event.target.value)}
                  >
                    <option value="">
                      Pilih organisasi{" "}
                      {roleLabels[request.requestedRole].toLowerCase()}
                    </option>
                    {organizationItems.map((org) => (
                      <option
                        key={org.id}
                        value={org.id}
                        disabled={org.occupied}
                      >
                        {org.name}
                        {org.occupied ? " — wallet sudah terhubung" : ""}
                      </option>
                    ))}
                  </Select>
                  {!organizationItems.some((org) => !org.occupied) && (
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      Belum ada organisasi tersedia di halaman ini. Periksa
                      identitas pemohon sebelum membuat organisasi sintetis
                      baru.
                    </p>
                  )}
                  {(orgOffset > 0 ||
                    (organizations.data?.total ?? 0) > 100) && (
                    <div className="mt-2 flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!orgOffset}
                        onClick={() => {
                          setOrgOffset(Math.max(0, orgOffset - 100));
                          setOrganizationId("");
                        }}
                      >
                        Organisasi sebelumnya
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={
                          orgOffset + 100 >= (organizations.data?.total ?? 0)
                        }
                        onClick={() => {
                          setOrgOffset(orgOffset + 100);
                          setOrganizationId("");
                        }}
                      >
                        Organisasi berikutnya
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
            {showCreate && (
              <CreateOrganization
                request={request}
                onCreated={async (organization) => {
                  setCreatedOrganization(organization);
                  setOrganizationId(organization.id);
                  setShowCreate(false);
                  await organizations.refetch();
                }}
              />
            )}
            {request.requestedRole === "LENDER" && (
              <p className="context-band text-sm leading-relaxed">
                Akses workspace dan izin funding berbeda. Wallet pendana tetap
                memerlukan allowlist kontrak yang ditetapkan admin onchain.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="access-review-reason">Alasan keputusan</Label>
              <Textarea
                id="access-review-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                minLength={10}
                maxLength={1000}
                disabled={busy !== null}
                placeholder="Catat hasil pemeriksaan identitas organisasi dan kewenangan wallet."
                aria-describedby="review-reason-hint"
              />
              <p
                id="review-reason-hint"
                className="text-xs text-muted-foreground"
              >
                Wajib diisi. Pemohon dapat membaca alasan ini.
              </p>
            </div>
            {error && <InlineError error={error} retry={refresh} />}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => void decide("APPROVE")}
                disabled={
                  busy !== null ||
                  organizations.isPending ||
                  !!organizations.error
                }
              >
                {busy === "APPROVE" ? (
                  <LoaderCircle className="loading-spinner" size={16} />
                ) : (
                  <Check size={16} />
                )}
                {busy === "APPROVE"
                  ? "Menyimpan persetujuan…"
                  : "Setujui akses"}
              </Button>
              <Button
                variant="outline"
                onClick={() => void decide("REJECT")}
                disabled={busy !== null}
              >
                {busy === "REJECT" && (
                  <LoaderCircle className="loading-spinner" size={16} />
                )}
                {busy === "REJECT"
                  ? "Menyimpan keputusan…"
                  : "Tolak permohonan"}
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Keputusan mengatur akses workspace untuk data simulasi. Tidak
              memberi status KYB dan tidak mengirim transaksi finansial.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function CreateOrganization({
  request,
  onCreated,
}: {
  request: AdminAccessRequest;
  onCreated: (organization: AccessOrganization) => Promise<void>;
}) {
  const { api } = useSession();
  const [name, setName] = useState(request.organizationName);
  const [identityKey, setIdentityKey] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const input: CreateAccessOrganizationInput = {
      name: name.trim(),
      kind: request.requestedRole,
      identityKey: identityKey.trim(),
      reason: reason.trim(),
    };
    if (
      input.name.length < 3 ||
      input.reason.length < 10 ||
      !/^[a-z0-9._-]{3,100}$/.test(input.identityKey)
    ) {
      setError(
        "Lengkapi nama, ID organisasi dengan huruf kecil/angka, dan alasan pemeriksaan minimal 10 karakter.",
      );
      return;
    }
    const body = JSON.stringify(input);
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.createAccessOrganization(
        input,
        attempt.current.key,
      );
      await onCreated({ ...result.organization, occupied: false });
    } catch (err) {
      setError(reviewError(err));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      id="create-access-organization"
      onSubmit={(event) => void submit(event)}
      className="space-y-4 rounded-lg border border-border bg-background p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <Building2 size={18} className="mt-0.5 shrink-0 text-primary" />
        <div>
          <h3 className="text-sm font-semibold">Organisasi sintetis baru</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Buat hanya setelah memastikan organisasi ini belum ada. Pergantian
            wallet tidak boleh membuat identitas organisasi baru.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="access-org-name">Nama organisasi</Label>
        <Input
          id="access-org-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          minLength={3}
          maxLength={160}
          required
          disabled={busy}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="access-org-identity">ID identitas organisasi</Label>
        <Input
          id="access-org-identity"
          value={identityKey}
          onChange={(event) => setIdentityKey(event.target.value)}
          minLength={3}
          maxLength={100}
          pattern="[a-z0-9._\-]{3,100}"
          required
          disabled={busy}
          placeholder="contoh: kemasan-nusantara-2026"
          aria-describedby="org-identity-hint"
        />
        <p
          id="org-identity-hint"
          className="text-xs leading-relaxed text-muted-foreground"
        >
          ID tetap dari catatan pengelola, bukan alamat wallet. Gunakan huruf
          kecil, angka, titik, garis bawah, atau tanda hubung.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="access-org-reason">Dasar pembuatan organisasi</Label>
        <Textarea
          id="access-org-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={10}
          maxLength={1000}
          rows={2}
          required
          disabled={busy}
          placeholder="Catat pemeriksaan identitas dan duplikat organisasi."
        />
      </div>
      {error && <InlineError error={error} />}
      <Button variant="secondary" type="submit" disabled={busy}>
        {busy ? (
          <LoaderCircle className="loading-spinner" size={15} />
        ) : (
          <ArrowRight size={15} />
        )}
        {busy ? "Menyimpan organisasi…" : "Buat organisasi sintetis"}
      </Button>
    </form>
  );
}
