import { createHash, randomUUID } from "node:crypto";
import { FileDocumentStorage } from "./documents";
import { documentCommitment } from "../domain/identity";

export interface DocumentStorage {
  put(bytes: Uint8Array): Promise<{
    storageKey: string;
    sha256: string;
    commitment: string;
  }>;
  get(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}

/** Server-only storage. Downloads still pass through the Deal authorization API. */
export class SupabaseDocumentStorage implements DocumentStorage {
  private readonly base: string;
  constructor(
    url: string,
    private readonly key: string,
    private readonly bucket: string,
  ) {
    const origin = new URL(url);
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/" ||
      !key ||
      !/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket)
    )
      throw new Error("DOCUMENT_STORAGE_CONFIG_INVALID");
    this.base = `${origin.origin}/storage/v1`;
  }

  private validate(storageKey: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bin$/.test(
        storageKey,
      )
    )
      throw new Error("INVALID_STORAGE_KEY");
  }

  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.base}/${path}`, {
      ...init,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        ...init.headers,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      // Provider response bodies can contain infrastructure details; never expose them.
      throw new Error(`DOCUMENT_STORAGE_HTTP_${response.status}`);
    }
    return response;
  }

  async assertPrivateBucket() {
    const response = await this.request(`bucket/${this.bucket}`);
    const bucket = (await response.json()) as { id?: string; public?: boolean };
    if (bucket.id !== this.bucket || bucket.public !== false)
      throw new Error("DOCUMENT_STORAGE_MUST_BE_PRIVATE");
  }

  async put(bytes: Uint8Array) {
    await this.assertPrivateBucket();
    const storageKey = `${randomUUID()}.bin`;
    const { commitment, salt } = documentCommitment(bytes);
    const upload = async (name: string, content: Uint8Array) => {
      const response = await this.request(`object/${this.bucket}/${name}`, {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-upsert": "false",
        },
        body: new Uint8Array(content),
      });
      await response.body?.cancel();
    };
    await upload(storageKey, bytes);
    try {
      await upload(`${storageKey}.salt`, Buffer.from(salt));
    } catch (error) {
      await this.remove(storageKey).catch(() => {});
      throw error;
    }
    return {
      storageKey,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      commitment,
    };
  }

  async get(storageKey: string) {
    this.validate(storageKey);
    const response = await this.request(
      `object/authenticated/${this.bucket}/${storageKey}`,
    );
    return Buffer.from(await response.arrayBuffer());
  }

  async remove(storageKey: string) {
    this.validate(storageKey);
    const response = await this.request(`object/${this.bucket}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefixes: [storageKey, `${storageKey}.salt`] }),
    });
    await response.body?.cancel();
  }
}

export function documentStorage(): DocumentStorage {
  const driver = process.env.DOCUMENT_STORAGE_DRIVER ?? "filesystem";
  if (driver === "filesystem") {
    if (process.env.VERCEL === "1")
      throw new Error("VERCEL_REQUIRES_SHARED_DOCUMENT_STORAGE");
    return new FileDocumentStorage(
      process.env.DOCUMENT_STORAGE_ROOT ?? "./.private/documents",
    );
  }
  if (driver !== "supabase") throw new Error("DOCUMENT_STORAGE_DRIVER_INVALID");
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET } =
    process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_STORAGE_BUCKET)
    throw new Error("SUPABASE_STORAGE_CONFIG_REQUIRED");
  return new SupabaseDocumentStorage(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_STORAGE_BUCKET,
  );
}
