import { SecurityError } from "@visonaut/security";
import { ConflictError, type OperationsMessage } from "@visonaut/service";
import { expect, vi } from "vitest";
import { runOperations } from "./index.ts";
import type { OperationsContext } from "./types.ts";

/** An error whose name, code, and message are not on a list of the log. */
export class HostileError extends SecurityError {
  constructor() {
    super("private-code", 503, "private-message");
    this.name = "private-name";
  }
}

/** The same for a place that catches only a conflict. */
export class HostileConflict extends ConflictError {
  constructor() {
    super("private-message");
    this.name = "private-name";
  }
}

export const hostileCause = { errorName: "other", code: "other" };
export const hostileConflictCause = { errorName: "other" };

/**
 * Run a callback at the start of one step of a pass. The module is the
 * namespace of the file that exports the step. A fault of the database that
 * is set before the pass would fail an earlier step.
 */
export function atStepStart<Module extends object>(
  module: Module,
  step: keyof Module & string,
  arm: () => void,
) {
  const run = module[step];
  if (typeof run !== "function") {
    throw new Error("The step is not a function.");
  }
  // The assertion gives the spy the type of a function of any module.
  const spy = vi.spyOn(module as Record<string, (...values: unknown[]) => unknown>, step);
  spy.mockImplementation((...values) => {
    arm();
    return run(...values);
  });
}

interface PassStepParams {
  context: OperationsContext;
  message: OperationsMessage;
  step: string;
}

/**
 * Run one pass. Return each log line of the pass and the entry of one step on
 * the line `operations_pass`. Assert that no line has a value of a hostile
 * error.
 */
export async function passStep({ context, message, step }: PassStepParams) {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await runOperations(context, message);
    const texts = [...info.mock.calls, ...error.mock.calls].map(([line]) => String(line));
    expect(texts.join("\n")).not.toContain("private");
    const lines = texts.map((text) => JSON.parse(text));
    const passes = lines.filter((line) => line.event === "operations_pass");
    expect(passes).toHaveLength(1);
    return { lines, entry: passes[0].steps[step] };
  } finally {
    info.mockRestore();
    error.mockRestore();
  }
}

interface StepCounts {
  completed: number;
  deferred: number;
  attention: number;
}

/** The complete entry of a step with one caught error. */
export function stepWithCause(counts: StepCounts, cause: object) {
  return { elapsedMs: expect.any(Number), ...counts, causes: [{ ...cause, count: 1 }] };
}
