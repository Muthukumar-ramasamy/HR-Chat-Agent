// Starts the API server: npm run dev
import { buildAgentGraph } from "../agent/graph";
import { createTurnRunner } from "../agent/run";
import { config } from "../config";
import { loadPolicyIndex } from "../rag/policyIndex";
import { createApp } from "./app";

try {
  config.auth.jwtSecret(); // fail fast if JWT_SECRET is missing or too short

  // Build the policy search index at startup (all .md/.txt/.pdf/.docx files), not on the first question.
  const docs = await loadPolicyIndex();
  const sections = docs.reduce((n, d) => n + d.sections.length, 0);
  console.log(`Policy index: ${docs.length} document(s), ${sections} section(s) from ${config.policyDir}`);
  for (const d of docs.filter((d) => d.error)) console.warn(`  could not read ${d.file}: ${d.error}`);

  const app = createApp(createTurnRunner(buildAgentGraph()));
  const server = app.listen(config.server.port, () => {
    console.log(`HR Assist API on http://localhost:${config.server.port} (${config.llm.provider}/${config.llm.model})`);
    console.log(`LangSmith tracing: ${config.tracing.enabled ? `ON (project "${config.tracing.project}")` : "off"}`);
  });
  // An older API still holding the port would keep answering with stale code: stop loudly instead.
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Cannot start server: port ${config.server.port} is already in use (an older API may still be running).`);
      process.exit(1);
    }
    throw err;
  });
} catch (err) {
  console.error(`Cannot start server: ${(err as Error).message}`);
  process.exit(1);
}
