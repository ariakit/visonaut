import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

export const fixtureIds = Object.freeze({
  projectId: "e08-project",
  repositoryId: "908000001",
  workflowRunId: "908000002",
  baselineRunId: "e08-baseline",
  reviewRunId: "e08-review",
  baselineComparisonId: "e08-baseline-comparison",
  reviewComparisonId: "e08-review-comparison",
  snapshotId: "e08-baseline-snapshot",
  promotionId: "e08-baseline-promotion",
  actorId: "e08-maintainer",
  sessionId: "e08-review-session",
  baselineRevision: 1,
  testedSha: "e080000000000000000000000000000000000000",
});

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function walk(directory) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...walk(path));
    else if (entry.isFile() && entry.name.endsWith(".webp") && path.includes("/__screenshots__/"))
      paths.push(path);
  }
  return paths.sort();
}

function webpDimensions(bytes) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("Corpus file is not a RIFF WebP image");
  }
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error("WebP container length mismatch");
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > bytes.length) throw new Error("Truncated WebP chunk");
    if (kind === "VP8X" && size >= 10) {
      return {
        width: bytes.readUIntLE(data + 4, 3) + 1,
        height: bytes.readUIntLE(data + 7, 3) + 1,
      };
    }
    if (kind === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
      const bits = bytes.readUInt32LE(data + 1);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8 " && size >= 10 && bytes.toString("hex", data + 3, data + 6) === "9d012a") {
      return {
        width: bytes.readUInt16LE(data + 6) & 0x3fff,
        height: bytes.readUInt16LE(data + 8) & 0x3fff,
      };
    }
    offset = data + size + (size & 1);
  }
  throw new Error("WebP image dimensions were not found");
}

function quote(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("SQL numbers must be finite");
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function identifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function numbered(prefix, index) {
  return `${prefix}-${String(index).padStart(6, "0")}`;
}

function parseArguments(arguments_) {
  const result = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || value === undefined)
      throw new Error("Arguments require --name value pairs");
    result[key.slice(2)] = value;
  }
  return result;
}

