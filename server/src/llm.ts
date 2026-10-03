import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { config } from "./config";

// The rest of the app only sees BaseChatModel, so switching to Claude/OpenAI
// means adding a case here (e.g. ChatAnthropic) and changing LLM_PROVIDER.
export function createChatModel(): BaseChatModel {
  const { provider, model, temperature, maxRetries } = config.llm;

  switch (provider) {
    case "google":
      return new ChatGoogleGenerativeAI({
        model,
        temperature,
        maxRetries,
        apiKey: config.llm.apiKey(),
      });
    default:
      throw new Error(`Unsupported LLM_PROVIDER: ${provider satisfies never}`);
  }
}
