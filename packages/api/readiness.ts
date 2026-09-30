export type ReadinessCheckpoint = {
  block_number: string;
  degraded: boolean;
  updated_at: Date | string;
};
export type ReadinessHeartbeat = {
  status: string;
  updated_at: Date | string;
};

export function assertReadyState(input: {
  configuredChainId: number;
  observedChainId: number;
  head: bigint;
  checkpoint?: ReadinessCheckpoint;
  worker?: ReadinessHeartbeat;
  now: number;
}) {
  if (input.observedChainId !== input.configuredChainId)
    throw new Error("RPC_CHAIN_MISMATCH");
  const checkpoint = input.checkpoint;
  if (
    !checkpoint ||
    checkpoint.degraded ||
    BigInt(checkpoint.block_number) > input.head ||
    new Date(checkpoint.updated_at).getTime() < input.now - 120_000
  )
    throw new Error("INDEXER_NOT_READY");
  const worker = input.worker;
  if (
    !worker ||
    worker.status !== "READY" ||
    new Date(worker.updated_at).getTime() < input.now - 120_000
  )
    throw new Error("WORKER_NOT_READY");
}
