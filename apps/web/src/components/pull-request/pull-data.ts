import type { PullAnswer } from "../../api/pulls.ts";
import { ClientError } from "../../client-error.ts";

/**
 * The answer of `GET /api/pulls/:number` as the page reads it. The fields that
 * an older Worker does not send are optional, and a missing one leaves no hole.
 */
export interface PullRead extends Pick<PullAnswer, "repository" | "runId" | "state"> {
  title?: string;
  /** The head commit of the pull request that the check belongs to. */
  headSha?: string;
  attempt?: number;
  /** The page of the attempt on GitHub. */
  workflowUrl?: string;
}

// The sentence of the page for an answer that it cannot read.
const unknownAnswer = "The service did not return the expected pull request.";

const states: readonly PullRead["state"][] = [
  "pending",
  "ready",
  "failed",
  "not-required",
  "replaced",
];
const shaForm = /^[0-9a-f]{7,64}$/u;

function isState(value: unknown): value is PullRead["state"] {
  return states.some((state) => state === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The GitHub address of a pull request, for the links that leave the app. */
export function getPullUrl(repository: string, pullNumber: string) {
  return `https://github.com/${repository}/pull/${encodeURIComponent(pullNumber)}`;
}

/** The workflow list of the repository, where a failed capture is run again. */
export function getWorkflowsUrl(repository: string) {
  return `https://github.com/${repository}/actions`;
}

/** Reads the JSON of a successful answer. A form that it does not know is a failure. */
export function readPullAnswer(value: unknown): PullRead {
  if (!isRecord(value)) throw new ClientError(unknownAnswer);
  const { repository, runId, state, title, headSha, attempt, workflowUrl } = value;
  if (typeof repository !== "string") throw new ClientError(unknownAnswer);
  if (runId !== null && typeof runId !== "string") throw new ClientError(unknownAnswer);
  if (!isState(state)) throw new ClientError(unknownAnswer);
  const pull: PullRead = { repository, runId, state };
  if (typeof title === "string" && title) {
    pull.title = title;
  }
  if (typeof headSha === "string" && shaForm.test(headSha)) {
    pull.headSha = headSha;
  }
  if (typeof attempt === "number" && Number.isSafeInteger(attempt) && attempt > 0) {
    pull.attempt = attempt;
  }
  // The link leaves the app, so it keeps only an address on GitHub.
  if (typeof workflowUrl === "string" && workflowUrl.startsWith("https://github.com/")) {
    pull.workflowUrl = workflowUrl;
  }
  return pull;
}
