"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  CircleAlert,
  ShieldCheck,
} from "lucide-react";
import type { Hex } from "viem";
import { useSession } from "@/features/session/provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { TokenIdentity } from "@/components/token-identity";
import { formatDate, money } from "@/lib/format";
import { TalunaiApiError, type Claim } from "../../../packages/client";
import type {
  ActionName,
  TransactionTemplate,
} from "../../../packages/api/chain-port";
import {
  DetailFacts,
  InlineError,
  SyntheticNote,
  useRefreshClaim,
} from "./shared";

import {
  forgetPendingTransaction,
  rememberPendingTransaction,
  usePendingTransactions,
} from "./pending";

export const actionLabels: Record<ActionName, string> = {
  REGISTER: "Registrasi piutang",
  CANCEL: "Batalkan piutang",
  APPROVE_TOKEN: "Izinkan penggunaan IDRT uji",
  FUND: "Danai & cairkan principal",
  COLLECT_BUYER_PAYMENT: "Bayar invoice",
  WITHDRAW_LENDER: "Tarik saldo lender",
  WITHDRAW_BORROWER: "Tarik sisa collection",
  CLEAR_HOLD: "Buka funding hold",
  REVOKE_CONSENT: "Cabut nonce persetujuan",
};
type Prepared =
  | {
      kind: "transaction";
      version: number;
      action: ActionName;
      amount?: string;
      nonce?: string;
      intentId: string;
      transaction: TransactionTemplate;
    }
  | {
      kind: "consent";
      version: number;
      role: "BORROWER" | "BUYER";
      nonce: string;
      typedData: Record<string, unknown>;
      signature?: Hex;
    };
type Request =
  | { kind: "transaction"; action: ActionName; amount?: string; nonce?: string }
  | { kind: "consent"; role: "BORROWER" | "BUYER" };

