import { connectorsForWallets, lightTheme } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { anvil, bscTestnet } from "viem/chains";

// Compatibility pins in package.json are intentional: cuer requires a QR
// encoder that accepts border: 0 (0.5.5), and wagmi's Base connector imports
// CDP's optional x402 peers during a Next/Turbopack build. Test the QR modal
// and build:web before changing them. Talunai does not enable x402 payments.

// Public Reown identifier, inlined by Next at build time. Never use a server key.
export const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";

const browserWallet: typeof injectedWallet = () => ({
  ...injectedWallet(),
  name: "Wallet browser",
  hidden: () => typeof window === "undefined" || !("ethereum" in window),
});

export function createWalletConfig(chainId: 97 | 31337) {
  const chain =
    chainId === 97
      ? {
          ...bscTestnet,
          iconUrl: "/brand/bnb-symbol.svg",
          iconBackground: "#F0B90B",
        }
      : anvil;
  return createConfig({
    chains: [chain],
    connectors: connectorsForWallets(
      [
        {
          groupName: "Hubungkan wallet",
          // No placeholder Project ID: injected / EIP-6963 wallets remain usable
          // without Reown. Mobile QR connections are enabled with a real ID.
          wallets: walletConnectProjectId
            ? [
                metaMaskWallet,
                okxWallet,
                rainbowWallet,
                trustWallet,
                walletConnectWallet,
                browserWallet,
              ]
            : [browserWallet],
        },
      ],
      {
        appName: "Talunai",
        appDescription:
          "Pembiayaan invoice B2B yang telah dikonfirmasi pembeli.",
        appUrl:
          typeof window === "undefined" ? undefined : window.location.origin,
        appIcon:
          typeof window === "undefined"
            ? undefined
            : `${window.location.origin}/icon.svg`,
        projectId: walletConnectProjectId,
      },
    ),
    transports: {
      97: http("https://bsc-testnet-rpc.publicnode.com"),
      31337: http("http://127.0.0.1:8545"),
    },
    multiInjectedProviderDiscovery: true,
    ssr: true,
  });
}

const baseTheme = lightTheme({
  accentColor: "#176653",
  accentColorForeground: "#FFFFFF",
  borderRadius: "medium",
  overlayBlur: "small",
});

export const walletTheme = {
  ...baseTheme,
  fonts: { body: "var(--font-manrope), Arial, sans-serif" },
  colors: {
    ...baseTheme.colors,
    modalBackground: "#F7F8F2",
    modalText: "#173B35",
    modalTextSecondary: "#62716B",
    modalTextDim: "#62716B",
    modalBorder: "#DCE5DC",
    generalBorder: "#DCE5DC",
    generalBorderDim: "#E7EFE7",
    actionButtonBorder: "#DCE5DC",
    actionButtonBorderMobile: "#DCE5DC",
    actionButtonSecondaryBackground: "#E7EFE7",
    closeButton: "#173B35",
    closeButtonBackground: "#E7EFE7",
    connectionIndicator: "#176653",
    menuItemBackground: "#E7EFE7",
    profileForeground: "#FFFFFF",
    profileAction: "#E7EFE7",
    profileActionHover: "#DCE8DC",
    modalBackdrop: "rgba(23, 59, 53, 0.28)",
  },
  shadows: {
    ...baseTheme.shadows,
    dialog: "0 24px 80px rgba(23, 59, 53, 0.16)",
    connectButton: "none",
  },
  radii: {
    ...baseTheme.radii,
    modal: "24px",
    modalMobile: "24px",
    actionButton: "12px",
    connectButton: "10px",
  },
};
