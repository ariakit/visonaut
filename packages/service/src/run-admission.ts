import { assertion, atomic, ConflictError, IncompleteError, statement } from "./database.ts";
import { materializeLineageStatements } from "./lineage.ts";
import { touchRunStatusStatements } from "./status-touch.ts";
import type { Database, SqlValue } from "./database.ts";
import type { CommitShardParams, ReserveRunParams, RunRow, ValidatedImage } from "./types.ts";
import type { Service } from "./service.ts";
import { projectGuard, activeGuard } from "./run-guards.ts";
import { auditRunChange } from "./service-audit.ts";
import { reviewTaskRetirementPageSize } from "./run-retirement.ts";

async function readOne<T>(database: Database, sql: string, values: SqlValue[] = []) {
  const row = await statement(database, sql, values).first<T>();
  if (!row) {
    throw new IncompleteError("The requested record does not exist.");
  }
  return row;
}

export const maximumImageRegistrationBatchSize = 50;

export async function captureProfilesDigest(
  captures: ReadonlyArray<{ itemKey: string; variantKey: string; profileDigest: string }>,
) {
  const profiles = captures
    .map((capture) => [capture.itemKey, capture.variantKey, capture.profileDigest])
    .sort((left, right) =>
      JSON.stringify(left) < JSON.stringify(right)
        ? -1
        : JSON.stringify(left) > JSON.stringify(right)
          ? 1
          : 0,
    );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(profiles)),
  );
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function identity(itemKey: string, variantKey: string) {
  return JSON.stringify([itemKey, variantKey]);
}