export function useClaimOperations(claim: Claim) {
  const session = useSession();
  const refresh = useRefreshClaim(claim.id);
  const confirmationLock = useRef(false);
  const pendingHints = usePendingTransactions({
    userId: session.user?.userId,
    wallet: session.user?.wallet,
    chainId: session.config?.chainId,
    claimId: claim.id,
  });
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [fundingRiskAccepted, setFundingRiskAccepted] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    hash?: Hex;
    intentId?: string;
    observeKey?: string;
    status?: string;
  } | null>(null);
  const currentNotice =
    notice ??
    (pendingHints[0]
      ? {
          message:
            "Ada transaksi terkirim yang perlu direkonsiliasi. Periksa hash yang sama sebelum menyiapkan tindakan baru.",
          hash: pendingHints[0].hash,
          intentId: pendingHints[0].intentId,
          status: "DROPPED_OR_UNKNOWN",
        }
      : null);
  const prepare = useMutation({
    mutationFn: async (request: Request): Promise<Prepared> => {
      if (request.kind === "consent") {
        const nonce = BigInt(
          `0x${crypto.randomUUID().replaceAll("-", "")}`,
        ).toString();
        const result = await session.api.prepareConsent(
          claim.id,
          { expectedVersion: claim.version, role: request.role, nonce },
          crypto.randomUUID(),
        );
        return {
          kind: "consent",
          version: result.version,
          role: request.role,
          nonce,
          typedData: result.typedData,
        };
      }
      const result = await session.api.prepareAction(
        claim.id,
        {
          expectedVersion: claim.version,
          action: request.action,
          ...(request.amount ? { amount: request.amount } : {}),
          ...(request.nonce !== undefined ? { nonce: request.nonce } : {}),
        },
        crypto.randomUUID(),
      );
      const withdrawal = ["WITHDRAW_LENDER", "WITHDRAW_BORROWER"].includes(
        request.action,
      )
        ? await session.api.financing(claim.id)
        : null;
      return {
        kind: "transaction",
        version: claim.version,
        action: request.action,
        amount: withdrawal
          ? request.action === "WITHDRAW_LENDER"
            ? withdrawal.lenderClaimable
            : withdrawal.borrowerResidualClaimable
          : request.amount,
        nonce: request.nonce,
        intentId: result.intentId,
        transaction: result.transaction,
      };
    },
    onMutate: () => {
      setPrepared(null);
      setFundingRiskAccepted(false);
      setNotice(null);
    },
    onSuccess: setPrepared,
  });
  const confirm = useMutation({
    mutationFn: async () => {
      if (!prepared) return;
      if (
        prepared.kind === "transaction" &&
        prepared.action === "FUND" &&
        !fundingRiskAccepted
      )
        throw new Error("FUNDING_RISK_ACK_REQUIRED");
      if (!session.user || !session.config) throw new Error("SESSION_REQUIRED");
      if (pendingHints.length)
        throw new Error("PENDING_TRANSACTION_RECONCILIATION_REQUIRED");
      const fresh = await session.api.claim(claim.id);
      if (fresh.version !== prepared.version)
        throw new TalunaiApiError(409, "CLAIM_VERSION_CHANGED");
      if (prepared.kind === "consent") {
        if (fresh.fundingHold || fresh.hasDispute)
          throw new TalunaiApiError(409, "HOLD_OR_DISPUTE");
        const signature =
          prepared.signature ??
          (await session.signConsent(prepared.typedData, fresh));
        setPrepared({ ...prepared, signature });
        await session.api.consent(
          claim.id,
          {
            expectedVersion: prepared.version,
            role: prepared.role,
            nonce: prepared.nonce,
            signature,
          },
          `consent-${prepared.nonce}`,
        );
        setPrepared(null);
        setNotice({
          message: "Persetujuan tersimpan untuk versi ketentuan ini.",
        });
        await refresh();
        return;
      }
      if (
        ["REGISTER", "FUND"].includes(prepared.action) &&
        (fresh.fundingHold || fresh.hasDispute)
      )
        throw new TalunaiApiError(409, "HOLD_OR_DISPUTE");
      const hash = await session.sendTransaction(prepared.transaction, {
        claim: fresh,
        action: prepared.action,
        amount: prepared.amount,
        nonce: prepared.nonce,
      });
      // A broadcast hash is retained before observation. A failed observation must never re-send the wallet transaction.
      const observeKey = crypto.randomUUID();
      const hint = {
        userId: session.user.userId,
        wallet: session.user.wallet,
        chainId: session.config.chainId,
        claimId: claim.id,
        intentId: prepared.intentId,
        hash,
      };
      const recoverable = rememberPendingTransaction(hint);
      setPrepared(null);
      setNotice({
        message: recoverable
          ? "Transaksi dikirim. Menunggu verifikasi dan konfirmasi chain."
          : "Transaksi dikirim, tetapi browser tidak dapat menyimpan petunjuk pemulihan. Salin hash ini sebelum meninggalkan halaman dan jangan kirim ulang.",
        hash,
        intentId: prepared.intentId,
        observeKey,
        status: "SUBMITTED",
      });
      const observed = await session.api.observe(
        prepared.intentId,
        hash,
        observeKey,
      );
      if (["CONFIRMED", "REVERTED"].includes(observed.status))
        forgetPendingTransaction(hint);
      setNotice({
        message:
          observed.status === "CONFIRMED"
            ? "Transaksi terkonfirmasi. Saldo mengikuti pembukuan chain."
            : observed.status === "REVERTED"
              ? "Transaksi revert. Perubahan pembukuan tidak diterapkan."
              : "Transaksi tercatat dan menunggu konfirmasi chain.",
        hash,
        intentId: prepared.intentId,
        observeKey,
        status: observed.status,
      });
      await refresh();
    },
  });
  const reconcile = useMutation({
    mutationFn: async () => {
      if (!currentNotice?.hash || !currentNotice.intentId) return;
      const observed = await session.api.observe(
        currentNotice.intentId,
        currentNotice.hash,
        crypto.randomUUID(),
      );
      if (["CONFIRMED", "REVERTED"].includes(observed.status)) {
        for (const hint of pendingHints.filter(
          (row) => row.intentId === currentNotice.intentId,
        ))
          forgetPendingTransaction(hint);
      }
      setNotice({
        ...currentNotice,
        status: observed.status,
        message:
          observed.status === "CONFIRMED"
            ? "Transaksi terkonfirmasi."
            : observed.status === "REVERTED"
              ? "Transaksi revert; tidak ada perubahan pembukuan."
              : "Status diperbarui. Transaksi belum terkonfirmasi.",
      });
      await refresh();
    },
  });
  const feedback = (
    <div className="space-y-3">
      <InlineError
        error={prepare.error || (!prepared && confirm.error) || reconcile.error}
        onRefresh={() => {
          setPrepared(null);
          void refresh();
        }}
      />
      {currentNotice && (
        <div className="info-callout" role="status">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              {currentNotice.status === "REVERTED" ? (
                <CircleAlert size={17} className="mt-0.5 shrink-0" />
              ) : currentNotice.status &&
                currentNotice.status !== "CONFIRMED" ? (
                <Clock3 size={17} className="mt-0.5 shrink-0" />
              ) : (
                <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium">{currentNotice.message}</p>
                {currentNotice.hash && (
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {currentNotice.hash}
                  </p>
                )}
              </div>
            </div>
            {currentNotice.status && (
              <StatusBadge status={currentNotice.status} />
            )}
          </div>
          {currentNotice.hash &&
            currentNotice.status !== "CONFIRMED" &&
            currentNotice.status !== "REVERTED" && (
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={() => reconcile.mutate()}
                disabled={reconcile.isPending}
              >
                {reconcile.isPending ? "Memeriksa…" : "Periksa konfirmasi"}
              </Button>
            )}
        </div>
      )}
    </div>
  );
  const dialog = (
    <Dialog
      open={Boolean(prepared)}
      onOpenChange={(open) => {
        if (!open && !confirm.isPending) {
          setPrepared(null);
          setFundingRiskAccepted(false);
          confirm.reset();
        }
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <ShieldCheck size={22} className="mb-2 text-primary" />
          <DialogTitle>
            {prepared?.kind === "consent"
              ? prepared.role === "BUYER"
                ? "Konfirmasi pengakuan buyer"
                : "Konfirmasi persetujuan borrower"
              : prepared
                ? actionLabels[prepared.action]
                : "Tinjau tindakan"}
          </DialogTitle>
          <DialogDescription>
            Tinjau detail berikut sebelum melanjutkan ke wallet. Tidak ada
            transaksi atau tanda tangan yang dikirim otomatis.
          </DialogDescription>
        </DialogHeader>
        {prepared && (
          <>
            <DetailFacts
              items={[
                {
                  label: "Invoice / versi",
                  value: `${claim.invoiceNumber} · v${prepared.version}`,
                },
                {
                  label: "Jaringan",
                  value: `${session.config?.chainId === 97 ? "BSC Testnet" : "Anvil lokal"} · ${session.config?.chainId ?? "—"}`,
                },
                { label: "Principal", value: money(claim.terms.principal) },
                { label: "Biaya flat", value: money(claim.terms.fee) },
                {
                  label: "Outstanding invoice",
                  value: money(claim.terms.acceptedOutstanding),
                },
                ...(prepared.kind === "transaction" && prepared.amount
                  ? [
                      {
                        label: [
                          "WITHDRAW_LENDER",
                          "WITHDRAW_BORROWER",
                        ].includes(prepared.action)
                          ? "Saldo tersedia saat persiapan"
                          : "Nominal tindakan",
                        value: money(prepared.amount),
                      },
                    ]
                  : []),
                ...(prepared.kind === "transaction" &&
                prepared.nonce !== undefined
                  ? [
                      {
                        label: "Nonce yang akan dicabut",
                        value: prepared.nonce,
                      },
                    ]
                  : []),
                ...(prepared.kind === "transaction" &&
                ["WITHDRAW_LENDER", "WITHDRAW_BORROWER"].includes(
                  prepared.action,
                )
                  ? [
                      {
                        label: "Penerima penarikan",
                        value: (
                          <span className="break-all">
                            {prepared.action === "WITHDRAW_BORROWER"
                              ? claim.terms.borrower
                              : session.user?.wallet}
                          </span>
                        ),
                      },
                    ]
                  : []),
                ...(prepared.kind === "transaction" &&
                prepared.action === "APPROVE_TOKEN"
                  ? [
                      {
                        label: "Spender yang diizinkan",
                        value: (
                          <span className="break-all">
                            {session.config?.contracts.vault ?? "—"}
                          </span>
                        ),
                      },
                    ]
                  : []),
                {
                  label: "Token",
                  value: (
                    <span className="inline-flex flex-col items-end gap-2">
                      <TokenIdentity compact />
                      <span className="break-all text-xs">
                        {claim.terms.token}
                      </span>
                    </span>
                  ),
                },
                {
                  label: "Wallet borrower",
                  value: (
                    <span className="break-all">{claim.terms.borrower}</span>
                  ),
                },
                {
                  label: "Wallet buyer",
                  value: <span className="break-all">{claim.terms.buyer}</span>,
                },
                {
                  label: "Pengirim",
                  value: (
                    <span className="break-all">
                      {session.user?.wallet ?? "—"}
                    </span>
                  ),
                },
                ...(prepared.kind === "transaction"
                  ? [
                      {
                        label: "Kontrak tujuan",
                        value: (
                          <span className="break-all">
                            {prepared.transaction.to}
                          </span>
                        ),
                      },
                      {
                        label: "Nilai native",
                        value: `${prepared.transaction.value} wei`,
                      },
                    ]
                  : [
                      {
                        label: "Batas persetujuan",
                        value: `${formatDate(claim.terms.consentExpiry, true)} WIB`,
                      },
                    ]),
                {
                  label: "Batas pendanaan",
                  value: `${formatDate(claim.terms.fundingDeadline, true)} WIB`,
                },
              ]}
            />
            <div className="mt-4">
              <SyntheticNote />
            </div>
            {prepared.kind === "transaction" &&
              ["WITHDRAW_LENDER", "WITHDRAW_BORROWER"].includes(
                prepared.action,
              ) && (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Kontrak menarik seluruh alokasi yang sudah menjadi hak Anda
                  dan belum ditarik saat transaksi dieksekusi. Nominal dapat
                  bertambah bila collection baru terkonfirmasi sebelum transaksi
                  ini.
                </p>
              )}
            {prepared.kind === "transaction" &&
              prepared.action === "CANCEL" && (
                <p className="mt-3 text-sm text-red-700">
                  Pembatalan bersifat final. Invoice ini tidak dapat
                  diregistrasi ulang atau didanai setelah pembatalan
                  terkonfirmasi.
                </p>
              )}
            {prepared.kind === "transaction" && prepared.action === "FUND" && (
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-secondary/50 p-4 text-sm leading-relaxed">
                <input
                  type="checkbox"
                  checked={fundingRiskAccepted}
                  onChange={(event) =>
                    setFundingRiskAccepted(event.target.checked)
                  }
                  className="mt-1 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                />
                <span>
                  Saya memahami principal dicairkan langsung ke borrower.
                  Pengembalian principal dan fee bergantung pada pembayaran
                  buyer yang benar-benar diterima; keterlambatan, gagal bayar,
                  sengketa, atau kegagalan kontrak dapat menyebabkan kerugian.
                  Token ini hanya untuk pengujian.
                </span>
              </label>
            )}
            <details className="mt-4 rounded-md border border-border p-3">
              <summary className="cursor-pointer text-xs font-medium">
                Lihat payload yang akan ditandatangani
              </summary>
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed">
                {JSON.stringify(
                  prepared.kind === "consent"
                    ? prepared.typedData
                    : prepared.transaction,
                  null,
                  2,
                )}
              </pre>
            </details>
            <div className="mt-4">
              <InlineError
                error={confirm.error}
                onRefresh={() => {
                  setPrepared(null);
                  void refresh();
                }}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setPrepared(null);
                  setFundingRiskAccepted(false);
                }}
                disabled={confirm.isPending}
              >
                Batal
              </Button>
              <Button
                onClick={() => {
                  if (confirmationLock.current) return;
                  confirmationLock.current = true;
                  confirm.mutate(undefined, {
                    onSettled: () => {
                      confirmationLock.current = false;
                    },
                  });
                }}
                disabled={
                  confirm.isPending ||
                  (prepared.kind === "transaction" &&
                    prepared.action === "FUND" &&
                    !fundingRiskAccepted)
                }
              >
                {confirm.isPending
                  ? "Menunggu wallet…"
                  : prepared.kind === "consent" && prepared.signature
                    ? "Simpan persetujuan"
                    : "Lanjutkan ke wallet"}
                <ArrowUpRight size={15} />
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
  return {
    prepare: (request: Request) => {
      if (
        pendingHints.length ||
        (currentNotice?.hash &&
          !["CONFIRMED", "REVERTED"].includes(currentNotice.status ?? ""))
      ) {
        if (pendingHints.length) setNotice(null);
        return;
      }
      confirm.reset();
      prepare.mutate(request);
    },
    busy: prepare.isPending || confirm.isPending,
    feedback,
    dialog,
  };
}
