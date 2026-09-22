import { assertion, atomic, ConflictError, IncompleteError, statement } from "./database.ts";
import {
  historicalGuard,
  historicalOwner,
  finalizeHistoricalComparison,
  expireHistoricalPreparations,
} from "./historical.ts";
import { ArchivedCommandResultError, commandRequestDigest } from "./history.ts";
import { materializeLineageStatements } from "./lineage.ts";
import {
  claimWork,
  completeWorkStatement,
  failWork,
  getWork,
  statusIntentStatements,
  workLeaseAssertion,
} from "./work.ts";
import type { StatusDelivery } from "./work.ts";
import type { Database, SqlValue, Statement } from "./database.ts";
import type {
  CommandResult,
  CommitShardParams,
  ComparisonResult,
  ComparisonRow,
  DecisionRow,
  ProjectRow,
  PromotionRow,
  ReserveRunParams,
  ReviewParams,
  ReviewRow,
  RunRow,
  SnapshotRow,
  ValidatedImage,
} from "./types.ts";

interface PreviousDecision {
  id: string;
  decisionId: string | null;
  sourceDecisionId: string | null;
  revision: number;
}

interface CommandRow {
  id: string;
  request_json: string;
  actor_id: string;
  session_id: string;
  kind: string;
  comparison_id: string;
  previous_json: string;
  result_json: string;
  undone_by: string | null;
  request_digest?: string | null;
}

interface PreviousCommandState {
  decisions: PreviousDecision[];
  rollback: PromotionRow | null;
}

interface ImageRow {
  id: string;
  object_key: string;
  digest: string;
  width: number;
  height: number;
  bytes: number;
  content_type: "image/png" | "image/webp";
}

export interface ComparisonPolicy {
  id: string;
  channelThreshold: number;
  maxChangedPixels: number;
  maxChangedRatio: number;
}

export interface ComparisonTask {
  id: string;
  comparisonId: string;
  runId: string;
  policyDigest: string;
  policy: ComparisonPolicy;
  reference: {
    imageId: string;
    objectKey: string;
    digest: string;
    width: number;
    height: number;
    bytes: number;
    contentType: "image/png" | "image/webp";
  } | null;
  candidate: {
    imageId: string;
    objectKey: string;
    digest: string;
    width: number;
    height: number;
    bytes: number;
    contentType: "image/png" | "image/webp";
  } | null;
}

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

function requestJson(input: Record<string, unknown>) {
  const { now: _now, ...request } = input;
  return JSON.stringify(request);
}

function parseCommandResult(json: string): CommandResult {
  // Command records are written only by this service, after typed validation.
  return JSON.parse(json) as CommandResult;
}

export class Service {
  constructor(readonly database: Database) {}

  private sql(sql: string, values: SqlValue[] = []) {
    return statement(this.database, sql, values);
  }

  private guard(sql: string, values: SqlValue[] = []) {
    return assertion(this.database, sql, values);
  }

  private async one<T>(sql: string, values: SqlValue[] = []) {
    const row = await this.sql(sql, values).first<T>();
    if (!row) {
      throw new IncompleteError("The requested record does not exist.");
    }
    return row;
  }

  private async rows<T>(sql: string, values: SqlValue[] = []) {
    return (await this.sql(sql, values).all<T>()).results ?? [];
  }

  async project(id: string) {
    return this.one<ProjectRow>("SELECT * FROM visonaut_projects WHERE id = ?", [id]);
  }

  async run(id: string) {
    return this.one<RunRow>("SELECT * FROM visonaut_runs WHERE id = ?", [id]);
  }

  async comparison(id: string) {
    return this.one<ComparisonRow>("SELECT * FROM visonaut_comparisons WHERE id = ?", [id]);
  }

  async comparisonRows(id: string) {
    return this.rows<ReviewRow>(
      "SELECT * FROM visonaut_comparison_rows WHERE comparison_id = ? ORDER BY ordinal, id",
      [id],
    );
  }

  async createPolicy(input: { digest: string; policy: ComparisonPolicy }) {
    const policy = input.policy;
    if (
      !policy.id ||
      !Number.isFinite(policy.channelThreshold) ||
      policy.channelThreshold < 0 ||
      policy.channelThreshold > 255 ||
      !Number.isSafeInteger(policy.maxChangedPixels) ||
      policy.maxChangedPixels < 0 ||
      !Number.isFinite(policy.maxChangedRatio) ||
      policy.maxChangedRatio < 0 ||
      policy.maxChangedRatio > 1
    ) {
      throw new IncompleteError("Invalid trusted comparison policy.");
    }
    await atomic(this.database, [
      this.sql(
        "INSERT INTO visonaut_policies (digest, policy_json) VALUES (?, ?) ON CONFLICT(digest) DO NOTHING",
        [input.digest, JSON.stringify(policy)],
      ),
      this.guard("EXISTS (SELECT 1 FROM visonaut_policies WHERE digest = ? AND policy_json = ?)", [
        input.digest,
        JSON.stringify(policy),
      ]),
    ]);
  }

  async createProject(input: { id: string; repositoryId: string; policyDigest: string }) {
    await this.sql(
      "INSERT INTO visonaut_projects (id, repository_id, policy_digest) VALUES (?, ?, ?)",
      [input.id, input.repositoryId, input.policyDigest],
    ).run();
  }

  private projectGuard(project: ProjectRow) {
    return this.guard("EXISTS (SELECT 1 FROM visonaut_projects WHERE id = ? AND revision = ?)", [
      project.id,
      project.revision,
    ]);
  }

  private activeGuard(run: RunRow) {
    return this.guard(
      "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND active = 1 AND revision = ?)",
      [run.id, run.revision],
    );
  }

  private reviewGuard(run: RunRow, comparisonId: string) {
    return this.guard(
      "EXISTS (SELECT 1 FROM visonaut_runs run JOIN visonaut_comparisons comparison ON comparison.id = run.comparison_id WHERE run.id = ? AND run.active = 1 AND run.revision = ? AND run.sealed_at IS NOT NULL AND comparison.id = ? AND comparison.state = 'ready')",
      [run.id, run.revision, comparisonId],
    );
  }

  private touch(run: RunRow, now: number): Statement[] {
    return [
      this.sql("UPDATE visonaut_projects SET revision = revision + 1 WHERE id = ?", [
        run.project_id,
      ]),
      this.sql("UPDATE visonaut_runs SET revision = revision + 1 WHERE id = ?", [run.id]),
      this.sql(
        "UPDATE work_checks SET desired_revision = (SELECT revision FROM visonaut_projects WHERE id = ?) WHERE id IN (SELECT id FROM visonaut_checks WHERE project_id = ?)",
        [run.project_id, run.project_id],
      ),
      this.sql(
        "INSERT INTO visonaut_status_outbox (id, run_id, run_revision, created_at) SELECT ?, id, revision, ? FROM visonaut_runs WHERE id = ?",
        [crypto.randomUUID(), now, run.id],
      ),
    ];
  }

  private audit(
    run: RunRow,
    action: string,
    detail: unknown,
    now: number,
    actorId: string | null = null,
  ) {
    return this.sql(
      "INSERT INTO visonaut_audit (id, project_id, run_id, actor_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), run.project_id, run.id, actorId, action, JSON.stringify(detail), now],
    );
  }

