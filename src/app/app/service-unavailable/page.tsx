import { CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ServiceUnavailable() {
  return (
    <section className="surface mx-auto my-12 max-w-xl p-8" role="alert">
      <CircleAlert size={26} className="text-primary" aria-hidden="true" />
      <p className="text-kicker mt-5">KONEKSI LAYANAN</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Data Talunai belum dapat dimuat.
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Layanan data sedang tidak tersedia. Coba buka ulang setelah koneksi
        pulih. Jika Anda baru mengirim transaksi, periksa statusnya di wallet
        sebelum mengirim lagi.
      </p>
      <Button className="mt-6" asChild>
        <a href="/app">
          <RefreshCw size={15} aria-hidden="true" />
          Coba lagi
        </a>
      </Button>
    </section>
  );
}
