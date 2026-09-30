import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "pg-boss", "pdfjs-dist"],
  poweredByHeader: false,
  devIndicators: false,
};
export default nextConfig;
