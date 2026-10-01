"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { bscTestnet } from "viem/chains";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Compass,
  ExternalLink,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { TokenIdentity } from "@/components/token-identity";
import { useSession } from "@/features/session/provider";
import { formatDate, money, shortAddress } from "@/lib/format";
import manifest from "../../../../deployments/pool-a-bsc-testnet.json";

type PoolEvent = {
  event: string;
  txHash: string;
  blockNumber: string;
  investor: string | null;
  claimKey: string | null;
  amount: string;
};
type PoolEvents = {
  events: PoolEvent[];
  eventWindowFromBlock: string;
  eventHistoryComplete: boolean;
  genesisPinned: boolean;
  blockNumber: string;
};
type Explore = {
  chainId: number;
  blockNumber: string;
  blockTime: string;
  pool: string;
  token: string;
  synthetic: boolean;
  legacyPositionOnly?: boolean;
  stats: {
    idle: string;
    outstandingPrincipal: string;
    claimableFromVault: string;
    realizedFee: string;
    bookAssets: string;
    shares: string;
    activeDeals: string;
    totalDeals: string;
    utilizationBps: number;
  };
  economics: {
    feeBps: number;
    currentEarningApy: number | null;
    realizedNetApy: number | null;
    apyReason: string;
    feeDistribution: string;
  };
  controls: {
    depositsPaused: boolean;
    allocationsPaused: boolean;
    maxDealExposureBps: number;
    maxUtilizationBps: number;
    capitalLocked: boolean;
    riskDisclosure: string;
    riskHash: string;
  };
  deals: {
    claimKey: string;
    principal: string;
    outstandingPrincipal: string;
    feeAllocated: string;
    lenderClaimable: string;
    remainingLenderEntitlement: string;
    dueAt: string;
    status: "ACTIVE" | "PARTIALLY_RECOVERED" | "REPAID" | "OVERDUE";
  }[];
  position: {
    wallet: string;
    shares: string;
    bookPositionValue: string;
    tokenBalance: string;
    allowance: string;
    investorAllowed: boolean;
    adminAllowed: boolean;
    allocatorAllowed: boolean;
  } | null;
};
type Candidate = {
  claimKey: string;
  blockNumber: string;
  blockTime: string;
  eligible: boolean;
  fundedByPool: boolean;
  principal: string;
  fee: string;
  dueAt: string;
  dealLimit: string;
  portfolioRoom: string;
  idle: string;
  canAllocate: boolean;
  reasons: string[];
  indicativeGrossApyBps: number | null;
  apyBasis: string;
};
type MarketView = "market" | "invest" | "activity" | "operator";
type PendingPoolTx = { hash: Hex; label: string; wallet: Address };
const dealStatusLabel: Record<Explore["deals"][number]["status"], string> = {
  ACTIVE: "Menunggu pembayaran",
  PARTIALLY_RECOVERED: "Terbayar sebagian",
  REPAID: "Hak pool terpenuhi",
  OVERDUE: "Lewat jatuh tempo",
};
const poolAbi = parseAbi([
  "function deposit(uint256,bytes32) returns (uint256)",
  "function redeem(uint256) returns (uint256)",
  "function fundClaim(bytes32)",
  "function grantRole(bytes32,address)",
]);
const tokenAbi = parseAbi(["function approve(address,uint256) returns (bool)"]);
const chainClient = createPublicClient({
  chain: bscTestnet,
  transport: http("https://bsc-testnet-rpc.publicnode.com"),
});
const poolAddress = manifest.address as Address;
const tokenAddress = manifest.asset as Address;
const pendingTxKey = (wallet: string) =>
  `talunai:pool-pending:97:${poolAddress.toLowerCase()}:${wallet.toLowerCase()}`;
function clearStoredPendingTx(wallet: string) {
  try {
    window.localStorage.removeItem(pendingTxKey(wallet));
  } catch {
    // Browser storage may be disabled; keep reconciling the hash in memory.
  }
}
const txUrl = (hash: string) => `https://testnet.bscscan.com/tx/${hash}`;
const addressUrl = (address: string) =>
  `https://testnet.bscscan.com/address/${address}`;
const readJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok)
    throw new Error(`Data onchain belum tersedia (${response.status}).`);
  return response.json() as Promise<T>;
};

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="surface p-8">Membuka data pasar…</div>}>
      <ExploreContent />
    </Suspense>
  );
}

