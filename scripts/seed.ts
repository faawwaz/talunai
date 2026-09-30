import { mnemonicToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { getSql, closeDb } from "../packages/db";
const chainId = Number(process.env.CHAIN_ID);
if (chainId !== 31337 && chainId !== 97)
  throw new Error("SEED_TEST_CHAINS_ONLY");
if (
  (await createPublicClient({
    transport: http(process.env.RPC_HTTP_URL),
  }).getChainId()) !== chainId
)
  throw new Error("RPC_CHAIN_MISMATCH");
const actors = [
  ["admin", 0, "ADMIN", "TALUNAI demo operator"],
  ["borrower", 1, "BORROWER", "Koperasi Kakao Sintetis"],
  ["buyer", 2, "BUYER", "Pembeli Kakao Sintetis"],
  ["lender", 3, "LENDER", "Lender Sintetis"],
  ["verifier", 4, "VERIFIER", "Verifier Sintetis"],
  ["lenderTwo", 7, "LENDER", "Lender Kedua Sintetis"],
] as const;
const sql = getSql();
for (const [name, index, role, display] of actors) {
  const supplied = process.env[`SEED_${name.toUpperCase()}_ADDRESS`];
  const address = (
    chainId === 31337
      ? mnemonicToAccount(
          "test test test test test test test test test test test junk",
          { addressIndex: index },
        ).address
      : supplied
  )?.toLowerCase();
  if (!address || !/^0x[0-9a-f]{40}$/.test(address))
    throw new Error(`SEED_${name.toUpperCase()}_ADDRESS_REQUIRED`);
  if (
    chainId === 97 &&
    address ===
      mnemonicToAccount(
        "test test test test test test test test test test test junk",
        { addressIndex: index },
      ).address.toLowerCase()
  )
    throw new Error("PUBLIC_ANVIL_ACCOUNT_FORBIDDEN");
  await sql.begin(async (tx) => {
    await tx`INSERT INTO organizations(id,name,kind,status,synthetic) VALUES(${`org-${name}`},${display},${role},'APPROVED',true) ON CONFLICT(id) DO NOTHING`;
    const existing =
      await tx`SELECT user_id FROM wallets WHERE address=${address}`;
    const userId = existing[0]?.user_id ?? `user-${name}`;
    await tx`INSERT INTO users(id,status) VALUES(${userId},'PROVISIONED_SYNTHETIC') ON CONFLICT(id) DO UPDATE SET status='PROVISIONED_SYNTHETIC'`;
    await tx`INSERT INTO wallets(address,user_id) VALUES(${address},${userId}) ON CONFLICT(address) DO NOTHING`;
    await tx`INSERT INTO memberships(id,user_id,organization_id,role,approved) VALUES(${`membership-${name}`},${userId},${`org-${name}`},${role},true) ON CONFLICT(user_id,organization_id,role) DO UPDATE SET approved=true`;
  });
  console.log(
    JSON.stringify({
      actor: name,
      address,
      organizationId: `org-${name}`,
      synthetic: true,
    }),
  );
}
await closeDb();
