import { assertion, atomic, ConflictError, retentionPinStatement } from "@visonaut/service";
import { parseHistoryPage, type HistoryManifest, type HistoryPointer } from "./history-format.ts";
import { readComparisonHistoryManifest } from "./history-supplement.ts";
import { readHistoryManifest, readVerifiedHistoryObject } from "./history.ts";
import { createExportWriter } from "./export-pages.ts";
import type { OperationsContext } from "./types.ts";

export async function getHistoricalExportRoots(context: OperationsContext, runId: string) {
  const pending = await context.database
    .prepare(
      "SELECT comparison.id FROM visonaut_comparisons comparison WHERE comparison.run_id=? AND comparison.purpose='historical' AND NOT EXISTS(SELECT 1 FROM operations_comparison_archives archive WHERE archive.comparison_id=comparison.id AND archive.state='ready') LIMIT 1",
    )
    .bind(runId)
    .first();
  if (pending)
    throw new ConflictError(
      "Wait for the historical comparison to finish saving before exporting.",
    );
  const supplemental = await context.database
    .prepare(
      "SELECT comparison_id FROM operations_comparison_archives WHERE run_id=? AND state='ready' ORDER BY created_at,comparison_id LIMIT ?",
    )
    .bind(runId, context.budget.maximumExportEntries + 1)
    .all<{ comparison_id: string }>();
  if ((supplemental.results?.length ?? 0) > context.budget.maximumExportEntries)
    throw new Error("Export has too many historical comparisons.");
  const roots: { pointer: HistoryPointer; manifest: HistoryManifest }[] = [];
  for (const row of supplemental.results ?? []) {
    const saved = await readComparisonHistoryManifest(context, {
      runId: runId,
      comparisonId: row.comparison_id,
    });
    if (!saved) throw new Error("Historical comparison archive is unavailable.");
    roots.push(saved);
  }
  return roots;
}
export function historyExportEntries(
  root: { pointer: HistoryPointer; manifest: HistoryManifest },
  prefix: string,
) {
  return [
    {
      name: `${prefix}/manifest.json`,
      source: "images" as const,
      key: root.pointer.object_key,
      digest: root.pointer.digest,
      bytes: root.pointer.bytes,
    },
    ...root.manifest.pages.map((page, index) => ({
      name: `${prefix}/${String(index).padStart(6, "0")}.json`,
      source: "images" as const,
      key: page.key,
      digest: page.digest,
      bytes: page.bytes,
    })),
  ];
}
export function historicalExportAssertion(
  context: OperationsContext,
  runId: string,
  rootCount: number,
) {
  return assertion(
    context.database,
    "NOT EXISTS(SELECT 1 FROM visonaut_comparisons comparison WHERE comparison.run_id=? AND comparison.purpose='historical' AND NOT EXISTS(SELECT 1 FROM operations_comparison_archives archive WHERE archive.comparison_id=comparison.id AND archive.state='ready')) AND (SELECT COUNT(*) FROM operations_comparison_archives WHERE run_id=? AND state='ready')=?",
    [runId, runId, rootCount],
  );
}