function ExploreContent() {
  const searchParams = useSearchParams();
  const requestedKey = searchParams.get("claimKey") ?? "";
  const initialKey = /^0x[0-9a-fA-F]{64}$/.test(requestedKey)
    ? requestedKey
    : "";
  const { api, user, config, connect, getWalletProvider } = useSession();
  const [amount, setAmount] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [pendingTx, setPendingTx] = useState<PendingPoolTx | null>(null);
  const pendingTxRef = useRef<PendingPoolTx | null>(null);
  const [claimKey, setClaimKey] = useState(initialKey);
  const [candidateKey, setCandidateKey] = useState(initialKey);
  const [newInvestor, setNewInvestor] = useState("");
  const [eventFilter, setEventFilter] = useState<
    "all" | "capital" | "financing"
  >("all");
  const [eventSearch, setEventSearch] = useState("");
  const [marketOffset, setMarketOffset] = useState(0);
  const [transactionStatus, setTransactionStatus] = useState<string | null>(
    null,
  );
  const [view, setView] = useState<MarketView>("market");
  const isAdmin = !!user?.memberships.some((m) => m.role === "ADMIN");
  const isLender = !!user?.memberships.some((m) => m.role === "LENDER");
  const isTestnetWallet = config?.chainId === 97 && !!user;
  const walletAddress = user?.wallet;
  useEffect(() => {
    const syncView = () => {
      const hash = window.location.hash;
      if (hash === "#market-position" || hash === "#pool-risk-detail")
        setView("invest");
      else if (hash === "#pool-events") setView("activity");
      else if (hash === "#market-operator" && isAdmin) setView("operator");
      else if (initialKey && isAdmin) setView("operator");
    };
    syncView();
    window.addEventListener("hashchange", syncView);
    return () => window.removeEventListener("hashchange", syncView);
  }, [initialKey, isAdmin]);
  const selectView = (next: MarketView) => {
    setView(next);
    const hash =
      next === "invest"
        ? "#market-position"
        : next === "activity"
          ? "#pool-events"
          : next === "operator"
            ? "#market-operator"
            : "#market-list";
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
  };
  const overview = useQuery({
    queryKey: ["pool-explore", user?.wallet],
    queryFn: () =>
      readJson<Explore>(
        `/v1/explore?events=0${user ? `&wallet=${user.wallet}` : ""}`,
      ),
    refetchInterval: 30_000,
    retry: 1,
  });
  const refetchOverview = overview.refetch;
  const activity = useQuery({
    queryKey: ["pool-explore-events"],
    queryFn: () => readJson<PoolEvents>("/v1/explore/events"),
    refetchInterval: 60_000,
    retry: 1,
  });
  const candidate = useQuery({
    queryKey: ["pool-candidate", candidateKey],
    queryFn: () =>
      readJson<Candidate>(`/v1/explore/candidate?key=${candidateKey}`),
    enabled: !!candidateKey,
    refetchInterval: 30_000,
    retry: false,
  });
  const registeredClaims = useQuery({
    queryKey: ["pool-registered-claims", user?.userId],
    queryFn: () => api.claims(12, 0, { workflow: "REGISTERED" }),
    enabled: isAdmin,
    retry: false,
  });
  const marketDeals = useQuery({
    queryKey: ["market-deals", user?.wallet, marketOffset],
    queryFn: () => api.marketDeals(10, marketOffset),
    enabled: isLender,
    refetchInterval: 30_000,
    retry: false,
  });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!walletAddress) {
        pendingTxRef.current = null;
        setPendingTx(null);
        return;
      }
      try {
        const saved = window.localStorage.getItem(pendingTxKey(walletAddress));
        if (!saved) {
          pendingTxRef.current = null;
          setPendingTx(null);
          return;
        }
        const parsed: unknown = JSON.parse(saved);
        if (
          !parsed ||
          typeof parsed !== "object" ||
          !("hash" in parsed) ||
          !("wallet" in parsed) ||
          !("label" in parsed) ||
          typeof parsed.hash !== "string" ||
          !/^0x[0-9a-fA-F]{64}$/.test(parsed.hash) ||
          typeof parsed.wallet !== "string" ||
          parsed.wallet.toLowerCase() !== walletAddress.toLowerCase() ||
          typeof parsed.label !== "string"
        ) {
          clearStoredPendingTx(walletAddress);
          return;
        }
        const restored = parsed as PendingPoolTx;
        pendingTxRef.current = restored;
        setPendingTx(restored);
        setLastTx(restored.hash);
        setTransactionStatus(
          `${restored.label}: memeriksa konfirmasi jaringan…`,
        );
      } catch {
        // Storage can be unavailable; the transaction link remains visible in this tab.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [walletAddress]);
  useEffect(() => {
    if (
      busy ||
      !pendingTx ||
      pendingTx.wallet.toLowerCase() !== walletAddress?.toLowerCase()
    )
      return;
    let cancelled = false;
    let checking = false;
    const reconcile = async () => {
      if (checking) return;
      checking = true;
      try {
        const [receipt, head] = await Promise.all([
          chainClient.getTransactionReceipt({ hash: pendingTx.hash }),
          chainClient.getBlockNumber({ cacheTime: 0 }),
        ]);
        if (cancelled || head < receipt.blockNumber + 1n) return;
        clearStoredPendingTx(pendingTx.wallet);
        if (pendingTxRef.current?.hash === pendingTx.hash)
          pendingTxRef.current = null;
        setPendingTx((current) =>
          current?.hash === pendingTx.hash ? null : current,
        );
        if (receipt.status === "success") {
          setTransactionStatus(
            `${pendingTx.label}: terkonfirmasi di jaringan.`,
          );
          void refetchOverview();
        } else {
          setTransactionStatus(null);
          setActionError(
            `${pendingTx.label} gagal di jaringan. Periksa bukti transaksi sebelum mencoba lagi.`,
          );
        }
      } catch {
        // A missing receipt or temporary RPC failure must keep the hash pending.
      } finally {
        checking = false;
      }
    };
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [busy, pendingTx, walletAddress, refetchOverview]);
  const data = overview.data;
  const visibleView =
    data?.legacyPositionOnly && view === "operator" ? "market" : view;
  const actionBusy = busy || Boolean(pendingTx);
  const eventData = activity.data;
  const events = eventData?.events ?? [];
  const position = data?.position;
  const pct = data?.stats.utilizationBps ? data.stats.utilizationBps / 100 : 0;
  const validAmount = /^[1-9]\d*$/.test(amount);
  const assets = validAmount ? BigInt(amount) : 0n;
  const canCoverDeposit = !!position && assets <= BigInt(position.tokenBalance);
  const supply = BigInt(data?.stats.shares ?? "0");
  const bookAssets = BigInt(data?.stats.bookAssets ?? "0");
  const previewShares =
    assets === 0n
      ? 0n
      : supply === 0n
        ? assets
        : bookAssets === 0n
          ? 0n
          : (assets * supply) / bookAssets;
  const shownEvents = events.filter((event) => {
    const inType =
      eventFilter === "all" ||
      (eventFilter === "capital"
        ? ["Deposited", "Redeemed"].includes(event.event)
        : ["ClaimFunded", "Harvested"].includes(event.event));
    const needle = eventSearch.trim().toLowerCase();
    return (
      inType &&
      (!needle ||
        [event.txHash, event.claimKey, event.investor, event.event].some(
          (value) => value?.toLowerCase().includes(needle),
        ))
    );
  });

  async function send(to: Address, data: Hex, label: string) {
    if (pendingTxRef.current)
      throw new Error(
        "Transaksi sebelumnya belum terkonfirmasi. Periksa hash transaksi sebelum mencoba lagi.",
      );
    if (!user || !isTestnetWallet)
      throw new Error("Hubungkan wallet yang sesuai di BSC Testnet.");
    const provider = await getWalletProvider();
    const wallet = createWalletClient({
      chain: bscTestnet,
      transport: custom(provider),
      account: user.wallet as Address,
    });
    setTransactionStatus(`${label}: konfirmasi di wallet…`);
    const hash = await wallet.sendTransaction({ to, data, value: 0n });
    const pending = { hash, label, wallet: user.wallet as Address };
    pendingTxRef.current = pending;
    setPendingTx(pending);
    try {
      window.localStorage.setItem(
        pendingTxKey(user.wallet),
        JSON.stringify(pending),
      );
    } catch {
      // Storage is best effort; retain the hash in memory for this session.
    }
    setLastTx(hash);
    setTransactionStatus(`${label}: menunggu 2 konfirmasi jaringan…`);
    const receipt = await chainClient.waitForTransactionReceipt({
      hash,
      confirmations: 2,
      timeout: 180_000,
    });
    if (receipt.status !== "success") {
      clearStoredPendingTx(user.wallet);
      pendingTxRef.current = null;
      setPendingTx(null);
      throw new Error("Transaksi gagal di jaringan. Periksa bukti transaksi.");
    }
    clearStoredPendingTx(user.wallet);
    pendingTxRef.current = null;
    setPendingTx(null);
    return hash;
  }
  async function action(run: () => Promise<void>) {
    if (pendingTxRef.current) {
      setActionError(
        "Transaksi sebelumnya belum terkonfirmasi. Periksa bukti transaksi sebelum mengirim ulang.",
      );
      return;
    }
    setBusy(true);
    setActionError(null);
    setLastTx(null);
    setTransactionStatus("Menyiapkan transaksi…");
    try {
      await run();
      await overview.refetch();
      if (candidateKey) await candidate.refetch();
      setTransactionStatus("Transaksi terkonfirmasi di BSC Testnet.");
    } catch (error) {
      if (pendingTxRef.current) {
        setTransactionStatus(
          "Hasil transaksi belum dapat dipastikan. Hash tersimpan; periksa konfirmasi jaringan sebelum mencoba lagi.",
        );
        setActionError(null);
      } else {
        setTransactionStatus(null);
        setActionError(
          error instanceof Error ? error.message : "Transaksi belum berhasil.",
        );
      }
    } finally {
      setBusy(false);
    }
  }
  function deposit() {
    void action(async () => {
      if (
        !data ||
        data.pool.toLowerCase() !== poolAddress.toLowerCase() ||
        data.token.toLowerCase() !== tokenAddress.toLowerCase()
      )
        throw new Error("Alamat kontrak tidak cocok dengan manifest deploy.");
      if (data.legacyPositionOnly)
        throw new Error(
          "Pool ini hanya melayani posisi lama. Deposit baru sudah ditutup.",
        );
      if (
        !accepted ||
        data.controls.riskHash.toLowerCase() !==
          manifest.riskDisclosureHash.toLowerCase()
      )
        throw new Error("Baca dan setujui risiko pool terlebih dahulu.");
      if (!/^[1-9]\d*$/.test(amount))
        throw new Error("Masukkan jumlah IDRT uji bulat di atas nol.");
      const assets = BigInt(amount);
      if (
        !position?.investorAllowed ||
        assets > BigInt(position.tokenBalance) ||
        previewShares === 0n ||
        data.controls.capitalLocked ||
        data.controls.depositsPaused
      )
        throw new Error("Deposit belum tersedia untuk wallet atau saldo ini.");
      if (BigInt(position.allowance) < assets)
        await send(
          tokenAddress,
          encodeFunctionData({
            abi: tokenAbi,
            functionName: "approve",
            args: [poolAddress, assets],
          }),
          "Izin token",
        );
      await send(
        poolAddress,
        encodeFunctionData({
          abi: poolAbi,
          functionName: "deposit",
          args: [assets, data.controls.riskHash as Hex],
        }),
        "Deposit pool",
      );
      setAmount("");
      setAccepted(false);
    });
  }
  function redeem() {
    void action(async () => {
      if (
        !position ||
        BigInt(position.shares) === 0n ||
        data?.controls.capitalLocked
      )
        throw new Error("Posisi belum dapat ditarik selama invoice aktif.");
      await send(
        poolAddress,
        encodeFunctionData({
          abi: poolAbi,
          functionName: "redeem",
          args: [BigInt(position.shares)],
        }),
        "Penebusan share",
      );
    });
  }
  function fund() {
    void action(async () => {
      if (data?.legacyPositionOnly)
        throw new Error("Pool ini tidak menerima pendanaan Deal baru.");
      if (
        !isAdmin ||
        !position?.allocatorAllowed ||
        !candidate.data?.canAllocate ||
        candidate.data.claimKey.toLowerCase() !==
          claimKey.trim().toLowerCase() ||
        data?.controls.allocationsPaused
      )
        throw new Error("Invoice belum memenuhi batas alokasi pool.");
      await send(
        poolAddress,
        encodeFunctionData({
          abi: poolAbi,
          functionName: "fundClaim",
          args: [candidate.data.claimKey as Hex],
        }),
        "Pendanaan invoice",
      );
      setCandidateKey("");
      setClaimKey("");
    });
  }
  function grantInvestor() {
    void action(async () => {
      if (data?.legacyPositionOnly)
        throw new Error("Izin investor baru ditutup untuk pool posisi lama.");
      if (
        !isAdmin ||
        !position?.adminAllowed ||
        !/^0x[0-9a-fA-F]{40}$/.test(newInvestor)
      )
        throw new Error("Alamat investor tidak valid.");
      let approvedLender = false;
      for (let offset = 0; ; offset += 100) {
        const page = await api.opsOrganizations({
          status: "APPROVED",
          limit: 100,
          offset,
        });
        approvedLender ||= page.items.some((organization) =>
          organization.memberships.some(
            (membership) =>
              membership.approved &&
              membership.role === "LENDER" &&
              membership.wallets.some(
                (wallet) => wallet.toLowerCase() === newInvestor.toLowerCase(),
              ),
          ),
        );
        if (
          approvedLender ||
          page.items.length < 100 ||
          (page.total !== undefined && offset + page.items.length >= page.total)
        )
          break;
      }
      if (!approvedLender)
        throw new Error(
          "Wallet belum menjadi lender yang disetujui dalam organisasi aplikasi.",
        );
      await send(
        poolAddress,
        encodeFunctionData({
          abi: poolAbi,
          functionName: "grantRole",
          args: [keccak256(toHex("INVESTOR_ROLE")), newInvestor as Address],
        }),
        "Izin investor",
      );
      setNewInvestor("");
    });
  }

  return (
    <div className="page-stack pool-page">
      <PageHeader
        eyebrow="PASAR / BSC TESTNET"
        title="Pasar pendanaan"
        description="Invoice diperiksa, didanai, lalu pembayaran buyer dibagi ke lender. Jelajahi angka dan transaksi yang tercatat di chain."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void overview.refetch()}
            disabled={overview.isFetching}
          >
            <RefreshCw
              size={14}
              className={overview.isFetching ? "loading-spinner" : ""}
            />{" "}
            Perbarui data
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <TokenIdentity compact />
        <span>
          MockIDR sintetis di BSC Testnet · tidak bernilai rupiah atau dapat
          ditebus. Lihat identitas kontrak pada label token.
        </span>
      </div>
      <nav className="pool-section-nav" aria-label="Bagian pasar">
        {(
          [
            ["market", "Pasar"],
            ["invest", "Investasi saya"],
            ["activity", "Transaksi"],
            ...(isAdmin && !data?.legacyPositionOnly
              ? [["operator", "Operator"]]
              : []),
          ] as [MarketView, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-current={visibleView === key ? "page" : undefined}
            onClick={() => selectView(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {visibleView === "market" && isLender && (
        <section className="surface" aria-label="Deal yang siap didanai">
          <div className="surface-header flex-wrap gap-3">
            <div>
              <p className="text-kicker">PENDANAAN LANGSUNG</p>
              <h2 className="section-heading">Deal siap didanai</h2>
            </div>
            <span className="text-xs text-muted-foreground">
              Data terkonfirmasi · IDRT uji
            </span>
          </div>
          {marketDeals.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">
              Memeriksa Deal yang tersedia…
            </p>
          ) : marketDeals.error ? (
            <div className="p-6 text-sm" role="alert">
              <p className="text-muted-foreground">
                Daftar Deal belum dapat diselaraskan dengan jaringan.
              </p>
              <Button
                className="mt-3"
                variant="outline"
                size="sm"
                onClick={() => void marketDeals.refetch()}
              >
                Coba lagi
              </Button>
            </div>
          ) : marketDeals.data?.items.length ? (
            <>
              <ul className="divide-y divide-border">
                {marketDeals.data.items.map((deal) => (
                  <li
                    key={deal.id}
                    className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-primary">
                        {deal.hasAccess
                          ? "Akses Deal aktif"
                          : "Ringkasan publik"}
                        {" · "}blok {deal.confirmedBlock}
                      </p>
                      <h3 className="mt-1 text-sm font-semibold">
                        Deal {shortAddress(deal.claimKey)}
                      </h3>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Invoice Rp {money(deal.invoiceAmount)} · Pendanaan Rp{" "}
                        {money(deal.principal)} · Fee Rp {money(deal.fee)} ·
                        jatuh tempo {formatDate(deal.dueAt)}
                      </p>
                    </div>
                    {deal.hasAccess ? (
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={`/lender/claims/${encodeURIComponent(deal.id)}`}
                        >
                          Tinjau Deal <ArrowRight size={14} />
                        </Link>
                      </Button>
                    ) : (
                      <p className="max-w-[12rem] text-xs text-muted-foreground">
                        Minta supplier mengundang organisasi Anda untuk melihat
                        dokumen dan mendanai.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <div className="surface-footer flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {marketOffset + 1}–
                  {marketOffset + marketDeals.data.items.length} dari{" "}
                  {marketDeals.data.total ?? "?"} Deal
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={marketOffset === 0}
                    onClick={() =>
                      setMarketOffset((current) => Math.max(0, current - 10))
                    }
                  >
                    Sebelumnya
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      marketOffset + marketDeals.data.items.length >=
                      (marketDeals.data.total ?? marketOffset + 10)
                    }
                    onClick={() => setMarketOffset((current) => current + 10)}
                  >
                    Berikutnya
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <p className="p-6 text-sm text-muted-foreground">
              Belum ada Deal terkonfirmasi yang masih dalam jendela pendanaan.
            </p>
          )}
        </section>
      )}
      {overview.isError && (
        <div role="alert" className="danger-callout p-4">
          {overview.error.message}{" "}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void overview.refetch()}
          >
            Coba lagi
          </Button>
        </div>
      )}
      {!data && (actionError || transactionStatus) && (
        <div className="pool-feedback" role={actionError ? "alert" : "status"}>
          <p>{actionError ?? transactionStatus}</p>
          {lastTx && (
            <a
              className="pool-tx-notice"
              href={txUrl(lastTx)}
              target="_blank"
              rel="noreferrer"
            >
              Periksa transaksi {shortAddress(lastTx)}
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          )}
        </div>
      )}
      {!data ? (
        <div className="surface p-8 text-muted-foreground">
          {overview.isError
            ? "Data pasar belum bisa dibaca. Coba lagi setelah koneksi RPC pulih."
            : "Membaca blok, saldo, dan transaksi pasar…"}
        </div>
      ) : (
        <>
          <div className="pool-meta" role="status">
            <span>
              <span className="pool-live-dot" /> BSC Testnet · blok{" "}
              {data.blockNumber} · {formatDate(data.blockTime, true)} WIB
            </span>
            <span>
              <ShieldCheck size={14} /> Data kontrak, diperbarui setiap 30 detik
            </span>
            <span>IDRT simulasi · tanpa nilai rupiah</span>
          </div>
          {data.legacyPositionOnly && (
            <div className="info-callout text-sm" role="status">
              Pool ini menampilkan posisi lama. Deposit dan alokasi baru ke pool
              ditutup; pendanaan Deal baru dilakukan langsung oleh lender.
            </div>
          )}
          {visibleView === "market" && (
            <div className="pool-view-content" id="market-view">
              <section
                className="surface pool-market"
                id="market-list"
                aria-label="Pasar yang tersedia"
              >
                <div className="surface-header pool-market-heading">
                  <h2 className="section-heading">Pasar onchain</h2>
                </div>
                <div className="table-scroll">
                  <table className="pool-table pool-market-table">
                    <thead>
                      <tr>
                        <th>Pasar</th>
                        <th>Aset buku</th>
                        <th>Kas tersedia</th>
                        <th>Terpakai</th>
                        <th>Fee diterima</th>
                        <th>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <div className="pool-market-name">
                            <Image
                              src="/idrt-logo.svg"
                              width={36}
                              height={36}
                              alt=""
                              className="pool-market-symbol"
                            />
                            <span>
                              <strong>Piutang usaha / IDRT uji</strong>
                              <small>tPOOL-A · BSC Testnet</small>
                            </span>
                          </div>
                        </td>
                        <td>Rp {money(data.stats.bookAssets)}</td>
                        <td>Rp {money(data.stats.idle)}</td>
                        <td>
                          {pct.toLocaleString("id-ID", {
                            maximumFractionDigits: 1,
                          })}
                          %
                        </td>
                        <td>Rp {money(data.stats.realizedFee)}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => selectView("invest")}
                          >
                            Lihat posisi <ArrowRight size={14} />
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="pool-market-mobile">
                  <div className="pool-market-name">
                    <Image
                      src="/idrt-logo.svg"
                      width={36}
                      height={36}
                      alt=""
                      className="pool-market-symbol"
                    />
                    <span>
                      <strong>Piutang usaha / IDRT uji</strong>
                      <small>tPOOL-A · BSC Testnet</small>
                    </span>
                  </div>
                  <div className="pool-market-mobile-value">
                    <span>Aset buku</span>
                    <strong>Rp {money(data.stats.bookAssets)}</strong>
                  </div>
                  <dl className="pool-market-mobile-stats">
                    <div>
                      <dt>Kas tersedia</dt>
                      <dd>Rp {money(data.stats.idle)}</dd>
                    </div>
                    <div>
                      <dt>Terpakai</dt>
                      <dd>
                        {pct.toLocaleString("id-ID", {
                          maximumFractionDigits: 1,
                        })}
                        %
                      </dd>
                    </div>
                    <div>
                      <dt>Fee diterima</dt>
                      <dd>Rp {money(data.stats.realizedFee)}</dd>
                    </div>
                  </dl>
                  <button type="button" onClick={() => selectView("invest")}>
                    Lihat posisi <ArrowRight size={15} />
                  </button>
                </div>
                <div className="pool-market-proof">
                  <a
                    href={addressUrl(data.pool)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Kontrak {shortAddress(data.pool)} <ExternalLink size={13} />
                  </a>
                  <a
                    href={addressUrl(data.token)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Kontrak token uji <ExternalLink size={13} />
                  </a>
                  <span>
                    Nilai buku bukan harga pasar atau jaminan pengembalian.
                  </span>
                </div>
              </section>
              <section
                className="surface pool-panel"
                id="market-portfolio"
                aria-label="Portofolio invoice pool"
              >
                <div className="surface-header">
                  <div>
                    <h2 className="section-heading">Invoice didanai</h2>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {money(data.stats.totalDeals)} invoice sepanjang umur
                    kontrak
                  </span>
                </div>
                {(data.deals ?? []).length ? (
                  <>
                    <div className="table-scroll">
                      <table className="pool-table pool-deals-table">
                        <thead>
                          <tr>
                            <th>Claim key</th>
                            <th>Pokok awal</th>
                            <th>Belum kembali</th>
                            <th>Fee diterima</th>
                            <th>Jatuh tempo</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.deals.map((deal) => {
                            const proof = events.find(
                              (event) =>
                                event.event === "ClaimFunded" &&
                                event.claimKey?.toLowerCase() ===
                                  deal.claimKey.toLowerCase(),
                            );
                            return (
                              <tr key={deal.claimKey}>
                                <td title={deal.claimKey}>
                                  {proof ? (
                                    <a
                                      href={txUrl(proof.txHash)}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {shortAddress(deal.claimKey)}{" "}
                                      <ExternalLink size={12} />
                                    </a>
                                  ) : (
                                    shortAddress(deal.claimKey)
                                  )}
                                </td>
                                <td>Rp {money(deal.principal)}</td>
                                <td>Rp {money(deal.outstandingPrincipal)}</td>
                                <td>Rp {money(deal.feeAllocated)}</td>
                                <td>{formatDate(deal.dueAt)}</td>
                                <td>
                                  <span
                                    className={`pool-deal-status pool-deal-status-${deal.status.toLowerCase()}`}
                                  >
                                    {dealStatusLabel[deal.status]}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <ul
                      className="pool-mobile-list pool-mobile-deals"
                      aria-label="Invoice yang didanai pasar"
                    >
                      {data.deals.map((deal) => {
                        const proof = events.find(
                          (event) =>
                            event.event === "ClaimFunded" &&
                            event.claimKey?.toLowerCase() ===
                              deal.claimKey.toLowerCase(),
                        );
                        return (
                          <li key={deal.claimKey}>
                            <div className="pool-mobile-row-head">
                              <div>
                                <span className="pool-mobile-caption">
                                  CLAIM KEY
                                </span>
                                <details className="pool-mobile-key">
                                  <summary>
                                    {shortAddress(deal.claimKey)}
                                  </summary>
                                  <code>{deal.claimKey}</code>
                                </details>
                              </div>
                              <span
                                className={`pool-deal-status pool-deal-status-${deal.status.toLowerCase()}`}
                              >
                                {dealStatusLabel[deal.status]}
                              </span>
                            </div>
                            <dl className="pool-mobile-metrics">
                              <div>
                                <dt>Pokok awal</dt>
                                <dd>Rp {money(deal.principal)}</dd>
                              </div>
                              <div>
                                <dt>Belum kembali</dt>
                                <dd>Rp {money(deal.outstandingPrincipal)}</dd>
                              </div>
                              <div>
                                <dt>Fee diterima</dt>
                                <dd>Rp {money(deal.feeAllocated)}</dd>
                              </div>
                              <div>
                                <dt>Jatuh tempo</dt>
                                <dd>{formatDate(deal.dueAt)}</dd>
                              </div>
                            </dl>
                            {proof && (
                              <a
                                className="pool-mobile-proof"
                                href={txUrl(proof.txHash)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Bukti pendanaan {shortAddress(proof.txHash)}{" "}
                                <ExternalLink size={13} />
                              </a>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : (
                  <div className="pool-portfolio-empty">
                    <p>Belum ada invoice yang didanai pasar ini.</p>
                    <span>
                      Likuiditas tetap berada di kontrak pool sampai invoice
                      lolos review, persetujuan, dan batas risiko.
                    </span>
                    {isAdmin && (
                      <Link href="/admin/claims">
                        Lihat pengajuan <ArrowRight size={14} />
                      </Link>
                    )}
                  </div>
                )}
                <p className="pool-table-footnote">
                  Pokok yang belum kembali dicatat pada nilai nominal. Status
                  lunas berarti hak lender telah dibayar; angka ini bukan
                  penilaian risiko atau harga pasar.
                </p>
              </section>
            </div>
          )}
          {visibleView === "invest" && (
            <div className="pool-view-content">
              <section className="surface pool-panel" id="market-position">
                <div className="surface-header">
                  <div>
                    <p className="text-kicker">POSISI INVESTOR</p>
                    <h2 className="section-heading">Posisi saya</h2>
                  </div>
                  <Wallet size={17} />
                </div>
                <div className="surface-content">
                  {!user ? (
                    <div className="pool-empty">
                      <p>
                        Jelajahi data tanpa login. Hubungkan wallet untuk
                        melihat share dan melakukan transaksi.
                      </p>
                      <Button
                        onClick={() => void connect().catch(() => undefined)}
                      >
                        Hubungkan wallet
                      </Button>
                    </div>
                  ) : config?.chainId !== 97 ? (
                    <p className="text-muted-foreground">
                      Transaksi pool tersedia saat aplikasi terhubung ke BSC
                      Testnet. Data explorer tetap dapat dibaca.
                    </p>
                  ) : (
                    <>
                      <div className="pool-position">
                        <div>
                          <span>Share Anda</span>
                          <strong>{money(position?.shares)}</strong>
                        </div>
                        <div>
                          <span>Nilai posisi buku</span>
                          <strong>
                            Rp {money(position?.bookPositionValue)}
                          </strong>
                        </div>
                        <div>
                          <span>Saldo wallet</span>
                          <strong>Rp {money(position?.tokenBalance)}</strong>
                        </div>
                      </div>
                      <p className="pool-position-risk">
                        Nilai posisi buku memasukkan pokok invoice yang belum
                        dibayar pada nilai nominal. Penarikan terkunci sampai
                        semua hak lender lunas; tidak ada pasar sekunder untuk
                        share.
                      </p>
                      {!data.legacyPositionOnly && (
                        <>
                          {!position?.investorAllowed && (
                            <p className="pool-inline-note">
                              Wallet ini belum mendapat izin investor onchain.
                              Admin perlu memberi akses sebelum deposit.
                            </p>
                          )}
                          <div className="field-group mt-6">
                            <label
                              htmlFor="pool-deposit-amount"
                              className="text-sm font-medium"
                            >
                              Jumlah deposit IDRT uji
                            </label>
                            <div className="pool-amount-entry">
                              <input
                                id="pool-deposit-amount"
                                className="pool-input"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={amount}
                                onChange={(e) =>
                                  setAmount(
                                    e.target.value.replace(/[^0-9]/g, ""),
                                  )
                                }
                                placeholder="0"
                                disabled={actionBusy}
                                aria-describedby="pool-deposit-preview"
                              />
                              <button
                                type="button"
                                disabled={
                                  actionBusy ||
                                  !position?.tokenBalance ||
                                  position.tokenBalance === "0"
                                }
                                onClick={() =>
                                  setAmount(position?.tokenBalance ?? "")
                                }
                              >
                                MAX
                              </button>
                            </div>
                            <p
                              id="pool-deposit-preview"
                              className="pool-deposit-preview"
                            >
                              {validAmount && !canCoverDeposit
                                ? "Saldo wallet tidak cukup."
                                : validAmount && previewShares === 0n
                                  ? "Jumlah terlalu kecil untuk mendapat share."
                                  : validAmount
                                    ? `Estimasi ${money(previewShares.toString())} share saat blok ${data.blockNumber}.`
                                    : `Saldo tersedia Rp ${money(position?.tokenBalance)} IDRT uji.`}
                            </p>
                          </div>
                          <label className="pool-risk">
                            <input
                              type="checkbox"
                              checked={accepted}
                              onChange={(e) => setAccepted(e.target.checked)}
                              disabled={actionBusy}
                            />
                            <span>
                              Saya memahami IDRT uji tidak bernilai uang, modal
                              terkunci hingga hak lender lunas, buyer bisa gagal
                              bayar, dan hasil tidak dijamin.{" "}
                              <a href="#pool-risk-detail">
                                Baca rincian risiko
                              </a>
                              .
                            </span>
                          </label>
                        </>
                      )}
                      <div className="pool-actions">
                        {!data.legacyPositionOnly && (
                          <Button
                            disabled={
                              actionBusy ||
                              !position?.investorAllowed ||
                              !validAmount ||
                              !canCoverDeposit ||
                              previewShares === 0n ||
                              !accepted ||
                              data.controls.capitalLocked ||
                              data.controls.depositsPaused
                            }
                            onClick={deposit}
                          >
                            <ArrowDownLeft size={15} /> Deposit IDRT uji
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          disabled={
                            actionBusy ||
                            !position?.shares ||
                            position.shares === "0" ||
                            data.controls.capitalLocked
                          }
                          onClick={redeem}
                        >
                          <ArrowUpRight size={15} /> Tarik seluruh posisi
                        </Button>
                      </div>
                      {data.controls.capitalLocked && (
                        <p className="pool-inline-note">
                          <LockKeyhole size={14} /> Penarikan terkunci hingga
                          seluruh hak lender dari invoice aktif dibayar.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </section>
              <section className="pool-risk-detail" id="pool-risk-detail">
                <Compass size={18} />
                <div>
                  <h2>
                    {data.legacyPositionOnly
                      ? "Risiko posisi pool"
                      : "Risiko sebelum deposit"}
                  </h2>
                  <p>
                    IDRT uji tidak bernilai uang. Gagal bayar, sengketa, atau
                    kegagalan kontrak dapat menyebabkan rugi atau penundaan.
                    Penarikan terkunci hingga hak lender dibayar; nilai buku
                    belum otomatis mencerminkan kerugian. Share tidak dapat
                    dipindahtangankan dan hasil tidak dijamin.
                  </p>
                  <details className="pool-risk-contract">
                    <summary>Lihat pernyataan kontrak dan hash risiko</summary>
                    <p>{data.controls.riskDisclosure}</p>
                    <code>{data.controls.riskHash}</code>
                  </details>
                </div>
              </section>
            </div>
          )}
          {visibleView === "activity" && (
            <div className="pool-view-content">
              {activity.isError && eventData && (
                <div
                  className="danger-callout pool-activity-state p-4"
                  role="alert"
                >
                  <p>
                    Aktivitas terbaru belum dapat diperbarui. Menampilkan data
                    terakhir dari blok {eventData.blockNumber}.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void activity.refetch()}
                  >
                    Coba lagi
                  </Button>
                </div>
              )}
              {!eventData ? (
                <div
                  className="surface p-6"
                  role={activity.isError ? "alert" : "status"}
                >
                  {activity.isError ? (
                    <div className="pool-activity-state">
                      <p>Riwayat transaksi belum dapat dibaca dari RPC.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void activity.refetch()}
                      >
                        Coba lagi
                      </Button>
                    </div>
                  ) : (
                    <p>Membaca riwayat transaksi dari chain…</p>
                  )}
                </div>
              ) : (
                <section className="surface pool-panel" id="pool-events">
                  <div className="surface-header">
                    <div>
                      <p className="text-kicker">TRANSPARANSI</p>
                      <h2 className="section-heading">Ledger aktivitas pool</h2>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Blok {eventData.eventWindowFromBlock}–
                      {eventData.blockNumber} · {events.length} entri{" "}
                      {eventData.eventHistoryComplete
                        ? "sejak pool dibuka"
                        : eventData.genesisPinned
                          ? "terbaru + deposit awal"
                          : "terbaru"}
                    </span>
                  </div>
                  <div className="pool-ledger-tools">
                    <div
                      className="pool-ledger-filters"
                      role="group"
                      aria-label="Jenis aktivitas"
                    >
                      {(
                        [
                          ["all", "Semua"],
                          ["capital", "Modal"],
                          ["financing", "Pembiayaan"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          type="button"
                          key={value}
                          aria-pressed={eventFilter === value}
                          onClick={() => setEventFilter(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="pool-ledger-search">
                      <Search size={14} aria-hidden="true" />
                      <span className="sr-only">
                        Cari transaksi, wallet, atau claim key
                      </span>
                      <input
                        value={eventSearch}
                        onChange={(e) => setEventSearch(e.target.value)}
                        placeholder="Cari hash atau wallet"
                      />
                    </label>
                  </div>
                  <div className="table-scroll">
                    <table className="pool-table">
                      <thead>
                        <tr>
                          <th>Peristiwa</th>
                          <th>Nilai IDRT uji</th>
                          <th>Investor / invoice</th>
                          <th>Blok</th>
                          <th>Bukti</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shownEvents.length ? (
                          shownEvents.map((event, i) => (
                            <tr key={`${event.txHash}-${i}`}>
                              <td>
                                {event.event === "Deposited"
                                  ? "Deposit"
                                  : event.event === "ClaimFunded"
                                    ? "Pendanaan invoice"
                                    : event.event === "Redeemed"
                                      ? "Penebusan"
                                      : "Penerimaan dari vault"}
                              </td>
                              <td>Rp {money(event.amount)}</td>
                              <td
                                title={
                                  event.investor ?? event.claimKey ?? undefined
                                }
                              >
                                {shortAddress(event.investor ?? event.claimKey)}
                              </td>
                              <td>{event.blockNumber}</td>
                              <td>
                                <a
                                  href={txUrl(event.txHash)}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`Lihat transaksi ${shortAddress(event.txHash)}`}
                                >
                                  {shortAddress(event.txHash)}{" "}
                                  <ExternalLink size={12} />
                                </a>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5}>
                              {events.length
                                ? "Tidak ada aktivitas yang cocok dengan filter."
                                : "Belum ada transaksi pool dalam rentang blok ini."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <ul
                    className="pool-mobile-list pool-mobile-events"
                    aria-label="Ledger aktivitas pool"
                  >
                    {shownEvents.length ? (
                      shownEvents.map((event, i) => (
                        <li key={`${event.txHash}-${i}`}>
                          <div className="pool-mobile-row-head">
                            <strong>
                              {event.event === "Deposited"
                                ? "Deposit"
                                : event.event === "ClaimFunded"
                                  ? "Pendanaan invoice"
                                  : event.event === "Redeemed"
                                    ? "Penebusan"
                                    : "Penerimaan dari vault"}
                            </strong>
                            <b>Rp {money(event.amount)}</b>
                          </div>
                          <div className="pool-mobile-event-meta">
                            <span>Blok {event.blockNumber}</span>
                            <span
                              title={
                                event.investor ?? event.claimKey ?? undefined
                              }
                            >
                              {event.investor ? "Investor" : "Invoice"}{" "}
                              {shortAddress(event.investor ?? event.claimKey)}
                            </span>
                          </div>
                          <a
                            className="pool-mobile-proof"
                            href={txUrl(event.txHash)}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Buka bukti transaksi ${shortAddress(event.txHash)} di BscScan`}
                          >
                            Bukti {shortAddress(event.txHash)}{" "}
                            <ExternalLink size={13} />
                          </a>
                        </li>
                      ))
                    ) : (
                      <li className="pool-mobile-empty">
                        {events.length
                          ? "Tidak ada aktivitas yang cocok dengan filter."
                          : "Belum ada transaksi pool dalam rentang blok ini."}
                      </li>
                    )}
                  </ul>
                </section>
              )}
            </div>
          )}
          {visibleView === "operator" &&
            isAdmin &&
            !data.legacyPositionOnly && (
              <section className="surface pool-panel" id="market-operator">
                <div className="surface-header">
                  <div>
                    <p className="text-kicker">KONTROL OPERATOR</p>
                    <h2 className="section-heading">
                      Akses investor & alokasi invoice
                    </h2>
                  </div>
                  <ShieldCheck size={18} />
                </div>
                <div className="surface-content pool-admin-grid">
                  {!position?.adminAllowed && !position?.allocatorAllowed && (
                    <p className="pool-inline-note">
                      Wallet admin aplikasi ini belum memegang peran operator
                      pada kontrak pool.
                    </p>
                  )}
                  <div>
                    <h3>Berikan akses investor</h3>
                    <p>
                      Hanya admin onchain yang dapat memberi peran ke wallet
                      lender organisasi yang sudah disetujui. Investor tetap
                      harus menyetujui risiko sendiri saat deposit.
                    </p>
                    <input
                      className="pool-input"
                      value={newInvestor}
                      onChange={(e) => setNewInvestor(e.target.value)}
                      placeholder="0x… alamat investor"
                      aria-label="Alamat investor baru"
                    />
                    <Button
                      variant="outline"
                      disabled={
                        actionBusy ||
                        data.legacyPositionOnly ||
                        !isTestnetWallet ||
                        !position?.adminAllowed
                      }
                      onClick={grantInvestor}
                    >
                      Beri izin onchain
                    </Button>
                  </div>
                  <div>
                    <h3>Periksa invoice sebelum alokasi</h3>
                    <p>
                      Pilih invoice terdaftar atau tempel claim key. Kelayakan
                      diperiksa ulang oleh kontrak saat transaksi.
                    </p>
                    {registeredClaims.data?.items.length ? (
                      <div
                        className="pool-claim-options"
                        aria-label="Invoice terdaftar"
                      >
                        {registeredClaims.data.items.map((claim) => (
                          <button
                            type="button"
                            key={claim.id}
                            onClick={() => {
                              setClaimKey(claim.claimKey);
                              setCandidateKey(claim.claimKey);
                            }}
                            disabled={actionBusy}
                          >
                            <span>
                              <strong>{claim.invoiceNumber}</strong>
                              <small>
                                {claim.organizationName ?? "Invoice terdaftar"}
                              </small>
                            </span>
                            <span>
                              Rp {money(claim.terms.principal)}{" "}
                              <ArrowRight size={13} />
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : registeredClaims.isError ? (
                      <Link href="/admin/claims" className="pool-view-link">
                        Daftar invoice aplikasi <ArrowRight size={13} />
                      </Link>
                    ) : null}
                    {!registeredClaims.isError && (
                      <Link href="/admin/claims" className="pool-view-link">
                        Lihat semua pengajuan <ArrowRight size={13} />
                      </Link>
                    )}
                    <div className="pool-inline-form">
                      <input
                        className="pool-input"
                        value={claimKey}
                        onChange={(e) => {
                          setClaimKey(e.target.value);
                          setCandidateKey("");
                        }}
                        placeholder="0x… claim key"
                        aria-label="Claim key invoice"
                      />
                      <Button
                        variant="outline"
                        disabled={
                          !/^0x[0-9a-fA-F]{64}$/.test(claimKey) || actionBusy
                        }
                        onClick={() => setCandidateKey(claimKey.trim())}
                      >
                        Periksa
                      </Button>
                    </div>
                    {candidate.isError && (
                      <p className="field-error">
                        Claim key belum terdaftar atau RPC belum merespons.
                      </p>
                    )}
                    {candidate.data &&
                      candidate.data.claimKey.toLowerCase() ===
                        claimKey.trim().toLowerCase() && (
                        <div className="pool-candidate">
                          <p>
                            Pokok{" "}
                            <strong>
                              Rp {money(candidate.data.principal)}
                            </strong>{" "}
                            · biaya kontraktual{" "}
                            <strong>Rp {money(candidate.data.fee)}</strong>
                          </p>
                          <p>Jatuh tempo {formatDate(candidate.data.dueAt)}</p>
                          <small>
                            Fee menjadi aset pool setelah buyer benar-benar
                            membayar. Tidak ada hasil investor yang dijamin.
                          </small>
                          <p>
                            {candidate.data.canAllocate
                              ? "Memenuhi batas pool saat blok terakhir dibaca."
                              : candidate.data.reasons.join(" ")}
                          </p>
                          <small>
                            Dicek pada blok {candidate.data.blockNumber} ·{" "}
                            {formatDate(candidate.data.blockTime, true)} WIB
                          </small>
                          <Button
                            disabled={
                              !candidate.data.canAllocate ||
                              actionBusy ||
                              !isTestnetWallet ||
                              !position?.allocatorAllowed ||
                              data.controls.allocationsPaused ||
                              data.legacyPositionOnly
                            }
                            onClick={fund}
                          >
                            Danai invoice dari pool
                          </Button>
                        </div>
                      )}
                  </div>
                </div>
              </section>
            )}
          {actionError && (
            <div className="pool-feedback" role="alert">
              <div className="danger-callout p-3">{actionError}</div>
              {lastTx && (
                <a
                  className="pool-tx-notice"
                  href={txUrl(lastTx)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Transaksi terakhir {shortAddress(lastTx)}{" "}
                  <ExternalLink size={14} />
                </a>
              )}
              <button
                type="button"
                onClick={() => {
                  setActionError(null);
                  setLastTx(null);
                }}
              >
                Tutup
              </button>
            </div>
          )}
          {!actionError && transactionStatus && (
            <div className="pool-feedback" role="status">
              <p className="pool-transaction-status">
                {actionBusy && (
                  <RefreshCw size={14} className="loading-spinner" />
                )}{" "}
                {transactionStatus}
              </p>
              {lastTx && (
                <a
                  className="pool-tx-notice"
                  href={txUrl(lastTx)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Bukti {shortAddress(lastTx)} <ExternalLink size={14} />
                </a>
              )}
              {!actionBusy && (
                <button
                  type="button"
                  onClick={() => {
                    setTransactionStatus(null);
                    setLastTx(null);
                  }}
                >
                  Tutup
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
