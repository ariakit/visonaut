import type { OperationsContext } from "./types.ts";

export async function expireExports(context: OperationsContext) {
  const rows = await context.database
    .prepare(
      "SELECT id,run_id FROM operations_exports WHERE expires_at<=? AND COALESCE(active_until,0)<=? AND (state!='expired' OR EXISTS(SELECT 1 FROM work_retention_pins WHERE owner='export:'||operations_exports.id)) LIMIT ?",
    )
    .bind(context.now(), context.now(), context.budget.tasksPerStep)
    .all<{ id: string; run_id: string }>();
  for (const row of rows.results ?? []) {
    const claimed = await context.database
      .prepare(
        "UPDATE operations_exports SET state='failed' WHERE id=? AND expires_at<=? AND COALESCE(active_until,0)<=? RETURNING id",
      )
      .bind(row.id, context.now(), context.now())
      .first();
    if (!claimed) continue;
    const pages = await context.images.list({
      prefix: `exports/${row.id}/`,
      limit: Math.min(1000, context.budget.objectsPerStep),
    });
    if (pages.objects.length) {
      await context.images.delete(pages.objects.map((page) => page.key));
    }
    if (pages.truncated) continue;
    await context.images.delete(`exports/${row.id}.json`);
    await context.database
      .prepare("DELETE FROM visonaut_pins WHERE owner_id=? AND reason='export'")
      .bind(`export:${row.id}`)
      .run();
    await context.database
      .prepare("DELETE FROM work_retention_pins WHERE owner=? AND reason='recovery'")
      .bind(`export:${row.id}`)
      .run();
    await context.database
      .prepare("UPDATE operations_exports SET state='expired' WHERE id=?")
      .bind(row.id)
      .run();
  }
  return rows.results?.length ?? 0;
}
