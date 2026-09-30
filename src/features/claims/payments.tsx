"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CircleHelp,
  LockKeyhole,
} from "lucide-react";
import { useSession } from "@/features/session/provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { money } from "@/lib/format";
import type { Claim } from "../../../packages/client";
import {
  DetailFacts,
  InlineError,
  SectionTitle,
  SyntheticNote,
  useClaimRoles,
} from "./shared";
import { useClaimOperations } from "./operations";

export function ClaimPayments({ claim }: { claim: Claim }) {
  const { api, user } = useSession();
  const roles = useClaimRoles(claim);
  const operations = useClaimOperations(claim);
  const [collectionAmount, setCollectionAmount] = useState("");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const interval = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      30_000,
    );
    return () => window.clearInterval(interval);
  }, []);
  const fundingExpired =
    Math.min(
      claim.terms.fundingDeadline,
      claim.terms.reviewExpiry,
      claim.terms.consentExpiry,
    ) <= now;
  const financing = useQuery({
    queryKey: ["financing", claim.id],
    queryFn: () => api.financing(claim.id),
    refetchInterval: (query) =>
      query.state.dataUpdateCount < 60 ? 10000 : false,
  });
  if (financing.isPending) return <LoadingState />;
  if (financing.error || !financing.data)
    return (
      <InlineError
        error={financing.error}
        onRefresh={() => void financing.refetch()}
      />
    );
  const state = financing.data;
  const confirmed = state.stateConfidence === "CONFIRMED_PROJECTION";
  const funded = state.financingStatus !== "UNFUNDED";
  const isDealLender =
    roles.lender && state.lender?.toLowerCase() === user?.wallet.toLowerCase();
  const amountValid =
    /^[1-9]\d{0,77}$/.test(collectionAmount) &&
    BigInt(collectionAmount) <= BigInt(state.remainingInvoiceCollection);
  const collectedPercent =
    BigInt(state.acceptedOutstanding) > 0n
      ? Number(
          (BigInt(state.totalCollected) * 10000n) /
            BigInt(state.acceptedOutstanding),
        ) / 100
      : 0;
  const buyerCanPay =
    roles.buyer && funded && BigInt(state.remainingInvoiceCollection) > 0n;
  const lenderCanWithdraw =
    isDealLender && funded && BigInt(state.lenderClaimable) > 0n;
  const borrowerCanWithdraw =
    roles.borrower && BigInt(state.borrowerResidualClaimable) > 0n;
  const showPaymentActions =
    (roles.lender && !funded) ||
    buyerCanPay ||
    lenderCanWithdraw ||
    borrowerCanWithdraw;
  return (
    <div className="space-y-7">
      {operations.feedback}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${confirmed ? "bg-primary" : state.indexerDegraded ? "bg-amber-600" : "bg-muted-foreground"}`}
            aria-hidden="true"
          />
          <span className="font-medium">
            {confirmed
              ? "Pembukuan onchain terkonfirmasi"
              : state.indexerDegraded
                ? "Sinkronisasi chain tertunda"
                : "Menunggu proyeksi onchain"}
          </span>
        </div>
        {(state.blockNumber ?? state.confirmedBlock) && (
          <span className="tabular-nums text-muted-foreground">
            Blok #{state.blockNumber ?? state.confirmedBlock}
          </span>
        )}
      </div>
      {!confirmed && (
        <div className="info-callout text-sm">
          {state.stateConfidence === "DEGRADED_LAST_CONFIRMED_PROJECTION"
            ? "Indexer sedang degraded. Tampilan menggunakan pembukuan terakhir yang terkonfirmasi; pendanaan baru dibatasi."
            : "Belum ada proyeksi chain yang terkonfirmasi. Nominal awal berasal dari ketentuan; tidak ada pembayaran yang dianggap diterima."}
        </div>
      )}
      {(state.financingOverdue || state.invoiceOverdue) && (
        <div className="danger-callout text-sm">
          <p className="font-semibold">
            {state.financingOverdue
              ? "Hak lender masih outstanding setelah jatuh tempo"
              : "Invoice melewati jatuh tempo"}
          </p>
          <p className="mt-1 leading-relaxed">
            Status mengikuti waktu chain terkonfirmasi. Sisa tagihan invoice{" "}
            {money(state.remainingInvoiceCollection)} IDRT uji
            {state.lenderOutstanding !== undefined
              ? `; hak lender belum tertutup ${money(state.lenderOutstanding)} IDRT uji`
              : ""}
            . Pembayaran terlambat dicatat saat benar-benar diterima.
          </p>
        </div>
      )}
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_350px]">
        <section className="surface p-6 sm:p-7">
          <SectionTitle
            title="Collection invoice"
            description="Hanya pembayaran buyer melalui kontrak yang mengurangi outstanding."
            action={<StatusBadge status={state.collectionStatus} />}
          />
          <div className="mb-7 mt-7">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Sudah diterima</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                  {money(state.totalCollected)}
                </p>
              </div>
              <p className="pb-0.5 text-xs text-muted-foreground">
                dari {money(state.acceptedOutstanding)}
              </p>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-label="Collection invoice terkonfirmasi"
              aria-valuenow={collectedPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${collectedPercent}%` }}
              />
            </div>
          </div>
          <DetailFacts
            items={[
              {
                label: "Sisa tagihan invoice",
                value: money(state.remainingInvoiceCollection),
              },
              {
                label: "Dialokasikan ke lender",
                value:
                  state.lenderAllocated !== undefined
                    ? money(state.lenderAllocated)
                    : "—",
              },
              ...(state.lenderOutstanding !== undefined
                ? [
                    {
                      label: "Hak lender belum tertutup",
                      value: money(state.lenderOutstanding),
                    },
                  ]
                : []),
              {
                label: "Lender sudah menarik",
                value: money(state.lenderWithdrawn),
              },
              {
                label: "Lender dapat menarik",
                value: money(state.lenderClaimable),
              },
              {
                label: "Sisa collection untuk borrower",
                value: money(state.borrowerResidualClaimable),
              },
            ]}
          />
          <div className="mt-5">
            <SyntheticNote />
          </div>
        </section>
        <aside className="space-y-6">
          <section className="surface p-6">
            <SectionTitle
              title="Pembiayaan"
              action={<StatusBadge status={state.financingStatus} />}
            />
            <DetailFacts
              items={[
                { label: "Principal", value: money(claim.terms.principal) },
                { label: "Fee flat", value: money(claim.terms.fee) },
                {
                  label: "Total hak lender",
                  value: money(
                    (
                      BigInt(claim.terms.principal) + BigInt(claim.terms.fee)
                    ).toString(),
                  ),
                },
              ]}
            />
            <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <CircleHelp size={15} className="mt-0.5 shrink-0" />
              Pembiayaan lunas, invoice tertagih penuh, dan saldo ditarik
              merupakan peristiwa yang berbeda.
            </p>
            {roles.buyer && !funded && (
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Pembayaran tersedia setelah pendanaan. Pengakuan buyer ada di
                tab Ketentuan.
              </p>
            )}
            {roles.lender && funded && !isDealLender && (
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Hak penarikan invoice ini dimiliki wallet pendana yang tercatat.
              </p>
            )}
          </section>
          <div className="px-1">
            <h3 className="text-sm font-semibold">Urutan alokasi</h3>
            <ol className="mt-4 space-y-3 text-sm text-muted-foreground">
              {[
                "Principal lender",
                "Fee tetap lender",
                "Residual borrower",
              ].map((item, index) => (
                <li key={item} className="flex items-center gap-3">
                  <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-xs text-primary">
                    {index + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
      {showPaymentActions && (
        <section className="surface p-6 sm:p-7">
          <SectionTitle
            title="Tindakan pembayaran"
            description="Tinjau nominal dan penerima sebelum tanda tangan wallet."
          />
          {roles.lender && !funded && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold">
                  Danai principal {money(claim.terms.principal)}
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Dana ditarik dari lender dan dicairkan tepat ke borrower dalam
                  satu transaksi. Persetujuan token dilakukan terpisah dengan
                  nominal terbatas.
                </p>
              </div>
              {claim.fundingHold || claim.hasDispute ? (
                <p className="flex items-center gap-2 text-sm text-amber-800">
                  <LockKeyhole size={16} />
                  Hold atau dispute menghalangi pendanaan baru.
                </p>
              ) : fundingExpired ? (
                <p className="text-sm text-amber-800">
                  Batas pendanaan, review, atau consent telah berakhir.
                  Ketentuan yang sudah terdaftar tidak dapat diperpanjang;
                  pendanaan baru diblokir.
                </p>
              ) : claim.workflow !== "REGISTERED" ? (
                <p className="text-sm text-muted-foreground">
                  Menunggu registrasi piutang terkonfirmasi.
                </p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    disabled={operations.busy || !confirmed}
                    onClick={() =>
                      operations.prepare({
                        kind: "transaction",
                        action: "APPROVE_TOKEN",
                        amount: claim.terms.principal,
                      })
                    }
                  >
                    1. Tinjau izin token
                  </Button>
                  <Button
                    disabled={operations.busy || !confirmed}
                    onClick={() =>
                      operations.prepare({
                        kind: "transaction",
                        action: "FUND",
                      })
                    }
                  >
                    2. Tinjau pendanaan
                    <ArrowUpRight size={16} />
                  </Button>
                </div>
              )}
            </div>
          )}
          {buyerCanPay && (
            <div className="max-w-2xl space-y-4">
              <div className="field-group">
                <Label htmlFor="collection-amount">
                  Nominal pembayaran buyer
                </Label>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Input
                    id="collection-amount"
                    inputMode="numeric"
                    value={collectionAmount}
                    onChange={(event) =>
                      setCollectionAmount(event.target.value)
                    }
                    placeholder="Nominal utuh IDRT uji"
                    className="tabular-nums"
                  />
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setCollectionAmount(state.remainingInvoiceCollection)
                    }
                    disabled={BigInt(state.remainingInvoiceCollection) === 0n}
                  >
                    Isi sisa tagihan
                  </Button>
                </div>
                <p className="field-hint">
                  Maksimal {money(state.remainingInvoiceCollection)}. Pembayaran
                  sebagian didukung.
                </p>
                {collectionAmount && !amountValid && (
                  <p role="alert" className="text-xs text-red-700">
                    Masukkan nominal positif yang tidak melebihi sisa invoice.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  disabled={!amountValid || operations.busy || !confirmed}
                  onClick={() =>
                    operations.prepare({
                      kind: "transaction",
                      action: "APPROVE_TOKEN",
                      amount: collectionAmount,
                    })
                  }
                >
                  1. Tinjau izin token
                </Button>
                <Button
                  disabled={!amountValid || operations.busy || !confirmed}
                  onClick={() =>
                    operations.prepare({
                      kind: "transaction",
                      action: "COLLECT_BUYER_PAYMENT",
                      amount: collectionAmount,
                    })
                  }
                >
                  2. Tinjau pembayaran
                  <ArrowUpRight size={16} />
                </Button>
              </div>
            </div>
          )}
          {lenderCanWithdraw && (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  Saldo lender yang sudah menjadi hak penarikan
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {money(state.lenderClaimable)}
                </p>
              </div>
              <Button
                disabled={operations.busy || !confirmed}
                onClick={() =>
                  operations.prepare({
                    kind: "transaction",
                    action: "WITHDRAW_LENDER",
                  })
                }
              >
                <ArrowDownLeft size={16} />
                Tinjau penarikan lender
              </Button>
            </div>
          )}
          {borrowerCanWithdraw && (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  Residual collection yang dapat ditarik borrower
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {money(state.borrowerResidualClaimable)}
                </p>
                <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
                  Saldo residual terbentuk setelah pembayaran buyer mencukupi
                  principal dan fee lender. Pencairan principal saat funding
                  adalah transaksi terpisah.
                </p>
              </div>
              <Button
                disabled={operations.busy || !confirmed}
                onClick={() =>
                  operations.prepare({
                    kind: "transaction",
                    action: "WITHDRAW_BORROWER",
                  })
                }
              >
                <ArrowDownLeft size={16} />
                Tinjau penarikan residual
              </Button>
            </div>
          )}
        </section>
      )}
      {operations.dialog}
    </div>
  );
}
