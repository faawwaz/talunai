import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col items-start justify-center px-6 py-16">
      <Brand />
      <p className="mt-14 text-kicker">Halaman tidak ditemukan · 404</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">
        Kembali ke ruang kerja.
      </h1>
      <p className="mt-5 text-base leading-relaxed text-muted-foreground">
        Tautan ini tidak tersedia. Buka pengajuan dari workspace untuk melihat
        data yang dapat Anda akses.
      </p>
      <Link
        className="ui-button ui-button-primary ui-button-default mt-8"
        href="/app"
      >
        <ArrowLeft size={16} />
        Buka workspace
      </Link>
    </main>
  );
}