export async function reserveRun(service: Service, input: ReserveRunParams) {
  if (!input.verificationDigest || !input.lineageKey || input.plan.shards.length === 0) {
    throw new IncompleteError("A verified full plan and lineage are required.");
  }
  const precreatedCheck = input.precreatedCheck;
  if (
    precreatedCheck &&
    (precreatedCheck.testedSha !== input.testedSha ||
      precreatedCheck.workflowRunId !== input.externalRunId ||
      precreatedCheck.workflowAttempt !== input.attempt ||
      !precreatedCheck.repositoryId ||
      !precreatedCheck.externalId ||
      !precreatedCheck.checkId)
  ) {
    throw new IncompleteError("The existing App check belongs to another workflow attempt.");
  }
  const existing = await statement(
    service.database,
    "SELECT * FROM visonaut_runs WHERE project_id = ? AND external_run_id = ? AND attempt = ?",
    [input.projectId, input.externalRunId, input.attempt],
  ).first<RunRow & { plan_json: string }>();
  if (existing) {
    if (
      existing.tested_sha !== input.testedSha ||
      existing.plan_digest !== input.plan.digest ||
      existing.plan_json !== JSON.stringify(input.plan) ||
      existing.lineage_key !== input.lineageKey
    ) {
      throw new ConflictError("The run identity already has different trusted metadata.", existing);
    }
    return existing;
  }
  const project = await service.project(input.projectId);
  // D1 limits a stored TEXT value to 2 MB; leave room for row metadata.
  if (new TextEncoder().encode(JSON.stringify(input.plan)).byteLength > 1_500_000) {
    throw new IncompleteError("The trusted plan is too large for one run record.");
  }
  const keys = new Set<string>();
  const identities = new Set<string>();
  for (const shard of input.plan.shards) {
    if (
      keys.has(shard.key) ||
      (shard.environmentProfilePolicy === "measured" &&
        shard.environmentProfileDigests !== undefined) ||
      (shard.sourceAttempt !== undefined &&
        (!Number.isSafeInteger(shard.sourceAttempt) ||
          shard.sourceAttempt < 1 ||
          shard.sourceAttempt > input.attempt)) ||
      (!shard.discovery && (shard.tests.length === 0 || shard.captures.length === 0)) ||
      (shard.discovery && (!shard.discovery.executorDigest || !shard.discovery.configurationDigest))
    ) {
      throw new IncompleteError("Each trusted shard needs unique identity, tests, and captures.");
    }
    keys.add(shard.key);
    for (const capture of shard.captures) {
      const key = identity(capture.itemKey, capture.variantKey);
      if (identities.has(key) || !shard.tests.includes(capture.testId)) {
        throw new IncompleteError("The trusted plan contains a duplicate or unaccounted capture.");
      }
      identities.add(key);
    }
  }
  for (const key of input.rerunShardKeys) {
    if (!keys.has(key)) {
      throw new IncompleteError("An unknown shard was marked as rerun.");
    }
  }
  const statements = [
    projectGuard(service.database, project),
    assertion(
      service.database,
      "NOT EXISTS (SELECT 1 FROM visonaut_runs WHERE project_id = ? AND external_run_id = ? AND attempt >= ?)",
      [input.projectId, input.externalRunId, input.attempt],
    ),
    statement(
      service.database,
      "UPDATE visonaut_runs SET active = 0, state = 'superseded', closed_at = COALESCE(closed_at, ?), revision = revision + 1 WHERE project_id = ? AND external_run_id = ? AND active = 1",
      [input.now, input.projectId, input.externalRunId],
    ),
    statement(
      service.database,
      `UPDATE work_tasks SET state = 'complete', result = 'superseded',
          lease_token = NULL, lease_until = NULL, publication_token = NULL,
          last_error = NULL, updated_at = ?
        WHERE id IN (SELECT task.id FROM work_tasks task
          JOIN visonaut_comparison_rows row ON row.id = task.id
          JOIN visonaut_comparisons comparison ON comparison.id = row.comparison_id
          JOIN visonaut_runs run ON run.id = comparison.run_id
          WHERE task.kind = 'compare' AND task.state IN ('queued', 'leased')
            AND comparison.purpose = 'review' AND run.project_id = ?
            AND run.external_run_id = ? AND run.active = 0
          ORDER BY task.id LIMIT ?)`,
      [input.now, input.projectId, input.externalRunId, reviewTaskRetirementPageSize],
    ),
    statement(
      service.database,
      "UPDATE work_retained_runs SET closed_at = COALESCE(closed_at, ?) WHERE id IN (SELECT id FROM visonaut_runs WHERE project_id = ? AND external_run_id = ? AND active = 0)",
      [input.now, input.projectId, input.externalRunId],
    ),
    statement(
      service.database,
      "DELETE FROM work_retention_pins WHERE reason = 'review' AND owner IN (SELECT 'review:' || id FROM visonaut_runs WHERE project_id = ? AND external_run_id = ? AND active = 0)",
      [input.projectId, input.externalRunId],
    ),
    statement(
      service.database,
      "INSERT INTO visonaut_runs (id, project_id, external_run_id, attempt, kind, tested_sha, lineage_key, plan_digest, plan_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        input.id,
        input.projectId,
        input.externalRunId,
        input.attempt,
        input.kind,
        input.testedSha,
        input.lineageKey,
        input.plan.digest,
        JSON.stringify(input.plan),
        input.now,
      ],
    ),
    statement(
      service.database,
      "INSERT INTO work_retained_runs (id, object_prefix) VALUES (?, ?)",
      [input.id, `runs/${input.id}/`],
    ),
    statement(
      service.database,
      "INSERT INTO work_retention_pins (run_id, owner, reason) VALUES (?, ?, 'review')",
      [input.id, `review:${input.id}`],
    ),
  ];
  if (precreatedCheck) {
    statements.push(
      assertion(
        service.database,
        "EXISTS (SELECT 1 FROM ingest_staged_runs WHERE id = ? AND repository_id = ? AND workflow_run_id = ? AND workflow_attempt = ? AND tested_sha = ? AND submitted_at IS NOT NULL AND retention_state = 'live')",
        [
          input.id,
          precreatedCheck.repositoryId,
          precreatedCheck.workflowRunId,
          precreatedCheck.workflowAttempt,
          precreatedCheck.testedSha,
        ],
      ),
      assertion(
        service.database,
        "EXISTS (SELECT 1 FROM pre_run_checks WHERE repository_id = ? AND tested_sha = ? AND workflow_run_id = ? AND workflow_attempt = ? AND external_id = ? AND check_id = ? AND state = 'active' AND docs_only = 0)",
        [
          precreatedCheck.repositoryId,
          precreatedCheck.testedSha,
          precreatedCheck.workflowRunId,
          precreatedCheck.workflowAttempt,
          precreatedCheck.externalId,
          precreatedCheck.checkId,
        ],
      ),
      statement(
        service.database,
        "INSERT INTO operations_check_creations (run_id, external_id, check_id, state, request_started, attempts, created_at, updated_at) VALUES (?, ?, ?, 'complete', 1, 1, ?, ?)",
        [input.id, precreatedCheck.externalId, precreatedCheck.checkId, input.now, input.now],
      ),
    );
  }
  if (input.maximumActiveRuns !== undefined) {
    if (!Number.isSafeInteger(input.maximumActiveRuns) || input.maximumActiveRuns < 1)
      throw new IncompleteError("The active run admission limit is invalid.");
    statements.push(
      assertion(
        service.database,
        "(SELECT COUNT(*) FROM visonaut_runs WHERE active=1 AND state IN ('uploading','comparing')) <= ?",
        [input.maximumActiveRuns],
      ),
    );
  }
  for (const sourceId of new Set(input.verifiedRelatedRunIds)) {
    statements.push(
      assertion(
        service.database,
        "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND project_id = ?)",
        [sourceId, input.projectId],
      ),
    );
    statements.push(
      statement(
        service.database,
        "INSERT INTO visonaut_lineage_edges (source_run_id, target_run_id, proof_digest) VALUES (?, ?, ?)",
        [sourceId, input.id, input.verificationDigest],
      ),
    );
  }
  statements.push(
    ...materializeLineageStatements(service.database, input.id, input.verificationDigest),
  );
  for (const sha of new Set(input.verifiedAncestorShas)) {
    statements.push(
      statement(
        service.database,
        "INSERT INTO visonaut_ancestry (run_id, ancestor_sha, proof_digest) VALUES (?, ?, ?)",
        [input.id, sha, input.verificationDigest],
      ),
    );
  }
  for (const shard of input.plan.shards) {
    statements.push(
      statement(
        service.database,
        "INSERT INTO visonaut_shards (run_id, key, profile_digest, expected_json) VALUES (?, ?, ?, ?)",
        [input.id, shard.key, shard.profileDigest, JSON.stringify(shard)],
      ),
    );
  }
  if (input.inheritFromRunId) {
    statements.push(
      assertion(
        service.database,
        "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND project_id = ? AND external_run_id = ? AND tested_sha = ? AND plan_digest = ? AND attempt < ?)",
        [
          input.inheritFromRunId,
          input.projectId,
          input.externalRunId,
          input.testedSha,
          input.plan.digest,
          input.attempt,
        ],
      ),
    );
    for (const [shardIndex, shard] of input.plan.shards.entries()) {
      if (input.rerunShardKeys.includes(shard.key)) continue;
      const inherited = input.verifiedInheritedShards?.find((entry) => entry.key === shard.key);
      if (!inherited) {
        throw new IncompleteError(
          "Each inherited shard requires verified manifest and full capture-profile identity.",
        );
      }
      statements.push(
        assertion(
          service.database,
          "EXISTS (SELECT 1 FROM visonaut_shards WHERE run_id = ? AND key = ? AND manifest_digest = ? AND full_profile_digest = ?)",
          [
            input.inheritFromRunId,
            shard.key,
            inherited.manifestDigest,
            inherited.captureProfileDigest,
          ],
        ),
      );
      statements.push(
        assertion(
          service.database,
          "EXISTS (SELECT 1 FROM visonaut_shards WHERE run_id = ? AND key = ? AND state = 'complete' AND profile_digest = ?)",
          [input.inheritFromRunId, shard.key, shard.profileDigest],
        ),
      );
      statements.push(
        statement(
          service.database,
          "UPDATE visonaut_shards SET state = 'complete', manifest_digest = (SELECT manifest_digest FROM visonaut_shards WHERE run_id = ? AND key = ?), full_profile_digest = ?, expected_json = (SELECT expected_json FROM visonaut_shards WHERE run_id = ? AND key = ?), discovery_json = (SELECT discovery_json FROM visonaut_shards WHERE run_id = ? AND key = ?), source_run_id = ?, source_attempt = (SELECT COALESCE(shard.source_attempt, source.attempt) FROM visonaut_shards shard JOIN visonaut_runs source ON source.id = shard.run_id WHERE shard.run_id = ? AND shard.key = ?) WHERE run_id = ? AND key = ?",
          [
            input.inheritFromRunId,
            shard.key,
            inherited.captureProfileDigest,
            input.inheritFromRunId,
            shard.key,
            input.inheritFromRunId,
            shard.key,
            input.inheritFromRunId,
            input.inheritFromRunId,
            shard.key,
            input.id,
            shard.key,
          ],
        ),
      );
      // A committed shard has unique ordinals; reuse them without growing IDs
      // with each workflow rerun. The plan index separates different shards.
      statements.push(
        statement(
          service.database,
          "INSERT INTO visonaut_captures (id, run_id, shard_key, item_key, variant_key, ordinal, image_id, profile_digest, test_id, test_retry, metadata_json) SELECT ? || ':inherited:' || ? || ':' || ordinal, ?, shard_key, item_key, variant_key, ordinal, image_id, profile_digest, test_id, test_retry, metadata_json FROM visonaut_captures WHERE run_id = ? AND shard_key = ?",
          [input.id, shardIndex, input.id, input.inheritFromRunId, shard.key],
        ),
      );
    }
  }
  statements.push(
    statement(
      service.database,
      "INSERT INTO work_retention_pins (run_id, owner, reason) SELECT DISTINCT image.run_id, ?, 'comparison' FROM visonaut_captures capture JOIN visonaut_images image ON image.id = capture.image_id WHERE capture.run_id = ? AND image.run_id != ? ON CONFLICT(run_id, owner) DO NOTHING",
      [`inherited-by:${input.id}`, input.id, input.id],
    ),
  );
  statements.push(
    statement(
      service.database,
      "UPDATE visonaut_projects SET revision = revision + 1 WHERE id = ?",
      [project.id],
    ),
  );
  statements.push(
    statement(
      service.database,
      "UPDATE work_checks SET desired_revision = (SELECT revision FROM visonaut_projects WHERE id = ?) WHERE id IN (SELECT id FROM visonaut_checks WHERE project_id = ? AND external_run_id=?)",
      [project.id, project.id, input.externalRunId],
    ),
  );
  await atomic(service.database, statements);
  return service.run(input.id);
}

