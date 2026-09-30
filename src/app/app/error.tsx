"use client";
import Link from "next/link";
import { CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function WorkspaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="surface mx-auto my-12 max-w-xl p-8" role="alert">
      <CircleAlert size={26} className="text-primary" />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">
        Halaman belum dapat dimuat.
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Coba muat ulang. Jika Anda baru mengirim transaksi, periksa riwayatnya
        sebelum mengirim kembali.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={reset}>
          <RefreshCw size={15} />
          Coba lagi
        </Button>
        <Button variant="outline" asChild>
          <Link href="/app">Kembali ke ringkasan</Link>
        </Button>
      </div>
    </section>
  );
}
