// The Worker of the capture limit measurement. It runs the real writer and the
// real complete reader of capture pages in workerd, and stops each Submit at a
// hold point while the measurement reads the heap. It is not a part of the service.
import {
  canonicalJson,
  CAPTURE_PAGE_ROWS,
  identityKey,
  sha256,
  type CapturePage,
  type CaptureProfile,
  type CaptureRow,
  type Variant,
} from "@visonaut/protocol";
import type { ValidatedImage } from "@visonaut/service";
import {
  readCaptureInventory,
  writeCapturePages,
  type CaptureInventory,
  type CaptureInventoryPointer,
  type InventoryStore,
} from "../../src/capture-inventory.ts";
import type { CapturePagesInput } from "../../src/capture-pages.ts";

interface Env {
  IMAGES: InventoryStore;
}

/** Where a Submit stops and holds its values for the measurement. */
type HoldPoint = "put" | "row" | "end";

interface SubmitParams {
  env: Env;
  id: string;
  count: number;
  pointer: CaptureInventoryPointer;
  point: HoldPoint;
}

const profile: CaptureProfile = {
  browser: "chromium",
  browserVersion: "154.0.8037.44",
  locale: "en-US",
  timezone: "UTC",
  osImageDigest: "a".repeat(64),
  fontsDigest: "b".repeat(64),
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
  colorScheme: "light",
  contrast: "no-preference",
  forcedColors: "none",
  animationPolicy: "disabled",
  captureOptions: { animations: "disabled", caret: "hide", scale: "css" },
};
const variants: Variant[] = [
  { key: "chromium-dark", browser: "chromium", colorScheme: "dark" },
  { key: "chromium-light", browser: "chromium", colorScheme: "light" },
];
const profiles = [{ ...profile, colorScheme: "dark" as const }, profile];

// The measurement starts the Submits one after the other. Each Submit stops at
// its hold point and stays there until the release, so that all of them hold
// their values at the same time.
let stopped = 0;
let released = false;
// The canonical JSON of the last capture identity while a Submit reads its
// committed list: the digest of this text is the last step of the last row.
let lastRow: string | null = null;

async function hold() {
  stopped++;
  while (!released) {
    await scheduler.wait(20);
  }
}

// The real reader has no call that the probe can stop at its last row. The
// reader computes the capture ID of each row with a SHA-256 digest, so the
// probe stops at the digest of the last identity.
const digest = crypto.subtle.digest.bind(crypto.subtle);
crypto.subtle.digest = async (algorithm, data) => {
  if (lastRow !== null && data.byteLength === lastRow.length) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    if (new TextDecoder().decode(bytes) === lastRow) {
      lastRow = null;
      await hold();
    }
  }
  return digest(algorithm, data);
};

/**
 * The pages of a run of the form of the Ariakit suite: two variants for each
 * item, one clip rectangle for each capture, and one test for four captures.
 * `changed` captures of each 1,000 have new bytes. Each other capture has the
 * bytes of the reference.
 */
