import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { documentCommitment } from "../domain/identity";

export type DocumentLimits = {
  maxBytes: number;
  maxPages: number;
  maxTextLength: number;
  timeoutMs: number;
};
const DEFAULTS: DocumentLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxPages: 20,
  maxTextLength: 200_000,
  timeoutMs: 10_000,
};
export type ParsedDocument = {
  text: string;
  pages: number;
  status: "PARSED" | "NEEDS_MANUAL_ENTRY";
  mime: string;
};

/** Cheap upload-boundary validation only. Full PDF parsing belongs to the worker. */
export function validateDocumentEnvelope(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  options: Partial<DocumentLimits> = {},
): { mime: string } {
  const limits = { ...DEFAULTS, ...options };
  if (!bytes.byteLength || bytes.byteLength > limits.maxBytes)
    throw new Error("DOCUMENT_SIZE_LIMIT");
  if (
    filename !== basename(filename) ||
    /[\\\x00-\x1f]/.test(filename) ||
    filename.includes("..") ||
    filename.length > 180
  )
    throw new Error("INVALID_DOCUMENT_FILENAME");
  const extension = extname(filename).toLowerCase();
  if (extension === ".pdf" && mime === "application/pdf") {
    if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-")
      throw new Error("FILE_SIGNATURE_MISMATCH");
    return { mime };
  }
  if (
    !(extension === ".txt" && mime === "text/plain") &&
    !(extension === ".json" && mime === "application/json")
  )
    throw new Error("UNSUPPORTED_DOCUMENT_FORMAT");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("INVALID_UTF8");
  }
  if (/[\x00-\x08\x0b\x0e-\x1f]/.test(text) || text.startsWith("%PDF-"))
    throw new Error("FILE_SIGNATURE_MISMATCH");
  if (text.length > limits.maxTextLength)
    throw new Error("DOCUMENT_TEXT_LIMIT");
  if (extension === ".json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("INVALID_JSON_DOCUMENT");
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as Record<string, unknown>).isSynthetic !== true
    )
      throw new Error("SYNTHETIC_JSON_REQUIRED");
    if (
      Object.values(parsed).some(
        (value) => typeof value !== "string" && typeof value !== "boolean",
      )
    )
      throw new Error("JSON_STRING_FIELDS_REQUIRED");
  }
  return { mime };
}

export async function parseDocument(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  options: Partial<DocumentLimits> = {},
): Promise<ParsedDocument> {
  const limits = { ...DEFAULTS, ...options };
  validateDocumentEnvelope(bytes, filename, mime, limits);
  if (!bytes.byteLength || bytes.byteLength > limits.maxBytes)
    throw new Error("DOCUMENT_SIZE_LIMIT");
  if (
    filename !== basename(filename) ||
    /[\\\x00-\x1f]/.test(filename) ||
    filename.includes("..") ||
    filename.length > 180
  )
    throw new Error("INVALID_DOCUMENT_FILENAME");
  const extension = extname(filename).toLowerCase();
  const source = Buffer.from(bytes);
  if (extension === ".pdf" && mime === "application/pdf") {
    if (source.subarray(0, 5).toString() !== "%PDF-")
      throw new Error("FILE_SIGNATURE_MISMATCH");
    const output = await parsePdfIsolated(source, limits);
    return {
      ...output,
      status: output.text.trim().length < 8 ? "NEEDS_MANUAL_ENTRY" : "PARSED",
      mime,
    };
  }
  if (
    !(extension === ".txt" && mime === "text/plain") &&
    !(extension === ".json" && mime === "application/json")
  )
    throw new Error("UNSUPPORTED_DOCUMENT_FORMAT");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(source);
  } catch {
    throw new Error("INVALID_UTF8");
  }
  if (/[\x00-\x08\x0b\x0e-\x1f]/.test(text) || text.startsWith("%PDF-"))
    throw new Error("FILE_SIGNATURE_MISMATCH");
  if (extension === ".json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("INVALID_JSON_DOCUMENT");
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as Record<string, unknown>).isSynthetic !== true
    )
      throw new Error("SYNTHETIC_JSON_REQUIRED");
    const data = parsed as Record<string, unknown>;
    if (
      Object.values(data).some(
        (value) => typeof value !== "string" && typeof value !== "boolean",
      )
    )
      throw new Error("JSON_STRING_FIELDS_REQUIRED");
    text = Object.entries(data)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
  }
  if (text.length > limits.maxTextLength)
    throw new Error("DOCUMENT_TEXT_LIMIT");
  return {
    text,
    pages: 1,
    status: text.trim().length < 8 ? "NEEDS_MANUAL_ENTRY" : "PARSED",
    mime,
  };
}

async function parsePdfIsolated(
  bytes: Buffer,
  limits: DocumentLimits,
): Promise<{ text: string; pages: number }> {
  return new Promise((resolveResult, reject) => {
    // cwd is the repository root for web and worker, including Docker. No user-controlled path reaches spawn.
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=128",
        resolve(process.cwd(), "packages/agents/pdf-parser.mjs"),
        String(limits.maxPages),
        String(limits.maxTextLength),
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV },
      },
    );
    let stdout = "",
      stderr = "",
      settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else {
        try {
          const result = JSON.parse(stdout);
          if (
            typeof result.text !== "string" ||
            result.text.length > limits.maxTextLength ||
            !Number.isInteger(result.pages)
          )
            throw new Error("PDF_MALFORMED");
          resolveResult(result);
        } catch {
          reject(new Error("PDF_MALFORMED"));
        }
      }
    };
    const timer = setTimeout(
      () => finish(new Error("PDF_PARSE_TIMEOUT")),
      limits.timeoutMs,
    );
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > limits.maxTextLength * 6 + 1024)
        finish(new Error("DOCUMENT_TEXT_LIMIT"));
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    child.on("error", () => finish(new Error("PDF_PARSER_UNAVAILABLE")));
    child.on("close", (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(
              ["PDF_ENCRYPTED", "PDF_PAGE_LIMIT", "DOCUMENT_TEXT_LIMIT"].find(
                (value) => stderr.includes(value),
              ) ?? "PDF_MALFORMED",
            ),
      ),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(bytes);
  });
}

export class FileDocumentStorage {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
    if (
      this.root === resolve("public") ||
      this.root.startsWith(resolve("public") + "/")
    )
      throw new Error("DOCUMENT_STORAGE_MUST_BE_PRIVATE");
  }
  private path(key: string) {
    if (!/^[0-9a-f-]{36}\.bin$/.test(key))
      throw new Error("INVALID_STORAGE_KEY");
    return join(this.root, key);
  }
  async put(bytes: Uint8Array) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const storageKey = `${randomUUID()}.bin`;
    await writeFile(this.path(storageKey), bytes, { mode: 0o600, flag: "wx" });
    const { commitment, salt } = documentCommitment(bytes);
    // Salt is private metadata, stored next to bytes, never returned in public document metadata.
    await writeFile(`${this.path(storageKey)}.salt`, salt, {
      mode: 0o600,
      flag: "wx",
    });
    return {
      storageKey,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      commitment,
    };
  }
  get(storageKey: string) {
    return readFile(this.path(storageKey));
  }
  async remove(storageKey: string) {
    await Promise.all([
      unlink(this.path(storageKey)).catch(() => {}),
      unlink(`${this.path(storageKey)}.salt`).catch(() => {}),
    ]);
  }
}
