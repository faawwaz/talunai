"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  LoaderCircle,
  Network,
  RefreshCw,
} from "lucide-react";
import { useSession } from "@/features/session/provider";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LoadingState } from "@/components/loading-state";
import { explainError, explorerUrl, formatDate } from "@/lib/format";
import {
  TalunaiApiError,
  type AccessRequest,
  type RequestAccessInput,
} from "../../../packages/client";

const roles = {
  BORROWER: "Pemohon pembiayaan",
  BUYER: "Pembeli barang",
  LENDER: "Pendana",
};
const rolePurpose = {
  BORROWER: "Ajukan invoice dan pantau pencairan.",
  BUYER: "Akui invoice dan bayar tagihan.",
  LENDER: "Tinjau peluang dan kelola pendanaan.",
};

function accessError(error: unknown) {
  if (error instanceof TalunaiApiError) {
    if (error.code === "ACCESS_REQUEST_PENDING")
      return "Permohonan Anda sudah tersimpan. Perbarui status untuk melihatnya.";
    if (error.code === "ACCESS_ALREADY_GRANTED")
      return "Akses sudah ditetapkan. Perbarui status untuk masuk ke workspace.";
    if (error.code === "PARTICIPANT_WALLET_REQUIRED")
      return "Alamat ini digunakan untuk pengelolaan sistem. Gunakan wallet peserta yang terpisah.";
  }
  return explainError(error);
}

