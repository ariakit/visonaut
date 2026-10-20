import {
  assertion,
  atomic,
  ConcurrentWriteError,
  ConflictError,
  IncompleteError,
  statement,
} from "./database.ts";
import { ArchivedCommandResultError, commandRequestDigest } from "./history.ts";
import { eligibleAcceptanceSql } from "./review-status.ts";
import { touchRunStatusStatements } from "./status-touch.ts";
import type { Database, Result, SqlValue, Statement } from "./database.ts";
import type {
  CommandResult,
  ComparisonRow,
  ProjectRow,
  ReviewParams,
  ReviewRow,
  RunRow,
} from "./types.ts";
import type { Service } from "./service.ts";
import { projectGuard } from "./run-guards.ts";
import { auditRunChange } from "./service-audit.ts";

async function readOne<T>(database: Database, sql: string, values: SqlValue[] = []) {
  const row = await statement(database, sql, values).first<T>();
  if (!row) {
    throw new IncompleteError("The requested record does not exist.");
  }
  return row;
}

/**
 * The most targets of one review command. One command is one D1 batch with 4
 * statements for each target and about 15 more, and D1 permits 1,000 queries
 * for one Worker invocation.
 */
export const maximumReviewTargets = 200;

interface PreviousDecision {
  id: string;
  decisionId: string | null;
  sourceDecisionId: string | null;
  revision: number;
}

interface CommandRow {
  id: string;
  request_json: string;
  actor_id: string;
  session_id: string;
  kind: string;
  comparison_id: string;
  previous_json: string;
  result_json: string;
  undone_by: string | null;
  request_digest?: string | null;
}

interface PreviousCommandState {
  decisions: PreviousDecision[];
}

function requestJson(input: Record<string, unknown>) {
  const { now: _now, ...request } = input;
  return JSON.stringify(request);
}

function parseCommandResult(json: string): CommandResult {
  // Command records are written only by this service, after typed validation.
  return JSON.parse(json) as CommandResult;
}

function batchRows<T>(result: Result | undefined): T[] {
  if (!result?.results) {
    throw new IncompleteError("The review query batch is incomplete.");
  }
  // The corresponding SELECT defines each result's row shape.
  return result.results as T[];
}

async function commandReplay(database: Database, commandId: string, request: string) {
  const command = await statement(database, "SELECT * FROM visonaut_commands WHERE id = ?", [
    commandId,
  ]).first<CommandRow>();
  if (!command) return null;
  const summary = await statement(
    database,
    "SELECT summary.run_id FROM visonaut_closed_summaries summary JOIN visonaut_comparisons comparison ON comparison.run_id=summary.run_id WHERE comparison.id=? AND summary.state='ready'",
    [command.comparison_id],
  ).first<{ run_id: string }>();
  if (summary) {
    const same = command.request_digest
      ? (await commandRequestDigest(request)) === command.request_digest
      : command.request_json === request;
    if (!same) throw new ConflictError("The command ID already belongs to another request.");
    throw new ArchivedCommandResultError(summary.run_id, command.id);
  }
  if (command.request_json !== request) {
    throw new ConflictError("The command ID already belongs to another request.");
  }
  return parseCommandResult(command.result_json);
}

interface GuardFailureParams {
  database: Database;
  /** The error of the write batch. */
  error: unknown;
  /** The project and the run, as the command read them. */
  project: ProjectRow;
  run: RunRow;
}

/**
 * The error of a command whose write batch failed a guard. It is a
 * `ConcurrentWriteError` when the project or the run has another revision than
 * the one that the command read: another write came between. Each decision and
 * each other write of a run or a project gives a new revision.
 */
async function guardFailure({ database, error, project, run }: GuardFailureParams) {
  if (!(error instanceof ConflictError)) return error;
  const unchanged = await statement(
    database,
    "SELECT 1 FROM visonaut_projects project JOIN visonaut_runs run ON run.project_id = project.id WHERE project.id = ? AND project.revision = ? AND run.id = ? AND run.revision = ?",
    [project.id, project.revision, run.id, run.revision],
  ).first();
  if (unchanged) return error;
  return new ConcurrentWriteError(error.message);
}

