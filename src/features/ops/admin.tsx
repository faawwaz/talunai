"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  Copy,
  History,
  Search,
} from "lucide-react";
import { useSession } from "@/features/session/provider";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { explorerUrl, formatDate, labelForStatus } from "@/lib/format";
import type { OpsOrganizationStatus } from "../../../packages/client";
import {
  OperatorGate,
  OpsFailure,
  OpsPagination,
  OpsReload,
  OpsMetadata,
} from "./shared";

const organizationStatuses: Record<OpsOrganizationStatus, string> = {
  APPROVED: "Disetujui",
  PENDING: "Menunggu tinjauan",
  REJECTED: "Ditolak",
  REVOKED: "Dicabut",
};
const roleLabels: Record<string, string> = {
  BORROWER: "Pemohon",
  BUYER: "Pembeli",
  LENDER: "Pendana",
  VERIFIER: "Verifier",
  ADMIN: "Admin",
  AGENT: "Worker",
};

function AuthorityWallet({ address }: { address: string }) {
  const { config } = useSession();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const explorer = explorerUrl(config?.chainId, "address", address);
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setFailed(false);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  }
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-all text-xs font-medium tabular-nums">
          {address}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void copy()}
          aria-label={
            copied ? "Alamat wallet tersalin" : `Salin alamat wallet ${address}`
          }
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? "Tersalin" : "Salin"}</span>
        </Button>
        {explorer && (
          <a
            className="inline-flex items-center gap-1.5 text-xs text-primary"
            href={explorer}
            target="_blank"
            rel="noreferrer"
          >
            Explorer
            <ArrowUpRight size={13} aria-hidden="true" />
            <span className="sr-only">, tab baru</span>
          </a>
        )}
      </div>
      {failed && (
        <p className="mt-1 text-xs text-destructive" role="status">
          Clipboard tidak tersedia. Pilih alamat di atas untuk menyalinnya.
        </p>
      )}
    </div>
  );
}

export function AdminOrganizationsPage() {
  return (
    <OperatorGate adminOnly>
      <OrganizationsContent />
    </OperatorGate>
  );
}

