// All data in this database is SYNTHETIC. No real employees or HR records.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees (
  id            TEXT PRIMARY KEY,          -- e.g. 'E1001'
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,             -- bcrypt
  role          TEXT NOT NULL CHECK (role IN ('employee', 'manager')),
  grade         TEXT NOT NULL,             -- e.g. 'G5'
  department    TEXT NOT NULL,
  location      TEXT NOT NULL,             -- drives the holiday calendar
  joining_date  TEXT NOT NULL,             -- ISO date
  manager_id    TEXT REFERENCES employees(id)
);

-- Leave rules that code (not the LLM) uses for eligibility and calculations.
-- The policy documents describe the same rules in prose.
CREATE TABLE IF NOT EXISTS leave_types (
  code                TEXT PRIMARY KEY,    -- 'CL', 'SL', 'EL'
  name                TEXT NOT NULL,
  annual_quota        REAL NOT NULL,       -- days per calendar year
  min_tenure_months   INTEGER NOT NULL DEFAULT 0,
  max_carry_forward   REAL NOT NULL DEFAULT 0,
  encashable          INTEGER NOT NULL DEFAULT 0  -- boolean
);

-- Days granted per employee/type/year. "used" and "pending" are derived
-- from leave_requests so the numbers can never drift apart.
CREATE TABLE IF NOT EXISTS leave_allocations (
  employee_id      TEXT NOT NULL REFERENCES employees(id),
  leave_type       TEXT NOT NULL REFERENCES leave_types(code),
  year             INTEGER NOT NULL,
  allocated        REAL NOT NULL,          -- this year's (pro-rated) quota
  carried_forward  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (employee_id, leave_type, year)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  TEXT NOT NULL REFERENCES employees(id),
  leave_type   TEXT NOT NULL REFERENCES leave_types(code),
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  days         REAL NOT NULL,              -- working days, computed in code
  reason       TEXT,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  applied_on   TEXT NOT NULL DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS holidays (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  date      TEXT NOT NULL,
  name      TEXT NOT NULL,
  location  TEXT NOT NULL,                 -- 'ALL' or a specific location
  UNIQUE (date, location)
);

CREATE INDEX IF NOT EXISTS idx_requests_employee ON leave_requests(employee_id, start_date);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
`;