function reviewGuard(database: Database, run: RunRow, comparisonId: string) {
  return assertion(
    database,
    "EXISTS (SELECT 1 FROM visonaut_runs run JOIN visonaut_comparisons comparison ON comparison.id = run.comparison_id WHERE run.id = ? AND run.active = 1 AND run.revision = ? AND run.sealed_at IS NOT NULL AND comparison.id = ? AND comparison.state = 'ready' AND NOT EXISTS (SELECT 1 FROM visonaut_promotions promotion WHERE promotion.comparison_id = comparison.id))",
    [run.id, run.revision, comparisonId],
  );
}

function currentBaselineGuard(database: Database, projectId: string) {
  // Rollback can restore a baseline without a current promotion record.
  // Check the final transaction state, including indirect source changes.
  return assertion(
    database,
    `NOT EXISTS (SELECT 1 FROM visonaut_projects project
        JOIN visonaut_snapshots snapshot ON snapshot.id = project.snapshot_id
        JOIN visonaut_comparison_rows row ON row.comparison_id = snapshot.comparison_id
        WHERE project.id = ? AND row.outcome = 'changed'
        AND NOT ${eligibleAcceptanceSql})`,
    [projectId],
  );
}

/**
 * The changes of a run approval: each changed row of the comparison with no
 * decision in force, by the rule of the review page. A rejection in force is a
 * decision, and so is an approval of the same pixels. A rejection of the same
 * pixels in an earlier run is not. The value is the comparison ID.
 */
const runApprovalTargetsSql = `row.comparison_id = ? AND row.outcome = 'changed'
  AND NOT EXISTS (SELECT 1 FROM visonaut_decisions decision
    WHERE decision.id = COALESCE(row.source_decision_id, row.decision_id) AND decision.revoked = 0
    AND (decision.verdict = 'rejected' OR ${eligibleAcceptanceSql}))`;

/** The reads of a command: the comparison, its run, and its project. */
function commandStateReads(database: Database, comparisonId: string) {
  return [
    statement(database, "SELECT * FROM visonaut_comparisons WHERE id = ?", [comparisonId]),
    statement(
      database,
      "SELECT run.* FROM visonaut_runs run JOIN visonaut_comparisons comparison ON comparison.run_id = run.id WHERE comparison.id = ?",
      [comparisonId],
    ),
    statement(
      database,
      "SELECT project.* FROM visonaut_projects project JOIN visonaut_runs run ON run.project_id = project.id JOIN visonaut_comparisons comparison ON comparison.run_id = run.id WHERE comparison.id = ?",
      [comparisonId],
    ),
  ];
}

function promotionRead(database: Database, comparisonId: string) {
  return statement(database, "SELECT 1 FROM visonaut_promotions WHERE comparison_id = ? LIMIT 1", [
    comparisonId,
  ]);
}

function commandState(results: (Result | undefined)[]) {
  const [comparisonResult, runResult, projectResult] = results;
  const comparison = batchRows<ComparisonRow>(comparisonResult)[0];
  const run = batchRows<RunRow>(runResult)[0];
  const project = batchRows<ProjectRow>(projectResult)[0];
  if (!comparison || !run || !project) {
    throw new IncompleteError("The requested record does not exist.");
  }
  if (run.detail_archived) {
    throw new ConflictError("Archived history is read-only.");
  }
  return { comparison, run, project };
}

interface ReviewableParams {
  comparison: ComparisonRow;
  run: RunRow;
  promotionResult: Result | undefined;
}

function assertReviewable({ comparison, run, promotionResult }: ReviewableParams) {
  if (batchRows(promotionResult).length) {
    throw new ConflictError(
      "Promoted history is read-only. Capture a correction in a new complete main run.",
    );
  }
  if (comparison.state !== "ready" || !run.active || run.comparison_id !== comparison.id) {
    throw new ConflictError("Only the active complete comparison can be reviewed.", run);
  }
}

interface CommandEndParams {
  database: Database;
  run: RunRow;
  project: ProjectRow;
  action: "approve" | "reject" | "undo";
  detail: Record<string, unknown>;
  actorId: string;
  now: number;
}

/** The last statements of each command: the audit row, a guard, and the touch. */
function commandEnd({ database, run, project, action, detail, actorId, now }: CommandEndParams) {
  return [
    auditRunChange({ database, run, action, detail, now, actorId }),
    currentBaselineGuard(database, project.id),
    ...touchRunStatusStatements(database, { id: run.id, projectId: run.project_id }, now),
  ];
}

