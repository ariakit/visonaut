CREATE TABLE ariviso_decision_replacements (
  source_decision_id TEXT NOT NULL REFERENCES ariviso_decisions(id),
  replacement_decision_id TEXT NOT NULL REFERENCES ariviso_decisions(id),
  scope TEXT NOT NULL CHECK (scope IN ('shared', 'descendants')),
  scope_run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  PRIMARY KEY (source_decision_id, replacement_decision_id, scope_run_id)
);
CREATE INDEX ariviso_replacements_successor ON ariviso_decision_replacements(replacement_decision_id);

-- Preserve existing decision replacement chains from their immutable command records.
WITH RECURSIVE command_targets AS (
  SELECT decision.id AS replacement_id,
    json_extract(target.value, '$.sourceDecisionId') AS source_id,
    COALESCE(json_extract(target.value, '$.sourceDecisionId'), json_extract(target.value, '$.decisionId')) AS previous_id,
    command.kind,
    CASE WHEN command.kind = 'reject' AND json_extract(command.previous_json, '$.rollback') IS NULL
      THEN 'shared' ELSE 'descendants' END AS scope,
    comparison.run_id
  FROM ariviso_commands command
  JOIN ariviso_decisions decision ON decision.command_id = command.id
  JOIN ariviso_comparisons comparison ON comparison.id = command.comparison_id
  JOIN json_each(command.previous_json, '$.decisions') target
    ON json_extract(target.value, '$.id') = decision.row_id
  WHERE command.kind IN ('approve', 'reject')
), replacements(source_id, replacement_id, scope, run_id) AS (
  SELECT source_id, replacement_id, scope, run_id
  FROM command_targets WHERE source_id IS NOT NULL
  UNION
  SELECT replacement.source_id, target.replacement_id, replacement.scope, replacement.run_id
  FROM replacements replacement
  JOIN command_targets target ON target.previous_id = replacement.replacement_id
)
INSERT INTO ariviso_decision_replacements (source_decision_id, replacement_decision_id, scope, scope_run_id)
SELECT source_id, replacement_id, scope, run_id FROM replacements;
