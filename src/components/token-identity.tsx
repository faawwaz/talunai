"use client";

import { ExternalLink, Info } from "lucide-react";
import Image from "next/image";
import { useSession } from "@/features/session/provider";
import { explorerUrl } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

/** Show the testnet denomination while keeping the onchain token identity inspectable. */
export function TokenIdentity({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { config } = useSession();
  const address = config?.contracts.token;
  const explorer =
    address && config
      ? explorerUrl(config.chainId, "address", address)
      : undefined;
  return (
    <Dialog>
      <DialogTrigger
        className={cn(
          "inline-flex min-h-10 items-center gap-2 rounded-lg px-1 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          className,
        )}
        aria-label="IDRT uji — lihat detail kontrak token"
      >
        <Image
          src="/idrt-logo.svg"
          width={26}
          height={26}
          alt=""
          aria-hidden="true"
          className={cn("shrink-0 rounded-full", compact && "size-[22px]")}
        />
        <span className="font-semibold">IDRT</span>
        <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">
          Uji
        </span>
        <Info
          size={13}
          className="ml-1 text-muted-foreground"
          aria-hidden="true"
        />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>IDRT uji di TALUNAI</DialogTitle>
          <DialogDescription>
            Satuan ini dipakai untuk simulasi pembiayaan di BSC Testnet.
            Transaksi menggunakan kontrak MockIDR milik TALUNAI, bukan IDRT
            resmi. Token uji tidak bernilai rupiah dan tidak dapat ditebus.
          </DialogDescription>
        </DialogHeader>
        <dl className="my-6 divide-y divide-border text-sm">
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted-foreground">Token onchain</dt>
            <dd className="font-medium">MockIDR · 0 desimal</dd>
          </div>
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted-foreground">Jaringan</dt>
            <dd className="font-medium">
              {config
                ? config.chainId === 97
                  ? "BSC Testnet · 97"
                  : "Anvil · 31337"
                : "Belum terhubung"}
            </dd>
          </div>
          <div className="py-3">
            <dt className="text-muted-foreground">
              Alamat token yang digunakan
            </dt>
            <dd className="mt-2 break-all font-mono text-xs leading-6">
              {address ?? "Konfigurasi belum tersedia"}
            </dd>
          </div>
        </dl>
        {explorer && (
          <a
            href={explorer}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary"
          >
            Lihat kontrak <ExternalLink size={14} />
          </a>
        )}
        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          Logo IDRT menjadi acuan visual satuan uji. TALUNAI tidak berafiliasi
          dengan penerbit IDRT; token ini tidak memiliki cadangan atau jaminan
          pengembalian.
        </p>
      </DialogContent>
    </Dialog>
  );
}