interface CommitParams {
  service: Service;
  statements: Statement[];
  commandId: string;
  request: string;
  project: ProjectRow;
  run: RunRow;
}

/**
 * Writes a command in one D1 batch. It returns the stored result when another
 * request saved the same command first, and null when this batch saved it.
 */
async function commitCommand({
  service,
  statements,
  commandId,
  request,
  project,
  run,
}: CommitParams) {
  try {
    await atomic(service.database, statements);
    return null;
  } catch (error) {
    const replay = await commandReplay(service.database, commandId, request);
    if (replay) {
      return replay;
    }
    throw await guardFailure({ database: service.database, error, project, run });
  }
}

export async function applyReviewCommand(
  service: Service,
  input: ReviewParams,
): Promise<CommandResult> {
  const request = requestJson({ ...input });
  const replay = await commandReplay(service.database, input.commandId, request);
  if (replay) {
    return replay;
  }
  if (input.run) {
    return approveRun(service, input, request);
  }
  if (
    !input.actorId ||
    !input.sessionId ||
    input.targets.length === 0 ||
    new Set(input.targets.map((target) => target.id)).size !== input.targets.length
  ) {
    throw new IncompleteError(
      "A review command requires a maintainer, session, and unique targets.",
    );
  }
  const [comparisonResult, runResult, projectResult, rowsResult, promotionResult] =
    await service.database.batch([
      ...commandStateReads(service.database, input.comparisonId),
      input.wholeItemKey
        ? statement(
            service.database,
            `SELECT row.*, ${eligibleAcceptanceSql} AS accepted FROM visonaut_comparison_rows row WHERE row.comparison_id = ? AND row.item_key = ? AND row.outcome = 'changed' ORDER BY row.ordinal, row.id`,
            [input.comparisonId, input.wholeItemKey],
          )
        : // The unary plus keeps the comparison index out of the plan. D1 then
          // finds each target by its primary key, and does not read each row
          // of the comparison.
          statement(
            service.database,
            "SELECT * FROM visonaut_comparison_rows WHERE id IN (SELECT value FROM json_each(?)) AND +comparison_id = ?",
            [JSON.stringify(input.targets.map((target) => target.id)), input.comparisonId],
          ),
      promotionRead(service.database, input.comparisonId),
    ]);
  const { comparison, run, project } = commandState([comparisonResult, runResult, projectResult]);
  const rows = batchRows<ReviewRow & { accepted?: number }>(rowsResult);
  const selected = input.targets.map((target) => {
    const row = rows.find((entry) => entry.id === target.id);
    if (!row || row.outcome !== "changed" || row.decision_revision !== target.expectedRevision) {
      throw new ConflictError("A target changed or belongs to another comparison.", row);
    }
    return row;
  });
  if (input.wholeItemKey) {
    const itemRows = rows.filter(
      (row) => row.item_key === input.wholeItemKey && row.outcome === "changed",
    );
    if (
      itemRows.length !== selected.length ||
      selected.some((row) => row.item_key !== input.wholeItemKey)
    ) {
      throw new ConflictError("The whole-item target list must include every changed variant.");
    }
  }
  assertReviewable({ comparison, run, promotionResult });
  const statements = [
    projectGuard(service.database, project),
    reviewGuard(service.database, run, comparison.id),
  ];
  const previous: PreviousCommandState = { decisions: [] };
  const result: CommandResult = {
    commandId: input.commandId,
    revisions: [],
    selection: input.selection,
    baselineRevision: project.baseline_revision,
    promotionId: project.promotion_id,
    previousRunRevision: run.revision,
    runRevision: run.revision + 1,
  };
  // An approval of the whole screenshot keeps each approval in force, such as
  // a copy from an earlier run, so it does not show as a new decision.
  const keepsApproval = (row: (typeof selected)[number]) =>
    Boolean(input.wholeItemKey) && input.verdict === "approved" && Boolean(row.accepted);
  for (const row of selected) {
    statements.push(
      assertion(
        service.database,
        "EXISTS (SELECT 1 FROM visonaut_comparison_rows WHERE id = ? AND comparison_id = ? AND decision_revision = ?)",
        [row.id, comparison.id, row.decision_revision],
      ),
    );
    if (keepsApproval(row)) continue;
    previous.decisions.push({
      id: row.id,
      decisionId: row.decision_id,
      sourceDecisionId: row.source_decision_id,
      revision: row.decision_revision,
    });
    const decisionId = crypto.randomUUID();
    statements.push(
      statement(service.database, "UPDATE visonaut_decisions SET revoked = 1 WHERE id = ?", [
        row.decision_id,
      ]),
    );
    statements.push(
      statement(
        service.database,
        "INSERT INTO visonaut_decisions (id, row_id, revision, verdict, kind, actor_id, command_id, tuple_json, created_at) VALUES (?, ?, ?, ?, 'human', ?, ?, ?, ?)",
        [
          decisionId,
          row.id,
          row.decision_revision + 1,
          input.verdict,
          input.actorId,
          input.commandId,
          row.tuple_json,
          input.now,
        ],
      ),
    );
    statements.push(
      statement(
        service.database,
        "UPDATE visonaut_comparison_rows SET decision_revision = decision_revision + 1, decision_id = ?, source_decision_id = NULL WHERE id = ?",
        [decisionId, row.id],
      ),
    );
    result.revisions.push({ id: row.id, expectedRevision: row.decision_revision + 1 });
  }
  // A command that decides nothing would only add an audit entry and a run
  // revision. The page refuses it before it sends one.
  if (!result.revisions.length) {
    throw new ConflictError("Each variant of this screenshot is already approved.");
  }
  const action = input.verdict === "approved" ? "approve" : "reject";
  statements.push(
    statement(
      service.database,
      "INSERT INTO visonaut_commands (id, request_json, actor_id, session_id, kind, comparison_id, previous_json, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        input.commandId,
        request,
        input.actorId,
        input.sessionId,
        action,
        comparison.id,
        JSON.stringify(previous),
        JSON.stringify(result),
        input.now,
      ],
    ),
    ...commandEnd({
      database: service.database,
      run,
      project,
      action,
      detail: { commandId: input.commandId, targets: input.targets },
      actorId: input.actorId,
      now: input.now,
    }),
  );
  const saved = await commitCommand({
    service,
    statements,
    commandId: result.commandId,
    request,
    project,
    run,
  });
  return saved ?? result;
}

