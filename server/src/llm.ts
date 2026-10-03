import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { config } from "./config";

// The rest of the app only sees BaseChatModel, so switching providers means
// changing LLM_PROVIDER (and the matching API key) in .env — nothing else.
export function createChatModel(): BaseChatModel {
  const { provider, model, temperature, maxTokens, maxRetries } = config.llm;

  switch (provider) {
    case "anthropic":
      // Claude's 429s carry a retry-after header; LangChain's default retry handles them.
      return new ChatAnthropic({
        model,
        temperature,
        maxTokens,
        maxRetries,
        apiKey: config.llm.apiKey(),
      });
    case "google":
      return new ChatGoogleGenerativeAI({
        model,
        temperature,
        maxOutputTokens: maxTokens,
        maxRetries,
        onFailedAttempt: geminiRetryHandler,
        apiKey: config.llm.apiKey(),
      });
    default:
      throw new Error(`Unsupported LLM_PROVIDER: ${provider satisfies never}`);
  }
}

const NO_RETRY_STATUSES = new Set([400, 401, 403, 404]);
const MAX_RATE_LIMIT_WAIT_MS = 65_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface GeminiErrorDetail {
  "@type"?: string;
  retryDelay?: string; // e.g. "17s"
  violations?: { quotaId?: string }[];
}

// Called by LangChain's retry loop after each failed attempt: return -> retry, throw -> give up.
// LangChain's default handler treats Gemini's per-minute 429 as a hard quota error (the message
// mentions "quota" and "billing") and gives up. The free tier allows only ~5 requests/minute,
// so we wait for the delay Gemini tells us instead.
export async function geminiRetryHandler(error: unknown): Promise<void> {
  const err = error as { status?: number; message?: string; errorDetails?: GeminiErrorDetail[] };

  if (err.status === 429) {
    const details = err.errorDetails ?? [];
    const quotaIds = details.flatMap((d) => d.violations ?? []).map((v) => v.quotaId ?? "");
    if (quotaIds.some((id) => /PerDay/i.test(id))) {
      throw new Error("Gemini daily free-tier quota is used up. Try again tomorrow or use another key/model.");
    }

    const hinted = details.find((d) => d.retryDelay)?.retryDelay ?? /retry in ([\d.]+)s/i.exec(err.message ?? "")?.[1];
    const waitMs = hinted ? Math.ceil(parseFloat(hinted) * 1000) + 1000 : 15_000;
    if (waitMs > MAX_RATE_LIMIT_WAIT_MS) throw error;

    console.warn(`  [rate limited by Gemini, retrying in ${Math.round(waitMs / 1000)}s]`);
    await sleep(waitMs);
    return;
  }

  if (err.status && NO_RETRY_STATUSES.has(err.status)) throw error;
  // Anything else (5xx, network) -> retry with LangChain's exponential backoff.
}
