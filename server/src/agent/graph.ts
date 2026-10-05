// The agent as a LangGraph state graph.
//
//   START -> agent --(tool calls?)--> tools -> agent -> ... --(final answer)--> trim -> END
//
// "agent" calls the model, "tools" runs whatever tools it asked for (ToolNode), and
// "trim" drops tool traffic and old turns from history once the answer is ready.
// apply_leave can pause the graph inside "tools" (interrupt) until the user confirms.
//
// The checkpointer saves state after every step, keyed by thread_id. That gives
// conversation memory across requests and lets an interrupted run resume later.
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, RemoveMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { END, MemorySaver, START, StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { createChatModel } from "../llm";
import { getEmployee } from "../hr/repo";
import { hrTools, managerTools } from "../tools";
import { buildSystemPrompt } from "./prompt";
import { AgentState, type AgentStateType } from "./state";

// TOKENS: history kept per thread = the last 4 question/answer pairs.
export const MAX_HISTORY_MESSAGES = 8;

// model and checkpointer are injectable so tests can use a scripted fake model (no LLM cost).
export function buildAgentGraph({
  model = createChatModel(),
  checkpointer = new MemorySaver(),
}: { model?: BaseChatModel; checkpointer?: BaseCheckpointSaver } = {}) {
  if (!model.bindTools) throw new Error("This model does not support tool calling.");
  // Role-based tool sets: managers also get the team tools. ToolNode knows all tools, and each
  // manager tool re-checks the role, so an employee session can never use them.
  const employeeModel = model.bindTools(hrTools);
  const managerModel = model.bindTools([...hrTools, ...managerTools]);

  // The system prompt is added per call instead of being stored in state:
  // it stays out of saved history and always has today's date.
  async function agent(state: AgentStateType) {
    const role = getEmployee(state.employeeId)?.role ?? "employee";
    const modelWithTools = role === "manager" ? managerModel : employeeModel;
    const reply = await modelWithTools.invoke([new SystemMessage(buildSystemPrompt(role)), ...state.messages]);
    return { messages: [reply] };
  }

  function routeAfterAgent(state: AgentStateType): "tools" | "trim" {
    const last = state.messages.at(-1);
    return last && AIMessage.isInstance(last) && last.tool_calls?.length ? "tools" : "trim";
  }

  // TOKENS: every model call resends the whole history. Once a turn is answered, its
  // tool calls/results are no longer needed (the answer states the facts), and old
  // turns are dropped so long chats don't grow without bound.
  function trim(state: AgentStateType) {
    const isToolTraffic = (m: (typeof state.messages)[number]) =>
      ToolMessage.isInstance(m) || (AIMessage.isInstance(m) && !!m.tool_calls?.length);
    const conversation = state.messages.filter((m) => !isToolTraffic(m));
    let start = Math.max(0, conversation.length - MAX_HISTORY_MESSAGES);
    while (start < conversation.length && !HumanMessage.isInstance(conversation[start])) start++; // begin on a question

    const remove = [...state.messages.filter(isToolTraffic), ...conversation.slice(0, start)];
    return { messages: remove.map((m) => new RemoveMessage({ id: m.id! })) };
  }

  return new StateGraph(AgentState)
    .addNode("agent", agent)
    .addNode("tools", new ToolNode([...hrTools, ...managerTools]))
    .addNode("trim", trim)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", routeAfterAgent, ["tools", "trim"])
    .addEdge("tools", "agent")
    .addEdge("trim", END)
    .compile({ checkpointer });
}

export type AgentGraph = ReturnType<typeof buildAgentGraph>;