  async reserveRun(input: ReserveRunParams) {
    if (!input.verificationDigest || !input.lineageKey || input.plan.shards.length === 0) {
      throw new IncompleteError("A verified full plan and lineage are required.");
    }
    const existing = await this.sql(
      "SELECT * FROM visonaut_runs WHERE project_id = ? AND external_run_id = ? AND attempt = ?",
      [input.projectId, input.externalRunId, input.attempt],
    ).first<RunRow>();
    if (existing) {
      if (
        existing.tested_sha !== input.testedSha ||
        existing.plan_digest !== input.plan.digest ||
        existing.lineage_key !== input.lineageKey
      ) {
        throw new ConflictError(
          "The run identity already has different trusted metadata.",
          existing,
        );
      }
      return existing;
    }
    const project = await this.project(input.projectId);
    // D1 limits a stored TEXT value to 2 MB; leave room for row metadata.
    if (new TextEncoder().encode(JSON.stringify(input.plan)).byteLength > 1_500_000) {
      throw new IncompleteError("The trusted plan is too large for one run record.");
    }
    const keys = new Set<string>();
    const identities = new Set<string>();
    for (const shard of input.plan.shards) {
      if (
        keys.has(shard.key) ||
        (!shard.discovery && (shard.tests.length === 0 || shard.captures.length === 0)) ||
        (shard.discovery &&
          (!shard.discovery.executorDigest || !shard.discovery.configurationDigest))
      ) {
        throw new IncompleteError("Each trusted shard needs unique identity, tests, and captures.");
      }
      keys.add(shard.key);
      for (const capture of shard.captures) {
        const key = identity(capture.itemKey, capture.variantKey);
        if (identities.has(key) || !shard.tests.includes(capture.testId)) {
          throw new IncompleteError(
            "The trusted plan contains a duplicate or unaccounted capture.",
          );
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
      this.projectGuard(project),
      this.guard(
        "NOT EXISTS (SELECT 1 FROM visonaut_runs WHERE project_id = ? AND external_run_id = ? AND attempt >= ?)",
        [input.projectId, input.externalRunId, input.attempt],
      ),
      this.sql(
        "UPDATE visonaut_runs SET active = 0, state = 'superseded', closed_at = COALESCE(closed_at, ?), revision = revision + 1 WHERE project_id = ? AND external_run_id = ? AND active = 1",
        [input.now, input.projectId, input.externalRunId],
      ),
      this.sql(
        "UPDATE work_retained_runs SET closed_at = COALESCE(closed_at, ?) WHERE id IN (SELECT id FROM visonaut_runs WHERE project_id = ? AND external_run_id = ? AND active = 0)",
        [input.now, input.projectId, input.externalRunId],
      ),
      this.sql(
        "DELETE FROM work_retention_pins WHERE reason = 'review' AND owner IN (SELECT 'review:' || id FROM visonaut_runs WHERE project_id = ? AND external_run_id = ? AND active = 0)",
        [input.projectId, input.externalRunId],
      ),
      this.sql(
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
      this.sql("INSERT INTO work_retained_runs (id, object_prefix) VALUES (?, ?)", [
        input.id,
        `runs/${input.id}/`,
      ]),
      this.sql("INSERT INTO work_retention_pins (run_id, owner, reason) VALUES (?, ?, 'review')", [
        input.id,
        `review:${input.id}`,
      ]),
    ];
    if (input.maximumActiveRuns !== undefined) {
      if (!Number.isSafeInteger(input.maximumActiveRuns) || input.maximumActiveRuns < 1)
        throw new IncompleteError("The active run admission limit is invalid.");
      statements.push(
        this.guard(
          "(SELECT COUNT(*) FROM visonaut_runs WHERE active=1 AND state IN ('uploading','comparing')) <= ?",
          [input.maximumActiveRuns],
        ),
      );
    }
    for (const sourceId of new Set(input.verifiedRelatedRunIds)) {
      statements.push(
        this.guard("EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND project_id = ?)", [
          sourceId,
          input.projectId,
        ]),
      );
      statements.push(
        this.sql(
          "INSERT INTO visonaut_lineage_edges (source_run_id, target_run_id, proof_digest) VALUES (?, ?, ?)",
          [sourceId, input.id, input.verificationDigest],
        ),
      );
    }
    statements.push(
      ...materializeLineageStatements(this.database, input.id, input.verificationDigest),
    );
    for (const sha of new Set(input.verifiedAncestorShas)) {
      statements.push(
        this.sql(
          "INSERT INTO visonaut_ancestry (run_id, ancestor_sha, proof_digest) VALUES (?, ?, ?)",
          [input.id, sha, input.verificationDigest],
        ),
      );
    }
    for (const shard of input.plan.shards) {
      statements.push(
        this.sql(
          "INSERT INTO visonaut_shards (run_id, key, profile_digest, expected_json) VALUES (?, ?, ?, ?)",
          [input.id, shard.key, shard.profileDigest, JSON.stringify(shard)],
        ),
      );
    }
    if (input.inheritFromRunId) {
      statements.push(
        this.guard(
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
          this.guard(
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
          this.guard(
            "EXISTS (SELECT 1 FROM visonaut_shards WHERE run_id = ? AND key = ? AND state = 'complete' AND profile_digest = ?)",
            [input.inheritFromRunId, shard.key, shard.profileDigest],
          ),
        );
        statements.push(
          this.sql(
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
          this.sql(
            "INSERT INTO visonaut_captures (id, run_id, shard_key, item_key, variant_key, ordinal, image_id, profile_digest, test_id, test_retry, metadata_json) SELECT ? || ':inherited:' || ? || ':' || ordinal, ?, shard_key, item_key, variant_key, ordinal, image_id, profile_digest, test_id, test_retry, metadata_json FROM visonaut_captures WHERE run_id = ? AND shard_key = ?",
            [input.id, shardIndex, input.id, input.inheritFromRunId, shard.key],
          ),
        );
      }
    }
    statements.push(
      this.sql(
        "INSERT INTO work_retention_pins (run_id, owner, reason) SELECT DISTINCT image.run_id, ?, 'comparison' FROM visonaut_captures capture JOIN visonaut_images image ON image.id = capture.image_id WHERE capture.run_id = ? AND image.run_id != ? ON CONFLICT(run_id, owner) DO NOTHING",
        [`inherited-by:${input.id}`, input.id, input.id],
      ),
    );
    statements.push(
      this.sql("UPDATE visonaut_projects SET revision = revision + 1 WHERE id = ?", [project.id]),
    );
    statements.push(
      this.sql(
        "UPDATE work_checks SET desired_revision = (SELECT revision FROM visonaut_projects WHERE id = ?) WHERE id IN (SELECT id FROM visonaut_checks WHERE project_id = ?)",
        [project.id, project.id],
      ),
    );
    await atomic(this.database, statements);
    return this.run(input.id);
  }

  /** Call only after the trusted decoder and R2 write have both succeeded. */
  async registerImage(image: ValidatedImage) {
    const run = await this.run(image.runId);
    await atomic(this.database, [
      this.activeGuard(run),
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND sealed_at IS NULL AND state = 'uploading')",
        [run.id],
      ),
      this.guard("EXISTS (SELECT 1 FROM work_retained_runs WHERE id = ? AND byte_state = 'live')", [
        run.id,
      ]),
      this.sql(
        "INSERT INTO visonaut_images (id, run_id, digest, object_key, content_type, bytes, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
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
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_images WHERE id = ? AND run_id = ? AND digest = ? AND object_key = ? AND bytes = ? AND width = ? AND height = ? AND content_type = ?)",
        [
          image.id,
          image.runId,
          image.digest,
          image.objectKey,
          image.bytes,
          image.width,
          image.height,
          image.contentType,
        ],
      ),
    ]);
  }

  async commitShard(input: CommitShardParams) {
    const run = await this.run(input.runId);
    const shard = await this.one<{
      state: string;
      manifest_digest: string | null;
      expected_json: string;
    }>("SELECT * FROM visonaut_shards WHERE run_id = ? AND key = ?", [run.id, input.key]);
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
        proof.attempt !== run.attempt ||
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
    if (
      outcomes.size !== expected.tests.length ||
      outcomes.size !== input.finalTestOutcomes.length
    ) {
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
        !(expected.environmentProfileDigests ?? [expected.profileDigest]).includes(
          capture.environmentProfileDigest,
        ) ||
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
      await atomic(this.database, [
        this.activeGuard(run),
        this.guard("EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND sealed_at IS NULL)", [
          run.id,
        ]),
        this.guard(
          "EXISTS (SELECT 1 FROM work_retained_runs WHERE id = ? AND byte_state = 'live')",
          [run.id],
        ),
        this.guard(
          "NOT EXISTS (SELECT 1 FROM json_each(?) staged WHERE NOT EXISTS (SELECT 1 FROM visonaut_images image WHERE image.id = json_extract(staged.value, '$.imageId') AND image.run_id = ? AND image.bytes_present = 1))",
          [captures, run.id],
        ),
        this.sql(
          "INSERT INTO visonaut_captures (id, run_id, shard_key, item_key, variant_key, ordinal, image_id, profile_digest, test_id, test_retry, metadata_json) SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.itemKey'), json_extract(value, '$.variantKey'), json_extract(value, '$.ordinal'), json_extract(value, '$.imageId'), json_extract(value, '$.profileDigest'), json_extract(value, '$.testId'), json_extract(value, '$.testRetry'), json_extract(value, '$.metadataJson') FROM json_each(?) WHERE true ON CONFLICT(id) DO NOTHING",
          [run.id, input.key, captures],
        ),
        this.guard(
          "NOT EXISTS (SELECT 1 FROM json_each(?) staged WHERE NOT EXISTS (SELECT 1 FROM visonaut_captures capture WHERE capture.id = json_extract(staged.value, '$.id') AND capture.run_id = ? AND capture.shard_key = ? AND capture.item_key = json_extract(staged.value, '$.itemKey') AND capture.variant_key = json_extract(staged.value, '$.variantKey') AND capture.ordinal = json_extract(staged.value, '$.ordinal') AND capture.image_id = json_extract(staged.value, '$.imageId') AND capture.profile_digest = json_extract(staged.value, '$.profileDigest') AND capture.test_id = json_extract(staged.value, '$.testId') AND capture.test_retry = json_extract(staged.value, '$.testRetry') AND capture.metadata_json = json_extract(staged.value, '$.metadataJson')))",
          [captures, run.id, input.key],
        ),
      ]);
    }
    const profileDigest = await captureProfilesDigest(input.captures);
    await atomic(this.database, [
      this.activeGuard(run),
      this.guard(
        "(SELECT count(*) FROM visonaut_captures WHERE run_id = ? AND shard_key = ?) = ?",
        [run.id, input.key, input.captures.length],
      ),
      this.sql(
        "UPDATE visonaut_shards SET state = 'complete', manifest_digest = ?, full_profile_digest = ?, expected_json = ?, discovery_json = ?, source_run_id = ?, source_attempt = ? WHERE run_id = ? AND key = ? AND state = 'pending'",
        [
          input.manifestDigest,
          profileDigest,
          JSON.stringify(expected),
          input.verifiedDiscovery ? JSON.stringify(input.verifiedDiscovery) : null,
          run.id,
          run.attempt,
          run.id,
          input.key,
        ],
      ),
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_shards WHERE run_id = ? AND key = ? AND manifest_digest = ? AND state = 'complete')",
        [run.id, input.key, input.manifestDigest],
      ),
    ]);
  }

