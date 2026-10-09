import {
  canonicalJson,
  captureManifestDigest,
  digestEnvironmentProfile,
  digestJson,
  digestRenderingProfile,
  identityKey,
  LOCAL_COMPARISON_CODEC,
  LOCAL_COMPARISON_ENGINE,
  LOCAL_COMPARISON_MODE,
  SCHEMA_VERSION,
  sha256,
  type CaptureProfile,
  type LocalComparisonReceipt,
  type Manifest,
} from "@visonaut/protocol";
import { Service, type Database, type ValidatedImage } from "@visonaut/service";
import {
  writeCaptureInventory,
  type CaptureInventory,
  type InventoryCapture,
} from "../../src/capture-inventory.ts";
import { readSnapshotInventory } from "../../src/inventory-records.ts";
import { promoteBaselines } from "../../src/operations/promotions.ts";
import type { ObjectStore } from "../../src/operations/types.ts";
import { captureProfileReference, storeCaptureProfiles } from "../../src/profiles.ts";
import { operationsBudgetDefaults } from "../../src/runtime-defaults.ts";
import {
  differenceMask,
  encodePng,
  paint,
  type Color,
  type Picture,
  type Rectangle,
} from "./png.ts";

export interface SeedParams {
  database: Database;
  images: ObjectStore;
  quarantine: ObjectStore;
  projectId: string;
  repository: string;
  repositoryId: string;
  origin: string;
}

type Scheme = "light" | "dark";

interface Screenshot {
  itemKey: string;
  scheme: Scheme;
  /** Another revision draws a visibly different component. */
  revision: number;
}

interface SeedRun {
  id: string;
  pullRequest?: { number: number; title: string };
  testedSha: string;
  workflowRunId: string;
  screenshots: Screenshot[];
}

const width = 480;
const height = 300;
const test: Manifest["tests"][number] = {
  id: "components.spec.ts:1:1",
  file: "components.spec.ts",
  titlePath: ["Components"],
  retry: 0,
  status: "passed",
};
const comparison = { threshold: 0.2, maxDiffPixels: 0 };
// The seed has no trusted executor. These digests only fill the required evidence fields.
const executorDigest = "0".repeat(64);
const configurationDigest = "1".repeat(64);
const discoveryInventoryDigest = "2".repeat(64);

const palette: Record<Scheme, { page: Color; surface: Color; accents: Color[] }> = {
  light: {
    page: [246, 247, 249],
    surface: [255, 255, 255],
    accents: [
      [37, 99, 235],
      [220, 38, 38],
    ],
  },
  dark: {
    page: [17, 24, 39],
    surface: [31, 41, 55],
    accents: [
      [96, 165, 250],
      [248, 113, 113],
    ],
  },
};

const components: Record<string, { name: string; shape: Omit<Rectangle, "color"> }> = {
  button: { name: "Button", shape: { x: 170, y: 125, width: 140, height: 50 } },
  dialog: { name: "Dialog", shape: { x: 90, y: 60, width: 300, height: 180 } },
  menu: { name: "Menu", shape: { x: 60, y: 40, width: 160, height: 220 } },
  tooltip: { name: "Tooltip", shape: { x: 190, y: 90, width: 100, height: 36 } },
};

function component(itemKey: string) {
  const found = Object.hasOwn(components, itemKey) ? components[itemKey] : undefined;
  if (!found) throw new Error(`The seed has no component "${itemKey}".`);
  return found;
}

function draw({ itemKey, scheme, revision }: Screenshot) {
  const { shape } = component(itemKey);
  const colors = palette[scheme];
  const accent = colors.accents[revision % colors.accents.length];
  if (!accent) throw new Error("The seed palette has no accent color.");
  return paint({
    width,
    height,
    background: colors.page,
    rectangles: [
      { ...shape, color: colors.surface },
      // A revision changes the color and the height of this bar.
      { ...shape, height: 12 + revision * 8, color: accent },
    ],
  });
}

