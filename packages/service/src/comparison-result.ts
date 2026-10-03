export const localResultReferenceJson = '{"$visonautLocalResult":1}';

/** Resolve local results through the capture protected by the row's foreign key. */
export function comparisonResultSql(row: string) {
  const marker = `${row}.result_json,'$."$visonautLocalResult"'`;
  // Invalid references must fail the read, rather than lose metrics or masks.
  const invalid = "json('Invalid local comparison result reference')";
  // Strip SQLite's JSON subtype so archives keep result_json as a JSON string.
  return `(CASE
    WHEN json_type(${marker}) IS NULL THEN ${row}.result_json
    WHEN json_type(${marker})='integer' AND json_extract(${marker})=1
      AND (SELECT COUNT(*) FROM json_each(${row}.result_json))=1
    THEN COALESCE((SELECT CASE
      WHEN json_type(capture.metadata_json,'$.localResult')='object'
      THEN json_set(json_extract(capture.metadata_json,'$.localResult'),'$.outcome',${row}.outcome)
      ELSE ${invalid} END FROM visonaut_captures capture WHERE capture.id=${row}.candidate_capture_id),${invalid})
    ELSE ${invalid} END) || ''`;
}
