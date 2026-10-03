// Seeds SYNTHETIC demo data. Every name, email and record below is fictional.
//   npm run db:seed    -> seeds only if the database is empty
//   npm run db:reset   -> clears the demo tables and reseeds
import bcrypt from "bcryptjs";
import { getDb } from "./index";

const DEMO_PASSWORD = "Password@123";

const employees = [
  // id, name, email, role, grade, department, location, joining_date, manager_id
  ["E1000", "Ravi Kumar", "ravi.kumar@example.com", "manager", "G7", "Engineering", "Chennai", "2017-03-01", null],
  ["E1001", "Asha Rao", "asha.rao@example.com", "employee", "G5", "Engineering", "Chennai", "2021-06-14", "E1000"],
  ["E1002", "Dev Patel", "dev.patel@example.com", "employee", "G4", "Engineering", "Bengaluru", "2023-01-09", "E1000"],
  ["E1003", "Priya Nair", "priya.nair@example.com", "employee", "G3", "Engineering", "Bengaluru", "2026-07-01", "E1000"],
] as const;

const leaveTypes = [
  // code, name, annual_quota, min_tenure_months, max_carry_forward, encashable
  ["CL", "Casual Leave", 12, 0, 0, 0],
  ["SL", "Sick Leave", 12, 0, 6, 0],
  ["EL", "Earned Leave", 18, 6, 30, 1],
] as const;

const allocations = [
  // employee_id, leave_type, year, allocated, carried_forward
  ["E1000", "CL", 2026, 12, 0], ["E1000", "SL", 2026, 12, 6], ["E1000", "EL", 2026, 18, 30],
  ["E1001", "CL", 2026, 12, 0], ["E1001", "SL", 2026, 12, 4], ["E1001", "EL", 2026, 18, 8],
  ["E1002", "CL", 2026, 12, 0], ["E1002", "SL", 2026, 12, 2], ["E1002", "EL", 2026, 18, 5],
  // Priya joined 1 Jul 2026: half-year pro-rated quota, no EL until 6 months of tenure
  ["E1003", "CL", 2026, 6, 0], ["E1003", "SL", 2026, 6, 0], ["E1003", "EL", 2026, 0, 0],
] as const;

const leaveRequests = [
  // employee_id, leave_type, start, end, days, reason, status, applied_on
  ["E1001", "EL", "2026-03-16", "2026-03-20", 5, "Family trip", "approved", "2026-02-20"],
  ["E1001", "SL", "2026-05-04", "2026-05-05", 2, "Fever", "approved", "2026-05-06"],
  ["E1001", "CL", "2026-08-14", "2026-08-14", 1, "Personal work", "approved", "2026-08-10"],
  ["E1001", "CL", "2026-10-16", "2026-10-16", 1, "Personal work", "pending", "2026-10-01"],
  ["E1002", "EL", "2026-06-01", "2026-06-10", 8, "Vacation", "approved", "2026-05-01"],
  ["E1002", "SL", "2026-09-07", "2026-09-07", 1, "Migraine", "approved", "2026-09-08"],
  ["E1000", "CL", "2026-04-13", "2026-04-14", 2, "Personal work", "approved", "2026-04-01"],
  ["E1003", "CL", "2026-09-18", "2026-09-18", 1, "Personal work", "approved", "2026-09-15"],
] as const;

const holidays = [
  // date, name, location ('ALL' = every office)
  ["2026-01-01", "New Year's Day", "ALL"],
  ["2026-01-15", "Pongal", "Chennai"],
  ["2026-01-26", "Republic Day", "ALL"],
  ["2026-05-01", "May Day", "ALL"],
  ["2026-08-15", "Independence Day", "ALL"],
  ["2026-10-02", "Gandhi Jayanti", "ALL"],
  ["2026-10-20", "Ayudha Puja", "ALL"],
  ["2026-11-01", "Karnataka Rajyotsava", "Bengaluru"],
  ["2026-11-09", "Diwali (observed)", "ALL"],
  ["2026-12-25", "Christmas", "ALL"],
  ["2027-01-01", "New Year's Day", "ALL"],
  ["2027-01-15", "Pongal", "Chennai"],
  ["2027-01-26", "Republic Day", "ALL"],
  ["2027-05-01", "May Day", "ALL"],
  ["2027-08-15", "Independence Day", "ALL"],
  ["2027-10-02", "Gandhi Jayanti", "ALL"],
  ["2027-11-01", "Karnataka Rajyotsava", "Bengaluru"],
  ["2027-12-25", "Christmas", "ALL"],
] as const;

function seed() {
  const db = getDb();
  const reset = process.argv.includes("--reset");

  const count = (db.prepare("SELECT COUNT(*) AS n FROM employees").get() as { n: number }).n;
  if (count > 0 && !reset) {
    console.log(`Database already seeded (${count} employees). Use "npm run db:reset" to reseed.`);
    return;
  }

  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  db.transaction(() => {
    if (reset) {
      // Child tables first because of foreign keys.
      for (const table of ["leave_requests", "leave_allocations", "holidays", "leave_types", "employees"]) {
        db.exec(`DELETE FROM ${table}`);
      }
    }

    const insertEmployee = db.prepare(
      `INSERT INTO employees (id, name, email, password_hash, role, grade, department, location, joining_date, manager_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [id, name, email, role, grade, dept, loc, joined, mgr] of employees) {
      insertEmployee.run(id, name, email, passwordHash, role, grade, dept, loc, joined, mgr);
    }

    const insertType = db.prepare(
      `INSERT INTO leave_types (code, name, annual_quota, min_tenure_months, max_carry_forward, encashable)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const row of leaveTypes) insertType.run(...row);

    const insertAllocation = db.prepare(
      `INSERT INTO leave_allocations (employee_id, leave_type, year, allocated, carried_forward) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const row of allocations) insertAllocation.run(...row);

    const insertRequest = db.prepare(
      `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, days, reason, status, applied_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of leaveRequests) insertRequest.run(...row);

    const insertHoliday = db.prepare(`INSERT INTO holidays (date, name, location) VALUES (?, ?, ?)`);
    for (const row of holidays) insertHoliday.run(...row);
  })();

  console.log("Seeded synthetic data:");
  for (const table of ["employees", "leave_types", "leave_allocations", "leave_requests", "holidays"]) {
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    console.log(`  ${table.padEnd(18)} ${n}`);
  }
  console.log(`\nDemo logins (password for all: ${DEMO_PASSWORD}):`);
  for (const [id, name, email, role] of employees) console.log(`  ${id}  ${email.padEnd(26)} ${name} (${role})`);
}

seed();