/** Both color schemes of each component, at one revision or at one revision for each scheme. */
function screenshots(revisions: Record<string, number | [light: number, dark: number]>) {
  return Object.entries(revisions).flatMap(([itemKey, revision]): Screenshot[] => {
    const [light, dark] = typeof revision === "number" ? [revision, revision] : revision;
    return [
      { itemKey, scheme: "light", revision: light },
      { itemKey, scheme: "dark", revision: dark },
    ];
  });
}

const mainSha = "1".repeat(40);

/** One accepted main baseline, then two pull requests that wait for review. */
const seedRuns: readonly SeedRun[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    testedSha: mainSha,
    workflowRunId: "1001",
    screenshots: screenshots({ button: 0, dialog: 0, menu: 0 }),
  },
  {
    id: "00000000-0000-4000-8000-000000000012",
    pullRequest: { number: 12, title: "Change the button accent" },
    testedSha: "2".repeat(40),
    workflowRunId: "1002",
    screenshots: screenshots({ button: 1, dialog: 0, menu: 0 }),
  },
  {
    id: "00000000-0000-4000-8000-000000000015",
    pullRequest: { number: 15, title: "Add a tooltip and change the light dialog" },
    testedSha: "3".repeat(40),
    workflowRunId: "1003",
    screenshots: screenshots({ button: 0, dialog: [1, 0], menu: 0, tooltip: 0 }),
  },
];

function profile(scheme: Scheme): CaptureProfile {
  return {
    browser: "chromium",
    browserVersion: "154.0.8037.44",
    osImageDigest: "a".repeat(64),
    fontsDigest: "b".repeat(64),
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezone: "UTC",
    reducedMotion: "reduce",
    colorScheme: scheme,
    contrast: "no-preference",
    forcedColors: "none",
    animationPolicy: "disabled",
    captureOptions: { animations: "disabled", caret: "hide", scale: "css" },
  };
}

function identity({ itemKey, scheme }: Screenshot) {
  return { itemKey, variantKey: `react-${scheme}` };
}

interface StoreImageParams {
  service: Service;
  images: ObjectStore;
  runId: string;
  picture: Picture;
  /** The images that this run stored before, by digest. Equal bytes are one image. */
  stored: Map<string, ValidatedImage>;
  role?: "mask";
}

async function storeImage({ service, images, runId, picture, stored, role }: StoreImageParams) {
  const bytes = encodePng(picture);
  const digest = await sha256(bytes);
  const existing = stored.get(digest);
  if (existing) return existing;
  const id = crypto.randomUUID();
  const image: ValidatedImage = {
    id,
    runId,
    digest,
    // The image key form of the upload route.
    objectKey: `runs/${runId}/images/${id}`,
    contentType: "image/png",
    bytes: bytes.byteLength,
    width: picture.width,
    height: picture.height,
    ...(role ? { role } : {}),
  };
  await images.put(image.objectKey, bytes, { httpMetadata: { contentType: image.contentType } });
  await service.registerImage(image);
  stored.set(digest, image);
  return image;
}

interface SubmitParams extends SeedParams {
  service: Service;
  run: SeedRun;
  /** The pixels of each stored original, by image digest, for the difference masks. */
  pictures: Map<string, Picture>;
  now: number;
}

/** Draw each screenshot of a run and describe it as the Submit manifest does. */
async function drawRun(run: SeedRun) {
  const profiles = await Promise.all(
    (["light", "dark"] as const).map(async (scheme) => ({
      scheme,
      digest: await digestJson(profile(scheme)),
      profile: profile(scheme),
    })),
  );
  const drawn = await Promise.all(
    run.screenshots.map(async (screenshot, ordinal) => {
      const picture = draw(screenshot);
      const bytes = encodePng(picture);
      const record = profiles.find((entry) => entry.scheme === screenshot.scheme);
      if (!record) throw new Error("The seed has no profile for the color scheme.");
      return {
        ...identity(screenshot),
        name: component(screenshot.itemKey).name,
        ordinal,
        picture,
        profile: record,
        variant: {
          key: identity(screenshot).variantKey,
          browser: "chromium" as const,
          framework: "react",
          colorScheme: screenshot.scheme,
        },
        image: {
          digest: await sha256(bytes),
          mediaType: "image/png" as const,
          bytes: bytes.byteLength,
          width,
          height,
          path: `images/${ordinal}.png`,
        },
      };
    }),
  );
  return { profiles: profiles.map(({ digest, profile }) => ({ digest, profile })), drawn };
}