export async function registerImage(service: Service, image: ValidatedImage) {
  await service.registerImages([image]);
}

export async function registerImages(service: Service, images: readonly ValidatedImage[]) {
  const first = images[0];
  if (
    !first ||
    images.length > maximumImageRegistrationBatchSize ||
    images.some((image) => image.runId !== first.runId)
  ) {
    throw new IncompleteError("Image registration requires 1–50 images from one run.");
  }
  const run = await service.run(first.runId);
  const entries = JSON.stringify(images);
  await atomic(service.database, [
    activeGuard(service.database, run),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND sealed_at IS NULL AND state = 'uploading')",
      [run.id],
    ),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM work_retained_runs WHERE id = ? AND byte_state = 'live')",
      [run.id],
    ),
    statement(
      service.database,
      `INSERT INTO visonaut_images (id, run_id, digest, object_key, content_type, bytes, width, height, role)
          SELECT json_extract(value, '$.id'), json_extract(value, '$.runId'),
            json_extract(value, '$.digest'), json_extract(value, '$.objectKey'),
            json_extract(value, '$.contentType'), json_extract(value, '$.bytes'),
            json_extract(value, '$.width'), json_extract(value, '$.height'), COALESCE(json_extract(value,'$.role'),'original')
          FROM json_each(?) WHERE true ON CONFLICT(id) DO NOTHING`,
      [entries],
    ),
    assertion(
      service.database,
      `NOT EXISTS (SELECT 1 FROM json_each(?) entry WHERE NOT EXISTS (
          SELECT 1 FROM visonaut_images image
          WHERE image.id = json_extract(entry.value, '$.id') AND image.run_id = ?
            AND image.digest = json_extract(entry.value, '$.digest')
            AND image.object_key = json_extract(entry.value, '$.objectKey')
            AND image.bytes = json_extract(entry.value, '$.bytes')
            AND image.width = json_extract(entry.value, '$.width')
            AND image.height = json_extract(entry.value, '$.height')
            AND image.content_type = json_extract(entry.value, '$.contentType')
            AND image.role = COALESCE(json_extract(entry.value,'$.role'),'original')))`,
      [entries, run.id],
    ),
  ]);
}

