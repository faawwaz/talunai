import { readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { getSql } from "../db";
import { FileDocumentStorage } from "./documents";
/** Only unreferenced generated files older than an hour are removed. Referenced evidence
 * retention is recorded, not automatically destroyed while a financing dispute exists. */
export async function cleanAbandonedUploads() {
  const storage = new FileDocumentStorage(
    process.env.DOCUMENT_STORAGE_ROOT ?? "./.local/documents",
  );
  let names: string[];
  try {
    names = await readdir(storage.root);
  } catch {
    return 0;
  }
  let removed = 0;
  const sql = getSql();
  for (const name of names) {
    if (!/^[0-9a-f-]{36}\.bin$/.test(name)) continue;
    const stat = await lstat(join(storage.root, name));
    if (!stat.isFile() || stat.mtimeMs > Date.now() - 3600000) continue;
    const existing =
      await sql`SELECT id FROM documents WHERE storage_key=${name}`;
    if (!existing.length) {
      await storage.remove(name);
      removed++;
    }
  }
  return removed;
}
