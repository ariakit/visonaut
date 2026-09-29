import { expect, it, vi } from "vitest";
import { logOperationFailure } from "./failure.ts";

it("logs only operation context and elapsed time", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    logOperationFailure({
      operation: "reconciliation",
      code: "unavailable",
      correlationId: "request-1",
      startedAt: Date.now() - 10,
      runId: "run-1",
    });
    const row = JSON.parse(String(output.mock.calls[0]?.[0]));
    expect(Object.keys(row).sort()).toEqual(
      ["code", "correlationId", "elapsedMilliseconds", "event", "operation", "runId"].sort(),
    );
    expect(row.elapsedMilliseconds).toBeGreaterThanOrEqual(10);
  } finally {
    output.mockRestore();
  }
});
