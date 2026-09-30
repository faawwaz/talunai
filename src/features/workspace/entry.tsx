"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck, Wallet } from "lucide-react";
import { useSession } from "@/features/session/provider";
import { OverviewPage } from "./pages";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/loading-state";
import { PageHeader } from "@/components/page-header";
import {
  canEnterWorkspace,
  defaultWorkspace,
  workspaceAreas,
  workspaceLabels,
  workspaceRoles,
  type WorkspaceArea,
} from "@/lib/workspace-paths";

const workspacePurpose: Record<Exclude<WorkspaceArea, "agent">, string> = {
  borrower: "Ajukan invoice dan pantau pencairan.",
  buyer: "Akui invoice dan bayar tagihan.",
  lender: "Tinjau peluang dan kelola pendanaan.",
  verifier: "Periksa bukti dan putuskan verifikasi.",
  admin: "Kelola akses organisasi dan audit.",
};

export function WorkspaceEntry() {
  const { user, status } = useSession();
  const router = useRouter();
  const areas = workspaceAreas.filter(
    (item) =>
      item !== "agent" && canEnterWorkspace(item, user?.memberships ?? []),
  );
  const area = areas.length === 1 ? areas[0] : null;
  useEffect(() => {
    if (area) router.replace(`/${area}`);
  }, [area, router]);
  if (status === "loading")
    return <LoadingState label="Memeriksa akses Anda…" />;
  if (area) return <LoadingState label="Membuka workspace Anda…" />;
  if (user && areas.length > 1)
    return (
      <div className="page-stack mx-auto max-w-4xl">
        <PageHeader
          eyebrow="AKSES WALLET"
          title="Pilih ruang kerja."
          description="Wallet ini memiliki beberapa peran aktif. Pilih pekerjaan yang ingin Anda lanjutkan."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {areas.map((item) => {
            if (item === "agent") return null;
            const organizations = user.memberships
              .filter(
                (membership) =>
                  (!membership.organizationStatus ||
                    membership.organizationStatus === "APPROVED") &&
                  workspaceRoles[item].some((role) => role === membership.role),
              )
              .map((membership) => membership.organizationName);
            return (
              <Link
                key={item}
                href={`/${item}`}
                className="surface group flex min-w-0 items-start justify-between gap-4 p-5 transition-colors hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:outline-2 focus-visible:outline-primary sm:p-6"
              >
                <div className="min-w-0">
                  <p className="text-kicker mb-2">{workspaceLabels[item]}</p>
                  <h2 className="truncate text-lg font-semibold">
                    {organizations.join(", ")}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {workspacePurpose[item]}
                  </p>
                </div>
                <ArrowRight
                  size={18}
                  className="mt-1 shrink-0 text-primary transition-transform group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </Link>
            );
          })}
        </div>
      </div>
    );
  return <OverviewPage />;
}

export function WorkspaceLogin({
  area,
  destination,
}: {
  area: WorkspaceArea;
  destination: string;
}) {
  const { user, status, connect, logout, walletStatus } = useSession();
  const router = useRouter();
  const allowed = !!user && canEnterWorkspace(area, user.memberships);
  const hasWorkspace = !!user && !!defaultWorkspace(user.memberships);
  const operatorArea =
    area === "admin" || area === "verifier" || area === "agent";
  useEffect(() => {
    if (allowed) {
      router.replace(destination);
      router.refresh();
    }
  }, [allowed, destination, router]);
  const busy = ["connecting", "signing"].includes(walletStatus);
  if (status === "loading" || allowed)
    return <LoadingState label="Memeriksa akses workspace…" />;
  return (
    <div className="page-stack mx-auto max-w-3xl py-6 sm:py-12">
      <PageHeader
        eyebrow={`WORKSPACE ${workspaceLabels[area].toUpperCase()}`}
        title={
          user
            ? hasWorkspace
              ? "Peran ini belum aktif untuk wallet Anda."
              : "Wallet belum memiliki akses organisasi."
            : `Masuk ke workspace ${workspaceLabels[area].toLowerCase()}.`
        }
        description={
          user
            ? hasWorkspace
              ? "Pilih ruang kerja yang tersedia untuk wallet ini, atau masuk dengan wallet lain yang memiliki peran tersebut."
              : operatorArea
                ? "Peran admin dan verifier ditetapkan pengelola. Masuk dengan wallet operator yang sudah diberi akses."
                : "Ajukan peran peserta untuk organisasi Anda. Pengelola akan meninjau permohonan."
            : area === "agent"
              ? "Konsol ini hanya untuk admin atau verifier. Masuk dengan wallet yang memiliki peran tersebut."
              : "Masuk dengan wallet yang terhubung ke organisasi dan peran yang sesuai."
        }
      />
      <section className="surface p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <ShieldCheck className="mt-1 shrink-0 text-primary" size={23} />
          <div>
            <h2 className="text-lg font-semibold">
              Akses mengikuti peran wallet
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {user
                ? hasWorkspace
                  ? "Wallet Anda sudah memiliki ruang kerja lain yang dapat dibuka sekarang."
                  : "Wallet tersambung, tetapi belum ada peran organisasi yang aktif."
                : "Tanda tangan login tidak memindahkan token. Keanggotaan organisasi menentukan akses transaksi."}
            </p>
          </div>
        </div>
        <div className="mt-7 flex flex-wrap gap-3">
          {user ? (
            !hasWorkspace && operatorArea ? (
              <Button onClick={() => void logout().catch(() => undefined)}>
                Ganti ke wallet operator <ArrowRight size={16} />
              </Button>
            ) : (
              <Button asChild>
                <Link href="/app">
                  {hasWorkspace
                    ? "Pilih ruang kerja aktif"
                    : "Lihat akses organisasi"}
                  <ArrowRight size={16} />
                </Link>
              </Button>
            )
          ) : (
            <Button
              disabled={busy}
              onClick={() => void connect().catch(() => undefined)}
            >
              <Wallet size={16} />
              {walletStatus === "signing"
                ? "Konfirmasi pesan di wallet"
                : busy
                  ? "Menghubungkan…"
                  : "Masuk dengan wallet"}
            </Button>
          )}
          {user && (!operatorArea || hasWorkspace) && (
            <Button
              variant="outline"
              onClick={() => void logout().catch(() => undefined)}
            >
              Keluar untuk ganti wallet
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