/**
 * Approves each change of the run with no decision, in one D1 batch. The
 * statements select the targets in D1, so the request and the batch have no
 * list of them. The batch saves nothing when the run has another revision or
 * another count of targets than the page showed.
 */
async function approveRun(
  service: Service,
  input: ReviewParams,
  request: string,
): Promise<CommandResult> {
  const expected = input.run;
  if (
    !expected ||
    !input.actorId ||
    !input.sessionId ||
    input.verdict !== "approved" ||
    input.targets.length !== 0 ||
    input.wholeItemKey !== undefined ||
    !Number.isSafeInteger(expected.count) ||
    expected.count < 1
  ) {
    throw new IncompleteError(
      "A run approval requires a maintainer, a session, a count of changes, and no targets.",
    );
  }
  const [comparisonResult, runResult, projectResult, promotionResult] =
    await service.database.batch([
      ...commandStateReads(service.database, input.comparisonId),
      promotionRead(service.database, input.comparisonId),
    ]);
  const { comparison, run, project } = commandState([comparisonResult, runResult, projectResult]);
  assertReviewable({ comparison, run, promotionResult });
  if (run.revision !== expected.revision) {
    throw new ConflictError("The run changed after the page read it. Nothing was approved.", run);
  }
  const result: CommandResult = {
    commandId: input.commandId,
    revisions: [],
    runCount: expected.count,
    selection: input.selection,
    baselineRevision: project.baseline_revision,
    promotionId: project.promotion_id,
    previousRunRevision: run.revision,
    runRevision: run.revision + 1,
  };
  const statements = [
    projectGuard(service.database, project),
    reviewGuard(service.database, run, comparison.id),
    assertion(
      service.database,
      `(SELECT COUNT(*) FROM visonaut_comparison_rows row WHERE ${runApprovalTargetsSql}) = ?`,
      [comparison.id, expected.count],
    ),
    // The command keeps the earlier decision of each target that had one, for
    // Undo. A list of each target can be larger than one D1 row can hold.
    statement(
      service.database,
      `INSERT INTO visonaut_commands (id, request_json, actor_id, session_id, kind, comparison_id, previous_json, result_json, created_at)
        SELECT ?, ?, ?, ?, 'approve', ?, json_object('decisions', json_group_array(json_object(
          'id', row.id, 'decisionId', row.decision_id,
          'sourceDecisionId', row.source_decision_id, 'revision', row.decision_revision))
          FILTER (WHERE row.decision_id IS NOT NULL OR row.source_decision_id IS NOT NULL)), ?, ?
        FROM visonaut_comparison_rows row WHERE ${runApprovalTargetsSql}`,
      [
        input.commandId,
        request,
        input.actorId,
        input.sessionId,
        comparison.id,
        JSON.stringify(result),
        input.now,
        comparison.id,
      ],
    ),
    statement(
      service.database,
      `UPDATE visonaut_decisions SET revoked = 1 WHERE id IN
        (SELECT row.decision_id FROM visonaut_comparison_rows row WHERE ${runApprovalTargetsSql})`,
      [comparison.id],
    ),
    // The ID of each decision is the command ID and the row ID. The row update
    // finds its new decision by that key.
    statement(
      service.database,
      `INSERT INTO visonaut_decisions (id, row_id, revision, verdict, kind, actor_id, command_id, tuple_json, created_at)
        SELECT ? || ':' || row.id, row.id, row.decision_revision + 1, 'approved', 'human', ?, ?, row.tuple_json, ?
        FROM visonaut_comparison_rows row WHERE ${runApprovalTargetsSql}`,
      [input.commandId, input.actorId, input.commandId, input.now, comparison.id],
    ),
    statement(
      service.database,
      `UPDATE visonaut_comparison_rows SET decision_revision = decision_revision + 1,
        decision_id = ? || ':' || id, source_decision_id = NULL
        WHERE comparison_id = ? AND EXISTS (SELECT 1 FROM visonaut_decisions decision
          WHERE decision.id = ? || ':' || visonaut_comparison_rows.id)`,
      [input.commandId, comparison.id, input.commandId],
    ),
    ...commandEnd({
      database: service.database,
      run,
      project,
      action: "approve",
      detail: { commandId: input.commandId, run: expected },
      actorId: input.actorId,
      now: input.now,
    }),
  ];
  const saved = await commitCommand({
    service,
    statements,
    commandId: result.commandId,
    request,
    project,
    run,
  });
  return saved ?? result;
}

