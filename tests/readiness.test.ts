import { describe, expect, it } from "vitest";
import { assertReadyState } from "../packages/api/readiness";

const now = Date.now();
const healthy = {
  configuredChainId: 97,
  observedChainId: 97,
  head: 1000n,
  checkpoint: {
    block_number: "997",
    degraded: false,
    updated_at: new Date(now - 5_000),
  },
  worker: { status: "READY", updated_at: new Date(now - 5_000) },
  now,
};

describe("readiness", () => {
  it("accepts a fresh validated worker and checkpoint on the expected chain", () => {
    expect(() => assertReadyState(healthy)).not.toThrow();
  });
  it("fails closed when the RPC reports another chain or an impossible head", () => {
    expect(() => assertReadyState({ ...healthy, observedChainId: 56 })).toThrow(
      "RPC_CHAIN_MISMATCH",
    );
    expect(() => assertReadyState({ ...healthy, head: 996n })).toThrow(
      "INDEXER_NOT_READY",
    );
  });
  it("rejects stale or degraded indexer and worker heartbeats", () => {
    expect(() =>
      assertReadyState({
        ...healthy,
        checkpoint: { ...healthy.checkpoint, degraded: true },
      }),
    ).toThrow("INDEXER_NOT_READY");
    expect(() =>
      assertReadyState({
        ...healthy,
        checkpoint: {
          ...healthy.checkpoint,
          updated_at: new Date(now - 121_000),
        },
      }),
    ).toThrow("INDEXER_NOT_READY");
    expect(() =>
      assertReadyState({
        ...healthy,
        worker: { status: "DEGRADED", updated_at: new Date(now) },
      }),
    ).toThrow("WORKER_NOT_READY");
  });
});
