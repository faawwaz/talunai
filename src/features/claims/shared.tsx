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
import { NextActionSurface } from "./presentation";

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

export { DetailFacts, SectionTitle } from "./presentation";

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
    <NextActionSurface
      title={state.title}
      description={state.description}
      held={claim.fundingHold || claim.hasDispute}
      action={
        <Button variant="outline" asChild>
          <Link href={navigation.claimHref(claim.id, state.tab)}>
            {state.action}
            <ArrowRight size={15} />
          </Link>
        </Button>
      }
    />
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
