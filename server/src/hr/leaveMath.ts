// Deterministic leave calculations. Pure functions: no DB, no LLM, easy to test.
// The LLM never does this arithmetic — it calls tools that call these.
import { addMonths, toDate, toIso } from "./dates";

// Mirrors the leave policy document (Stage 4).
export const ENCASHMENT_MAX_DAYS_PER_YEAR = 15;

export interface Holiday {
  date: string;
  name: string;
}

export interface WorkingDays {
  calendarDays: number;
  weekendDays: number;
  holidays: Holiday[]; // weekday holidays inside the range (not counted as leave)
  workingDays: number; // days that would actually be deducted
}

export function countWorkingDays(start: string, end: string, holidays: Holiday[]): WorkingDays {
  const from = toDate(start);
  const to = toDate(end);
  if (to < from) throw new Error(`end_date ${end} is before start_date ${start}.`);

  const holidayByDate = new Map(holidays.map((h) => [h.date, h.name]));
  const result: WorkingDays = { calendarDays: 0, weekendDays: 0, holidays: [], workingDays: 0 };

  for (const d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    result.calendarDays++;
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) {
      result.weekendDays++;
      continue;
    }
    const iso = toIso(d);
    const holidayName = holidayByDate.get(iso);
    if (holidayName) {
      result.holidays.push({ date: iso, name: holidayName });
      continue;
    }
    result.workingDays++;
  }
  return result;
}

// Whole months completed between two dates (e.g. 14 Jun -> 13 Jul = 0, -> 14 Jul = 1).
export function tenureMonths(joiningDate: string, asOf: string): number {
  const j = toDate(joiningDate);
  const a = toDate(asOf);
  let months = (a.getUTCFullYear() - j.getUTCFullYear()) * 12 + (a.getUTCMonth() - j.getUTCMonth());
  if (a.getUTCDate() < j.getUTCDate()) months--;
  return Math.max(0, months);
}

export function eligibleFrom(joiningDate: string, minTenureMonths: number): string {
  return addMonths(joiningDate, minTenureMonths);
}

// Entitlement for a calendar year. Joiners get quota x remaining months / 12;
// the joining month counts only if they joined on or before the 15th.
// Rounded to the nearest half day.
export function proRataEntitlement(annualQuota: number, joiningDate: string, year: number): number {
  const j = toDate(joiningDate);
  const joinYear = j.getUTCFullYear();
  if (joinYear < year) return annualQuota;
  if (joinYear > year) return 0;

  let months = 12 - j.getUTCMonth();
  if (j.getUTCDate() > 15) months--;
  return Math.round(((annualQuota * months) / 12) * 2) / 2;
}

export function encashableDays(available: number, encashable: boolean): number {
  if (!encashable) return 0;
  return Math.min(Math.max(available, 0), ENCASHMENT_MAX_DAYS_PER_YEAR);
}

// Loss of pay: requested days not covered by the available balance.
export function lossOfPayDays(requested: number, available: number): number {
  return Math.max(0, requested - Math.max(0, available));
}
