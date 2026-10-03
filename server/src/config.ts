import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

export type LlmProvider = "anthropic" | "google";

const DEFAULT_MODEL: Record<LlmProvider, string> = {
  anthropic: "claude-haiku-4-5", // smallest/cheapest Claude model
  google: "gemini-3.8-flash",
};

const API_KEY_VAR: Record<LlmProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
};

const provider = (process.env.LLM_PROVIDER ?? "anthropic") as LlmProvider;
if (!(provider in DEFAULT_MODEL)) {
  throw new Error(`Unsupported LLM_PROVIDER "${provider}". Use one of: ${Object.keys(DEFAULT_MODEL).join(", ")}`);
}

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

  // Optional fixed "today" (YYYY-MM-DD) for reproducible demos; defaults to the real date.
  appToday: process.env.APP_TODAY || undefined,

  llm: {
    provider,
    model: process.env.LLM_MODEL || DEFAULT_MODEL[provider],
    temperature: 0,
    // Cap on each reply's length. HR answers are short; this bounds output-token spend.
    maxTokens: 1024,
    // Retries use exponential backoff (~1s, 2s, 4s, ...) on 429/5xx.
    maxRetries: 6,
    apiKey: () => required(API_KEY_VAR[provider]),
  },

  server: {
    port: Number(process.env.PORT ?? 3001),
    // The React dev server (Stage 7). Only this origin may call the API from a browser.
    corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    // Longest chat message accepted. Long inputs cost tokens on every later turn.
    maxMessageChars: 1000,
  },

  auth: {
    // HS256 signing key; at least 32 characters. Read lazily so the CLI doesn't need it.
    jwtSecret: () => {
      const secret = required("JWT_SECRET");
      if (secret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters.");
      return secret;
    },
    tokenTtl: "8h",
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