type DrawnRun = Awaited<ReturnType<typeof drawRun>>;
type DrawnCapture = DrawnRun["drawn"][number];

interface SubmitManifestParams extends DrawnRun {
  run: SeedRun;
  repository: string;
  repositoryId: string;
  planDigest: string;
}

function submitManifest({
  run,
  repository,
  repositoryId,
  planDigest,
  profiles,
  drawn,
}: SubmitManifestParams): Manifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    producer: {
      name: "visonaut",
      version: "0.5.4",
      nodeVersion: "24.18.0",
      playwrightVersion: "1.63.0",
    },
    run: {
      repository,
      repositoryId,
      workflowRunId: run.workflowRunId,
      workflowAttempt: 1,
      testedSha: run.testedSha,
      planDigest,
    },
    shard: { key: "combined", jobId: `${run.workflowRunId}1`, sourceAttempt: 1 },
    profiles,
    tests: [test],
    captures: drawn.map(({ itemKey, name, variant, ordinal, profile, image }) => ({
      itemKey,
      name,
      variant,
      ordinal,
      testId: test.id,
      testRetry: 0,
      profileDigest: profile.digest,
      comparison,
      image,
    })),
    discovery: { executorDigest, configurationDigest, inventoryDigest: discoveryInventoryDigest },
  };
}

interface CompareCaptureParams extends Pick<SubmitParams, "service" | "images" | "pictures"> {
  runId: string;
  capture: DrawnCapture;
  /** The baseline capture with the same identity. A new capture has none. */
  reference: InventoryCapture | undefined;
  /** The images that this run stored before, by digest. */
  stored: Map<string, ValidatedImage>;
}

/**
 * Compare one capture with its baseline capture, as the Submit job does, and
 * store what production stores: nothing for an unchanged capture, and the
 * candidate with its difference mask for a changed one.
 */
async function compareCapture({
  service,
  images,
  pictures,
  runId,
  capture,
  reference,
  stored,
}: CompareCaptureParams) {
  const { picture, image, profile: record } = capture;
  const unchanged = reference?.image.digest === image.digest;
  const referencePicture = reference ? pictures.get(reference.image.digest) : undefined;
  const difference =
    referencePicture && !unchanged ? differenceMask(referencePicture, picture) : undefined;
  // A new capture has no reference. The CLI counts each of its pixels as changed.
  const changedPixels = unchanged ? 0 : (difference?.changedPixels ?? width * height);
  const store = { service, images, stored, runId };
  const mask = difference
    ? await storeImage({ ...store, picture: difference.mask, role: "mask" })
    : undefined;
  const representative =
    unchanged && reference ? reference.image : await storeImage({ ...store, picture });
  pictures.set(image.digest, picture);
  const result: LocalComparisonReceipt["captures"][number] = {
    itemKey: capture.itemKey,
    variantKey: capture.variantKey,
    candidateDigest: image.digest,
    referenceDigest: reference?.image.digest ?? null,
    outcome: unchanged ? "unchanged" : "changed",
    changedPixels,
    ratio: changedPixels / (width * height),
    sizeChanged: false,
    ...(mask
      ? {
          mask: {
            digest: mask.digest,
            mediaType: mask.contentType,
            bytes: mask.bytes,
            width,
            height,
            path: `local-masks/${mask.digest}.png`,
          },
        }
      : {}),
  };
  const inventoryCapture: InventoryCapture = {
    id: `${runId}:${await digestJson([capture.itemKey, capture.variantKey])}`,
    itemKey: capture.itemKey,
    variantKey: capture.variantKey,
    ordinal: capture.ordinal,
    imageId: representative.id,
    image: representative,
    profileDigest: record.digest,
    renderingProfileDigest: await digestRenderingProfile(record.profile),
    environmentProfileDigest: await digestEnvironmentProfile(record.profile),
    testId: test.id,
    testRetry: 0,
    metadata: {
      name: capture.name,
      variant: capture.variant,
      profile: captureProfileReference(record.digest),
      source: test,
      localMode: LOCAL_COMPARISON_MODE,
      observedImage: image,
      candidateStored: !unchanged,
      comparison,
      comparisonDigest: await digestJson(comparison),
      localResult: {
        outcome: result.outcome,
        changedPixels,
        ratio: result.ratio,
        engineVersion: LOCAL_COMPARISON_ENGINE,
        codecVersion: LOCAL_COMPARISON_CODEC,
        maskExpected: !!mask,
        ...(mask ? { maskImageId: mask.id } : {}),
      },
    },
  };
  return { result, inventoryCapture };
}

