import { z } from "zod";
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((v) => !/^0x0{40}$/.test(v));
export function config() {
  const env = z
    .object({
      APP_ENV: z.enum(["local", "testnet"]).default("local"),
      DATABASE_URL: z.string().min(1),
      APP_ORIGIN: z.string().url().default("http://localhost:3000"),
      SIWE_DOMAIN: z.string().min(1).default("localhost:3000"),
      SIWE_URI: z.string().url().default("http://localhost:3000"),
      SESSION_SECRET: z.string().min(32),
      CLAIM_ID_HMAC_KEY: z.string().min(32),
      CLAIM_ID_HMAC_KEY_VERSION: z.coerce.number().int().positive().default(1),
      CHAIN_ID: z.coerce.number().refine((v) => v === 31337 || v === 97),
      RPC_HTTP_URL: z.string().url(),
      CONTRACT_REGISTRY_ADDRESS: address,
      CONTRACT_VAULT_ADDRESS: address,
      CONTRACT_AGENT_EXECUTOR_ADDRESS: address,
      MOCK_IDR_ADDRESS: address,
      CHAIN_CONFIRMATIONS: z.coerce.number().int().positive().default(2),
      INDEXER_RESCAN_BLOCKS: z.coerce.number().int().min(2).default(20),
      LLM_MODE: z.enum(["mock", "live"]).default("mock"),
      OPENROUTER_API_KEY: z.string().optional(),
      OPENROUTER_MODEL: z.string().default("qwen/qwen3.5-flash-02-23"),
      DOCUMENT_STORAGE_ROOT: z.string().default("./.private/documents"),
      DOCUMENT_MAX_BYTES: z.coerce
        .number()
        .int()
        .positive()
        .max(10485760)
        .default(10485760),
      DOCUMENT_MAX_PAGES: z.coerce
        .number()
        .int()
        .positive()
        .max(20)
        .default(20),
    })
    .parse(process.env);
  const url = new URL(env.APP_ORIGIN);
  if (
    url.origin !== env.APP_ORIGIN ||
    new URL(env.SIWE_URI).origin !== env.APP_ORIGIN ||
    env.SIWE_DOMAIN !== url.host
  )
    throw new Error("ORIGIN_CONFIG_MISMATCH");
  if (
    env.APP_ENV === "testnet" &&
    (env.CHAIN_ID !== 97 || url.protocol !== "https:")
  )
    throw new Error("TESTNET_REQUIRES_CHAIN_97_HTTPS");
  if (env.APP_ENV === "local" && env.CHAIN_ID !== 31337)
    throw new Error("LOCAL_REQUIRES_ANVIL");
  return env;
}
