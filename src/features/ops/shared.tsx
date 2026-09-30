"use client";

import type { ReactNode } from "react";
import { RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { useSession } from "@/features/session/provider";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { explainError } from "@/lib/format";
import type { CurrentUser, OpsHealthStatus } from "../../../packages/client";

export function OperatorGate({
  children,
  adminOnly = false,
}: {
  children: ReactNode;
  adminOnly?: boolean;
}) {
  const { user, status, connect, walletStatus, error } = useSession();
  if (status === "loading")
    return <LoadingState label="Memeriksa akses operator…" />;
  if (!user)
    return (
      <section className="surface">
        <EmptyState
          icon={Wallet}
          title="Masuk ke konsol operasional"
          description="Gunakan wallet dengan akses pengelola yang telah ditetapkan."
          action={
            <Button
              onClick={() => void connect()}
              disabled={
                walletStatus === "connecting" || walletStatus === "signing"
              }
            >
              Hubungkan wallet
            </Button>
          }
        />
        {error && (
          <div className="px-6 pb-6">
            <OpsFailure error={error} />
          </div>
        )}
      </section>
    );
  const allowed = user.memberships.some(
    (m) =>
      m.organizationStatus === "APPROVED" &&
      (m.role === "ADMIN" || (!adminOnly && m.role === "VERIFIER")),
  );
  if (!allowed)
    return (
      <section className="surface">
        <EmptyState
          icon={ShieldCheck}
          title="Akses operator diperlukan"
          description={
            adminOnly
              ? "Halaman ini tersedia untuk admin yang berwenang mengelola organisasi dan audit."
              : "Konsol ini tersedia untuk verifier dan admin. Wallet worker tidak memberikan akses pengelola."
          }
        />
      </section>
    );
  return children;
}

export function operatorClaimHref(
  user: CurrentUser | null,
  id: string,
  tab?: string,
) {
  const area = user?.memberships.some(
    (m) => m.role === "ADMIN" && m.organizationStatus === "APPROVED",
  )
    ? "admin"
    : "verifier";
  return `/${area}/claims/${encodeURIComponent(id)}${tab ? `/${tab}` : ""}`;
}

export function OpsFailure({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="danger-callout text-sm" role="alert">
      <div>
        <p>{typeof error === "string" ? error : explainError(error)}</p>
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

export function OpsReload({
  busy,
  onClick,
}: {
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" onClick={onClick} disabled={busy}>
      <RefreshCw size={15} className={busy ? "loading-spinner" : undefined} />
      Perbarui
    </Button>
  );
}

export function OpsPagination({
  offset,
  length,
  total,
  onChange,
}: {
  offset: number;
  length: number;
  total?: number;
  onChange: (offset: number) => void;
}) {
  return (
    <div className="surface-footer flex flex-wrap items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">
        {length ? `${offset + 1}–${offset + length}` : "0"}
        {total !== undefined ? ` dari ${total}` : ""} hasil
      </span>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={!offset}
          onClick={() => onChange(Math.max(0, offset - 20))}
        >
          Sebelumnya
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={
            total !== undefined ? offset + length >= total : length < 20
          }
          onClick={() => onChange(offset + 20)}
        >
          Berikutnya
        </Button>
      </div>
    </div>
  );
}

const healthLabels: Record<OpsHealthStatus, string> = {
  READY: "Aktif",
  DEGRADED: "Perlu perhatian",
  STALE: "Heartbeat terlambat",
  UNAVAILABLE: "Belum terpantau",
};
export function HealthBadge({ status }: { status: OpsHealthStatus }) {
  return (
    <Badge
      variant={
        status === "READY"
          ? "success"
          : status === "UNAVAILABLE"
            ? "outline"
            : "warning"
      }
    >
      {healthLabels[status]}
    </Badge>
  );
}

export function OpsMetadata({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 break-words text-sm font-medium [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}
