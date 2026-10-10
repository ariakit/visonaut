import { readdirSync, readFileSync } from "node:fs";
import { ImageValidationError } from "@visonaut/compare";
import { ProtocolError } from "@visonaut/protocol";
import { GitHubUnavailableError, SecurityError } from "@visonaut/security";
import {
  ArchivedCommandResultError,
  ConcurrentWriteError,
  ConflictError,
  IncompleteError,
} from "@visonaut/service";
import { expect, it, vi } from "vitest";
import {
  type CountedCause,
  errorCause,
  errorCodes,
  errorNames,
  logOperationFailure,
  noteCause,
  withCause,
} from "./failure.ts";

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

it("adds the cause of a caught error to the failure line, and keeps its own code", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    logOperationFailure({
      operation: "webhooks",
      code: "reconciliation-failed",
      correlationId: "request-1",
      startedAt: Date.now(),
      cause: errorCause(new GitHubUnavailableError(502)),
    });
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual({
      event: "operation-failed",
      operation: "webhooks",
      code: "reconciliation-failed",
      correlationId: "request-1",
      elapsedMilliseconds: expect.any(Number),
      cause: { errorName: "SecurityError", code: "github_unavailable", upstreamStatus: 502 },
    });
  } finally {
    output.mockRestore();
  }
});

it("gives the class, the code, and the GitHub status of an error", () => {
  expect(errorCause(new GitHubUnavailableError(502))).toEqual({
    errorName: "SecurityError",
    code: "github_unavailable",
    upstreamStatus: 502,
  });
  // A request to GitHub that got no answer has the code and no status.
  expect(errorCause(new GitHubUnavailableError())).toEqual({
    errorName: "SecurityError",
    code: "github_unavailable",
  });
  expect(errorCause(new SecurityError("check_pending", 503, "private-message"))).toEqual({
    errorName: "SecurityError",
    code: "check_pending",
  });
});

it("gives each listed error class its own name, and no code of another class", () => {
  // Each class with the field `code` shows that only a SecurityError gives one.
  const errors = [
    new ConflictError("private-message"),
    new ConcurrentWriteError("private-message"),
    new IncompleteError("private-message"),
    new ArchivedCommandResultError("private-run", "private-command"),
    new ImageValidationError("private-code", "private-message"),
    new ProtocolError("private-code", "private-message"),
    new Error("private-message"),
    new TypeError("private-message"),
    new RangeError("private-message"),
    new SyntaxError("private-message"),
  ];
  expect(errors.map(errorCause)).toEqual([
    { errorName: "ConflictError" },
    { errorName: "ConflictError" },
    { errorName: "IncompleteError" },
    { errorName: "ArchivedCommandResultError" },
    { errorName: "ImageValidationError" },
    { errorName: "ProtocolError" },
    { errorName: "Error" },
    { errorName: "TypeError" },
    { errorName: "RangeError" },
    { errorName: "SyntaxError" },
  ]);
  expect(errorNames).toEqual([
    "SecurityError",
    "ConflictError",
    "IncompleteError",
    "ArchivedCommandResultError",
    "ImageValidationError",
    "ProtocolError",
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
  ]);
});

it("makes each value that is not on a list 'other' or absent", () => {
  class PrivateNameError extends Error {
    constructor() {
      super("private-message");
      this.name = "private-name";
    }
  }
  const unlistedCode = new SecurityError("private-code", 503, "private-message");
  unlistedCode.name = "private-name";
  const causes = [
    errorCause(new PrivateNameError()),
    errorCause(new EvalError("private-message")),
    errorCause(unlistedCode),
    // A thrown value that is not an error has no name to read.
    errorCause("private-message"),
    errorCause({ name: "SecurityError", code: "github_unavailable", upstreamStatus: 502 }),
    errorCause(null),
    errorCause(undefined),
  ];
  expect(causes).toEqual([
    { errorName: "other" },
    { errorName: "other" },
    { errorName: "other", code: "other" },
    { errorName: "other" },
    { errorName: "other" },
    { errorName: "other" },
    { errorName: "other" },
  ]);
  expect(JSON.stringify(causes)).not.toContain("private");
});

it("keeps a GitHub status only when it is a whole number from 100 to 599", () => {
  const statuses = [100, 599, 99, 600, 502.5, Number.NaN, Number.POSITIVE_INFINITY, -502];
  expect(
    statuses.map((status) => errorCause(new GitHubUnavailableError(status)).upstreamStatus),
  ).toEqual([100, 599, undefined, undefined, undefined, undefined, undefined, undefined]);
  // The class says that the status is a number. A value of another type from
  // a caller with no type check gives no status.
  const text = new GitHubUnavailableError();
  Object.assign(text, { upstreamStatus: "private-status" });
  expect(errorCause(text)).toEqual({ errorName: "SecurityError", code: "github_unavailable" });
});

it("counts the errors of a report that have the same cause", async () => {
  const report: { causes?: CountedCause[] } = {};
  noteCause(report, new GitHubUnavailableError(502));
  noteCause(report, new GitHubUnavailableError(502));
  noteCause(report, new GitHubUnavailableError(503));
  noteCause(report, new GitHubUnavailableError());
  noteCause(report, new ConflictError("private-message"));
  // The error of the callback goes to the caller unchanged.
  const failure = new ConflictError("private-message");
  await expect(
    withCause(report, async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  await expect(withCause(report, async () => "result")).resolves.toBe("result");
  expect(report.causes).toEqual([
    { errorName: "SecurityError", code: "github_unavailable", upstreamStatus: 502, count: 2 },
    { errorName: "SecurityError", code: "github_unavailable", upstreamStatus: 503, count: 1 },
    { errorName: "SecurityError", code: "github_unavailable", count: 1 },
    { errorName: "ConflictError", count: 2 },
  ]);
});

/** The text of each source file of the server that is not a test. */
function serverSources() {
  const sources: string[] = [];
  const read = (directory: URL) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        read(new URL(`${entry.name}/`, directory));
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      sources.push(readFileSync(new URL(entry.name, directory), "utf8"));
    }
  };
  for (const root of ["apps/web/src/", "packages/security/src/", "packages/service/src/"]) {
    read(new URL(`../../../../${root}`, import.meta.url));
  }
  return sources;
}

it("lists each code that the server source gives to a SecurityError", () => {
  // The code is the first argument of the constructor, as a text literal.
  const literalCode = /new SecurityError\(\s*"([^"]+)"/g;
  const codes = new Set(
    serverSources().flatMap((source) =>
      [...source.matchAll(literalCode)].map((match) => String(match[1])),
    ),
  );
  // These three codes are not the argument of a `new SecurityError(...)`:
  // the code of `GitHubUnavailableError`, and the two keys of `refusals` in
  // `capacity.ts`.
  for (const code of ["github_unavailable", "database_size_exceeded", "capacity_exceeded"]) {
    codes.add(code);
  }
  expect([...errorCodes]).toEqual([...codes].sort());
});
