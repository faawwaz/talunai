import {
  createPublicClient,
  decodeEventLog,
  http,
  isAddress,
  keccak256,
  parseAbi,
  toHex,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import { bscTestnet } from "viem/chains";
import manifest from "../../deployments/pool-a-bsc-testnet.json";
import baseManifest from "../../deployments/bsc-testnet.json";
import flowManifest from "../../deployments/bsc-testnet-flow-smoke.json";
import { chainConfig } from "../chain/config";

export const poolAddress = manifest.address as Address;
export const poolAbi = parseAbi([
  "function poolStats() view returns (uint256 idleAssets,uint256 outstandingPrincipal,uint256 claimableFromVault,uint256 realizedFee,uint256 bookAssets,uint256 shares,uint256 activeDeals)",
  "function balanceOf(address) view returns (uint256)",
  "function previewRedeem(uint256) view returns (uint256)",
  "function dealCount() view returns (uint256)",
  "function dealAt(uint256) view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function depositsPaused() view returns (bool)",
  "function allocationsPaused() view returns (bool)",
  "function RISK_DISCLOSURE() view returns (string)",
  "function RISK_DISCLOSURE_HASH() view returns (bytes32)",
  "function deposit(uint256,bytes32) returns (uint256)",
  "function redeem(uint256) returns (uint256)",
  "function fundClaim(bytes32)",
  "function harvest(bytes32) returns (uint256)",
  "event Deposited(address indexed investor,uint256 assets,uint256 shares)",
  "event Redeemed(address indexed investor,uint256 shares,uint256 assets)",
  "event ClaimFunded(bytes32 indexed claimKey,uint256 principal)",
  "event Harvested(bytes32 indexed claimKey,uint256 amount)",
]);
const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const registryAbi = parseAbi([
  "function canFund(bytes32) view returns (bool)",
  "function flatFinancingFeeBps() view returns (uint256)",
  "function getTerms(bytes32) view returns ((bytes32 claimKey,uint256 version,address borrower,address buyer,address token,uint256 acceptedOutstanding,uint256 principal,uint256 fee,uint256 fundingDeadline,uint256 invoiceDueAt,uint256 reviewExpiry,uint256 consentExpiry,bytes32 evidenceCommitment,bytes32 decisionHash,bytes32 policyHash))",
]);
const vaultAbi = parseAbi([
  "function getAccounting(bytes32) view returns ((uint256 principalAllocated,uint256 feeAllocated,uint256 borrowerAllocated,uint256 lenderClaimable,uint256 borrowerClaimable,uint256 remainingLenderEntitlement,uint256 remainingInvoiceCollection,uint8 financingStatus,uint8 collectionStatus))",
]);
const investorRole = keccak256(toHex("INVESTOR_ROLE"));
function poolBinding() {
  const configured = chainConfig();
  if (
    configured.chainId !== 97 ||
    manifest.chainId !== 97 ||
    baseManifest.chainId !== 97 ||
    manifest.vault.toLowerCase() !== baseManifest.vault.toLowerCase() ||
    manifest.asset.toLowerCase() !== baseManifest.token.toLowerCase()
  )
    throw new Error("POOL_DEPLOYMENT_MISMATCH");
  // This manifest is the deployed zero-decimal pool. Its redemption and
  // allocator limits cannot be repaired in place, so the app exposes it for
  // historical positions only even while the core deployment still matches.
  // The binding check above keeps those positions readable after core upgrades.
  const legacyPositionOnly = true;
  return { ...configured, legacyPositionOnly };
}
const eventClient = createPublicClient({
  chain: bscTestnet,
  transport: http(
    process.env.CHAIN_ID === "97"
      ? process.env.RPC_HTTP_URL
      : "https://bsc-testnet-rpc.publicnode.com",
    { timeout: 5_000, retryCount: 0 },
  ),
});
const eventRpc =
  process.env.CHAIN_ID === "97"
    ? process.env.RPC_HTTP_URL
    : "https://bsc-testnet-rpc.publicnode.com";
const pointRpc =
  process.env.CHAIN_ID === "97" && process.env.RPC_FALLBACK_HTTP_URL
    ? process.env.RPC_FALLBACK_HTTP_URL
    : eventRpc;
const preferredPointClient = createPublicClient({
  chain: bscTestnet,
  batch: { multicall: true },
  transport: http(pointRpc, { timeout: 8_000, retryCount: 0 }),
});
const backupPointClient =
  pointRpc !== eventRpc
    ? createPublicClient({
        chain: bscTestnet,
        batch: { multicall: true },
        transport: http(eventRpc, { timeout: 10_000, retryCount: 0 }),
      })
    : null;
type PointClient = typeof preferredPointClient;
async function eventBlock(blockNumber: bigint) {
  try {
    return await eventClient.getBlock({ blockNumber });
  } catch {
    // Event-log RPCs can time out even for old block headers. The independent
    // point-read RPC provides a bounded fallback while preserving hash checks.
    return await preferredPointClient.getBlock({ blockNumber });
  }
}
async function confirmedPoolSnapshot(verifyLogProvider: boolean) {
  const binding = poolBinding();
  const confirmationLag = BigInt(binding.confirmations - 1);
  async function from(client: PointClient) {
    const [chainId, latest] = await Promise.all([
      client.getChainId(),
      client.getBlock({ blockTag: "latest" }),
    ]);
    if (chainId !== 97) throw new Error("POOL_RPC_CHAIN_MISMATCH");
    if (
      latest.number < confirmationLag ||
      Number(latest.timestamp) * 1000 < Date.now() - 90_000
    )
      throw new Error("POOL_RPC_STALE");
    let blockNumber = latest.number - confirmationLag;
    let anchor: Awaited<ReturnType<typeof eventClient.getBlock>> | null = null;
    if (verifyLogProvider) {
      try {
        anchor = await eventBlock(blockNumber);
      } catch {
        // The log provider may trail the point-read provider by a few blocks.
        const eventLatest = await eventClient.getBlock({ blockTag: "latest" });
        if (eventLatest.number < confirmationLag)
          throw new Error("POOL_EVENT_RPC_STALE");
        blockNumber =
          eventLatest.number - confirmationLag < blockNumber
            ? eventLatest.number - confirmationLag
            : blockNumber;
        anchor = await eventBlock(blockNumber);
      }
    }
    const block = await client.getBlock({ blockNumber });
    if (anchor && block.hash !== anchor.hash)
      throw new Error("POOL_RPC_BLOCK_MISMATCH");
    if (Number(block.timestamp) * 1000 < Date.now() - 90_000)
      throw new Error("POOL_RPC_STALE");
    return { client, block };
  }
  try {
    return await from(preferredPointClient);
  } catch (error) {
    if (!backupPointClient) throw error;
    return from(backupPointClient);
  }
}
type PoolEvent = {
  event: string;
  txHash: string;
  blockNumber: string;
  blockHash: string;
  logIndex: number;
  investor: string | null;
  claimKey: string | null;
  amount: string;
};
const cachedEvents: PoolEvent[] = [];
let scannedThrough = BigInt(manifest.deploymentStartBlock) - 1n;
let scannedBlockHash: Hex | null = null;
let scanQueue: Promise<void> = Promise.resolve();
const genesisTransaction = manifest.transactions.find(
  (tx) => tx.name === "deposit-1-billion-MockIDR",
);
const poolFlowEventNames = {
  POOL_FUND_CLAIM: "ClaimFunded",
  POOL_HARVEST: "Harvested",
  POOL_REDEEM: "Redeemed",
  POOL_REDEPOSIT: "Deposited",
} as const;
const pinnedTransactions = [
  ...(genesisTransaction
    ? [
        {
          hash: genesisTransaction.txHash as Hex,
          blockNumber: BigInt(genesisTransaction.blockNumber),
          event: "Deposited",
        },
      ]
    : []),
  ...flowManifest.transactions.flatMap((tx) => {
    const event =
      poolFlowEventNames[tx.action as keyof typeof poolFlowEventNames];
    return event
      ? [{ hash: tx.hash as Hex, blockNumber: BigInt(tx.blockNumber), event }]
      : [];
  }),
];
let pinnedEventsPromise: Promise<PoolEvent[]> | null = null;
async function readPinnedEvents() {
  if (pinnedEventsPromise) {
    const previous = await pinnedEventsPromise;
    const canonical = await Promise.all(
      previous.map((event) => eventBlock(BigInt(event.blockNumber))),
    );
    if (
      previous.some((event, index) => event.blockHash !== canonical[index].hash)
    ) {
      pinnedEventsPromise = null;
      throw new Error("POOL_PINNED_EVENT_REORG");
    }
    return previous;
  }
  pinnedEventsPromise = Promise.all(
    pinnedTransactions.map(async (pinned) => {
      let provider: PointClient = preferredPointClient;
      let receipt;
      let block;
      try {
        receipt = await provider.getTransactionReceipt({ hash: pinned.hash });
        block = await provider.getBlock({ blockNumber: receipt.blockNumber });
      } catch {
        provider = backupPointClient ?? eventClient;
        receipt = await provider.getTransactionReceipt({ hash: pinned.hash });
        block = await provider.getBlock({ blockNumber: receipt.blockNumber });
      }
      if (
        receipt.status !== "success" ||
        receipt.blockNumber !== pinned.blockNumber ||
        receipt.blockHash !== block.hash
      )
        throw new Error("POOL_PINNED_RECEIPT_INVALID");
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== poolAddress.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: poolAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName !== pinned.event) continue;
          const args = decoded.args as Record<string, unknown>;
          return {
            event: decoded.eventName,
            txHash: pinned.hash,
            blockNumber: receipt.blockNumber.toString(),
            blockHash: receipt.blockHash,
            logIndex: Number(log.logIndex),
            investor: typeof args.investor === "string" ? args.investor : null,
            claimKey: typeof args.claimKey === "string" ? args.claimKey : null,
            amount: String(args.assets ?? args.principal ?? args.amount ?? "0"),
          } satisfies PoolEvent;
        } catch {
          /* Another event in the same receipt. */
        }
      }
      throw new Error("POOL_PINNED_EVENT_MISSING");
    }),
  ).catch((error) => {
    pinnedEventsPromise = null;
    throw error;
  });
  return pinnedEventsPromise;
}
async function readPoolEvents(toBlock: bigint, anchorHash: Hex) {
  const binding = poolBinding();
  const deploymentBlock = BigInt(manifest.deploymentStartBlock);
  const windowStart =
    toBlock - deploymentBlock > 4999n ? toBlock - 4999n : deploymentBlock;
  const pinnedPromise =
    windowStart > deploymentBlock
      ? readPinnedEvents()
      : Promise.resolve([] as PoolEvent[]);
  const scan = scanQueue.then(async () => {
    if (scannedThrough > toBlock || scannedThrough < windowStart - 1n) {
      cachedEvents.splice(0);
      scannedThrough = windowStart - 1n;
      scannedBlockHash = null;
    }
    if (scannedBlockHash && scannedThrough >= windowStart) {
      const checkpoint = await eventBlock(scannedThrough);
      if (checkpoint.hash !== scannedBlockHash) {
        cachedEvents.splice(0);
        scannedThrough = windowStart - 1n;
        scannedBlockHash = null;
      }
    }
    if (scannedThrough >= windowStart) {
      const replayFrom =
        scannedThrough - BigInt(binding.rescan) + 1n > windowStart
          ? scannedThrough - BigInt(binding.rescan) + 1n
          : windowStart;
      cachedEvents.splice(
        0,
        cachedEvents.length,
        ...cachedEvents.filter(
          (event) => BigInt(event.blockNumber) < replayFrom,
        ),
      );
      scannedThrough = replayFrom - 1n;
      scannedBlockHash = null;
    }
    let fromBlock = scannedThrough + 1n;
    while (fromBlock <= toBlock) {
      const chunkEnd =
        fromBlock + 4999n < toBlock ? fromBlock + 4999n : toBlock;
      const logs = await eventClient.getLogs({
        address: poolAddress,
        events: poolAbi.filter((item) => item.type === "event"),
        fromBlock,
        toBlock: chunkEnd,
      });
      cachedEvents.push(
        ...logs.map((log) => {
          if (!log.blockHash || log.logIndex == null)
            throw new Error("POOL_EVENT_UNCONFIRMED_LOG");
          const args = log.args as Record<string, unknown>;
          return {
            event: log.eventName,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber.toString(),
            blockHash: log.blockHash,
            logIndex: Number(log.logIndex),
            investor: typeof args.investor === "string" ? args.investor : null,
            claimKey: typeof args.claimKey === "string" ? args.claimKey : null,
            amount: String(args.assets ?? args.principal ?? args.amount ?? "0"),
          };
        }),
      );
      scannedThrough = chunkEnd;
      const chunkBlock = await eventBlock(chunkEnd);
      scannedBlockHash = chunkBlock.hash;
      fromBlock = chunkEnd + 1n;
    }
    const canonicalAnchor = await eventBlock(toBlock);
    if (canonicalAnchor.hash !== anchorHash) {
      cachedEvents.splice(0);
      scannedThrough = windowStart - 1n;
      scannedBlockHash = null;
      throw new Error("POOL_EVENT_REORG_RETRY");
    }
  });
  scanQueue = scan.catch(() => undefined);
  const [, pinned] = await Promise.all([scan, pinnedPromise]);
  const firstRecent = cachedEvents.findIndex(
    (event) => BigInt(event.blockNumber) >= windowStart,
  );
  if (firstRecent < 0) cachedEvents.splice(0);
  else if (firstRecent > 0) cachedEvents.splice(0, firstRecent);
  const eventsByTransaction = new Map<string, PoolEvent>();
  for (const event of cachedEvents.slice(-40))
    eventsByTransaction.set(`${event.txHash}:${event.logIndex}`, event);
  let genesisPinned = false;
  for (const event of pinned) {
    if (BigInt(event.blockNumber) > toBlock) continue;
    const key = `${event.txHash}:${event.logIndex}`;
    if (eventsByTransaction.has(key)) continue;
    eventsByTransaction.set(key, event);
    if (event.txHash === genesisTransaction?.txHash) genesisPinned = true;
  }
  const events = [...eventsByTransaction.values()].sort((a, b) =>
    BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : 1,
  );
  return {
    events,
    windowStart,
    historyComplete: windowStart === deploymentBlock,
    genesisPinned,
  };
}

