import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: [
      "@rainbow-me/rainbowkit",
      "@rainbow-me/rainbowkit/wallets",
      "wagmi",
      "wagmi/connectors",
      "@wagmi/connectors",
    ],
  },
  serverExternalPackages: ["postgres", "pg-boss", "pdfjs-dist"],
  poweredByHeader: false,
  devIndicators: false,
};
export default nextConfig;
