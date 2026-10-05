// Runs the real graph (tools, ToolNode, interrupt, checkpointer, trim) with a scripted fake
// model and a throwaway SQLite file. No LLM calls, no tokens.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

import { useTempDb } from "../db/tempDb";

process.env.APP_TODAY = "2026-10-05"; // must be set before config loads
after(await useTempDb("graph"));

const { getDb } = await import("../db");
const repo = await import("../hr/repo");
const { buildAgentGraph, MAX_HISTORY_MESSAGES } = await import("./graph");
const { createTurnRunner, ConfirmationStateError } = await import("./run");


// Returns the next scripted AIMessage on each call; bindTools is a no-op.
class ScriptedModel extends BaseChatModel {
  script: AIMessage[] = [];
  _llmType() {
    return "scripted";
  }
  bindTools() {
    return this;
  }
  async _generate(): Promise<ChatResult> {
    const message = this.script.shift();
    if (!message) throw new Error("Scripted model ran out of responses.");
    return { generations: [{ message, text: message.text }] };
  }
}

const model = new ScriptedModel({});
const graph = buildAgentGraph({ model });
const runner = createTurnRunner(graph);
const asha = "E1001";

const callTool = (name: string, args: Record<string, unknown>) =>
  new AIMessage({ content: "", tool_calls: [{ id: `call-${Math.random()}`, name, args }] });
const say = (text: string) => new AIMessage(text);
const requestsFor = (id: string) =>
  getDb().prepare(`SELECT leave_type, start_date, end_date, days, status FROM leave_requests WHERE employee_id = ? ORDER BY id`).all(id);
const history = async (employeeId: string, threadId: string) =>
  ((await graph.getState({ configurable: { thread_id: `${employeeId}:${threadId}` } })).values.messages ?? []) as BaseMessage[];

test("apply_leave pauses for confirmation and writes only after approval", async () => {
  const before = requestsFor(asha).length;
  model.script.push(callTool("apply_leave", { leave_type: "EL", start_date: "2026-12-22", end_date: "2027-01-02", reason: "Year-end trip" }));

  const paused = await runner.run({ employeeId: asha, threadId: "t-approve", message: "Apply EL Dec 22 to Jan 2" });
  assert.equal(paused.reply, "");
  assert.deepEqual(
    { ...paused.confirmation },
    {
      type: "confirm_leave",
      leave_type: "EL",
      leave_name: "Earned Leave",
      start_date: "2026-12-22",
      end_date: "2027-01-02",
      working_days: 7,
      balance_before: 21,
      balance_after: 14,
      reason: "Year-end trip",
    },
  );
  assert.equal(requestsFor(asha).length, before, "nothing written before confirmation");
  assert.equal(await runner.hasPendingConfirmation(asha, "t-approve"), true);

  // A new message while waiting is refused (UI must confirm or cancel first).
  await assert.rejects(runner.run({ employeeId: asha, threadId: "t-approve", message: "hello" }), ConfirmationStateError);

  model.script.push(say("Submitted: 7 days of EL, pending manager approval."));
  const done = await runner.run({ employeeId: asha, threadId: "t-approve", resume: { approved: true } });
  assert.equal(done.reply, "Submitted: 7 days of EL, pending manager approval.");
  assert.equal(done.confirmation, undefined);
  assert.deepEqual(requestsFor(asha).at(-1), { leave_type: "EL", start_date: "2026-12-22", end_date: "2027-01-02", days: 7, status: "pending" });
  assert.equal(requestsFor(asha).length, before + 1);

  // Trim removed the tool call + result: only the question and final answer remain.
  const kept = await history(asha, "t-approve");
  assert.deepEqual(kept.map((m) => m.getType()), ["human", "ai"]);

  // Resuming again is refused: nothing is pending.
  await assert.rejects(runner.run({ employeeId: asha, threadId: "t-approve", resume: { approved: true } }), ConfirmationStateError);
});

test("cancelling writes nothing", async () => {
  const before = requestsFor(asha).length;
  model.script.push(callTool("apply_leave", { leave_type: "CL", start_date: "2026-11-02", end_date: "2026-11-03" }));
  const paused = await runner.run({ employeeId: asha, threadId: "t-cancel", message: "Apply CL Nov 2-3" });
  assert.equal(paused.confirmation?.working_days, 2);

  model.script.push(say("Okay, cancelled."));
  const done = await runner.run({ employeeId: asha, threadId: "t-cancel", resume: { approved: false } });
  assert.equal(done.reply, "Okay, cancelled.");
  assert.equal(requestsFor(asha).length, before);
});

test("rule violations return problems without asking for confirmation", async () => {
  model.script.push(callTool("apply_leave", { leave_type: "CL", start_date: "2026-11-02", end_date: "2026-11-06" }));
  model.script.push(say("Casual leave is limited to 3 days."));
  const result = await runner.run({ employeeId: asha, threadId: "t-invalid", message: "Apply CL Nov 2-6" });
  assert.equal(result.confirmation, undefined);
  assert.equal(result.reply, "Casual leave is limited to 3 days.");
});

test("threads are per employee: same threadId, different user = separate conversation", async () => {
  model.script.push(callTool("apply_leave", { leave_type: "CL", start_date: "2026-11-10", end_date: "2026-11-10" }));
  await runner.run({ employeeId: asha, threadId: "t-shared", message: "Apply CL Nov 10" });
  assert.equal(await runner.hasPendingConfirmation(asha, "t-shared"), true);
  assert.equal(await runner.hasPendingConfirmation("E1002", "t-shared"), false);
  await assert.rejects(runner.run({ employeeId: "E1002", threadId: "t-shared", resume: { approved: true } }), ConfirmationStateError);
});

test("memory keeps earlier turns, capped to the most recent ones", async () => {
  for (let i = 1; i <= 6; i++) {
    model.script.push(say(`answer ${i}`));
    await runner.run({ employeeId: asha, threadId: "t-memory", message: `question ${i}` });
  }
  const kept = await history(asha, "t-memory");
  assert.equal(kept.length, MAX_HISTORY_MESSAGES);
  assert.ok(HumanMessage.isInstance(kept[0]));
  assert.equal(kept[0].text, "question 3");
  assert.equal(kept.at(-1)?.text, "answer 6");
});

test("cancel_leave pauses for confirmation, then cancels and frees the balance", async () => {
  const status = () => (getDb().prepare(`SELECT status FROM leave_requests WHERE id = 4`).get() as { status: string }).status;
  const clAvailable = () => repo.getLeaveBalances(asha, 2026, "CL")[0].available;
  assert.equal(status(), "pending");
  const before = clAvailable();

  model.script.push(callTool("cancel_leave", { request_id: 4 }));
  const paused = await runner.run({ employeeId: asha, threadId: "t-cancel-leave", message: "Cancel my Oct 16 leave" });
  assert.equal(paused.confirmation?.type, "confirm_cancel");
  assert.equal(status(), "pending", "nothing changed before confirmation");

  model.script.push(say("Cancelled request #4."));
  const done = await runner.run({ employeeId: asha, threadId: "t-cancel-leave", resume: { approved: true } });
  assert.equal(done.reply, "Cancelled request #4.");
  assert.equal(status(), "cancelled");
  assert.equal(clAvailable(), before + 1, "pending day returned to the balance");

  // Cancelling again: rule check returns a problem, no confirmation.
  model.script.push(callTool("cancel_leave", { request_id: 4 }));
  model.script.push(say("Already cancelled."));
  const again = await runner.run({ employeeId: asha, threadId: "t-cancel-again", message: "Cancel #4" });
  assert.equal(again.confirmation, undefined);
});
