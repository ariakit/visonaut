// The `today` data mode: what remains of a record when it has only the fields
// that production sends today. The builders make the `improved` records, and
// these functions remove the rest. Each result is cached for its source, so
// the same run is the same object on every page.

import type { Baseline, PullRequest, Run, ServiceAlert, User } from "../types.ts";

const users = new WeakMap<User, User>();

/** The session knows the account identifier and the login. */
export function toTodayUser(user: User): User {
  let result = users.get(user);
  if (!result) {
    const { id, githubUserId, login } = user;
    result = { id, githubUserId, login };
    users.set(user, result);
  }
  return result;
}

const runs = new WeakMap<Run, Run>();

/** The row of `GET /api/runs`. It has no title after the webhook is processed. */
export function toTodayRun(run: Run): Run {
  let result = runs.get(run);
  if (!result) {
    const { id, kind, testedSha, state, attempt, createdAt, comparisonId, pullRequestNumber } = run;
    result = {
      id,
      kind,
      testedSha,
      state,
      attempt,
      createdAt,
      comparisonId,
      ...(pullRequestNumber == null ? {} : { pullRequestNumber }),
      pending: run.pending,
      rejected: run.rejected,
    };
    runs.set(run, result);
  }
  return result;
}

const runLists = new WeakMap<Run[], Run[]>();

export function toTodayRuns(list: Run[]): Run[] {
  let result = runLists.get(list);
  if (!result) {
    result = list.map(toTodayRun);
    runLists.set(list, result);
  }
  return result;
}

/** The project part of `GET /api/runs`. */
export function toTodayBaseline({ revision, snapshotId, promotionId }: Baseline): Baseline {
  return { revision, snapshotId, promotionId };
}

/** The answer of `GET /api/pulls/:number`. */
export function toTodayPull({ number, repository, capture, runId }: PullRequest): PullRequest {
  return { number, repository, capture, runId };
}

/**
 * The event of `GET /api/operations` with the title and the action that the
 * client derives from its kind and code.
 */
export function toTodayAlert(alert: ServiceAlert): ServiceAlert {
  const { kind, code, subject, firstSeenAt, lastSeenAt, title, action } = alert;
  return { kind, code, subject, firstSeenAt, lastSeenAt, title, action };
}
