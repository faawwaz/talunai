import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readlink, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export interface CaseLockOwner {
  token: string;
  pid: number;
  pidNamespace: string;
  bootId: string;
  instance: string;
}

export interface CaseLock {
  readonly owner: Readonly<CaseLockOwner>;
  isOwned(): Promise<boolean>;
  release(): Promise<void>;
}

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

async function readOwner(path: string): Promise<CaseLockOwner | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (errno(error) === "ENOENT") return null;
    throw error;
  }
  try {
    const owner = JSON.parse(text) as Partial<CaseLockOwner> | null;
    if (
      !owner ||
      typeof owner.token !== "string" ||
      !uuid.test(owner.token) ||
      !Number.isSafeInteger(owner.pid) ||
      (owner.pid ?? 0) <= 0 ||
      typeof owner.pidNamespace !== "string" ||
      !/^pid:\[\d+\]$/.test(owner.pidNamespace) ||
      typeof owner.bootId !== "string" ||
      !uuid.test(owner.bootId) ||
      typeof owner.instance !== "string"
    )
      return null;
    return owner as CaseLockOwner;
  } catch {
    return null;
  }
}

function sameOwner(left: CaseLockOwner | null, right: CaseLockOwner): boolean {
  return (
    left?.token === right.token &&
    left.pid === right.pid &&
    left.pidNamespace === right.pidNamespace &&
    left.bootId === right.bootId
  );
}

function provablyDead(owner: CaseLockOwner, current: CaseLockOwner): boolean {
  if (
    owner.pidNamespace !== current.pidNamespace ||
    owner.bootId !== current.bootId
  )
    return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return errno(error) === "ESRCH";
  }
}

async function writeExclusive(path: string, owner: CaseLockOwner) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(owner));
  } finally {
    await file.close();
  }
}

async function releaseOwned(path: string, owner: CaseLockOwner) {
  if (!sameOwner(await readOwner(path), owner)) return;
  try {
    await unlink(path);
  } catch (error) {
    if (errno(error) !== "ENOENT") throw error;
  }
}

/** Serialize all case instances without treating foreign PID namespaces as dead. */
export async function acquireCaseLock(
  path: string,
  instance: string,
): Promise<CaseLock> {
  const [pidNamespace, bootId] = await Promise.all([
    readlink("/proc/self/ns/pid"),
    readFile("/proc/sys/kernel/random/boot_id", "utf8"),
  ]);
  const owner: CaseLockOwner = {
    token: randomUUID(),
    pid: process.pid,
    pidNamespace,
    bootId: bootId.trim(),
    instance,
  };
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeExclusive(path, owner);
  } catch (error) {
    if (errno(error) !== "EEXIST") throw error;
    const prior = await readOwner(path);
    // Legacy, malformed, foreign, and live owners require explicit operator recovery.
    if (!prior || !provablyDead(prior, owner))
      throw new Error("CASE_ALREADY_RUNNING");

    const guardPath = `${path}.reclaim`;
    try {
      await writeExclusive(guardPath, owner);
    } catch (guardError) {
      if (errno(guardError) === "EEXIST")
        throw new Error("CASE_LOCK_RECOVERY_IN_PROGRESS");
      throw guardError;
    }
    let primaryError: unknown;
    try {
      const current = await readOwner(path);
      if (!sameOwner(current, prior) || !provablyDead(prior, owner))
        throw new Error("CASE_ALREADY_RUNNING");
      await unlink(path);
      // Another regular acquirer may win after unlink; wx keeps its lock intact.
      await writeExclusive(path, owner);
    } catch (reclaimError) {
      primaryError = reclaimError;
    }
    try {
      await releaseOwned(guardPath, owner);
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
      console.error(
        JSON.stringify({
          status: "CLEANUP_FAILED",
          phase: "CASE_LOCK_RECLAIMER",
          code: errno(cleanupError) ?? "CASE_LOCK_CLEANUP_FAILED",
        }),
      );
    }
    if (primaryError) throw primaryError;
  }
  return {
    owner,
    isOwned: async () => sameOwner(await readOwner(path), owner),
    release: () => releaseOwned(path, owner),
  };
}
