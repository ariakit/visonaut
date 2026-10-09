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
import type { Database, Result, SqlValue } from "./database.ts";
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
  if (command.request_digest) {
    const archive = await statement(
      database,
      "SELECT archive.run_id FROM operations_run_archives archive JOIN visonaut_comparisons comparison ON comparison.run_id=archive.run_id WHERE comparison.id=? AND archive.state='ready'",
      [command.comparison_id],
    ).first<{ run_id: string }>();
    if (archive) {
      if ((await commandRequestDigest(request)) !== command.request_digest) {
        throw new ConflictError("The command ID already belongs to another request.");
      }
      throw new ArchivedCommandResultError(archive.run_id, command.id);
    }
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

export async function applyReviewCommand(
  service: Service,
  input: ReviewParams,
): Promise<CommandResult> {
  const request = requestJson({ ...input });
  const replay = await commandReplay(service.database, input.commandId, request);
  if (replay) {
    return replay;
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
      statement(service.database, "SELECT * FROM visonaut_comparisons WHERE id = ?", [
        input.comparisonId,
      ]),
      statement(
        service.database,
        "SELECT run.* FROM visonaut_runs run JOIN visonaut_comparisons comparison ON comparison.run_id = run.id WHERE comparison.id = ?",
        [input.comparisonId],
      ),
      statement(
        service.database,
        "SELECT project.* FROM visonaut_projects project JOIN visonaut_runs run ON run.project_id = project.id JOIN visonaut_comparisons comparison ON comparison.run_id = run.id WHERE comparison.id = ?",
        [input.comparisonId],
      ),
      input.wholeItemKey
        ? statement(
            service.database,
            "SELECT * FROM visonaut_comparison_rows WHERE comparison_id = ? AND item_key = ? AND outcome = 'changed' ORDER BY ordinal, id",
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
      statement(
        service.database,
        "SELECT 1 FROM visonaut_promotions WHERE comparison_id = ? LIMIT 1",
        [input.comparisonId],
      ),
    ]);
  const comparison = batchRows<ComparisonRow>(comparisonResult)[0];
  const run = batchRows<RunRow>(runResult)[0];
  const project = batchRows<ProjectRow>(projectResult)[0];
  if (!comparison || !run || !project) {
    throw new IncompleteError("The requested record does not exist.");
  }
  if (run.detail_archived) {
    throw new ConflictError("Archived history is read-only.");
  }
  const rows = batchRows<ReviewRow>(rowsResult);
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
  if (batchRows(promotionResult).length) {
    throw new ConflictError(
      "Promoted history is read-only. Capture a correction in a new complete main run.",
    );
  }
  if (comparison.state !== "ready" || !run.active || run.comparison_id !== comparison.id) {
    throw new ConflictError("Only the active complete comparison can be reviewed.", run);
  }
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
  for (const row of selected) {
    statements.push(
      assertion(
        service.database,
        "EXISTS (SELECT 1 FROM visonaut_comparison_rows WHERE id = ? AND comparison_id = ? AND decision_revision = ?)",
        [row.id, comparison.id, row.decision_revision],
      ),
    );
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
  statements.push(
    statement(
      service.database,
      "INSERT INTO visonaut_commands (id, request_json, actor_id, session_id, kind, comparison_id, previous_json, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        input.commandId,
        request,
        input.actorId,
        input.sessionId,
        input.verdict === "approved" ? "approve" : "reject",
        comparison.id,
        JSON.stringify(previous),
        JSON.stringify(result),
        input.now,
      ],
    ),
  );
  statements.push(
    auditRunChange({
      database: service.database,
      run: run,
      action: input.verdict === "approved" ? "approve" : "reject",
      detail: { commandId: input.commandId, targets: input.targets },
      now: input.now,
      actorId: input.actorId,
    }),
  );
  statements.push(
    currentBaselineGuard(service.database, project.id),
    ...touchRunStatusStatements(
      service.database,
      { id: run.id, projectId: run.project_id },
      input.now,
    ),
  );
  try {
    await atomic(service.database, statements);
  } catch (error) {
    const replay = await commandReplay(service.database, result.commandId, request);
    if (replay) {
      return replay;
    }
    throw await guardFailure({ database: service.database, error, project, run });
  }
  return result;
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
  );
  statements.push(
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
  );
  statements.push(
    auditRunChange({
      database: service.database,
      run: run,
      action: "undo",
      detail: { commandId: command.id, undoCommandId: input.undoCommandId },
      now: input.now,
      actorId: input.actorId,
    }),
  );
  statements.push(
    currentBaselineGuard(service.database, project.id),
    ...touchRunStatusStatements(
      service.database,
      { id: run.id, projectId: run.project_id },
      input.now,
    ),
  );
  try {
    await atomic(service.database, statements);
  } catch (error) {
    const replay = await commandReplay(service.database, result.commandId, request);
    if (replay) {
      return replay;
    }
    throw await guardFailure({ database: service.database, error, project, run });
  }
  return result;
}
