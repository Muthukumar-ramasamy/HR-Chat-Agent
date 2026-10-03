// Stage 1: a bare chat loop. No tools, no agent yet — just the model + message history.
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { config } from "./config";
import { createChatModel } from "./llm";

const SYSTEM_PROMPT = `You are an HR assistant for Acme Corp employees.
You do not yet have access to any HR data or policy documents.
If asked about specific balances, policies or records, say you can't look those up yet.`;

async function main() {
  const model = createChatModel();
  const rl = createInterface({ input, output });

  // The model is stateless: every call must include the whole conversation.
  const messages: BaseMessage[] = [new SystemMessage(SYSTEM_PROMPT)];

  console.log(`HR assistant (${config.llm.provider}/${config.llm.model}). Type "exit" to quit.`);
  console.log(
    config.tracing.enabled
      ? `LangSmith tracing: ON (project "${config.tracing.project}")\n`
      : `LangSmith tracing: off (set LANGSMITH_TRACING / LANGSMITH_API_KEY in .env)\n`,
  );

  // `for await` buffers lines, so input typed while the bot is replying isn't lost.
  rl.setPrompt("you> ");
  rl.prompt();
  for await (const line of rl) {
    const text = line.trim();
    if (text === "exit" || text === "quit") break;
    if (!text) {
      rl.prompt();
      continue;
    }

    messages.push(new HumanMessage(text));
    try {
      const reply = await model.invoke(messages);
      messages.push(new AIMessage(reply.text));
      console.log(`\nbot> ${reply.text}\n`);
    } catch (err) {
      messages.pop(); // drop the unanswered question so history stays consistent
      console.error(`\n[error] ${(err as Error).message}\n`);
    }
    rl.prompt();
  }

  rl.close();
  // Traces upload in the background; wait for them before the process exits.
  await awaitAllCallbacks();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