/**
 * The statements that undo a run approval. Its targets are the rows that still
 * have its decision, at the revision of that decision. Each target gets its
 * earlier decision back, or no decision. The statements read the earlier
 * decisions from the command row, so the batch has no list of targets.
 */
function undoRunApprovalStatements(database: Database, command: CommandRow, count: number) {
  const targetsSql = `row.comparison_id = ? AND row.decision_id = ? || ':' || row.id`;
  const previousSql = `json_each((SELECT previous_json FROM visonaut_commands WHERE id = ?), '$.decisions')`;
  return [
    assertion(
      database,
      `(SELECT COUNT(*) FROM visonaut_comparison_rows row JOIN visonaut_decisions decision
        ON decision.id = row.decision_id
        WHERE ${targetsSql} AND decision.revision = row.decision_revision) = ?`,
      [command.comparison_id, command.id, count],
    ),
    statement(
      database,
      `UPDATE visonaut_decisions SET revoked = 1 WHERE id IN
        (SELECT row.decision_id FROM visonaut_comparison_rows row WHERE ${targetsSql})`,
      [command.comparison_id, command.id],
    ),
    statement(
      database,
      `UPDATE visonaut_decisions SET revoked = 0 WHERE id IN
        (SELECT json_extract(value, '$.decisionId') FROM ${previousSql})`,
      [command.id],
    ),
    statement(
      database,
      `UPDATE visonaut_comparison_rows AS row SET decision_revision = decision_revision + 1,
        (decision_id, source_decision_id) = (SELECT json_extract(value, '$.decisionId'),
          json_extract(value, '$.sourceDecisionId') FROM ${previousSql}
          WHERE json_extract(value, '$.id') = row.id)
        WHERE ${targetsSql}`,
      [command.id, command.comparison_id, command.id],
    ),
  ];
}

