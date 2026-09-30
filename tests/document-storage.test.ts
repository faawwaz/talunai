import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  documentStorage,
  SupabaseDocumentStorage,
} from "../packages/agents/storage";
import { documentCommitment } from "../packages/domain/identity";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const origin = "https://storage-project.supabase.co";
const bucket = "talunai-documents";
const key = "unit-test-service-key";
const storageKey = "5f4bbf62-3e62-4b82-9e65-2e8d12497fcf.bin";
const store = () => new SupabaseDocumentStorage(origin, key, bucket);

describe("private Supabase evidence storage", () => {
  it("stores original bytes and salt, preserving the existing commitment format", async () => {
    const objects = new Map<string, Buffer>();
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      expect(headers.apikey).toBe(key);
      expect(headers.Authorization).toBe(`Bearer ${key}`);
      expect(init.cache).toBe("no-store");
      expect(init.redirect).toBe("error");
      if (url.endsWith(`/bucket/${bucket}`))
        return Response.json({ id: bucket, public: false });
      if (init.method === "POST") {
        expect(headers["x-upsert"]).toBe("false");
        objects.set(
          url.split("/").at(-1)!,
          Buffer.from(init.body as Uint8Array),
        );
        return Response.json({ Key: "saved" });
      }
      expect(url).toContain(`/object/authenticated/${bucket}/`);
      return new Response(new Uint8Array(objects.get(url.split("/").at(-1)!)!));
    });
    vi.stubGlobal("fetch", fetcher);
    const bytes = Buffer.from("%PDF-1.4 synthetic evidence");
    const result = await store().put(bytes);
    expect(result.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(result.commitment).toBe(
      documentCommitment(
        bytes,
          Buffer.from(objects.get(`${result.storageKey}.salt`)!.toString(), "hex"),
      ).commitment,
    );
    expect(await store().get(result.storageKey)).toEqual(bytes);
  });

  it("refuses a public bucket before any document upload", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ id: bucket, public: true }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(store().put(Buffer.from("invoice"))).rejects.toThrow(
      "DOCUMENT_STORAGE_MUST_BE_PRIVATE",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("removes the uploaded object if its private salt cannot be saved", async () => {
    let removed: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith(`/bucket/${bucket}`))
          return Response.json({ id: bucket, public: false });
        if (init.method === "DELETE") {
          removed = JSON.parse(String(init.body)).prefixes;
          return Response.json([]);
        }
        if (url.endsWith(".salt"))
          return new Response("private upstream details", { status: 503 });
        return Response.json({});
      }),
    );
    await expect(store().put(Buffer.from("invoice"))).rejects.toThrow(
      "DOCUMENT_STORAGE_HTTP_503",
    );
    expect(removed).toHaveLength(2);
    expect(removed[1]).toBe(`${removed[0]}.salt`);
  });

  it.each([
    "../secrets",
    `${storageKey}/../../another`,
    `${storageKey}.salt`,
    "https://another.example/a",
  ])("rejects non-document storage keys: %s", async (invalid) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(store().get(invalid)).rejects.toThrow("INVALID_STORAGE_KEY");
    await expect(store().remove(invalid)).rejects.toThrow(
      "INVALID_STORAGE_KEY",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not leak upstream error bodies or secrets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`secret: ${key}`, { status: 403 })),
    );
    await expect(store().get(storageKey)).rejects.toThrow(
      /^DOCUMENT_STORAGE_HTTP_403$/,
    );
  });

  it("fails instead of falling back to a local folder when Supabase configuration is missing", () => {
    vi.stubEnv("DOCUMENT_STORAGE_DRIVER", "supabase");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => documentStorage()).toThrow("SUPABASE_STORAGE_CONFIG_REQUIRED");
  });

  it("rejects Vercel filesystem storage", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("DOCUMENT_STORAGE_DRIVER", "filesystem");
    expect(() => documentStorage()).toThrow(
      "VERCEL_REQUIRES_SHARED_DOCUMENT_STORAGE",
    );
  });
});
