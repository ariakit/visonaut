import {
  decisionReceipt,
  enqueueReview,
  failedDecision,
  processReviewQueue,
  reviewTaskId,
  type QueuedReviewInput,
} from "../operations/review-queue.ts";
import {
  compactReviewItems,
  compactReviewModel,
  type CompactCapturePage,
} from "../review/compact-model.ts";
import type { ReviewModel, ComparisonState } from "../review/model.ts";
import { dashboard, type RunsAnswer } from "./dashboard.js";
import { pullAnswer } from "./pulls.js";
import { SecurityError } from "@visonaut/security";
import { CAPTURE_PAGE_ROWS, compareCaptureIdentity, identityKey } from "@visonaut/protocol";
import { readReviewInventory, unchangedReviewRows } from "./review-inventory.ts";
import {
  ArchivedCommandResultError,
  ConflictError,
  type CommandResult,
  type ReviewRow,
  getWork,
} from "@visonaut/service";
import { readClosedSummary } from "../operations/closed-summary.ts";
import type { HistoryRow } from "../operations/history-format.ts";
import { type PrivateContext } from "./context.js";
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
  labelParts: {
    value: string;
    kind: "framework" | "browser" | "colorScheme" | "contrast" | "forcedColors" | "key";
  }[];
  kind: "added" | "removed" | "changed" | "unchanged" | "pending" | "error";
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
  candidateOmitted?: boolean;
  ratio?: number;
  engine?: string;
  codec?: string;
  threshold?: string;
  policy?: string;
  referenceProfile?: string;
  candidateProfile?: string;
  error?: string;
}
interface ImageRecord {
  id: string;
  digest: string;
  width: number;
  height: number;
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

function batchRows<T>(result: { results?: unknown[] } | undefined): T[] {
  if (!result) throw new Error("The review query batch is incomplete.");
  return (result.results ?? []) as T[];
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
const historicalComparisonError =
  "Historical comparison failed. Required comparison evidence or its reference is unavailable. Capture a new complete run for a new result.";
const serverRecompareDisabledReason =
  "Server recomparison is retired. Capture a new complete run with trusted local Submit.";

export async function reviewPollState(
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
  const comparisonId = selectedComparison?.id ?? run.comparison_id;
  const comparison = comparisonId
    ? (selectedComparison ?? (await context.service.comparison(comparisonId)))
    : null;
  const historical = Boolean(selectedComparison);
  const status = historical
    ? comparison?.state === "ready"
      ? "compared"
      : comparison?.state === "invalidated"
        ? "failed"
        : "comparing"
    : (await context.service.status(run.id)).status;
  return {
    run: {
      status,
      ...(historical && comparison?.state === "invalidated"
        ? { error: historicalComparisonError }
        : {}),
    },
    comparisonState: (comparison?.state as ComparisonState) ?? "comparing",
    reviewReady: Boolean(
      !historical &&
      run.active &&
      run.state !== "accepted" &&
      run.sealed_at &&
      comparison?.state === "ready" &&
      !["needs-recompare", "failed", "superseded"].includes(status),
    ),
    archived: historical || !run.active || run.state === "accepted",
  };
}

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

/**
 * The baseline that Submit stored in a review row, in the form of a capture
 * record. The stored value is also the metadata: it has the name and the
 * variant of a removed capture, and a changed capture takes them from its candidate.
 */
function storedBaseline(row: ReviewRow, referenceDigest: unknown) {
  if (!row.reference_json || typeof referenceDigest !== "string") return null;
  const { imageId, width, height } = object(JSON.parse(row.reference_json));
  if (typeof imageId !== "string" || typeof width !== "number" || typeof height !== "number") {
    throw new Error("The stored baseline of a review row is invalid.");
  }
  return {
    capture: { id: row.id, image_id: imageId, metadata_json: row.reference_json },
    image: { id: imageId, digest: referenceDigest, width, height },
  };
}

/** A row with a baseline that D1 does not hold: Submit wrote it before it stored the baseline. */
function lacksStoredBaseline(row: ReviewRow) {
  if (row.reference_capture_id || row.reference_json) return false;
  return typeof object(JSON.parse(row.tuple_json)).referenceDigest === "string";
}

interface ReviewItemsParams {
  rows: ReviewRow[];
  captures: Map<string, CaptureRecord>;
  images: Map<string, ImageRecord>;
  decisions: Map<string, DecisionRecord>;
  eligibleApprovals: Set<string>;
  /** The capture lists, for a capture or a baseline that D1 does not hold. */
  inventory: Awaited<ReturnType<typeof readReviewInventory>>;
  /** The comparison ended before each row had a result. */
  comparisonStopped: boolean;
  policyDigest?: string;
  /** The threshold text of the project policy, for a capture with no settings of its own. */
  threshold: string;
}

/** The items of a review answer, with one variant for each row. */
function reviewItems({
  rows,
  captures,
  images: imageById,
  decisions,
  eligibleApprovals,
  inventory,
  comparisonStopped,
  policyDigest,
  threshold,
}: ReviewItemsParams) {
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
  let rowsWithCandidate = 0;
  for (const row of rows) {
    const stoppedBeforeEvidence = row.outcome === "pending" && comparisonStopped;
    const identity = identityKey({ itemKey: row.item_key, variantKey: row.variant_key });
    const tuple = object(JSON.parse(row.tuple_json));
    if (tuple.candidateDigest !== null) {
      rowsWithCandidate += 1;
    }
    const baseline = storedBaseline(row, tuple.referenceDigest);
    if (baseline) {
      imageById.set(baseline.image.id, baseline.image);
    }
    const candidate =
      tuple.candidateDigest === null
        ? null
        : ((row.candidate_capture_id ? captures.get(row.candidate_capture_id) : null) ??
          inventory?.candidateByIdentity.get(identity));
    const reference =
      tuple.referenceDigest === null
        ? null
        : ((row.reference_capture_id ? captures.get(row.reference_capture_id) : null) ??
          baseline?.capture ??
          inventory?.referenceByIdentity.get(identity));
    const metadata = object(JSON.parse((candidate ?? reference)?.metadata_json ?? "{}"));
    const variant =
      metadata.variant && typeof metadata.variant === "object" ? object(metadata.variant) : {};
    const candidateOmitted =
      row.outcome === "unchanged" &&
      tuple.candidateDigest !== null &&
      (metadata.candidateStored === false || metadata.candidateStored === 0) &&
      tuple.candidateDigest !== tuple.referenceDigest;
    const result = object(JSON.parse(row.result_json ?? "{}"));
    const decision = decisions.get(row.source_decision_id ?? row.decision_id ?? "");
    const effective =
      decision &&
      !decision.revoked &&
      (decision.verdict !== "approved" || eligibleApprovals.has(row.id))
        ? decision
        : null;
    const item = items.get(row.item_key) ?? {
      key: row.item_key,
      name: typeof metadata.name === "string" ? metadata.name : row.item_key,
      variants: [],
    };
    const labelParts: VariantView["labelParts"] = [];
    for (const [kind, value] of [
      ["framework", variant.framework],
      ["browser", variant.browser],
      ["colorScheme", variant.colorScheme],
      ["contrast", variant.contrast],
      ["forcedColors", variant.forcedColors],
      ["key", row.variant_key],
    ] as const) {
      if (typeof value === "string") {
        labelParts.push({ kind, value });
      }
    }
    const label = labelParts.map((part) => part.value).join(" · ");
    const view: VariantView = {
      id: row.id,
      key: row.variant_key,
      label,
      labelParts,
      kind: stoppedBeforeEvidence
        ? "error"
        : row.outcome === "error" || row.outcome === "pending" || row.outcome === "unchanged"
          ? row.outcome
          : tuple.referenceDigest === null
            ? "added"
            : tuple.candidateDigest === null
              ? "removed"
              : "changed",
      revision: row.decision_revision,
      verdict: effective?.verdict ?? null,
      source: effective?.kind ?? null,
      ...(effective?.actor_id ? { reviewer: effective.actor_id } : {}),
      reference: imageView(reference?.image_id),
      candidate: candidateOmitted ? null : imageView(candidate?.image_id),
      ...(candidateOmitted ? { candidateOmitted: true } : {}),
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
      policy:
        typeof metadata.comparisonDigest === "string" ? metadata.comparisonDigest : policyDigest,
      threshold:
        metadata.comparison && typeof metadata.comparison === "object"
          ? `Color threshold ${object(metadata.comparison).threshold}; ${object(metadata.comparison).maxDiffPixels === undefined ? "" : `maximum ${object(metadata.comparison).maxDiffPixels} pixels; `}${object(metadata.comparison).maxDiffPixelRatio === undefined ? "" : `ratio ${object(metadata.comparison).maxDiffPixelRatio}`}`
          : threshold,
      ...(typeof tuple.referenceProfileDigest === "string"
        ? { referenceProfile: tuple.referenceProfileDigest }
        : {}),
      ...(typeof tuple.candidateProfileDigest === "string"
        ? { candidateProfile: tuple.candidateProfileDigest }
        : {}),
      ...(stoppedBeforeEvidence
        ? { error: "Comparison stopped before evidence was available." }
        : row.outcome === "error"
          ? { error: "Comparison evidence is unavailable." }
          : {}),
    };
    item.variants.push(view);
    items.set(item.key, item);
  }
  return { items: [...items.values()], rowsWithCandidate };
}

/** The threshold text of a project policy. */
function policyThreshold(policyJson: string) {
  const policy = object(JSON.parse(policyJson));
  const pixelLimit =
    typeof policy.maxChangedPixels === "number"
      ? `maximum ${policy.maxChangedPixels} changed pixels; `
      : "";
  return `Channel threshold ${policy.channelThreshold ?? "unknown"}; ${pixelLimit}ratio ${policy.maxChangedRatio ?? "unknown"}.`;
}

/** A page by its number, or the page that holds one capture. */
export type CapturePagePlace = { page: number } | { itemKey: string; variantKey: string };

const capturePageNotFound = "The capture page was not found.";

/**
 * One page of the captures of a run, as unchanged variants: the second
 * request of a run page. A page is the `CAPTURE_PAGE_ROWS` captures at that
 * place in the order of the item key and then the variant key, which is the
 * order of the capture pages of the protocol. The answer leaves out a capture
 * with a stored review row, because the first response has it. It fails for a
 * capture that has a change and no stored row.
 */
export async function reviewCapturePage(
  context: PrivateContext,
  runId: string,
  place: CapturePagePlace,
): Promise<CompactCapturePage> {
  const run = await projectRun(context, runId);
  const listed =
    run.comparison_id && run.inventory_key && !run.inventory_key.startsWith("baselines/import/");
  const [evidence, comparison] = listed
    ? await Promise.all([
        readReviewInventory(context, run),
        context.service.comparison(run.comparison_id ?? ""),
      ])
    : [null, null];
  if (!evidence || !comparison) {
    throw new SecurityError("not_found", 404, capturePageNotFound);
  }
  const captures = [...evidence.inventory.captures].sort((first, second) =>
    compareCaptureIdentity([first.itemKey, first.variantKey], [second.itemKey, second.variantKey]),
  );
  const pages = Math.ceil(captures.length / CAPTURE_PAGE_ROWS);
  const index =
    "page" in place
      ? place.page * CAPTURE_PAGE_ROWS
      : captures.findIndex(
          (capture) => capture.itemKey === place.itemKey && capture.variantKey === place.variantKey,
        );
  if (index < 0 || index >= captures.length) {
    throw new SecurityError("not_found", 404, capturePageNotFound);
  }
  const page = Math.floor(index / CAPTURE_PAGE_ROWS);
  // The identities of the stored rows: a capture of the page with a change
  // must have one. The rows grow with the changes of the run, not its captures.
  const [policies, identities] = await context.database.batch([
    context.database
      .prepare("SELECT policy_json FROM visonaut_policies WHERE digest = ?")
      .bind(comparison.policy_digest),
    context.database
      .prepare("SELECT item_key, variant_key FROM visonaut_comparison_rows WHERE comparison_id = ?")
      .bind(comparison.id),
  ]);
  const policy = batchRows<{ policy_json: string }>(policies)[0];
  const stored = new Set(
    batchRows<{ item_key: string; variant_key: string }>(identities).map((row) =>
      identityKey({ itemKey: row.item_key, variantKey: row.variant_key }),
    ),
  );
  const { items } = reviewItems({
    rows: unchangedReviewRows(
      evidence,
      captures.slice(page * CAPTURE_PAGE_ROWS, (page + 1) * CAPTURE_PAGE_ROWS),
      comparison.id,
      stored,
    ),
    // Each capture and each baseline of a page comes from the capture lists.
    captures: new Map(),
    images: new Map(evidence.images.map((image) => [image.id, image])),
    decisions: new Map(),
    eligibleApprovals: new Set(),
    inventory: evidence,
    comparisonStopped: false,
    policyDigest: comparison.policy_digest,
    threshold: policyThreshold(policy?.policy_json ?? "{}"),
  });
  return { format: "review-captures-1", page, pages, ...compactReviewItems(items) };
}

/**
 * The first response of a run page: the run header, the counts, and the rows
 * that D1 stores. It reads no capture list from R2 for a run whose rows hold
 * their baseline.
 */
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
  const archive = run.detail_archived ? await readClosedSummary(context.database, run.id) : null;
  if (run.detail_archived && !archive)
    throw new SecurityError(
      "history_conversion_pending",
      503,
      "Closed history is being converted to a decision summary.",
    );
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
  const readOnlyReason = archive?.viewUnavailableReason ?? archivedReadOnlyReason;
  const savedRun = archive?.sections.run?.[0];
  if (archive && (!savedRun || savedRun.id !== run.id || savedRun.project_id !== run.project_id)) {
    throw new Error("Archived run identity is inconsistent.");
  }
  const savedComparison = archive?.sections.comparisons?.find((entry) => entry.id === comparisonId);
  if (archive && comparisonId && !savedComparison) {
    throw new Error("Archived comparison metadata is missing.");
  }
  const pullRequestNumber =
    run.kind === "pull_request" ? Number(/^pr:(\d+)$/.exec(run.lineage_key)?.[1]) || null : null;
  const [metadata, project, liveComparison] = await Promise.all([
    context.database.batch([
      context.database
        .prepare("SELECT byte_state FROM work_retained_runs WHERE id = ?")
        .bind(run.id),
      context.database
        .prepare(
          "SELECT id, ordinal, state, created_at AS createdAt FROM visonaut_comparisons WHERE run_id = ? AND purpose = 'historical' ORDER BY ordinal DESC LIMIT 100",
        )
        .bind(run.id),
      context.database
        .prepare(
          "SELECT json_extract(payload_json,'$.pull_request.title') AS title FROM github_webhook_delivery WHERE event='pull_request' AND CAST(json_extract(payload_json,'$.repository.id') AS TEXT)=? AND json_extract(payload_json,'$.pull_request.number')=? ORDER BY received_at DESC LIMIT 1",
        )
        .bind(context.configuration.github.repositoryId, pullRequestNumber),
    ]),
    context.service.project(run.project_id),
    // A closed summary has the comparison, and a selected one is loaded.
    archive || !comparisonId
      ? null
      : (selectedComparison ?? context.service.comparison(comparisonId)),
  ]);
  const comparison = savedComparison
    ? {
        id: historyString(savedComparison, "id"),
        policy_digest: historyString(savedComparison, "policy_digest"),
        state: historyString(savedComparison, "state"),
      }
    : liveComparison;
  const retained = batchRows<{ byte_state: string }>(metadata[0])[0];
  const historicalComparisons = batchRows<{
    id: string;
    ordinal: number;
    state: ComparisonState;
    createdAt: number;
  }>(metadata[1]);
  const localRun =
    run.inventory_key ||
    (await context.database
      .prepare(
        "SELECT 1 FROM visonaut_captures WHERE run_id=? AND json_extract(metadata_json,'$.localMode')='local-v1' LIMIT 1",
      )
      .bind(run.id)
      .first());
  const [status, rows, liveMetadata, eligibleApprovalRowIds] = await Promise.all([
    // The status reader gets the rows of this read, and reads only the others.
    context.service.status(run.id, { run, project, comparison: liveComparison }),
    archive
      ? (archive.sections.comparisonRows ?? [])
          .filter((row) => row.comparison_id === comparison?.id)
          .map(historyReviewRow)
          .sort(
            (first, second) => first.ordinal - second.ordinal || first.id.localeCompare(second.id),
          )
      : comparison
        ? context.service.reviewRows(comparison.id)
        : [],
    !archive && comparison
      ? context.database.batch([
          context.database
            .prepare("SELECT policy_json FROM visonaut_policies WHERE digest = ?")
            .bind(comparison.policy_digest),
          context.database
            .prepare(
              "SELECT c.id, c.image_id, c.metadata_json FROM visonaut_captures c WHERE c.id IN (SELECT candidate_capture_id FROM visonaut_comparison_rows WHERE comparison_id = ? UNION SELECT reference_capture_id FROM visonaut_comparison_rows WHERE comparison_id = ?)",
            )
            .bind(comparison.id, comparison.id),
          context.database
            .prepare(
              "SELECT i.id, i.digest, i.width, i.height FROM visonaut_images i WHERE i.run_id = (SELECT run_id FROM visonaut_comparisons WHERE id = ?) OR i.id IN (SELECT c.image_id FROM visonaut_captures c JOIN visonaut_comparison_rows r ON r.reference_capture_id = c.id OR r.candidate_capture_id = c.id WHERE r.comparison_id = ?)",
            )
            .bind(comparison.id, comparison.id),
          context.database
            .prepare(
              "SELECT * FROM visonaut_decisions WHERE id IN (SELECT decision_id FROM visonaut_comparison_rows WHERE comparison_id = ? UNION SELECT source_decision_id FROM visonaut_comparison_rows WHERE comparison_id = ?)",
            )
            .bind(comparison.id, comparison.id),
        ])
      : null,
    archive
      ? (archive.sections.acceptance ?? []).map((row) => historyString(row, "id"))
      : comparison
        ? context.service.eligibleApprovalRowIds(comparison.id)
        : [],
  ]);
  // Only the import of a baseline writes a capture list below this prefix.
  const importedBaseline = Boolean(run.inventory_key?.startsWith("baselines/import/"));
  // A closed summary has no capture rows in D1, and a run from before the
  // stored baseline has no baseline there. Both read the two capture lists.
  const inventory =
    run.inventory_key && (archive || rows.some(lacksStoredBaseline))
      ? await readReviewInventory(context, run)
      : null;
  const policyRow = archive
    ? (archive.sections.policies ?? []).find(
        (policy) => policy.digest === comparison?.policy_digest,
      )
    : liveMetadata
      ? batchRows<{ policy_json: string }>(liveMetadata[0])[0]
      : null;
  const captures = archive
    ? {
        results: [
          ...(archive.sections.captures ?? []),
          ...(archive.sections.referenceCaptures ?? []),
        ]
          .filter((entry) => typeof entry.id === "string")
          .map(historyCapture),
      }
    : { results: liveMetadata ? batchRows<CaptureRecord>(liveMetadata[1]) : [] };
  const images = archive
    ? {
        results: [
          ...(archive.sections.images ?? []),
          ...(archive.sections.referenceImages ?? []),
        ].map(historyImage),
      }
    : { results: liveMetadata ? batchRows<ImageRecord>(liveMetadata[2]) : [] };
  if (inventory) {
    captures.results.push(...inventory.candidates, ...inventory.references);
    images.results.push(...inventory.images);
  }
  const decisions = archive
    ? { results: (archive.sections.decisions ?? []).map(historyDecision) }
    : { results: liveMetadata ? batchRows<DecisionRecord>(liveMetadata[3]) : [] };
  const threshold = policyThreshold(policyRow ? historyString(policyRow, "policy_json") : "{}");
  const eligibleApprovals = new Set(eligibleApprovalRowIds);
  const imageById = new Map(images.results.map((image) => [image.id, image]));
  const captureById = new Map(captures.results.map((capture) => [capture.id, capture]));
  const decisionById = new Map(decisions.results.map((decision) => [decision.id, decision]));
  const comparisonStopped =
    comparison?.state === "invalidated" ||
    (!historical && (status.status === "failed" || status.status === "superseded"));
  const { items, rowsWithCandidate } = reviewItems({
    rows,
    captures: captureById,
    images: imageById,
    decisions: decisionById,
    eligibleApprovals,
    inventory,
    comparisonStopped,
    policyDigest: comparison?.policy_digest,
    threshold,
  });
  // The capture list of a run has each capture. A stored row with a candidate
  // is one of them, and each other capture of the list is unchanged.
  const captureCount =
    comparison && run.inventory_key && !importedBaseline ? (run.capture_count ?? 0) : 0;
  const unchangedCount = Math.max(0, captureCount - rowsWithCandidate);
  const model: ReviewModel = {
    run: {
      id: run.id,
      repository: context.configuration.github.repository,
      kind: run.kind,
      ...(pullRequestNumber
        ? {
            title: `#${pullRequestNumber} · ${batchRows<{ title: unknown }>(metadata[2])[0]?.title || "Pull request visual review"}`,
          }
        : {}),
      testedSha: run.tested_sha,
      attempt: run.attempt,
      status: historical
        ? comparison?.state === "ready"
          ? "compared"
          : comparison?.state === "invalidated"
            ? "failed"
            : "comparing"
        : status.status,
      ...(historical && comparison?.state === "invalidated"
        ? { error: historicalComparisonError }
        : {}),
      ...(run.settings_changed_count != null && run.settings_loose_count != null
        ? {
            comparisonSettings: {
              changed: run.settings_changed_count,
              loose: run.settings_loose_count,
            },
          }
        : {}),
    },
    ...(!run.active || run.state === "accepted" || historical || archive
      ? {
          archived: true,
          readOnlyReason: historical
            ? "This historical comparison is read-only. It does not affect the live review or required check."
            : importedBaseline
              ? "This baseline was imported. Previous comparison details were discarded during the database cutover. Capture a new complete run for review."
              : run.state === "accepted"
                ? "This run is already in the baseline. Capture a correction in a new complete main run."
                : readOnlyReason,
        }
      : {}),
    ...(archive
      ? { evidenceState: "summary" as const, imagesExpired: retained?.byte_state !== "live" }
      : {}),
    recompareAllowed: false,
    recompareDisabledReason:
      !run.active || run.detail_archived || run.state === "accepted"
        ? "This closed review is read-only. Capture a new complete run."
        : localRun
          ? "Run trusted Submit again from the complete CI bundle, or capture a new run. Unchanged candidate images were not uploaded."
          : serverRecompareDisabledReason,
    historicalComparisons,
    comparisonId: comparison?.id ?? "",
    comparisonState: (comparison?.state as ComparisonState) ?? "comparing",
    comparisonRevision: selectedComparison?.ordinal ?? run.revision,
    reviewReady: Boolean(
      !historical &&
      !archive &&
      run.active &&
      run.state !== "accepted" &&
      run.sealed_at &&
      comparison?.state === "ready" &&
      !["needs-recompare", "failed", "superseded"].includes(status.status),
    ),
    baselineRevision: project.baseline_revision,
    promotionId: project.promotion_id,
    counts: { pending: status.pending, rejected: status.rejected, approved: status.approved },
    unchanged: {
      count: unchangedCount,
      pages: unchangedCount ? Math.ceil(captureCount / CAPTURE_PAGE_ROWS) : 0,
    },
    items,
  };
  return compactReviewModel(model);
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

/** The answer of an Undo: it keeps the model. */
async function commandResult(context: PrivateContext, result: CommandResult, runId: string) {
  return Response.json({ ...result, model: await reviewModel(context, runId) });
}

async function wakeReviewStatus(context: PrivateContext, commandId?: string) {
  // Start the saved command while the shared consumer may be occupied with ingest.
  context.lifetime.waitUntil(
    (async () => {
      if (commandId) {
        try {
          await processReviewQueue(
            {
              database: context.database,
              budget: { tasksPerStep: 1 },
              now: Date.now,
            },
            commandId,
          );
        } catch {
          // The durable task remains available to the operations consumer.
          console.error(JSON.stringify({ event: "review-command-wakeup-failed" }));
        }
      }
      try {
        await context.operations.send({ kind: "status" });
      } catch {
        console.error(JSON.stringify({ event: "review-status-wakeup-failed" }));
      }
    })(),
  );
}

async function archivedCommandResult(
  context: PrivateContext,
  error: ArchivedCommandResultError,
  runId: string,
): Promise<Response> {
  if (error.runId !== runId) throw error;
  throw new SecurityError(
    "history_closed",
    409,
    "Command replay has ended. The permanent decision summary remains available.",
  );
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

/** The route of a review command. The access check and the handler share it. */
export const reviewCommandRoute = /^\/api\/comparisons\/([a-f0-9-]+)\/commands$/;

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
        captureLimit: context.configuration.limits.maximumCaptures,
      }),
    );
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
    const answer: RunsAnswer = {
      ...(await dashboard(context)),
      user: {
        id: context.identity.userId,
        githubUserId: context.identity.githubUserId,
        login: context.identity.login,
      },
    };
    return Response.json(answer);
  }
  const pullMatch = /^\/api\/pulls\/([1-9][0-9]{0,9})$/.exec(path);
  if (pullMatch?.[1] && request.method === "GET") {
    const check = new URL(request.url).searchParams.get("check");
    if (check !== null && !/^visonaut:pre:[a-f0-9]{40}(?::[1-9][0-9]*)?$/.test(check)) {
      throw new SecurityError("not_found", 404, "The pull-request check was not found.");
    }
    return Response.json(await pullAnswer({ context, pullNumber: Number(pullMatch[1]), check }));
  }
  const runMatch = /^\/api\/runs\/([a-f0-9-]+)$/.exec(path);
  if (runMatch?.[1] && request.method === "GET") {
    const selected = new URL(request.url).searchParams.get("comparison");
    return Response.json(
      await reviewModel(context, uuid(runMatch[1]), selected ? uuid(selected) : undefined),
    );
  }
  const capturesMatch = /^\/api\/runs\/([a-f0-9-]+)\/captures$/.exec(path);
  if (capturesMatch?.[1] && request.method === "GET") {
    const query = new URL(request.url).searchParams;
    const page = query.get("page");
    if (page !== null && !/^(0|[1-9][0-9]{0,5})$/.test(page)) {
      throw new SecurityError("not_found", 404, capturePageNotFound);
    }
    return Response.json(
      await reviewCapturePage(
        context,
        uuid(capturesMatch[1]),
        page === null
          ? { itemKey: string(query.get("item")), variantKey: string(query.get("variant")) }
          : { page: Number(page) },
      ),
    );
  }
  const runStateMatch = /^\/api\/runs\/([a-f0-9-]+)\/state$/.exec(path);
  if (runStateMatch?.[1] && request.method === "GET") {
    const selected = new URL(request.url).searchParams.get("comparison");
    return Response.json(
      await reviewPollState(context, uuid(runStateMatch[1]), selected ? uuid(selected) : undefined),
    );
  }
  const queuedCommandMatch = /^\/api\/commands\/([a-f0-9-]+)\/queued$/.exec(path);
  if (queuedCommandMatch?.[1] && request.method === "GET") {
    const task = await getWork(context.database, reviewTaskId(uuid(queuedCommandMatch[1])));
    if (!task || task.kind !== "review") {
      throw new SecurityError("not_found", 404, "The queued decision was not found.");
    }
    const input: QueuedReviewInput = JSON.parse(task.payload);
    if (input.actorId !== context.identity.githubUserId) {
      throw new SecurityError("not_found", 404, "The queued decision was not found.");
    }
    const comparison = await context.service.comparison(input.comparisonId);
    const run = await projectRun(context, comparison.run_id);
    const result = task.result ? object(JSON.parse(task.result)) : null;
    if (task.state === "complete" && !result?.error) {
      // The stored receipt, with no model. This request read the run after the
      // task, so the revision is not older than the receipt. The page reads
      // the model only when the two do not agree.
      return Response.json({ ...result, currentRunRevision: run.revision });
    }
    if (task.state === "complete" || task.state === "dead") {
      // Other decisions can finish before the browser reads this receipt.
      const model = await reviewModel(context, run.id);
      // A review committed during model construction requires another poll.
      if ((await context.service.run(run.id)).revision === model.comparisonRevision) {
        if (task.state === "dead") {
          return Response.json({ error: failedDecision, model }, { status: 409 });
        }
        return Response.json(
          {
            error: {
              code: "conflict",
              message:
                typeof result?.error === "string"
                  ? result.error
                  : "The queued decision could not be processed. Review it again.",
            },
            model,
          },
          { status: 409 },
        );
      }
    }
    return Response.json({ queued: true, commandId: input.commandId }, { status: 202 });
  }
  const commandMatch = reviewCommandRoute.exec(path);
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
      const input: QueuedReviewInput = {
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
      };
      if (body.queued === true) {
        if (body.previousCommandId !== undefined)
          input.previousCommandId = uuid(body.previousCommandId);
        // A decision that failed each attempt gets no wake: no pass can run it.
        if ((await enqueueReview(context.database, input)) === "dead") {
          return Response.json(
            { error: failedDecision, model: await reviewModel(context, run.id) },
            { status: 409 },
          );
        }
        await wakeReviewStatus(context, input.commandId);
        return Response.json({ queued: true, commandId: input.commandId }, { status: 202 });
      }
      const result = await context.service.review({ ...input, now: Date.now() });
      if (!result.noop) await wakeReviewStatus(context);
      // The receipt, with no model. The run is read after the review state: a
      // write that the state already counts then shows in the run revision.
      const status = await context.service.status(run.id);
      return Response.json({
        ...decisionReceipt(result, context.identity.githubUserId, status),
        currentRunRevision: (await context.service.run(run.id)).revision,
      });
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
      await wakeReviewStatus(context);
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
    if (!run.active || run.detail_archived || run.state === "accepted") {
      throw new SecurityError(
        "history_closed",
        409,
        "Closed history is read-only. Capture a new complete run.",
      );
    }
    const local =
      run.inventory_key ||
      (await context.database
        .prepare(
          "SELECT 1 FROM visonaut_captures WHERE run_id=? AND json_extract(metadata_json,'$.localMode')='local-v1' LIMIT 1",
        )
        .bind(run.id)
        .first());
    if (local)
      throw new SecurityError(
        "local_resubmit_required",
        409,
        "Run trusted Submit again from the complete CI bundle, or capture a new run. Stored representatives cannot replace omitted candidate bytes.",
      );
    const promoted = await context.database
      .prepare(
        "SELECT 1 FROM visonaut_promotions promotion JOIN visonaut_comparisons comparison ON comparison.id=promotion.comparison_id WHERE comparison.run_id=? LIMIT 1",
      )
      .bind(run.id)
      .first();
    if (promoted)
      throw new SecurityError(
        "history_closed",
        409,
        "Closed history is read-only. Capture a new complete run.",
      );
    throw new SecurityError("local_comparison_required", 409, serverRecompareDisabledReason);
  }
  return null;
}