export async function readPoolExplore(wallet?: string, includeEvents = true) {
  if (wallet && !isAddress(wallet)) throw new Error("INVALID_WALLET");
  const { legacyPositionOnly } = poolBinding();
  const { client: pointClient, block } =
    await confirmedPoolSnapshot(includeEvents);
  const [
    stats,
    depositsPaused,
    allocationsPaused,
    riskDisclosure,
    riskHash,
    dealCount,
    feeBps,
  ] = await Promise.all([
    pointClient.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "poolStats",
      blockNumber: block.number,
    }),
    pointClient.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "depositsPaused",
      blockNumber: block.number,
    }),
    pointClient.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "allocationsPaused",
      blockNumber: block.number,
    }),
    pointClient.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "RISK_DISCLOSURE",
      blockNumber: block.number,
    }),
    pointClient.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "RISK_DISCLOSURE_HASH",
      blockNumber: block.number,
    }),
    pointClient.readContract({
      address: poolAddress,
      abi: poolAbi,
      functionName: "dealCount",
      blockNumber: block.number,
    }),
    pointClient.readContract({
      address: baseManifest.registry as Address,
      abi: registryAbi,
      functionName: "flatFinancingFeeBps",
      blockNumber: block.number,
    }),
  ]);
  const [idle, outstanding, claimable, fee, assets, shares, active] = stats;
  const deals = await Promise.all(
    Array.from({ length: Number(dealCount) }, async (_, index) => {
      const claimKey = await pointClient.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "dealAt",
        args: [BigInt(index)],
        blockNumber: block.number,
      });
      const [terms, accounting] = await Promise.all([
        pointClient.readContract({
          address: baseManifest.registry as Address,
          abi: registryAbi,
          functionName: "getTerms",
          args: [claimKey],
          blockNumber: block.number,
        }),
        pointClient.readContract({
          address: manifest.vault as Address,
          abi: vaultAbi,
          functionName: "getAccounting",
          args: [claimKey],
          blockNumber: block.number,
        }),
      ]);
      return {
        claimKey,
        principal: terms.principal.toString(),
        outstandingPrincipal: (
          terms.principal - accounting.principalAllocated
        ).toString(),
        feeAllocated: accounting.feeAllocated.toString(),
        lenderClaimable: accounting.lenderClaimable.toString(),
        remainingLenderEntitlement:
          accounting.remainingLenderEntitlement.toString(),
        dueAt: new Date(Number(terms.invoiceDueAt) * 1000).toISOString(),
        status:
          accounting.remainingLenderEntitlement === 0n
            ? "REPAID"
            : block.timestamp > terms.invoiceDueAt
              ? "OVERDUE"
              : accounting.financingStatus === 2
                ? "PARTIALLY_RECOVERED"
                : "ACTIVE",
      };
    }),
  );
  const eventFeed = includeEvents
    ? await readPoolEvents(block.number, block.hash)
    : null;
  let position = null;
  if (wallet) {
    const address = wallet as Address;
    const [
      userShares,
      tokenBalance,
      allowance,
      permitted,
      adminAllowed,
      allocatorAllowed,
    ] = await Promise.all([
      pointClient.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "balanceOf",
        args: [address],
        blockNumber: block.number,
      }),
      pointClient.readContract({
        address: manifest.asset as Address,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [address],
        blockNumber: block.number,
      }),
      pointClient.readContract({
        address: manifest.asset as Address,
        abi: tokenAbi,
        functionName: "allowance",
        args: [address, poolAddress],
        blockNumber: block.number,
      }),
      pointClient.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "hasRole",
        args: [investorRole, address],
        blockNumber: block.number,
      }),
      pointClient.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "hasRole",
        args: [zeroHash, address],
        blockNumber: block.number,
      }),
      pointClient.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "hasRole",
        args: [keccak256(toHex("ALLOCATOR_ROLE")), address],
        blockNumber: block.number,
      }),
    ]);
    position = {
      wallet: address,
      shares: userShares.toString(),
      bookPositionValue:
        shares === 0n ? "0" : ((userShares * assets) / shares).toString(),
      tokenBalance: tokenBalance.toString(),
      allowance: allowance.toString(),
      investorAllowed: permitted,
      adminAllowed,
      allocatorAllowed,
    };
  }
  return {
    chainId: 97,
    blockNumber: block.number.toString(),
    blockTime: new Date(Number(block.timestamp) * 1000).toISOString(),
    pool: poolAddress,
    token: manifest.asset,
    vault: manifest.vault,
    legacyPositionOnly,
    synthetic: true,
    stats: {
      idle: idle.toString(),
      outstandingPrincipal: outstanding.toString(),
      claimableFromVault: claimable.toString(),
      realizedFee: fee.toString(),
      bookAssets: assets.toString(),
      shares: shares.toString(),
      activeDeals: active.toString(),
      totalDeals: dealCount.toString(),
      utilizationBps:
        assets === 0n ? 0 : Number((outstanding * 10000n) / assets),
    },
    economics: {
      feeBps: Number(feeBps),
      currentEarningApy: active === 0n ? 0 : null,
      realizedNetApy: null,
      apyReason:
        active === 0n
          ? "Belum ada invoice aktif; modal pool belum menghasilkan imbal hasil."
          : "APY terealisasi memerlukan pengamatan pendapatan dan waktu; belum tersedia sebagai angka yang dapat diverifikasi.",
      feeDistribution:
        "Biaya lender yang benar-benar dibayar buyer menambah aset pool dan nilai tebus per share. Tidak ada emisi token atau imbal hasil tetap.",
    },
    controls: {
      depositsPaused,
      allocationsPaused,
      maxDealExposureBps: 1000,
      maxUtilizationBps: 8000,
      capitalLocked: active > 0n,
      riskDisclosure,
      riskHash,
    },
    deals,
    ...(eventFeed
      ? {
          events: eventFeed.events,
          eventWindowFromBlock: eventFeed.windowStart.toString(),
          eventHistoryComplete: eventFeed.historyComplete,
          genesisPinned: eventFeed.genesisPinned,
        }
      : {}),
    position,
  };
}

