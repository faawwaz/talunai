import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { RouteProviders } from "@/features/session/route-providers";
import "./globals.css";
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_ORIGIN ?? "http://localhost:3000"),
  title: {
    default: "Talunai · Ruang kerja pembiayaan",
    template: "%s · Talunai",
  },
  description:
    "Ruang kerja pembiayaan invoice perdagangan B2B. MVP testnet dengan dokumen dan dana simulasi.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={manrope.variable}>
      <body>
        <RouteProviders>{children}</RouteProviders>
      </body>
    </html>
  );
}
