import {
  canonicalJson,
  digestEnvironmentProfile,
  digestJson,
  digestRenderingProfile,
  isJson,
  sha256,
  validateDigest,
  validateProfile,
  type CaptureIdentity,
  type Json,
  type ProfileRecord,
} from "@visonaut/protocol";
import {
  assertion,
  atomic,
  statement,
  type Database,
  type ProjectRow,
  type ValidatedImage,
} from "@visonaut/service";
import {
  readCaptureInventory,
  writeCaptureInventory,
  type CaptureInventory,
  type CaptureInventoryPointer,
  type InventoryCapture,
} from "../../src/capture-inventory.ts";
import type { ObjectStore } from "../../src/operations/types.ts";

const pageSize = 25;
const maximumCaptures = 10_000;
const maximumPlanBytes = 16 * 1024 * 1024;
const maximumImageBytes = 20 * 1024 * 1024;
const maximumIdentityPageBytes = 32 * 1024;

type ResetObjectStore = Pick<ObjectStore, "get" | "put">;

export interface ResetContext {
  source: Database;
  target: Database;
  sourceImages: ResetObjectStore;
  targetImages: ResetObjectStore;
  sourceDatabaseId: string;
  targetDatabaseId: string;
  projectId: string;
  now: () => number;
}

export interface SourceBaseline {
  snapshotId: string;
  baselineRevision: number;
  testedSha: string;
}

interface SourceConfiguration extends SourceBaseline {
  project: ProjectRow;
  policy: Json;
  storageMode: "source" | "protected";
}

interface SourceCapture {
  id: string;
  item_key: string;
  variant_key: string;
  ordinal: number;
  profile_digest: string;
  test_id: string;
  test_retry: number;
  metadata_json: string;
  profile_json: string | null;
  image_id: string;
  object_key: string;
  digest: string;
  content_type: "image/png" | "image/webp";
  bytes: number;
  width: number;
  height: number;
  copied: number;
  validated: number;
  bytes_present: number;
  role: string;
}

interface ResetImage {
  sourceObjectKey: string;
  image: ValidatedImage;
}

interface ResetPlan {
  schemaVersion: "baseline-reset-v1";
  id: string;
  sourceDatabaseId: string;
  targetDatabaseId: string;
  projectId: string;
  repositoryId: string;
  policyDigest: string;
  policy: Json;
  source: SourceBaseline;
  inventory: CaptureInventoryPointer;
  images: ResetImage[];
}

interface LoadedResetPlan extends ResetPlan {
  identities: CaptureIdentity[];
}

// Limit UTF-8 bytes as well as rows to keep each D1 request comfortably below 1 MiB.
export function identityPages(identities: CaptureIdentity[]) {
  const pages: string[] = [];
  let page: CaptureIdentity[] = [];
  for (const identity of identities) {
    const candidate = [...page, identity];
    if (
      candidate.length > pageSize ||
      new TextEncoder().encode(canonicalJson(candidate)).byteLength > maximumIdentityPageBytes
    ) {
      pages.push(canonicalJson(page));
      page = [];
    }
    page.push(identity);
    if (new TextEncoder().encode(canonicalJson(page)).byteLength > maximumIdentityPageBytes) {
      throw new Error("A baseline identity exceeds the bounded D1 page size.");
    }
  }
  if (page.length) {
    pages.push(canonicalJson(page));
  }
  return pages;
}

function protectedPrefix(id: string) {
  validateDigest(id, "import ID");
  return `baselines/import/${id}/`;
}

function runId(id: string) {
  validateDigest(id, "import ID");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
}

function snapshotId(id: string) {
  return `baseline-import:${id}:snapshot`;
}

function comparisonId(id: string) {
  return `baseline-import:${id}:comparison`;
}

function guardDatabases(context: ResetContext) {
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
  if (!uuid.test(context.sourceDatabaseId) || !uuid.test(context.targetDatabaseId)) {
    throw new Error("Explicit source and target D1 UUIDs are required.");
  }
  if (context.sourceDatabaseId === context.targetDatabaseId) {
    throw new Error("Source and target databases must differ.");
  }
}

