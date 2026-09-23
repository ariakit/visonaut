import { SecurityError } from "@visonaut/security";
import {
  ArchivedCommandResultError,
  cancelHistoricalPreparation,
  ConflictError,
  type CommandResult,
  type ReviewRow,
} from "@visonaut/service";
import type { HistoryRow } from "../operations/history-format.ts";
import type { PrivateContext } from "./context.js";
import { comparisonReference } from "./ingest.js";
import { integer, jsonBody, object, string, uuid } from "./input.js";
import { operationsStatus } from "./operations.js";

interface ImageView {
  id: string;
  url: string;
  digest: string;
  width: number;
  height: number;
}
interface VariantView {
  id: string;
  key: string;
  label: string;
  kind: "added" | "removed" | "changed" | "unchanged" | "error";
  revision: number;
  verdict: "approved" | "rejected" | null;
  source: "human" | "automatic" | null;
  reviewer?: string;
  reference: ImageView | null;
  candidate: ImageView | null;
  diff: ImageView | null;
  thumbnail?: string;
  changedPixels?: number;
  maskExpected?: boolean;
  ratio?: number;
  engine?: string;
  codec?: string;
  threshold?: string;
  policy?: string;
  referenceProfile?: string;
  candidateProfile?: string;
  error?: string;
  rejectDisabledReason?: string;
  approveDisabledReason?: string;
}
interface ImageRecord {
  id: string;
  digest: string;
  width: number;
  height: number;
  bytes_present: number;
}
interface CaptureRecord {
  id: string;
  image_id: string;
  metadata_json: string;
}
interface DecisionRecord {
  id: string;
  verdict: "approved" | "rejected";
  kind: "human" | "automatic";
  actor_id: string | null;
  revoked: number;
}

async function projectRun(context: PrivateContext, runId: string) {
  const run = await context.service.run(runId);
  if (run.project_id !== context.configuration.projectId) {
    throw new SecurityError("not_found", 404, "The run was not found.");
  }
  return run;
}

const archivedReadOnlyReason =
  "This run is archived. Decisions show the state at archive time and are read-only.";

function historyString(row: HistoryRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error("Archived review metadata is invalid.");
  return value;
}

function historyNumber(row: HistoryRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error("Archived review metadata is invalid.");
  }
  return value;
}

function historyOptionalString(row: HistoryRow, key: string) {
  return row[key] === null ? null : historyString(row, key);
}

function historyReviewRow(row: HistoryRow): ReviewRow {
  const outcome = historyString(row, "outcome");
  if (!["pending", "changed", "unchanged", "error"].includes(outcome)) {
    throw new Error("Archived comparison outcome is invalid.");
  }
  return {
    id: historyString(row, "id"),
    comparison_id: historyString(row, "comparison_id"),
    item_key: historyString(row, "item_key"),
    variant_key: historyString(row, "variant_key"),
    ordinal: historyNumber(row, "ordinal"),
    reference_capture_id: historyOptionalString(row, "reference_capture_id"),
    candidate_capture_id: historyOptionalString(row, "candidate_capture_id"),
    tuple_json: historyString(row, "tuple_json"),
    outcome,
    result_json: historyOptionalString(row, "result_json"),
    decision_revision: historyNumber(row, "decision_revision"),
    decision_id: historyOptionalString(row, "decision_id"),
    source_decision_id: historyOptionalString(row, "source_decision_id"),
  };
}

function historyCapture(row: HistoryRow): CaptureRecord {
  return {
    id: historyString(row, "id"),
    image_id: historyString(row, "image_id"),
    metadata_json: historyString(row, "metadata_json"),
  };
}

function historyImage(row: HistoryRow): ImageRecord {
  return {
    id: historyString(row, "id"),
    digest: historyString(row, "digest"),
    width: historyNumber(row, "width"),
    height: historyNumber(row, "height"),
    bytes_present: 0,
  };
}

function historyDecision(row: HistoryRow): DecisionRecord {
  const verdict = historyString(row, "verdict");
  const kind = historyString(row, "kind");
  if (
    (verdict !== "approved" && verdict !== "rejected") ||
    (kind !== "human" && kind !== "automatic")
  ) {
    throw new Error("Archived review decision is invalid.");
  }
  return {
    id: historyString(row, "id"),
    verdict,
    kind,
    actor_id: historyOptionalString(row, "actor_id"),
    revoked: historyNumber(row, "revoked"),
  };
}