/**
 * Write one run in the form of a trusted local Submit, as `materializeWorkflowRun`
 * does: the complete inventory in R2, and images and rows only for the captures
 * that differ from the baseline.
 */
async function submit({ service, database, images, run, pictures, now, ...project }: SubmitParams) {
  const { snapshot_id: snapshotId, baseline_revision: baselineRevision } = await service.project(
    project.projectId,
  );
  const baseline = snapshotId
    ? await readSnapshotInventory({ database, images }, snapshotId)
    : null;
  if (snapshotId && !baseline) throw new Error("The seed baseline has no inventory.");
  const references = new Map(
    (baseline?.captures ?? []).map((capture) => [identityKey(capture), capture]),
  );
  const { profiles, drawn } = await drawRun(run);
  const planDigest = await digestJson({ seed: run.id });
  const manifest = submitManifest({ ...project, run, planDigest, profiles, drawn });
  const receipt: LocalComparisonReceipt = {
    mode: LOCAL_COMPARISON_MODE,
    engineVersion: LOCAL_COMPARISON_ENGINE,
    codecVersion: LOCAL_COMPARISON_CODEC,
    reference: {
      manifestDigest: await captureManifestDigest(manifest),
      snapshotId,
      baselineRevision,
      // Only the Submit route verifies this digest.
      inventoryDigest: await digestJson([...references.keys()]),
      captureCount: references.size,
    },
    captures: [],
    removals: [],
  };
  await service.reserveRun({
    id: run.id,
    projectId: project.projectId,
    externalRunId: run.workflowRunId,
    attempt: 1,
    kind: run.pullRequest ? "pull_request" : "main",
    testedSha: run.testedSha,
    lineageKey: run.pullRequest ? `pr:${run.pullRequest.number}` : "main",
    plan: {
      digest: planDigest,
      shards: [
        {
          key: "combined",
          profileDigest: await digestJson({ environmentProfilePolicy: "measured" }),
          environmentProfilePolicy: "measured",
          sourceAttempt: 1,
          discovery: { executorDigest, configurationDigest },
          tests: [],
          captures: [],
        },
      ],
    },
    verifiedRelatedRunIds: [],
    verifiedAncestorShas: baseline ? [baseline.testedSha] : [],
    verificationDigest: await digestJson({ seed: run.id, verified: true }),
    rerunShardKeys: ["combined"],
    now,
  });
  const captures: InventoryCapture[] = [];
  const changedProfiles = new Set<string>();
  const stored = new Map<string, ValidatedImage>();
  for (const capture of drawn) {
    const reference = references.get(identityKey(capture));
    // Each baseline capture that stays in this map is a removal.
    references.delete(identityKey(capture));
    const { result, inventoryCapture } = await compareCapture({
      service,
      images,
      pictures,
      runId: run.id,
      capture,
      reference,
      stored,
    });
    receipt.captures.push(result);
    captures.push(inventoryCapture);
    if (result.outcome === "changed") {
      changedProfiles.add(inventoryCapture.profileDigest);
    }
  }
  receipt.removals = [...references.values()].map(({ itemKey, variantKey }) => ({
    itemKey,
    variantKey,
  }));
  manifest.localComparison = receipt;
  // Production stores a profile row only for a profile with a changed capture.
  await storeCaptureProfiles(
    database,
    profiles.filter((entry) => changedProfiles.has(entry.digest)),
  );
  const inventory: CaptureInventory = {
    schemaVersion: "baseline-delta-v1",
    projectId: project.projectId,
    runId: run.id,
    testedSha: run.testedSha,
    referenceSnapshotId: snapshotId,
    captures,
    profiles,
    manifest,
  };
  await service.commitShard({
    runId: run.id,
    key: "combined",
    manifestDigest: await digestJson(manifest),
    captures,
    inventory: await writeCaptureInventory(images, inventory),
    imageRunIds: [...new Set(captures.map((capture) => capture.image.runId))],
    localReferenceSnapshotId: snapshotId,
    verifiedDiscovery: {
      executorDigest,
      configurationDigest,
      inventoryDigest: discoveryInventoryDigest,
      verificationDigest: await digestJson({ seed: run.id, discovery: true }),
      jobId: manifest.shard.jobId,
      externalRunId: run.workflowRunId,
      attempt: 1,
      testedSha: run.testedSha,
      tests: [test.id],
      captures: captures.map(({ itemKey, variantKey }) => ({
        itemKey,
        variantKey,
        testId: test.id,
      })),
    },
    finalTestOutcomes: [{ testId: test.id, retry: test.retry, status: test.status }],
    now,
  });
  await service.sealRun({ runId: run.id, now });
  const comparisonId = crypto.randomUUID();
  await service.createComparison({
    id: comparisonId,
    runId: run.id,
    referenceSnapshotId: snapshotId,
    expectedBaselineRevision: baselineRevision,
    localComparison: receipt,
    referenceCaptures: (baseline?.captures ?? []).map((capture) => ({
      id: capture.id,
      itemKey: capture.itemKey,
      variantKey: capture.variantKey,
      profileDigest: capture.profileDigest,
      renderingProfileDigest: capture.renderingProfileDigest,
      image: capture.image,
    })),
    now,
  });
  await service.finalizeComparison({ comparisonId, now });
  if (run.pullRequest) {
    // The Queue reads the title of a pull request from its processed webhook
    // delivery. This is the payload that `settledPayloadSql` keeps.
    const payload = canonicalJson({
      pull_request: { number: run.pullRequest.number, title: run.pullRequest.title },
      repository: { id: Number(project.repositoryId) },
    });
    await database
      .prepare(
        "INSERT INTO github_webhook_delivery(delivery_id,event,payload_digest,payload_json,received_at,processed_at) VALUES(?,'pull_request',?,?,?,?)",
      )
      .bind(`seed-${run.id}`, await sha256(new TextEncoder().encode(payload)), payload, now, now)
      .run();
  }
}