function OrganizationsContent() {
  const { api, user } = useSession();
  const [status, setStatus] = useState<OpsOrganizationStatus | "">("");
  const [offset, setOffset] = useState(0);
  const organizations = useQuery({
    queryKey: ["ops-organizations", user?.userId, status, offset],
    queryFn: () =>
      api.opsOrganizations({ status: status || undefined, limit: 20, offset }),
  });
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Administrasi"
        title="Organisasi & kewenangan"
        description="Identitas kanonik dan hubungan wallet yang digunakan untuk membatasi akses pengajuan."
        actions={
          <div className="flex flex-wrap gap-2">
            <OpsReload
              busy={organizations.isFetching}
              onClick={() => void organizations.refetch()}
            />
            <Button asChild variant="outline">
              <Link href="/admin/access">
                Tinjau akses
                <ArrowRight size={15} />
              </Link>
            </Button>
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="ops-org-status">Status organisasi</Label>
        <Select
          id="ops-org-status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as OpsOrganizationStatus | "");
            setOffset(0);
          }}
        >
          <option value="">Semua status</option>
          {Object.entries(organizationStatuses).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <p className="context-band text-sm leading-relaxed">
        Status disetujui menunjukkan izin pada workspace ini. Pemeriksaan KYB
        eksternal belum terintegrasi. Penggantian wallet tetap menggunakan
        identitas organisasi yang sama.
      </p>
      <section className="surface">
        {organizations.isPending ? (
          <LoadingState label="Memuat organisasi dan kewenangan…" />
        ) : organizations.error ? (
          <div className="p-6">
            <OpsFailure
              error={organizations.error}
              retry={() => void organizations.refetch()}
            />
          </div>
        ) : !organizations.data?.items.length ? (
          <EmptyState
            icon={Building2}
            title="Tidak ada organisasi pada tampilan ini"
            description="Organisasi yang dibuat dan ditinjau melalui alur akses akan tampil di sini. Coba status lain atau buka tinjauan akses."
            action={
              <Button asChild variant="outline">
                <Link href="/admin/access">Tinjau akses</Link>
              </Button>
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {organizations.data.items.map((org) => (
                <li key={org.id} className="min-w-0 p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="break-words text-base font-semibold">
                        {org.name}
                      </h2>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {roleLabels[org.kind] ?? labelForStatus(org.kind)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge status={org.status} />
                      {org.isSynthetic && (
                        <Badge variant="outline">Sintetis</Badge>
                      )}
                    </div>
                  </div>
                  <p className="mt-3 break-all text-xs text-muted-foreground">
                    ID kanonik: {org.id}
                  </p>
                  {org.memberships.length ? (
                    <div className="mt-5 space-y-4 border-t border-border pt-5">
                      {org.memberships.map((member) => (
                        <div className="min-w-0" key={member.id}>
                          <div className="mb-2 flex flex-wrap items-center gap-3">
                            <h3 className="text-sm font-medium">
                              {roleLabels[member.role] ??
                                labelForStatus(member.role)}
                            </h3>
                            <Badge
                              variant={member.approved ? "success" : "outline"}
                            >
                              {member.approved
                                ? "Akses aktif"
                                : "Akses belum disetujui"}
                            </Badge>
                          </div>
                          {member.wallets.length ? (
                            <div className="space-y-1">
                              {member.wallets.map((wallet) => (
                                <AuthorityWallet
                                  key={wallet}
                                  address={wallet}
                                />
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Belum ada wallet yang terhubung ke akun ini.
                            </p>
                          )}
                          <details className="mt-3 text-xs text-muted-foreground">
                            <summary className="w-fit cursor-pointer py-1 focus-visible:outline-2 focus-visible:outline-primary">
                              Identitas audit akun
                            </summary>
                            <p className="mt-2 break-all">
                              User: {member.userId}
                            </p>
                            <p className="mt-1 break-all">
                              Membership: {member.id}
                            </p>
                          </details>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
                      Belum ada kewenangan peserta yang ditetapkan untuk
                      organisasi ini.
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <OpsPagination
              offset={offset}
              length={organizations.data.items.length}
              total={organizations.data.total}
              onChange={setOffset}
            />
          </>
        )}
      </section>
    </div>
  );
}

export function AdminAuditPage() {
  return (
    <OperatorGate adminOnly>
      <AuditContent />
    </OperatorGate>
  );
}

function AuditContent() {
  const { api, user } = useSession();
  const [input, setInput] = useState("");
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const audit = useQuery({
    queryKey: ["ops-audit", user?.userId, action, offset],
    queryFn: () =>
      api.opsAudit({ action: action || undefined, limit: 20, offset }),
  });
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAction(input.trim().toUpperCase());
    setOffset(0);
  }
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Administrasi"
        title="Jejak audit"
        description="Tindakan yang tersimpan, pelakunya, dan commitment perubahan. Riwayat ini berasal dari sistem, bukan aktivitas ilustratif."
        actions={
          <OpsReload
            busy={audit.isFetching}
            onClick={() => void audit.refetch()}
          />
        }
      />
      <form className="flex flex-wrap items-end gap-3" onSubmit={filter}>
        <div className="min-w-0 flex-1 space-y-2 sm:max-w-md">
          <Label htmlFor="ops-audit-action">Kode tindakan</Label>
          <Input
            id="ops-audit-action"
            value={input}
            onChange={(event) => setInput(event.target.value.toUpperCase())}
            pattern="[A-Z0-9_]*"
            maxLength={80}
            placeholder="Contoh: ACCESS_REQUEST_APPROVED"
            aria-describedby="ops-audit-filter-hint"
          />
        </div>
        <Button type="submit" variant="outline">
          <Search size={15} />
          Terapkan
        </Button>
        {action && (
          <Button
            variant="ghost"
            onClick={() => {
              setInput("");
              setAction("");
              setOffset(0);
            }}
          >
            Hapus filter
          </Button>
        )}
      </form>
      <p id="ops-audit-filter-hint" className="text-xs text-muted-foreground">
        Filter menggunakan kode tindakan yang tepat. Kosongkan untuk melihat
        seluruh riwayat yang diotorisasi.
      </p>
      <section className="surface">
        {audit.isPending ? (
          <LoadingState label="Memuat jejak audit…" />
        ) : audit.error ? (
          <div className="p-6">
            <OpsFailure
              error={audit.error}
              retry={() => void audit.refetch()}
            />
          </div>
        ) : !audit.data?.items.length ? (
          <EmptyState
            icon={History}
            title="Tidak ada catatan pada tampilan ini"
            description="Tindakan baru yang tercatat akan muncul di sini. Periksa kode tindakan atau hapus filter untuk melihat riwayat lain."
          />
        ) : (
          <>
            <ol className="divide-y divide-border">
              {audit.data.items.map((event) => (
                <li key={event.id} className="min-w-0 p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="break-words text-sm font-semibold">
                        {labelForStatus(event.action)}
                      </h2>
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        {event.action}
                      </p>
                    </div>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={event.createdAt}
                    >
                      {formatDate(event.createdAt, true)}
                    </time>
                  </div>
                  <dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
                    <OpsMetadata label="Pelaku">{event.actorId}</OpsMetadata>
                    <OpsMetadata label="Target tindakan">
                      {event.target}
                    </OpsMetadata>
                  </dl>
                  <details className="mt-4 border-t border-border pt-3">
                    <summary className="w-fit cursor-pointer py-1 text-xs font-medium text-primary focus-visible:outline-2 focus-visible:outline-primary">
                      Lihat identitas & commitment audit
                    </summary>
                    <dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
                      <OpsMetadata label="ID audit">{event.id}</OpsMetadata>
                      <OpsMetadata label="Correlation ID">
                        {event.correlationId}
                      </OpsMetadata>
                      <OpsMetadata label="Organisasi pelaku">
                        {event.organizationId ?? "Tidak terkait organisasi"}
                      </OpsMetadata>
                      <OpsMetadata label="Commitment sebelum">
                        {event.beforeHash ?? "Tidak dicatat untuk tindakan ini"}
                      </OpsMetadata>
                      <OpsMetadata label="Commitment sesudah">
                        {event.afterHash ?? "Tidak dicatat untuk tindakan ini"}
                      </OpsMetadata>
                    </dl>
                  </details>
                </li>
              ))}
            </ol>
            <OpsPagination
              offset={offset}
              length={audit.data.items.length}
              total={audit.data.total}
              onChange={setOffset}
            />
          </>
        )}
      </section>
      {audit.data && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Audit ditambahkan melalui aplikasi. Commitment membantu penelusuran
          perubahan; admin database masih memiliki kemampuan menulis ulang
          riwayat.{" "}
        </p>
      )}
    </div>
  );
}
