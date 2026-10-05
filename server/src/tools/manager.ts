// Manager-only tools. They are bound to the model only for users with role "manager"
// (employees don't pay tokens for them), and each tool re-checks the role itself.
// Every query is scoped to the manager's direct reports.
import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";
import { addMonths, today } from "../hr/dates";
import * as repo from "../hr/repo";
import { ConfirmDecision, currentEmployee, isoDate, json, type Runtime } from "./common";

export type DecisionConfirmation = {
  type: "confirm_decision";
  decision: "approve" | "reject";
  request_id: number;
  employee_name: string;
  leave_type: repo.LeaveCode;
  leave_name: string;
  start_date: string;
  end_date: string;
  working_days: number;
  reason: string | null;
};

function currentManager(runtime: Runtime): repo.Employee {
  const e = currentEmployee(runtime);
  if (e.role !== "manager") throw new Error("Only managers can use team tools.");
  return e;
}

// Compact one-line form: "#4 Asha Rao CL 2026-10-16..2026-10-16 1d pending"
const line = (r: repo.TeamLeaveRequest) =>
  `#${r.id} ${r.employee_name} ${r.leave_type} ${r.start_date}..${r.end_date} ${r.days}d ${r.status}`;

export const getTeamLeave = tool(
  async ({ from_date, to_date }, runtime: Runtime) => {
    const m = currentManager(runtime);
    const from = from_date ?? today();
    const to = to_date ?? addMonths(from, 1);
    const requests = repo.getTeamRequests(m.id, from, to, ["approved", "pending"]);
    return json({ from, to, team: repo.getDirectReports(m.id).map((r) => r.name), leave: requests.map(line) });
  },
  {
    name: "get_team_leave",
    description: "Manager only: approved and pending leave of the user's direct reports in a date range (default: next month).",
    schema: z.object({ from_date: isoDate.optional(), to_date: isoDate.optional() }),
  },
);

export const getPendingApprovals = tool(
  async (_input, runtime: Runtime) => {
    const m = currentManager(runtime);
    return json({
      pending: repo.getPendingTeamRequests(m.id).map((r) => `${line(r)} applied ${r.applied_on}${r.reason ? ` "${r.reason}"` : ""}`),
    });
  },
  {
    name: "get_pending_approvals",
    description: "Manager only: the direct reports' leave requests waiting for the user's decision.",
    schema: z.object({}),
  },
);

// Human-in-the-loop: validate, pause for the manager's confirmation, then write.
export const decideLeaveRequest = tool(
  async ({ request_id, decision }, runtime: Runtime) => {
    const m = currentManager(runtime);
    const r = repo.getTeamRequest(m.id, request_id);
    if (!r) return json({ decided: false, problems: [`No request #${request_id} from your team.`] });
    if (r.status !== "pending") return json({ decided: false, problems: [`Request #${request_id} is already ${r.status}.`] });

    const confirmation: DecisionConfirmation = {
      type: "confirm_decision",
      decision,
      request_id: r.id,
      employee_name: r.employee_name,
      leave_type: r.leave_type,
      leave_name: repo.getLeaveType(r.leave_type)!.name,
      start_date: r.start_date,
      end_date: r.end_date,
      working_days: r.days,
      reason: r.reason,
    };
    const answer = interrupt(confirmation, { responseSchema: ConfirmDecision });
    if (!answer.approved) return json({ decided: false, note: "Manager did not confirm; nothing changed." });

    const status = decision === "approve" ? "approved" : "rejected";
    if (!repo.decideLeaveRequest(m.id, request_id, status)) {
      return json({ decided: false, problems: ["The request changed meanwhile; nothing was updated."] });
    }
    return json({ decided: true, request_id, employee: r.employee_name, status, note: "No notifications are sent." });
  },
  {
    name: "decide_leave_request",
    description:
      "Manager only: approve or reject a direct report's pending request (id from get_pending_approvals). " +
      "The app asks the manager to confirm, so call it directly.",
    schema: z.object({ request_id: z.number().int(), decision: z.enum(["approve", "reject"]) }),
  },
);

export const managerTools = [getTeamLeave, getPendingApprovals, decideLeaveRequest];
