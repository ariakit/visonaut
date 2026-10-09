import {
  atomic,
  claimExpiredRun,
  closedRunRetentionMs,
  completeRetiredRunDeletion,
} from "@visonaut/service";
import { recordEvent, resolveEvents } from "./common.ts";
import type { OperationReport, OperationsContext } from "./types.ts";

export interface RetainedImageOwner {
  id: string;
  object_prefix: string;
  inventory_key: string | null;
  inventory_digest: string | null;
}

/**
 * Return the prefix of the images that a retained run owns, or null when the
 * stored prefix is not one of the two forms that the collector can delete.
 * The candidate query applies the same rule in SQL.
 */
export function imagePrefix(owner: RetainedImageOwner) {
  if (
    owner.object_prefix === `runs/${owner.id}/` &&
    /^runs\/[A-Za-z0-9_-]+\/$/u.test(owner.object_prefix)
  ) {
    return owner.inventory_key ? `${owner.object_prefix}images/` : owner.object_prefix;
  }
  const imported = /^baselines\/import\/([a-f0-9]{64})\/images\/$/u.exec(owner.object_prefix);
  const importDigest = imported?.[1];
  if (!importDigest || !owner.inventory_digest) return null;
  const expectedRunId = [
    importDigest.slice(0, 8),
    importDigest.slice(8, 12),
    importDigest.slice(12, 16),
    importDigest.slice(16, 20),
    importDigest.slice(20, 32),
  ].join("-");
  if (
    owner.id !== expectedRunId ||
    !/^[a-f0-9]{64}$/u.test(owner.inventory_digest) ||
    owner.inventory_key !==
      `baselines/import/${importDigest}/inventory/${owner.inventory_digest}.json`
  ) {
    return null;
  }
  // The imported prefix already selects images; its inventory and plan stay live.
  return owner.object_prefix;
}

const runIdCharacters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const digestCharacters = "0123456789abcdef";
// The 64 characters after "baselines/import/" in the prefix of an import.
const importDigestSql = "substr(work_retained_runs.object_prefix,18,64)";

/**
 * The rule of `imagePrefix` as a condition on a row of `work_retained_runs`.
 * A row that the collector cannot delete is then not a candidate, so it does
 * not fill the candidate page. SQLite has no regular expression: `ltrim`
 * removes the characters of a set, so an empty result shows that the text has
 * no other character. `||` and `ltrim` read a BLOB as text, so `typeof`
 * refuses a BLOB first. `imagePrefix` stays the last check before a deletion,
 * and a test compares the two forms on a table of prefixes.
 */
const deletableImageOwnerSql = `(
  (work_retained_runs.object_prefix='runs/' || work_retained_runs.id || '/'
    AND typeof(work_retained_runs.id)='text'
    AND work_retained_runs.id!='' AND ltrim(work_retained_runs.id,'${runIdCharacters}')='')
  OR (work_retained_runs.object_prefix='baselines/import/' || ${importDigestSql} || '/images/'
    AND length(${importDigestSql})=64 AND ltrim(${importDigestSql},'${digestCharacters}')=''
    AND work_retained_runs.id=substr(${importDigestSql},1,8) || '-' || substr(${importDigestSql},9,4)
      || '-' || substr(${importDigestSql},13,4) || '-' || substr(${importDigestSql},17,4)
      || '-' || substr(${importDigestSql},21,12)
    AND EXISTS(SELECT 1 FROM visonaut_runs run WHERE run.id=work_retained_runs.id
      AND typeof(run.inventory_digest)='text'
      AND length(run.inventory_digest)=64 AND ltrim(run.inventory_digest,'${digestCharacters}')=''
      AND run.inventory_key='baselines/import/' || ${importDigestSql} || '/inventory/'
        || run.inventory_digest || '.json')))`;