/** Seed an empty database: one project, its accepted main baseline, and two open pull requests. */
export async function seed(params: SeedParams) {
  const service = new Service(params.database);
  const policy = { id: "local", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 };
  const policyDigest = await digestJson(policy);
  await service.createPolicy({ digest: policyDigest, policy });
  await service.createProject({
    id: params.projectId,
    repositoryId: params.repositoryId,
    policyDigest,
  });
  const pictures = new Map<string, Picture>();
  // The runs are one minute apart, and the last one is new.
  let now = Date.now() - seedRuns.length * 60_000;
  for (const run of seedRuns) {
    now += 60_000;
    await submit({ ...params, service, run, pictures, now });
    if (run.pullRequest) continue;
    // The first main run of a project accepts each capture. The operations pass promotes it.
    const report = await promoteBaselines({
      database: params.database,
      images: params.images,
      quarantine: params.quarantine,
      origin: params.origin,
      budget: operationsBudgetDefaults,
      now: () => now,
      github: {
        appId: "",
        repository: params.repository,
        repositoryId: params.repositoryId,
        async request(path) {
          throw new Error(`The seed makes no GitHub request: ${path}`);
        },
      },
    });
    if (!report.completed.includes(run.id)) {
      throw new Error("The seed baseline was not promoted.");
    }
  }
}