export async function undoReviewCommand(
  service: Service,
  input: {
    commandId: string;
    undoCommandId: string;
    actorId: string;
    sessionId: string;
    expectedBaselineRevision: number;
    now: number;
  },
): Promise<CommandResult> {
  const request = requestJson({ ...input });
  const replay = await commandReplay(service.database, input.undoCommandId, request);
  if (replay) {
    return replay;
  }
  const command = await readOne<CommandRow>(
    service.database,
    "SELECT * FROM visonaut_commands WHERE id = ?",
    [input.commandId],
  );
  if (
    command.actor_id !== input.actorId ||
    command.session_id !== input.sessionId ||
    command.undone_by ||
    command.kind === "undo"
  ) {
    throw new ConflictError("Only your saved command in this review session can be undone.");
  }
  const saved = parseCommandResult(command.result_json);
  const previous = JSON.parse(command.previous_json) as PreviousCommandState;
  const comparison = await service.comparison(command.comparison_id);
  const run = await service.run(comparison.run_id);
  const project = await service.project(run.project_id);
  if (run.kind !== "pull_request" && project.baseline_revision !== input.expectedBaselineRevision) {
    throw new ConflictError("The baseline changed after this command.", project);
  }
  const promoted = await statement(
    service.database,
    "SELECT 1 FROM visonaut_promotions WHERE comparison_id=? LIMIT 1",
    [comparison.id],
  ).first();
  if (promoted)
    throw new ConflictError(
      "Promoted history is read-only. Capture a correction in a new complete main run.",
    );
  if (!run.active || run.comparison_id !== comparison.id || comparison.state !== "ready") {
    throw new ConflictError("The command no longer targets the active comparison.");
  }
  const statements = [
    projectGuard(service.database, project),
    reviewGuard(service.database, run, comparison.id),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_commands WHERE id = ? AND undone_by IS NULL)",
      [command.id],
    ),
  ];
  const result: CommandResult = {
    commandId: input.undoCommandId,
    revisions: [],
    selection: saved.selection,
    baselineRevision: project.baseline_revision,
    promotionId: project.promotion_id,
  };
  if (saved.runCount !== undefined) {
    statements.push(...undoRunApprovalStatements(service.database, command, saved.runCount));
  }
  for (const target of saved.revisions) {
    const prior = previous.decisions.find((entry) => entry.id === target.id);
    if (!prior) {
      throw new IncompleteError("The saved command does not contain its prior verdict.");
    }
    statements.push(
      assertion(
        service.database,
        "EXISTS (SELECT 1 FROM visonaut_comparison_rows WHERE id = ? AND decision_revision = ?)",
        [target.id, target.expectedRevision],
      ),
    );
    statements.push(
      statement(
        service.database,
        "UPDATE visonaut_decisions SET revoked = 1 WHERE id = (SELECT decision_id FROM visonaut_comparison_rows WHERE id = ?)",
        [target.id],
      ),
    );
    statements.push(
      statement(service.database, "UPDATE visonaut_decisions SET revoked = 0 WHERE id = ?", [
        prior.decisionId,
      ]),
    );
    statements.push(
      statement(
        service.database,
        "UPDATE visonaut_comparison_rows SET decision_revision = decision_revision + 1, decision_id = ?, source_decision_id = ? WHERE id = ?",
        [prior.decisionId, prior.sourceDecisionId, target.id],
      ),
    );
    result.revisions.push({ id: target.id, expectedRevision: target.expectedRevision + 1 });
  }
  statements.push(
    statement(service.database, "UPDATE visonaut_commands SET undone_by = ? WHERE id = ?", [
      input.undoCommandId,
      command.id,
    ]),
    statement(
      service.database,
      "INSERT INTO visonaut_commands (id, request_json, actor_id, session_id, kind, comparison_id, previous_json, result_json, created_at) VALUES (?, ?, ?, ?, 'undo', ?, ?, ?, ?)",
      [
        input.undoCommandId,
        request,
        input.actorId,
        input.sessionId,
        comparison.id,
        JSON.stringify({ decisions: [] }),
        JSON.stringify(result),
        input.now,
      ],
    ),
    ...commandEnd({
      database: service.database,
      run,
      project,
      action: "undo",
      detail: { commandId: command.id, undoCommandId: input.undoCommandId },
      actorId: input.actorId,
      now: input.now,
    }),
  );
  const replayed = await commitCommand({
    service,
    statements,
    commandId: result.commandId,
    request,
    project,
    run,
  });
  return replayed ?? result;
}
