import type { Database } from "./database.ts";

interface ComparisonPublication {
  published: string[];
  failed: string[];
}

/** Both schedulers write Queue outcomes to the same private event ledger. */
export async function reportComparisonPublication(
  database: Database,
  publication: ComparisonPublication,
  now: number,
) {
  for (const subject of publication.failed) {
    await database
      .prepare(`INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at)
        VALUES(?,'comparison-publication',?,'publication-failed',?,?)
        ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,
          occurrences=operations_events.occurrences+1,resolved_at=NULL`)
      .bind(`comparison-publication:${subject}:publication-failed`, subject, now, now)
      .run();
  }
  for (const subject of publication.published) {
    await database
      .prepare(`UPDATE operations_events SET resolved_at=?
        WHERE kind='comparison-publication' AND subject_id=? AND resolved_at IS NULL`)
      .bind(now, subject)
      .run();
  }
}
