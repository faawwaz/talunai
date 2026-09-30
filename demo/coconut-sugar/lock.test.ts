import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { acquireCaseLock, type CaseLockOwner } from "./lock";

async function fixture(run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "talunai-case-lock-"));
  try {
    await run(join(directory, "case.lock"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function deadPid() {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await once(child, "exit");
  assert.equal(typeof child.pid, "number");
  return child.pid!;
}

async function deadOwner(path: string): Promise<CaseLockOwner> {
  const lock = await acquireCaseLock(path, "test");
  await lock.release();
  return { ...lock.owner, token: randomUUID(), pid: await deadPid() };
}

test("releases its own lock and repeated cleanup is harmless", async () => {
  await fixture(async (path) => {
    const lock = await acquireCaseLock(path, "test");
    assert.equal(await lock.isOwned(), true);
    await lock.release();
    assert.equal(await lock.isOwned(), false);
    await lock.release();
    await assert.rejects(readFile(path), { code: "ENOENT" });
  });
});

test("cleanup tolerates a lock removed externally", async () => {
  await fixture(async (path) => {
    const lock = await acquireCaseLock(path, "test");
    await unlink(path);
    await lock.release();
    assert.equal(await lock.isOwned(), false);
  });
});

test("competing acquisition preserves the active owner", async () => {
  await fixture(async (path) => {
    const lock = await acquireCaseLock(path, "first");
    await assert.rejects(
      acquireCaseLock(path, "second"),
      /CASE_ALREADY_RUNNING/,
    );
    assert.equal(await lock.isOwned(), true);
    await lock.release();
  });
});

test("old cleanup never removes a replacement owner's token", async () => {
  await fixture(async (path) => {
    const lock = await acquireCaseLock(path, "first");
    const replacement = {
      ...lock.owner,
      token: randomUUID(),
      instance: "second",
    };
    await writeFile(path, JSON.stringify(replacement));
    await lock.release();
    assert.equal(await lock.isOwned(), false);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), replacement);
  });
});

test("a dead PID from a foreign namespace is never reclaimed", async () => {
  await fixture(async (path) => {
    const prior = await deadOwner(path);
    const namespace = Number(prior.pidNamespace.match(/\d+/)![0]);
    const foreign = { ...prior, pidNamespace: `pid:[${namespace + 1}]` };
    await writeFile(path, JSON.stringify(foreign));
    await assert.rejects(acquireCaseLock(path, "test"), /CASE_ALREADY_RUNNING/);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), foreign);
  });
});

test("a dead PID from a different boot is never reclaimed", async () => {
  await fixture(async (path) => {
    const prior = { ...(await deadOwner(path)), bootId: randomUUID() };
    await writeFile(path, JSON.stringify(prior));
    await assert.rejects(acquireCaseLock(path, "test"), /CASE_ALREADY_RUNNING/);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), prior);
  });
});

test("legacy and malformed locks require explicit recovery", async () => {
  await fixture(async (path) => {
    for (const prior of [
      JSON.stringify({ pid: await deadPid() }),
      "not-json",
    ]) {
      await writeFile(path, prior);
      await assert.rejects(
        acquireCaseLock(path, "test"),
        /CASE_ALREADY_RUNNING/,
      );
      assert.equal(await readFile(path, "utf8"), prior);
    }
  });
});

test("provably dead owner from the same namespace and boot is recovered", async () => {
  await fixture(async (path) => {
    const prior = await deadOwner(path);
    await writeFile(path, JSON.stringify(prior));
    const lock = await acquireCaseLock(path, "recovered");
    assert.notEqual(lock.owner.token, prior.token);
    assert.equal(await lock.isOwned(), true);
    await assert.rejects(readFile(`${path}.reclaim`), { code: "ENOENT" });
    await lock.release();
  });
});

test("competing stale reclaimers leave exactly one intact new owner", async () => {
  await fixture(async (path) => {
    await writeFile(path, JSON.stringify(await deadOwner(path)));
    const results = await Promise.allSettled([
      acquireCaseLock(path, "first"),
      acquireCaseLock(path, "second"),
    ]);
    const successful = results.filter(
      (result) => result.status === "fulfilled",
    );
    assert.equal(successful.length, 1);
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      1,
    );
    const lock = successful[0].value;
    assert.equal(await lock.isOwned(), true);
    await lock.release();
  });
});

test("an existing recovery guard is never stolen", async () => {
  await fixture(async (path) => {
    const prior = await deadOwner(path);
    await writeFile(path, JSON.stringify(prior));
    await writeFile(`${path}.reclaim`, "operator-or-other-reclaimer");
    await assert.rejects(
      acquireCaseLock(path, "test"),
      /CASE_LOCK_RECOVERY_IN_PROGRESS/,
    );
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), prior);
    assert.equal(
      await readFile(`${path}.reclaim`, "utf8"),
      "operator-or-other-reclaimer",
    );
  });
});

test("cleanup propagates filesystem failures other than missing files", async () => {
  await fixture(async (path) => {
    const lock = await acquireCaseLock(path, "test");
    await unlink(path);
    await mkdir(path);
    await assert.rejects(lock.release(), { code: "EISDIR" });
  });
});
