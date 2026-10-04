import { IncompleteError, type CaptureInventoryPointer, type Database } from "@visonaut/service";
import { readCaptureInventory, type InventoryStore } from "./capture-inventory.ts";

interface InventoryRecord {
  inventory_key?: string | null;
  inventory_digest?: string | null;
  inventory_bytes?: number | null;
  capture_count?: number | null;
}

interface InventoryContext {
  database: Database;
  images: InventoryStore;
}

export function inventoryPointer(record: InventoryRecord): CaptureInventoryPointer | null {
  if (record.inventory_key == null) return null;
  if (
    !record.inventory_key ||
    !record.inventory_digest ||
    record.inventory_bytes == null ||
    record.capture_count == null
  ) {
    throw new IncompleteError("The immutable capture inventory header is incomplete.");
  }
  return {
    objectKey: record.inventory_key,
    digest: record.inventory_digest,
    bytes: record.inventory_bytes,
    captureCount: record.capture_count,
  };
}

export async function readRunInventory(
  context: InventoryContext,
  runId: string,
  maximumBytes?: number,
) {
  const run = await context.database
    .prepare(`SELECT id,project_id,tested_sha,inventory_key,inventory_digest,inventory_bytes,
      capture_count FROM visonaut_runs WHERE id=?`)
    .bind(runId)
    .first<InventoryRecord & { id: string; project_id: string; tested_sha: string }>();
  if (!run) {
    throw new IncompleteError("The inventory run does not exist.");
  }
  const pointer = inventoryPointer(run);
  if (!pointer) return null;
  const inventory = await readCaptureInventory(context.images, pointer, maximumBytes);
  if (
    inventory.runId !== run.id ||
    inventory.projectId !== run.project_id ||
    inventory.testedSha !== run.tested_sha
  ) {
    throw new IncompleteError("The immutable inventory belongs to a different run.");
  }
  return inventory;
}

export async function readSnapshotInventory(
  context: InventoryContext,
  snapshotId: string,
  maximumBytes?: number,
) {
  const snapshot = await context.database
    .prepare(`SELECT run_id,project_id,tested_sha,inventory_key,inventory_digest,inventory_bytes,
      capture_count,inventory_verified FROM visonaut_snapshots WHERE id=?`)
    .bind(snapshotId)
    .first<
      InventoryRecord & {
        run_id: string;
        project_id: string;
        tested_sha: string;
        inventory_verified: number;
      }
    >();
  if (!snapshot) {
    throw new IncompleteError("The inventory baseline does not exist.");
  }
  const pointer = inventoryPointer(snapshot);
  if (!pointer) return null;
  if (snapshot.inventory_verified !== 1) {
    throw new IncompleteError("The baseline inventory has not been verified.");
  }
  const inventory = await readCaptureInventory(context.images, pointer, maximumBytes);
  if (
    inventory.runId !== snapshot.run_id ||
    inventory.projectId !== snapshot.project_id ||
    inventory.testedSha !== snapshot.tested_sha
  ) {
    throw new IncompleteError("The immutable inventory belongs to a different baseline.");
  }
  return inventory;
}
