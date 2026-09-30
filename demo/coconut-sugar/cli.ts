import { resolve } from "node:path";
import { closeDb } from "../../packages/db";
import {
  artifact,
  exportTruth,
  instance,
  privateOutput,
  safeError,
  save,
  state,
} from "./common";
import { prepare } from "./prepare";
import { runCase } from "./run";
import { validateDocuments } from "./validate";
import { exportSummary } from "./summary";
import { acquireCaseLock, type CaseLock } from "./lock";

const command = process.argv[2] ?? "prepare";
const attemptedAt = new Date().toISOString();
const capture = !process.argv.includes("--no-capture");
// All instances share participant wallets, so serialize the whole case family.
const lockPath = resolve(privateOutput, "case.lock");
let lock: CaseLock | undefined;
try {
  lock = await acquireCaseLock(lockPath, instance);
  if (command === "prepare") {
    const s = await prepare(process.argv.includes("--documents-only"), capture);
    await exportSummary(s);
  } else if (command === "run") await runCase(capture);
  else if (command === "validate") {
    await validateDocuments();
    const s = await state();
    await exportTruth(s);
    await exportSummary(s);
  } else throw new Error("UNKNOWN_CASE_COMMAND");
  const completedState = await state();
  await save(artifact("last-attempt.json"), {
    command,
    status: "PASSED",
    attemptedAt,
    completedAt: new Date().toISOString(),
    executionStatus: completedState.executionStatus,
    confirmedTransactionCount: completedState.transactions.filter(
      (tx) => tx.status === "CONFIRMED",
    ).length,
  });
} catch (e) {
  const error = safeError(e);
  console.error(
    JSON.stringify({
      status: "FAILED",
      code: error,
      actualExecutionNotInvented: true,
    }),
  );
  process.exitCode = 1;
  try {
    if (lock && (await lock.isOwned())) {
      const s = await state();
      if (s.executionStatus !== "COMPLETED") s.executionStatus = "BLOCKED";
      await save(artifact("case-state.json"), s);
      await save(artifact("last-attempt.json"), {
        command,
        status: "FAILED",
        error,
        attemptedAt,
        failedAt: new Date().toISOString(),
        confirmedTransactionCount: s.transactions.filter(
          (tx) => tx.status === "CONFIRMED",
        ).length,
      });
      await exportTruth(s);
      await exportSummary(s);
    }
  } catch (reportError) {
    console.error(
      JSON.stringify({
        status: "ERROR_REPORT_FAILED",
        code: safeError(reportError),
        originalError: error,
      }),
    );
  }
} finally {
  for (const [phase, cleanup] of [
    ["DATABASE", closeDb],
    ["CASE_LOCK", () => lock?.release()],
  ] as const) {
    try {
      await cleanup();
    } catch (cleanupError) {
      console.error(
        JSON.stringify({
          status: "CLEANUP_FAILED",
          phase,
          code: safeError(cleanupError),
        }),
      );
      process.exitCode = 1;
    }
  }
}
