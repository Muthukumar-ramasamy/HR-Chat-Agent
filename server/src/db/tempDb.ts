// For tests: point the app at a fresh, seeded SQLite file so tests never depend on
// (or change) the demo database. Call before anything reads config/DB; returns cleanup.
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function useTempDb(name: string): Promise<() => void> {
  const path = join(tmpdir(), `hr-${name}-test-${process.pid}.db`);
  process.env.DB_PATH = path;
  const { seed } = await import("./seed");
  const { getDb } = await import("./index");
  seed({ quiet: true });
  return () => {
    getDb().close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
  };
}