export async function sourceBaseline(context: ResetContext): Promise<SourceConfiguration> {
  guardDatabases(context);
  const row = await statement(
    context.source,
    `SELECT project.*,snapshot.id AS source_snapshot_id,snapshot.tested_sha,
      snapshot.storage_mode,policy.policy_json
      FROM visonaut_projects project
      JOIN visonaut_snapshots snapshot ON snapshot.id=project.snapshot_id
      JOIN visonaut_policies policy ON policy.digest=project.policy_digest
      JOIN visonaut_promotions promotion ON promotion.id=project.promotion_id
        AND promotion.snapshot_id=snapshot.id AND promotion.revoked=0
      WHERE project.id=? AND snapshot.project_id=project.id AND promotion.project_id=project.id
        AND promotion.baseline_revision=project.baseline_revision
        AND snapshot.state='accepted' AND snapshot.reference_eligible=1`,
    [context.projectId],
  ).first<
    ProjectRow & {
      source_snapshot_id: string;
      tested_sha: string;
      storage_mode: "source" | "protected";
      policy_json: string;
    }
  >();
  if (!row) {
    throw new Error("The source project has no accepted, eligible baseline.");
  }
  const policy: unknown = JSON.parse(row.policy_json);
  if (!isJson(policy)) {
    throw new Error("The source comparison policy is invalid.");
  }
  return {
    project: row,
    policy,
    snapshotId: row.source_snapshot_id,
    baselineRevision: row.baseline_revision,
    testedSha: row.tested_sha,
    storageMode: row.storage_mode,
  };
}

function assertSource(actual: SourceBaseline, expected: SourceBaseline) {
  if (
    actual.snapshotId !== expected.snapshotId ||
    actual.baselineRevision !== expected.baselineRevision ||
    actual.testedSha !== expected.testedSha
  ) {
    throw new Error("The source baseline changed. Prepare a new import for the accepted baseline.");
  }
}

async function readBytes(store: ResetObjectStore, key: string, maximumBytes: number) {
  const object = await store.get(key);
  if (!object || object.size > maximumBytes) {
    throw new Error(`Object missing or too large: ${key}`);
  }
  const reader = object.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumBytes || size > object.size) {
        throw new Error(`Object exceeds its declared size: ${key}`);
      }
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  if (size !== object.size) {
    throw new Error(`Object size is incomplete: ${key}`);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function putImmutable(store: ResetObjectStore, key: string, value: unknown) {
  const content = canonicalJson(value);
  await store.put(key, content, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" },
  });
  const stored = new TextDecoder().decode(await readBytes(store, key, maximumPlanBytes));
  if (stored !== content) {
    throw new Error(`The immutable import object conflicts: ${key}`);
  }
}

