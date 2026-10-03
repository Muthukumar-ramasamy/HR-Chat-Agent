// CLI chat for development. The HTTP API (src/server) is the real entry point from Stage 5.
//
//   npm run chat                 -> chat as E1001 (Asha Rao)
//   npm run chat -- --as E1003   -> chat as another seeded employee
//   npm run graph                -> print the agent graph as a Mermaid diagram
//
// --as is a developer shortcut that skips login; the API takes the ID only from a verified JWT.
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import type { BaseMessage } from "@langchain/core/messages";
import { buildAgentGraph } from "./agent/graph";
import { createTurnRunner } from "./agent/run";
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

  const runAgentTurn = createTurnRunner(graph);

  async function runTurn(text: string) {
    const { reply, messages, usage } = await runAgentTurn(
      { employeeId: employee!.id, history, message: text },
      (e) =>
        console.log(
          dim(e.type === "tool_call" ? `  -> ${e.name}(${JSON.stringify(e.args)})` : `  <- ${e.content.slice(0, 160)}`),
        ),
    );
    history = messages;
    const { modelCalls, inputTokens, outputTokens } = usage;
    console.log(`\nbot> ${reply}\n`);
    console.log(dim(`  [${modelCalls} model call${modelCalls === 1 ? "" : "s"}, tokens: ${inputTokens} in / ${outputTokens} out]\n`));
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
