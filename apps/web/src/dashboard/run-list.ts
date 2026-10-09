import type { DashboardRun, RunsAnswer } from "../api/dashboard.ts";
import { ClientError, fetchOrFail, readFailure, readSuccess } from "../client-error.ts";

/** The run list of a page, with the facts that the header shows. */
export interface RunList {
  runs: DashboardRun[];
  actionable: DashboardRun[];
  repository: string;
  baselineRevision: number;
  preview: boolean;
  login?: string;
  alertCount?: number;
}

/**
 * What one read of the run list gives. It is plain data, so the document can
 * carry the result of the read that the server started.
 */
export type RunListResult =
  | { status: "ready"; list: RunList }
  | { status: "guest" }
  | { status: "forbidden" | "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunsAnswer(value: unknown): value is RunsAnswer {
  return (
    isRecord(value) &&
    Array.isArray(value.runs) &&
    Array.isArray(value.actionable) &&
    isRecord(value.project) &&
    typeof value.project.baselineRevision === "number" &&
    typeof value.project.repository === "string"
  );
}

function runList(value: unknown): RunList {
  if (!isRunsAnswer(value)) {
    throw new ClientError("The run list could not be read. Retry loading the page.");
  }
  return {
    runs: value.runs,
    actionable: value.actionable,
    preview: value.preview === true,
    repository: value.project.repository,
    baselineRevision: value.project.baselineRevision,
    // A preview answer and an answer of an older Worker can lack these two.
    login:
      isRecord(value.user) && typeof value.user.login === "string" ? value.user.login : undefined,
    alertCount: typeof value.alertCount === "number" ? value.alertCount : undefined,
  };
}

/**
 * Reads the answer of `GET /api/runs`. The server uses it for the answer of
 * the handler in the same process, and the browser for the fetched answer, so
 * both give the same result for the same answer. It does not throw.
 */
export async function runListResult(response: Response): Promise<RunListResult> {
  try {
    if (response.ok) {
      return { status: "ready", list: runList(await readSuccess(response)) };
    }
    const failure = await readFailure(response);
    if (failure.status === 401) return { status: "guest" };
    return { status: failure.status === 403 ? "forbidden" : "error", message: failure.message };
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
}

function errorMessage(error: unknown) {
  return error instanceof ClientError ? error.message : "The run list is temporarily unavailable.";
}

/** The read of the run list that the server gives to the document request. */
export type DocumentRunListRead = () => Promise<RunListResult>;

/** What the server puts into the context of the router for one document. */
export interface DocumentContext {
  readRunList: DocumentRunListRead;
}

// The router gives the context of the server to a loader as `serverContext`.
// It is absent in the browser.
function documentRead(loaderOptions: unknown): DocumentRunListRead | undefined {
  if (!isRecord(loaderOptions)) return;
  const { serverContext } = loaderOptions;
  if (!isRecord(serverContext)) return;
  const { readRunList } = serverContext;
  if (typeof readRunList !== "function") return;
  // The server sets this function with the type of `DocumentContext`.
  return readRunList as DocumentRunListRead;
}

/**
 * The loader of the run list. In the document request, the server gives the
 * read, and the loader returns its promise with no wait: the document sends
 * the shell first and the list after it. In the browser, the loader waits for
 * the fetch, so the router keeps the last list until the new one is there.
 */
export function loadRunList(loaderOptions: unknown, signal: AbortSignal) {
  const read = documentRead(loaderOptions);
  if (read) {
    const runList: Promise<RunListResult> | RunListResult = read();
    return { runList };
  }
  return fetchRunList(signal).then((result) => {
    const runList: Promise<RunListResult> | RunListResult = result;
    return { runList };
  });
}

/** Reads the run list in the browser. It does not throw. */
export async function fetchRunList(signal?: AbortSignal): Promise<RunListResult> {
  try {
    const response = await fetchOrFail("/api/runs", {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    return await runListResult(response);
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
}