async function prepareTarget(context: ResetContext, plan: ResetPlan) {
  const id = runId(plan.id);
  const snapshot = snapshotId(plan.id);
  const existing = await statement(context.target, "SELECT * FROM visonaut_projects WHERE id=?", [
    plan.projectId,
  ]).first<ProjectRow>();
  if (existing) {
    const imported = await statement(
      context.target,
      "SELECT id FROM visonaut_runs WHERE id=? AND project_id=? AND tested_sha=? AND plan_digest=?",
      [id, plan.projectId, plan.source.testedSha, plan.inventory.digest],
    ).first();
    if (!imported || (existing.snapshot_id !== null && existing.snapshot_id !== snapshot)) {
      throw new Error("The target contains another project or baseline. Use a fresh database.");
    }
    return;
  }
  await atomic(context.target, [
    assertion(
      context.target,
      "NOT EXISTS(SELECT 1 FROM visonaut_projects) AND NOT EXISTS(SELECT 1 FROM visonaut_runs)",
    ),
    statement(context.target, "INSERT INTO visonaut_policies(digest,policy_json) VALUES(?,?)", [
      plan.policyDigest,
      canonicalJson(plan.policy),
    ]),
    statement(
      context.target,
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest,fresh_setup) VALUES(?,?,?,0)",
      [plan.projectId, plan.repositoryId, plan.policyDigest],
    ),
    statement(
      context.target,
      `INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,
        plan_digest,plan_json,state,active,sealed_at,closed_at,created_at,comparison_id,
        inventory_key,inventory_digest,inventory_bytes,capture_count)
        VALUES(?,?,?,1,'main',?,'main',?,'{}','accepted',0,?,?,?,?,?,?,?,?)`,
      [
        id,
        plan.projectId,
        id,
        plan.source.testedSha,
        plan.inventory.digest,
        context.now(),
        context.now(),
        context.now(),
        comparisonId(plan.id),
        plan.inventory.objectKey,
        plan.inventory.digest,
        plan.inventory.bytes,
        plan.inventory.captureCount,
      ],
    ),
    statement(
      context.target,
      "INSERT INTO work_retained_runs(id,object_prefix,closed_at) VALUES(?,?,?)",
      [id, `${protectedPrefix(plan.id)}images/`, context.now()],
    ),
    statement(
      context.target,
      "INSERT INTO work_retention_pins(run_id,owner,reason) VALUES(?,?,'baseline')",
      [id, `promotion:${snapshot}`],
    ),
    statement(
      context.target,
      "INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,state,created_at) VALUES(?,?,?, ?,0,'ready',?)",
      [comparisonId(plan.id), id, plan.source.baselineRevision, plan.policyDigest, context.now()],
    ),
    statement(
      context.target,
      "INSERT INTO visonaut_snapshots(id,project_id,run_id,comparison_id,tested_sha,prefix,created_at,storage_mode) VALUES(?,?,?,?,?,?,?,'source')",
      [
        snapshot,
        plan.projectId,
        id,
        comparisonId(plan.id),
        plan.source.testedSha,
        protectedPrefix(plan.id),
        context.now(),
      ],
    ),
  ]);
}