async function runPages(runId: string, count: number, reference: CaptureInventory | null) {
  const references = reference?.captures ?? [];
  const pages: CapturePagesInput["pages"] = [];
  for (let offset = 0; offset < count; offset += CAPTURE_PAGE_ROWS) {
    const rows: CaptureRow[] = [];
    const images: { image: ValidatedImage }[] = [];
    const tests: CapturePage["tests"] = [];
    const usedVariants: Variant[] = [];
    const usedProfiles: CaptureProfile[] = [];
    const end = Math.min(count, offset + CAPTURE_PAGE_ROWS);
    for (let index = offset; index < end; index++) {
      const item = String(Math.floor(index / 2)).padStart(6, "0");
      const side = index % 2;
      const testAt = Math.floor((index - offset) / 4);
      if (testAt === tests.length) {
        tests.push({
          id: `chromium/components/example-${item}/test.ts/renders the example ${item}`,
          file: `components/example-${item}/test.ts`,
          titlePath: ["components", `example-${item}`, `renders the example ${item}`],
          retry: 0,
        });
      }
      const variant = variants[side];
      const shared = profiles[side];
      if (!variant || !shared) {
        throw new Error("The probe lost a variant.");
      }
      let sharedAt = usedVariants.indexOf(variant);
      if (sharedAt < 0) {
        sharedAt = usedVariants.push(variant) - 1;
        usedProfiles.push(shared);
      }
      const kept = references[index]?.image;
      // Four of each 1,000 captures changed, as in a normal pull request.
      const isNew = !kept || index % 250 === 0;
      const digest = isNew
        ? await sha256(new TextEncoder().encode(`${runId}-${index}`))
        : kept.digest;
      const imageId = crypto.randomUUID();
      const image: ValidatedImage = isNew
        ? {
            id: imageId,
            runId,
            digest,
            objectKey: `runs/${runId}/images/${imageId}`,
            contentType: "image/png",
            bytes: 20_000 + (index % 1000),
            width: 640,
            height: 480,
          }
        : kept;
      rows.push([
        `components/example-${item}/preview`,
        `Example ${item} preview`,
        sharedAt,
        testAt,
        sharedAt,
        [0, index, 640, 480],
        0,
        image.digest,
        image.bytes,
        image.width,
        image.height,
        !isNew
          ? 0
          : kept
            ? {
                reference: kept.digest,
                outcome: "changed",
                changedPixels: 10,
                ratio: 0.001,
                sizeChanged: false,
              }
            : 1,
      ]);
      images.push({ image });
    }
    pages.push({
      page: {
        schemaVersion: "1.0",
        variants: usedVariants,
        profiles: usedProfiles,
        tests,
        comparisons: [{ threshold: 0.2 }],
        rows,
      },
      images,
    });
  }
  return pages;
}

function header(runId: string) {
  return {
    projectId: "project",
    runId,
    testedSha: "c".repeat(40),
    referenceSnapshotId: null,
    receipt: null,
  };
}

/** Store the reference of a scenario: a run in pages with no reference of its own. */
async function seed(env: Env, count: number) {
  const pages = await runPages("reference", count, null);
  return writeCapturePages(env.IMAGES, { ...header("reference"), pages });
}

/**
 * A model of one Submit of a run in pages. The service has no such Submit yet.
 * The model has the three steps that need the complete lists: read the
 * complete reference, validate and store the pages of the run, and read the
 * committed list again. The Submit stops at `point` and holds what the real
 * code holds there.
 */
async function submit({ env, id, count, pointer, point }: SubmitParams) {
  const reference = await readCaptureInventory(env.IMAGES, pointer);
  // Materialization finds each reference capture by its identity.
  const references = new Map(reference.captures.map((capture) => [identityKey(capture), capture]));
  const runId = `run-${id}`;
  const pages = await runPages(runId, count, reference);
  let puts = 0;
  const store: InventoryStore = {
    get: (key) => env.IMAGES.get(key),
    async put(key, value, options) {
      // The writer holds each encoded page and the capture list at its first put.
      if (point === "put" && puts++ === 0) {
        await hold();
      }
      return env.IMAGES.put(key, value, options);
    },
  };
  const written = await writeCapturePages(store, { ...header(runId), pages });
  const last = pages.at(-1)?.page.rows.at(-1);
  if (point === "row" && last) {
    lastRow = canonicalJson([last[0], variants[(count - 1) % 2]?.key]);
  }
  const committed = await readCaptureInventory(store, written);
  if (point === "end") {
    await hold();
  }
  return references.size + pages.length + committed.captures.length;
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const count = Number(url.searchParams.get("captures"));
    if (url.pathname === "/seed") {
      return Response.json(await seed(env, count));
    }
    if (url.pathname === "/submit") {
      const point = url.searchParams.get("point");
      if (point !== "put" && point !== "row" && point !== "end") {
        return new Response("Bad hold point", { status: 400 });
      }
      const id = url.searchParams.get("id") ?? "";
      const pointer: CaptureInventoryPointer = await request.json();
      return Response.json({ held: await submit({ env, id, count, pointer, point }) });
    }
    if (url.pathname === "/stopped") {
      return Response.json({ stopped });
    }
    if (url.pathname === "/release") {
      released = true;
      return Response.json({ released });
    }
    return new Response("Not found", { status: 404 });
  },
};
