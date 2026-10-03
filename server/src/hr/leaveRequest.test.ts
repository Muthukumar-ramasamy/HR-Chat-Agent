import { after, test } from "node:test";
import assert from "node:assert/strict";
import { useTempDb } from "../db/tempDb";

process.env.APP_TODAY = "2026-10-05"; // Monday; must be set before config loads
after(await useTempDb("leave-request")); // fresh seed data, independent of the demo DB
const { validateLeaveRequest } = await import("./leaveRequest");
const repo = await import("./repo");

const asha = repo.getEmployee("E1001")!; // Chennai, CL 10 (1 pending on Oct 16), EL 21, SL 14
const priya = repo.getEmployee("E1003")!; // joined 2026-07-01, no EL yet

const problems = (check: ReturnType<typeof validateLeaveRequest>) => (check.ok ? [] : check.problems);

test("valid EL request returns a confirmation summary", () => {
  const check = validateLeaveRequest(asha, "EL", "2026-12-22", "2027-01-02");
  assert.ok(check.ok);
  assert.deepEqual(check.summary, {
    leave_type: "EL",
    leave_name: "Earned Leave",
    start_date: "2026-12-22",
    end_date: "2027-01-02",
    working_days: 7,
    balance_before: 21,
    balance_after: 14,
  });
});

test("CL is limited to 3 consecutive working days", () => {
  assert.match(problems(validateLeaveRequest(asha, "CL", "2026-11-02", "2026-11-06")).join(), /3 consecutive/);
  assert.ok(validateLeaveRequest(asha, "CL", "2026-11-02", "2026-11-04").ok);
});

test("EL of 3+ days needs 7 days' notice", () => {
  assert.match(problems(validateLeaveRequest(asha, "EL", "2026-10-07", "2026-10-09")).join(), /notice/);
  assert.ok(validateLeaveRequest(asha, "EL", "2026-10-07", "2026-10-08").ok); // 2 days: no notice rule
});

test("tenure, balance, past dates and overlaps are rejected", () => {
  assert.match(problems(validateLeaveRequest(priya, "EL", "2026-12-01", "2026-12-01")).join(), /months' service/);
  assert.match(problems(validateLeaveRequest(asha, "EL", "2026-11-02", "2026-12-31")).join(), /only 21 EL available/);
  assert.match(problems(validateLeaveRequest(asha, "CL", "2026-10-01", "2026-10-01")).join(), /past/);
  assert.match(problems(validateLeaveRequest(asha, "CL", "2026-10-15", "2026-10-16")).join(), /Overlaps existing pending CL request #4/);
  assert.match(problems(validateLeaveRequest(asha, "CL", "2026-10-10", "2026-10-11")).join(), /no working days/);
});

test("sick leave can be backdated", () => {
  assert.ok(validateLeaveRequest(asha, "SL", "2026-10-01", "2026-10-01").ok);
});
