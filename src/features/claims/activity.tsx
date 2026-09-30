"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  History,
  RefreshCw,
} from "lucide-react";
import { useSession } from "@/features/session/provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Hex } from "viem";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { formatDate, labelForStatus, shortAddress } from "@/lib/format";
import type { Claim, TransactionIntent } from "../../../packages/client";
import { InlineError, SectionTitle, useRefreshClaim } from "./shared";
import { actionLabels } from "./operations";
import {
  forgetPendingTransaction,
  rememberPendingTransaction,
  usePendingTransactions,
} from "./pending";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown, fallback = "—") {
  return typeof value === "string" ? value : fallback;
}

export function ClaimActivity({ claim }: { claim: Claim }) {
  const { api, config, user } = useSession();
  const refresh = useRefreshClaim(claim.id);
  const pendingHints = usePendingTransactions({
    userId: user?.userId,
    wallet: user?.wallet,
    chainId: config?.chainId,
    claimId: claim.id,
  });
  const [auditPage, setAuditPage] = useState(0);
  const [transactionPage, setTransactionPage] = useState(0);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [recoveryHashes, setRecoveryHashes] = useState<Record<string, string>>(
    {},
  );
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const audit = useQuery({
    queryKey: ["audit", claim.id, auditPage],
    queryFn: () => api.audit(claim.id, 20, auditPage * 20),
  });
  const transactions = useQuery({
    queryKey: ["transactions", claim.id, transactionPage, user?.userId],
    queryFn: () => api.transactions(claim.id, 10, transactionPage * 10),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        ["SUBMITTED", "MINED", "DROPPED_OR_UNKNOWN"].includes(item.status),
      ) && query.state.dataUpdateCount < 40
        ? 5000
        : false,
  });
  useEffect(() => {
    for (const hint of pendingHints) {
      const intent = transactions.data?.items.find(
        (row) => row.id === hint.intentId,
      );
      if (
        intent &&
        ["CONFIRMED", "REVERTED", "REPLACED"].includes(intent.status)
      )
        forgetPendingTransaction(hint);
    }
  }, [pendingHints, transactions.data]);
  const runs = useQuery({
    queryKey: ["agent-runs", claim.id, 10],
    queryFn: () => api.agentRuns(claim.id, 10),
  });
  const runId = selectedRun ?? runs.data?.items[0]?.id;
  const run = useQuery({
    queryKey: ["agent-run", runId],
    queryFn: () => api.agentRun(runId!),
    enabled: Boolean(runId),
  });
  const observe = useMutation({
    mutationFn: (intent: Pick<TransactionIntent, "id" | "txHash">) => {
      if (!intent.txHash) throw new Error("TRANSACTION_NOT_SUBMITTED");
      return api.observe(intent.id, intent.txHash, crypto.randomUUID());
    },
    onSuccess: async (result, intent) => {
      setRecoveryNotice(
        `Hash diperiksa. Status: ${labelForStatus(result.status)}. Pembukuan mengikuti event chain terkonfirmasi.`,
      );
      if (["CONFIRMED", "REVERTED"].includes(result.status)) {
        for (const hint of pendingHints.filter(
          (row) => row.intentId === intent.id,
        ))
          forgetPendingTransaction(hint);
      }
      await refresh();
    },
  });
  const replacement = useMutation({
    mutationFn: ({ id, hash }: { id: string; hash: Hex }) =>
      api.observeReplacement(id, hash, crypto.randomUUID()),
    onSuccess: async (result, original) => {
      for (const hint of pendingHints.filter(
        (row) => row.intentId === original.id,
      ))
        forgetPendingTransaction(hint);
      if (user && config && !["CONFIRMED", "REVERTED"].includes(result.status))
        rememberPendingTransaction({
          userId: user.userId,
          wallet: user.wallet,
          chainId: config.chainId,
          claimId: claim.id,
          intentId: result.intentId,
          hash: original.hash,
        });
      setRecoveryNotice(
        `Transaksi pengganti diverifikasi dengan nonce yang sama. Status: ${labelForStatus(result.status)}. Tidak ada transaksi baru yang dikirim.`,
      );
      await refresh();
    },
  });
  return (
    <div className="space-y-7">
      {recoveryNotice && (
        <p role="status" className="info-callout text-sm">
          {recoveryNotice}
        </p>
      )}
      {pendingHints
        .filter(
          (hint) =>
            !transactions.data?.items.some((row) => row.txHash === hint.hash),
        )
        .map((hint) => (
          <div key={hint.intentId} className="info-callout">
            <p className="text-sm font-semibold">
              Pulihkan status transaksi terkirim
            </p>
            <p className="mt-1 text-sm leading-relaxed">
              Browser menyimpan hash sebelum konfirmasi backend. Periksa
              transaksi yang sama; tindakan ini tidak mengirim transaksi wallet
              baru.
            </p>
            <p className="mt-2 break-all text-xs text-muted-foreground">
              {hint.hash}
            </p>
            <Button
              className="mt-4"
              variant="outline"
              size="sm"
              disabled={observe.isPending}
              onClick={() =>
                observe.mutate({ id: hint.intentId, txHash: hint.hash })
              }
            >
              Periksa transaksi tersimpan
            </Button>
          </div>
        ))}
      <section className="surface p-6 sm:p-7">
        <SectionTitle
          title="Transaksi wallet Anda"
          description="Intent disiapkan, transaksi dikirim, dan konfirmasi chain dicatat sebagai status yang berbeda."
        />
        {transactions.isPending ? (
          <LoadingState />
        ) : transactions.error ? (
          <InlineError
            error={transactions.error}
            onRefresh={() => void transactions.refetch()}
          />
        ) : !transactions.data?.items.length ? (
          <p className="py-6 text-sm text-muted-foreground">
            Belum ada transaksi yang disiapkan oleh akun Anda untuk piutang ini.
          </p>
        ) : (
          <>
            <div className="divide-y divide-border">
              {transactions.data.items.map((intent) => (
                <div
                  key={intent.id}
                  className="flex flex-col justify-between gap-3 py-4 sm:flex-row"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {actionLabels[intent.action] ??
                        labelForStatus(intent.action)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(intent.createdAt, true)}
                    </p>
                    {intent.txHash ? (
                      config?.chainId === 97 ? (
                        <a
                          href={`https://testnet.bscscan.com/tx/${intent.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-xs text-primary"
                        >
                          {shortAddress(intent.txHash)}
                          <ArrowUpRight size={13} />
                        </a>
                      ) : (
                        <p
                          className="mt-2 break-all text-xs text-muted-foreground"
                          title={intent.txHash}
                        >
                          {shortAddress(intent.txHash)}
                        </p>
                      )
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Payload disiapkan; hash transaksi belum diterima.
                      </p>
                    )}
                    {intent.replacesIntentId && (
                      <p className="mt-2 break-all text-xs text-muted-foreground">
                        Menggantikan intent {intent.replacesIntentId}; hubungan
                        nonce diperiksa backend.
                      </p>
                    )}
                    {!["CONFIRMED", "REVERTED", "REPLACED"].includes(
                      intent.status,
                    ) && (
                      <details className="mt-3 max-w-xl">
                        <summary className="cursor-pointer text-xs font-medium text-primary">
                          {intent.txHash
                            ? "Wallet mempercepat transaksi? Periksa hash pengganti"
                            : "Sudah mengirim transaksi? Hubungkan hash dari wallet"}
                        </summary>
                        <form
                          className="mt-3 space-y-3"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const hash = recoveryHashes[intent.id];
                            if (/^0x[0-9a-fA-F]{64}$/.test(hash ?? "")) {
                              if (
                                intent.txHash &&
                                hash.toLowerCase() !==
                                  intent.txHash.toLowerCase()
                              )
                                replacement.mutate({
                                  id: intent.id,
                                  hash: hash as Hex,
                                });
                              else
                                observe.mutate({
                                  id: intent.id,
                                  txHash: hash as Hex,
                                });
                            }
                          }}
                        >
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            Gunakan hash transaksi yang benar-benar Anda kirim
                            untuk tindakan ini. Pengirim, kontrak tujuan,
                            calldata, dan event diperiksa; memasukkan hash tidak
                            mengirim transaksi baru.
                            {intent.txHash &&
                              " Pengganti harus sudah ditambang, dengan nonce dan isi tindakan yang sama. Jika masih pending, tunggu lalu periksa hash yang sama. Pembatalan wallet dengan calldata berbeda tidak dapat dicatat sebagai pengganti pembiayaan."}
                          </p>
                          <Label htmlFor={`hash-${intent.id}`}>
                            Hash transaksi
                          </Label>
                          <Input
                            id={`hash-${intent.id}`}
                            value={recoveryHashes[intent.id] ?? ""}
                            onChange={(event) =>
                              setRecoveryHashes((current) => ({
                                ...current,
                                [intent.id]: event.target.value.trim(),
                              }))
                            }
                            placeholder="0x…"
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            disabled={
                              observe.isPending ||
                              replacement.isPending ||
                              !/^0x[0-9a-fA-F]{64}$/.test(
                                recoveryHashes[intent.id] ?? "",
                              )
                            }
                          >
                            Periksa & hubungkan hash
                          </Button>
                        </form>
                      </details>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={intent.status} />
                    {intent.txHash &&
                      !["CONFIRMED", "REVERTED"].includes(intent.status) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Periksa status transaksi"
                          disabled={observe.isPending}
                          onClick={() => observe.mutate(intent)}
                        >
                          <RefreshCw size={15} />
                        </Button>
                      )}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!transactionPage}
                onClick={() => setTransactionPage((page) => page - 1)}
              >
                Sebelumnya
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={transactions.data.items.length < 10}
                onClick={() => setTransactionPage((page) => page + 1)}
              >
                Berikutnya
              </Button>
            </div>
          </>
        )}
        <InlineError
          error={observe.error || replacement.error}
          onRefresh={() => void refresh()}
        />
      </section>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_350px]">
        <section className="surface p-6 sm:p-7">
          <SectionTitle
            title="Jejak aktivitas"
            description="Perubahan, keputusan, dan pihak yang menjalankan tindakan."
          />
          {audit.isPending ? (
            <LoadingState />
          ) : audit.error ? (
            <InlineError
              error={audit.error}
              onRefresh={() => void audit.refetch()}
            />
          ) : !audit.data?.items.length ? (
            <EmptyState
              icon={History}
              title="Belum ada aktivitas"
              description="Aktivitas akan muncul ketika tindakan dicatat untuk piutang ini."
            />
          ) : (
            <>
              <ol className="space-y-0">
                {audit.data.items.map((value, index) => {
                  const event = record(value);
                  return (
                    <li
                      key={text(event.id, String(index))}
                      className="relative border-l border-border pb-6 pl-6 last:pb-0"
                    >
                      <span className="absolute -left-[4.5px] top-1.5 size-2 rounded-full bg-primary" />
                      <p className="text-sm font-medium">
                        {labelForStatus(text(event.action))}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(
                          text(event.created_at ?? event.createdAt),
                          true,
                        )}{" "}
                        ·{" "}
                        {text(event.actor_id ?? event.actorId) === "AGENT"
                          ? "Agent pemeriksaan"
                          : `Aktor ${shortAddress(text(event.actor_id ?? event.actorId))}`}
                      </p>
                      {typeof event.reason === "string" && (
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          {event.reason}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
              <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                <span className="text-xs text-muted-foreground">
                  Halaman {auditPage + 1}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Aktivitas sebelumnya"
                    disabled={!auditPage}
                    onClick={() => setAuditPage((page) => page - 1)}
                  >
                    <ChevronLeft size={16} />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Aktivitas berikutnya"
                    disabled={audit.data.items.length < 20}
                    onClick={() => setAuditPage((page) => page + 1)}
                  >
                    <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
        <aside className="surface h-fit p-6">
          <SectionTitle
            title="Riwayat analisis"
            description="Hasil tiap run tetap tersimpan."
          />
          {runs.error ? (
            <InlineError error={runs.error} />
          ) : !runs.data?.items.length ? (
            <p className="text-sm text-muted-foreground">
              Belum ada run agent.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                {runs.data.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedRun(item.id)}
                    className={`flex w-full items-center justify-between gap-3 rounded-md p-3 text-left ${item.id === runId ? "bg-secondary" : "hover:bg-background"}`}
                  >
                    <span>
                      <span className="block text-sm font-medium">
                        Versi {item.version}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.mode === "mock" ? "Mock" : "Live"} ·{" "}
                        {formatDate(item.createdAt)}
                      </span>
                    </span>
                    <StatusBadge status={item.status} />
                  </button>
                ))}
              </div>
              {run.data && (
                <div className="mt-5 border-t border-border pt-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Tahap yang tercatat
                  </p>
                  <ol className="space-y-3">
                    {run.data.steps.map((step) => (
                      <li key={step.id} className="flex gap-3 text-sm">
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {String(step.step).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <p>{labelForStatus(step.stage)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDate(step.createdAt, true)} WIB
                          </p>
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-primary">
                              Hasil tahap yang tercatat
                            </summary>
                            <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background p-3 text-[11px] leading-relaxed">
                              {JSON.stringify(step.result, null, 2)}
                            </pre>
                          </details>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {run.data.error && (
                    <p className="mt-4 text-xs text-red-700">
                      {labelForStatus(run.data.error)}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