/** This fixture tests storage/state mechanics. It is not capture or GitHub evidence. */
export function generateFixture(options = {}) {
  const root = resolve(new URL("frozen-schema/", import.meta.url).pathname);
  if (!options.corpus || !options.output) throw new Error("Pass --corpus and --output");
  const corpusRoot = resolve(options.corpus);
  const output = resolve(options.output);
  const captureCount = Number(options.captures ?? 35_820);
  const shardSize = Number(options.shardSize ?? options["shard-size"] ?? 500);
  if (!Number.isSafeInteger(captureCount) || captureCount < 1)
    throw new Error("captures must be a positive integer");
  if (!Number.isSafeInteger(shardSize) || shardSize < 10 || shardSize > 500)
    throw new Error("shard-size must be 10..500");
  const migrationsDirectory = join(root, "apps/web/migrations");
  const migrations = readdirSync(migrationsDirectory)
    .filter((name) => /^000[1-6]_.*\.sql$/.test(name))
    .sort();
  if (migrations.length !== 6)
    throw new Error("Expected all six root migrations 0001 through 0006");
  mkdirSync(output, { recursive: true });
  const databasePath = join(output, "fixture.sqlite");
  if (existsSync(databasePath))
    throw new Error(`Refusing to overwrite existing fixture database: ${databasePath}`);
  const database = new DatabaseSync(databasePath);
  const sqlPath = join(output, "seed.sql");
  const sqlFile = openSync(sqlPath, "wx");
  const sqlMetrics = { statements: 0, maximumStatementBytes: 0, rows: 0, bytes: 0 };
  const writeSql = (sql) => {
    const bytes = Buffer.byteLength(sql);
    if (bytes > 100_000) throw new Error(`SQL statement exceeds 100,000 bytes (${bytes})`);
    writeSync(sqlFile, `${sql}\n`);
    sqlMetrics.statements += 1;
    sqlMetrics.maximumStatementBytes = Math.max(sqlMetrics.maximumStatementBytes, bytes);
    sqlMetrics.bytes += bytes + 1;
  };
  const insert = (table, rows) => {
    let prefix;
    let statement;
    let columns;
    let chunk = [];
    let chunkBytes = 0;
    const flush = () => {
      if (!chunk.length) return;
      writeSql(`${prefix}${chunk.join(",")} ;`);
      chunk = [];
      chunkBytes = 0;
    };
    for (const row of rows) {
      if (!columns) {
        columns = Object.keys(row);
        prefix = `INSERT INTO ${identifier(table)}(${columns.map(identifier).join(",")}) VALUES `;
        statement = database.prepare(`${prefix}(${columns.map(() => "?").join(",")})`);
      }
      const values = columns.map((key) => row[key] ?? null);
      const tuple = `(${values.map(quote).join(",")})`;
      const bytes = Buffer.byteLength(tuple) + 1;
      if (chunkBytes + bytes + Buffer.byteLength(prefix) > 90_000) flush();
      if (bytes + Buffer.byteLength(prefix) > 90_000)
        throw new Error(`Oversized fixture row in ${table}`);
      statement.run(...values);
      chunk.push(tuple);
      chunkBytes += bytes;
      sqlMetrics.rows += 1;
    }
    flush();
  };
  const objects = [];
  const addJson = (key, value, role, runId) => {
    const text = canonicalJson(value);
    const sourcePath = join(output, "metadata", key);
    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, text);
    const record = {
      bucket: "quarantine",
      key,
      sourcePath,
      inlineJson: JSON.parse(text),
      digest: digest(text),
      bytes: Buffer.byteLength(text),
      contentType: "application/json",
      role,
      runId,
    };
    objects.push(record);
    return record;
  };
  const createdAt = Date.parse("2026-09-22T00:00:00Z");
  const fixture = {
    ...fixtureIds,
    capturesPerRun: captureCount,
    benchmarkTarget: { id: numbered("e08-review-row", 0), expectedRevision: 0 },
    benchmarkSelection: { itemKey: "e08-item-000000", variantKey: "default" },
    benchmarkWholeItem: {
      key: "e08-item-000000",
      targetIds: Array.from({ length: Math.min(10, captureCount) }, (_, index) =>
        numbered("e08-review-row", index),
      ),
    },
    sentinelTaskId: "e08-stalled-task",
    sentinelCheckId: "e08-external-check-sentinel",
    createdAt,
  };
  const caveats = [
    "Disposable diagnostic data. Do not import into production or publish its private metadata.",
    "Historical WebP files are repeated across logical capture identities; this does not produce new browser captures.",
    "Each baseline capture has its own original key and protected copy, including repeated bytes; this measures 71,640 image objects at the default size.",
    "The review run is synthetic workflow attempt 2, inheriting verified-shaped attempt-1 capture and shard records at the same SHA and plan.",
    "SHA-256, encoded sizes, and WebP header dimensions are measured from real files. Profiles, provenance, test outcomes, comparison outcomes, and review events are synthetic.",
    "Review comparisons deliberately say changed for identical inherited bytes. No capture stability, pixel comparator, ingestion authorization, or real GitHub success is claimed.",
    "Auth values are obvious noncredential sentinels. Restoration must remove sessions and verification values, clear account tokens, and fence queued/external work.",
  ];
  try {
    writeSync(
      sqlFile,
      "-- Ariviso synthetic E08/SQL diagnostic fixture. NOT production capture evidence.\n",
    );
    for (const name of migrations) {
      const sql = readFileSync(join(migrationsDirectory, name), "utf8");
      database.exec(sql);
      // Migrations contain triggers; preserve their complete SQL, without splitting at semicolons.
      writeSync(sqlFile, `\n-- ${name}\n${sql}\n`);
    }
    database.exec("BEGIN");
    const paths = walk(corpusRoot);
    if (!paths.length) throw new Error("No screenshot WebP files found");
    const corpus = paths.map((sourcePath) => {
      const bytes = readFileSync(sourcePath);
      return {
        sourcePath,
        digest: digest(bytes),
        bytes: bytes.length,
        contentType: "image/webp",
        ...webpDimensions(bytes),
      };
    });
    const policy = {
      id: "synthetic-e08-state-fixture",
      channelThreshold: 0,
      maxChangedPixels: 0,
      maxChangedRatio: 0,
    };
    const policyDigest = digest(canonicalJson(policy));
    const profile = {
      browser: "chromium",
      browserVersion: "synthetic-unknown-archive-version",
      osImageDigest: digest("synthetic-os-profile-not-measured"),
      fontsDigest: digest("synthetic-fonts-not-measured"),
      viewport: { width: 8192, height: 8192 },
      deviceScaleFactor: 1,
      locale: "en-US",
      timezone: "UTC",
      reducedMotion: "reduce",
      colorScheme: "light",
      contrast: "no-preference",
      forcedColors: "none",
      animationPolicy: "disabled",
      captureOptions: { fullPage: false, animations: "disabled" },
      comparisonPolicyDigest: policyDigest,
      comparisonEngineVersion: "synthetic-e08-no-comparison",
    };
    const profileDigest = digest(canonicalJson(profile));
    const allowlistDigest = digest(canonicalJson([profileDigest]));
    const shardCount = Math.ceil(captureCount / shardSize);
    const shards = Array.from({ length: shardCount }, (_, index) => ({
      key: numbered("fixture-shard", index),
      jobName: numbered("Synthetic diagnostic job", index),
      environmentProfileDigests: [profileDigest],
      collection: {
        projectName: "synthetic-e08",
        testDir: "diagnostic",
        testMatch: ["**/*.fixture.ts"],
        testIgnore: [],
        grep: [{ source: ".*", flags: "" }],
        grepInvert: [],
        shard: { current: index + 1, total: shardCount },
        repeatEach: 1,
      },
    }));
    const publicPlan = {
      schemaVersion: "1.0",
      repositoryId: fixture.repositoryId,
      workflow: ".github/workflows/synthetic-e08.yml",
      invocation: ["diagnostic-only", "not-a-capture-job"],
      discovery: { executorDigest: digest("synthetic-e08-executor") },
      shards,
    };
    const planDigest = digest(canonicalJson(publicPlan));
    const planObject = addJson("plans/e08-trusted-plan.json", publicPlan, "trusted-plan");
    const internalPlan = {
      digest: planDigest,
      shards: shards.map((shard) => ({
        key: shard.key,
        profileDigest: allowlistDigest,
        environmentProfileDigests: [profileDigest],
        collection: shard.collection,
        tests: [],
        captures: [],
      })),
    };
    const captures = Array.from({ length: captureCount }, (_, index) => {
      const source = corpus[index % corpus.length];
      if (!source) throw new Error("Missing corpus image");
      return {
        index,
        itemKey: numbered("e08-item", Math.floor(index / 10)),
        variantKey: index % 10 === 0 ? "default" : `replica-${String(index % 10).padStart(2, "0")}`,
        testId: numbered("test", Math.floor(index / 10)),
        shardKey: shards[Math.floor(index / shardSize)].key,
        imageId: numbered("e08-image", index),
        baselineCaptureId: numbered("e08-baseline-capture", index),
        reviewCaptureId: numbered("e08-review-capture", index),
        baselineRowId: numbered("e08-baseline-row", index),
        reviewRowId: numbered("e08-review-row", index),
        source,
        originalKey: `runs/${fixture.baselineRunId}/originals/${numbered("image", index)}.webp`,
        baselineKey: `baselines/${fixture.snapshotId}/${numbered("image", index)}.webp`,
      };
    });
    const manifests = new Map();
    const shardRecords = new Map();
    for (let index = 0; index < shardCount; index += 1) {
      const shard = shards[index];
      const entries = captures.slice(index * shardSize, (index + 1) * shardSize);
      const tests = [...new Set(entries.map((capture) => capture.testId))];
      const testRecords = tests.map((id) => ({
        id,
        file: "diagnostic/synthetic.fixture.ts",
        titlePath: ["Synthetic replicated image fixture", id],
        retry: 0,
        status: "passed",
      }));
      const discovery = {
        executorDigest: publicPlan.discovery.executorDigest,
        configurationDigest: digest(canonicalJson(shard.collection)),
        inventoryDigest: digest(
          canonicalJson(testRecords.map(({ id, file, titlePath }) => ({ id, file, titlePath }))),
        ),
      };
      const manifest = {
        schemaVersion: "1.0",
        producer: {
          name: "@ariviso/playwright",
          version: "0.1.0",
          nodeVersion: "24.18.0",
          playwrightVersion: "1.63.0",
        },
        run: {
          repository: "diagnostic/ariviso-e08",
          repositoryId: fixture.repositoryId,
          workflowRunId: fixture.workflowRunId,
          workflowAttempt: 1,
          testedSha: fixture.testedSha,
          planDigest,
        },
        shard: { key: shard.key, jobId: String(908100000 + index), sourceAttempt: 1 },
        profiles: [{ digest: profileDigest, profile }],
        tests: testRecords,
        captures: entries.map((capture) => ({
          itemKey: capture.itemKey,
          name: `Synthetic corpus replica ${capture.index}`,
          variant: {
            key: capture.variantKey,
            browser: "chromium",
            framework: "diagnostic",
            colorScheme: "light",
            dimensions: { synthetic: true, replica: capture.index },
          },
          ordinal: capture.index,
          testId: capture.testId,
          testRetry: 0,
          profileDigest,
          image: {
            digest: capture.source.digest,
            mediaType: "image/webp",
            bytes: capture.source.bytes,
            width: capture.source.width,
            height: capture.source.height,
            path: `images/${capture.imageId}.webp`,
          },
        })),
        discovery,
      };
      const object = addJson(
        `manifests/${fixture.baselineRunId}/${shard.key}.json`,
        manifest,
        "capture-manifest",
        fixture.baselineRunId,
      );
      manifests.set(shard.key, object);
      const expected = {
        key: shard.key,
        profileDigest: allowlistDigest,
        environmentProfileDigests: [profileDigest],
        collection: shard.collection,
        tests,
        captures: entries.map((capture) => ({
          itemKey: capture.itemKey,
          variantKey: capture.variantKey,
          testId: capture.testId,
        })),
      };
      const fullProfileDigest = digest(
        JSON.stringify(
          entries
            .map((capture) => [capture.itemKey, capture.variantKey, profileDigest])
            .sort((left, right) =>
              JSON.stringify(left) < JSON.stringify(right)
                ? -1
                : JSON.stringify(left) > JSON.stringify(right)
                  ? 1
                  : 0,
            ),
        ),
      );
      shardRecords.set(shard.key, { expected, fullProfileDigest, discovery });
    }
    insert("ariviso_policies", [{ digest: policyDigest, policy_json: JSON.stringify(policy) }]);
    insert("ariviso_projects", [
      {
        id: fixture.projectId,
        repository_id: fixture.repositoryId,
        policy_digest: policyDigest,
        snapshot_id: fixture.snapshotId,
        promotion_id: fixture.promotionId,
        baseline_revision: 1,
        revision: 1,
        fresh_setup: 0,
      },
    ]);
    insert("user", [
      {
        id: fixture.actorId,
        name: "Synthetic E08 Maintainer",
        email: "e08@example.test",
        emailVerified: 1,
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    insert("session", [
      {
        id: "e08-auth-session-sentinel",
        userId: fixture.actorId,
        token: "DIAGNOSTIC_NOT_A_CREDENTIAL_SESSION",
        expiresAt: createdAt + 86_400_000,
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    insert("account", [
      {
        id: "e08-account-sentinel",
        accountId: "908000003",
        providerId: "github",
        userId: fixture.actorId,
        accessToken: "DIAGNOSTIC_NOT_A_CREDENTIAL_ACCESS",
        refreshToken: "DIAGNOSTIC_NOT_A_CREDENTIAL_REFRESH",
        idToken: "DIAGNOSTIC_NOT_A_CREDENTIAL_ID",
        accessTokenExpiresAt: createdAt + 86_400_000,
        refreshTokenExpiresAt: createdAt + 86_400_000,
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    insert("verification", [
      {
        id: "e08-verification-sentinel",
        identifier: "e08@example.test",
        value: "DIAGNOSTIC_NOT_A_CREDENTIAL_VERIFICATION",
        expiresAt: createdAt + 86_400_000,
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    insert("rateLimit", [
      { id: "e08-rate-limit", key: "e08-diagnostic", count: 1, lastRequest: createdAt },
    ]);
    insert("ingest_review_sessions", [
      {
        id: fixture.sessionId,
        auth_session_id: "e08-auth-session-sentinel",
        actor_id: fixture.actorId,
        created_at: createdAt,
      },
    ]);
    insert("ariviso_runs", [
      {
        id: fixture.baselineRunId,
        project_id: fixture.projectId,
        external_run_id: fixture.workflowRunId,
        attempt: 1,
        kind: "main",
        tested_sha: fixture.testedSha,
        lineage_key: "main",
        plan_digest: planDigest,
        plan_json: JSON.stringify(internalPlan),
        state: "superseded",
        active: 0,
        comparison_id: fixture.baselineComparisonId,
        revision: 5,
        sealed_at: createdAt + 1000,
        closed_at: createdAt + 2000,
        created_at: createdAt,
      },
      {
        id: fixture.reviewRunId,
        project_id: fixture.projectId,
        external_run_id: fixture.workflowRunId,
        attempt: 2,
        kind: "main",
        tested_sha: fixture.testedSha,
        lineage_key: "main",
        plan_digest: planDigest,
        plan_json: JSON.stringify(internalPlan),
        state: "reviewing",
        active: 1,
        comparison_id: fixture.reviewComparisonId,
        revision: 3,
        sealed_at: createdAt + 3000,
        closed_at: null,
        created_at: createdAt + 2000,
      },
    ]);
    insert(
      "work_retained_runs",
      [fixture.baselineRunId, fixture.reviewRunId].map((id) => ({
        id,
        object_prefix: `runs/${id}/`,
        closed_at: id === fixture.baselineRunId ? createdAt + 2000 : null,
      })),
    );
    insert("work_retention_pins", [
      {
        run_id: fixture.baselineRunId,
        owner: `baseline:${fixture.snapshotId}`,
        reason: "baseline",
      },
      {
        run_id: fixture.baselineRunId,
        owner: `inherited-by:${fixture.reviewRunId}`,
        reason: "comparison",
      },
      { run_id: fixture.reviewRunId, owner: `review:${fixture.reviewRunId}`, reason: "review" },
    ]);
    insert("ariviso_lineage", [
      {
        source_run_id: fixture.baselineRunId,
        target_run_id: fixture.reviewRunId,
        proof_digest: digest("synthetic-lineage-evidence-not-github-verification"),
      },
    ]);
    insert("ariviso_ancestry", [
      {
        run_id: fixture.reviewRunId,
        ancestor_sha: fixture.testedSha,
        proof_digest: digest("synthetic-ancestry-evidence"),
      },
    ]);
    insert(
      "ingest_run_provenance",
      [fixture.baselineRunId, fixture.reviewRunId].map((runId, index) => ({
        run_id: runId,
        verified_json: JSON.stringify({
          synthetic: true,
          repositoryId: fixture.repositoryId,
          workflowRunId: fixture.workflowRunId,
          workflowAttempt: index + 1,
          testedSha: fixture.testedSha,
          inheritedFromRunId: index ? fixture.baselineRunId : null,
        }),
        plan_object_key: planObject.key,
        last_checked_at: createdAt,
        created_at: createdAt,
      })),
    );
    insert(
      "ariviso_shards",
      [fixture.baselineRunId, fixture.reviewRunId].flatMap((runId) =>
        shards.map((shard) => ({
          run_id: runId,
          key: shard.key,
          profile_digest: allowlistDigest,
          expected_json: JSON.stringify(shardRecords.get(shard.key).expected),
          state: "complete",
          manifest_digest: manifests.get(shard.key).digest,
          full_profile_digest: shardRecords.get(shard.key).fullProfileDigest,
          discovery_json: JSON.stringify(shardRecords.get(shard.key).discovery),
          source_run_id: fixture.baselineRunId,
          source_attempt: 1,
        })),
      ),
    );
    insert(
      "ingest_manifests",
      [fixture.baselineRunId, fixture.reviewRunId].flatMap((runId) =>
        shards.map((shard, index) => ({
          run_id: runId,
          shard_key: shard.key,
          digest: manifests.get(shard.key).digest,
          object_key: manifests.get(shard.key).key,
          job_id: String(908100000 + index),
          capture_count: Math.min(shardSize, captureCount - index * shardSize),
          finalized: 1,
          created_at: createdAt,
        })),
      ),
    );
    insert(
      "ariviso_images",
      captures.map((capture) => ({
        id: capture.imageId,
        run_id: fixture.baselineRunId,
        digest: capture.source.digest,
        object_key: capture.originalKey,
        content_type: "image/webp",
        bytes: capture.source.bytes,
        width: capture.source.width,
        height: capture.source.height,
      })),
    );
    for (const capture of captures) {
      for (const [key, role] of [
        [capture.originalKey, "original"],
        [capture.baselineKey, "baseline"],
      ]) {
        objects.push({
          bucket: "images",
          key,
          sourcePath: capture.source.sourcePath,
          digest: capture.source.digest,
          bytes: capture.source.bytes,
          contentType: "image/webp",
          width: capture.source.width,
          height: capture.source.height,
          role,
          runId: fixture.baselineRunId,
        });
      }
    }
    for (const [runId, inherited] of [
      [fixture.baselineRunId, false],
      [fixture.reviewRunId, true],
    ]) {
      insert(
        "ariviso_captures",
        captures.map((capture) => ({
          id: inherited ? capture.reviewCaptureId : capture.baselineCaptureId,
          run_id: runId,
          shard_key: capture.shardKey,
          item_key: capture.itemKey,
          variant_key: capture.variantKey,
          ordinal: capture.index,
          image_id: capture.imageId,
          profile_digest: profileDigest,
          test_id: capture.testId,
          test_retry: 0,
          metadata_json: JSON.stringify({
            synthetic: true,
            name: `Synthetic corpus replica ${capture.index}`,
            sourceCorpusPath: relative(corpusRoot, capture.source.sourcePath),
            sourceAttempt: 1,
            profile,
            variant: {
              key: capture.variantKey,
              browser: "chromium",
              framework: "diagnostic",
              colorScheme: "light",
            },
          }),
        })),
      );
    }
    insert("ariviso_snapshots", [
      {
        id: fixture.snapshotId,
        project_id: fixture.projectId,
        run_id: fixture.baselineRunId,
        comparison_id: fixture.baselineComparisonId,
        tested_sha: fixture.testedSha,
        state: "accepted",
        reference_eligible: 1,
        prefix: `baselines/${fixture.snapshotId}`,
        created_at: createdAt + 1500,
      },
    ]);
    insert("ariviso_comparisons", [
      {
        id: fixture.baselineComparisonId,
        run_id: fixture.baselineRunId,
        reference_snapshot_id: null,
        baseline_revision: 0,
        policy_digest: policyDigest,
        ordinal: 1,
        state: "ready",
        created_at: createdAt + 1000,
      },
      {
        id: fixture.reviewComparisonId,
        run_id: fixture.reviewRunId,
        reference_snapshot_id: fixture.snapshotId,
        baseline_revision: 1,
        policy_digest: policyDigest,
        ordinal: 1,
        state: "ready",
        created_at: createdAt + 3000,
      },
    ]);
    const tuple = (capture, reference) =>
      JSON.stringify({
        projectId: fixture.projectId,
        itemKey: capture.itemKey,
        variantKey: capture.variantKey,
        referenceDigest: reference ? capture.source.digest : null,
        candidateDigest: capture.source.digest,
        referenceProfileDigest: reference ? profileDigest : null,
        candidateProfileDigest: profileDigest,
        comparisonPolicyDigest: policyDigest,
      });
    for (const baseline of [true, false]) {
      insert(
        "ariviso_comparison_rows",
        captures.map((capture) => ({
          id: baseline ? capture.baselineRowId : capture.reviewRowId,
          comparison_id: baseline ? fixture.baselineComparisonId : fixture.reviewComparisonId,
          item_key: capture.itemKey,
          variant_key: capture.variantKey,
          ordinal: capture.index,
          reference_capture_id: baseline ? null : capture.baselineCaptureId,
          candidate_capture_id: baseline ? capture.baselineCaptureId : capture.reviewCaptureId,
          tuple_json: tuple(capture, !baseline),
          outcome: "changed",
          result_json: JSON.stringify({
            outcome: "changed",
            changedPixels: baseline ? capture.source.width * capture.source.height : 1,
            ratio: baseline ? 1 : 1 / (capture.source.width * capture.source.height),
            engineVersion: "synthetic-state-fixture",
            codecVersion: "webp-header-only-not-decoded",
            synthetic: true,
          }),
          decision_revision: baseline ? 2 : 0,
          decision_id: baseline ? numbered("e08-human-decision", capture.index) : null,
          source_decision_id: null,
        })),
      );
    }
    insert(
      "ariviso_decisions",
      captures.flatMap((capture) => [
        {
          id: numbered("e08-automatic-decision", capture.index),
          row_id: capture.baselineRowId,
          revision: 1,
          verdict: "approved",
          kind: "automatic",
          actor_id: null,
          command_id: null,
          revoked: 1,
          tuple_json: tuple(capture, false),
          created_at: createdAt + 1000,
        },
        {
          id: numbered("e08-human-decision", capture.index),
          row_id: capture.baselineRowId,
          revision: 2,
          verdict: "approved",
          kind: "human",
          actor_id: fixture.actorId,
          command_id: numbered("e08-baseline-command", Math.floor(capture.index / 10)),
          revoked: 0,
          tuple_json: tuple(capture, false),
          created_at: createdAt + 1200,
        },
      ]),
    );
    const commands = [];
    for (let offset = 0; offset < captureCount; offset += 10) {
      const entries = captures.slice(offset, offset + 10);
      const commandId = numbered("e08-baseline-command", Math.floor(offset / 10));
      const selection = { itemKey: entries[0].itemKey, variantKey: entries[0].variantKey };
      commands.push({
        id: commandId,
        request_json: JSON.stringify({
          commandId,
          actorId: fixture.actorId,
          sessionId: fixture.sessionId,
          comparisonId: fixture.baselineComparisonId,
          verdict: "approved",
          targets: entries.map((capture) => ({ id: capture.baselineRowId, expectedRevision: 1 })),
          wholeItemKey: selection.itemKey,
          selection,
        }),
        actor_id: fixture.actorId,
        session_id: fixture.sessionId,
        kind: "approve",
        comparison_id: fixture.baselineComparisonId,
        previous_json: JSON.stringify({
          decisions: entries.map((capture) => ({
            id: capture.baselineRowId,
            decisionId: numbered("e08-automatic-decision", capture.index),
            sourceDecisionId: null,
            revision: 1,
          })),
          rollback: null,
        }),
        result_json: JSON.stringify({
          commandId,
          revisions: entries.map((capture) => ({ id: capture.baselineRowId, expectedRevision: 2 })),
          selection,
          baselineRevision: 0,
          promotionId: null,
        }),
        created_at: createdAt + 1200,
      });
    }
    insert("ariviso_commands", commands);
    insert(
      "ariviso_audit",
      commands.map((command) => ({
        id: `audit:${command.id}`,
        project_id: fixture.projectId,
        run_id: fixture.baselineRunId,
        actor_id: fixture.actorId,
        action: "approve",
        detail_json: JSON.stringify({ synthetic: true, commandId: command.id }),
        created_at: command.created_at,
      })),
    );
    insert(
      "ariviso_reservations",
      captures.map((capture) => ({
        project_id: fixture.projectId,
        lineage_key: "main",
        item_key: capture.itemKey,
        variant_key: capture.variantKey,
        kind: "introduction",
        decision_id: numbered("e08-automatic-decision", capture.index),
      })),
    );
    insert(
      "ariviso_identity_history",
      captures.map((capture) => ({
        project_id: fixture.projectId,
        lineage_key: "main",
        item_key: capture.itemKey,
        variant_key: capture.variantKey,
      })),
    );
    insert(
      "ariviso_snapshot_images",
      captures.map((capture) => ({
        snapshot_id: fixture.snapshotId,
        capture_id: capture.baselineCaptureId,
        image_id: capture.imageId,
        object_key: capture.baselineKey,
        digest: capture.source.digest,
        copied: 1,
      })),
    );
    insert("ariviso_promotions", [
      {
        id: fixture.promotionId,
        project_id: fixture.projectId,
        snapshot_id: fixture.snapshotId,
        previous_snapshot_id: null,
        comparison_id: fixture.baselineComparisonId,
        baseline_revision: 1,
        command_id: null,
        revoked: 0,
        created_at: createdAt + 1500,
      },
    ]);
    insert("ariviso_pins", [
      {
        snapshot_id: fixture.snapshotId,
        reason: "comparison",
        owner_id: fixture.reviewComparisonId,
      },
    ]);
    insert("work_tasks", [
      {
        id: fixture.sentinelTaskId,
        kind: "diagnostic-sentinel",
        payload: JSON.stringify({ synthetic: true, purpose: "restore-must-fence" }),
        state: "leased",
        attempts: 1,
        max_attempts: 3,
        available_at: createdAt,
        lease_token: "DIAGNOSTIC_OLD_WORKER_TOKEN",
        lease_until: createdAt + 86_400_000,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ]);
    insert("work_checks", [
      {
        id: fixture.sentinelCheckId,
        desired_revision: 1,
        delivered_revision: null,
        lease_token: "DIAGNOSTIC_OLD_EXTERNAL_TOKEN",
        lease_until: createdAt + 86_400_000,
        lease_revision: 1,
        request_started: 1,
        ambiguous: 0,
      },
    ]);
    insert("work_status_outbox", [
      {
        check_id: fixture.sentinelCheckId,
        revision: 1,
        run_id: fixture.reviewRunId,
        attempt: 2,
        comparison_revision: 1,
        source_revision: 3,
        conclusion: "pending",
        details_url: "https://diagnostic.invalid/runs/e08-review",
        state: "sending",
        attempts: 1,
        max_attempts: 3,
        available_at: createdAt,
      },
    ]);
    insert("ariviso_status_outbox", [
      {
        id: "e08-domain-outbox",
        run_id: fixture.reviewRunId,
        run_revision: 3,
        created_at: createdAt + 3000,
        delivered_at: null,
      },
    ]);
    insert("operations_check_creations", [
      {
        run_id: fixture.reviewRunId,
        external_id: "e08-synthetic-check-never-send",
        state: "creating",
        request_started: 1,
        attempts: 1,
        lease_token: "DIAGNOSTIC_OLD_CREATION_TOKEN",
        lease_until: createdAt + 86_400_000,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ]);
    const violations = database.prepare("PRAGMA foreign_key_check").all();
    if (violations.length)
      throw new Error(`Fixture foreign-key violations: ${JSON.stringify(violations)}`);
    const integrity = database.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok")
      throw new Error(`Fixture integrity failure: ${JSON.stringify(integrity)}`);
    database.exec("COMMIT");
    writeSql("PRAGMA foreign_key_check;");
    const metrics = {
      corpusFiles: corpus.length,
      distinctCorpusDigests: new Set(corpus.map((entry) => entry.digest)).size,
      corpusBytes: corpus.reduce((total, entry) => total + entry.bytes, 0),
      captureRows: captureCount * 2,
      baselineChangedHumanApprovedRows: captureCount,
      reviewChangedPendingRows: captureCount,
      imageRows: captureCount,
      protectedSnapshotRows: captureCount,
      imageObjects: captureCount * 2,
      metadataObjects: objects.filter((entry) => entry.bucket === "quarantine").length,
      objectCount: objects.length,
      imageBytes: objects
        .filter((entry) => entry.bucket === "images")
        .reduce((total, entry) => total + entry.bytes, 0),
      metadataBytes: objects
        .filter((entry) => entry.bucket === "quarantine")
        .reduce((total, entry) => total + entry.bytes, 0),
      shardsPerRun: shardCount,
      baselineHumanCommands: commands.length,
      baselineAutomaticDecisions: captureCount,
      sql: sqlMetrics,
      foreignKeyViolations: 0,
      integrity: "ok",
    };
    const manifest = {
      schemaVersion: "1.0",
      synthetic: true,
      fixture,
      caveats,
      metrics,
      policy: { digest: policyDigest, policy },
      profile: { digest: profileDigest, profile },
      migrations: migrations.map((name) => ({
        name,
        digest: digest(readFileSync(join(migrationsDirectory, name))),
      })),
      objects,
    };
    writeFileSync(join(output, "seed-objects.json"), JSON.stringify(manifest));
    writeFileSync(
      join(output, "fixture-summary.json"),
      JSON.stringify({ ...manifest, objects: undefined }, null, 2),
    );
    return {
      output,
      sqlPath,
      databasePath,
      manifestPath: join(output, "seed-objects.json"),
      fixture,
      metrics,
      caveats,
    };
  } finally {
    database.close();
    closeSync(sqlFile);
  }
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const result = generateFixture(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
