"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Radio } from "lucide-react";
import { useSession } from "@/features/session/provider";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { StatusBadge } from "@/components/status-badge";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { explorerUrl, formatDate, labelForStatus } from "@/lib/format";
import type { TransactionStatus } from "../../../packages/client";
import {
  OperatorGate,
  operatorClaimHref,
  OpsFailure,
  OpsPagination,
  OpsReload,
} from "./shared";

const txStatuses: Record<TransactionStatus, string> = {
  PREPARED: "Siap ditandatangani",
  SUBMITTED: "Dikirim",
  MINED: "Menunggu konfirmasi",
  CONFIRMED: "Terkonfirmasi",
  REVERTED: "Gagal (reverted)",
  REPLACED: "Diganti",
  DROPPED_OR_UNKNOWN: "Perlu rekonsiliasi",
};

export function AgentTransactionsPage() {
  return (
    <OperatorGate>
      <TransactionsContent />
    </OperatorGate>
  );
}

function TransactionsContent() {
  const { api, user, config } = useSession();
  const [status, setStatus] = useState<TransactionStatus | "">("");
  const [offset, setOffset] = useState(0);
  const transactions = useQuery({
    queryKey: ["ops-transactions", user?.userId, status, offset],
    queryFn: () =>
      api.opsTransactions({ status: status || undefined, offset, limit: 20 }),
  });
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operasional agent"
        title="Pemantauan transaksi"
        description="Bedakan template, pengiriman, receipt, dan hasil terkonfirmasi. Hash yang diterima belum menjadi bukti keberhasilan."
        actions={
          <OpsReload
            busy={transactions.isFetching}
            onClick={() => void transactions.refetch()}
          />
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="ops-tx-status">Status transaksi</Label>
        <Select
          id="ops-tx-status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as TransactionStatus | "");
            setOffset(0);
          }}
        >
          <option value="">Semua status</option>
          {Object.entries(txStatuses).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <section className="surface">
        {transactions.isPending ? (
          <LoadingState label="Memuat transaksi…" />
        ) : transactions.error ? (
          <div className="p-6">
            <OpsFailure
              error={transactions.error}
              retry={() => void transactions.refetch()}
            />
          </div>
        ) : !transactions.data?.items.length ? (
          <EmptyState
            icon={Radio}
            title="Belum ada transaksi pada tampilan ini"
            description="Intent yang dipersiapkan untuk pengajuan akan muncul di sini. Perubahan status mengikuti hasil rekonsiliasi sebenarnya."
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {transactions.data.items.map((tx) => {
                const explorer = tx.txHash
                  ? explorerUrl(config?.chainId, "tx", tx.txHash)
                  : undefined;
                return (
                  <li className="min-w-0 space-y-4 p-5 sm:p-6" key={tx.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          className="inline-flex items-center gap-2 text-sm font-semibold hover:text-primary"
                          href={operatorClaimHref(user, tx.claimId, "activity")}
                        >
                          {tx.invoiceNumber}
                          <ArrowRight size={14} aria-hidden="true" />
                        </Link>
                        <p className="mt-1.5 break-words text-xs text-muted-foreground">
                          {tx.organizationName}
                        </p>
                      </div>
                      <StatusBadge status={tx.status} />
                    </div>
                    <div className="grid min-w-0 gap-3 text-sm sm:grid-cols-[minmax(140px,0.65fr)_minmax(0,1fr)]">
                      <p className="font-medium">{labelForStatus(tx.action)}</p>
                      <div className="min-w-0 space-y-2">
                        <p className="break-all text-xs text-muted-foreground">
                          Pengirim: {tx.sender}
                        </p>
                        {tx.txHash ? (
                          explorer ? (
                            <a
                              className="inline-flex max-w-full items-start gap-1.5 text-xs text-primary underline decoration-primary/30 underline-offset-4"
                              href={explorer}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <span className="break-all">{tx.txHash}</span>
                              <ArrowUpRight
                                size={14}
                                className="shrink-0"
                                aria-hidden="true"
                              />
                              <span className="sr-only">
                                Buka transaksi di explorer, tab baru
                              </span>
                            </a>
                          ) : (
                            <p className="break-all text-xs">
                              Hash: {tx.txHash}
                            </p>
                          )
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Belum ada hash transaksi yang tercatat.
                          </p>
                        )}
                        {tx.replacesIntentId && (
                          <p className="break-all text-xs text-muted-foreground">
                            Menggantikan intent: {tx.replacesIntentId}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                      <span className="break-all">Intent: {tx.id}</span>
                      <time dateTime={tx.updatedAt}>
                        {formatDate(tx.updatedAt, true)}
                      </time>
                    </div>
                  </li>
                );
              })}
            </ul>
            <OpsPagination
              offset={offset}
              length={transactions.data.items.length}
              total={transactions.data.total}
              onChange={setOffset}
            />
          </>
        )}
      </section>
    </div>
  );
}