  async failRun(input: { runId: string; reason: string; now: number }) {
    const run = await this.run(input.runId);
    if (run.state === "failed") {
      return this.status(run.id);
    }
    const project = await this.project(run.project_id);
    await atomic(this.database, [
      this.projectGuard(project),
      this.activeGuard(run),
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND sealed_at IS NULL AND state = 'uploading')",
        [run.id],
      ),
      this.sql("UPDATE visonaut_runs SET state = 'failed' WHERE id = ?", [run.id]),
      this.audit(run, "capture-failed", { reason: input.reason.slice(0, 4096) }, input.now),
      ...this.touch(run, input.now),
    ]);
    return this.status(run.id);
  }

  async sealRun(input: { runId: string; now: number }) {
    const run = await this.run(input.runId);
    if (run.sealed_at !== null) {
      return run;
    }
    await atomic(this.database, [
      this.activeGuard(run),
      this.guard("EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND state = 'uploading')", [
        run.id,
      ]),
      this.guard(
        "NOT EXISTS (SELECT 1 FROM visonaut_shards WHERE run_id = ? AND state != 'complete') AND EXISTS (SELECT 1 FROM visonaut_captures WHERE run_id = ?)",
        [run.id, run.id],
      ),
      this.guard(
        "NOT EXISTS (SELECT 1 FROM visonaut_captures c JOIN visonaut_images i ON i.id = c.image_id WHERE c.run_id = ? AND i.bytes_present != 1)",
        [run.id],
      ),
      // Shards arrive independently and keep manifest-local ordinals while staging.
      // Freeze one run order at seal; inherited captures retain their relative shard
      // order even when an earlier discovered shard has a different capture count.
      this.sql(
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
      this.sql("UPDATE visonaut_runs SET sealed_at = ?, state = 'comparing' WHERE id = ?", [
        input.now,
        run.id,
      ]),
      this.audit(run, "seal", {}, input.now),
      ...this.touch(run, input.now),
    ]);
    return this.run(run.id);
  }

  async referenceCandidates(projectId: string) {
    return this.rows<SnapshotRow>(
      "SELECT snapshot.* FROM visonaut_snapshots snapshot WHERE snapshot.project_id = ? AND snapshot.reference_eligible = 1 AND NOT EXISTS (SELECT 1 FROM visonaut_snapshot_images image WHERE image.snapshot_id = snapshot.id AND image.copied != 1) ORDER BY snapshot.created_at DESC, snapshot.id",
      [projectId],
    );
  }

  async selectReferenceSnapshot(runId: string, historical = false) {
    const run = await this.run(runId);
    const project = await this.project(run.project_id);
    if (project.fresh_setup && project.snapshot_id === null) return null;
    const snapshot = await this.sql(
      "SELECT snapshot.* FROM visonaut_snapshots snapshot JOIN visonaut_ancestry ancestry ON ancestry.ancestor_sha = snapshot.tested_sha AND ancestry.run_id = ? WHERE snapshot.project_id = ? AND snapshot.reference_eligible = 1 AND (? != 'main' OR snapshot.id = ?) AND NOT EXISTS (SELECT 1 FROM visonaut_snapshot_images image WHERE image.snapshot_id = snapshot.id AND image.copied != 1) ORDER BY (snapshot.id = ?) DESC, snapshot.created_at DESC, snapshot.id LIMIT 1",
      [
        run.id,
        project.id,
        historical ? "historical" : run.kind,
        project.snapshot_id,
        project.snapshot_id,
      ],
    ).first<SnapshotRow>();
    if (!snapshot) {
      throw new IncompleteError(
        "No retained accepted ancestor is eligible. Verify ancestry or capture current main.",
      );
    }
    return snapshot.id;
  }

  async createComparison(input: {
    id: string;
    runId: string;
    referenceSnapshotId: string | null;
    now: number;
    maxAttempts: number;
    expectedBaselineRevision?: number;
    purpose?: "review" | "historical";
    expectedCaptureCount?: number;
  }) {
    const run = await this.run(input.runId);
    const project = await this.project(run.project_id);
    const historical = input.purpose === "historical";
    if (
      historical &&
      (!Number.isSafeInteger(input.expectedCaptureCount) || (input.expectedCaptureCount ?? 0) < 1)
    ) {
      throw new IncompleteError("The complete stored capture inventory is required.");
    }
    const guards = [
      this.projectGuard(project),
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_projects WHERE id = ? AND baseline_revision = ?)",
        [project.id, input.expectedBaselineRevision ?? project.baseline_revision],
      ),
      historical
        ? this.guard(
            "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND active = 0 AND revision = ?)",
            [run.id, run.revision],
          )
        : this.activeGuard(run),
      this.guard("EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND sealed_at IS NOT NULL)", [
        run.id,
      ]),
    ];
    if (input.referenceSnapshotId) {
      guards.push(
        this.guard(
          "EXISTS (SELECT 1 FROM visonaut_snapshots s JOIN visonaut_ancestry a ON a.ancestor_sha = s.tested_sha AND a.run_id = ? WHERE s.id = ? AND s.project_id = ? AND s.reference_eligible = 1)",
          [run.id, input.referenceSnapshotId, project.id],
        ),
      );
      guards.push(
        this.guard(
          "NOT EXISTS (SELECT 1 FROM visonaut_snapshot_images WHERE snapshot_id = ? AND copied != 1)",
          [input.referenceSnapshotId],
        ),
      );
      guards.push(
        this.sql(
          "INSERT OR IGNORE INTO visonaut_pins (snapshot_id, reason, owner_id) VALUES (?, ?, ?)",
          [input.referenceSnapshotId, historical ? "historical" : "comparison", input.id],
        ),
      );
      guards.push(
        this.sql(
          "INSERT OR IGNORE INTO work_retention_pins (run_id, owner, reason) SELECT run_id, ?, ? FROM visonaut_snapshots WHERE id = ?",
          [
            historical ? historicalOwner(input.id) : `comparison:${input.id}`,
            historical ? "manual" : "comparison",
            input.referenceSnapshotId,
          ],
        ),
      );
    } else {
      guards.push(
        this.guard(
          "EXISTS (SELECT 1 FROM visonaut_projects WHERE id = ? AND fresh_setup = 1 AND snapshot_id IS NULL)",
          [project.id],
        ),
      );
    }
    // Main always compares with the current baseline. PRs may pin another
    // verified accepted ancestor, but cannot use a missing ancestor as empty.
    if (run.kind === "main" && !historical) {
      guards.push(
        this.guard("EXISTS (SELECT 1 FROM visonaut_projects WHERE id = ? AND snapshot_id IS ?)", [
          project.id,
          input.referenceSnapshotId,
        ]),
      );
    }
    if (historical) {
      guards.push(
        this.guard(
          "EXISTS (SELECT 1 FROM work_retained_runs WHERE id = ? AND byte_state = 'live')",
          [run.id],
        ),
        this.guard("(SELECT COUNT(*) FROM visonaut_captures WHERE run_id = ?) = ?", [
          run.id,
          input.expectedCaptureCount ?? 0,
        ]),
        this.guard(
          "NOT EXISTS (SELECT 1 FROM visonaut_captures capture LEFT JOIN visonaut_images image ON image.id = capture.image_id WHERE capture.run_id = ? AND (image.id IS NULL OR image.bytes_present != 1 OR image.validated != 1))",
          [run.id],
        ),
        this.sql(
          "INSERT OR IGNORE INTO work_retention_pins(run_id, owner, reason) SELECT ?, ?, 'manual' UNION SELECT image.run_id, ?, 'manual' FROM visonaut_captures capture JOIN visonaut_images image ON image.id = capture.image_id WHERE capture.run_id = ?",
          [run.id, historicalOwner(input.id), historicalOwner(input.id), run.id],
        ),
      );
      if (run.detail_archived) {
        guards.push(
          this.guard(
            "EXISTS (SELECT 1 FROM visonaut_historical_preparations WHERE id = ? AND run_id = ? AND lease_until > ?)",
            [input.id, run.id, input.now],
          ),
        );
      }
      guards.push(
        this.sql("DELETE FROM visonaut_historical_preparations WHERE id = ?", [input.id]),
      );
    }
    const tuple = `json_object('projectId', ?, 'itemKey', c.item_key, 'variantKey', c.variant_key, 'referenceDigest', ri.digest, 'candidateDigest', ci.digest, 'referenceProfileDigest', r.profile_digest, 'candidateProfileDigest', c.profile_digest, 'comparisonPolicyDigest', ?)`;
    const removalTuple = `json_object('projectId', ?, 'itemKey', r.item_key, 'variantKey', r.variant_key, 'referenceDigest', ri.digest, 'candidateDigest', NULL, 'referenceProfileDigest', r.profile_digest, 'candidateProfileDigest', NULL, 'comparisonPolicyDigest', ?)`;
    await atomic(this.database, [
      ...guards,
      this.sql(
        "INSERT INTO visonaut_comparisons (id, run_id, reference_snapshot_id, baseline_revision, policy_digest, ordinal, created_at, purpose) SELECT ?, ?, ?, ?, ?, COALESCE(MAX(ordinal), 0) + 1, ?, ? FROM visonaut_comparisons WHERE run_id = ?",
        [
          input.id,
          run.id,
          input.referenceSnapshotId,
          project.baseline_revision,
          project.policy_digest,
          input.now,
          historical ? "historical" : "review",
          run.id,
        ],
      ),
      this.sql(
        `INSERT INTO visonaut_comparison_rows (id, comparison_id, item_key, variant_key, ordinal, reference_capture_id, candidate_capture_id, tuple_json, outcome) SELECT ? || ':' || c.id, ?, c.item_key, c.variant_key, c.ordinal, r.id, c.id, ${tuple}, CASE WHEN r.id IS NULL THEN 'changed' ELSE 'pending' END FROM visonaut_captures c JOIN visonaut_images ci ON ci.id = c.image_id LEFT JOIN (SELECT capture.* FROM visonaut_snapshot_images si JOIN visonaut_captures capture ON capture.id = si.capture_id WHERE si.snapshot_id = ?) r ON r.item_key = c.item_key AND r.variant_key = c.variant_key LEFT JOIN visonaut_images ri ON ri.id = r.image_id WHERE c.run_id = ?`,
        [input.id, input.id, project.id, project.policy_digest, input.referenceSnapshotId, run.id],
      ),
      this.sql(
        `INSERT INTO visonaut_comparison_rows (id, comparison_id, item_key, variant_key, ordinal, reference_capture_id, candidate_capture_id, tuple_json, outcome) SELECT ? || ':removed:' || r.id, ?, r.item_key, r.variant_key, (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM visonaut_captures WHERE run_id = ?) + r.ordinal, r.id, NULL, ${removalTuple}, 'changed' FROM visonaut_snapshot_images si JOIN visonaut_captures r ON r.id = si.capture_id JOIN visonaut_images ri ON ri.id = r.image_id WHERE si.snapshot_id = ? AND NOT EXISTS (SELECT 1 FROM visonaut_captures c WHERE c.run_id = ? AND c.item_key = r.item_key AND c.variant_key = r.variant_key)`,
        [
          input.id,
          input.id,
          run.id,
          project.id,
          project.policy_digest,
          input.referenceSnapshotId,
          run.id,
        ],
      ),
      this.sql(
        "INSERT INTO work_tasks (id, kind, payload, max_attempts, available_at, created_at, updated_at) SELECT id, 'compare', json_object('taskId', id), ?, ?, ?, ? FROM visonaut_comparison_rows WHERE comparison_id = ? AND outcome = 'pending'",
        [input.maxAttempts, input.now, input.now, input.now, input.id],
      ),
      ...(historical
        ? []
        : [
            this.sql(
              "UPDATE visonaut_runs SET comparison_id = ?, state = 'comparing' WHERE id = ?",
              [input.id, run.id],
            ),
            this.audit(
              run,
              "compare",
              { comparisonId: input.id, referenceSnapshotId: input.referenceSnapshotId },
              input.now,
            ),
            ...this.touch(run, input.now),
          ]),
    ]);
    return this.comparison(input.id);
  }

  async getComparisonTask(taskId: string): Promise<ComparisonTask> {
    const row = await this.one<ReviewRow>("SELECT * FROM visonaut_comparison_rows WHERE id = ?", [
      taskId,
    ]);
    const comparison = await this.comparison(row.comparison_id);
    const readImage = async (captureId: string | null, reference: boolean) => {
      if (!captureId) return null;
      const image = reference
        ? await this.one<ImageRow>(
            "SELECT i.id, si.object_key, i.digest, i.width, i.height, i.bytes, i.content_type FROM visonaut_snapshot_images si JOIN visonaut_images i ON i.id = si.image_id WHERE si.snapshot_id = ? AND si.capture_id = ? AND si.copied = 1",
            [comparison.reference_snapshot_id, captureId],
          )
        : await this.one<ImageRow>(
            "SELECT i.* FROM visonaut_images i JOIN visonaut_captures c ON c.image_id = i.id WHERE c.id = ? AND i.bytes_present = 1",
            [captureId],
          );
      return {
        imageId: image.id,
        objectKey: image.object_key,
        digest: image.digest,
        width: image.width,
        height: image.height,
        bytes: image.bytes,
        contentType: image.content_type,
      };
    };
    const policyRecord = await this.one<{ policy_json: string }>(
      "SELECT policy_json FROM visonaut_policies WHERE digest = ?",
      [comparison.policy_digest],
    );
    const policy = JSON.parse(policyRecord.policy_json) as ComparisonPolicy;
    return {
      id: row.id,
      comparisonId: comparison.id,
      runId: comparison.run_id,
      policyDigest: comparison.policy_digest,
      policy,
      reference: await readImage(row.reference_capture_id, true),
      candidate: await readImage(row.candidate_capture_id, false),
    };
  }

  async getComparisonTaskState(taskId: string) {
    const state = await this.sql(
      "SELECT run.active, run.comparison_id, row.comparison_id AS row_comparison_id, comparison.purpose, comparison.state AS comparison_state FROM visonaut_comparison_rows row JOIN visonaut_comparisons comparison ON comparison.id = row.comparison_id JOIN visonaut_runs run ON run.id = comparison.run_id WHERE row.id = ?",
      [taskId],
    ).first<{
      active: number;
      comparison_id: string;
      row_comparison_id: string;
      purpose: string;
      comparison_state: string;
    }>();
    if (!state) {
      const archived = await this.sql(
        "SELECT 1 FROM visonaut_comparisons comparison JOIN visonaut_runs run ON run.id=comparison.run_id WHERE (run.detail_archived=1 OR EXISTS (SELECT 1 FROM operations_comparison_archives archive WHERE archive.comparison_id=comparison.id AND archive.state='ready')) AND substr(?,1,length(comparison.id)+1)=comparison.id || ':' LIMIT 1",
        [taskId],
      ).first();
      if (archived) return { state: "superseded" as const };
      throw new IncompleteError("The comparison task has not been scheduled.");
    }
    if (state.purpose === "historical" && state.comparison_state === "invalidated") {
      return { state: "dead" as const };
    }
    if (
      state.purpose !== "historical" &&
      (!state.active || state.comparison_id !== state.row_comparison_id)
    ) {
      return { state: "superseded" as const };
    }
    const task = await getWork(this.database, taskId);
    if (!task) {
      throw new IncompleteError("The comparison task has not been scheduled.");
    }
    return task;
  }

  async claimComparisonTask(input: {
    taskId: string;
    owner: string;
    now: number;
    leaseMilliseconds: number;
  }) {
    const state = await this.getComparisonTaskState(input.taskId);
    if (state.state === "superseded" || state.state === "dead" || state.state === "complete")
      return null;
    const claimed = await claimWork(this.database, {
      id: input.taskId,
      token: input.owner,
      now: input.now,
      leaseMs: input.leaseMilliseconds,
    });
    if (!claimed) return null;
    return this.getComparisonTask(input.taskId);
  }

  async failComparisonTask(input: {
    taskId: string;
    owner: string;
    now: number;
    retryAt: number;
    error: string;
  }) {
    return failWork(this.database, {
      id: input.taskId,
      token: input.owner,
      now: input.now,
      retryAt: input.retryAt,
      error: input.error,
    });
  }

  async commitComparisonResult(input: {
    taskId: string;
    leaseOwner: string;
    result: ComparisonResult;
    now: number;
    artifacts?: Array<ValidatedImage & { role: "thumbnail" | "mask" }>;
  }) {
    const row = await this.one<ReviewRow>("SELECT * FROM visonaut_comparison_rows WHERE id = ?", [
      input.taskId,
    ]);
    const tuple = JSON.parse(row.tuple_json) as {
      referenceProfileDigest: string | null;
      candidateProfileDigest: string | null;
    };
    const result =
      tuple.referenceProfileDigest !== tuple.candidateProfileDigest
        ? { ...input.result, outcome: "changed" as const }
        : input.result;
    const comparison = await this.comparison(row.comparison_id);
    const run = await this.run(comparison.run_id);
    if (row.result_json) {
      if (row.result_json !== JSON.stringify(result)) {
        throw new ConflictError("A comparison result is immutable.");
      }
      return;
    }
    if (
      !Number.isFinite(input.result.ratio) ||
      input.result.ratio < 0 ||
      input.result.ratio > 1 ||
      !Number.isSafeInteger(input.result.changedPixels) ||
      input.result.changedPixels < 0
    ) {
      throw new IncompleteError("The comparison result is invalid.");
    }
    const artifactStatements: Statement[] = [];
    for (const artifact of input.artifacts ?? []) {
      if (artifact.runId !== run.id) {
        throw new IncompleteError("Derived images belong to the comparison run.");
      }
      artifactStatements.push(
        this.sql(
          "INSERT INTO visonaut_images (id, run_id, digest, object_key, content_type, bytes, width, height, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
          [
            artifact.id,
            artifact.runId,
            artifact.digest,
            artifact.objectKey,
            artifact.contentType,
            artifact.bytes,
            artifact.width,
            artifact.height,
            artifact.role,
          ],
        ),
      );
      artifactStatements.push(
        this.guard(
          "EXISTS (SELECT 1 FROM visonaut_images WHERE id = ? AND run_id = ? AND digest = ? AND object_key = ? AND content_type = ? AND bytes = ? AND width = ? AND height = ? AND role = ? AND bytes_present = 1)",
          [
            artifact.id,
            artifact.runId,
            artifact.digest,
            artifact.objectKey,
            artifact.contentType,
            artifact.bytes,
            artifact.width,
            artifact.height,
            artifact.role,
          ],
        ),
      );
    }
    if (input.result.maskImageId) {
      artifactStatements.push(
        this.guard(
          "EXISTS (SELECT 1 FROM visonaut_images WHERE id = ? AND run_id = ? AND role = 'mask' AND bytes_present = 1)",
          [input.result.maskImageId, run.id],
        ),
      );
    }
    if (input.result.thumbnailImageId) {
      artifactStatements.push(
        this.guard(
          "EXISTS (SELECT 1 FROM visonaut_images WHERE id = ? AND run_id = ? AND role = 'thumbnail' AND bytes_present = 1)",
          [input.result.thumbnailImageId, run.id],
        ),
      );
    }
    await atomic(this.database, [
      workLeaseAssertion(this.database, {
        id: input.taskId,
        token: input.leaseOwner,
        now: input.now,
      }),
      ...(comparison.purpose === "historical"
        ? [historicalGuard(this.database, comparison.id)]
        : [
            this.activeGuard(run),
            this.guard("EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND comparison_id = ?)", [
              run.id,
              comparison.id,
            ]),
          ]),
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_comparisons WHERE id = ? AND state = 'comparing')",
        [comparison.id],
      ),
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_comparison_rows WHERE id = ? AND result_json IS NULL)",
        [row.id],
      ),
      ...artifactStatements,
      this.sql("UPDATE visonaut_comparison_rows SET outcome = ?, result_json = ? WHERE id = ?", [
        result.outcome,
        JSON.stringify(result),
        row.id,
      ]),
      completeWorkStatement(this.database, {
        id: input.taskId,
        token: input.leaseOwner,
        now: input.now,
        result: JSON.stringify(result),
      }),
    ]);
  }

  private acceptanceValiditySql() {
    // Decision IDs bind immutable revisions. Replacement edges affect that
    // revision only; a fresh human approval never inherits an old rejection.
    return `decision.verdict = 'approved' AND decision.revoked = 0
      AND json_extract(decision.tuple_json,'$.referenceDigest') IS json_extract(row.tuple_json,'$.referenceDigest')
      AND json_extract(decision.tuple_json,'$.candidateDigest') IS json_extract(row.tuple_json,'$.candidateDigest')
      AND decision.tuple_json = row.tuple_json
      AND EXISTS (SELECT 1 FROM visonaut_comparison_rows source_row
        JOIN visonaut_comparisons source_comparison ON source_comparison.id = source_row.comparison_id
        JOIN visonaut_runs source_run ON source_run.id = source_comparison.run_id
        JOIN visonaut_comparisons target_comparison ON target_comparison.id = row.comparison_id
        JOIN visonaut_runs target_run ON target_run.id = target_comparison.run_id
        WHERE source_row.id = decision.row_id AND source_row.decision_id = decision.id
        AND source_run.project_id = target_run.project_id
        AND (source_run.id = target_run.id OR EXISTS (SELECT 1 FROM visonaut_lineage lineage
          WHERE lineage.source_run_id = source_run.id AND lineage.target_run_id = target_run.id))
        AND NOT EXISTS (SELECT 1 FROM visonaut_decision_replacements replacement
          JOIN visonaut_decisions successor ON successor.id = replacement.replacement_decision_id
          WHERE replacement.source_decision_id = decision.id AND successor.revoked = 0
          AND (replacement.scope = 'shared' OR replacement.scope_run_id = target_run.id
            OR EXISTS (SELECT 1 FROM visonaut_lineage lineage
              WHERE lineage.source_run_id = replacement.scope_run_id AND lineage.target_run_id = target_run.id))))`;
  }

  private eligibleAcceptanceSql() {
    return `EXISTS (SELECT 1 FROM visonaut_decisions decision
      WHERE decision.id = COALESCE(row.source_decision_id, row.decision_id)
      AND ${this.acceptanceValiditySql()})`;
  }

  async eligibleApprovalRowIds(comparisonId: string) {
    const rows = await this.rows<{ id: string }>(
      `SELECT row.id FROM visonaut_comparison_rows row WHERE row.comparison_id = ? AND row.outcome = 'changed' AND ${this.eligibleAcceptanceSql()} ORDER BY row.ordinal, row.id`,
      [comparisonId],
    );
    return rows.map((row) => row.id);
  }

  private readyGuard(comparisonId: string) {
    return this.guard(
      `NOT EXISTS (SELECT 1 FROM visonaut_comparison_rows row WHERE row.comparison_id = ? AND (row.outcome NOT IN ('unchanged', 'changed') OR (row.outcome = 'changed' AND NOT ${this.eligibleAcceptanceSql()})))`,
      [comparisonId],
    );
  }

  private currentBaselineGuard(projectId: string) {
    // Rollback can restore a baseline without a current promotion record.
    // Check the final transaction state, including indirect source changes.
    return this.guard(
      `NOT EXISTS (SELECT 1 FROM visonaut_projects project
        JOIN visonaut_snapshots snapshot ON snapshot.id = project.snapshot_id
        JOIN visonaut_comparison_rows row ON row.comparison_id = snapshot.comparison_id
        WHERE project.id = ? AND row.outcome = 'changed'
        AND NOT ${this.eligibleAcceptanceSql()})`,
      [projectId],
    );
  }

  async finalizeComparison(input: { comparisonId: string; now: number }) {
    const comparison = await this.comparison(input.comparisonId);
    const run = await this.run(comparison.run_id);
    if (comparison.purpose === "historical") {
      if (comparison.state === "comparing") {
        await finalizeHistoricalComparison(this.database, comparison.id);
      }
      return this.status(run.id);
    }
    if (run.detail_archived) {
      throw new ConflictError("Archived history is read-only.");
    }
    const project = await this.project(run.project_id);
    if (comparison.state === "ready") {
      return this.status(run.id);
    }
    const pending = await this.sql(
      "SELECT 1 AS found FROM visonaut_comparison_rows WHERE comparison_id = ? AND outcome IN ('pending', 'error') LIMIT 1",
      [comparison.id],
    ).first();
    if (pending) {
      throw new IncompleteError("Required comparisons have not completed.");
    }
    // Set-based statements keep a 10,580-image run bounded in request size.
    const reuse = `SELECT decision.id FROM visonaut_decisions decision WHERE ${this.acceptanceValiditySql()} ORDER BY decision.created_at, decision.id LIMIT 1`;
    const automaticKind = `CASE WHEN row.reference_capture_id IS NULL THEN 'introduction' ELSE 'removal' END`;
    const eligibleAutomatic = `row.comparison_id = ? AND row.outcome = 'changed' AND row.source_decision_id IS NULL AND row.decision_id IS NULL AND (row.reference_capture_id IS NULL OR row.candidate_capture_id IS NULL) AND NOT EXISTS (SELECT 1 FROM visonaut_reservations reservation JOIN visonaut_decisions decision ON decision.id = reservation.decision_id JOIN visonaut_comparison_rows reserved_row ON reserved_row.id = decision.row_id JOIN visonaut_comparisons reserved_comparison ON reserved_comparison.id = reserved_row.comparison_id WHERE reservation.project_id = ? AND reservation.item_key = row.item_key AND reservation.variant_key = row.variant_key AND reservation.kind = ${automaticKind} AND (reservation.lineage_key = ? OR EXISTS (SELECT 1 FROM visonaut_lineage l WHERE l.source_run_id = reserved_comparison.run_id AND l.target_run_id = ?))) AND (row.reference_capture_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM visonaut_identity_history h WHERE h.project_id = ? AND h.item_key = row.item_key AND h.variant_key = row.variant_key AND (h.lineage_key = ? OR h.lineage_key = 'main')))`;
    const statements = [
      this.projectGuard(project),
      this.activeGuard(run),
      this.guard("EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND comparison_id = ?)", [
        run.id,
        comparison.id,
      ]),
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_comparisons WHERE id = ? AND state = 'comparing')",
        [comparison.id],
      ),
      this.guard(
        "NOT EXISTS (SELECT 1 FROM visonaut_comparison_rows WHERE comparison_id = ? AND outcome IN ('pending', 'error'))",
        [comparison.id],
      ),
      this.sql(
        `UPDATE visonaut_comparison_rows AS row SET source_decision_id = (${reuse}) WHERE row.comparison_id = ? AND row.outcome = 'changed'`,
        [comparison.id],
      ),
      this.sql(
        `INSERT INTO visonaut_decisions (id, row_id, revision, verdict, kind, tuple_json, created_at) SELECT 'automatic:' || row.id, row.id, 1, 'approved', 'automatic', row.tuple_json, ? FROM visonaut_comparison_rows row WHERE ${eligibleAutomatic}`,
        [
          input.now,
          comparison.id,
          project.id,
          run.lineage_key,
          run.id,
          project.id,
          run.lineage_key,
        ],
      ),
      this.sql(
        "UPDATE visonaut_comparison_rows SET decision_id = 'automatic:' || id, decision_revision = 1 WHERE comparison_id = ? AND EXISTS (SELECT 1 FROM visonaut_decisions WHERE id = 'automatic:' || visonaut_comparison_rows.id)",
        [comparison.id],
      ),
      this.sql(
        `INSERT INTO visonaut_reservations (project_id, lineage_key, item_key, variant_key, kind, decision_id) SELECT ?, ?, row.item_key, row.variant_key, ${automaticKind}, row.decision_id FROM visonaut_comparison_rows row WHERE row.comparison_id = ? AND row.decision_id IS NOT NULL`,
        [project.id, run.lineage_key, comparison.id],
      ),
    ];
    statements.push(
      this.sql(
        "INSERT OR IGNORE INTO visonaut_identity_history (project_id, lineage_key, item_key, variant_key) SELECT ?, ?, item_key, variant_key FROM visonaut_captures WHERE run_id = ?",
        [project.id, run.lineage_key, run.id],
      ),
    );
    statements.push(
      this.sql("UPDATE visonaut_comparisons SET state = 'ready' WHERE id = ?", [comparison.id]),
    );
    statements.push(
      this.sql("UPDATE visonaut_runs SET state = 'reviewing' WHERE id = ?", [run.id]),
    );
    statements.push(
      this.audit(run, "comparison-ready", { comparisonId: comparison.id }, input.now),
    );
    statements.push(...this.touch(run, input.now));
    await atomic(this.database, statements);
    return this.status(run.id);
  }

  async reconcileComparisons(input: { now: number; limit: number }) {
    await expireHistoricalPreparations(this.database, input.now);
    const candidates = await this.rows<{ id: string }>(
      "SELECT c.id FROM visonaut_comparisons c JOIN visonaut_runs r ON r.id = c.run_id WHERE c.state = 'comparing' AND ((c.purpose = 'review' AND r.active = 1 AND r.comparison_id = c.id AND NOT EXISTS (SELECT 1 FROM visonaut_comparison_rows row WHERE row.comparison_id = c.id AND row.outcome IN ('pending', 'error'))) OR (c.purpose = 'historical' AND (NOT EXISTS (SELECT 1 FROM visonaut_comparison_rows row WHERE row.comparison_id = c.id AND row.outcome = 'pending') OR EXISTS (SELECT 1 FROM visonaut_comparison_rows row JOIN work_tasks task ON task.id = row.id WHERE row.comparison_id = c.id AND task.state = 'dead') OR EXISTS (SELECT 1 FROM visonaut_snapshots snapshot WHERE snapshot.id = c.reference_snapshot_id AND snapshot.reference_eligible = 0)))) ORDER BY c.created_at, c.id LIMIT ?",
      [input.limit],
    );
    const completed: string[] = [];
    const errors: Array<{ comparisonId: string; message: string }> = [];
    for (const candidate of candidates) {
      try {
        await this.finalizeComparison({ comparisonId: candidate.id, now: input.now });
        completed.push(candidate.id);
      } catch (error) {
        errors.push({
          comparisonId: candidate.id,
          message: error instanceof Error ? error.message : "Comparison reconciliation failed",
        });
      }
    }
    return { completed, errors };
  }

  async status(runId: string) {
    const run = await this.run(runId);
    if (!run.active) {
      return { run, status: "superseded" as const, pending: 0, rejected: 0 };
    }
    if (run.state === "failed") {
      const failures = await this.rows<{ id: string; last_error: string | null }>(
        "SELECT id, json_extract(detail_json, '$.reason') AS last_error FROM visonaut_audit WHERE run_id = ? AND action = 'capture-failed' ORDER BY created_at DESC, id LIMIT 1",
        [run.id],
      );
      return { run, status: "failed" as const, pending: 0, rejected: 0, failures };
    }
    if (!run.comparison_id || run.sealed_at === null) {
      return { run, status: "incomplete" as const, pending: 0, rejected: 0 };
    }
    const comparison = await this.comparison(run.comparison_id);
    if (comparison.state === "invalidated") {
      return { run, comparison, status: "needs-recompare" as const, pending: 0, rejected: 0 };
    }
    const failures = await this.rows<{ id: string; last_error: string | null }>(
      "SELECT task.id, task.last_error FROM work_tasks task JOIN visonaut_comparison_rows row ON row.id = task.id WHERE row.comparison_id = ? AND task.state = 'dead' ORDER BY task.id LIMIT 20",
      [comparison.id],
    );
    if (failures.length > 0) {
      return { run, comparison, status: "failed" as const, pending: 0, rejected: 0, failures };
    }
    if (comparison.state !== "ready") {
      return { run, comparison, status: "comparing" as const, pending: 0, rejected: 0 };
    }
    const counts = await this.one<{ pending: number; rejected: number }>(
      `SELECT COALESCE(SUM(CASE WHEN row.outcome NOT IN ('changed', 'unchanged') OR (row.outcome = 'changed' AND NOT ${this.eligibleAcceptanceSql()}) THEN 1 ELSE 0 END), 0) AS pending, COALESCE(SUM(CASE WHEN decision.verdict = 'rejected' AND decision.revoked = 0 THEN 1 ELSE 0 END), 0) AS rejected FROM visonaut_comparison_rows row LEFT JOIN visonaut_decisions decision ON decision.id = row.decision_id WHERE row.comparison_id = ?`,
      [comparison.id],
    );
    const project = await this.project(run.project_id);
    const currentPromotion = project.promotion_id
      ? await this.sql(
          "SELECT 1 AS found FROM visonaut_promotions WHERE id = ? AND comparison_id = ? AND revoked = 0",
          [project.promotion_id, comparison.id],
        ).first()
      : null;
    if (
      counts.pending === 0 &&
      !currentPromotion &&
      comparison.baseline_revision !== project.baseline_revision
    ) {
      return { run, comparison, status: "needs-recompare" as const, ...counts };
    }
    return {
      run,
      comparison,
      status:
        counts.pending === 0
          ? ("passed" as const)
          : counts.rejected > 0
            ? ("rejected" as const)
            : ("needs-review" as const),
      ...counts,
    };
  }

  async prepareStatusIntent(input: {
    runId: string;
    checkId: string;
    detailsUrl: string;
    maxAttempts: number;
    now: number;
  }) {
    const run = await this.run(input.runId);
    const project = await this.project(run.project_id);
    const status = await this.status(run.id);
    if (status.status === "superseded") {
      throw new ConflictError("A superseded attempt cannot publish a check.");
    }
    const conclusion =
      status.status === "passed"
        ? "success"
        : status.status === "needs-review" ||
            status.status === "rejected" ||
            status.status === "failed"
          ? "failure"
          : "pending";
    const comparison = run.comparison_id ? await this.comparison(run.comparison_id) : null;
    await atomic(this.database, [
      this.projectGuard(project),
      this.activeGuard(run),
      this.sql(
        "INSERT INTO visonaut_checks (id, project_id, external_run_id) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
        [input.checkId, project.id, run.external_run_id],
      ),
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_checks WHERE id = ? AND project_id = ? AND external_run_id = ?)",
        [input.checkId, project.id, run.external_run_id],
      ),
      ...statusIntentStatements(this.database, {
        checkId: input.checkId,
        revision: project.revision,
        runId: run.id,
        attempt: run.attempt,
        comparisonRevision: comparison?.ordinal ?? 0,
        sourceRevision: project.revision,
        conclusion,
        detailsUrl: input.detailsUrl,
        maxAttempts: input.maxAttempts,
        now: input.now,
      }),
      this.sql(
        "UPDATE visonaut_status_outbox SET delivered_at = ? WHERE run_id = ? AND run_revision <= ?",
        [input.now, run.id, run.revision],
      ),
    ]);
    return { revision: project.revision, conclusion };
  }

  /** Use alongside the delivery lease check immediately before sending to GitHub. */
  async isStatusIntentCurrent(intent: StatusDelivery) {
    const current = await this.sql(
      "SELECT 1 AS found FROM visonaut_runs run JOIN visonaut_projects project ON project.id = run.project_id LEFT JOIN visonaut_comparisons comparison ON comparison.id = run.comparison_id WHERE run.id = ? AND run.active = 1 AND run.attempt = ? AND project.revision = ? AND COALESCE(comparison.ordinal, 0) = ?",
      [intent.run_id, intent.attempt, intent.source_revision, intent.comparison_revision],
    ).first();
    return current !== null;
  }

  /** Retire only work that no longer owns the current promotion. */
  async retireRun(input: { runId: string; now: number }) {
    const run = await this.run(input.runId);
    const project = await this.project(run.project_id);
    await atomic(this.database, [
      this.projectGuard(project),
      this.guard(
        "NOT EXISTS (SELECT 1 FROM visonaut_projects project JOIN visonaut_snapshots snapshot ON snapshot.id = project.snapshot_id WHERE snapshot.run_id = ?)",
        [run.id],
      ),
      this.sql(
        "UPDATE visonaut_runs SET active = 0, state = 'superseded', closed_at = COALESCE(closed_at, ?) WHERE id = ?",
        [input.now, run.id],
      ),
      this.sql("UPDATE work_retained_runs SET closed_at = COALESCE(closed_at, ?) WHERE id = ?", [
        input.now,
        run.id,
      ]),
      this.sql(
        "DELETE FROM work_retention_pins WHERE run_id = ? AND owner = ? AND reason = 'review'",
        [run.id, `review:${run.id}`],
      ),
      ...this.touch(run, input.now),
      this.audit(run, "retire", {}, input.now),
    ]);
  }

  private async commandReplay(commandId: string, request: string) {
    const command = await this.sql("SELECT * FROM visonaut_commands WHERE id = ?", [
      commandId,
    ]).first<CommandRow>();
    if (!command) return null;
    if (command.request_digest) {
      const archive = await this.sql(
        "SELECT archive.run_id FROM operations_run_archives archive JOIN visonaut_comparisons comparison ON comparison.run_id=archive.run_id WHERE comparison.id=? AND archive.state='ready'",
        [command.comparison_id],
      ).first<{ run_id: string }>();
      if (archive) {
        if ((await commandRequestDigest(request)) !== command.request_digest) {
          throw new ConflictError("The command ID already belongs to another request.");
        }
        throw new ArchivedCommandResultError(archive.run_id, command.id);
      }
    }
    if (command.request_json !== request) {
      throw new ConflictError("The command ID already belongs to another request.");
    }
    return parseCommandResult(command.result_json);
  }

  private invalidateDependents(project: ProjectRow, now: number): Statement[] {
    return [
      this.sql(
        "UPDATE visonaut_runs SET revision = revision + 1 WHERE project_id = ? AND active = 1",
        [project.id],
      ),
      this.sql(
        "INSERT INTO visonaut_status_outbox (id, run_id, run_revision, created_at) SELECT ? || ':' || id, id, revision, ? FROM visonaut_runs WHERE project_id = ? AND active = 1",
        [crypto.randomUUID(), now, project.id],
      ),
    ];
  }

  private rollbackStatements(project: ProjectRow, promotion: PromotionRow, now: number) {
    return [
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_projects WHERE id = ? AND promotion_id = ? AND baseline_revision = ? AND snapshot_id = ?)",
        [project.id, promotion.id, project.baseline_revision, promotion.snapshot_id],
      ),
      this.guard(
        "NOT EXISTS (SELECT 1 FROM visonaut_snapshot_images WHERE snapshot_id IN (?, ?) AND copied != 1)",
        [promotion.snapshot_id, promotion.previous_snapshot_id],
      ),
      this.sql(
        "UPDATE visonaut_projects SET snapshot_id = ?, promotion_id = NULL, baseline_revision = baseline_revision + 1, fresh_setup = CASE WHEN ? IS NULL THEN 1 ELSE 0 END WHERE id = ?",
        [promotion.previous_snapshot_id, promotion.previous_snapshot_id, project.id],
      ),
      this.sql(
        "UPDATE visonaut_snapshots SET reference_eligible = 0, state = 'revoked' WHERE id = ?",
        [promotion.snapshot_id],
      ),
      this.sql("UPDATE visonaut_promotions SET revoked = 1 WHERE id = ?", [promotion.id]),
      this.sql(
        "UPDATE visonaut_comparisons SET state = 'invalidated' WHERE reference_snapshot_id = ? AND id != ? AND purpose = 'review'",
        [promotion.snapshot_id, promotion.comparison_id],
      ),
      this.sql("UPDATE visonaut_runs SET state = 'reviewing' WHERE comparison_id = ?", [
        promotion.comparison_id,
      ]),
      this.sql(
        "INSERT INTO visonaut_status_outbox (id, run_id, run_revision, created_at) SELECT ? || ':' || id, id, revision, ? FROM visonaut_runs WHERE project_id = ? AND active = 1",
        [crypto.randomUUID(), now, project.id],
      ),
    ];
  }

  async review(input: ReviewParams): Promise<CommandResult> {
    const request = requestJson({ ...input });
    const replay = await this.commandReplay(input.commandId, request);
    if (replay) {
      return replay;
    }
    if (
      !input.actorId ||
      !input.sessionId ||
      input.targets.length === 0 ||
      new Set(input.targets.map((target) => target.id)).size !== input.targets.length
    ) {
      throw new IncompleteError(
        "A review command requires a maintainer, session, and unique targets.",
      );
    }
    const comparison = await this.comparison(input.comparisonId);
    const run = await this.run(comparison.run_id);
    if (run.detail_archived) {
      throw new ConflictError("Archived history is read-only.");
    }
    const project = await this.project(run.project_id);
    const rows = await this.comparisonRows(comparison.id);
    const selected = input.targets.map((target) => {
      const row = rows.find((entry) => entry.id === target.id);
      if (!row || row.outcome !== "changed" || row.decision_revision !== target.expectedRevision) {
        throw new ConflictError("A target changed or belongs to another comparison.", row);
      }
      return row;
    });
    if (input.wholeItemKey) {
      const itemRows = rows.filter(
        (row) => row.item_key === input.wholeItemKey && row.outcome === "changed",
      );
      if (
        itemRows.length !== selected.length ||
        selected.some((row) => row.item_key !== input.wholeItemKey)
      ) {
        throw new ConflictError("The whole-item target list must include every changed variant.");
      }
    }
    const acceptedHistory = await this.sql(
      "SELECT * FROM visonaut_promotions WHERE comparison_id = ? ORDER BY created_at DESC LIMIT 1",
      [comparison.id],
    ).first<PromotionRow>();
    if (acceptedHistory && !acceptedHistory.revoked && input.verdict === "approved") {
      return {
        commandId: input.commandId,
        revisions: input.targets,
        selection: input.selection,
        baselineRevision: project.baseline_revision,
        promotionId: project.promotion_id,
        noop: true,
      };
    }
    let rollback: PromotionRow | null = null;
    if (acceptedHistory && !acceptedHistory.revoked) {
      if (
        project.promotion_id !== acceptedHistory.id ||
        input.expectedPromotionId !== acceptedHistory.id ||
        input.expectedBaselineRevision !== project.baseline_revision
      ) {
        throw new ConflictError(
          "This promotion is no longer current. Use explicit recovery.",
          project,
        );
      }
      rollback = acceptedHistory;
    }
    if (comparison.state !== "ready" || !run.active || run.comparison_id !== comparison.id) {
      throw new ConflictError("Only the active complete comparison can be reviewed.", run);
    }
    const statements = [this.projectGuard(project), this.reviewGuard(run, comparison.id)];
    const previous: PreviousCommandState = { decisions: [], rollback };
    const result: CommandResult = {
      commandId: input.commandId,
      revisions: [],
      selection: input.selection,
      baselineRevision: project.baseline_revision + (rollback ? 1 : 0),
      promotionId: rollback ? null : project.promotion_id,
    };
    for (const row of selected) {
      const effectiveId = row.source_decision_id ?? row.decision_id;
      const effective = effectiveId
        ? await this.one<DecisionRow>("SELECT * FROM visonaut_decisions WHERE id = ?", [
            effectiveId,
          ])
        : null;
      if (rollback && effective?.kind === "automatic") {
        throw new ConflictError(
          "Automatically accepted promoted history is protected. Capture a correction in a new main run.",
          row,
        );
      }
      statements.push(
        this.guard(
          "EXISTS (SELECT 1 FROM visonaut_comparison_rows WHERE id = ? AND comparison_id = ? AND decision_revision = ?)",
          [row.id, comparison.id, row.decision_revision],
        ),
      );
      previous.decisions.push({
        id: row.id,
        decisionId: row.decision_id,
        sourceDecisionId: row.source_decision_id,
        revision: row.decision_revision,
      });
      const decisionId = crypto.randomUUID();
      statements.push(
        this.sql("UPDATE visonaut_decisions SET revoked = 1 WHERE id = ?", [row.decision_id]),
      );
      statements.push(
        this.sql(
          "INSERT INTO visonaut_decisions (id, row_id, revision, verdict, kind, actor_id, command_id, tuple_json, created_at) VALUES (?, ?, ?, ?, 'human', ?, ?, ?, ?)",
          [
            decisionId,
            row.id,
            row.decision_revision + 1,
            input.verdict,
            input.actorId,
            input.commandId,
            row.tuple_json,
            input.now,
          ],
        ),
      );
      if (row.source_decision_id) {
        statements.push(
          this.sql(
            "INSERT INTO visonaut_decision_replacements (source_decision_id, replacement_decision_id, scope, scope_run_id) VALUES (?, ?, ?, ?)",
            [
              row.source_decision_id,
              decisionId,
              rollback || input.verdict === "approved" ? "descendants" : "shared",
              run.id,
            ],
          ),
        );
      }
      // Replacing a rejection must not revive the acceptance it superseded.
      // Undo restores the old decision, so its original edges become active.
      statements.push(
        this.sql(
          "INSERT INTO visonaut_decision_replacements (source_decision_id, replacement_decision_id, scope, scope_run_id) SELECT source_decision_id, ?, scope, scope_run_id FROM visonaut_decision_replacements WHERE replacement_decision_id = ?",
          [decisionId, effectiveId],
        ),
      );
      statements.push(
        this.sql(
          "UPDATE visonaut_comparison_rows SET decision_revision = decision_revision + 1, decision_id = ?, source_decision_id = NULL WHERE id = ?",
          [decisionId, row.id],
        ),
      );
      result.revisions.push({ id: row.id, expectedRevision: row.decision_revision + 1 });
    }
    if (rollback) {
      statements.push(...this.rollbackStatements(project, rollback, input.now));
    }
    statements.push(
      this.sql(
        "INSERT INTO visonaut_commands (id, request_json, actor_id, session_id, kind, comparison_id, previous_json, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          input.commandId,
          request,
          input.actorId,
          input.sessionId,
          input.verdict === "approved" ? "approve" : "reject",
          comparison.id,
          JSON.stringify(previous),
          JSON.stringify(result),
          input.now,
        ],
      ),
    );
    statements.push(
      this.audit(
        run,
        input.verdict === "approved" ? "approve" : "reject",
        { commandId: input.commandId, targets: input.targets },
        input.now,
        input.actorId,
      ),
    );
    statements.push(
      this.currentBaselineGuard(project.id),
      ...this.invalidateDependents(project, input.now),
      ...this.touch(run, input.now),
    );
    try {
      await atomic(this.database, statements);
    } catch (error) {
      const replay = await this.commandReplay(result.commandId, request);
      if (replay) {
        return replay;
      }
      throw error;
    }
    return result;
  }

  async undo(input: {
    commandId: string;
    undoCommandId: string;
    actorId: string;
    sessionId: string;
    expectedBaselineRevision: number;
    now: number;
  }): Promise<CommandResult> {
    const request = requestJson({ ...input });
    const replay = await this.commandReplay(input.undoCommandId, request);
    if (replay) {
      return replay;
    }
    const command = await this.one<CommandRow>("SELECT * FROM visonaut_commands WHERE id = ?", [
      input.commandId,
    ]);
    if (
      command.actor_id !== input.actorId ||
      command.session_id !== input.sessionId ||
      command.undone_by ||
      command.kind === "undo"
    ) {
      throw new ConflictError("Only your saved command in this review session can be undone.");
    }
    const saved = parseCommandResult(command.result_json);
    const previous = JSON.parse(command.previous_json) as PreviousCommandState;
    const comparison = await this.comparison(command.comparison_id);
    const run = await this.run(comparison.run_id);
    const project = await this.project(run.project_id);
    if (project.baseline_revision !== input.expectedBaselineRevision) {
      throw new ConflictError("The baseline changed after this command.", project);
    }
    if (!run.active || run.comparison_id !== comparison.id || comparison.state !== "ready") {
      throw new ConflictError("The command no longer targets the active comparison.");
    }
    const promotion = project.promotion_id
      ? await this.one<PromotionRow>("SELECT * FROM visonaut_promotions WHERE id = ?", [
          project.promotion_id,
        ])
      : null;
    const historical = await this.sql(
      "SELECT 1 AS found FROM visonaut_promotions WHERE comparison_id = ? LIMIT 1",
      [comparison.id],
    ).first();
    if (historical && !previous.rollback && promotion?.comparison_id !== comparison.id) {
      throw new ConflictError("A later promotion prevents Undo. Use explicit recovery.");
    }
    const rollingBack =
      command.kind === "approve" && promotion?.comparison_id === comparison.id ? promotion : null;
    const restoring = previous.rollback;
    if (
      restoring &&
      (project.baseline_revision !== saved.baselineRevision ||
        project.snapshot_id !== restoring.previous_snapshot_id ||
        project.promotion_id !== null)
    ) {
      throw new ConflictError("The rejection rollback has changed. Its Undo is stale.");
    }
    const statements = [
      this.projectGuard(project),
      this.reviewGuard(run, comparison.id),
      this.guard("EXISTS (SELECT 1 FROM visonaut_commands WHERE id = ? AND undone_by IS NULL)", [
        command.id,
      ]),
    ];
    const result: CommandResult = {
      commandId: input.undoCommandId,
      revisions: [],
      selection: saved.selection,
      baselineRevision: project.baseline_revision + (rollingBack || restoring ? 1 : 0),
      promotionId: restoring ? crypto.randomUUID() : rollingBack ? null : project.promotion_id,
    };
    for (const target of saved.revisions) {
      const prior = previous.decisions.find((entry) => entry.id === target.id);
      if (!prior) {
        throw new IncompleteError("The saved command does not contain its prior verdict.");
      }
      statements.push(
        this.guard(
          "EXISTS (SELECT 1 FROM visonaut_comparison_rows WHERE id = ? AND decision_revision = ?)",
          [target.id, target.expectedRevision],
        ),
      );
      statements.push(
        this.sql(
          "UPDATE visonaut_decisions SET revoked = 1 WHERE id = (SELECT decision_id FROM visonaut_comparison_rows WHERE id = ?)",
          [target.id],
        ),
      );
      statements.push(
        this.sql("UPDATE visonaut_decisions SET revoked = 0 WHERE id = ?", [prior.decisionId]),
      );
      statements.push(
        this.sql(
          "UPDATE visonaut_comparison_rows SET decision_revision = decision_revision + 1, decision_id = ?, source_decision_id = ? WHERE id = ?",
          [prior.decisionId, prior.sourceDecisionId, target.id],
        ),
      );
      result.revisions.push({ id: target.id, expectedRevision: target.expectedRevision + 1 });
    }
    if (rollingBack) {
      statements.push(...this.rollbackStatements(project, rollingBack, input.now));
    }
    if (restoring) {
      statements.push(this.readyGuard(comparison.id));
      statements.push(
        this.guard(
          "NOT EXISTS (SELECT 1 FROM visonaut_snapshot_images WHERE snapshot_id IN (?, ?) AND copied != 1)",
          [restoring.snapshot_id, restoring.previous_snapshot_id],
        ),
      );
      statements.push(
        this.sql(
          "UPDATE visonaut_snapshots SET reference_eligible = 1, state = 'accepted' WHERE id = ?",
          [restoring.snapshot_id],
        ),
      );
      statements.push(
        this.sql(
          "INSERT INTO visonaut_promotions (id, project_id, snapshot_id, previous_snapshot_id, comparison_id, baseline_revision, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            result.promotionId,
            project.id,
            restoring.snapshot_id,
            restoring.previous_snapshot_id,
            comparison.id,
            result.baselineRevision,
            input.undoCommandId,
            input.now,
          ],
        ),
      );
      statements.push(
        this.sql(
          "UPDATE visonaut_projects SET snapshot_id = ?, promotion_id = ?, baseline_revision = baseline_revision + 1, fresh_setup = 0 WHERE id = ?",
          [restoring.snapshot_id, result.promotionId, project.id],
        ),
      );
      statements.push(
        this.sql("UPDATE visonaut_runs SET state = 'accepted' WHERE id = ?", [run.id]),
      );
    }
    statements.push(
      this.sql("UPDATE visonaut_commands SET undone_by = ? WHERE id = ?", [
        input.undoCommandId,
        command.id,
      ]),
    );
    statements.push(
      this.sql(
        "INSERT INTO visonaut_commands (id, request_json, actor_id, session_id, kind, comparison_id, previous_json, result_json, created_at) VALUES (?, ?, ?, ?, 'undo', ?, ?, ?, ?)",
        [
          input.undoCommandId,
          request,
          input.actorId,
          input.sessionId,
          comparison.id,
          JSON.stringify({ decisions: [], rollback: null }),
          JSON.stringify(result),
          input.now,
        ],
      ),
    );
    statements.push(
      this.audit(
        run,
        "undo",
        { commandId: command.id, undoCommandId: input.undoCommandId },
        input.now,
        input.actorId,
      ),
    );
    statements.push(
      this.currentBaselineGuard(project.id),
      ...this.invalidateDependents(project, input.now),
      ...this.touch(run, input.now),
    );
    try {
      await atomic(this.database, statements);
    } catch (error) {
      const replay = await this.commandReplay(result.commandId, request);
      if (replay) {
        return replay;
      }
      throw error;
    }
    return result;
  }

  async preparePromotion(input: {
    snapshotId: string;
    comparisonId: string;
    prefix: string;
    now: number;
    copyLimit?: number;
  }) {
    const existing = await this.sql("SELECT * FROM visonaut_snapshots WHERE id = ?", [
      input.snapshotId,
    ]).first<SnapshotRow>();
    if (existing) {
      if (
        existing.comparison_id !== input.comparisonId ||
        existing.prefix !== input.prefix ||
        existing.state === "revoked"
      ) {
        throw new ConflictError("The snapshot ID belongs to another or revoked promotion.");
      }
      return this.pendingSnapshotCopies(existing.id, input.copyLimit ?? 100);
    }
    const comparison = await this.comparison(input.comparisonId);
    const run = await this.run(comparison.run_id);
    const project = await this.project(run.project_id);
    if (run.kind !== "main" || !input.prefix.startsWith("baselines/")) {
      throw new IncompleteError("Only a complete main run can use a protected baseline prefix.");
    }
    await atomic(this.database, [
      this.projectGuard(project),
      this.activeGuard(run),
      this.readyGuard(comparison.id),
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_comparisons WHERE id = ? AND state = 'ready' AND baseline_revision = ? AND reference_snapshot_id IS ?)",
        [comparison.id, project.baseline_revision, project.snapshot_id],
      ),
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND comparison_id = ? AND sealed_at IS NOT NULL)",
        [run.id, comparison.id],
      ),
      this.sql(
        "INSERT INTO visonaut_snapshots (id, project_id, run_id, comparison_id, tested_sha, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          input.snapshotId,
          project.id,
          run.id,
          comparison.id,
          run.tested_sha,
          input.prefix,
          input.now,
        ],
      ),
      this.sql(
        "INSERT INTO visonaut_snapshot_images (snapshot_id, capture_id, image_id, object_key, digest) SELECT ?, c.id, i.id, ? || '/' || i.id, i.digest FROM visonaut_captures c JOIN visonaut_images i ON i.id = c.image_id WHERE c.run_id = ?",
        [input.snapshotId, input.prefix, run.id],
      ),
      this.sql(
        "INSERT INTO visonaut_pins (snapshot_id, reason, owner_id) VALUES (?, 'promotion', ?)",
        [input.snapshotId, input.snapshotId],
      ),
      this.sql(
        "INSERT INTO work_retention_pins (run_id, owner, reason) VALUES (?, ?, 'promotion')",
        [run.id, `promotion:${input.snapshotId}`],
      ),
    ]);
    return this.pendingSnapshotCopies(input.snapshotId, input.copyLimit ?? 100);
  }

  async cancelPreparedPromotion(input: { snapshotId: string; now: number }) {
    const snapshot = await this.one<SnapshotRow>("SELECT * FROM visonaut_snapshots WHERE id = ?", [
      input.snapshotId,
    ]);
    if (snapshot.state === "revoked") return;
    const run = await this.run(snapshot.run_id);
    const project = await this.project(run.project_id);
    await atomic(this.database, [
      this.projectGuard(project),
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_snapshots WHERE id = ? AND state = 'copying' AND reference_eligible = 0)",
        [snapshot.id],
      ),
      this.guard("NOT EXISTS (SELECT 1 FROM visonaut_promotions WHERE snapshot_id = ?)", [
        snapshot.id,
      ]),
      this.sql("UPDATE visonaut_snapshots SET state = 'revoked' WHERE id = ?", [snapshot.id]),
      this.sql(
        "DELETE FROM visonaut_pins WHERE snapshot_id = ? AND reason = 'promotion' AND owner_id = ?",
        [snapshot.id, snapshot.id],
      ),
      this.sql(
        "DELETE FROM work_retention_pins WHERE run_id = ? AND owner = ? AND reason = 'promotion'",
        [run.id, `promotion:${snapshot.id}`],
      ),
      this.audit(run, "cancel-prepared-promotion", { snapshotId: snapshot.id }, input.now),
      ...this.touch(run, input.now),
    ]);
  }

  async pendingSnapshotCopies(snapshotId: string, limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new IncompleteError("A positive copy-page limit is required.");
    }
    return this.rows<{
      capture_id: string;
      image_id: string;
      object_key: string;
      digest: string;
      source_object_key: string;
      copied: number;
      bytes: number;
      content_type: "image/png" | "image/webp";
    }>(
      "SELECT si.*, i.object_key AS source_object_key, i.bytes, i.content_type FROM visonaut_snapshot_images si JOIN visonaut_images i ON i.id = si.image_id WHERE si.snapshot_id = ? AND si.copied = 0 ORDER BY si.capture_id LIMIT ?",
      [snapshotId, limit],
    );
  }

  async snapshotCopies(snapshotId: string) {
    return this.rows<{
      capture_id: string;
      image_id: string;
      object_key: string;
      digest: string;
      source_object_key: string;
      copied: number;
    }>(
      "SELECT si.*, i.object_key AS source_object_key FROM visonaut_snapshot_images si JOIN visonaut_images i ON i.id = si.image_id WHERE si.snapshot_id = ?",
      [snapshotId],
    );
  }

  /** Mark a copy only after an R2 read verifies its digest at the protected key. */
  async recordSnapshotCopy(input: {
    snapshotId: string;
    captureId: string;
    objectKey: string;
    digest: string;
  }) {
    await atomic(this.database, [
      this.guard("EXISTS (SELECT 1 FROM visonaut_snapshots WHERE id = ? AND state = 'copying')", [
        input.snapshotId,
      ]),
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_snapshot_images WHERE snapshot_id = ? AND capture_id = ? AND object_key = ? AND digest = ?)",
        [input.snapshotId, input.captureId, input.objectKey, input.digest],
      ),
      this.sql(
        "UPDATE visonaut_snapshot_images SET copied = 1 WHERE snapshot_id = ? AND capture_id = ?",
        [input.snapshotId, input.captureId],
      ),
    ]);
  }

  async promote(input: {
    snapshotId: string;
    promotionId: string;
    expectedBaselineRevision: number;
    commandId?: string;
    now: number;
  }) {
    const snapshot = await this.one<SnapshotRow>("SELECT * FROM visonaut_snapshots WHERE id = ?", [
      input.snapshotId,
    ]);
    const comparison = await this.comparison(snapshot.comparison_id);
    const run = await this.run(snapshot.run_id);
    const project = await this.project(run.project_id);
    if (project.promotion_id === input.promotionId && project.snapshot_id === snapshot.id) {
      return project;
    }
    const statements = [
      this.projectGuard(project),
      this.activeGuard(run),
      this.readyGuard(comparison.id),
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_projects WHERE id = ? AND baseline_revision = ? AND snapshot_id IS ?)",
        [project.id, input.expectedBaselineRevision, comparison.reference_snapshot_id],
      ),
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND kind = 'main' AND comparison_id = ? AND sealed_at IS NOT NULL)",
        [run.id, comparison.id],
      ),
      this.guard(
        "EXISTS (SELECT 1 FROM visonaut_comparisons WHERE id = ? AND state = 'ready' AND baseline_revision = ?)",
        [comparison.id, project.baseline_revision],
      ),
      this.guard("EXISTS (SELECT 1 FROM visonaut_snapshots WHERE id = ? AND state = 'copying')", [
        snapshot.id,
      ]),
      this.guard(
        "NOT EXISTS (SELECT 1 FROM visonaut_snapshot_images WHERE snapshot_id = ? AND copied != 1) AND (SELECT count(*) FROM visonaut_snapshot_images WHERE snapshot_id = ?) = (SELECT count(*) FROM visonaut_captures WHERE run_id = ?)",
        [snapshot.id, snapshot.id, run.id],
      ),
    ];
    if (project.snapshot_id) {
      statements.push(
        this.guard(
          "EXISTS (SELECT 1 FROM visonaut_snapshots s JOIN visonaut_ancestry a ON a.ancestor_sha = s.tested_sha AND a.run_id = ? WHERE s.id = ? AND s.reference_eligible = 1)",
          [run.id, project.snapshot_id],
        ),
      );
      statements.push(
        this.sql(
          "INSERT OR IGNORE INTO visonaut_pins (snapshot_id, reason, owner_id) VALUES (?, 'rollback', ?)",
          [project.snapshot_id, input.promotionId],
        ),
      );
    }
    statements.push(
      this.sql(
        "INSERT INTO visonaut_promotions (id, project_id, snapshot_id, previous_snapshot_id, comparison_id, baseline_revision, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          input.promotionId,
          project.id,
          snapshot.id,
          project.snapshot_id,
          comparison.id,
          project.baseline_revision + 1,
          input.commandId ?? null,
          input.now,
        ],
      ),
    );
    statements.push(
      this.sql(
        "UPDATE visonaut_runs SET active=0,closed_at=COALESCE(closed_at,?),revision=revision+1 WHERE id IN (SELECT run_id FROM visonaut_snapshots WHERE id=?) AND id!=? AND state='accepted'",
        [input.now, project.snapshot_id, run.id],
      ),
      this.sql(
        "UPDATE work_retained_runs SET closed_at=COALESCE(closed_at,?) WHERE id IN (SELECT run_id FROM visonaut_snapshots WHERE id=?) AND id!=?",
        [input.now, project.snapshot_id, run.id],
      ),
      this.sql(
        "DELETE FROM work_retention_pins WHERE reason='review' AND owner IN (SELECT 'review:' || run_id FROM visonaut_snapshots WHERE id=? AND run_id!=?)",
        [project.snapshot_id, run.id],
      ),
      this.sql(
        "UPDATE visonaut_snapshots SET state = 'accepted', reference_eligible = 1 WHERE id = ?",
        [snapshot.id],
      ),
    );
    statements.push(
      this.sql(
        "UPDATE work_retention_pins SET reason = 'baseline' WHERE run_id = ? AND owner = ?",
        [run.id, `promotion:${snapshot.id}`],
      ),
    );
    statements.push(
      this.sql(
        "UPDATE visonaut_projects SET snapshot_id = ?, promotion_id = ?, baseline_revision = baseline_revision + 1, fresh_setup = 0 WHERE id = ?",
        [snapshot.id, input.promotionId, project.id],
      ),
    );
    statements.push(this.sql("UPDATE visonaut_runs SET state = 'accepted' WHERE id = ?", [run.id]));
    statements.push(
      this.sql(
        "INSERT OR IGNORE INTO visonaut_identity_history (project_id, lineage_key, item_key, variant_key) SELECT ?, 'main', item_key, variant_key FROM visonaut_captures WHERE run_id = ?",
        [project.id, run.id],
      ),
    );
    statements.push(
      this.sql(
        "UPDATE visonaut_comparisons SET state = 'invalidated' WHERE id != ? AND run_id IN (SELECT id FROM visonaut_runs WHERE project_id = ? AND active = 1 AND state != 'accepted')",
        [comparison.id, project.id],
      ),
    );
    statements.push(
      this.audit(
        run,
        "promote",
        { snapshotId: snapshot.id, promotionId: input.promotionId },
        input.now,
      ),
    );
    statements.push(
      ...this.invalidateDependents(project, input.now),
      ...this.touch(run, input.now),
    );
    await atomic(this.database, statements);
    return this.project(project.id);
  }
}
