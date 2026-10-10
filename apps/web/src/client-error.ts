// The one error of a failed request in the browser. A page shows its message
// and keeps its facts. This file writes the message for each cause. It does
// not use the message of the server.

// A server answer is untrusted. Keep and show only values with these exact
// forms, the same as the CLI.
const ERROR_CODE = /^[a-z_]{1,64}$/u;
const ERROR_REFERENCE = /^[0-9a-f-]{36}$/u;
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/u;

/** What a page keeps of a failed request. */
export interface ClientErrorFacts {
  /** The HTTP status. It is missing when the fetch failed before any answer. */
  status?: number;
  /** The `error.code` of the answer, only in its safe form. */
  code?: string;
  /** The `error.reference` of the answer, only in its safe form. */
  reference?: string;
}

export class ClientError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly reference?: string;

  constructor(message: string, facts: ClientErrorFacts = {}, options?: ErrorOptions) {
    super(message, options);
    this.name = "ClientError";
    this.status = facts.status;
    this.code = facts.code;
    this.reference = facts.reference;
  }
}

/** The facts that decide the sentence of a failure. */
interface FailureFacts extends ClientErrorFacts {
  /** True when the answer is JSON. A 5xx answer that is not JSON is not from the service. */
  json?: boolean;
  /** The time in milliseconds since the epoch that `Retry-After` names. */
  retryAt?: number;
}

function retryText(time: number) {
  const date = new Date(time);
  const today = date.toDateString() === new Date().toDateString();
  return date.toLocaleString(
    undefined,
    today ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" },
  );
}

function causeSentence({ status, code, json, retryAt }: FailureFacts) {
  if (status == null) return "No connection.";
  if (status < 400) return "The service did not return the expected data. Refresh and try again.";
  if (status === 401) return "Sign in with GitHub.";
  if (status === 403) {
    if (code === "not_maintainer") return "Write access to this repository is required.";
    return "The service refused this request.";
  }
  if (status === 404) return "The service could not find this run or decision.";
  if (status === 409) {
    if (code === "review_session_expired") {
      return "Your review session ended. Retry to start a new one.";
    }
    if (code === "reviewer_changed") {
      return "Another account is signed in. Sign in with the account of this page, and then retry.";
    }
    if (code === "decision_failed") {
      return "This decision failed too many times and cannot run again. Check the current state and decide again.";
    }
    if (code === "concurrent_change") {
      return "Another change was saved at the same time. Check the current state and decide again.";
    }
    return "The request conflicts with the current state. Refresh to see it.";
  }
  if (status === 400 && code === "too_many_targets") {
    return "This decision has too many variants for one command. Decide for the variants one at a time.";
  }
  if (status < 500) return "The service refused this request.";
  if (json) return "The service is temporarily unavailable.";
  const retry = retryAt == null ? "Try again later." : `Try again at ${retryText(retryAt)}.`;
  return `Visonaut is not available. ${retry}`;
}

// One sentence for each cause of a failed request, then its reference.
function failureSentence(facts: FailureFacts) {
  const sentence = causeSentence(facts);
  return facts.reference ? `${sentence} Reference: ${facts.reference}.` : sentence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, form: RegExp) {
  return typeof value === "string" && form.test(value) ? value : undefined;
}

/** Reads a `Retry-After` header: a number of seconds, or an HTTP date. */
function retryTime(header: string | null) {
  if (header == null) return;
  const now = Date.now();
  let time: number;
  // Up to 9 digits of seconds (about 31 years). A longer number is not a
  // plausible retry time.
  if (/^\d{1,9}$/u.test(header)) {
    time = now + Number(header) * 1000;
  } else if (HTTP_DATE.test(header)) {
    time = Date.parse(header);
  } else {
    return;
  }
  // A time that is not in the future, or not a number, says nothing.
  return time > now ? time : undefined;
}

function isAbort(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function isJsonResponse(response: Response) {
  return response.headers.get("content-type")?.includes("application/json") ?? false;
}

/**
 * Calls `fetch`. A fetch that fails before any answer, for example with no
 * network, is the only cause of the sentence "No connection."
 */
export async function fetchOrFail(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof TypeError) {
      // Keep the cause. A TypeError of a bad URL or a bad init is not a network failure.
      throw new ClientError(failureSentence({}), {}, { cause: error });
    }
    throw error;
  }
}

export interface Failure extends ClientErrorFacts {
  /** The sentence for the cause, then the reference when the answer has one. */
  message: string;
  /** The sentence for the cause alone, for a page that shows the reference apart. */
  sentence: string;
  /** The JSON of the answer, or undefined when it has none. */
  body: unknown;
}

/**
 * Reads a response with a failure status. The status and the headers decide
 * the cause. The body only adds a code and a reference, and a body that
 * cannot be read changes nothing else.
 */
export async function readFailure(response: Response): Promise<Failure> {
  const json = isJsonResponse(response);
  const body: unknown = json
    ? await response.json().catch((error: unknown) => {
        // A cancelled read is not a failure of the request.
        if (isAbort(error)) {
          throw error;
        }
      })
    : undefined;
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  const facts = {
    status: response.status,
    code: safeText(error.code, ERROR_CODE),
    reference: safeText(error.reference, ERROR_REFERENCE),
  };
  const failure = { ...facts, json, retryAt: retryTime(response.headers.get("retry-after")) };
  return { ...facts, message: failureSentence(failure), sentence: causeSentence(failure), body };
}

/** Reads the JSON of a response that succeeded. Any other answer is a failure. */
export async function readSuccess(response: Response): Promise<unknown> {
  try {
    if (isJsonResponse(response)) {
      return await response.json();
    }
  } catch (error) {
    // A body that cannot be read is the same cause as an answer that is not JSON.
    if (isAbort(error)) {
      throw error;
    }
  }
  const facts = { status: response.status };
  throw new ClientError(failureSentence(facts), facts);
}