export async function prepareReset(context: ResetContext, expected: SourceBaseline) {
  const source = await sourceBaseline(context);
  assertSource(source, expected);
  const id = await digestJson({
    sourceDatabaseId: context.sourceDatabaseId,
    targetDatabaseId: context.targetDatabaseId,
    projectId: context.projectId,
    source: expected,
  });
  const key = `${protectedPrefix(id)}plan.json`;
  if (await context.targetImages.get(key)) {
    const plan = await loadPlan(context, id);
    await prepareTarget(context, plan);
    return progress(plan);
  }
  const rows =
    (
      await statement(
        context.source,
        `SELECT capture.*,profile.profile_json,image.id AS image_id,image.digest,image.content_type,
      image.bytes,image.width,image.height,image.validated,image.bytes_present,image.role,
      CASE WHEN ?='protected' THEN member.object_key ELSE image.object_key END AS object_key,member.copied
      FROM visonaut_snapshot_images member JOIN visonaut_captures capture ON capture.id=member.capture_id
      JOIN visonaut_images image ON image.id=member.image_id
      LEFT JOIN visonaut_capture_profiles profile ON profile.digest=capture.profile_digest
      WHERE member.snapshot_id=? ORDER BY capture.ordinal,capture.id LIMIT ?`,
        [source.storageMode, source.snapshotId, maximumCaptures + 1],
      ).all<SourceCapture>()
    ).results ?? [];
  if (!rows.length || rows.length > maximumCaptures) {
    throw new Error("The baseline must contain 1 to 10,000 captures.");
  }
  const count = await statement(
    context.source,
    "SELECT count(*) AS count FROM visonaut_captures WHERE run_id=(SELECT run_id FROM visonaut_snapshots WHERE id=?)",
    [source.snapshotId],
  ).first<{ count: number }>();
  if (count?.count !== rows.length) {
    throw new Error("The source baseline membership is incomplete.");
  }
  const profiles = new Map<string, ProfileRecord>();
  const images = new Map<string, ResetImage>();
  const captures: InventoryCapture[] = [];
  for (const row of rows) {
    if (
      row.copied !== 1 ||
      row.validated !== 1 ||
      row.role !== "original" ||
      (source.storageMode === "source" && row.bytes_present !== 1)
    ) {
      throw new Error("The source baseline contains an unavailable original.");
    }
    const metadata: unknown = JSON.parse(row.metadata_json);
    if (!isJson(metadata) || !isRecord(metadata)) {
      throw new Error("The source capture metadata is invalid.");
    }
    const profile: unknown = row.profile_json ? JSON.parse(row.profile_json) : metadata.profile;
    validateProfile(profile);
    if ((await digestJson(profile)) !== row.profile_digest) {
      throw new Error("The source capture profile digest is invalid.");
    }
    profiles.set(row.profile_digest, { digest: row.profile_digest, profile });
    // Import baseline facts, without dangling observed candidates or review masks.
    const {
      localResult: _localResult,
      observedImage: _observedImage,
      candidateStored: _candidateStored,
      maskImageId: _maskImageId,
      thumbnailImageId: _thumbnailImageId,
      ...baselineMetadata
    } = metadata;
    const extension = row.content_type === "image/png" ? "png" : "webp";
    const image: ValidatedImage = {
      id: await digestJson([id, row.digest]),
      runId: runId(id),
      digest: row.digest,
      objectKey: `${protectedPrefix(id)}images/${row.digest}.${extension}`,
      contentType: row.content_type,
      bytes: row.bytes,
      width: row.width,
      height: row.height,
      role: "original",
    };
    const previous = images.get(row.digest);
    if (previous && canonicalJson(previous.image) !== canonicalJson(image)) {
      throw new Error("The same source digest has conflicting image facts.");
    }
    images.set(row.digest, { sourceObjectKey: row.object_key, image });
    captures.push({
      id: `baseline-import:${id}:capture:${captures.length}`,
      itemKey: row.item_key,
      variantKey: row.variant_key,
      ordinal: captures.length,
      imageId: image.id,
      image,
      profileDigest: row.profile_digest,
      renderingProfileDigest: await digestRenderingProfile(profile),
      environmentProfileDigest: await digestEnvironmentProfile(profile),
      testId: row.test_id,
      testRetry: row.test_retry,
      metadata: { ...baselineMetadata, profile: { $visonautProfileDigest: row.profile_digest } },
    });
  }
  const inventory: CaptureInventory = {
    schemaVersion: "baseline-delta-v1",
    projectId: context.projectId,
    runId: runId(id),
    testedSha: source.testedSha,
    referenceSnapshotId: null,
    captures,
    profiles: [...profiles.values()],
  };
  const pointer = await writeCaptureInventory(context.targetImages, inventory, {
    prefix: protectedPrefix(id).slice(0, -1),
    maximumBytes: maximumPlanBytes,
  });
  const plan: ResetPlan = {
    schemaVersion: "baseline-reset-v1",
    id,
    sourceDatabaseId: context.sourceDatabaseId,
    targetDatabaseId: context.targetDatabaseId,
    projectId: context.projectId,
    repositoryId: source.project.repository_id,
    policyDigest: source.project.policy_digest,
    policy: source.policy,
    source: expected,
    inventory: pointer,
    images: [...images.values()],
  };
  assertSource(await sourceBaseline(context), expected);
  await putImmutable(context.targetImages, key, plan);
  await prepareTarget(context, plan);
  return progress(plan);
}

