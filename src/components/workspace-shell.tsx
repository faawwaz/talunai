"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  ArrowDownUp,
  Building2,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Compass,
  Files,
  LoaderCircle,
  LogOut,
  Menu,
  Network,
  UserRound,
  UsersRound,
  Wallet,
  ShieldCheck,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { useSession } from "@/features/session/provider";
import { TokenIdentity } from "./token-identity";
import { Brand } from "./brand";
import { Button } from "./ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import { Skeleton } from "./ui/skeleton";
import { Select } from "./ui/select";
import { LoadingState } from "./loading-state";
import {
  canEnterWorkspace,
  workspaceAreas,
  workspaceFromPath,
  workspaceLabels,
  workspaceRoles,
  type WorkspaceArea,
} from "@/lib/workspace-paths";

type NavigationItem = { href: string; label: string; icon: LucideIcon };
function navigationFor(area: WorkspaceArea | null, operatorHome: string) {
  const item = (
    suffix: string,
    label: string,
    icon: LucideIcon,
  ): NavigationItem => ({
    href: `/${area}${suffix ? `/${suffix}` : ""}`,
    label,
    icon,
  });
  if (!area)
    return {
      primary: [
        { href: "/app", label: "Tindakan", icon: CheckCheck },
        { href: "/app/explore", label: "Pasar & pool", icon: Compass },
      ],
      management: [
        { href: "/app/settings", label: "Akun & jaringan", icon: Building2 },
      ],
    };
  if (area === "agent")
    return {
      primary: [
        item("", "Operasi agent", Activity),
        item("explore", "Pasar & analitik", Compass),
        item("runs", "Run pemeriksaan", Files),
        item("transactions", "Transaksi & rekonsiliasi", ArrowDownUp),
      ],
      management: [
        { href: operatorHome, label: "Workspace operator", icon: ShieldCheck },
        item("settings", "Jaringan & akun", Network),
      ],
    };
  if (area === "admin")
    return {
      primary: [
        item("", "Tindakan", CheckCheck),
        item("claims", "Deals", Files),
      ],
      management: [
        item("access", "Permohonan akses", UsersRound),
        item("organizations", "Organisasi & peserta", Building2),
        {
          href: "/admin/explore#market-operator",
          label: "Pasar & pool",
          icon: Compass,
        },
        item("tasks", "Antrean tugas", CheckCheck),
        item("payments", "Pembukuan pembayaran", ArrowDownUp),
        item("activity", "Aktivitas pemeriksaan", Activity),
        item("audit", "Audit sistem", ScrollText),
        { href: "/agent", label: "Operasi agent", icon: Activity },
        item("settings", "Jaringan & akun", Network),
      ],
    };
  return {
    primary: [item("", "Tindakan", CheckCheck), item("claims", "Deals", Files)],
    management: [
      item("explore", "Pasar & pool", Compass),
      item("tasks", "Antrean tugas", CheckCheck),
      item(
        "payments",
        area === "lender"
          ? "Alokasi & penarikan"
          : area === "verifier"
            ? "Monitoring pembayaran"
            : "Pembayaran",
        ArrowDownUp,
      ),
      item("activity", "Aktivitas pemeriksaan", Activity),
      ...(area === "verifier"
        ? [{ href: "/agent", label: "Operasi agent", icon: ShieldCheck }]
        : []),
      item("settings", "Organisasi & jaringan", Building2),
    ],
  };
}

const roleLabels: Record<string, string> = {
  BORROWER: "Peminjam",
  BUYER: "Buyer",
  LENDER: "Pemberi dana",
  VERIFIER: "Verifier",
  ADMIN: "Admin",
};

