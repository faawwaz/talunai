import { describe, expect, it } from "vitest";
import { assertCompleteReceipts } from "../packages/chain/receipt-backfill";

const hash = (digit: string) => `0x${digit.repeat(64)}` as const;
const zeroBloom = `0x${"0".repeat(512)}` as const;
const header = {
  number: "0x1" as const,
  hash: hash("a"),
  parentHash: hash("b"),
  logsBloom: zeroBloom,
};
const block = { ...header, transactions: [hash("c"), hash("d")] };
const receipts = [
  {
    blockHash: header.hash,
    blockNumber: header.number,
    transactionIndex: "0x0" as const,
    transactionHash: block.transactions[0],
    logsBloom: zeroBloom,
    logs: [],
  },
  {
    blockHash: header.hash,
    blockNumber: header.number,
    transactionIndex: "0x1" as const,
    transactionHash: block.transactions[1],
    logsBloom: zeroBloom,
    logs: [],
  },
];

describe("receipt backfill completeness", () => {
  it("accepts one receipt per canonical transaction in order", () => {
    expect(() => assertCompleteReceipts(header, block, receipts)).not.toThrow();
  });

  it("rejects truncated receipts even when their bloom remains unchanged", () => {
    expect(() =>
      assertCompleteReceipts(header, block, receipts.slice(0, 1)),
    ).toThrow("RECEIPT_BACKFILL_TRANSACTION_COUNT_MISMATCH");
  });

  it("rejects receipts whose transaction hashes are out of order", () => {
    expect(() =>
      assertCompleteReceipts(header, block, [
        { ...receipts[0], transactionHash: block.transactions[1] },
        receipts[1],
      ]),
    ).toThrow("RECEIPT_BACKFILL_RECEIPT_INDEX_MISMATCH");
  });
});
