// Stage 2: chat loop with tool calling, written by hand so every step is visible.
// Stage 3 replaces runTurn() with a LangGraph agent.
//
//   npm run chat                 -> chat as E1001 (Asha Rao)
//   npm run chat -- --as E1003   -> chat as another seeded employee
//
// --as stands in for login until Stage 5 (JWT).
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { buildSystemPrompt } from "./agent/prompt";
import { config } from "./config";
import { getEmployee } from "./hr/repo";
import { createChatModel } from "./llm";
import { hrTools } from "./tools";

const MAX_TOOL_ROUNDS = 8; // safety stop so a confused model can't loop forever
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const toolsByName = new Map<string, StructuredToolInterface>(hrTools.map((t) => [t.name, t]));

// Every model call in a turn resends the whole history, so input tokens add up per call.
function turnUsage(turnMessages: BaseMessage[]): string {
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const m of turnMessages) {
    const usage = AIMessage.isInstance(m) ? m.usage_metadata : undefined;
    if (!usage) continue;
    calls++;
    inputTokens += usage.input_tokens;
    outputTokens += usage.output_tokens;
  }
  return `[${calls} model call${calls === 1 ? "" : "s"}, tokens: ${inputTokens} in / ${outputTokens} out]`;
}

function employeeIdFromArgs(): string {
  const i = process.argv.indexOf("--as");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "E1001";
}

async function main() {
  const employee = getEmployee(employeeIdFromArgs());
  if (!employee) throw new Error(`No employee with id ${employeeIdFromArgs()}. Run "npm run db:seed".`);

  const model = createChatModel();
  if (!model.bindTools) throw new Error("This model does not support tool calling.");
  // bindTools sends the tool names, descriptions and JSON schemas with every request.
  const modelWithTools = model.bindTools(hrTools);

  // employee_id travels in the run config, never through the LLM.
  const runConfig: RunnableConfig = { configurable: { employee_id: employee.id } };

  // One turn = call the model, run any tools it asks for, feed results back, repeat
  // until it answers in plain text.
  async function runTurn(messages: BaseMessage[]): Promise<AIMessage> {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const ai = (await modelWithTools.invoke(messages, runConfig)) as AIMessage;
      // Keep the original message object: providers attach metadata to tool calls
      // (e.g. Gemini thought signatures) that must be sent back unchanged.
      messages.push(ai);

      if (!ai.tool_calls?.length) return ai;

      for (const call of ai.tool_calls) {
        console.log(dim(`  -> ${call.name}(${JSON.stringify(call.args)})`));
        const t = toolsByName.get(call.name);
        let result: ToolMessage;
        try {
          if (!t) throw new Error(`Unknown tool ${call.name}`);
          // Invoking a tool with the whole tool call returns a ToolMessage linked by tool_call_id.
          result = (await t.invoke({ ...call, type: "tool_call" }, runConfig)) as ToolMessage;
        } catch (err) {
          // Send the error back so the model can correct itself (e.g. a bad date).
          result = new ToolMessage({ tool_call_id: call.id!, content: `Error: ${(err as Error).message}`, status: "error" });
        }
        console.log(dim(`  <- ${String(result.content).slice(0, 160)}`));
        messages.push(result);
      }
    }
    throw new Error(`Stopped after ${MAX_TOOL_ROUNDS} tool rounds without a final answer.`);
  }

  const messages: BaseMessage[] = [new SystemMessage(buildSystemPrompt())];

  console.log(`HR assistant (${config.llm.provider}/${config.llm.model}). Type "exit" to quit.`);
  console.log(
    config.tracing.enabled
      ? `LangSmith tracing: ON (project "${config.tracing.project}")`
      : `LangSmith tracing: off (set LANGSMITH_TRACING / LANGSMITH_API_KEY in .env)`,
  );
  console.log(`Logged in as ${employee.name} (${employee.id}, ${employee.location})\n`);

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

    const turnStart = messages.length;
    messages.push(new HumanMessage(text));
    try {
      const reply = await runTurn(messages);
      console.log(`\nbot> ${reply.text}\n`);
      console.log(dim(`  ${turnUsage(messages.slice(turnStart))}\n`));
      // Keep only the question and final answer in history. The answer already states the
      // dates and numbers, so later turns don't need to resend old tool calls and results.
      messages.splice(turnStart + 1, messages.length - turnStart - 2);
    } catch (err) {
      messages.splice(turnStart); // drop the failed turn so history stays consistent
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