export async function reviewModel(
  context: PrivateContext,
  runId: string,
  selectedComparisonId?: string,
) {
  const run = await projectRun(context, runId);
  const selectedComparison = selectedComparisonId
    ? await context.service.comparison(selectedComparisonId)
    : null;
  if (
    selectedComparison &&
    (selectedComparison.run_id !== run.id || selectedComparison.purpose !== "historical")
  ) {
    throw new SecurityError("not_found", 404, "The historical comparison was not found.");
  }
  const archive = selectedComparison
    ? await context.history?.readComparison?.(run.id, selectedComparison.id)
    : !run.active
      ? await context.history?.read(run.id)
      : null;
  if (selectedComparison && !archive) {
    const archived = await context.database
      .prepare(
        "SELECT 1 FROM operations_comparison_archives WHERE comparison_id = ? AND state = 'ready'",
      )
      .bind(selectedComparison.id)
      .first();
    if (archived)
      throw new SecurityError(
        "history_unavailable",
        503,
        "The historical comparison archive is unavailable.",
      );
  }
  const historical = Boolean(selectedComparison);
  const comparisonId = selectedComparison?.id ?? run.comparison_id;
  const retained = await context.database
    .prepare("SELECT byte_state FROM work_retained_runs WHERE id = ?")
    .bind(run.id)
    .first<{ byte_state: string }>();
  const pendingHistorical = await context.database
    .prepare(
      "SELECT id FROM visonaut_comparisons WHERE run_id = ? AND purpose = 'historical' AND state = 'comparing' LIMIT 1",
    )
    .bind(run.id)
    .first();
  const recompareAllowed = Boolean(
    run.sealed_at && retained?.byte_state === "live" && !pendingHistorical,
  );
  const historicalComparisons = await context.database
    .prepare(
      "SELECT id, ordinal, state, created_at AS createdAt FROM visonaut_comparisons WHERE run_id = ? AND purpose = 'historical' ORDER BY ordinal DESC LIMIT 100",
    )
    .bind(run.id)
    .all();
  const readOnlyReason = archive?.viewUnavailableReason ?? archivedReadOnlyReason;
  const savedRun = archive?.sections.run?.[0];
  if (archive && (!savedRun || savedRun.id !== run.id || savedRun.project_id !== run.project_id)) {
    throw new Error("Archived run identity is inconsistent.");
  }
  const project = await context.service.project(run.project_id);
  const status = await context.service.status(run.id);
  const savedComparison = archive?.sections.comparisons?.find((entry) => entry.id === comparisonId);
  if (archive && comparisonId && !savedComparison) {
    throw new Error("Archived comparison metadata is missing.");
  }
  const comparison = archive
    ? savedComparison
      ? {
          id: historyString(savedComparison, "id"),
          policy_digest: historyString(savedComparison, "policy_digest"),
          state: historyString(savedComparison, "state"),
        }
      : null
    : comparisonId
      ? await context.service.comparison(comparisonId)
      : null;
  const rows = archive
    ? (archive.sections.comparisonRows ?? [])
        .filter((row) => row.comparison_id === comparison?.id)
        .map(historyReviewRow)
        .sort(
          (first, second) => first.ordinal - second.ordinal || first.id.localeCompare(second.id),
        )
    : comparison
      ? await context.service.comparisonRows(comparison.id)
      : [];
  const policyRow = archive
    ? (archive.sections.policies ?? []).find(
        (policy) => policy.digest === comparison?.policy_digest,
      )
    : comparison
      ? await context.database
          .prepare("SELECT policy_json FROM visonaut_policies WHERE digest = ?")
          .bind(comparison.policy_digest)
          .first<{ policy_json: string }>()
      : null;
  const policy = policyRow ? object(JSON.parse(historyString(policyRow, "policy_json"))) : {};
  const threshold = `Channel threshold ${policy.channelThreshold ?? "unknown"}; maximum ${policy.maxChangedPixels ?? "unknown"} changed pixels; ratio ${policy.maxChangedRatio ?? "unknown"}.`;
  const captures = archive
    ? {
        results: [
          ...(archive.sections.captures ?? []),
          ...(archive.sections.referenceCaptures ?? []),
        ].map(historyCapture),
      }
    : await context.database
        .prepare(
          "SELECT c.id, c.image_id, c.metadata_json FROM visonaut_captures c WHERE c.id IN (SELECT candidate_capture_id FROM visonaut_comparison_rows WHERE comparison_id = ? UNION SELECT reference_capture_id FROM visonaut_comparison_rows WHERE comparison_id = ?)",
        )
        .bind(comparison?.id ?? "", comparison?.id ?? "")
        .all<CaptureRecord>();
  const images = archive
    ? {
        results: [
          ...(archive.sections.images ?? []),
          ...(archive.sections.referenceImages ?? []),
        ].map(historyImage),
      }
    : await context.database
        .prepare(
          "SELECT i.id, i.digest, i.width, i.height, i.bytes_present FROM visonaut_images i WHERE i.run_id = (SELECT run_id FROM visonaut_comparisons WHERE id = ?) OR i.id IN (SELECT c.image_id FROM visonaut_captures c JOIN visonaut_comparison_rows r ON r.reference_capture_id = c.id OR r.candidate_capture_id = c.id WHERE r.comparison_id = ?)",
        )
        .bind(comparison?.id ?? "", comparison?.id ?? "")
        .all<ImageRecord>();
  const eligibleApprovals = new Set(
    archive
      ? (archive.sections.acceptance ?? []).map((row) => historyString(row, "id"))
      : comparison
        ? await context.service.eligibleApprovalRowIds(comparison.id)
        : [],
  );
  const decisions = archive
    ? { results: (archive.sections.decisions ?? []).map(historyDecision) }
    : await context.database
        .prepare(
          "SELECT * FROM visonaut_decisions WHERE id IN (SELECT decision_id FROM visonaut_comparison_rows WHERE comparison_id = ? UNION SELECT source_decision_id FROM visonaut_comparison_rows WHERE comparison_id = ?)",
        )
        .bind(comparison?.id ?? "", comparison?.id ?? "")
        .all<DecisionRecord>();
  const history =
    !archive && comparison
      ? await context.database
          .prepare("SELECT id FROM visonaut_promotions WHERE comparison_id = ? LIMIT 1")
          .bind(comparison.id)
          .first()
      : null;
  const currentPromotion =
    !archive && comparison
      ? await context.database
          .prepare(
            "SELECT id FROM visonaut_promotions WHERE id = ? AND comparison_id = ? AND revoked = 0",
          )
          .bind(project.promotion_id, comparison.id)
          .first()
      : null;
  const imageById = new Map(images.results.map((image) => [image.id, image]));
  const captureById = new Map(captures.results.map((capture) => [capture.id, capture]));
  const decisionById = new Map(decisions.results.map((decision) => [decision.id, decision]));
  const imageView = (id: string | undefined): ImageView | null => {
    const image = id ? imageById.get(id) : null;
    if (!image) return null;
    return {
      id: image.id,
      url: `/images/${image.id}`,
      digest: image.digest,
      width: image.width,
      height: image.height,
    };
  };
  const items = new Map<string, { key: string; name: string; variants: VariantView[] }>();
  for (const row of rows) {
    const candidate = row.candidate_capture_id ? captureById.get(row.candidate_capture_id) : null;
    const reference = row.reference_capture_id ? captureById.get(row.reference_capture_id) : null;
    const metadata = object(JSON.parse((candidate ?? reference)?.metadata_json ?? "{}"));
    const variant =
      metadata.variant && typeof metadata.variant === "object" ? object(metadata.variant) : {};
    const tuple = object(JSON.parse(row.tuple_json));
    const result = object(JSON.parse(row.result_json ?? "{}"));
    const decision = decisionById.get(row.source_decision_id ?? row.decision_id ?? "");
    const effective =
      decision &&
      !decision.revoked &&
      (decision.verdict !== "approved" || eligibleApprovals.has(row.id))
        ? decision
        : null;
    const oldHistory = Boolean(history && !currentPromotion);
    const protectedAutomatic = Boolean(currentPromotion && effective?.kind === "automatic");
    const item = items.get(row.item_key) ?? {
      key: row.item_key,
      name: typeof metadata.name === "string" ? metadata.name : row.item_key,
      variants: [],
    };
    const label =
      [
        variant.framework,
        variant.browser,
        variant.colorScheme,
        variant.contrast,
        variant.forcedColors,
        row.variant_key,
      ]
        .filter((value) => typeof value === "string")
        .join(" · ") || row.variant_key;
    const view: VariantView = {
      id: row.id,
      key: row.variant_key,
      label,
      kind:
        row.outcome === "error" || row.outcome === "pending"
          ? "error"
          : row.outcome === "unchanged"
            ? "unchanged"
            : !row.reference_capture_id
              ? "added"
              : !row.candidate_capture_id
                ? "removed"
                : "changed",
      revision: row.decision_revision,
      verdict: effective?.verdict ?? null,
      source: effective?.kind ?? null,
      ...(effective?.actor_id ? { reviewer: effective.actor_id } : {}),
      reference: imageView(reference?.image_id),
      candidate: imageView(candidate?.image_id),
      diff: imageView(typeof result.maskImageId === "string" ? result.maskImageId : undefined),
      ...(typeof result.thumbnailImageId === "string" && imageById.has(result.thumbnailImageId)
        ? { thumbnail: `/images/${result.thumbnailImageId}` }
        : {}),
      ...(typeof result.changedPixels === "number" ? { changedPixels: result.changedPixels } : {}),
      ...(typeof result.maskImageId === "string"
        ? { maskExpected: true }
        : typeof result.maskExpected === "boolean"
          ? { maskExpected: result.maskExpected }
          : result.outcome === "unchanged"
            ? { maskExpected: false }
            : {}),
      ...(typeof result.ratio === "number" ? { ratio: result.ratio } : {}),
      ...(typeof result.engineVersion === "string" ? { engine: result.engineVersion } : {}),
      ...(typeof result.codecVersion === "string" ? { codec: result.codecVersion } : {}),
      policy: comparison?.policy_digest,
      threshold,
      ...(typeof tuple.referenceProfileDigest === "string"
        ? { referenceProfile: tuple.referenceProfileDigest }
        : {}),
      ...(typeof tuple.candidateProfileDigest === "string"
        ? { candidateProfile: tuple.candidateProfileDigest }
        : {}),
      ...(row.outcome === "pending"
        ? { error: "Comparison is still running." }
        : row.outcome === "error"
          ? { error: "Comparison evidence is unavailable." }
          : {}),
      ...(archive
        ? {
            rejectDisabledReason: readOnlyReason,
            approveDisabledReason: readOnlyReason,
          }
        : oldHistory
          ? {
              rejectDisabledReason:
                "A later baseline is current. Capture a correction or use explicit recovery.",
              approveDisabledReason: "A later baseline is current.",
            }
          : protectedAutomatic
            ? {
                rejectDisabledReason:
                  "This automatic acceptance is already in the baseline. Capture a correction.",
              }
            : {}),
    };
    item.variants.push(view);
    items.set(item.key, item);
  }
  return {
    run: {
      id: run.id,
      repository: context.configuration.github.repository,
      kind: run.kind,
      testedSha: run.tested_sha,
      attempt: run.attempt,
      status: historical
        ? comparison?.state === "ready"
          ? "compared"
          : comparison?.state === "invalidated"
            ? "failed"
            : "comparing"
        : status.status,
      ...(archive?.viewUnavailableReason
        ? { error: archive.viewUnavailableReason }
        : historical && comparison?.state === "invalidated"
          ? {
              error:
                "Historical comparison failed. Required comparison evidence or its reference is unavailable. Use Recompare if the image bytes are available, or start a new capture.",
            }
          : {}),
    },
    ...(!run.active || historical || archive
      ? {
          archived: true,
          readOnlyReason: historical
            ? "This historical comparison is read-only. It does not affect the live review or required check."
            : readOnlyReason,
        }
      : {}),
    recompareAllowed,
    recompareDisabledReason: recompareAllowed
      ? undefined
      : !run.sealed_at
        ? "This run has not sealed."
        : pendingHistorical
          ? "A historical comparison is still running."
          : "The stored image bytes have expired.",
    historicalComparisons: historicalComparisons.results,
    comparisonId: comparison?.id ?? "",
    comparisonState: comparison?.state ?? "comparing",
    comparisonRevision: selectedComparison?.ordinal ?? run.revision,
    reviewReady: Boolean(
      !historical &&
      !archive &&
      run.active &&
      run.sealed_at &&
      comparison?.state === "ready" &&
      !["needs-recompare", "failed", "superseded"].includes(status.status),
    ),
    baselineRevision: project.baseline_revision,
    promotionId: project.promotion_id,
    items: [...items.values()],
  };
}

