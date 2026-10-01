import { expect, it, vi } from "vitest";
import { accountId, targets } from "./operations.ts";
import { parseOptions, type CutoverOptions } from "./runner.ts";
import { isCutoverReport, readBoundedJson } from "./report.ts";

const options: CutoverOptions = { ...parseOptions([]), remote: true };

function readyReport() {
  return {
    action: "inspect",
    mode: "remote",
    environment: "preview",
    target: { accountId, ...targets.preview },
    persistence: "remote application data; no local persistence",
    stop: "ready",
    turns: [],
    readback: {
      schemaReady: true,
      appliedMigrations: ["0024_core_simplification.sql"],
      missingSchema: [],
      requiredProtectedSnapshots: 0,
      unconvertedClosedRecords: 0,
      unresolvedEvents: [],
      foreignKeyViolations: [],
      gatesReady: true,
    },
  };
}

it("reads bounded JSON by UTF-8 bytes across split characters", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify("é"));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 2));
      controller.enqueue(bytes.subarray(2));
      controller.close();
    },
  });
  await expect(readBoundedJson({ body }, 4)).resolves.toBe("é");
  expect(body.locked).toBe(false);
  await expect(readBoundedJson(new Response(JSON.stringify("é")), 3)).rejects.toThrow("bound");
  await expect(readBoundedJson({ body: null }, 4)).rejects.toThrow("Missing");
  await expect(readBoundedJson(new Response("{"), 4)).rejects.toBeInstanceOf(SyntaxError);
});

it("cancels an oversized open body and releases its reader", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{} "));
    },
    cancel,
  });
  await expect(readBoundedJson({ body }, 2)).rejects.toThrow("bound");
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});

it("accepts the selected report after bounded JSON transport", async () => {
  const report = readyReport();
  const encoded = JSON.stringify(report);
  const decoded = await readBoundedJson(new Response(encoded), Buffer.byteLength(encoded));
  expect(isCutoverReport(decoded, options)).toBe(true);
  expect(decoded).toEqual(report);
});

it("rejects another selected command, target or unexpected private report details", () => {
  const report = readyReport();
  expect(isCutoverReport({ ...report, action: "convert" }, options)).toBe(false);
  expect(
    isCutoverReport({ ...report, target: { accountId, ...targets.production } }, options),
  ).toBe(false);
  expect(isCutoverReport({ ...report, debug: "untrusted-runtime-detail" }, options)).toBe(false);
  const foreignKeyLeak = {
    ...report,
    stop: "attention",
    readback: {
      ...report.readback,
      gatesReady: false,
      foreignKeyViolations: [
        { table: "visonaut_runs", rowid: 1, parent: "visonaut_projects", fkid: 0, debug: "detail" },
      ],
    },
  };
  expect(isCutoverReport(foreignKeyLeak, options)).toBe(false);
});

it("rejects ready gates with missing schema or an outstanding protected baseline", () => {
  const report = readyReport();
  const missingSchema = { ...report, readback: { ...report.readback, schemaReady: false } };
  const protectedBaseline = {
    ...report,
    readback: { ...report.readback, requiredProtectedSnapshots: 1 },
  };
  expect(isCutoverReport(missingSchema, options)).toBe(false);
  expect(isCutoverReport(protectedBaseline, options)).toBe(false);
});

it("requires string turn families and enforces the selected turn limit", () => {
  const selected: CutoverOptions = { ...options, action: "convert" };
  const turn = {
    family: "history",
    report: { completed: ["closed"], deferred: [], attention: [], hasMore: false },
  };
  const report = { ...readyReport(), action: "convert", turns: [turn] };
  expect(isCutoverReport(report, selected)).toBe(true);
  expect(isCutoverReport({ ...report, stop: ["ready"] }, selected)).toBe(false);
  expect(isCutoverReport({ ...report, turns: [turn, turn] }, selected)).toBe(false);
  expect(isCutoverReport({ ...report, turns: [{ ...turn, family: ["history"] }] }, selected)).toBe(
    false,
  );
});
