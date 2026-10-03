// HR tools the LLM can call. Each tool = name + description + zod input schema + function.
// The model only sees name/description/schema and decides when to call a tool;
// our code runs the function and sends the result back.
//
// TOKENS: descriptions/schemas are sent with every model call, and results come back as
// input tokens, so both are kept short. Results never echo the inputs.
//
// SECURITY: no tool accepts an employee ID. The ID comes from graph state
// (runtime.state.employeeId), which only our code sets — from the verified login.
import { tool, type ToolRuntime } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";
import { validateLeaveRequest, type LeaveRequestSummary } from "../hr/leaveRequest";
import { today } from "../hr/dates";
import {
  countWorkingDays,
  eligibleFrom,
  encashableDays,
  ENCASHMENT_MAX_DAYS_PER_YEAR,
  lossOfPayDays,
  proRataEntitlement,
  tenureMonths,
} from "../hr/leaveMath";
import * as repo from "../hr/repo";
import { getPolicyIndex } from "../rag/policyIndex";
import type { AgentStateType } from "../agent/state";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const leaveType = z.enum(["CL", "SL", "EL"]); // meanings are in the system prompt

type Runtime = ToolRuntime<AgentStateType>;

// What the app shows when apply_leave pauses, and the answer it resumes with.
export type LeaveConfirmation = { type: "confirm_leave"; reason: string | null } & LeaveRequestSummary;
export const ConfirmDecision = z.object({ approved: z.boolean() });

function currentEmployee(runtime: Runtime): repo.Employee {
  const id = runtime?.state?.employeeId;
  if (typeof id !== "string" || !id) throw new Error("No authenticated employee in this session.");
  const employee = repo.getEmployee(id);
  if (!employee) throw new Error("Authenticated employee not found.");
  return employee;
}

const currentYear = () => Number(today().slice(0, 4));
const json = (value: unknown) => JSON.stringify(value);

export const getEmployeeProfile = tool(
  async (_input, runtime: Runtime) => {
    const e = currentEmployee(runtime);
    const months = tenureMonths(e.joining_date, today());
    return json({
      name: e.name,
      grade: e.grade,
      department: e.department,
      location: e.location,
      joining_date: e.joining_date,
      tenure: `${Math.floor(months / 12)}y ${months % 12}m`,
      manager: e.manager_name,
    });
  },
  {
    name: "get_employee_profile",
    description: "User's profile: grade, department, location, joining date, tenure, manager.",
    schema: z.object({}),
  },
);

export const getLeaveBalance = tool(
  async ({ leave_type }, runtime: Runtime) => {
    const e = currentEmployee(runtime);
    const year = currentYear();
    const balances = repo.getLeaveBalances(e.id, year, leave_type);
    if (balances.length === 0) return json({ year, message: "No leave allocation found for this year." });
    const rows = balances.map(({ leave_type, allocated, carried_forward, used, pending, available }) => ({
      type: leave_type,
      allocated,
      carried_forward,
      used,
      pending,
      available,
    }));
    const total_available = balances.reduce((sum, b) => sum + b.available, 0);
    return json({ year, balances: rows, total_available });
  },
  {
    name: "get_leave_balance",
    description: "User's leave balance this year (all types if leave_type omitted).",
    schema: z.object({ leave_type: leaveType.optional() }),
  },
);

export const getLeaveHistory = tool(
  async ({ from_date, to_date }, runtime: Runtime) => {
    const e = currentEmployee(runtime);
    const year = currentYear();
    const from = from_date ?? `${year}-01-01`;
    const to = to_date ?? `${year}-12-31`;
    const requests = repo.getLeaveRequests(e.id, from, to).map((r) => ({
      id: r.id,
      type: r.leave_type,
      start: r.start_date,
      end: r.end_date,
      days: r.days,
      status: r.status,
    }));
    return json({ from, to, requests });
  },
  {
    name: "get_leave_history",
    description: "User's leave requests overlapping a date range (default: this year).",
    schema: z.object({ from_date: isoDate.optional(), to_date: isoDate.optional() }),
  },
);

export const getHolidays = tool(
  async ({ year, location }, runtime: Runtime) => {
    const e = currentEmployee(runtime);
    const loc = location ?? e.location;
    const known = repo.listLocations();
    if (!known.includes(loc)) return json({ error: `Unknown location "${loc}". Known: ${known.join(", ")}` });
    const holidays = repo.getHolidays(loc, `${year}-01-01`, `${year}-12-31`);
    return json({ location: loc, holidays: holidays.map((h) => `${h.date} ${h.name}`) });
  },
  {
    name: "get_holidays",
    description: "Public holidays for a year; location defaults to the user's office.",
    schema: z.object({ year: z.number().int(), location: z.string().optional() }),
  },
);

