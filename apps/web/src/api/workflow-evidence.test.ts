import type { CapturePage, CaptureRow } from "@visonaut/protocol";
import { describe, expect, it } from "vitest";
import { runPageImages } from "./workflow-evidence.ts";

function row(itemKey: string, digest: string, bytes: number, result: CaptureRow[11]): CaptureRow {
  return [itemKey, null, 0, 0, 0, null, 0, digest, bytes, 10, 10, result];
}

function page(rows: CaptureRow[]): CapturePage {
  return {
    schemaVersion: "1.0",
    variants: [{ key: "light", browser: "chromium" }],
    profiles: [],
    tests: [],
    comparisons: [{ threshold: 0.2 }],
    rows,
  };
}

describe("the images of the pages of a run", () => {
  it("counts the bytes of each distinct row image one time, with the size of its last row", () => {
    const images = runPageImages();
    images.add(page([row("a", "1".repeat(64), 100, 0), row("b", "2".repeat(64), 200, 1)]));
    // The second page has a row with the digest of a row of the first page.
    images.add(page([row("c", "1".repeat(64), 150, 0), row("d", "3".repeat(64), 300, 0)]));
    const { uploads, originals, declaredBytes, captureCount } = images.result();
    expect(captureCount).toBe(4);
    expect(declaredBytes).toBe(150 + 200 + 300);
    expect([...uploads.keys()]).toEqual(["2".repeat(64)]);
    expect([...originals]).toEqual(["2".repeat(64)]);
  });
});
