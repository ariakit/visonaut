// The live heap of one Submit in local workerd, at the capture limit. The test
// runs the real Submit validation and the real materialization of a run in
// pages, against a reference in pages, with 4 changed captures. A
// measurement can give another count of changed captures.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { digestJson } from "@visonaut/protocol";
import { afterAll, expect, it } from "vitest";
import { apiLimitDefaults } from "../../src/runtime-defaults.ts";
import { bundleWorker, inspector } from "./heap.ts";

// The test of CI uses the capture limit of today. A measurement gives other
// counts, for example `SUBMIT_HEAP_CAPTURES=25000,50000`.
const counts = process.env.SUBMIT_HEAP_CAPTURES
  ? process.env.SUBMIT_HEAP_CAPTURES.split(",").map(Number)
  : [apiLimitDefaults.maximumCaptures];
// The count of changed captures of each run, for example
// `SUBMIT_HEAP_CHANGED=20000` for a run where each capture changed.
const changedCount = Number(process.env.SUBMIT_HEAP_CHANGED ?? 4);
// The rules of the live heap of one Submit: at most this many bytes above the
// heap of the Worker before the Submit. A run where each capture changed (a
// mass change) has its own rule, one half of the 128 MB of an isolate.
const fewChangedRuleBytes = 16 * 1024 * 1024;
const massChangeRuleBytes = 64 * 1024 * 1024;

const worker = await bundleWorker(fileURLToPath(new URL("./submit-worker.ts", import.meta.url)));
afterAll(() => worker[Symbol.asyncDispose]());
process.env.VISONAUT_SUBMIT_WORKER = worker.path;
// The module makes its runtime with the Worker above when it loads.
const owned = await import("../../src/api/test-workflow-owned.ts");

// One small request, so that the isolate reads a message of the inspector.
const wake = async () => (await owned.runtime.dispatchFetch("http://probe/held")).arrayBuffer();

interface Held {
  status: number;
  comparisonId?: string | null;
  message?: string;
}

/**
 * Send one request to the Worker, and read the live heap at each hold point
 * of it. The result has the largest live heap above the heap before it.
 */
async function measure(path: string, body: unknown) {
  using client = await inspector((await owned.runtime.getInspectorURL()).port, wake);
  const before = await client.live();
  let ended = false;
  const request = owned.runtime
    .dispatchFetch(`http://probe${path}`, { method: "POST", body: JSON.stringify(body) })
    .then(async (response) => (await response.json()) as Held)
    .finally(() => {
      ended = true;
    });
  let largest = before.usedSize;
  let holds = 0;
  while (!ended) {
    const state = (await (await owned.runtime.dispatchFetch("http://probe/held")).json()) as {
      held: boolean;
    };
    if (!state.held) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      continue;
    }
    largest = Math.max(largest, (await client.live()).usedSize);
    holds++;
    await (await owned.runtime.dispatchFetch("http://probe/release", { method: "POST" })).json();
  }
  const result = await request;
  const after = await client.live();
  return {
    result,
    held: largest - before.usedSize,
    holds,
    before: before.usedSize,
    after: after.usedSize,
  };
}

for (const captureCount of counts) {
  it(`holds less than the heap rule in one Submit of ${captureCount} captures`, async () => {
    const ruleBytes = changedCount >= captureCount ? massChangeRuleBytes : fewChangedRuleBytes;
    const test = await owned.fixture();
    const source = test.manifest.captures[0];
    if (!source) throw new Error("Expected a source capture.");
    test.context.configuration.limits.maximumCaptures = captureCount;
    test.context.configuration.limits.maximumManifestBytes = 16 * 1024 * 1024;
    const names = [
      ...owned.changedNames,
      ...Array.from(
        { length: captureCount - owned.changedNames.length },
        (_, index) => `same-${String(index).padStart(6, "0")}`,
      ),
    ];
    test.manifest.captures = names.map((name, ordinal) => ({
      ...structuredClone(source),
      itemKey: `dialog/${name}`,
      name: `Dialog ${name}`,
      ordinal,
    }));
    // Each capture has its own image, so each check across the pages keeps one
    // value for each capture, as in a real suite.
    await owned.acceptedManifestPagesReference(test, true);
    const referenceDigests = new Map(
      test.manifest.captures.map((capture) => [capture.itemKey, capture.image.digest]),
    );
    for (const candidate of test.manifest.captures.slice(0, changedCount)) {
      candidate.image = {
        ...candidate.image,
        digest: owned.profiledImage.digest,
        bytes: owned.profiledPng.byteLength,
      };
    }
    const session = await owned.localSession(test);
    const results = test.manifest.localComparison?.captures ?? [];
    for (const result of results) {
      Object.assign(result, {
        referenceDigest: referenceDigests.get(result.itemKey),
        outcome: "unchanged",
        changedPixels: 0,
        ratio: 0,
      });
    }
    for (const result of results.slice(0, changedCount)) {
      result.outcome = "changed";
      result.changedPixels = 1;
      result.ratio = 1 / (owned.image.width * owned.image.height);
      result.mask = {
        digest: owned.image.digest,
        bytes: owned.png.byteLength,
        width: owned.image.width,
        height: owned.image.height,
        mediaType: "image/png",
        path: `images/mask-${result.itemKey.slice("dialog/".length)}.png`,
      };
    }
    const { pages, index } = await owned.runPages(test, session.reference);
    const declared = await owned.declarePages(test, pages);
    for (const upload of declared.flatMap((page) => page.uploads)) {
      await owned.uploadImage(
        test,
        upload.ticket,
        upload.imageDigest === owned.image.digest ? owned.png : owned.profiledPng,
      );
    }
    const body = {
      configuration: test.context.configuration,
      githubResponses: Object.fromEntries(test.githubResponses),
      runId: test.runId,
    };
    const stage = await measure("/stage", { ...body, capability: test.capability, index });
    expect(stage.result).toEqual({ status: 202 });
    await owned.terminalGitHub(test, await digestJson(index));
    const materialize = await measure("/materialize", {
      ...body,
      githubResponses: Object.fromEntries(test.githubResponses),
    });
    expect(materialize.result).toMatchObject({ status: 200, comparisonId: expect.any(String) });
    const largest = Math.max(stage.held, materialize.held);
    const measurement = {
      captures: captureCount,
      changed: changedCount,
      ruleBytes,
      largest,
      bytesForEachCapture: Math.ceil(largest / captureCount),
      stage: { ...stage, result: undefined },
      materialize: { ...materialize, result: undefined },
    };
    // A measurement names a file for its results, one JSON line for each count.
    if (process.env.SUBMIT_HEAP_OUT) {
      appendFileSync(process.env.SUBMIT_HEAP_OUT, `${JSON.stringify(measurement)}\n`);
    }
    expect(stage.holds).toBeGreaterThan(0);
    expect(materialize.holds).toBeGreaterThan(0);
    expect(largest).toBeLessThan(ruleBytes);
  }, 900_000);
}
