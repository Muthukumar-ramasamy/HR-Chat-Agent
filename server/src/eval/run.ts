// Runs the evaluation cases against the real model (costs tokens; not part of `npm test`).
//   npm run eval                    -> all cases
//   npm run eval -- --only balance  -> one case (comma-separated ids allowed)
import { useTempDb } from "../db/tempDb";

process.env.APP_TODAY = "2026-10-05"; // reproducible dates; must be set before config loads
process.env.LANGSMITH_PROJECT = "hr-agent-eval"; // keep eval traces out of the demo project
const cleanup = await useTempDb("eval"); // fresh seed data; never touches the demo DB

const { awaitAllCallbacks } = await import("@langchain/core/callbacks/promises");
const { buildAgentGraph } = await import("../agent/graph");
const { createTurnRunner } = await import("../agent/run");
const { config } = await import("../config");
const { cases } = await import("./cases");

// Claude Haiku 4.5 list prices, USD per million tokens (for the cost estimate only).
const PRICE = { input: 1, output: 5 };

const onlyArg = process.argv.indexOf("--only");
const only = onlyArg >= 0 ? new Set(process.argv[onlyArg + 1]?.split(",")) : undefined;
const selected = cases.filter((c) => !only || only.has(c.id));

const runner = createTurnRunner(buildAgentGraph());
const threadIds = new Map<string, string>();
const threadFor = (id?: string) => {
  if (!id) return crypto.randomUUID();
  if (!threadIds.has(id)) threadIds.set(id, crypto.randomUUID());
  return threadIds.get(id)!;
};

let passed = 0;
let tokensIn = 0;
let tokensOut = 0;
const rows: string[] = [];

console.log(`Evaluating ${selected.length} case(s) on ${config.llm.provider}/${config.llm.model}\n`);

for (const c of selected) {
  const failures: string[] = [];
  const tools: string[] = [];
  let reply = "";
  let confirmationType: string | undefined;

  try {
    const threadId = threadFor(c.thread);
    let result = await runner.run({ employeeId: c.user, threadId, message: c.message });
    tools.push(...result.toolCalls.map((t) => t.name));
    tokensIn += result.usage.inputTokens;
    tokensOut += result.usage.outputTokens;

    if (result.confirmation) {
      confirmationType = result.confirmation.type;
      result = await runner.run({ employeeId: c.user, threadId, resume: { approved: c.confirm ?? false } });
      tools.push(...result.toolCalls.map((t) => t.name));
      tokensIn += result.usage.inputTokens;
      tokensOut += result.usage.outputTokens;
    }
    reply = result.reply;
  } catch (err) {
    failures.push(`error: ${(err as Error).message}`);
  }

  const e = c.expect;
  for (const t of e.tools ?? []) if (!tools.includes(t)) failures.push(`missing tool ${t}`);
  if (e.toolsAny && !e.toolsAny.some((t) => tools.includes(t))) failures.push(`none of ${e.toolsAny.join("/")}`);
  if (e.noTools && tools.length) failures.push(`expected no tools, got ${tools.join(",")}`);
  for (const t of e.notTools ?? []) if (tools.includes(t)) failures.push(`must not call ${t}`);
  if (e.maxToolCalls !== undefined && tools.length > e.maxToolCalls) failures.push(`${tools.length} tool calls (max ${e.maxToolCalls})`);
  if (e.confirmation && confirmationType !== e.confirmation) failures.push(`expected ${e.confirmation}, got ${confirmationType ?? "none"}`);
  if (e.noConfirmation && confirmationType) failures.push(`unexpected ${confirmationType}`);
  for (const r of e.reply ?? []) if (!r.test(reply)) failures.push(`reply lacks ${r}`);
  for (const r of e.notReply ?? []) if (r.test(reply)) failures.push(`reply has ${r}`);

  const ok = failures.length === 0;
  if (ok) passed++;
  rows.push(`${ok ? "PASS" : "FAIL"}  ${c.id.padEnd(26)} ${(tools.join(",") || "-").slice(0, 60)}`);
  if (!ok) rows.push(`      ${failures.join("; ")}\n      reply: ${reply.replace(/\s+/g, " ").slice(0, 200)}`);
  console.log(rows.at(-1)!.startsWith("      ") ? rows.slice(-2).join("\n") : rows.at(-1));
}

const cost = (tokensIn * PRICE.input + tokensOut * PRICE.output) / 1e6;
console.log(`\n${passed}/${selected.length} passed · tokens ${tokensIn} in / ${tokensOut} out · ~$${cost.toFixed(3)}`);

await awaitAllCallbacks();
cleanup();
process.exit(passed === selected.length ? 0 : 1);