function AccessForm({
  previous,
  onSaved,
}: {
  previous: AccessRequest | null;
  onSaved: () => Promise<void>;
}) {
  const { api } = useSession();
  const [organizationName, setOrganizationName] = useState(
    previous?.organizationName ?? "",
  );
  const [requestedRole, setRequestedRole] = useState<
    RequestAccessInput["requestedRole"]
  >(previous?.requestedRole ?? "BORROWER");
  const [note, setNote] = useState(previous?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const input = {
      organizationName: organizationName.trim(),
      requestedRole,
      note: note.trim(),
    };
    if (input.organizationName.length < 3) {
      setError("Nama organisasi perlu berisi setidaknya 3 karakter.");
      return;
    }
    const body = JSON.stringify(input);
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.requestAccess(input, attempt.current.key);
      await onSaved();
    } catch (err) {
      setError(accessError(err));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="access-organization">
          Organisasi yang akan diwakili
        </Label>
        <Input
          id="access-organization"
          value={organizationName}
          onChange={(event) => setOrganizationName(event.target.value)}
          required
          minLength={3}
          maxLength={160}
          placeholder="Nama organisasi uji"
          aria-describedby="organization-hint"
        />
        <p
          id="organization-hint"
          className="text-xs leading-relaxed text-muted-foreground"
        >
          Nama ini membantu pengelola mencocokkan organisasi testnet yang sudah
          disetujui. Jangan kirim data perusahaan nyata.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="access-role">
          Anda ingin menggunakan TALUNAI sebagai
        </Label>
        <Select
          id="access-role"
          value={requestedRole}
          onChange={(event) =>
            setRequestedRole(
              event.target.value as RequestAccessInput["requestedRole"],
            )
          }
        >
          {Object.entries(roles).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {rolePurpose[requestedRole]} Peran aktif setelah pengelola menyetujui
          wallet dan organisasi ini.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="access-note">
          Catatan untuk pengelola{" "}
          <span className="font-normal text-muted-foreground">(opsional)</span>
        </Label>
        <Textarea
          id="access-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Konteks singkat untuk peninjau"
        />
      </div>
      {error && (
        <p role="alert" className="danger-callout text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle size={16} className="loading-spinner" />
          ) : (
            <ArrowRight size={16} />
          )}
          {busy ? "Menyimpan permohonan…" : "Ajukan akses"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Permohonan ini tidak mengirim transaksi.
        </span>
      </div>
    </form>
  );
}

export function AccessOnboarding() {
  const { api, user, logout, config } = useSession();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["access-request", user?.userId],
    queryFn: () => api.accessRequest(),
    enabled: !!user,
    retry: 1,
    refetchInterval: (state) =>
      state.state.data?.request?.status === "PENDING" &&
      state.state.dataUpdateCount < 12
        ? 15_000
        : false,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const request = query.data?.request;
  const restricted = query.data?.restrictedWallet;

  useEffect(() => {
    if (request?.status === "APPROVED")
      void queryClient.invalidateQueries({ queryKey: ["session"] });
  }, [request?.status, request?.id, queryClient]);

  async function refresh() {
    setRefreshing(true);
    setActionError(null);
    try {
      await query.refetch({ throwOnError: true });
      await queryClient.invalidateQueries(
        { queryKey: ["session"] },
        { throwOnError: true },
      );
    } catch (error) {
      setActionError(accessError(error));
    } finally {
      setRefreshing(false);
    }
  }

  async function switchAccount() {
    setLeaving(true);
    setActionError(null);
    try {
      await logout();
    } catch (error) {
      setActionError(explainError(error));
    } finally {
      setLeaving(false);
    }
  }

  async function copyAddress() {
    if (!user) return;
    try {
      await navigator.clipboard.writeText(user.wallet);
      setCopied(true);
    } catch {
      setActionError(
        "Alamat belum berhasil disalin. Anda dapat memilih dan menyalin teks alamat di bawah.",
      );
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="MULAI DI TALUNAI"
        title={
          restricted
            ? "Gunakan wallet peserta."
            : request?.status === "PENDING"
              ? "Menunggu persetujuan akses."
              : request?.status === "REJECTED"
                ? "Perbaiki permohonan akses."
                : request?.status === "APPROVED"
                  ? "Persetujuan tercatat."
                  : "Ajukan akses organisasi."
        }
        description="Satu permohonan menghubungkan wallet, organisasi, dan peran. Pengelola mengaktifkan akses setelah meninjau."
      />
      <div className="max-w-3xl">
        <section
          className="surface min-w-0 p-5 sm:p-8"
          aria-label="Akses organisasi"
        >
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Check size={17} /> Login wallet terverifikasi
            </div>
            {config && (
              <span
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium tabular-nums text-muted-foreground"
                title={`Chain ID ${config.chainId}`}
              >
                <Network size={12} aria-hidden="true" />
                {config.chainId === 97 ? "BSC Testnet · 97" : "Anvil · 31337"}
              </span>
            )}
          </div>
          <div className="mb-7 flex flex-wrap items-center gap-3 rounded-lg bg-secondary/50 px-4 py-3">
            <p className="min-w-0 flex-1 break-all text-xs leading-relaxed tabular-nums">
              {user?.wallet}
            </p>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Salin alamat wallet"
              onClick={() => void copyAddress()}
            >
              <Copy size={14} /> {copied ? "Tersalin" : "Salin"}
            </Button>
            {user && config?.chainId === 97 && (
              <a
                className="rounded p-1.5 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                href={explorerUrl(config.chainId, "address", user.wallet)}
                target="_blank"
                rel="noreferrer"
                aria-label="Lihat wallet di BscScan testnet (tab baru)"
              >
                <ExternalLink size={15} />
              </a>
            )}
          </div>
          {query.isPending ? (
            <LoadingState />
          ) : query.error ? (
            <div role="alert" className="space-y-3">
              <p>{accessError(query.error)}</p>
              <Button variant="outline" onClick={() => void refresh()}>
                Coba lagi
              </Button>
            </div>
          ) : restricted ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">
                Wallet ini dipakai untuk pengelolaan sistem
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Wallet agent, admin, atau verifier tidak dapat didaftarkan
                sebagai pemohon, pembeli, atau pendana lewat halaman ini.
                Gunakan akun wallet uji terpisah agar kewenangan tetap terpisah.
              </p>
              <Button onClick={() => void switchAccount()} disabled={leaving}>
                Keluar untuk ganti akun <ArrowRight size={15} />
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Sesudah keluar, pilih akun peserta di ekstensi wallet lalu masuk
                kembali untuk mengajukan akses dengan identitas yang tepat.
              </p>
            </div>
          ) : request?.status === "PENDING" ? (
            <div className="space-y-5" role="status">
              <div>
                <p className="text-kicker mb-2">MENUNGGU TINJAUAN PENGELOLA</p>
                <h2 className="text-xl font-semibold">
                  {request.organizationName}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {roles[request.requestedRole]} · Diajukan{" "}
                  {formatDate(request.createdAt, true)}
                </p>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Pengelola memeriksa organisasi dan peran wallet ini. Setelah
                disetujui, ruang kerja akan terbuka otomatis.
              </p>
              <Button
                variant="outline"
                onClick={() => void refresh()}
                disabled={refreshing}
              >
                <RefreshCw
                  size={15}
                  className={refreshing ? "loading-spinner" : ""}
                />{" "}
                Periksa status akses
              </Button>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Detail permohonan</summary>
                <p className="mt-2 break-all">ID: {request.id}</p>
                <p className="mt-1">
                  Halaman ini boleh ditutup; status tetap tersimpan.
                </p>
              </details>
            </div>
          ) : request?.status === "APPROVED" ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">
                Persetujuan tercatat, akses belum aktif
              </h2>
              <p className="text-sm text-muted-foreground">
                Periksa ulang keanggotaan. Jika ruang kerja tetap tertutup,
                minta pengelola memeriksa status organisasi dan wallet ini.
              </p>
              <Button onClick={() => void refresh()} disabled={refreshing}>
                Periksa akses lagi <RefreshCw size={15} />
              </Button>
            </div>
          ) : (
            <>
              {request?.status === "REJECTED" && (
                <div className="mb-6 space-y-2 rounded-lg bg-secondary p-4">
                  <h2 className="font-semibold">Permohonan perlu diperbaiki</h2>
                  <p className="text-sm leading-relaxed">
                    {request.reviewReason ??
                      "Pengelola belum mencantumkan alasan. Hubungi pengelola sebelum mengajukan kembali."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Perbaiki detail di bawah untuk mengirim permohonan baru.
                  </p>
                </div>
              )}
              <AccessForm
                key={request?.id ?? "new"}
                previous={request ?? null}
                onSaved={async () => {
                  await query.refetch({ throwOnError: true });
                }}
              />
            </>
          )}
          {actionError && (
            <p className="mt-4 text-sm" role="alert">
              {actionError}
            </p>
          )}
          {!restricted && (
            <div className="mt-7 border-t border-border pt-5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void switchAccount()}
                disabled={leaving}
              >
                Bukan akun yang dimaksud? Keluar untuk ganti akun
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
