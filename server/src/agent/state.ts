import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

// Graph state = conversation messages + who is logged in.
// employeeId is set by our code when the graph is invoked (Stage 5: from the verified JWT).
// No node lets the model write it, so the user can't talk their way into another identity.
export const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec, // messages, with a reducer that appends (and handles RemoveMessage)
  employeeId: Annotation<string>(),
});

export type AgentStateType = typeof AgentState.State;
