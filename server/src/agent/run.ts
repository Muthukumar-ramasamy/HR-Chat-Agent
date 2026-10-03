// Runs one chat turn through the agent graph. Shared by the CLI and the HTTP API.
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { AgentGraph } from "./graph";

export type TurnEvent =
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; content: string };

export interface TurnResult {
  reply: string;
  messages: BaseMessage[]; // full (trimmed) history after this turn
  toolCalls: { name: string; args: Record<string, unknown> }[];
  usage: { modelCalls: number; inputTokens: number; outputTokens: number };
}

export interface TurnInput {
  employeeId: string; // from the verified login, never from the message
  history: BaseMessage[];
  message: string;
}

export type RunTurn = (input: TurnInput, onEvent?: (e: TurnEvent) => void) => Promise<TurnResult>;

export function createTurnRunner(graph: AgentGraph): RunTurn {
  return async ({ employeeId, history, message }, onEvent) => {
    const toolCalls: TurnResult["toolCalls"] = [];
    const usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
    let finalMessages: BaseMessage[] | undefined;

    // "updates" = what each node just produced (tool calls, token usage); the trim node
    // later removes tool traffic from state, so it has to be captured here.
    // "values" = full state after each step; the last one is the new history.
    const stream = await graph.stream(
      { messages: [...history, new HumanMessage(message)], employeeId },
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

    if (!finalMessages) throw new Error("Graph produced no state.");
    return { reply: finalMessages.at(-1)?.text ?? "", messages: finalMessages, toolCalls, usage };
  };
}