/** Cold exports carry verified detail pages and only image bytes that are still live. */
export async function createArchivedRunExport(
  context: OperationsContext,
  input: { runId: string; actorId: string },
) {
  const root = await readHistoryManifest(context, input.runId);
  if (!root) return null;
  const roots = [root, ...(await getHistoricalExportRoots(context, input.runId))];
  const id = crypto.randomUUID();
  const owner = `export:${id}`;
  const writer = createExportWriter(context, id, input.runId);
  let entryIndex = 0;
  await context.database
    .prepare(
      "INSERT INTO operations_exports(id,run_id,actor_id,state,expires_at,created_at) VALUES(?,?,?,'building',?,?)",
    )
    .bind(id, input.runId, input.actorId, context.now() + 24 * 60 * 60 * 1000, context.now())
    .run();
  try {
    for (const [index, saved] of roots.entries()) {
      const prefix = index === 0 ? "history" : `history-comparisons/${saved.pointer.generation}`;
      await writer.entry({
        name: `${prefix}/manifest.json`,
        source: "images",
        key: saved.pointer.object_key,
        digest: saved.pointer.digest,
        bytes: saved.pointer.bytes,
      });
      for (const [pageIndex, page] of saved.manifest.pages.entries()) {
        await writer.entry({
          name: `${prefix}/${String(pageIndex).padStart(6, "0")}.json`,
          source: "images",
          key: page.key,
          digest: page.digest,
          bytes: page.bytes,
        });
      }
    }
    const ownerIds = new Set<string>();
    const imageIds = new Set<string>();
    const objectKeys = new Set<string>();
    const snapshotIds = new Set<string>();
    for (const saved of roots) {
      for (const reference of saved.manifest.pages) {
        if (reference.section !== "images" && reference.section !== "referenceImages") continue;
        const page = parseHistoryPage(
          await readVerifiedHistoryObject(context, reference),
          saved.manifest,
          reference,
        );
        const ids = page.rows.flatMap((row) => (typeof row.id === "string" ? [row.id] : []));
        if (!ids.length) continue;
        const images = await context.database
          .prepare(
            `SELECT id,run_id,object_key,digest,bytes,content_type FROM visonaut_images WHERE bytes_present=1 AND id IN(SELECT value FROM json_each(?))`,
          )
          .bind(JSON.stringify(ids))
          .all<{
            id: string;
            run_id: string;
            object_key: string;
            digest: string;
            bytes: number;
            content_type: string;
          }>();
        for (const image of images.results ?? []) {
          if (imageIds.has(image.id)) continue;
          imageIds.add(image.id);
          objectKeys.add(image.object_key);
          ownerIds.add(image.run_id);
          await writer.entry({
            name: `images/${String(imageIds.size).padStart(8, "0")}.${image.content_type === "image/png" ? "png" : "webp"}`,
            source: "images",
            key: image.object_key,
            digest: image.digest,
            bytes: image.bytes,
          });
        }
        const copies = await context.database
          .prepare(
            `SELECT copy.snapshot_id,copy.object_key,copy.digest,image.bytes,image.content_type FROM visonaut_snapshot_images copy JOIN visonaut_images image ON image.id=copy.image_id JOIN visonaut_snapshot_retention retention ON retention.snapshot_id=copy.snapshot_id WHERE copy.copied=1 AND retention.byte_state='live' AND copy.image_id IN(SELECT value FROM json_each(?))`,
          )
          .bind(JSON.stringify(ids))
          .all<{
            snapshot_id: string;
            object_key: string;
            digest: string;
            bytes: number;
            content_type: string;
          }>();
        for (const copy of copies.results ?? []) {
          if (objectKeys.has(copy.object_key)) continue;
          objectKeys.add(copy.object_key);
          snapshotIds.add(copy.snapshot_id);
          await writer.entry({
            name: `references/${String(entryIndex++).padStart(8, "0")}.${copy.content_type === "image/png" ? "png" : "webp"}`,
            source: "images",
            key: copy.object_key,
            digest: copy.digest,
            bytes: copy.bytes,
          });
        }
      }
    }

    await atomic(context.database, [
      assertion(
        context.database,
        "EXISTS(SELECT 1 FROM operations_run_archives WHERE run_id=? AND state='ready' AND generation=? AND digest=?)",
        [input.runId, root.pointer.generation, root.pointer.digest],
      ),
      historicalExportAssertion(context, input.runId, roots.length - 1),
      ...[...ownerIds].map((runId) =>
        retentionPinStatement(context.database, { runId, owner, reason: "recovery" }),
      ),
      ...[...snapshotIds].flatMap((snapshotId) => [
        assertion(
          context.database,
          "EXISTS(SELECT 1 FROM visonaut_snapshot_retention WHERE snapshot_id=? AND byte_state='live')",
          [snapshotId],
        ),
        context.database
          .prepare("INSERT INTO visonaut_pins(snapshot_id,reason,owner_id) VALUES(?,'export',?)")
          .bind(snapshotId, owner),
      ]),
      assertion(
        context.database,
        "EXISTS(SELECT 1 FROM operations_exports WHERE id=? AND state='building' AND expires_at>?)",
        [id, context.now()],
      ),
    ]);
    await writer.metadata("history", [root.manifest]);
    for (const saved of roots.slice(1)) {
      await writer.metadata("historicalComparisons", [saved.manifest]);
    }
    await writer.finish({
      archived: true,
      imageBytes: "Only retained image bytes are included. Expired images remain unavailable.",
    });
    await atomic(context.database, [
      assertion(
        context.database,
        "EXISTS(SELECT 1 FROM operations_exports WHERE id=? AND state='building' AND expires_at>?)",
        [id, context.now()],
      ),
      context.database.prepare("UPDATE operations_exports SET state='ready' WHERE id=?").bind(id),
    ]);
    return { exportId: id, downloadPath: `/api/exports/${id}` };
  } catch (error) {
    await atomic(context.database, [
      context.database.prepare("UPDATE operations_exports SET state='failed' WHERE id=?").bind(id),
      context.database
        .prepare("DELETE FROM visonaut_pins WHERE owner_id=? AND reason='export'")
        .bind(owner),
      context.database
        .prepare("DELETE FROM work_retention_pins WHERE owner=? AND reason='recovery'")
        .bind(owner),
    ]);
    throw error;
  }
}
