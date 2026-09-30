import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { anvil, bscTestnet } from "viem/chains";
import { actor } from "./actors";
import { testOnlyAddress } from "./deployment-safety";

const chainId = Number(process.env.CHAIN_ID);
if (chainId !== 97 && chainId !== 31337) throw new Error("UNSUPPORTED_CHAIN");
const deployV2 = process.argv.includes("--v2");
if (process.argv.includes("--execute") && !deployV2)
  throw new Error("NEW_POOL_DEPLOYMENT_REQUIRES_--v2");
const chain = chainId === 97 ? bscTestnet : anvil;
const transport = http(process.env.RPC_HTTP_URL ?? "http://127.0.0.1:8545");
const publicClient = createPublicClient({ chain, transport });
if ((await publicClient.getChainId()) !== chainId)
  throw new Error("RPC_CHAIN_MISMATCH");
const admin = actor("admin");
const lender = actor("lender");
const base = JSON.parse(
  readFileSync(
    `deployments/${chainId === 97 ? "bsc-testnet" : "anvil"}.json`,
    "utf8",
  ),
) as {
  chainId: number;
  vault: Address;
  token: Address;
  actors: Record<string, Address> & { admin: Address; lender: Address };
};
if (
  base.chainId !== chainId ||
  base.actors.admin.toLowerCase() !== admin.address.toLowerCase() ||
  base.actors.lender.toLowerCase() !== lender.address.toLowerCase()
)
  throw new Error("ACTOR_OR_MANIFEST_MISMATCH");
const allocator = deployV2
  ? testOnlyAddress(process.env.POOL_ALLOCATOR_ADDRESS ?? "", chainId)
  : undefined;
if (
  allocator &&
  Object.values(base.actors).some(
    (address) => address.toLowerCase() === allocator.toLowerCase(),
  )
)
  throw new Error("POOL_ALLOCATOR_MUST_BE_DISTINCT_FROM_DEMO_ACTORS");
const artifact = (name: string) =>
  JSON.parse(
    readFileSync(`contracts/out/${name}.sol/${name}.json`, "utf8"),
  ) as { abi: Abi; bytecode: { object: Hex } };
const poolAbi = artifact("LiquidityPoolA").abi;
const tokenAbi = artifact("MockIDR").abi;
const vaultAbi = artifact("FinancingVault").abi;
const network = chainId === 97 ? "bsc-testnet" : "anvil";
const manifestPath = `deployments/pool-a${deployV2 ? "-v2" : ""}-${network}.json`;
const pendingPath = `.local/pool-a${deployV2 ? "-v2" : ""}-${chainId}.pending.json`;
const requiredAdminGas = deployV2 ? 4_000_000n : 3_000_000n;
const amount = 1_000_000_000n;
const riskHash = keccak256(
  toHex(
    "TALUNAI_POOL_A_RISK_V1: MockIDR has no value. Capital is locked while financed invoices remain unpaid. Buyer nonpayment, disputes and smart-contract failures can cause loss or delay. Projected APY is not guaranteed.",
  ),
);
const [adminGas, lenderGas, lenderTokens, gasPrice] = await Promise.all([
  publicClient.getBalance({ address: admin.address }),
  publicClient.getBalance({ address: lender.address }),
  publicClient.readContract({
    address: base.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [lender.address],
  }) as Promise<bigint>,
  publicClient.getGasPrice(),
]);
console.log(
  JSON.stringify(
    {
      chainId,
      admin: admin.address,
      lender: lender.address,
      ...(allocator ? { allocator } : {}),
      adminGasTBNB: formatEther(adminGas),
      lenderGasTBNB: formatEther(lenderGas),
      lenderMockIDR: lenderTokens.toString(),
      targetDepositMockIDR: amount.toString(),
      alreadyDeployed: existsSync(manifestPath),
    },
    null,
    2,
  ),
);
if (process.argv.includes("--check")) {
  if (existsSync(manifestPath)) {
    const deployed = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      address: Address;
      asset: Address;
      vault: Address;
      allocator?: Address;
      transactions: Array<{ name: string; txHash: Hex }>;
    };
    const depositHash = deployed.transactions.find(
      (transaction) => transaction.name === "deposit-1-billion-MockIDR",
    )?.txHash;
    const [
      code,
      asset,
      vault,
      depositReceipt,
      decimals,
      allocatorGranted,
      adminAllocator,
    ] = await Promise.all([
      publicClient.getCode({ address: deployed.address }),
      publicClient.readContract({
        address: deployed.address,
        abi: poolAbi,
        functionName: "asset",
      }) as Promise<Address>,
      publicClient.readContract({
        address: deployed.address,
        abi: poolAbi,
        functionName: "vault",
      }) as Promise<Address>,
      depositHash
        ? publicClient.getTransactionReceipt({ hash: depositHash })
        : Promise.resolve(null),
      deployV2
        ? publicClient.readContract({
            address: deployed.address,
            abi: poolAbi,
            functionName: "decimals",
          })
        : Promise.resolve(null),
      deployV2 && allocator
        ? publicClient.readContract({
            address: deployed.address,
            abi: poolAbi,
            functionName: "hasRole",
            args: [keccak256(toHex("ALLOCATOR_ROLE")), allocator],
          })
        : Promise.resolve(null),
      deployV2
        ? publicClient.readContract({
            address: deployed.address,
            abi: poolAbi,
            functionName: "hasRole",
            args: [keccak256(toHex("ALLOCATOR_ROLE")), admin.address],
          })
        : Promise.resolve(null),
    ]);
    const verified =
      !!code &&
      asset.toLowerCase() === base.token.toLowerCase() &&
      vault.toLowerCase() === base.vault.toLowerCase() &&
      depositReceipt?.status === "success" &&
      (!deployV2 ||
        (deployed.allocator?.toLowerCase() === allocator?.toLowerCase() &&
          decimals === 18 &&
          allocatorGranted === true &&
          adminAllocator === false));
    console.log(
      JSON.stringify(
        { pool: deployed.address, depositHash, deploymentVerified: verified },
        null,
        2,
      ),
    );
    process.exit(verified ? 0 : 2);
  }
  process.exit(
    lenderTokens >= amount && adminGas >= gasPrice * requiredAdminGas ? 0 : 2,
  );
}
if (!process.argv.includes("--execute"))
  throw new Error("USE_--check_OR_--execute");
