import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { privateKeyToAccount } from "viem/accounts";

const root = process.cwd();
const readEnv = async (name) =>
  parseEnv(await readFile(resolve(root, name), "utf8"));
const [testnet, worker, local] = await Promise.all([
  readEnv(".env.testnet"),
  readEnv(".env.worker"),
  readEnv(".env.local"),
]);

if (testnet.APP_ENV !== "testnet" || Number(testnet.CHAIN_ID) !== 97)
  throw new Error("TESTNET_CONFIGURATION_REQUIRED");

const actors = [
  [
    "Admin",
    "ADMIN · operator, allocator, minter token uji",
    "DEMO_ADMIN_PRIVATE_KEY",
    testnet,
    "SEED_ADMIN_ADDRESS",
    "/admin",
  ],
  [
    "Borrower",
    "BORROWER · pemasok",
    "DEMO_BORROWER_PRIVATE_KEY",
    testnet,
    "SEED_BORROWER_ADDRESS",
    "/borrower",
  ],
  [
    "Buyer",
    "BUYER · pembeli",
    "DEMO_BUYER_PRIVATE_KEY",
    testnet,
    "SEED_BUYER_ADDRESS",
    "/buyer",
  ],
  [
    "Lender",
    "LENDER · investor",
    "DEMO_LENDER_PRIVATE_KEY",
    testnet,
    "SEED_LENDER_ADDRESS",
    "/lender",
  ],
  [
    "Lender kedua",
    "LENDER · investor kedua",
    "DEMO_LENDERTWO_PRIVATE_KEY",
    testnet,
    "SEED_LENDERTWO_ADDRESS",
    "/lender",
  ],
  [
    "Verifier",
    "VERIFIER · reviewer independen",
    "DEMO_VERIFIER_PRIVATE_KEY",
    testnet,
    "SEED_VERIFIER_ADDRESS",
    "/verifier",
  ],
  [
    "Agent worker",
    "AGENT_ROLE onchain · proses server; bukan akun UI",
    "AGENT_PRIVATE_KEY",
    worker,
    "AGENT_ADDRESS",
    "Jangan impor ke browser",
  ],
];

const knownKeys = new Set(actors.map(([, , name]) => name));
const configuredActorKeys = [
  ...Object.keys(testnet),
  ...Object.keys(worker),
].filter((name) => /^DEMO_.*_PRIVATE_KEY$|^AGENT_PRIVATE_KEY$/.test(name));
for (const name of configuredActorKeys)
  if (!knownKeys.has(name)) throw new Error(`UNCLASSIFIED_ACTOR_KEY:${name}`);

const rows = actors.map(([name, role, keyName, env, expectedName, route]) => {
  const key = env[keyName];
  if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? ""))
    throw new Error(`MISSING_OR_INVALID_ACTOR_KEY:${keyName}`);
  const address = privateKeyToAccount(key).address;
  const expected =
    expectedName === "AGENT_ADDRESS"
      ? testnet.AGENT_ADDRESS
      : local[expectedName];
  if (!expected || address.toLowerCase() !== expected.toLowerCase())
    throw new Error(`ACTOR_ADDRESS_MISMATCH:${name}`);
  return { name, role, address, key, route };
});

const lines = [
  "# Wallet TALUNAI — BSC Testnet (lokal)",
  "",
  "> **Rahasia:** file ini berisi private key sungguhan untuk akun testnet. Simpan lokal, jangan unggah, commit, atau bagikan. Semua token MockIDR tidak memiliki nilai rupiah.",
  "",
  "- Jaringan: BSC Testnet, chain ID `97`.",
  "- Alamat login sesuai `.env.local`: **https://localhost:3000/app**. Jangan gunakan `https://127.0.0.1:3000` karena Origin SIWE/API dikunci ke `localhost`.",
  "- Jalankan web dengan `npm run dev:https`, impor **satu** private key peserta ke wallet browser, pilih BSC Testnet, lalu tanda tangani pesan login. Tidak ada transfer token saat login.",
  "- Role aplikasi berasal dari membership database; `scripts/seed.ts` menyediakan keenam akun peserta/operator di bawah. Daftar ini memverifikasi kecocokan key dan alamat seed, bukan pemeriksaan ulang status database yang sedang berjalan.",
  "- Agent worker memakai key server untuk aksi agent; akun ini tidak memiliki workspace peserta dan tidak perlu diimpor ke wallet browser.",
  "",
  "| Akun | Role | Address | Private key | Workspace |",
  "| --- | --- | --- | --- | --- |",
  ...rows.map(
    ({ name, role, address, key, route }) =>
      `| ${name} | ${role} | \`${address}\` | \`${key}\` | ${route} |`,
  ),
  "",
  "Jika login berhasil tetapi workspace menolak akses, periksa wallet aktif di ekstensi, URL `localhost` (bukan `127.0.0.1`), chain 97, dan membership yang ditampilkan di `/app`. Wallet baru akan masuk alur permohonan akses; pilihan role dalam form tidak langsung memberi izin.",
  "",
];

const directory = resolve(root, ".private");
const destination = resolve(directory, "TESTNET_WALLETS.md");
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
await writeFile(destination, lines.join("\n"), { mode: 0o600 });
await chmod(destination, 0o600);
process.stdout.write(
  `Wrote ${destination} with ${rows.length} verified testnet accounts.\n`,
);