export const calculateLeave = tool(
  async ({ calculation, leave_type, start_date, end_date }, runtime: Runtime) => {
    const e = currentEmployee(runtime);
    const year = currentYear();

    switch (calculation) {
      case "leave_days": {
        if (!start_date || !end_date) throw new Error("leave_days needs start_date and end_date.");
        const days = countWorkingDays(start_date, end_date, repo.getHolidays(e.location, start_date, end_date));
        const result: Record<string, unknown> = {
          working_days: days.workingDays,
          weekend_days: days.weekendDays,
          holidays: days.holidays.map((h) => `${h.date} ${h.name}`),
        };
        const overlapping = repo
          .getLeaveRequests(e.id, start_date, end_date)
          .filter((r) => r.status === "approved" || r.status === "pending");
        if (overlapping.length) {
          result.overlapping_requests = overlapping.map(
            (r) => `#${r.id} ${r.leave_type} ${r.start_date}..${r.end_date} ${r.status}`,
          );
        }
        if (leave_type) {
          const available = repo.getLeaveBalances(e.id, year, leave_type)[0]?.available ?? 0;
          result.available = available;
          result.loss_of_pay_days = lossOfPayDays(days.workingDays, available);
          result.balance_after_leave = Math.max(available - days.workingDays, 0);
          if (end_date.slice(0, 4) !== start_date.slice(0, 4)) result.note = `Checked against ${year} balance.`;
        }
        return json(result);
      }

      case "pro_rata_entitlement": {
        if (!leave_type) throw new Error("pro_rata_entitlement needs leave_type.");
        const lt = repo.getLeaveType(leave_type)!;
        return json({
          year,
          annual_quota: lt.annual_quota,
          joining_date: e.joining_date,
          entitlement: proRataEntitlement(lt.annual_quota, e.joining_date, year),
        });
      }

      case "encashment": {
        if (!leave_type) throw new Error("encashment needs leave_type.");
        const lt = repo.getLeaveType(leave_type)!;
        const available = repo.getLeaveBalances(e.id, year, leave_type)[0]?.available ?? 0;
        return json({
          available,
          max_per_year: lt.encashable ? ENCASHMENT_MAX_DAYS_PER_YEAR : 0,
          encashable_days: encashableDays(available, lt.encashable === 1),
        });
      }
    }
  },
  {
    name: "calculate_leave",
    description:
      "Leave math for the user. leave_days (start_date, end_date inclusive): working days excluding weekends and " +
      "the user's holidays, overlapping requests; with leave_type also available, loss_of_pay_days, balance_after_leave. " +
      "pro_rata_entitlement / encashment: need leave_type.",
    schema: z.object({
      calculation: z.enum(["leave_days", "pro_rata_entitlement", "encashment"]),
      leave_type: leaveType.optional(),
      start_date: isoDate.optional(),
      end_date: isoDate.optional(),
    }),
  },
);

export const checkEligibility = tool(
  async ({ leave_type }, runtime: Runtime) => {
    const e = currentEmployee(runtime);
    const lt = repo.getLeaveType(leave_type)!;
    const months = tenureMonths(e.joining_date, today());
    const available = repo.getLeaveBalances(e.id, currentYear(), leave_type)[0]?.available ?? 0;

    const reasons: string[] = [];
    if (months < lt.min_tenure_months) {
      reasons.push(
        `Needs ${lt.min_tenure_months} months' service (has ${months}); eligible from ${eligibleFrom(e.joining_date, lt.min_tenure_months)}.`,
      );
    }
    if (available <= 0) reasons.push("No balance available.");

    return json({ eligible: reasons.length === 0, reasons, available });
  },
  {
    name: "check_eligibility",
    description: "Can the user take this leave type now (tenure + balance)?",
    schema: z.object({ leave_type: leaveType }),
  },
);

// RAG: the model sends a search query, we return the top policy sections with a citation label.
// No identity needed — policies are the same for everyone.
export const searchPolicy = tool(
  async ({ query }) => {
    const hits = getPolicyIndex().search(query);
    if (hits.length === 0) return json({ results: [], note: "No matching policy section." });
    return json({
      results: hits.map((h) => ({
        source: `${h.doc} §${h.section.replace(/^(\d+)\.\s*/, "$1 ")}`, // "Leave Policy §4 Earned Leave (EL)"
        text: h.text,
      })),
    });
  },
  {
    name: "search_policy",
    description: "Keyword search over HR policy documents. Returns up to 3 sections with a source label to cite.",
    schema: z.object({ query: z.string().describe("Keywords, e.g. 'earned leave carry forward'") }),
  },
);

// Human-in-the-loop write. Order matters:
//   1. validate in code (nothing to confirm if it would be rejected)
//   2. interrupt(): the graph pauses and the app shows the summary to the user
//   3. resumed with {approved}: only then write to the database
// On resume, LangGraph re-runs this tool from the top; interrupt() then returns the user's
// answer instead of pausing. Steps before it must therefore be side-effect free.
export const applyLeave = tool(
  async ({ leave_type, start_date, end_date, reason }, runtime: Runtime) => {
    const e = currentEmployee(runtime);
    const check = validateLeaveRequest(e, leave_type, start_date, end_date);
    if (!check.ok) return json({ submitted: false, problems: check.problems });

    const confirmation: LeaveConfirmation = { type: "confirm_leave", ...check.summary, reason: reason ?? null };
    const decision = interrupt(confirmation, { responseSchema: ConfirmDecision });
    if (!decision.approved) return json({ submitted: false, note: "User cancelled; nothing was saved." });

    const id = repo.createLeaveRequest({
      employeeId: e.id,
      leaveType: leave_type,
      startDate: start_date,
      endDate: end_date,
      days: check.summary.working_days,
      reason: reason ?? null,
      appliedOn: today(),
    });
    return json({ submitted: true, request_id: id, status: "pending manager approval", balance_after: check.summary.balance_after });
  },
  {
    name: "apply_leave",
    description:
      "Submit a leave request for the user. The app asks the user to confirm before saving, so call it directly " +
      "(don't ask for confirmation yourself). Returns problems instead if the request breaks a rule.",
    schema: z.object({
      leave_type: leaveType,
      start_date: isoDate,
      end_date: isoDate,
      reason: z.string().max(200).optional().describe("Only if the user gave one"),
    }),
  },
);

export const hrTools = [
  applyLeave,
  searchPolicy,
  getEmployeeProfile,
  getLeaveBalance,
  getLeaveHistory,
  getHolidays,
  calculateLeave,
  checkEligibility,
];