if (existsSync(manifestPath) || existsSync(pendingPath))
  throw new Error("POOL_DEPLOYMENT_ALREADY_EXISTS_OR_PENDING_RECONCILE_FIRST");
if (lenderTokens < amount || adminGas < gasPrice * requiredAdminGas)
  throw new Error("PREFLIGHT_FAILED_NO_TRANSACTION_SENT");
mkdirSync(".local", { recursive: true });
const adminWallet = createWalletClient({ chain, transport, account: admin });
const lenderWallet = createWalletClient({ chain, transport, account: lender });
const transactions: Array<{ name: string; txHash: Hex; blockNumber: string }> =
  [];
function pending(name: string, txHash: Hex) {
  writeFileSync(
    pendingPath,
    JSON.stringify(
      {
        chainId,
        name,
        txHash,
        transactions,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
}
async function receipt(name: string, txHash: Hex) {
  pending(name, txHash);
  const result = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: chainId === 97 ? 3 : 1,
    timeout: 180_000,
  });
  if (result.status !== "success")
    throw new Error(`TRANSACTION_FAILED:${name}:${txHash}`);
  transactions.push({
    name,
    txHash,
    blockNumber: result.blockNumber.toString(),
  });
  pending("complete:" + name, txHash);
  console.log(`${name}: ${txHash} block=${result.blockNumber}`);
  return result;
}
const deployed = await receipt(
  "deploy",
  await adminWallet.deployContract({
    abi: poolAbi,
    bytecode: artifact("LiquidityPoolA").bytecode.object,
    args: [admin.address, base.vault],
  }),
);
const pool = deployed.contractAddress;
if (!pool) throw new Error("POOL_ADDRESS_MISSING");
await receipt(
  "grant-pool-vault-lender",
  await adminWallet.writeContract({
    address: base.vault,
    abi: vaultAbi,
    functionName: "grantRole",
    args: [keccak256(toHex("LENDER_ROLE")), pool],
  }),
);
await receipt(
  "grant-investor",
  await adminWallet.writeContract({
    address: pool,
    abi: poolAbi,
    functionName: "grantRole",
    args: [keccak256(toHex("INVESTOR_ROLE")), lender.address],
  }),
);
await receipt(
  "grant-allocator",
  await adminWallet.writeContract({
    address: pool,
    abi: poolAbi,
    functionName: "grantRole",
    args: [keccak256(toHex("ALLOCATOR_ROLE")), allocator!],
  }),
);
if (lenderGas < gasPrice * 350_000n)
  await receipt(
    "fund-investor-test-gas",
    await adminWallet.sendTransaction({
      to: lender.address,
      value: gasPrice * 500_000n,
    }),
  );
await receipt(
  "approve-deposit",
  await lenderWallet.writeContract({
    address: base.token,
    abi: tokenAbi,
    functionName: "approve",
    args: [pool, amount],
  }),
);
await receipt(
  "deposit-1-billion-MockIDR",
  await lenderWallet.writeContract({
    address: pool,
    abi: poolAbi,
    functionName: "deposit",
    args: [amount, riskHash],
  }),
);
const [
  stats,
  shares,
  tokenBalance,
  role,
  allocatorGranted,
  adminAllocator,
  decimals,
] = await Promise.all([
  publicClient.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "poolStats",
  }) as Promise<readonly bigint[]>,
  publicClient.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "balanceOf",
    args: [lender.address],
  }) as Promise<bigint>,
  publicClient.readContract({
    address: base.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [pool],
  }) as Promise<bigint>,
  publicClient.readContract({
    address: base.vault,
    abi: vaultAbi,
    functionName: "hasRole",
    args: [keccak256(toHex("LENDER_ROLE")), pool],
  }) as Promise<boolean>,
  publicClient.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "hasRole",
    args: [keccak256(toHex("ALLOCATOR_ROLE")), allocator!],
  }) as Promise<boolean>,
  publicClient.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "hasRole",
    args: [keccak256(toHex("ALLOCATOR_ROLE")), admin.address],
  }) as Promise<boolean>,
  publicClient.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "decimals",
  }) as Promise<number>,
]);
if (
  stats[0] !== amount ||
  stats[4] !== amount ||
  shares !== amount * 10n ** 18n ||
  tokenBalance !== amount ||
  !role ||
  !allocatorGranted ||
  adminAllocator ||
  decimals !== 18
)
  throw new Error("POOL_POST_DEPLOY_VERIFICATION_FAILED");
const manifest = {
  project: "TALUNAI",
  chainId,
  isSynthetic: true,
  version: 2,
  address: pool,
  asset: base.token,
  vault: base.vault,
  riskDisclosureHash: riskHash,
  initialInvestor: lender.address,
  allocator,
  shareDecimals: 18,
  initialDepositMockIDR: amount.toString(),
  deploymentStartBlock: deployed.blockNumber.toString(),
  transactions,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      pool,
      initialDepositMockIDR: amount.toString(),
      verified: true,
      manifestPath,
    },
    null,
    2,
  ),
);
