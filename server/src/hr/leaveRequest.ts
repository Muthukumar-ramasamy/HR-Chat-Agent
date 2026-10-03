// Validation for new leave requests. Deterministic: a request is only offered for
// confirmation (and saved) if every rule passes. The LLM can't skip these checks.
import { today, toDate } from "./dates";
import { countWorkingDays, eligibleFrom, tenureMonths } from "./leaveMath";
import * as repo from "./repo";

// Mirror the Leave Policy document (§2 and §4).
export const CL_MAX_CONSECUTIVE_DAYS = 3;
export const EL_NOTICE_DAYS = 7;
export const EL_NOTICE_APPLIES_FROM_DAYS = 3;

export interface LeaveRequestSummary {
  leave_type: repo.LeaveCode;
  leave_name: string;
  start_date: string;
  end_date: string;
  working_days: number;
  balance_before: number;
  balance_after: number;
}

export type LeaveCheck = { ok: true; summary: LeaveRequestSummary } | { ok: false; problems: string[] };

const daysBetween = (from: string, to: string) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000);

export function validateLeaveRequest(
  employee: repo.Employee,
  leaveType: repo.LeaveCode,
  startDate: string,
  endDate: string,
): LeaveCheck {
  const now = today();
  const lt = repo.getLeaveType(leaveType)!;
  const days = countWorkingDays(startDate, endDate, repo.getHolidays(employee.location, startDate, endDate));
  const available = repo.getLeaveBalances(employee.id, Number(now.slice(0, 4)), leaveType)[0]?.available ?? 0;
  const problems: string[] = [];

  if (startDate < now && leaveType !== "SL") problems.push("Start date is in the past (only sick leave can be backdated).");
  if (days.workingDays === 0) problems.push("The dates contain no working days.");

  const months = tenureMonths(employee.joining_date, now);
  if (months < lt.min_tenure_months) {
    problems.push(`${lt.name} needs ${lt.min_tenure_months} months' service; eligible from ${eligibleFrom(employee.joining_date, lt.min_tenure_months)}.`);
  }
  if (days.workingDays > available) {
    problems.push(`Needs ${days.workingDays} days but only ${available} ${leaveType} available.`);
  }
  if (leaveType === "CL" && days.workingDays > CL_MAX_CONSECUTIVE_DAYS) {
    problems.push(`Casual leave is limited to ${CL_MAX_CONSECUTIVE_DAYS} consecutive working days (Leave Policy §2).`);
  }
  if (leaveType === "EL" && days.workingDays >= EL_NOTICE_APPLIES_FROM_DAYS && daysBetween(now, startDate) < EL_NOTICE_DAYS) {
    problems.push(`Earned leave of ${EL_NOTICE_APPLIES_FROM_DAYS}+ days needs ${EL_NOTICE_DAYS} days' notice (Leave Policy §4).`);
  }
  const overlapping = repo
    .getLeaveRequests(employee.id, startDate, endDate)
    .filter((r) => r.status === "approved" || r.status === "pending");
  for (const r of overlapping) {
    problems.push(`Overlaps existing ${r.status} ${r.leave_type} request #${r.id} (${r.start_date} to ${r.end_date}).`);
  }

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    summary: {
      leave_type: leaveType,
      leave_name: lt.name,
      start_date: startDate,
      end_date: endDate,
      working_days: days.workingDays,
      balance_before: available,
      balance_after: available - days.workingDays,
    },
  };
}
