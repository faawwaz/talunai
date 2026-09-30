"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { Hex } from "viem";

/** Recovery hints are public transaction references, never credentials or signed payloads. */
export type PendingTransactionHint = {
  userId: string;
  wallet: string;
  chainId: number;
  claimId: string;
  intentId: string;
  hash: Hex;
};
const storageKey = "talunai.pending-transaction-hints.v1";
const changed = "talunai:pending-transaction-hints";
const empty = "[]";
function snapshot() {
  if (typeof window === "undefined") return empty;
  try {
    return window.sessionStorage.getItem(storageKey) ?? empty;
  } catch {
    return empty;
  }
}
function parse(value: string): PendingTransactionHint[] {
  try {
    const rows: unknown = JSON.parse(value);
    if (!Array.isArray(rows) || rows.length > 1000) return [];
    return rows.filter(
      (row): row is PendingTransactionHint =>
        typeof row === "object" &&
        row !== null &&
        [97, 31337].includes(row.chainId) &&
        typeof row.wallet === "string" &&
        /^0x[a-f\d]{40}$/i.test(row.wallet) &&
        [row.userId, row.claimId, row.intentId].every(
          (value) => typeof value === "string" && /^[a-f\d-]{36}$/i.test(value),
        ) &&
        typeof row.hash === "string" &&
        /^0x[a-f\d]{64}$/i.test(row.hash),
    );
  } catch {
    return [];
  }
}
function subscribe(callback: () => void) {
  window.addEventListener(changed, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(changed, callback);
    window.removeEventListener("storage", callback);
  };
}
function write(rows: PendingTransactionHint[]) {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(rows));
    window.dispatchEvent(new Event(changed));
    return true;
  } catch {
    return false;
  }
}
export function rememberPendingTransaction(hint: PendingTransactionHint) {
  const rows = parse(snapshot()).filter(
    (row) =>
      row.intentId !== hint.intentId ||
      row.userId !== hint.userId ||
      row.chainId !== hint.chainId,
  );
  return write([...rows, hint]);
}
export function forgetPendingTransaction(hint: PendingTransactionHint) {
  return write(
    parse(snapshot()).filter(
      (row) =>
        row.intentId !== hint.intentId ||
        row.userId !== hint.userId ||
        row.chainId !== hint.chainId,
    ),
  );
}
export type PendingScope = {
  userId?: string;
  wallet?: string;
  chainId?: number;
  claimId: string;
};
export function pendingTransactionsFor(
  scope: PendingScope,
  value = snapshot(),
) {
  return parse(value).filter(
    (row) =>
      row.userId === scope.userId &&
      row.wallet.toLowerCase() === scope.wallet?.toLowerCase() &&
      row.chainId === scope.chainId &&
      row.claimId === scope.claimId,
  );
}
export function usePendingTransactions(scope: PendingScope) {
  const { userId, wallet, chainId, claimId } = scope;
  const value = useSyncExternalStore(subscribe, snapshot, () => empty);
  return useMemo(
    () => pendingTransactionsFor({ userId, wallet, chainId, claimId }, value),
    [value, userId, wallet, chainId, claimId],
  );
}