export async function readPoolEventFeed() {
  const binding = poolBinding();
  const confirmationLag = BigInt(binding.confirmations - 1);
  const [chainId, latest] = await Promise.all([
    eventClient.getChainId(),
    eventClient.getBlock({ blockTag: "latest" }),
  ]);
  if (chainId !== 97) throw new Error("POOL_EVENT_RPC_CHAIN_MISMATCH");
  if (
    latest.number < confirmationLag ||
    Number(latest.timestamp) * 1000 < Date.now() - 90_000
  )
    throw new Error("POOL_EVENT_RPC_STALE");
  const block = await eventClient.getBlock({
    blockNumber: latest.number - confirmationLag,
  });
  const feed = await readPoolEvents(block.number, block.hash);
  return {
    events: feed.events,
    eventWindowFromBlock: feed.windowStart.toString(),
    eventHistoryComplete: feed.historyComplete,
    genesisPinned: feed.genesisPinned,
    blockNumber: block.number.toString(),
  };
}

export async function readPoolCandidate(key: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("INVALID_CLAIM_KEY");
  const { legacyPositionOnly } = poolBinding();
  const claimKey = key as Hex;
  const { client: pointClient, block } = await confirmedPoolSnapshot(false);
  const [stats, eligible, terms, fundedByPool, dealCount, allocationsPaused] =
    await Promise.all([
      pointClient.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "poolStats",
        blockNumber: block.number,
      }),
      pointClient.readContract({
        address: baseManifest.registry as Address,
        abi: registryAbi,
        functionName: "canFund",
        args: [claimKey],
        blockNumber: block.number,
      }),
      pointClient.readContract({
        address: baseManifest.registry as Address,
        abi: registryAbi,
        functionName: "getTerms",
        args: [claimKey],
        blockNumber: block.number,
      }),
      pointClient.readContract({
        address: poolAddress,
        abi: parseAbi(["function fundedByPool(bytes32) view returns (bool)"]),
        functionName: "fundedByPool",
        args: [claimKey],
        blockNumber: block.number,
      }),
      pointClient.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "dealCount",
        blockNumber: block.number,
      }),
      pointClient.readContract({
        address: poolAddress,
        abi: poolAbi,
        functionName: "allocationsPaused",
        blockNumber: block.number,
      }),
    ]);
  const [idle, outstanding, , , assets] = stats;
  const dealLimit = assets / 10n;
  const portfolioRoom =
    (assets * 8n) / 10n > outstanding ? (assets * 8n) / 10n - outstanding : 0n;
  const reasons = [
    ...(legacyPositionOnly
      ? [
          "Pool lama hanya tersedia untuk melihat posisi dan penarikan; invoice baru menggunakan deployment aktif.",
        ]
      : []),
    ...(!eligible
      ? [
          "Registry belum mengizinkan pendanaan: periksa status, hold, persetujuan, dan tenggat.",
        ]
      : []),
    ...(fundedByPool ? ["Invoice sudah dialokasikan ke pool."] : []),
    ...(terms.principal > idle
      ? ["Likuiditas tersedia kurang dari pokok invoice."]
      : []),
    ...(terms.principal > dealLimit
      ? ["Pokok melewati batas 10% aset buku per invoice."]
      : []),
    ...(terms.principal > portfolioRoom
      ? ["Pokok melewati sisa batas utilisasi 80%."]
      : []),
    ...(dealCount >= 32n
      ? ["Batas 32 invoice sepanjang umur kontrak tercapai."]
      : []),
    ...(allocationsPaused ? ["Alokasi pool sedang dijeda admin onchain."] : []),
  ];
  return {
    claimKey,
    blockNumber: block.number.toString(),
    blockTime: new Date(Number(block.timestamp) * 1000).toISOString(),
    eligible,
    fundedByPool,
    principal: terms.principal.toString(),
    fee: terms.fee.toString(),
    dueAt: new Date(Number(terms.invoiceDueAt) * 1000).toISOString(),
    borrower: terms.borrower,
    buyer: terms.buyer,
    dealLimit: dealLimit.toString(),
    portfolioRoom: portfolioRoom.toString(),
    idle: idle.toString(),
    canAllocate: reasons.length === 0,
    legacyPositionOnly,
    reasons,
    indicativeGrossApyBps: null,
    apyBasis:
      "Biaya pendanaan tetap untuk satu Deal. Hasil tahunan tidak dihitung dari sisa waktu menuju jatuh tempo.",
  };
}
