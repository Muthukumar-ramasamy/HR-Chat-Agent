// Runs one chat turn through the agent graph. Shared by the CLI and the HTTP API.
//
// Memory lives in the graph's checkpointer, keyed by thread_id; callers only pass the new
// message (or the user's answer to a pending confirmation).
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import type { LeaveConfirmation } from "../tools";
import type { AgentGraph } from "./graph";

export type TurnEvent =
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; content: string };

export interface TurnResult {
  reply: string; // empty while waiting for confirmation
  confirmation?: LeaveConfirmation; // set when apply_leave paused the graph
  toolCalls: { name: string; args: Record<string, unknown> }[];
  usage: { modelCalls: number; inputTokens: number; outputTokens: number };
}

export type TurnInput = {
  employeeId: string; // from the verified login, never from the message
  threadId: string;
} & ({ message: string } | { resume: { approved: boolean } });

export interface TurnRunner {
  run(input: TurnInput, onEvent?: (e: TurnEvent) => void): Promise<TurnResult>;
  hasPendingConfirmation(employeeId: string, threadId: string): Promise<boolean>;
}

export class ConfirmationStateError extends Error {}

// Thread keys include the employee ID, so one user can never load or resume another
// user's conversation, even with a guessed thread ID.
const threadConfig = (employeeId: string, threadId: string) => ({
  configurable: { thread_id: `${employeeId}:${threadId}` },
});

export function createTurnRunner(graph: AgentGraph): TurnRunner {
  async function hasPendingConfirmation(employeeId: string, threadId: string) {
    const snapshot = await graph.getState(threadConfig(employeeId, threadId));
    return snapshot.tasks.some((t) => t.interrupts.length > 0);
  }

  async function run(input: TurnInput, onEvent?: (e: TurnEvent) => void): Promise<TurnResult> {
    const { employeeId, threadId } = input;
    const pending = await hasPendingConfirmation(employeeId, threadId);
    if ("resume" in input && !pending) throw new ConfirmationStateError("There is no leave request waiting for confirmation.");
    if ("message" in input && pending) throw new ConfirmationStateError("Please confirm or cancel the pending leave request first.");

    const toolCalls: TurnResult["toolCalls"] = [];
    const usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
    let confirmation: LeaveConfirmation | undefined;
    let finalMessages: BaseMessage[] = [];

    const graphInput =
      "message" in input
        ? { messages: [new HumanMessage(input.message)], employeeId }
        : (new Command({ resume: input.resume }) as Parameters<AgentGraph["stream"]>[0]);

    // "updates" = what each node just produced (tool calls, token usage, interrupts);
    // "values" = full state after each step; the last one holds the final answer.
    const stream = await graph.stream(graphInput, {
      ...threadConfig(employeeId, threadId),
      streamMode: ["updates", "values"],
      recursionLimit: 20,
    });

    for await (const [mode, chunk] of stream) {
      if (mode === "values") {
        finalMessages = chunk.messages;
        continue;
      }
      for (const [node, update] of Object.entries(chunk)) {
        if (node === "__interrupt__") {
          confirmation = (update as { value: LeaveConfirmation }[])[0]?.value;
          continue;
        }
        const messages = ((update as { messages?: BaseMessage[] } | undefined)?.messages ?? []) as BaseMessage[];
        for (const m of messages) {
          if (node === "agent" && AIMessage.isInstance(m)) {
            usage.modelCalls++;
            usage.inputTokens += m.usage_metadata?.input_tokens ?? 0;
            usage.outputTokens += m.usage_metadata?.output_tokens ?? 0;
            for (const call of m.tool_calls ?? []) {
              toolCalls.push({ name: call.name, args: call.args });
              onEvent?.({ type: "tool_call", name: call.name, args: call.args });
            }
          }
          if (node === "tools" && ToolMessage.isInstance(m)) {
            onEvent?.({ type: "tool_result", name: m.name ?? "", content: String(m.content) });
          }
        }
      }
    }

    if (confirmation) return { reply: "", confirmation, toolCalls, usage };
    return { reply: finalMessages.at(-1)?.text ?? "", toolCalls, usage };
  }

  return { run, hasPendingConfirmation };
}
