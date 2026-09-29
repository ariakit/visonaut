import { expect, it, vi } from "vitest";
import { TestDatabase } from "../operations/test-fixtures.ts";
import { publicImage } from "./images.ts";
import type { ObjectStorage } from "./context.ts";

const imageId = "a".repeat(64);
const imageDigest = "b".repeat(64);

function fixture() {
  const database = new TestDatabase();
  database.connection.exec("PRAGMA foreign_keys=OFF");
  database.connection
    .prepare(
      "INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height,bytes_present) VALUES(?,'run',?,'original','image/png',3,1,1,1)",
    )
    .run(imageId, imageDigest);
  const bytes = new Uint8Array([1, 2, 3]);
  const get = vi.fn<ObjectStorage["get"]>(async () => ({
    size: bytes.length,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    arrayBuffer: vi.fn(async () => {
      throw new Error("Images must stream.");
    }),
  }));
  const head = vi.fn<ObjectStorage["head"]>(async () => ({ size: bytes.length, checksums: {} }));
  return {
    database,
    bytes,
    images: { get, head },
    configuration: { limits: { maximumImageBytes: 10 } },
  };
}

it("streams bytes and delegates cancellation without buffering the object", async () => {
  const context = fixture();
  try {
    const response = await publicImage(
      new Request(`https://visonaut.test/images/${imageId}`),
      context,
      imageId,
    );
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("etag")).toBe(`"${imageDigest}"`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(context.bytes);
    expect(context.images.get).toHaveBeenCalledTimes(1);
    expect(context.images.head).not.toHaveBeenCalled();
    const cancel = vi.fn();
    context.images.get.mockImplementation(async () => ({
      size: 3,
      body: new ReadableStream({ cancel }),
      arrayBuffer: vi.fn(),
    }));
    const canceled = await publicImage(
      new Request(`https://visonaut.test/images/${imageId}`),
      context,
      imageId,
    );
    await canceled.body?.cancel();
    expect(cancel).toHaveBeenCalledTimes(1);
  } finally {
    context.database[Symbol.dispose]();
  }
});

it("HEAD and matching ETag use metadata, reject absent or oversized bytes, and never open a body", async () => {
  const context = fixture();
  try {
    const url = `https://visonaut.test/images/${imageId}`;
    const head = await publicImage(new Request(url, { method: "HEAD" }), context, imageId);
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("3");
    const cached = await publicImage(
      new Request(url, { headers: { "if-none-match": `"${imageDigest}"` } }),
      context,
      imageId,
    );
    expect(cached.status).toBe(304);
    expect(cached.headers.has("content-length")).toBe(false);
    context.images.head.mockResolvedValueOnce({ size: 11, checksums: {} });
    expect((await publicImage(new Request(url, { method: "HEAD" }), context, imageId)).status).toBe(
      404,
    );
    context.images.head.mockImplementationOnce(async () => null);
    expect(
      (
        await publicImage(
          new Request(url, { headers: { "if-none-match": `"${imageDigest}"` } }),
          context,
          imageId,
        )
      ).status,
    ).toBe(404);
    expect(context.images.get).not.toHaveBeenCalled();
  } finally {
    context.database[Symbol.dispose]();
  }
});

it("cancels rejected oversized streams and preserves missing-image privacy", async () => {
  const context = fixture();
  try {
    const cancel = vi.fn();
    context.images.get.mockImplementation(async () => ({
      size: 11,
      body: new ReadableStream({ cancel }),
      arrayBuffer: vi.fn(),
    }));
    const missing = await publicImage(
      new Request(`https://visonaut.test/images/${imageId}`),
      context,
      imageId,
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(cancel).toHaveBeenCalledTimes(1);
    const calls = context.images.get.mock.calls.length;
    expect(
      (
        await publicImage(
          new Request(`https://visonaut.test/images/${imageId}?signature=invalid`),
          context,
          imageId,
        )
      ).status,
    ).toBe(404);
    expect(context.images.get).toHaveBeenCalledTimes(calls);
  } finally {
    context.database[Symbol.dispose]();
  }
});

it("reads only the immutable original key and fails closed until legacy copies are converted", async () => {
  const context = fixture();
  try {
    context.database.connection
      .prepare(
        "INSERT INTO visonaut_snapshots(id,project_id,run_id,comparison_id,tested_sha,state,prefix,created_at,storage_mode) VALUES('source','project','run','comparison','sha','accepted','snapshot/',0,'source')",
      )
      .run();
    context.database.connection
      .prepare(
        "INSERT INTO visonaut_snapshot_images(snapshot_id,capture_id,image_id,object_key,digest,copied) VALUES('source','capture',?,'retained-original',?,1)",
      )
      .run(imageId, imageDigest);
    context.images.head.mockImplementation(async (key) =>
      key === "retained-original" ? { size: 3, checksums: {} } : null,
    );
    const request = new Request(`https://visonaut.test/images/${imageId}`, {
      headers: { "if-none-match": `"${imageDigest}"` },
    });
    const queries = vi.spyOn(context.database, "prepare");
    expect((await publicImage(request, context, imageId)).status).toBe(404);
    expect(context.images.head.mock.calls.map(([key]) => key)).toEqual(["original"]);
    expect(queries).toHaveBeenCalledTimes(1);
    expect(queries.mock.calls[0]?.[0]).not.toContain("snapshot");
    expect(context.images.get).not.toHaveBeenCalled();
    context.database.connection
      .prepare("UPDATE visonaut_snapshots SET storage_mode='protected' WHERE id='source'")
      .run();
    expect((await publicImage(request, context, imageId)).status).toBe(404);
  } finally {
    context.database[Symbol.dispose]();
  }
});

it("passes stream errors to the client without a second object allocation", async () => {
  const context = fixture();
  try {
    context.images.get.mockImplementation(async () => ({
      size: 3,
      body: new ReadableStream({
        start(controller) {
          controller.error(new Error("Storage stream failed."));
        },
      }),
      arrayBuffer: vi.fn(),
    }));
    const response = await publicImage(
      new Request(`https://visonaut.test/images/${imageId}`),
      context,
      imageId,
    );
    await expect(response.arrayBuffer()).rejects.toThrow("Storage stream failed");
    expect(context.images.get).toHaveBeenCalledTimes(1);
  } finally {
    context.database[Symbol.dispose]();
  }
});
