// HR tools the LLM can call. Each tool = name + description + zod input schema + function.
// The model only sees name/description/schema and decides when to call a tool;
// our code runs the function and sends the result back.
//
// TOKENS: descriptions/schemas are sent with every model call, and results come back as
// input tokens, so both are kept short. Results never echo the inputs.
//
// SECURITY: no tool accepts an employee ID. The ID comes from the run config
// (config.configurable.employee_id), which the server sets from the verified login.
import { tool, type ToolRunnableConfig } from "@langchain/core/tools";
import { z } from "zod";
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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const leaveType = z.enum(["CL", "SL", "EL"]); // meanings are in the system prompt

function currentEmployee(config: ToolRunnableConfig): repo.Employee {
  const id = config?.configurable?.employee_id;
  if (typeof id !== "string" || !id) throw new Error("No authenticated employee in this session.");
  const employee = repo.getEmployee(id);
  if (!employee) throw new Error("Authenticated employee not found.");
  return employee;
}

const currentYear = () => Number(today().slice(0, 4));
const json = (value: unknown) => JSON.stringify(value);

export const getEmployeeProfile = tool(
  async (_input, config) => {
    const e = currentEmployee(config);
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
  async ({ leave_type }, config) => {
    const e = currentEmployee(config);
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
  async ({ from_date, to_date }, config) => {
    const e = currentEmployee(config);
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
  async ({ year, location }, config) => {
    const e = currentEmployee(config);
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
  async ({ calculation, leave_type, start_date, end_date }, config) => {
    const e = currentEmployee(config);
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
  async ({ leave_type }, config) => {
    const e = currentEmployee(config);
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

export const hrTools = [
  getEmployeeProfile,
  getLeaveBalance,
  getLeaveHistory,
  getHolidays,
  calculateLeave,
  checkEligibility,
];
