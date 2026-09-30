import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
export const localMnemonic =
  "test test test test test test test test test test test junk";
export const actorIndexes = {
  admin: 0,
  borrower: 1,
  buyer: 2,
  lender: 3,
  verifier: 4,
  agent: 5,
  outsider: 6,
  lenderTwo: 7,
} as const;
export type DemoRole = keyof typeof actorIndexes;
export function actor(role: DemoRole) {
  const chainId = Number(process.env.CHAIN_ID);
  if (chainId === 31337 && process.env.APP_ENV === "local")
    return mnemonicToAccount(localMnemonic, {
      addressIndex: actorIndexes[role],
    });
  if (chainId !== 97 || process.env.APP_ENV !== "testnet")
    throw new Error("DEMO_UNSUPPORTED_CHAIN");
  const key = process.env[`DEMO_${role.toUpperCase()}_PRIVATE_KEY`] as
    Hex | undefined;
  if (!key) throw new Error(`MISSING_TEST_KEY:${role}`);
  const account = privateKeyToAccount(key);
  for (let i = 0; i < 10; i++)
    if (
      account.address ===
      mnemonicToAccount(localMnemonic, { addressIndex: i }).address
    )
      throw new Error("PUBLIC_ANVIL_KEY_FORBIDDEN_ON_TESTNET");
  return account;
}