export async function commitShard(service: Service, input: CommitShardParams) {
  const run = await service.run(input.runId);
  const shard = await readOne<{
    state: string;
    manifest_digest: string | null;
    expected_json: string;
  }>(service.database, "SELECT * FROM visonaut_shards WHERE run_id = ? AND key = ?", [
    run.id,
    input.key,
  ]);
  if (shard.state === "complete") {
    if (shard.manifest_digest !== input.manifestDigest) {
      throw new ConflictError("The sealed shard has a different manifest.");
    }
    return;
  }
  let expected = JSON.parse(shard.expected_json) as ReserveRunParams["plan"]["shards"][number];
  if (expected.discovery) {
    const proof = input.verifiedDiscovery;
    if (
      !proof ||
      proof.executorDigest !== expected.discovery.executorDigest ||
      proof.configurationDigest !== expected.discovery.configurationDigest ||
      proof.externalRunId !== run.external_run_id ||
      proof.attempt !== (expected.sourceAttempt ?? run.attempt) ||
      proof.testedSha !== run.tested_sha ||
      !proof.verificationDigest ||
      !proof.inventoryDigest ||
      !proof.jobId
    ) {
      throw new IncompleteError(
        "Candidate discovery needs verified successful-job evidence from the trusted executor and configuration.",
      );
    }
    const identities = new Set(
      proof.captures.map((capture) => identity(capture.itemKey, capture.variantKey)),
    );
    if (
      proof.tests.length === 0 ||
      proof.captures.length === 0 ||
      new Set(proof.tests).size !== proof.tests.length ||
      identities.size !== proof.captures.length ||
      proof.captures.some((capture) => !proof.tests.includes(capture.testId))
    ) {
      throw new IncompleteError(
        "The verified candidate inventory is empty, duplicated, or incomplete.",
      );
    }
    expected = { ...expected, tests: proof.tests, captures: proof.captures };
  } else if (input.verifiedDiscovery) {
    throw new IncompleteError("This trusted shard does not permit candidate discovery.");
  }
  const outcomes = new Map(input.finalTestOutcomes.map((outcome) => [outcome.testId, outcome]));
  if (outcomes.size !== expected.tests.length || outcomes.size !== input.finalTestOutcomes.length) {
    throw new IncompleteError("The shard must report every required test exactly once.");
  }
  for (const testId of expected.tests) {
    if (outcomes.get(testId)?.status !== "passed") {
      throw new IncompleteError("A required test did not pass its final attempt.");
    }
  }
  const captures = new Map(
    input.captures.map((capture) => [identity(capture.itemKey, capture.variantKey), capture]),
  );
  if (captures.size !== expected.captures.length || captures.size !== input.captures.length) {
    throw new IncompleteError("The shard must contain every required capture exactly once.");
  }
  for (const required of expected.captures) {
    const capture = captures.get(identity(required.itemKey, required.variantKey));
    if (
      !capture ||
      capture.testId !== required.testId ||
      (expected.environmentProfilePolicy !== "measured" &&
        !(expected.environmentProfileDigests ?? [expected.profileDigest]).includes(
          capture.environmentProfileDigest,
        )) ||
      capture.testRetry !== outcomes.get(required.testId)?.retry
    ) {
      throw new IncompleteError(
        "A capture does not match the trusted plan or final successful test attempt.",
      );
    }
  }
  let previousOrdinal = -1;
  for (const capture of input.captures) {
    if (!Number.isSafeInteger(capture.ordinal) || capture.ordinal <= previousOrdinal) {
      throw new IncompleteError("Capture ordinals must increase in declared shard order.");
    }
    previousOrdinal = capture.ordinal;
  }
  // Staged rows stay private until the shard and full run are sealed. Separate
  // batches bound SQL size while a crash can safely replay the same manifest.
  for (let offset = 0; offset < input.captures.length; offset += 100) {
    const captures = JSON.stringify(
      input.captures
        .slice(offset, offset + 100)
        .map((capture) => ({ ...capture, metadataJson: JSON.stringify(capture.metadata) })),
    );
    await atomic(service.database, [
      activeGuard(service.database, run),
      assertion(
        service.database,
        "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND sealed_at IS NULL)",
        [run.id],
      ),
      assertion(
        service.database,
        "EXISTS (SELECT 1 FROM work_retained_runs WHERE id = ? AND byte_state = 'live')",
        [run.id],
      ),
      assertion(
        service.database,
        `NOT EXISTS (SELECT 1 FROM json_each(?) staged WHERE NOT EXISTS (SELECT 1 FROM visonaut_images image WHERE image.id = json_extract(staged.value, '$.imageId') AND image.bytes_present = 1 AND image.validated=1 AND (image.run_id = ? OR (
            json_extract(staged.value,'$.metadata.candidateStored')=0 AND json_extract(staged.value,'$.metadata.localResult.outcome')='unchanged'
            AND EXISTS(SELECT 1 FROM visonaut_snapshot_images member JOIN visonaut_captures reference ON reference.id=member.capture_id
              WHERE member.snapshot_id=? AND member.image_id=image.id AND member.copied=1
              AND reference.item_key=json_extract(staged.value,'$.itemKey') AND reference.variant_key=json_extract(staged.value,'$.variantKey')
              AND (COALESCE((SELECT rendering_digest FROM visonaut_capture_profiles WHERE digest=reference.profile_digest),reference.profile_digest)=json_extract(staged.value,'$.profileDigest')
                OR (json_extract(staged.value,'$.metadata.localResult.changedPixels')=0
                  AND json_extract(staged.value,'$.metadata.localResult.ratio')=0
                  AND image.width=json_extract(staged.value,'$.metadata.observedImage.width')
                  AND image.height=json_extract(staged.value,'$.metadata.observedImage.height')
                  AND json_extract(staged.value,'$.metadata.localResult.maskImageId') IS NULL
                  AND json_extract(staged.value,'$.metadata.localResult.maskExpected') IS NOT 1)))))))`,
        [captures, run.id, input.localReferenceSnapshotId ?? null],
      ),
      statement(
        service.database,
        "INSERT INTO visonaut_captures (id, run_id, shard_key, item_key, variant_key, ordinal, image_id, profile_digest, test_id, test_retry, metadata_json) SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.itemKey'), json_extract(value, '$.variantKey'), json_extract(value, '$.ordinal'), json_extract(value, '$.imageId'), json_extract(value, '$.profileDigest'), json_extract(value, '$.testId'), json_extract(value, '$.testRetry'), json_extract(value, '$.metadataJson') FROM json_each(?) WHERE true ON CONFLICT(id) DO NOTHING",
        [run.id, input.key, captures],
      ),
      assertion(
        service.database,
        "NOT EXISTS (SELECT 1 FROM json_each(?) staged WHERE NOT EXISTS (SELECT 1 FROM visonaut_captures capture WHERE capture.id = json_extract(staged.value, '$.id') AND capture.run_id = ? AND capture.shard_key = ? AND capture.item_key = json_extract(staged.value, '$.itemKey') AND capture.variant_key = json_extract(staged.value, '$.variantKey') AND capture.ordinal = json_extract(staged.value, '$.ordinal') AND capture.image_id = json_extract(staged.value, '$.imageId') AND capture.profile_digest = json_extract(staged.value, '$.profileDigest') AND capture.test_id = json_extract(staged.value, '$.testId') AND capture.test_retry = json_extract(staged.value, '$.testRetry') AND capture.metadata_json = json_extract(staged.value, '$.metadataJson')))",
        [captures, run.id, input.key],
      ),
    ]);
  }
  if (input.localReferenceSnapshotId)
    await atomic(service.database, [
      activeGuard(service.database, run),
      statement(
        service.database,
        "INSERT OR IGNORE INTO work_retention_pins(run_id,owner,reason) SELECT image.run_id,?,'comparison' FROM visonaut_captures capture JOIN visonaut_images image ON image.id=capture.image_id WHERE capture.run_id=? AND image.run_id!=?",
        [`inherited-by:${run.id}`, run.id, run.id],
      ),
    ]);
  const profileDigest = await captureProfilesDigest(input.captures);
  await atomic(service.database, [
    activeGuard(service.database, run),
    assertion(
      service.database,
      "(SELECT count(*) FROM visonaut_captures WHERE run_id = ? AND shard_key = ?) = ?",
      [run.id, input.key, input.captures.length],
    ),
    statement(
      service.database,
      "UPDATE visonaut_shards SET state = 'complete', manifest_digest = ?, full_profile_digest = ?, expected_json = ?, discovery_json = ?, source_run_id = ?, source_attempt = ? WHERE run_id = ? AND key = ? AND state = 'pending'",
      [
        input.manifestDigest,
        profileDigest,
        JSON.stringify(expected),
        input.verifiedDiscovery ? JSON.stringify(input.verifiedDiscovery) : null,
        run.id,
        expected.sourceAttempt ?? run.attempt,
        run.id,
        input.key,
      ],
    ),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_shards WHERE run_id = ? AND key = ? AND manifest_digest = ? AND state = 'complete')",
      [run.id, input.key, input.manifestDigest],
    ),
  ]);
}

