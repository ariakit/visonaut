import { accountId, targets } from "./operations.ts";
import type { executeCutover } from "./operations.ts";
import type { CutoverOptions } from "./runner.ts";

export async function readBoundedJson(
  message: { body: ReadableStream<Uint8Array> | null },
  maximumBytes: number,
): Promise<unknown> {
  if (!message.body) throw new Error("Missing cutover body.");
  const reader = message.body.getReader();
  const bytes = new Uint8Array(maximumBytes);
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (length + chunk.value.byteLength > maximumBytes) {
        throw new Error("Cutover body exceeds its bound.");
      }
      bytes.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder().decode(bytes.subarray(0, length)));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function count(value: unknown) {
  return value === null || (Number.isSafeInteger(value) && typeof value === "number" && value >= 0);
}

export function isCutoverReport(
  value: unknown,
  options: CutoverOptions,
): value is Awaited<ReturnType<typeof executeCutover>> {
  if (!record(value) || !record(value.target) || !record(value.readback)) return false;
  const target = targets[options.environment];
  const readback = value.readback;
  return (
    Object.keys(value).length === 8 &&
    value.action === options.action &&
    value.mode === "remote" &&
    value.environment === options.environment &&
    value.target.accountId === accountId &&
    value.target.databaseName === target.databaseName &&
    value.target.databaseId === target.databaseId &&
    value.target.imagesBucket === target.imagesBucket &&
    Object.keys(value.target).length === 4 &&
    value.persistence === "remote application data; no local persistence" &&
    typeof value.stop === "string" &&
    ["ready", "not-ready", "attention", "no-progress", "turn-limit"].includes(value.stop) &&
    Array.isArray(value.turns) &&
    value.turns.length <= options.maxTurns &&
    (options.action !== "inspect" || value.turns.length === 0) &&
    value.turns.every(
      (turn) =>
        record(turn) &&
        Object.keys(turn).length === 2 &&
        typeof turn.family === "string" &&
        ["baseline-conversion", "history"].includes(turn.family) &&
        record(turn.report) &&
        Object.keys(turn.report).length === 4 &&
        strings(turn.report.completed) &&
        strings(turn.report.deferred) &&
        strings(turn.report.attention) &&
        typeof turn.report.hasMore === "boolean",
    ) &&
    Object.keys(readback).length === 8 &&
    typeof readback.schemaReady === "boolean" &&
    typeof readback.gatesReady === "boolean" &&
    (!readback.gatesReady ||
      (readback.schemaReady &&
        readback.requiredProtectedSnapshots === 0 &&
        readback.unconvertedClosedRecords === 0 &&
        Array.isArray(readback.unresolvedEvents) &&
        readback.unresolvedEvents.length === 0 &&
        Array.isArray(readback.foreignKeyViolations) &&
        readback.foreignKeyViolations.length === 0)) &&
    strings(readback.missingSchema) &&
    (readback.appliedMigrations === null || strings(readback.appliedMigrations)) &&
    count(readback.requiredProtectedSnapshots) &&
    count(readback.unconvertedClosedRecords) &&
    (readback.foreignKeyViolations === null ||
      (Array.isArray(readback.foreignKeyViolations) &&
        readback.foreignKeyViolations.every(
          (violation) =>
            record(violation) &&
            Object.keys(violation).length === 4 &&
            typeof violation.table === "string" &&
            (violation.rowid === null || Number.isSafeInteger(violation.rowid)) &&
            typeof violation.parent === "string" &&
            Number.isSafeInteger(violation.fkid) &&
            typeof violation.fkid === "number" &&
            violation.fkid >= 0,
        ))) &&
    (readback.unresolvedEvents === null ||
      (Array.isArray(readback.unresolvedEvents) &&
        readback.unresolvedEvents.every(
          (event) =>
            record(event) &&
            Object.keys(event).length === 3 &&
            typeof event.kind === "string" &&
            typeof event.subject_id === "string" &&
            typeof event.code === "string",
        )))
  );
}