async function loadPlan(context: ResetContext, id: string): Promise<LoadedResetPlan> {
  guardDatabases(context);
  const value: unknown = JSON.parse(
    new TextDecoder().decode(
      await readBytes(context.targetImages, `${protectedPrefix(id)}plan.json`, maximumPlanBytes),
    ),
  );
  if (!isResetPlan(value)) {
    throw new Error("The import plan is invalid.");
  }
  if (
    value.id !== id ||
    value.sourceDatabaseId !== context.sourceDatabaseId ||
    value.targetDatabaseId !== context.targetDatabaseId ||
    value.projectId !== context.projectId
  ) {
    throw new Error("The import belongs to different bindings or a different project.");
  }
  const expected = await digestJson({
    sourceDatabaseId: value.sourceDatabaseId,
    targetDatabaseId: value.targetDatabaseId,
    projectId: value.projectId,
    source: value.source,
  });
  if (expected !== id) {
    throw new Error("The import identity is invalid.");
  }
  const inventory = await readCaptureInventory(
    context.targetImages,
    value.inventory,
    maximumPlanBytes,
  );
  if (
    inventory.runId !== runId(id) ||
    inventory.projectId !== context.projectId ||
    inventory.testedSha !== value.source.testedSha ||
    inventory.manifest
  ) {
    throw new Error("The import inventory has conflicting provenance.");
  }
  const actualImages = new Map(
    inventory.captures.map((capture) => [capture.image.id, capture.image]),
  );
  if (
    actualImages.size !== value.images.length ||
    value.images.some(
      (entry) =>
        !entry.image.objectKey.startsWith(protectedPrefix(id)) ||
        canonicalJson(entry.image) !== canonicalJson(actualImages.get(entry.image.id)),
    )
  ) {
    throw new Error("The import image list conflicts with the complete inventory.");
  }
  return {
    ...value,
    identities: inventory.captures.map(({ itemKey, variantKey }) => ({ itemKey, variantKey })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isResetPlan(value: unknown): value is ResetPlan {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "baseline-reset-v1" ||
    !isRecord(value.source) ||
    !isRecord(value.inventory) ||
    !Array.isArray(value.images) ||
    !isJson(value.policy)
  )
    return false;
  if (
    ![
      value.id,
      value.sourceDatabaseId,
      value.targetDatabaseId,
      value.projectId,
      value.repositoryId,
      value.policyDigest,
      value.source.snapshotId,
      value.source.testedSha,
      value.inventory.objectKey,
      value.inventory.digest,
    ].every((entry) => typeof entry === "string" && entry.length > 0)
  )
    return false;
  if (
    !Number.isSafeInteger(value.source.baselineRevision) ||
    !Number.isSafeInteger(value.inventory.bytes) ||
    !Number.isSafeInteger(value.inventory.captureCount) ||
    value.images.length > maximumCaptures
  )
    return false;
  return value.images.every(
    (entry: unknown) =>
      isRecord(entry) &&
      typeof entry.sourceObjectKey === "string" &&
      isRecord(entry.image) &&
      [entry.image.id, entry.image.runId, entry.image.digest, entry.image.objectKey].every(
        (field) => typeof field === "string",
      ) &&
      (entry.image.contentType === "image/png" || entry.image.contentType === "image/webp") &&
      [entry.image.bytes, entry.image.width, entry.image.height].every(
        (field) => typeof field === "number" && Number.isSafeInteger(field) && field > 0,
      ) &&
      entry.image.role === "original",
  );
}

function progress(plan: ResetPlan) {
  return {
    importId: plan.id,
    source: plan.source,
    captureCount: plan.inventory.captureCount,
    imageCount: plan.images.length,
    pageSize,
    pages: Math.ceil(plan.images.length / pageSize),
    inventory: plan.inventory,
  };
}

export async function copyResetPage(
  context: ResetContext,
  input: { importId: string; page: number },
) {
  const plan = await loadPlan(context, input.importId);
  if (
    !Number.isSafeInteger(input.page) ||
    input.page < 0 ||
    input.page >= Math.ceil(plan.images.length / pageSize)
  ) {
    throw new Error("The copy page is outside this import.");
  }
  const page = plan.images.slice(input.page * pageSize, (input.page + 1) * pageSize);
  for (const entry of page) {
    let bytes: Uint8Array<ArrayBuffer>;
    if (await context.targetImages.get(entry.image.objectKey)) {
      bytes = await readBytes(context.targetImages, entry.image.objectKey, maximumImageBytes);
    } else {
      bytes = await readBytes(context.sourceImages, entry.sourceObjectKey, maximumImageBytes);
      if (bytes.byteLength !== entry.image.bytes || (await sha256(bytes)) !== entry.image.digest) {
        throw new Error("The source original does not match the baseline digest and size.");
      }
      await context.targetImages.put(entry.image.objectKey, bytes, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: entry.image.contentType },
        sha256: entry.image.digest,
      });
      bytes = await readBytes(context.targetImages, entry.image.objectKey, maximumImageBytes);
    }
    if (bytes.byteLength !== entry.image.bytes || (await sha256(bytes)) !== entry.image.digest) {
      throw new Error("The copied original does not match the baseline digest and size.");
    }
  }
  await atomic(context.target, [
    assertion(
      context.target,
      "EXISTS(SELECT 1 FROM visonaut_runs WHERE id=? AND project_id=? AND inventory_digest=?)",
      [runId(plan.id), plan.projectId, plan.inventory.digest],
    ),
    ...page.map(({ image }) =>
      statement(
        context.target,
        "INSERT OR IGNORE INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height,role) VALUES(?,?,?,?,?,?,?,?,'original')",
        [
          image.id,
          image.runId,
          image.digest,
          image.objectKey,
          image.contentType,
          image.bytes,
          image.width,
          image.height,
        ],
      ),
    ),
    ...page.map(({ image }) =>
      assertion(
        context.target,
        "EXISTS(SELECT 1 FROM visonaut_images WHERE id=? AND run_id=? AND digest=? AND object_key=? AND content_type=? AND bytes=? AND width=? AND height=? AND bytes_present=1 AND role='original' AND validated=1)",
        [
          image.id,
          image.runId,
          image.digest,
          image.objectKey,
          image.contentType,
          image.bytes,
          image.width,
          image.height,
        ],
      ),
    ),
  ]);
  await putImmutable(context.targetImages, `${protectedPrefix(plan.id)}copies/${input.page}.json`, {
    inventoryDigest: plan.inventory.digest,
    page: input.page,
    images: page.map(({ image }) => image),
  });
  return { ...progress(plan), copiedPage: input.page, copiedImages: page.length };
}

