import { describe, expect, it } from "vitest";
import { parseHistoryManifest, parseHistoryPage } from "./history-format.ts";

function manifest() {
  return {
    version: 1,
    runId: "run",
    generation: "generation",
    pages: [
      {
        key: "history/run/generation/000000.json",
        digest: "a".repeat(64),
        bytes: 100,
        section: "run",
        rows: 1,
        firstCursor: "run",
        lastCursor: "run",
      },
    ],
    counts: { run: 1 },
  };
}
const input = { runId: "run", generation: "generation", maximumObjectBytes: 1024 };

describe("private history archive format", () => {
  it("preserves exact page checksums and section counts at the backup boundary", () => {
    expect(parseHistoryManifest(manifest(), input)).toEqual(manifest());
  });
  it.each([100, 200])("accepts %i rows with an exact declared count", (rows) => {
    const value = manifest();
    const page = value.pages[0];
    if (!page) throw new Error("Missing fixture page.");
    page.rows = rows;
    value.counts.run = rows;
    expect(parseHistoryManifest(value, input).pages[0]?.rows).toBe(rows);
  });
  it.each([
    { key: "runs/run/image" },
    { key: "history/other/generation/000000.json" },
    { key: "history/run/generation/../000000.json" },
    { key: "history/run/generation/000001.json" },
    { digest: "a" },
    { bytes: 1025 },
    { rows: 201 },
    { section: "unsupported" },
  ])("rejects an invalid page identity or bound: %j", (change) => {
    const value = manifest();
    const page = value.pages[0];
    if (!page) throw new Error("Missing fixture page.");
    value.pages[0] = { ...page, ...change };
    expect(() => parseHistoryManifest(value, input)).toThrow();
  });
  it("rejects duplicate page keys and altered row counts", () => {
    const value = manifest();
    const page = value.pages[0];
    if (!page) throw new Error("Missing fixture page.");
    value.pages.push(page);
    expect(() => parseHistoryManifest(value, input)).toThrow("identity");
    expect(() => parseHistoryManifest({ ...manifest(), counts: { run: 2 } }, input)).toThrow(
      "count",
    );
  });
  it("requires each page to match its verified root", () => {
    const root = parseHistoryManifest(manifest(), input);
    const expected = root.pages[0];
    if (!expected) throw new Error("Missing fixture page.");
    const page = {
      version: 1,
      runId: "run",
      generation: "generation",
      section: "run",
      rows: [{ id: "run" }],
    };
    expect(parseHistoryPage(page, root, expected)).toEqual(page);
    expect(() => parseHistoryPage({ ...page, runId: "other" }, root, expected)).toThrow(
      "inconsistent",
    );
    expect(() => parseHistoryPage({ ...page, rows: [] }, root, expected)).toThrow("inconsistent");
    expect(() => parseHistoryPage({ ...page, rows: [null] }, root, expected)).toThrow("object");
  });
});