/** Keep sparse review inventories after their original images expire. */
export async function expireRunImages(context: OperationsContext): Promise<OperationReport> {
  const { database, budget } = context;
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const candidates = await database
    .prepare(`SELECT id,object_prefix,(SELECT inventory_key FROM visonaut_runs WHERE id=work_retained_runs.id) AS inventory_key,
      (SELECT inventory_digest FROM visonaut_runs WHERE id=work_retained_runs.id) AS inventory_digest FROM work_retained_runs
    WHERE EXISTS(SELECT 1 FROM visonaut_closed_summaries summary WHERE summary.run_id=work_retained_runs.id AND summary.state='ready') AND NOT EXISTS(SELECT 1 FROM work_retention_pins WHERE run_id=work_retained_runs.id) AND ((byte_state='live' AND closed_at IS NOT NULL AND closed_at<=?)
       OR (byte_state='deleting' AND deletion_until<=?))
      AND ${deletableImageOwnerSql}
    ORDER BY closed_at,id LIMIT ?`)
    .bind(context.now() - closedRunRetentionMs, context.now(), budget.tasksPerStep)
    .all<RetainedImageOwner>();
  let remaining = budget.objectsPerStep;
  for (const candidate of candidates.results ?? []) {
    if (remaining < 1) {
      report.hasMore = true;
      break;
    }
    // The slash boundary prevents run "a" from deleting run "ab".
    const prefix = imagePrefix(candidate);
    if (!prefix) {
      // The candidate query applies the same rule, so this branch runs only
      // if the two forms of the rule differ.
      await recordEvent(database, {
        kind: "retention",
        subject: candidate.id,
        code: "unsafe-prefix",
        now: context.now(),
      });
      report.attention.push(candidate.id);
      continue;
    }
    const token = crypto.randomUUID();
    const claim = await claimExpiredRun(database, {
      id: candidate.id,
      token,
      now: context.now(),
      leaseMs: budget.leaseMilliseconds,
    });
    if (!claim) continue;
    try {
      let more = false;
      for (const [store, ownedPrefix] of [
        [context.images, prefix],
        [context.images, `derived/${candidate.id}/`],
        [context.quarantine, `quarantine/${candidate.id}/`],
        [context.quarantine, `manifests/${candidate.id}/`],
      ] as const) {
        if (remaining < 1) {
          more = true;
          break;
        }
        const page = await store.list({ prefix: ownedPrefix, limit: remaining });
        if (page.objects.some((object) => !object.key.startsWith(ownedPrefix))) {
          throw new Error("Storage returned an object outside the run prefix.");
        }
        if (page.objects.length) {
          await store.delete(page.objects.map((object) => object.key));
          remaining -= page.objects.length;
        }
        const next = await store.list({ prefix: ownedPrefix, limit: 1 });
        if (next.objects.length || next.truncated) more = true;
      }
      if (more) {
        report.deferred.push(candidate.id);
        report.hasMore = true;
        await database
          .prepare("UPDATE work_retained_runs SET deletion_until=? WHERE id=? AND deletion_token=?")
          .bind(context.now(), candidate.id, token)
          .run();
      } else {
        // Mark byte absence with the same lease guard that completes deletion.
        await atomic(database, [
          database
            .prepare(`INSERT INTO visonaut_assertions(valid)
          SELECT CASE WHEN EXISTS(SELECT 1 FROM work_retained_runs WHERE id=? AND byte_state='deleting' AND deletion_token=? AND deletion_until>?) THEN 1 ELSE 0 END`)
            .bind(candidate.id, token, context.now()),
          database
            .prepare("UPDATE visonaut_images SET bytes_present=0 WHERE run_id=?")
            .bind(candidate.id),
        ]);
        if (
          !(await completeRetiredRunDeletion(database, {
            id: candidate.id,
            token,
            now: context.now(),
          }))
        ) {
          throw new Error("The deletion lease expired before completion.");
        }
        await resolveEvents(database, "retention", candidate.id, context.now());
        report.completed.push(candidate.id);
      }
    } catch {
      await recordEvent(database, {
        kind: "retention",
        subject: candidate.id,
        code: "delete-failed",
        now: context.now(),
      });
      report.attention.push(candidate.id);
    }
  }
  return report;
}
