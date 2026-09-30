import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterDocumentAnalysisProvider } from "../packages/agents/provider";
import { extractDeterministic } from "../packages/agents/extraction";
import type { SourceDocument } from "../packages/domain/evidence";

const documents: SourceDocument[] = [
  {
    id: "synthetic-document",
    text: "locale: id-ID\nacceptedOutstandingAmount: 1.000",
    pages: 1,
    status: "PARSED",
  },
];
const fetchMock = vi.fn();
function completion(
  content: unknown,
  options: { refusal?: string; finishReason?: string } = {},
) {
  return new Response(
    JSON.stringify({
      id: "synthetic-response",
      object: "chat.completion",
      created: 1,
      model: "test-model-only",
      choices: [
        {
          index: 0,
          finish_reason: options.finishReason ?? "stop",
          message: {
            role: "assistant",
            content:
              typeof content === "string" ? content : JSON.stringify(content),
            refusal: options.refusal ?? null,
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }),
    { headers: { "content-type": "application/json" } },
  );
}
const provider = () =>
  new OpenRouterDocumentAnalysisProvider(
    "test-model-only",
    "synthetic-key-not-real",
    1000,
  );

describe("OpenRouter transport adapter with intercepted fetch, no live provider calls", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  it("sends strict schema to OpenRouter with required parameters and bounded output", async () => {
    fetchMock.mockResolvedValue(completion(extractDeterministic(documents)));
    const result = await provider().analyze(documents);
    expect(result.provider).toBe("openrouter");
    expect(result.extraction.acceptedOutstandingAmount.value).toBe("1000");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    const [url, request] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(request.body);
    expect(body.provider.require_parameters).toBe(true);
    expect(body.provider.data_collection).toBe("deny");
    expect(body.max_tokens).toBe(4096);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.reasoning).toEqual({ enabled: false, exclude: true });
    expect(body.messages[0].content).toContain("Return JSON");
    expect(body).not.toHaveProperty("tools");
  });
  it("GPT-4.1 retains strict schema without unsupported reasoning parameters", async () => {
    fetchMock.mockResolvedValue(completion(extractDeterministic(documents)));
    await new OpenRouterDocumentAnalysisProvider(
      "openai/gpt-4.1",
      "synthetic-key-not-real",
      1000,
    ).analyze(documents);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("openai/gpt-4.1");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.provider.require_parameters).toBe(true);
    expect(body).not.toHaveProperty("reasoning");
  });
  it("refusal fails explicitly without returning extraction", async () => {
    fetchMock.mockResolvedValue(
      completion(null, { refusal: "synthetic refusal" }),
    );
    await expect(provider().analyze(documents)).rejects.toThrow(
      "PROVIDER_REFUSAL",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("malformed JSON and schema extra action fields never become approved data", async () => {
    fetchMock.mockResolvedValueOnce(completion("{broken-json"));
    await expect(provider().analyze(documents)).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(
      completion({ ...extractDeterministic(documents), recipient: "attacker" }),
    );
    await expect(provider().analyze(documents)).rejects.toThrow();
  });
  it("schema-valid unsupported amount is rejected independently", async () => {
    const extraction = extractDeterministic(documents);
    extraction.acceptedOutstandingAmount.value = "999999";
    fetchMock.mockResolvedValue(completion(extraction));
    await expect(provider().analyze(documents)).rejects.toThrow(
      "EXTRACTION_VALUE_NOT_SUPPORTED_BY_SOURCE",
    );
  });
  it("timeout is explicit and SDK retry is disabled", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("synthetic timeout", "AbortError"),
    );
    await expect(provider().analyze(documents)).rejects.toThrow(
      "PROVIDER_TIMEOUT",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("network outage is retriable without exposing transport details", async () => {
    fetchMock.mockRejectedValue(new Error("synthetic private network detail"));
    await expect(provider().analyze(documents)).rejects.toThrow(
      "PROVIDER_UNAVAILABLE",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    [408, "PROVIDER_TIMEOUT"],
    [429, "PROVIDER_RATE_LIMIT"],
    [500, "PROVIDER_TRANSIENT_FAILURE"],
    [503, "PROVIDER_TRANSIENT_FAILURE"],
  ])(
    "HTTP %s is classified as %s with no automatic duplicate request",
    async (status, code) => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: "synthetic unavailable" } }),
          { status, headers: { "content-type": "application/json" } },
        ),
      );
      await expect(provider().analyze(documents)).rejects.toThrow(code);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it("invalid key is a terminal request failure with no mock fallback", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "synthetic denied" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(provider().analyze(documents)).rejects.toThrow(
      "PROVIDER_REQUEST_FAILED",
    );
  });
  it("invalid timeout fails before network access", () => {
    expect(
      () => new OpenRouterDocumentAnalysisProvider("model", "key", Number.NaN),
    ).toThrow("AGENT_TIMEOUT_CONFIGURATION_INVALID");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
