"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createWalletClient,
  custom,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { anvil, bscTestnet } from "viem/chains";
import { MotionConfig } from "motion/react";
import {
  createAuthenticationAdapter,
  RainbowKitAuthenticationProvider,
  RainbowKitProvider,
  useAccountModal,
  useConnectModal,
  useChainModal,
} from "@rainbow-me/rainbowkit";
import { WagmiProvider, useAccount, useConfig } from "wagmi";
import { disconnect, getAccount } from "wagmi/actions";
import { createWalletConfig, walletTheme } from "./wallet-config";
import "@rainbow-me/rainbowkit/styles.css";
import "./wallet.css";
import {
  TalunaiClient,
  TalunaiApiError,
  type Claim,
  type CurrentUser,
  type PublicConfig,
  type TransactionTemplate,
} from "../../../packages/client";
import { explainError } from "@/lib/format";
import {
  assertConsentPayload,
  assertTransactionPayload,
  type TransactionContext,
} from "@/lib/wallet-guards";

type WalletStatus = "idle" | "connecting" | "signing" | "sending" | "ready";
type Session = {
  api: TalunaiClient;
  config?: PublicConfig;
  user: CurrentUser | null;
  status: "loading" | "anonymous" | "authenticated";
  walletStatus: WalletStatus;
  error: string | null;
  connect: () => Promise<void>;
  logout: () => Promise<void>;
  manageWallet: () => void;
  getWalletProvider: () => Promise<EIP1193Provider>;
  signConsent: (
    typedData: Record<string, unknown>,
    claim: Claim,
  ) => Promise<Hex>;
  sendTransaction: (
    transaction: TransactionTemplate,
    context: TransactionContext,
  ) => Promise<Hex>;
};
const SessionContext = createContext<Session | null>(null);
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SESSION_PROVIDER_REQUIRED");
  return value;
}
function walletError(error: unknown): Error {
  let current: unknown = error;
  for (let i = 0; i < 5 && current && typeof current === "object"; i++) {
    const e = current as { code?: number; cause?: unknown };
    if (e.code === 4001) return new Error("WALLET_REJECTED");
    current = e.cause;
  }
  return error instanceof Error ? error : new Error("WALLET_REQUEST_FAILED");
}
function redirectToConfiguredOrigin(origin?: string) {
  if (!origin || typeof window === "undefined") return false;
  const canonical = new URL(origin).origin;
  if (window.location.origin === canonical) return false;
  window.location.replace(
    `${canonical}${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
  return true;
}

function WalletAvatar({ address, size }: { address: string; size: number }) {
  return (
    <span
      aria-hidden="true"
      className="talunai-wallet-avatar"
      style={{ width: size, height: size, fontSize: size * 0.3 }}
    >
      {address.slice(2, 4).toUpperCase()}
    </span>
  );
}

function SessionState({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const wagmiConfig = useConfig();
  const account = useAccount();
  const generation = useRef(0);
  const pendingChallenge = useRef<{
    challengeId: string;
    message: string;
    address: string;
    generation: number;
  } | null>(null);
  const signingOut = useRef<Promise<void> | null>(null);
  const [api] = useState(() => new TalunaiClient(""));
  const [walletStatus, setWalletStatus] = useState<WalletStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [locallyLocked, setLocallyLocked] = useState(false);
  const configQuery = useQuery({
    queryKey: ["public-config"],
    queryFn: () => api.config(),
    staleTime: 60_000,
    retry: 1,
  });
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        if (e instanceof TalunaiApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const user = locallyLocked ? null : (sessionQuery.data ?? null);
  const config = configQuery.data;
  useEffect(() => {
    redirectToConfiguredOrigin(config?.appOrigin);
  }, [config?.appOrigin]);
  const clearPrivateQueries = useCallback(async () => {
    await queryClient.cancelQueries({
      predicate: (q) => q.queryKey[0] !== "public-config",
    });
    queryClient.removeQueries({
      predicate: (q) =>
        q.queryKey[0] !== "public-config" && q.queryKey[0] !== "session",
    });
    queryClient.setQueryData(["session"], null);
  }, [queryClient]);
  const revokeSession = useCallback(() => {
    if (signingOut.current) return signingOut.current;
    generation.current++;
    pendingChallenge.current = null;
    setLocallyLocked(true);
    setWalletStatus("idle");
    signingOut.current = (async () => {
      await clearPrivateQueries();
      try {
        await api.logout();
        setError(null);
      } catch (error) {
        setError(
          "Sesi lokal dikunci. Pencabutan sesi server belum berhasil; coba keluar kembali setelah koneksi pulih.",
        );
        throw error;
      } finally {
        signingOut.current = null;
      }
    })();
    return signingOut.current;
  }, [api, clearPrivateQueries]);
  const logout = useCallback(async () => {
    // Start revocation before disconnecting; RainbowKit's onDisconnect reuses it.
    const revoke = revokeSession();
    await Promise.all([revoke, disconnect(wagmiConfig)]);
  }, [revokeSession, wagmiConfig]);
  const authenticationAdapter = useMemo<
    ReturnType<typeof createAuthenticationAdapter<string>>
  >(
    () => ({
      // The backend creates and validates the nonce inside the exact SIWE message.
      getNonce: async () => "server-issued",
      createMessage: async ({ address, chainId }) => {
        setError(null);
        try {
          if (signingOut.current) await signingOut.current;
          const cfg = config ?? (await api.config());
          if (redirectToConfiguredOrigin(cfg.appOrigin))
            throw new Error("WALLET_CHANGED");
          if (chainId !== cfg.chainId) throw new Error("WRONG_CHAIN");
          const attempt = ++generation.current;
          const issued = await api.challenge(address, cfg.chainId);
          if (attempt !== generation.current) throw new Error("WALLET_CHANGED");
          pendingChallenge.current = {
            ...issued,
            address,
            generation: attempt,
          };
          return issued.message;
        } catch (error) {
          setError(explainError(walletError(error)));
          throw error;
        }
      },
      verify: async ({ message, signature }) => {
        const issued = pendingChallenge.current;
        let verified = false;
        try {
          if (
            !issued ||
            issued.message !== message ||
            issued.generation !== generation.current
          )
            throw new Error("WALLET_CHANGED");
          const cfg = config ?? (await api.config());
          const current = getAccount(wagmiConfig);
          const provider = (await current.connector?.getProvider()) as
            EIP1193Provider | undefined;
          if (!provider) throw new Error("WALLET_UNAVAILABLE");
          const assertCurrentWallet = async () => {
            const [addresses, chain] = await Promise.all([
              provider.request({ method: "eth_accounts" }),
              provider.request({ method: "eth_chainId" }),
            ]);
            if (
              issued.generation !== generation.current ||
              getAccount(wagmiConfig).connector?.uid !==
                current.connector?.uid ||
              addresses[0]?.toLowerCase() !== issued.address.toLowerCase()
            )
              throw new Error("WALLET_CHANGED");
            if (Number(chain) !== cfg.chainId) throw new Error("WRONG_CHAIN");
          };
          await assertCurrentWallet();
          await api.verify(issued.challengeId, message, signature as Hex);
          verified = true;
          // Recheck after the network request: a changed account must not inherit
          // a cookie produced by an older signature still in flight.
          try {
            await assertCurrentWallet();
          } catch (error) {
            await revokeSession();
            throw error;
          }
          const me = await api.me();
          if (me.wallet.toLowerCase() !== issued.address.toLowerCase())
            throw new Error("WALLET_CHANGED");
          await clearPrivateQueries();
          await assertCurrentWallet();
          queryClient.setQueryData(["session"], me);
          pendingChallenge.current = null;
          setLocallyLocked(false);
          setWalletStatus("ready");
          return true;
        } catch (error) {
          if (verified) await revokeSession().catch(() => undefined);
          setError(explainError(walletError(error)));
          return false;
        }
      },
      // RainbowKit invokes this on disconnect / account change. Handle rejection
      // here because the library does not await this callback.
      signOut: async () => {
        await revokeSession().catch(() => undefined);
      },
    }),
    [api, config, clearPrivateQueries, queryClient, revokeSession, wagmiConfig],
  );
  const getWalletProvider = useCallback(async () => {
    if (!user || !config) throw new Error("WALLET_CHANGED");
    const provider = (await getAccount(
      wagmiConfig,
    ).connector?.getProvider()) as EIP1193Provider | undefined;
    if (!provider) throw new Error("WALLET_UNAVAILABLE");
    const [accounts, chain] = await Promise.all([
      provider.request({ method: "eth_accounts" }),
      provider.request({ method: "eth_chainId" }),
    ]);
    if (!accounts[0] || accounts[0].toLowerCase() !== user.wallet.toLowerCase())
      throw new Error("WALLET_CHANGED");
    if (Number.parseInt(chain, 16) !== config.chainId)
      throw new Error("WRONG_CHAIN");
    return provider;
  }, [user, config, wagmiConfig]);
  const getSigningWallet = useCallback(async () => {
    const provider = await getWalletProvider();
    if (!user || !config) throw new Error("WALLET_CHANGED");
    return createWalletClient({
      account: user.wallet,
      chain: config.chainId === 97 ? bscTestnet : anvil,
      transport: custom(provider),
    });
  }, [user, config, getWalletProvider]);
  const signConsent = useCallback(
    async (typedData: Record<string, unknown>, claim: Claim) => {
      setError(null);
      setWalletStatus("signing");
      try {
        if (!config || !user) throw new Error("WALLET_CHANGED");
        assertConsentPayload(typedData, claim, user, config);
        const wallet = await getSigningWallet();
        return await wallet.signTypedData(
          typedData as unknown as Parameters<typeof wallet.signTypedData>[0],
        );
      } catch (e) {
        throw walletError(e);
      } finally {
        setWalletStatus("ready");
      }
    },
    [config, user, getSigningWallet],
  );
  const sendTransaction = useCallback(
    async (transaction: TransactionTemplate, context: TransactionContext) => {
      setError(null);
      setWalletStatus("sending");
      try {
        if (!config || !user) throw new Error("WALLET_CHANGED");
        assertTransactionPayload(transaction, context, user, config);
        const wallet = await getSigningWallet();
        return await wallet.sendTransaction({
          to: transaction.to,
          data: transaction.data,
          value: 0n,
        });
      } catch (e) {
        throw walletError(e);
      } finally {
        setWalletStatus("ready");
      }
    },
    [config, user, getSigningWallet],
  );
  useEffect(() => {
    if (account.status === "reconnecting" || account.status === "connecting")
      return;
    if (
      user &&
      account.isConnected &&
      (account.address.toLowerCase() !== user.wallet.toLowerCase() ||
        (config && account.chainId !== config.chainId))
    )
      void revokeSession().catch(() => undefined);
  }, [
    account.status,
    account.isConnected,
    account.address,
    account.chainId,
    user,
    config,
    revokeSession,
  ]);
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type === "updated" &&
          event.query.state.error instanceof TalunaiApiError &&
          event.query.state.error.status === 401 &&
          event.query.queryKey[0] !== "session"
        ) {
          setLocallyLocked(true);
          void queryClient.cancelQueries();
          queryClient.removeQueries({
            predicate: (q) => q.queryKey[0] !== "public-config",
          });
          queryClient.setQueryData(["session"], null);
        }
      }),
    [queryClient],
  );
  const value = useMemo<Omit<Session, "connect" | "manageWallet">>(
    () => ({
      api,
      config,
      user,
      status:
        !locallyLocked && sessionQuery.isPending
          ? "loading"
          : user
            ? "authenticated"
            : "anonymous",
      walletStatus,
      error:
        error ??
        (configQuery.error
          ? explainError(configQuery.error)
          : sessionQuery.error
            ? explainError(sessionQuery.error)
            : null),
      logout,
      getWalletProvider,
      signConsent,
      sendTransaction,
    }),
    [
      api,
      config,
      user,
      locallyLocked,
      sessionQuery.isPending,
      sessionQuery.error,
      configQuery.error,
      walletStatus,
      error,
      logout,
      getWalletProvider,
      signConsent,
      sendTransaction,
    ],
  );
  return (
    <RainbowKitAuthenticationProvider
      adapter={authenticationAdapter}
      status={
        !locallyLocked && sessionQuery.isPending
          ? "loading"
          : user
            ? "authenticated"
            : "unauthenticated"
      }
    >
      <RainbowKitProvider
        locale="id-ID"
        avatar={WalletAvatar}
        theme={walletTheme}
        modalSize="compact"
        initialChain={config?.chainId}
        appInfo={{ appName: "Talunai" }}
      >
        <SessionModals value={value}>{children}</SessionModals>
      </RainbowKitProvider>
    </RainbowKitAuthenticationProvider>
  );
}

function SessionModals({
  children,
  value,
}: {
  children: ReactNode;
  value: Omit<Session, "connect" | "manageWallet">;
}) {
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const { openChainModal } = useChainModal();
  const account = useAccount();
  const connect = useCallback(async () => {
    if (redirectToConfiguredOrigin(value.config?.appOrigin)) return;
    if (
      account.isConnected &&
      account.chainId !== value.config?.chainId &&
      openChainModal
    )
      openChainModal();
    else if (openConnectModal) openConnectModal();
    else openAccountModal?.();
  }, [
    account.isConnected,
    account.chainId,
    value.config,
    openChainModal,
    openConnectModal,
    openAccountModal,
  ]);
  const session = useMemo<Session>(
    () => ({
      ...value,
      connect,
      manageWallet: () => {
        if (openAccountModal) openAccountModal();
        else void connect();
      },
    }),
    [value, connect, openAccountModal],
  );
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}

function WalletNetwork({ children }: { children: ReactNode }) {
  const [api] = useState(() => new TalunaiClient(""));
  const config = useQuery({
    queryKey: ["public-config"],
    queryFn: () => api.config(),
    staleTime: 60_000,
    retry: 1,
  });
  const chainId = config.data?.chainId;
  const wagmiConfig = useMemo(
    () => (chainId ? createWalletConfig(chainId) : null),
    [chainId],
  );
  if (!wagmiConfig)
    return (
      <div
        className="wallet-bootstrap"
        role={config.error ? "alert" : "status"}
      >
        <p>
          {config.error ? "Koneksi belum tersedia" : "Menyiapkan workspace…"}
        </p>
        {config.error && (
          <button type="button" onClick={() => void config.refetch()}>
            Coba lagi
          </button>
        )}
      </div>
    );
  return (
    <WagmiProvider config={wagmiConfig}>
      <SessionState>{children}</SessionState>
    </WagmiProvider>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 10_000,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">
        <WalletNetwork>{children}</WalletNetwork>
      </MotionConfig>
    </QueryClientProvider>
  );
}
