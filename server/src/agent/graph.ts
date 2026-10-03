// Stage 3: the agent as a LangGraph state graph.
//
//   START -> agent --(tool calls?)--> tools -> agent -> ... --(final answer)--> trim -> END
//
// "agent" calls the model, "tools" runs whatever tools it asked for (ToolNode), and
// "trim" drops the turn's tool traffic from history once the answer is ready.
import { AIMessage, RemoveMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { createChatModel } from "../llm";
import { hrTools } from "../tools";
import { buildSystemPrompt } from "./prompt";
import { AgentState, type AgentStateType } from "./state";

export function buildAgentGraph() {
  const model = createChatModel();
  if (!model.bindTools) throw new Error("This model does not support tool calling.");
  const modelWithTools = model.bindTools(hrTools);

  // The system prompt is added per call instead of being stored in state:
  // it stays out of saved history and always has today's date.
  async function agent(state: AgentStateType) {
    const reply = await modelWithTools.invoke([new SystemMessage(buildSystemPrompt()), ...state.messages]);
    return { messages: [reply] };
  }

  function routeAfterAgent(state: AgentStateType): "tools" | "trim" {
    const last = state.messages.at(-1);
    return last && AIMessage.isInstance(last) && last.tool_calls?.length ? "tools" : "trim";
  }

  // TOKENS: every model call resends the whole history. Once a turn is answered, its
  // tool calls/results are no longer needed (the answer states the facts), so remove them.
  function trim(state: AgentStateType) {
    const toolTraffic = state.messages.filter(
      (m) => ToolMessage.isInstance(m) || (AIMessage.isInstance(m) && m.tool_calls?.length),
    );
    return { messages: toolTraffic.map((m) => new RemoveMessage({ id: m.id! })) };
  }

  return new StateGraph(AgentState)
    .addNode("agent", agent)
    .addNode("tools", new ToolNode(hrTools))
    .addNode("trim", trim)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", routeAfterAgent, ["tools", "trim"])
    .addEdge("tools", "agent")
    .addEdge("trim", END)
    .compile();
}

export type AgentGraph = ReturnType<typeof buildAgentGraph>;