export async function activateReset(context: ResetContext, importId: string) {
  const plan = await loadPlan(context, importId);
  const snapshot = snapshotId(plan.id);
  const project = await statement(context.target, "SELECT * FROM visonaut_projects WHERE id=?", [
    plan.projectId,
  ]).first<ProjectRow>();
  if (project?.snapshot_id === snapshot) {
    const existing = await statement(
      context.target,
      "SELECT id FROM visonaut_snapshots WHERE id=? AND state='accepted' AND reference_eligible=1 AND inventory_verified=1 AND inventory_digest=? AND capture_count=?",
      [snapshot, plan.inventory.digest, plan.inventory.captureCount],
    ).first();
    if (!existing) {
      throw new Error("The active imported snapshot is not verified.");
    }
    return progress(plan);
  }
  assertSource(await sourceBaseline(context), plan.source);
  for (let page = 0; page < Math.ceil(plan.images.length / pageSize); page++) {
    const expected = canonicalJson({
      inventoryDigest: plan.inventory.digest,
      page,
      images: plan.images.slice(page * pageSize, (page + 1) * pageSize).map(({ image }) => image),
    });
    const stored = new TextDecoder().decode(
      await readBytes(
        context.targetImages,
        `${protectedPrefix(plan.id)}copies/${page}.json`,
        maximumPlanBytes,
      ),
    );
    if (stored !== expected) {
      throw new Error("A baseline copy page is incomplete or conflicts.");
    }
  }
  // Seed current baseline facts only. The target stays closed to submissions until
  // activation. Every page checks exact membership; the final count rejects extras.
  for (const page of identityPages(plan.identities)) {
    await atomic(context.target, [
      assertion(
        context.target,
        `EXISTS(SELECT 1 FROM visonaut_projects WHERE id=? AND snapshot_id IS NULL
          AND promotion_id IS NULL AND fresh_setup=0 AND repository_id=? AND policy_digest=?)
          AND (SELECT count(*) FROM visonaut_projects)=1
          AND NOT EXISTS(SELECT 1 FROM visonaut_runs WHERE id!=?)
          AND EXISTS(SELECT 1 FROM visonaut_runs WHERE id=? AND project_id=?
            AND inventory_key=? AND inventory_digest=? AND inventory_bytes=? AND capture_count=?)`,
        [
          plan.projectId,
          plan.repositoryId,
          plan.policyDigest,
          runId(plan.id),
          runId(plan.id),
          plan.projectId,
          plan.inventory.objectKey,
          plan.inventory.digest,
          plan.inventory.bytes,
          plan.inventory.captureCount,
        ],
      ),
      statement(
        context.target,
        `INSERT OR IGNORE INTO visonaut_identity_history(project_id,lineage_key,item_key,variant_key)
          SELECT ?,'main',json_extract(value,'$.itemKey'),json_extract(value,'$.variantKey')
          FROM json_each(?)`,
        [plan.projectId, page],
      ),
      assertion(
        context.target,
        `NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(
          SELECT 1 FROM visonaut_identity_history history WHERE history.project_id=?
            AND history.lineage_key='main' AND history.item_key=json_extract(expected.value,'$.itemKey')
            AND history.variant_key=json_extract(expected.value,'$.variantKey')))`,
        [page, plan.projectId],
      ),
    ]);
  }
  // Identity facts are monotone in the service. With no other runs admitted, the
  // verified pages plus this complete-set count hold through atomic activation.
  assertSource(await sourceBaseline(context), plan.source);
  // Only the final batch makes the fully verified baseline visible to submissions.
  await atomic(context.target, [
    assertion(
      context.target,
      "EXISTS(SELECT 1 FROM visonaut_projects WHERE id=? AND snapshot_id IS NULL AND promotion_id IS NULL AND fresh_setup=0 AND repository_id=? AND policy_digest=?)",
      [plan.projectId, plan.repositoryId, plan.policyDigest],
    ),
    assertion(
      context.target,
      "NOT EXISTS(SELECT 1 FROM visonaut_runs WHERE id!=?) AND (SELECT count(*) FROM visonaut_projects)=1",
      [runId(plan.id)],
    ),
    assertion(
      context.target,
      "(SELECT count(*) FROM visonaut_images WHERE run_id=? AND role='original' AND bytes_present=1 AND validated=1)=?",
      [runId(plan.id), plan.images.length],
    ),
    assertion(
      context.target,
      "(SELECT count(*) FROM visonaut_identity_history WHERE project_id=?)=? AND NOT EXISTS(SELECT 1 FROM visonaut_identity_history WHERE project_id=? AND lineage_key!='main')",
      [plan.projectId, plan.inventory.captureCount, plan.projectId],
    ),
    statement(
      context.target,
      "UPDATE visonaut_snapshots SET state='accepted',reference_eligible=1,inventory_key=?,inventory_digest=?,inventory_bytes=?,capture_count=?,inventory_verified=1 WHERE id=? AND state='copying'",
      [
        plan.inventory.objectKey,
        plan.inventory.digest,
        plan.inventory.bytes,
        plan.inventory.captureCount,
        snapshot,
      ],
    ),
    assertion(
      context.target,
      "EXISTS(SELECT 1 FROM visonaut_snapshots WHERE id=? AND state='accepted' AND reference_eligible=1 AND inventory_digest=? AND inventory_verified=1)",
      [snapshot, plan.inventory.digest],
    ),
    statement(
      context.target,
      "INSERT INTO visonaut_promotions(id,project_id,snapshot_id,comparison_id,baseline_revision,created_at) VALUES(?,?,?,?,?,?)",
      [
        `baseline-import:${plan.id}:promotion`,
        plan.projectId,
        snapshot,
        comparisonId(plan.id),
        plan.source.baselineRevision,
        context.now(),
      ],
    ),
    statement(
      context.target,
      "UPDATE visonaut_projects SET snapshot_id=?,promotion_id=?,baseline_revision=?,revision=revision+1,fresh_setup=0 WHERE id=?",
      [
        snapshot,
        `baseline-import:${plan.id}:promotion`,
        plan.source.baselineRevision,
        plan.projectId,
      ],
    ),
  ]);
  return progress(plan);
}

export async function listResetObjects(
  store: Pick<ObjectStore, "list">,
  input: { prefix: string; cursor?: string; limit?: number },
) {
  const limit = input.limit ?? 1000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("Object listing limits must be between 1 and 1000.");
  }
  const page = await store.list({ prefix: input.prefix, cursor: input.cursor, limit });
  if (page.truncated && !page.cursor) {
    throw new Error("The object listing is incomplete without a continuation cursor.");
  }
  return {
    prefix: input.prefix,
    objects: page.objects.map(({ key, size }) => ({ key, bytes: size })),
    count: page.objects.length,
    bytes: page.objects.reduce((sum, object) => sum + object.size, 0),
    truncated: page.truncated,
    nextCursor: page.truncated ? page.cursor : null,
  };
}
