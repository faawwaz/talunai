import type { Metadata } from "next";
import Link from "next/link";
import { readDemoCase } from "@/features/demo/case";
import { GuidedDemo } from "@/features/demo/experience";
import { Brand } from "@/components/brand";
import "@/features/demo/demo.css";

export const metadata: Metadata = {
  title: "Demo Produk",
  description:
    "Ikuti satu invoice Talunai dari pengakuan buyer, pemeriksaan, dan pendanaan hingga pembagian dana. Tanpa login.",
  alternates: { canonical: "/demo" },
};
export default function DemoPage() {
  const data = readDemoCase();
  if (!data)
    return (
      <main className="demo-unavailable">
        <Brand />
        <h1>Demo sedang disiapkan kembali.</h1>
        <p>
          Bukti case belum lengkap. Kamu tetap bisa membuka aplikasi Talunai.
        </p>
        <Link href="/app">Buka Aplikasi →</Link>
        <Link href="/">Kembali ke beranda</Link>
      </main>
    );
  return <GuidedDemo data={data} />;
}
