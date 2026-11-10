import { statusRunEligibleSql } from "@visonaut/service";

/**
 * True when no pre-run row of the check stops its updates: a closed row, a row
 * with no Plan result, a row with a newer generation, or a status row whose
 * commit status a newer row of the same commit started.
 */
export function currentPreRunCheckSql(checkId: string) {
  return `NOT EXISTS(SELECT 1 FROM pre_run_checks previous WHERE previous.check_id=${checkId}
    AND (previous.state!='active' OR previous.plan_visual_required IS NULL OR EXISTS(
      SELECT 1 FROM pre_run_checks newer WHERE newer.tested_sha=previous.tested_sha
        AND newer.generation>previous.generation)
      OR (previous.surface='status' AND NOT ${ownsCommitStatusSql("previous")})))`;
}

/**
 * Unknown ownership and unsettled sends cannot prove a delivery alert
 * obsolete. A locked check (`ambiguous=1`) is never obsolete. A status row
 * whose commit status a newer row started gets no more updates.
 */
export function obsoleteCheckDeliverySql(checkId: string) {
  return `EXISTS(SELECT 1 FROM work_checks sender WHERE sender.id=${checkId}
    AND sender.ambiguous=0 AND sender.request_started=0 AND sender.lease_token IS NULL
    AND (EXISTS(SELECT 1 FROM pre_run_checks previous JOIN pre_run_checks newer
        ON newer.tested_sha=previous.tested_sha AND newer.generation>previous.generation
        WHERE previous.check_id=sender.id)
      OR EXISTS(SELECT 1 FROM pre_run_checks previous
        WHERE previous.check_id=sender.id AND previous.surface='status'
          AND NOT ${ownsCommitStatusSql("previous")})
      OR EXISTS(SELECT 1 FROM work_status_outbox latest
        WHERE latest.check_id=sender.id AND latest.revision=sender.desired_revision
          AND latest.state IN ('complete','obsolete'))
      OR EXISTS(SELECT 1 FROM operations_check_creations creation
        JOIN visonaut_runs run ON run.id=creation.run_id
        WHERE creation.check_id=sender.id AND NOT ${statusRunEligibleSql})
      OR EXISTS(SELECT 1 FROM work_status_outbox latest
        JOIN visonaut_runs run ON run.id=latest.run_id
        WHERE latest.check_id=sender.id AND latest.revision=(
          SELECT MAX(history.revision) FROM work_status_outbox history WHERE history.check_id=sender.id)
          AND NOT ${statusRunEligibleSql})))`;
}

/** The commit whose status a pre-run row writes: the head of a pull request, or the tested commit. */
export function statusCommitSql(row: string) {
  return `COALESCE(${row}.check_head_sha,${row}.tested_sha)`;
}

/**
 * True when no newer pre-run row of the same status commit has started its
 * status. Only the newest started row writes the commit status, because all
 * rows of a commit share it. A recorded row that never starts, such as the
 * second merge of an edited pull request, takes nothing from the active row.
 */
export function ownsCommitStatusSql(row: string) {
  return `NOT EXISTS(SELECT 1 FROM pre_run_checks newer
    WHERE ${statusCommitSql("newer")}=${statusCommitSql(row)}
      AND (newer.check_id IS NOT NULL OR newer.state='creating')
      AND (newer.created_at>${row}.created_at
        OR (newer.created_at=${row}.created_at AND newer.rowid>${row}.rowid)))`;
}
