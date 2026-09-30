import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import { LandingPage } from "@/features/landing/page";

const editorial = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-editorial",
  display: "swap",
});

const title = "Talunai — Modal lebih awal dari invoice bisnis";
const description =
  "Talunai membantu bisnis memperoleh modal lebih awal dari invoice B2B yang telah dikonfirmasi pembeli. Jelajahi alur pembiayaan di BNB Chain Testnet.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title,
    description,
    type: "website",
    locale: "id_ID",
    siteName: "Talunai",
    url: "/",
    images: [
      {
        url: "/landing/talunai-og.png",
        width: 1200,
        height: 630,
        alt: "Talunai. Tagihan belum cair. Usaha tetap berjalan. Versi BNB Chain Testnet.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/landing/talunai-og.png"],
  },
};

export default function Home() {
  return <LandingPage className={editorial.variable} />;
}
