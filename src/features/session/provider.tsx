"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

type BrowserWallet = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
};
declare global {
  interface Window {
    ethereum?: BrowserWallet;
  }
}
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
function getProvider() {
  if (!window.ethereum) throw new Error("WALLET_UNAVAILABLE");
  return window.ethereum;
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

function SessionState({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
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
  const logout = useCallback(async () => {
    setLocallyLocked(true);
    await queryClient.cancelQueries();
    queryClient.clear();
    queryClient.setQueryData(["session"], null);
    setWalletStatus("idle");
    try {
      await api.logout();
      setError(null);
    } catch (error) {
      setError(
        "Sesi lokal dikunci. Pencabutan sesi server belum berhasil; coba keluar kembali setelah koneksi pulih.",
      );
      throw error;
    }
  }, [api, queryClient]);
  const connect = useCallback(async () => {
    setError(null);
    setWalletStatus("connecting");
    try {
      const cfg = config ?? (await api.config());
      if (redirectToConfiguredOrigin(cfg.appOrigin)) {
        setWalletStatus("idle");
        return;
      }
      const provider = getProvider();
      const accounts = await provider.request({
        method: "eth_requestAccounts",
      });
      const address = accounts[0];
      if (!address) throw new Error("WALLET_UNAVAILABLE");
      const currentChain = await provider.request({ method: "eth_chainId" });
      if (Number.parseInt(currentChain, 16) !== cfg.chainId) {
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${cfg.chainId.toString(16)}` }],
          });
        } catch (e) {
          if ((e as { code?: number }).code !== 4902) throw e;
          const chain = cfg.chainId === 97 ? bscTestnet : anvil;
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: `0x${cfg.chainId.toString(16)}`,
                chainName: chain.name,
                nativeCurrency: chain.nativeCurrency,
                rpcUrls: [
                  cfg.chainId === 97
                    ? "https://bsc-testnet-rpc.publicnode.com"
                    : "http://127.0.0.1:8545",
                ],
                ...(cfg.chainId === 97
                  ? { blockExplorerUrls: ["https://testnet.bscscan.com"] }
                  : {}),
              },
            ],
          });
        }
      }
      if (
        Number.parseInt(
          await provider.request({ method: "eth_chainId" }),
          16,
        ) !== cfg.chainId
      )
        throw new Error("WRONG_CHAIN");
      const issued = await api.challenge(address, cfg.chainId);
      setWalletStatus("signing");
      const wallet = createWalletClient({
        transport: custom(provider),
        chain: cfg.chainId === 97 ? bscTestnet : anvil,
      });
      const signature = await wallet.signMessage({
        account: address,
        message: issued.message,
      });
      await api.verify(issued.challengeId, issued.message, signature);
      const me = await api.me();
      await queryClient.cancelQueries();
      queryClient.clear();
      queryClient.setQueryData(["public-config"], cfg);
      queryClient.setQueryData(["session"], me);
      setLocallyLocked(false);
      setWalletStatus("ready");
    } catch (e) {
      const normalized = walletError(e);
      setError(explainError(normalized));
      setWalletStatus("idle");
      throw normalized;
    }
  }, [api, config, queryClient]);
  const getSigningWallet = useCallback(async () => {
    if (!user || !config) throw new Error("WALLET_CHANGED");
    const provider = getProvider();
    const [accounts, chain] = await Promise.all([
      provider.request({ method: "eth_accounts" }),
      provider.request({ method: "eth_chainId" }),
    ]);
    if (!accounts[0] || accounts[0].toLowerCase() !== user.wallet.toLowerCase())
      throw new Error("WALLET_CHANGED");
    if (Number.parseInt(chain, 16) !== config.chainId)
      throw new Error("WRONG_CHAIN");
    return createWalletClient({
      account: user.wallet,
      chain: config.chainId === 97 ? bscTestnet : anvil,
      transport: custom(provider),
    });
  }, [user, config]);
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
    const provider = window.ethereum;
    if (!provider?.on) return;
    const invalidate = () => {
      if (user) void logout().catch(() => undefined);
    };
    provider.on("accountsChanged", invalidate);
    provider.on("chainChanged", invalidate);
    return () => {
      provider.removeListener?.("accountsChanged", invalidate);
      provider.removeListener?.("chainChanged", invalidate);
    };
  }, [user, logout]);
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
  const value = useMemo<Session>(
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
      connect,
      logout,
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
      connect,
      logout,
      signConsent,
      sendTransaction,
    ],
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
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
        <SessionState>{children}</SessionState>
      </MotionConfig>
    </QueryClientProvider>
  );
}
