import { test } from "node:test";
import assert from "node:assert/strict";
import { geminiRetryHandler } from "./llm";

// Shaped like @google/generative-ai's GoogleGenerativeAIFetchError.
function geminiError(status: number, details: object[] = [], message = "error") {
  return Object.assign(new Error(message), { status, errorDetails: details });
}

test("per-minute 429 waits for Gemini's retryDelay, then retries", async () => {
  const err = geminiError(429, [
    { violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
    { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "0.01s" },
  ]);
  const start = Date.now();
  await geminiRetryHandler(err); // resolves = retry
  assert.ok(Date.now() - start >= 1000, "waits retryDelay + 1s buffer");
});

test("daily quota 429 gives up with a clear message", async () => {
  const err = geminiError(429, [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }]);
  await assert.rejects(geminiRetryHandler(err), /daily free-tier quota/);
});

test("429 asking for a very long wait gives up", async () => {
  const err = geminiError(429, [{ retryDelay: "300s" }]);
  await assert.rejects(geminiRetryHandler(err));
});

test("client errors are not retried, server errors are", async () => {
  await assert.rejects(geminiRetryHandler(geminiError(404)));
  await assert.rejects(geminiRetryHandler(geminiError(400)));
  await geminiRetryHandler(geminiError(503));
});
