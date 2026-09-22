import { createHash } from "node:crypto";
import type { Database } from "@visonaut/service";
import type { ObjectStore, OperationsBudget } from "./types.ts";

export function validateBudget(budget: OperationsBudget) {
  for (const value of Object.values(budget)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error("Operations budgets must be positive safe integers.");
    }
  }
  if (budget.objectsPerStep > 1000 || budget.tasksPerStep > 1000) {
    throw new Error("Operations pages cannot exceed 1000 entries.");
  }
}

export async function recordEvent(
  database: Database,
  input: { kind: string; subject: string; code: string; now: number },
) {
  const id = `${input.kind}:${input.subject}:${input.code}`;
  await database
    .prepare(`INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,
    occurrences=operations_events.occurrences+1,resolved_at=NULL`)
    .bind(id, input.kind, input.subject, input.code, input.now, input.now)
    .run();
}

export async function resolveEvents(
  database: Database,
  kind: string,
  subject: string,
  now: number,
) {
  await database
    .prepare(
      "UPDATE operations_events SET resolved_at=? WHERE kind=? AND subject_id=? AND resolved_at IS NULL",
    )
    .bind(now, kind, subject)
    .run();
}

export async function digestStream(stream: ReadableStream<Uint8Array>, maximum: number) {
  const hash = createHash("sha256");
  const reader = stream.getReader();
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        throw new Error("Object exceeds the configured operations limit.");
      }
      hash.update(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return { digest: hash.digest("hex"), bytes };
}

interface CopyObjectParams {
  source: ObjectStore;
  destination: ObjectStore;
  sourceKey: string;
  destinationKey: string;
  maximum: number;
  expectedDigest?: string;
  expectedBytes?: number;
}

/** R2 accepts a transformed stream only when its exact length is restored. */
export async function putKnownLength(
  store: ObjectStore,
  key: string,
  body: ReadableStream<Uint8Array>,
  bytes: number,
  options?: Parameters<ObjectStore["put"]>[2],
) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    await body.cancel();
    throw new Error("Object length must be a nonnegative safe integer.");
  }
  const fixed = new FixedLengthStream(bytes);
  const controller = new AbortController();
  const transfer = body.pipeTo(fixed.writable, { signal: controller.signal });
  // A failed sink may settle before the transfer, so observe both promises immediately.
  void transfer.catch(() => {});
  try {
    const saved = await store.put(key, fixed.readable, options);
    if (saved === null) throw new Error("Object changed during its conditional copy.");
    await transfer;
  } finally {
    controller.abort();
    // Cancel the output before awaiting transfer: an early-rejecting sink may
    // leave a native FixedLengthStream write waiting for its first reader.
    if (!fixed.readable.locked) await fixed.readable.cancel().catch(() => {});
    await transfer.catch(() => {});
  }
}

/** Immutable objects are verified on both sides; an existing destination is not trusted by key alone. */
export async function copyVerifiedObject(params: CopyObjectParams) {
  const source = await params.source.get(params.sourceKey);
  if (
    !source ||
    source.size > params.maximum ||
    (params.expectedBytes !== undefined && source.size !== params.expectedBytes)
  ) {
    await source?.body.cancel();
    throw new Error("Required source object is missing or has an invalid size.");
  }
  const hash = createHash("sha256");
  let bytes = 0;
  const verifying = source.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > params.maximum)
          throw new Error("Object exceeds the configured operations limit.");
        hash.update(chunk);
        controller.enqueue(chunk);
      },
    }),
  );
  // There is one consumer: conditional writes cannot leave a tee branch buffering.
  try {
    const existing = await params.destination.get(params.destinationKey);
    if (existing) {
      await existing.body.cancel();
      await digestStream(verifying, params.maximum);
    } else {
      await putKnownLength(params.destination, params.destinationKey, verifying, source.size, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: {
          contentType: source.httpMetadata?.contentType ?? "application/octet-stream",
        },
        customMetadata: source.customMetadata,
      });
    }
  } finally {
    if (!verifying.locked) await verifying.cancel().catch(() => {});
  }
  const verified = { bytes, digest: hash.digest("hex") };
  if (
    verified.bytes !== source.size ||
    (params.expectedDigest && verified.digest !== params.expectedDigest)
  ) {
    throw new Error("Source object digest or length does not match its record.");
  }
  const stored = await params.destination.get(params.destinationKey);
  if (!stored || stored.size !== verified.bytes) {
    await stored?.body.cancel();
    throw new Error("Destination object was not stored in full.");
  }
  const confirmed = await digestStream(stored.body, params.maximum);
  if (confirmed.digest !== verified.digest || confirmed.bytes !== verified.bytes) {
    throw new Error("Destination object failed integrity verification.");
  }
  return {
    ...confirmed,
    contentType: source.httpMetadata?.contentType ?? "application/octet-stream",
  };
}

export function safeKey(key: string) {
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((part) => !part || part === "." || part === "..") ||
    new TextEncoder().encode(key).length > 900
  ) {
    throw new Error("Object key is outside the supported private namespace.");
  }
  return key;
}

/** All started work settles before an error escapes and its durable lease can be released. */
export async function mapConcurrent<T, U>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<U>,
) {
  const results: U[] = [];
  let cursor = 0;
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        const value = values[index];
        if (value === undefined) throw new Error("Missing concurrent operation input.");
        results[index] = await operation(value);
      }
    }),
  );
  for (const worker of workers) {
    if (worker.status === "rejected") throw worker.reason;
  }
  return results;
}
