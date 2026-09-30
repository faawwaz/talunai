"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { useSession } from "@/features/session/provider";
import { useWorkspaceNavigation } from "@/features/workspace/navigation";
import { AccessOnboarding } from "@/features/onboarding/access";
import { explainError } from "@/lib/format";
import { defaultWorkspace } from "@/lib/workspace-paths";
import { TalunaiApiError, type Claim } from "../../../packages/client";
import { nextClaimTask } from "./next-task";

export function useRefreshClaim(id: string) {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await Promise.all(
      [
        "claim",
        "evidence",
        "financing",
        "offer",
        "agent-runs",
        "transactions",
        "audit",
      ].map((key) => queryClient.invalidateQueries({ queryKey: [key, id] })),
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["claims"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["review-tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["actions-inbox"] }),
      queryClient.invalidateQueries({ queryKey: ["role-home"] }),
    ]);
  }, [id, queryClient]);
}

export function ClaimSessionGate({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session.status === "loading") return <LoadingState />;
  if (session.status === "anonymous")
    return (
      <EmptyState
        icon={Wallet}
        title="Masuk untuk melihat piutang Anda"
        description="Hubungkan wallet dan tanda tangani pesan login. Akses mengikuti organisasi dan kewenangan yang terdaftar."
        action={
          <Button onClick={() => void session.connect()}>
            Hubungkan wallet <ArrowRight size={16} />
          </Button>
        }
      />
    );
  if (!defaultWorkspace(session.user?.memberships ?? []))
    return <AccessOnboarding />;
  return children;
}

export function InlineError({
  error,
  onRefresh,
}: {
  error: unknown;
  onRefresh?: () => void;
}) {
  if (!error) return null;
  const stale = error instanceof TalunaiApiError && error.status === 409;
  return (
    <ErrorState
      title={stale ? "Periksa versi terbaru" : "Tindakan belum berhasil"}
      message={
        stale
          ? `${explainError(error)} Muat data terbaru dan tinjau kembali sebelum mencoba.`
          : explainError(error)
      }
      onRetry={onRefresh}
    />
  );
}

export function DetailFacts({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="detail-list">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex flex-col gap-1 border-b border-border py-3.5 last:border-b-0 sm:flex-row sm:justify-between sm:gap-6"
        >
          <dt className="text-sm text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words text-sm font-medium sm:max-w-[65%] sm:text-right">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function SyntheticNote() {
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="w-fit cursor-pointer underline decoration-border underline-offset-4">
        Token & biaya jaringan
      </summary>
      <p className="mt-2 max-w-xl leading-relaxed">
        IDRT uji adalah satuan tampilan untuk token MockIDR pada kontrak testnet
        ini. Token tidak bernilai dan tidak dapat ditebus. Satu unit mewakili
        satu Rupiah simulasi; biaya gas dibayar terpisah.
      </p>
    </details>
  );
}

export function useClaimRoles(claim: Claim) {
  const { user } = useSession();
  const { area } = useWorkspaceNavigation();
  const memberships = user?.memberships ?? [];
  const wallet = user?.wallet.toLowerCase();
  return {
    borrower:
      area === "borrower" &&
      memberships.some(
        (m) =>
          m.role === "BORROWER" && m.organizationId === claim.organizationId,
      ) &&
      wallet === claim.terms.borrower.toLowerCase(),
    buyer:
      area === "buyer" &&
      memberships.some(
        (m) =>
          m.role === "BUYER" && m.organizationId === claim.buyerOrganizationId,
      ) &&
      wallet === claim.terms.buyer.toLowerCase(),
    lender: area === "lender" && memberships.some((m) => m.role === "LENDER"),
    verifier:
      area === "verifier" &&
      memberships.some((m) => m.role === "VERIFIER") &&
      !memberships.some(
        (m) =>
          m.organizationId === claim.organizationId ||
          m.organizationId === claim.buyerOrganizationId,
      ),
  };
}

export function NextClaimAction({ claim }: { claim: Claim }) {
  const navigation = useWorkspaceNavigation();
  const { api, user } = useSession();
  const financing = useQuery({
    queryKey: ["financing", claim.id],
    queryFn: () => api.financing(claim.id),
    enabled: claim.workflow === "REGISTERED" && Boolean(user),
    refetchInterval: 15_000,
  });
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const interval = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      30_000,
    );
    return () => window.clearInterval(interval);
  }, []);
  const state = nextClaimTask(
    navigation.area,
    claim,
    now,
    financing.data,
    user?.wallet,
  );
  return (
    <div
      className={`flex flex-col justify-between gap-5 rounded-lg p-5 sm:flex-row sm:items-center ${claim.fundingHold || claim.hasDispute ? "bg-[#FFF3DF]" : "bg-secondary"}`}
    >
      <div className="max-w-2xl">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
          Langkah berikutnya
        </p>
        <h2 className="text-base font-semibold">{state.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {state.description}
        </p>
      </div>
      <Button variant="outline" asChild>
        <Link href={navigation.claimHref(claim.id, state.tab)}>
          {state.action}
          <ArrowRight size={15} />
        </Link>
      </Button>
    </div>
  );
}

export function RefreshButton({
  onClick,
  busy,
}: {
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={busy}>
      <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
      Muat ulang
    </Button>
  );
}
