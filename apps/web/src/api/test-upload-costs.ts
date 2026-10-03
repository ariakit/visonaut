import { appendFileSync } from "node:fs";
import type { ApiContext, ObjectStorage } from "./context.ts";
import type { measureD1 } from "./test-d1-costs.ts";

interface StorageCost {
  store: string;
  operation: string;
  bytes: number;
}

/** Small local fixtures only; native D1 counts include indexes and triggers. */
export function measureUploadCosts(context: ApiContext, measured: ReturnType<typeof measureD1>) {
  const storage: StorageCost[] = [];
  const wrap = (store: ObjectStorage, name: string): ObjectStorage => ({
    async get(key) {
      const result = await store.get(key);
      storage.push({ store: name, operation: "get", bytes: result?.size ?? 0 });
      return result;
    },
    async put(key, value, options) {
      const bytes =
        typeof value === "string" ? new TextEncoder().encode(value).length : value.byteLength;
      const result = await store.put(key, value, options);
      storage.push({ store: name, operation: "put", bytes });
      return result;
    },
    async head(key) {
      const result = await store.head(key);
      storage.push({ store: name, operation: "head", bytes: 0 });
      return result;
    },
    async list(options) {
      const result = await store.list(options);
      storage.push({ store: name, operation: "list", bytes: 0 });
      return result;
    },
    async delete(key) {
      await store.delete(key);
      storage.push({ store: name, operation: "delete", bytes: 0 });
    },
  });
  context.images = wrap(context.images, "images");
  context.quarantine = wrap(context.quarantine, "quarantine");
  return async <T>(label: string, action: () => Promise<T>): Promise<T> => {
    const costOffset = measured.costs.length;
    const storageOffset = storage.length;
    const started = performance.now();
    const result = await action();
    const path = process.env.VISONAUT_UPLOAD_COST_REPORT;
    if (path) {
      const costs = measured.costs.slice(costOffset);
      const totals = costs.reduce(
        (total, cost) => ({
          rows_read: total.rows_read + cost.rows_read,
          rows_written: total.rows_written + cost.rows_written,
        }),
        { rows_read: 0, rows_written: 0 },
      );
      appendFileSync(
        path,
        `${JSON.stringify({
          label,
          ...totals,
          elapsedMs: Math.round(performance.now() - started),
          loadedResultBytes: new TextEncoder().encode(JSON.stringify(result) ?? "null").length,
          storage: storage.slice(storageOffset),
          costs,
        })}\n`,
      );
    }
    return result;
  };
}
