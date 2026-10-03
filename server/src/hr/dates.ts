// Date helpers. All dates are ISO "YYYY-MM-DD" strings handled in UTC,
// so time zones and DST can't shift a day.
import { config } from "../config";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function toDate(iso: string): Date {
  const d = new Date(`${iso}T00:00:00Z`);
  if (!ISO_DATE.test(iso) || Number.isNaN(d.getTime()) || toIso(d) !== iso) {
    throw new Error(`Invalid date "${iso}". Expected YYYY-MM-DD.`);
  }
  return d;
}

export const toIso = (d: Date): string => d.toISOString().slice(0, 10);

export function addMonths(iso: string, months: number): string {
  const d = toDate(iso);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay)); // e.g. 31 Aug + 6 months -> 28/29 Feb
  return toIso(target);
}

export function weekdayName(iso: string): string {
  return toDate(iso).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

// "Today" can be pinned with APP_TODAY so demos give the same answers every run.
export function today(): string {
  return config.appToday ?? new Date().toLocaleDateString("en-CA"); // en-CA formats as YYYY-MM-DD
}
