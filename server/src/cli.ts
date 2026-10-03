// CLI chat for development. The HTTP API (src/server) is the real entry point from Stage 5.
//
//   npm run chat                 -> chat as E1001 (Asha Rao)
//   npm run chat -- --as E1003   -> chat as another seeded employee
//   npm run graph                -> print the agent graph as a Mermaid diagram
//
// --as is a developer shortcut that skips login; the API takes the ID only from a verified JWT.
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { buildAgentGraph } from "./agent/graph";
import { createTurnRunner, type TurnEvent } from "./agent/run";
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

  const runner = createTurnRunner(graph);
  const threadId = randomUUID(); // one conversation per CLI session; memory lives in the checkpointer
  const logEvent = (e: TurnEvent) =>
    console.log(dim(e.type === "tool_call" ? `  -> ${e.name}(${JSON.stringify(e.args)})` : `  <- ${e.content.slice(0, 160)}`));

  const rl = createInterface({ input, output });
  // Reading lines through one iterator buffers input typed while the bot is replying,
  // and lets the confirmation question read the next line too.
  const lines = rl[Symbol.asyncIterator]();
  const nextLine = async () => {
    const { value, done } = await lines.next();
    return done ? undefined : String(value).trim();
  };
  let inputClosed = false;
  rl.on("close", () => (inputClosed = true));
  const ask = (q: string) => {
    if (!inputClosed) {
      rl.setPrompt(q);
      rl.prompt();
    }
  };

  async function runTurn(text: string) {
    let result = await runner.run({ employeeId: employee!.id, threadId, message: text }, logEvent);
    let { modelCalls, inputTokens, outputTokens } = result.usage;

    // apply_leave paused the graph: show the summary, ask, and resume with the answer.
    while (result.confirmation) {
      const c = result.confirmation;
      console.log(
        `
  Confirm leave request: ${c.leave_name} ${c.start_date} to ${c.end_date}, ${c.working_days} working day(s), ` +
          `balance ${c.balance_before} -> ${c.balance_after}${c.reason ? `, reason "${c.reason}"` : ""}`,
      );
      ask("  Submit? (y/n) ");
      const approved = (await nextLine())?.toLowerCase().startsWith("y") ?? false;
      result = await runner.run({ employeeId: employee!.id, threadId, resume: { approved } }, logEvent);
      modelCalls += result.usage.modelCalls;
      inputTokens += result.usage.inputTokens;
      outputTokens += result.usage.outputTokens;
    }

    console.log(`
bot> ${result.reply}
`);
    console.log(dim(`  [${modelCalls} model call${modelCalls === 1 ? "" : "s"}, tokens: ${inputTokens} in / ${outputTokens} out]
`));
  }

  ask("you> ");
  for (let text = await nextLine(); text !== undefined; text = await nextLine()) {
    if (text === "exit" || text === "quit") break;
    if (text) {
      try {
        await runTurn(text);
      } catch (err) {
        console.error(`
[error] ${(err as Error).message}
`);
      }
    }
    ask("you> ");
  }

  rl.close();
  // Traces upload in the background; wait for them before the process exits.
  await awaitAllCallbacks();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