function isActive(pathname: string, href: string) {
  const route = href.split(/[?#]/, 1)[0];
  return route.split("/").filter(Boolean).length === 1
    ? pathname === route
    : pathname === route || pathname.startsWith(`${route}/`);
}

function activeNavigationItem(pathname: string, items: NavigationItem[]) {
  return items
    .filter((item) => isActive(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, status } = useSession();
  const area = workspaceFromPath(pathname);
  const availableAreas = workspaceAreas.filter(
    (item) =>
      item !== "agent" && canEnterWorkspace(item, user?.memberships ?? []),
  );
  const membership = area
    ? user?.memberships.find((item) =>
        workspaceRoles[area].some((role) => role === item.role),
      )
    : availableAreas.length === 1
      ? user?.memberships.find((item) =>
          workspaceRoles[availableAreas[0]].some((role) => role === item.role),
        )
      : undefined;
  const { primary: primaryNavigation, management: managementNavigation } =
    navigationFor(
      area,
      canEnterWorkspace("admin", user?.memberships ?? [])
        ? "/admin"
        : "/verifier",
    );
  const activeHref = activeNavigationItem(pathname, [
    ...primaryNavigation,
    ...managementNavigation,
  ])?.href;
  const workspaceName =
    membership?.organizationName ??
    (availableAreas.length > 1 ? "Ruang kerja Anda" : "Workspace Anda");
  const initials =
    membership?.organizationName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join("")
      .toLocaleUpperCase("id-ID") ?? "TA";

  return (
    <div className="sidebar-inner">
      <Link
        href={area ? `/${area}` : "/app"}
        className="sidebar-brand-link"
        aria-label="TALUNAI — Ringkasan"
        onClick={onNavigate}
      >
        <Brand />
      </Link>
      <div className="sidebar-workspace">
        <span className="workspace-monogram" aria-hidden="true">
          {initials}
        </span>
        <div className="min-w-0">
          {status === "loading" ? (
            <Skeleton className="my-1 h-3 w-28" />
          ) : (
            <p className="sidebar-workspace-name" title={workspaceName}>
              {workspaceName}
            </p>
          )}
          <p className="sidebar-workspace-meta">
            {membership
              ? area
                ? area === "agent"
                  ? (roleLabels[membership.role] ?? membership.role)
                  : workspaceLabels[area]
                : (roleLabels[membership.role] ?? membership.role)
              : user
                ? availableAreas.length > 1
                  ? `${availableAreas.length} peran aktif`
                  : "Siapkan akses organisasi"
                : "Masuk untuk mulai"}
          </p>
        </div>
      </div>

      {availableAreas.length > 1 && area && area !== "agent" && (
        <div className="px-4 pb-4">
          <label
            htmlFor="workspace-area"
            className="mb-2 block text-[11px] font-medium text-muted-foreground"
          >
            Ruang kerja aktif
          </label>
          <Select
            id="workspace-area"
            value={area}
            onChange={(event) => {
              const next = availableAreas.find(
                (item) => item === event.target.value,
              );
              if (next) {
                router.push(`/${next}`);
                onNavigate?.();
              }
            }}
          >
            {availableAreas.map((item) => (
              <option key={item} value={item}>
                {workspaceLabels[item]}
              </option>
            ))}
          </Select>
        </div>
      )}

      <p className="sidebar-section-label">Workspace</p>
      <nav className="sidebar-nav" aria-label="Navigasi utama">
        {primaryNavigation.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="sidebar-nav-link"
            aria-current={activeHref === href ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className="sidebar-nav-separator" />
      <p className="sidebar-section-label">Pengelolaan</p>
      <nav className="sidebar-nav" aria-label="Pengelolaan workspace">
        {managementNavigation.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="sidebar-nav-link"
            aria-current={activeHref === href ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-footer-rule" />
        <TokenIdentity compact />
      </div>
    </div>
  );
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { config, user, status, connect, logout, error, walletStatus } =
    useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const area = workspaceFromPath(pathname);
  const nav = navigationFor(
    area,
    canEnterWorkspace("admin", user?.memberships ?? [])
      ? "/admin"
      : "/verifier",
  );
  const activeItem = activeNavigationItem(pathname, [
    ...nav.primary,
    ...nav.management,
  ]);
  const walletBusy =
    walletStatus === "connecting" ||
    walletStatus === "signing" ||
    walletStatus === "sending";
  const shortWallet = user
    ? `${user.wallet.slice(0, 6)}…${user.wallet.slice(-4)}`
    : "";
  const accessibleAreaCount = workspaceAreas.filter(
    (item) =>
      item !== "agent" && canEnterWorkspace(item, user?.memberships ?? []),
  ).length;
  const operatorMembership = user?.memberships.find(
    (item) => item.role === "ADMIN" || item.role === "VERIFIER",
  );
  const role = area
    ? area === "agent"
      ? operatorMembership
        ? (roleLabels[operatorMembership.role] ?? operatorMembership.role)
        : "Operator"
      : workspaceLabels[area]
    : accessibleAreaCount > 1
      ? "Pilih ruang kerja"
      : user?.memberships[0]
        ? (roleLabels[user.memberships[0].role] ?? user.memberships[0].role)
        : "Belum ada peran";
  const networkName =
    config?.chainId === 97
      ? "BSC Testnet"
      : config?.chainId === 31337
        ? "Anvil lokal"
        : "Jaringan belum tersedia";
  const permitted =
    !area || (!!user && canEnterWorkspace(area, user.memberships));
  useEffect(() => {
    if (!area || status === "loading" || permitted) return;
    if (!user)
      router.replace(
        `/login?workspace=${area}&next=${encodeURIComponent(pathname)}`,
      );
    else {
      const areas = workspaceAreas.filter(
        (item) => item !== "agent" && canEnterWorkspace(item, user.memberships),
      );
      router.replace(areas.length === 1 ? `/${areas[0]}` : "/app");
    }
  }, [area, status, permitted, user, pathname, router]);

  async function handleLogout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
    } catch {
      setLogoutError(
        "Sesi belum dapat dicabut di server. Coba keluar kembali setelah koneksi pulih.",
      );
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="workspace-shell">
      <a href="#workspace-main" className="skip-link">
        Langsung ke konten
      </a>
      <aside className="workspace-sidebar" aria-label="Sidebar workspace">
        <SidebarContent />
      </aside>
      <div className="workspace-frame">
        <header className="workspace-topbar">
          <div className="workspace-breadcrumb">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="workspace-mobile-menu"
                  aria-label="Buka navigasi"
                >
                  <Menu size={19} aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="workspace-mobile-sheet">
                <SheetTitle className="sr-only">Navigasi TALUNAI</SheetTitle>
                <SheetDescription className="sr-only">
                  Halaman workspace, pengajuan, pembayaran, dan pengelolaan.
                </SheetDescription>
                <SidebarContent onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
            <span className="workspace-breadcrumb-parent">
              {area ? workspaceLabels[area] : "Workspace"}
            </span>
            <ChevronRight
              className="workspace-breadcrumb-separator"
              size={12}
              aria-hidden="true"
            />
            <span className="workspace-breadcrumb-current">
              {pathname === "/app" && accessibleAreaCount > 1
                ? "Pilih ruang kerja"
                : (activeItem?.label ?? "Workspace")}
            </span>
          </div>

          <div className="workspace-topbar-right">
            <span
              className="network-label"
              title={
                config
                  ? `Chain ID ${config.chainId} · Token uji tanpa nilai`
                  : "Konfigurasi jaringan belum tersedia"
              }
            >
              <Network aria-hidden="true" />
              {networkName}
            </span>
            {status === "loading" ? (
              <Skeleton className="h-8 w-24" />
            ) : user ? (
              <div className="topbar-account">
                <div className="topbar-account-copy">
                  <p className="topbar-wallet" title={user.wallet}>
                    {shortWallet}
                  </p>
                  <p className="topbar-role">{role}</p>
                </div>
                <Link
                  href={area ? `/${area}/settings` : "/app/settings"}
                  className="topbar-avatar"
                  aria-label={`Pengaturan akun ${shortWallet}, ${role}`}
                  title="Pengaturan akun"
                >
                  <UserRound size={14} aria-hidden="true" />
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="topbar-logout"
                  disabled={loggingOut || walletBusy}
                  onClick={() => void handleLogout()}
                  aria-label="Keluar dari sesi"
                  title="Keluar dari sesi"
                >
                  {loggingOut ? (
                    <LoaderCircle
                      className="loading-spinner"
                      aria-hidden="true"
                    />
                  ) : (
                    <LogOut aria-hidden="true" />
                  )}
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                className="topbar-connect"
                onClick={() => void connect().catch(() => undefined)}
                disabled={walletBusy}
              >
                {walletBusy ? (
                  <LoaderCircle
                    className="loading-spinner"
                    aria-hidden="true"
                  />
                ) : (
                  <Wallet aria-hidden="true" />
                )}
                {walletStatus === "signing"
                  ? "Periksa wallet"
                  : walletStatus === "connecting"
                    ? "Menghubungkan…"
                    : "Masuk dengan wallet"}
              </Button>
            )}
          </div>
        </header>

        <main id="workspace-main" className="workspace-content" tabIndex={-1}>
          {(error || logoutError) && (
            <div className="danger-callout workspace-notice" role="alert">
              <CircleAlert size={17} aria-hidden="true" />
              <p>{logoutError ?? error}</p>
              {logoutError && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loggingOut}
                  onClick={() => void handleLogout()}
                >
                  {loggingOut ? "Mencabut sesi…" : "Coba keluar lagi"}
                </Button>
              )}
            </div>
          )}
          {area && (status === "loading" || !permitted) ? (
            <LoadingState label="Memeriksa kewenangan workspace…" />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
