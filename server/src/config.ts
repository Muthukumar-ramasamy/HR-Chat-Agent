import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

export type LlmProvider = "google";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith("your-")) {
    throw new Error(`Missing env var ${name}. Copy .env.example to .env and set it.`);
  }
  return value;
}

// Single place for all runtime settings. Read lazily so scripts that
// don't need the LLM (e.g. db:seed) don't require an API key.
export const config = {
  dbPath: process.env.DB_PATH ?? "./data/hr.db",

  llm: {
    provider: (process.env.LLM_PROVIDER ?? "google") as LlmProvider,
    model: process.env.LLM_MODEL ?? "gemini-3.8-flash",
    temperature: 0,
    // Retries use exponential backoff (~1s, 2s, 4s, ...); covers free-tier 429s.
    maxRetries: 6,
    apiKey: () => required("GOOGLE_API_KEY"),
  },

  // LangChain picks up LANGSMITH_* env vars on its own; this is only for display.
  tracing: {
    enabled:
      process.env.LANGSMITH_TRACING === "true" &&
      !!process.env.LANGSMITH_API_KEY &&
      !process.env.LANGSMITH_API_KEY.startsWith("your-"),
    project: process.env.LANGSMITH_PROJECT ?? "default",
  },
};
