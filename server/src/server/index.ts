// Starts the API server: npm run dev
import { buildAgentGraph } from "../agent/graph";
import { createTurnRunner } from "../agent/run";
import { config } from "../config";
import { getPolicyIndex } from "../rag/policyIndex";
import { createApp } from "./app";

try {
  config.auth.jwtSecret(); // fail fast if JWT_SECRET is missing or too short
  getPolicyIndex(); // build the policy search index at startup, not on the first question

  const app = createApp(createTurnRunner(buildAgentGraph()));
  app.listen(config.server.port, () => {
    console.log(`HR Assist API on http://localhost:${config.server.port} (${config.llm.provider}/${config.llm.model})`);
    console.log(`LangSmith tracing: ${config.tracing.enabled ? `ON (project "${config.tracing.project}")` : "off"}`);
  });
} catch (err) {
  console.error(`Cannot start server: ${(err as Error).message}`);
  process.exit(1);
}
