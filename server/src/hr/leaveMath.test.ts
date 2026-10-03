import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countWorkingDays,
  eligibleFrom,
  encashableDays,
  lossOfPayDays,
  proRataEntitlement,
  tenureMonths,
} from "./leaveMath";

const holidays = [
  { date: "2026-12-25", name: "Christmas" },
  { date: "2027-01-01", name: "New Year's Day" },
];

test("working days skip weekends and holidays (Dec 22 - Jan 2)", () => {
  const r = countWorkingDays("2026-12-22", "2027-01-02", holidays);
  assert.equal(r.calendarDays, 12);
  assert.equal(r.weekendDays, 3); // Dec 26, 27, Jan 2
  assert.deepEqual(r.holidays.map((h) => h.date), ["2026-12-25", "2027-01-01"]);
  assert.equal(r.workingDays, 7);
});

test("working days: single weekday and reversed range", () => {
  assert.equal(countWorkingDays("2026-10-05", "2026-10-05", []).workingDays, 1);
  assert.throws(() => countWorkingDays("2026-10-09", "2026-10-05", []), /before/);
  assert.throws(() => countWorkingDays("2026-02-30", "2026-03-02", []), /Invalid date/);
});

test("tenure counts whole months", () => {
  assert.equal(tenureMonths("2026-07-01", "2026-10-03"), 3);
  assert.equal(tenureMonths("2021-06-14", "2026-06-13"), 59);
  assert.equal(tenureMonths("2021-06-14", "2026-06-14"), 60);
});

test("eligible-from date clamps to month end", () => {
  assert.equal(eligibleFrom("2026-07-01", 6), "2027-01-01");
  assert.equal(eligibleFrom("2026-08-31", 6), "2027-02-28");
});

test("pro-rata entitlement for joiners", () => {
  assert.equal(proRataEntitlement(12, "2026-07-01", 2026), 6);
  assert.equal(proRataEntitlement(12, "2026-07-20", 2026), 5); // joined after the 15th
  assert.equal(proRataEntitlement(18, "2021-06-14", 2026), 18);
  assert.equal(proRataEntitlement(18, "2027-01-10", 2026), 0);
});

test("encashment and loss of pay", () => {
  assert.equal(encashableDays(21, true), 15);
  assert.equal(encashableDays(8, true), 8);
  assert.equal(encashableDays(10, false), 0);
  assert.equal(lossOfPayDays(7, 5), 2);
  assert.equal(lossOfPayDays(3, 10), 0);
  assert.equal(lossOfPayDays(2, -1), 2);
});