async function reviewSession(context: PrivateContext, id: unknown) {
  const sessionId = uuid(id);
  const session = await context.database
    .prepare(
      "SELECT id FROM ingest_review_sessions WHERE id = ? AND auth_session_id = ? AND actor_id = ?",
    )
    .bind(sessionId, context.identity.sessionId, context.identity.githubUserId)
    .first();
  if (!session) {
    throw new SecurityError(
      "review_session_expired",
      409,
      "Start a new review session after signing in.",
    );
  }
  return sessionId;
}

async function commandResult(context: PrivateContext, result: CommandResult, runId: string) {
  return Response.json({ ...result, model: await reviewModel(context, runId) });
}

async function archivedCommandResult(
  context: PrivateContext,
  error: ArchivedCommandResultError,
  runId: string,
) {
  if (error.runId !== runId || !context.history) throw error;
  const result = await context.history.readCommand(runId, error.commandId);
  if (result.commandId !== error.commandId)
    throw new Error("Archived command identity is inconsistent.");
  return commandResult(context, result, runId);
}

async function conflictResponse(context: PrivateContext, error: ConflictError, runId: string) {
  const model = await reviewModel(context, runId);
  const current = error.current && typeof error.current === "object" ? object(error.current) : {};
  const targetId = typeof current.id === "string" ? current.id : "";
  const row = model.items
    .flatMap((item) => item.variants)
    .find((variant) => variant.id === targetId);
  return Response.json(
    {
      error: { code: "conflict", message: error.message },
      model,
      ...(row?.reviewer ? { reviewer: row.reviewer } : {}),
    },
    { status: 409 },
  );
}

