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

export interface SnapshotInventoryHeader extends CaptureInventoryPointer {
  runId: string;
  projectId: string;
  testedSha: string;
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

/**
 * The capture list of a run, from the run row that the caller has. The
 * function reads no row from D1.
 */
export async function readRunInventory(
  context: Pick<InventoryContext, "images">,
  run: InventoryRecord & { id: string; project_id: string; tested_sha: string },
  maximumBytes?: number,
) {
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

export async function readSnapshotInventoryHeader(
  context: InventoryContext,
  snapshotId: string,
): Promise<SnapshotInventoryHeader | null> {
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
  return {
    ...pointer,
    runId: snapshot.run_id,
    projectId: snapshot.project_id,
    testedSha: snapshot.tested_sha,
  };
}

export async function readSnapshotInventoryBody(
  context: Pick<InventoryContext, "images">,
  header: SnapshotInventoryHeader,
  maximumBytes?: number,
) {
  const inventory = await readCaptureInventory(context.images, header, maximumBytes);
  if (
    inventory.runId !== header.runId ||
    inventory.projectId !== header.projectId ||
    inventory.testedSha !== header.testedSha
  ) {
    throw new IncompleteError("The immutable inventory belongs to a different baseline.");
  }
  return inventory;
}

export async function readSnapshotInventory(
  context: InventoryContext,
  snapshotId: string,
  maximumBytes?: number,
) {
  const header = await readSnapshotInventoryHeader(context, snapshotId);
  if (!header) return null;
  return readSnapshotInventoryBody(context, header, maximumBytes);
}
