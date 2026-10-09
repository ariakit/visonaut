import type { OperationsMessage } from "@visonaut/service";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { measureD1 } from "../api/test-d1-costs.ts";
import { runOperations } from "./index.ts";
import { captured, context, TestDatabase } from "./test-fixtures.ts";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('pass tests'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB"],
  }),
);
const native = await runtime.getD1Database("DB");
const measured = measureD1(native);

beforeAll(async () => applyTestMigrations(native));
afterAll(async () => runtime.dispose());

// A pass repeats with each cron tick and each queue message. The step wrapper
// runs one statement for each step that completes, and that statement must
// change no row while the step has no open alert.
it("writes no row in a pass of each kind that has no work", async () => {
  using sqlite = new TestDatabase();
  const pass = { ...context(sqlite).context, database: measured.database };
  await captured(pass);
  // The first pass delivers the check of the run and writes each cursor row.
  await runOperations(pass);
  const messages: OperationsMessage[] = [
    { kind: "recovery" },
    { kind: "ingest" },
    { kind: "status" },
    { kind: "maintenance", family: "history" },
    { kind: "maintenance", family: "retention" },
    { kind: "maintenance", family: "profiles" },
  ];
  for (const message of messages) {
    measured.reset();
    const { reports, hasMore } = await runOperations(pass, message);
    expect(hasMore).toBe(false);
    expect(Object.values(reports).flatMap((report) => report.attention)).toEqual([]);
    expect(measured.costs.length).toBeGreaterThan(0);
    expect(measured.costs.filter((cost) => cost.rows_written > 0)).toEqual([]);
  }
});