export async function handleReview(
  request: Request,
  context: PrivateContext,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/api/operations" && request.method === "GET") {
    return Response.json(
      await operationsStatus({
        database: context.database,
        projectId: context.configuration.projectId,
        repositoryId: context.configuration.github.repositoryId,
      }),
    );
  }
  if (path === "/api/session" && request.method === "GET") {
    return Response.json({
      user: {
        id: context.identity.userId,
        githubUserId: context.identity.githubUserId,
        login: context.identity.login,
      },
    });
  }
  if (path === "/api/review-sessions" && request.method === "POST") {
    const id = crypto.randomUUID();
    await context.database
      .prepare(
        "INSERT INTO ingest_review_sessions (id, auth_session_id, actor_id, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(id, context.identity.sessionId, context.identity.githubUserId, Date.now())
      .run();
    return Response.json({ reviewSessionId: id }, { status: 201 });
  }
  if (path === "/api/runs" && request.method === "GET") {
    const runs = await context.database
      .prepare(
        "SELECT id, kind, tested_sha AS testedSha, state, attempt, created_at AS createdAt, comparison_id AS comparisonId FROM visonaut_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 100",
      )
      .bind(context.configuration.projectId)
      .all();
    const project = await context.service.project(context.configuration.projectId);
    return Response.json({
      runs: runs.results,
      project: {
        repository: context.configuration.github.repository,
        baselineRevision: project.baseline_revision,
        snapshotId: project.snapshot_id,
        promotionId: project.promotion_id,
      },
    });
  }
  const runMatch = /^\/api\/runs\/([a-f0-9-]+)$/.exec(path);
  if (runMatch?.[1] && request.method === "GET") {
    const selected = new URL(request.url).searchParams.get("comparison");
    return Response.json(
      await reviewModel(context, uuid(runMatch[1]), selected ? uuid(selected) : undefined),
    );
  }
  const commandMatch = /^\/api\/comparisons\/([a-f0-9-]+)\/commands$/.exec(path);
  if (commandMatch?.[1] && request.method === "POST") {
    const comparisonId = uuid(commandMatch[1]);
    const comparison = await context.service.comparison(comparisonId);
    const run = await projectRun(context, comparison.run_id);
    const body = await jsonBody(request, 1024 * 1024);
    const sessionId = await reviewSession(context, body.reviewSessionId);
    if (body.verdict !== "approved" && body.verdict !== "rejected") {
      throw new SecurityError("invalid_verdict", 400, "Choose approved or rejected.");
    }
    if (
      !Array.isArray(body.targets) ||
      body.targets.length > context.configuration.limits.maximumCaptures
    ) {
      throw new SecurityError("invalid_targets", 400, "The review targets are invalid.");
    }
    const selection = object(body.selection);
    try {
      const result = await context.service.review({
        commandId: uuid(body.commandId),
        actorId: context.identity.githubUserId,
        sessionId,
        comparisonId,
        verdict: body.verdict,
        targets: body.targets.map((value) => {
          const target = object(value);
          return { id: string(target.id), expectedRevision: integer(target.expectedRevision) };
        }),
        selection: { itemKey: string(selection.itemKey), variantKey: string(selection.variantKey) },
        expectedBaselineRevision: integer(body.expectedBaselineRevision),
        ...(body.expectedPromotionId === undefined
          ? {}
          : { expectedPromotionId: string(body.expectedPromotionId) }),
        ...(body.wholeItemKey === undefined ? {} : { wholeItemKey: string(body.wholeItemKey) }),
        now: Date.now(),
      });
      return commandResult(context, result, run.id);
    } catch (error) {
      if (error instanceof ArchivedCommandResultError) {
        return archivedCommandResult(context, error, run.id);
      }
      if (error instanceof ConflictError) {
        return conflictResponse(context, error, run.id);
      }
      throw error;
    }
  }
  const undoMatch = /^\/api\/commands\/([a-f0-9-]+)\/undo$/.exec(path);
  if (undoMatch?.[1] && request.method === "POST") {
    const commandId = uuid(undoMatch[1]);
    const command = await context.database
      .prepare("SELECT comparison_id FROM visonaut_commands WHERE id = ? AND actor_id = ?")
      .bind(commandId, context.identity.githubUserId)
      .first<{ comparison_id: string }>();
    if (!command) {
      throw new SecurityError("not_found", 404, "Your command was not found.");
    }
    const comparison = await context.service.comparison(command.comparison_id);
    const run = await projectRun(context, comparison.run_id);
    const body = await jsonBody(request, 16_384);
    const sessionId = await reviewSession(context, body.reviewSessionId);
    try {
      const result = await context.service.undo({
        commandId,
        undoCommandId: uuid(body.undoCommandId),
        actorId: context.identity.githubUserId,
        sessionId,
        expectedBaselineRevision: integer(body.expectedBaselineRevision),
        now: Date.now(),
      });
      return commandResult(context, result, run.id);
    } catch (error) {
      if (error instanceof ArchivedCommandResultError) {
        return archivedCommandResult(context, error, run.id);
      }
      if (error instanceof ConflictError) {
        return conflictResponse(context, error, run.id);
      }
      throw error;
    }
  }
  const recompareMatch = /^\/api\/runs\/([a-f0-9-]+)\/recompare$/.exec(path);
  if (recompareMatch?.[1] && request.method === "POST") {
    const run = await projectRun(context, uuid(recompareMatch[1]));
    const historical = !run.active;
    const comparisonId = crypto.randomUUID();
    try {
      const reference = await comparisonReference(context, run, historical);
      const expectedCaptureCount = historical
        ? await context.history?.prepareComparison?.({
            runId: run.id,
            comparisonId,
            referenceSnapshotId: reference.referenceSnapshotId,
            maximumCaptures: context.configuration.limits.maximumCaptures,
          })
        : undefined;
      if (historical && expectedCaptureCount === undefined) {
        throw new SecurityError(
          "history_unavailable",
          503,
          "Historical recomparison is temporarily unavailable.",
        );
      }
      const comparison = await context.service.createComparison({
        id: comparisonId,
        ...(historical ? ({ purpose: "historical", expectedCaptureCount } as const) : {}),
        runId: run.id,
        ...reference,
        now: Date.now(),
        maxAttempts: context.configuration.comparisonMaxAttempts,
      });
      const rows = await context.service.comparisonRows(comparison.id);
      for (const row of rows) {
        if (row.outcome === "pending") {
          await context.comparisons.send({ taskId: row.id });
        }
      }
      if (rows.every((row) => row.outcome !== "pending" && row.outcome !== "error")) {
        await context.service.finalizeComparison({ comparisonId: comparison.id, now: Date.now() });
      }
      return Response.json(
        await reviewModel(context, run.id, historical ? comparison.id : undefined),
        { status: 202 },
      );
    } catch (error) {
      if (historical) await cancelHistoricalPreparation(context.database, comparisonId, Date.now());
      throw error;
    }
  }
  const exportMatch = /^\/api\/runs\/([a-f0-9-]+)\/export$/.exec(path);
  if (exportMatch?.[1] && request.method === "POST") {
    const run = await projectRun(context, uuid(exportMatch[1]));
    if (!context.exports) {
      throw new SecurityError("export_unavailable", 503, "Export is temporarily unavailable.");
    }
    return Response.json(await context.exports.create(run.id, context.identity.githubUserId), {
      status: 202,
    });
  }
  const downloadMatch = /^\/api\/exports\/([a-f0-9-]+)$/.exec(path);
  if (downloadMatch?.[1] && request.method === "GET") {
    if (!context.exports) {
      throw new SecurityError("export_unavailable", 503, "Export is temporarily unavailable.");
    }
    return context.exports.download(uuid(downloadMatch[1]));
  }
  return null;
}
