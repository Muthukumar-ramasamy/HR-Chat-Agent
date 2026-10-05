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

const ravi = "E1000"; // manager of E1001-E1003
const newPendingRequest = (employeeId: string, start: string) =>
  repo.createLeaveRequest({ employeeId, leaveType: "CL", startDate: start, endDate: start, days: 1, reason: null, appliedOn: "2026-10-05" });
const statusOf = (id: number) => (getDb().prepare(`SELECT status FROM leave_requests WHERE id = ?`).get(id) as { status: string }).status;

test("manager approves a direct report's request after confirmation", async () => {
  const id = newPendingRequest("E1002", "2026-11-12");
  model.script.push(callTool("decide_leave_request", { request_id: id, decision: "approve" }));
  const paused = await runner.run({ employeeId: ravi, threadId: "t-approve-team", message: `Approve #${id}` });
  assert.equal(paused.confirmation?.type, "confirm_decision");
  assert.ok(paused.confirmation?.type === "confirm_decision" && paused.confirmation.employee_name === "Dev Patel");
  assert.equal(statusOf(id), "pending", "nothing changed before confirmation");

  model.script.push(say("Approved."));
  await runner.run({ employeeId: ravi, threadId: "t-approve-team", resume: { approved: true } });
  assert.equal(statusOf(id), "approved");
});

test("manager rejects; cannot decide own or non-pending requests", async () => {
  const id = newPendingRequest("E1003", "2026-11-13");
  model.script.push(callTool("decide_leave_request", { request_id: id, decision: "reject" }));
  await runner.run({ employeeId: ravi, threadId: "t-reject-team", message: `Reject #${id}` });
  model.script.push(say("Rejected."));
  await runner.run({ employeeId: ravi, threadId: "t-reject-team", resume: { approved: true } });
  assert.equal(statusOf(id), "rejected");

  // #7 is Ravi's own request (he has no manager), #1 is already approved: no confirmation offered.
  for (const requestId of [7, 1]) {
    model.script.push(callTool("decide_leave_request", { request_id: requestId, decision: "approve" }));
    model.script.push(say("Can't do that."));
    const r = await runner.run({ employeeId: ravi, threadId: `t-not-allowed-${requestId}`, message: `Approve #${requestId}` });
    assert.equal(r.confirmation, undefined);
  }
  assert.equal(statusOf(7), "approved");
});

test("employees cannot use manager tools, even if the model calls them", async () => {
  const id = newPendingRequest("E1002", "2026-11-16");
  model.script.push(callTool("decide_leave_request", { request_id: id, decision: "approve" }));
  model.script.push(say("Only managers can approve."));
  const r = await runner.run({ employeeId: asha, threadId: "t-employee-manager-tool", message: `Approve #${id}` });
  assert.equal(r.confirmation, undefined);
  assert.equal(statusOf(id), "pending");
});

test("team queries only include direct reports", () => {
  const names = repo.getDirectReports(ravi).map((r) => r.name);
  assert.deepEqual(names, ["Asha Rao", "Dev Patel", "Priya Nair"]);
  assert.deepEqual(repo.getDirectReports(asha), []);
  const team = repo.getTeamRequests(ravi, "2026-01-01", "2026-12-31", ["approved", "pending"]);
  assert.ok(team.length > 0 && team.every((r) => ["E1001", "E1002", "E1003"].includes(r.employee_id)));
  assert.equal(repo.getTeamRequest(ravi, 7), undefined, "manager's own request is not a team request");
});
