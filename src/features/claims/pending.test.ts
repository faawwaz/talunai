import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetPendingTransaction,
  pendingTransactionsFor,
  rememberPendingTransaction,
  type PendingTransactionHint,
} from "./pending";
const hint: PendingTransactionHint = {
  userId: "11111111-1111-4111-8111-111111111111",
  wallet: `0x${"a".repeat(40)}`,
  chainId: 31337,
  claimId: "22222222-2222-4222-8222-222222222222",
  intentId: "33333333-3333-4333-8333-333333333333",
  hash: `0x${"1".repeat(64)}`,
};
const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    dispatchEvent: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("browser transaction recovery hints", () => {
  it("survives component disposal via persisted hash without participant secrets", () => {
    expect(rememberPendingTransaction(hint)).toBe(true);
    expect(pendingTransactionsFor(hint)).toEqual([hint]);
    const persisted = JSON.parse([...storage.values()][0]);
    expect(Object.keys(persisted[0]).sort()).toEqual([
      "chainId",
      "claimId",
      "hash",
      "intentId",
      "userId",
      "wallet",
    ]);
  });
  it("isolates users, wallets, chains, and claims", () => {
    rememberPendingTransaction(hint);
    expect(
      pendingTransactionsFor({
        ...hint,
        userId: "44444444-4444-4444-8444-444444444444",
      }),
    ).toEqual([]);
    expect(
      pendingTransactionsFor({ ...hint, wallet: `0x${"b".repeat(40)}` }),
    ).toEqual([]);
    expect(pendingTransactionsFor({ ...hint, chainId: 97 })).toEqual([]);
    expect(
      pendingTransactionsFor({
        ...hint,
        claimId: "55555555-5555-4555-8555-555555555555",
      }),
    ).toEqual([]);
    expect(
      pendingTransactionsFor({ ...hint, wallet: hint.wallet.toUpperCase() }),
    ).toEqual([hint]);
  });
  it("reconciles only the same intent and preserves other pending transactions", () => {
    const other = { ...hint, intentId: "66666666-6666-4666-8666-666666666666" };
    rememberPendingTransaction(hint);
    rememberPendingTransaction(hint);
    rememberPendingTransaction(other);
    expect(pendingTransactionsFor(hint)).toHaveLength(2);
    forgetPendingTransaction(hint);
    expect(pendingTransactionsFor(hint)).toEqual([other]);
  });
  it("rejects malformed storage and unsupported networks", () => {
    expect(pendingTransactionsFor(hint, "{broken")).toEqual([]);
    expect(
      pendingTransactionsFor(hint, JSON.stringify([{ ...hint, chainId: 56 }])),
    ).toEqual([]);
    expect(
      pendingTransactionsFor(
        hint,
        JSON.stringify([{ ...hint, hash: "invented" }]),
      ),
    ).toEqual([]);
  });
  it("reports storage failures without pretending recovery is persisted", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
      },
      dispatchEvent: vi.fn(),
    });
    expect(rememberPendingTransaction(hint)).toBe(false);
    expect(pendingTransactionsFor(hint)).toEqual([]);
  });
});