export async function failRun(
  service: Service,
  input: { runId: string; reason: string; now: number },
) {
  const run = await service.run(input.runId);
  if (run.state === "failed") {
    return service.status(run.id);
  }
  const project = await service.project(run.project_id);
  await atomic(service.database, [
    projectGuard(service.database, project),
    activeGuard(service.database, run),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND sealed_at IS NULL AND state = 'uploading')",
      [run.id],
    ),
    statement(service.database, "UPDATE visonaut_runs SET state = 'failed' WHERE id = ?", [run.id]),
    auditRunChange({
      database: service.database,
      run: run,
      action: "capture-failed",
      detail: { reason: input.reason.slice(0, 4096) },
      now: input.now,
    }),
    ...touchRunStatusStatements(
      service.database,
      { id: run.id, projectId: run.project_id },
      input.now,
    ),
  ]);
  return service.status(run.id);
}

export async function sealRun(service: Service, input: { runId: string; now: number }) {
  const run = await service.run(input.runId);
  if (run.sealed_at !== null) {
    return run;
  }
  await atomic(service.database, [
    activeGuard(service.database, run),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND state = 'uploading')",
      [run.id],
    ),
    assertion(
      service.database,
      "NOT EXISTS (SELECT 1 FROM visonaut_shards WHERE run_id = ? AND state != 'complete') AND EXISTS (SELECT 1 FROM visonaut_captures WHERE run_id = ?)",
      [run.id, run.id],
    ),
    assertion(
      service.database,
      "NOT EXISTS (SELECT 1 FROM visonaut_captures c JOIN visonaut_images i ON i.id = c.image_id WHERE c.run_id = ? AND i.bytes_present != 1)",
      [run.id],
    ),
    // Shards arrive independently and keep manifest-local ordinals while staging.
    // Freeze one run order at seal; inherited captures retain their relative shard
    // order even when an earlier discovered shard has a different capture count.
    statement(
      service.database,
      `WITH shard_order AS MATERIALIZED (
          SELECT json_extract(value, '$.key') AS shard_key, CAST(key AS INTEGER) AS ordinal
          FROM json_each((SELECT plan_json FROM visonaut_runs WHERE id = ?), '$.shards')
        ), ranked AS MATERIALIZED (
          SELECT capture.id, ROW_NUMBER() OVER (ORDER BY shard.ordinal, capture.ordinal) - 1 AS ordinal
          FROM visonaut_captures capture JOIN shard_order shard ON shard.shard_key = capture.shard_key
          WHERE capture.run_id = ?
        )
        UPDATE visonaut_captures SET ordinal = ranked.ordinal FROM ranked
        WHERE visonaut_captures.id = ranked.id AND visonaut_captures.ordinal != ranked.ordinal`,
      [run.id, run.id],
    ),
    statement(
      service.database,
      "UPDATE visonaut_runs SET sealed_at = ?, state = 'comparing' WHERE id = ?",
      [input.now, run.id],
    ),
    auditRunChange({
      database: service.database,
      run: run,
      action: "seal",
      detail: {},
      now: input.now,
    }),
    ...touchRunStatusStatements(
      service.database,
      { id: run.id, projectId: run.project_id },
      input.now,
    ),
  ]);
  return service.run(run.id);
}
