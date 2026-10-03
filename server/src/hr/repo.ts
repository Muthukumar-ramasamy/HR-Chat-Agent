// Read-only queries over the HR database.
import { getDb } from "../db";
import type { Holiday } from "./leaveMath";

export type LeaveCode = "CL" | "SL" | "EL";

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: "employee" | "manager";
  grade: string;
  department: string;
  location: string;
  joining_date: string;
  manager_id: string | null;
  manager_name: string | null;
}

export interface LeaveType {
  code: LeaveCode;
  name: string;
  annual_quota: number;
  min_tenure_months: number;
  max_carry_forward: number;
  encashable: number;
}

export interface LeaveBalance {
  leave_type: LeaveCode;
  name: string;
  year: number;
  allocated: number;
  carried_forward: number;
  used: number; // approved
  pending: number; // awaiting approval, already reserved
  available: number;
}

export interface LeaveRequest {
  id: number;
  leave_type: LeaveCode;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: string;
  applied_on: string;
}

export function getEmployee(employeeId: string): Employee | undefined {
  return getDb()
    .prepare(
      `SELECT e.id, e.name, e.email, e.role, e.grade, e.department, e.location, e.joining_date,
              e.manager_id, m.name AS manager_name
         FROM employees e LEFT JOIN employees m ON m.id = e.manager_id
        WHERE e.id = ?`,
    )
    .get(employeeId) as Employee | undefined;
}

// Only for login: the one query that returns the password hash.
export function getLoginRecord(email: string): { id: string; password_hash: string } | undefined {
  return getDb()
    .prepare(`SELECT id, password_hash FROM employees WHERE email = ? COLLATE NOCASE`)
    .get(email) as { id: string; password_hash: string } | undefined;
}

export function getLeaveType(code: LeaveCode): LeaveType | undefined {
  return getDb().prepare(`SELECT * FROM leave_types WHERE code = ?`).get(code) as LeaveType | undefined;
}

export function getLeaveBalances(employeeId: string, year: number, leaveType?: LeaveCode): LeaveBalance[] {
  // used/pending only count requests starting in the same year as the allocation.
  return getDb()
    .prepare(
      `SELECT a.leave_type, lt.name, a.year, a.allocated, a.carried_forward,
              COALESCE(SUM(CASE WHEN r.status = 'approved' THEN r.days END), 0) AS used,
              COALESCE(SUM(CASE WHEN r.status = 'pending'  THEN r.days END), 0) AS pending
         FROM leave_allocations a
         JOIN leave_types lt ON lt.code = a.leave_type
         LEFT JOIN leave_requests r
                ON r.employee_id = a.employee_id
               AND r.leave_type = a.leave_type
               AND CAST(strftime('%Y', r.start_date) AS INTEGER) = a.year
        WHERE a.employee_id = ? AND a.year = ? AND (? IS NULL OR a.leave_type = ?)
        GROUP BY a.leave_type
        ORDER BY a.leave_type`,
    )
    .all(employeeId, year, leaveType ?? null, leaveType ?? null)
    .map((row) => {
      const r = row as Omit<LeaveBalance, "available">;
      return { ...r, available: r.allocated + r.carried_forward - r.used - r.pending };
    });
}

export function getLeaveRequests(employeeId: string, from: string, to: string): LeaveRequest[] {
  // Any request overlapping [from, to].
  return getDb()
    .prepare(
      `SELECT id, leave_type, start_date, end_date, days, reason, status, applied_on
         FROM leave_requests
        WHERE employee_id = ? AND start_date <= ? AND end_date >= ?
        ORDER BY start_date`,
    )
    .all(employeeId, to, from) as LeaveRequest[];
}

export function getHolidays(location: string, from: string, to: string): Holiday[] {
  return getDb()
    .prepare(
      `SELECT date, name FROM holidays
        WHERE location IN ('ALL', ?) AND date BETWEEN ? AND ?
        ORDER BY date`,
    )
    .all(location, from, to) as Holiday[];
}

export function listLocations(): string[] {
  return (getDb().prepare(`SELECT DISTINCT location FROM employees ORDER BY location`).all() as { location: string }[]).map(
    (r) => r.location,
  );
}
