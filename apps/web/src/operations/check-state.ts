import { statusRunEligibleSql } from "@visonaut/service";

export function currentPreRunCheckSql(checkId: string) {
  return `NOT EXISTS(SELECT 1 FROM pre_run_checks previous WHERE previous.check_id=${checkId}
    AND (previous.state!='active' OR previous.plan_visual_required IS NULL OR EXISTS(
      SELECT 1 FROM pre_run_checks newer WHERE newer.tested_sha=previous.tested_sha
        AND newer.generation>previous.generation)))`;
}

/** Unknown ownership and unsettled sends cannot prove an exhausted alert obsolete. */
export function obsoleteCheckDeliverySql(checkId: string) {
  return `EXISTS(SELECT 1 FROM work_checks sender WHERE sender.id=${checkId}
    AND sender.ambiguous=0 AND sender.request_started=0 AND sender.lease_token IS NULL
    AND (EXISTS(SELECT 1 FROM pre_run_checks previous JOIN pre_run_checks newer
        ON newer.tested_sha=previous.tested_sha AND newer.generation>previous.generation
        WHERE previous.check_id=sender.id)
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
