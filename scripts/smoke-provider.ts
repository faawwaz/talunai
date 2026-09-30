import { readFileSync } from "node:fs";
import { createDocumentAnalysisProvider } from "../packages/agents/provider";
try {
  if (process.env.LLM_MODE !== "live")
    throw new Error("SMOKE_REQUIRES_EXPLICIT_LIVE_MODE");
  const provider = createDocumentAnalysisProvider();
  const result = await provider.analyze([
    {
      id: "synthetic-live-smoke",
      text: readFileSync("fixtures/cocoa-invoice.txt", "utf8"),
      pages: 1,
      status: "PARSED",
    },
  ]);
  console.log(
    JSON.stringify({
      status: "PASSED",
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      usage: result.usage,
      acceptedOutstanding: result.extraction.acceptedOutstandingAmount.value,
      anomalyCodes: result.extraction.anomalies.map((a) => a.code),
      isSynthetic: true,
    }),
  );
} catch (error) {
  const message =
    error instanceof Error ? error.message : "PROVIDER_SMOKE_FAILED";
  const code = /^[A-Z][A-Z0-9_]+$/.test(message)
    ? message
    : "PROVIDER_SMOKE_FAILED";
  console.error(JSON.stringify({ status: "FAILED", code, isSynthetic: true }));
  process.exitCode = 1;
}
