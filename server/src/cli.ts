// CLI chat. Stage 3: the LangGraph agent (src/agent/graph.ts) runs each turn.
//
//   npm run chat                 -> chat as E1001 (Asha Rao)
//   npm run chat -- --as E1003   -> chat as another seeded employee
//   npm run graph                -> print the agent graph as a Mermaid diagram
//
// --as stands in for login until Stage 5 (JWT).
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { buildAgentGraph } from "./agent/graph";
import { config } from "./config";
import { getEmployee } from "./hr/repo";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function employeeIdFromArgs(): string {
  const i = process.argv.indexOf("--as");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "E1001";
}

async function main() {
  const graph = buildAgentGraph();

  if (process.argv.includes("--graph")) {
    console.log((await graph.getGraphAsync()).drawMermaid());
    return;
  }

  const employee = getEmployee(employeeIdFromArgs());
  if (!employee) throw new Error(`No employee with id ${employeeIdFromArgs()}. Run "npm run db:seed".`);

  console.log(`HR assistant (${config.llm.provider}/${config.llm.model}). Type "exit" to quit.`);
  console.log(
    config.tracing.enabled
      ? `LangSmith tracing: ON (project "${config.tracing.project}")`
      : `LangSmith tracing: off (set LANGSMITH_TRACING / LANGSMITH_API_KEY in .env)`,
  );
  console.log(`Logged in as ${employee.name} (${employee.id}, ${employee.location})\n`);

  // Conversation so far (already trimmed by the graph). Stage 6 moves this into a checkpointer.
  let history: BaseMessage[] = [];

  async function runTurn(text: string) {
    let calls = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let finalMessages: BaseMessage[] | undefined;

    // "updates" = what each node just produced (for live logging);
    // "values" = full state after each step (the last one is the new history).
    const stream = await graph.stream(
      { messages: [...history, new HumanMessage(text)], employeeId: employee!.id },
      { streamMode: ["updates", "values"], recursionLimit: 20 },
    );

    for await (const [mode, chunk] of stream) {
      if (mode === "values") {
        finalMessages = chunk.messages;
        continue;
      }
      for (const [node, update] of Object.entries(chunk)) {
        const messages = ((update as { messages?: BaseMessage[] } | undefined)?.messages ?? []) as BaseMessage[];
        for (const m of messages) {
          if (node === "agent" && AIMessage.isInstance(m)) {
            calls++;
            tokensIn += m.usage_metadata?.input_tokens ?? 0;
            tokensOut += m.usage_metadata?.output_tokens ?? 0;
            for (const call of m.tool_calls ?? []) console.log(dim(`  -> ${call.name}(${JSON.stringify(call.args)})`));
          }
          if (node === "tools" && ToolMessage.isInstance(m)) console.log(dim(`  <- ${String(m.content).slice(0, 160)}`));
        }
      }
    }

    if (!finalMessages) throw new Error("Graph produced no state.");
    history = finalMessages;
    console.log(`\nbot> ${history.at(-1)?.text ?? ""}\n`);
    console.log(dim(`  [${calls} model call${calls === 1 ? "" : "s"}, tokens: ${tokensIn} in / ${tokensOut} out]\n`));
  }

  const rl = createInterface({ input, output });
  // `for await` buffers lines, so input typed while the bot is replying isn't lost.
  // Input can end (e.g. piped) while a turn is still running; don't prompt after that.
  let inputClosed = false;
  rl.on("close", () => (inputClosed = true));
  const prompt = () => !inputClosed && rl.prompt();

  rl.setPrompt("you> ");
  prompt();
  for await (const line of rl) {
    const text = line.trim();
    if (text === "exit" || text === "quit") break;
    if (!text) {
      prompt();
      continue;
    }
    try {
      await runTurn(text); // on failure history is unchanged, so the turn is simply dropped
    } catch (err) {
      console.error(`\n[error] ${(err as Error).message}\n`);
    }
    prompt();
  }

  rl.close();
  // Traces upload in the background; wait for them before the process exits.
  await awaitAllCallbacks();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
