import { ReviewCommandError } from "./model.ts";
import type {
  ReviewCommandResult,
  ReviewCommands,
  ReviewImage,
  ReviewItem,
  ReviewModel,
  ReviewPollState,
  ReviewSaveResult,
  ReviewSelection,
  ReviewVariant,
  ReviewVariantPart,
} from "./model.ts";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The service returned an invalid response. Refresh before reviewing.");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("The service returned an invalid text field.");
  }
  return value;
}

function optionalString(value: unknown) {
  return value == null ? undefined : string(value);
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("The service returned an invalid numeric field.");
  }
  return value;
}

function optionalNumber(value: unknown) {
  return value == null ? undefined : number(value);
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("The service returned an invalid state field.");
  }
  return value;
}

function values(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("The service returned an invalid list.");
  }
  return value;
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  choices: Values,
): Values[number] {
  for (const choice of choices) {
    if (value === choice) return choice;
  }
  throw new Error("The service returned an unsupported review state.");
}

function image(value: unknown): ReviewImage | null {
  if (value === null) return null;
  const data = record(value);
  return {
    id: string(data.id),
    url: string(data.url),
    digest: string(data.digest),
    width: number(data.width),
    height: number(data.height),
  };
}

function variantPart(value: unknown): ReviewVariantPart {
  const data = record(value);
  return {
    value: string(data.value),
    kind: oneOf(data.kind, [
      "framework",
      "browser",
      "colorScheme",
      "contrast",
      "forcedColors",
      "key",
    ]),
  };
}

interface SharedReviewEvidence {
  images: Array<ReviewImage | null>;
  metadata: Array<Record<string, unknown>>;
}

function variant(value: unknown, shared: SharedReviewEvidence): ReviewVariant {
  const data = record(value);
  const index = number(data.metadata);
  const metadata = Number.isInteger(index) && index >= 0 ? shared.metadata[index] : undefined;
  if (!metadata) {
    throw new Error("The service returned invalid review metadata. Refresh before reviewing.");
  }
  const evidence = (value: unknown) => {
    if (value === null) return null;
    const index = number(value);
    const result = Number.isInteger(index) && index >= 0 ? shared.images[index] : undefined;
    if (!result) {
      throw new Error("The service returned invalid image evidence. Refresh before reviewing.");
    }
    return result;
  };
  return {
    id: string(data.id),
    key: string(data.key),
    label: string(data.label),
    labelParts: data.labelParts == null ? undefined : values(data.labelParts).map(variantPart),
    kind: oneOf(data.kind, ["added", "changed", "removed", "unchanged", "pending", "error"]),
    revision: number(data.revision),
    verdict: data.verdict === null ? null : oneOf(data.verdict, ["approved", "rejected"]),
    source: data.source === null ? null : oneOf(data.source, ["human", "automatic"]),
    reviewer: optionalString(data.reviewer),
    reference: evidence(data.reference),
    candidate: evidence(data.candidate),
    diff: evidence(data.diff),
    thumbnail: optionalString(data.thumbnail),
    changedPixels: optionalNumber(data.changedPixels),
    maskExpected: data.maskExpected == null ? undefined : boolean(data.maskExpected),
    ratio: optionalNumber(data.ratio),
    engine: optionalString(metadata.engine),
    codec: optionalString(metadata.codec),
    policy: optionalString(metadata.policy),
    threshold: optionalString(metadata.threshold),
    referenceProfile: optionalString(metadata.referenceProfile),
    candidateProfile: optionalString(metadata.candidateProfile),
    error: optionalString(data.error),
    rejectDisabledReason: optionalString(data.rejectDisabledReason),
    approveDisabledReason: optionalString(data.approveDisabledReason),
  };
}

function item(value: unknown, shared: SharedReviewEvidence): ReviewItem {
  const data = record(value);
  return {
    key: string(data.key),
    name: string(data.name),
    variants: values(data.variants).map((value) => variant(value, shared)),
  };
}

export function parseReviewModel(value: unknown): ReviewModel {
  const data = record(value);
  if (data.format !== "compact-review-1") {
    throw new Error("This review format has changed. Refresh before reviewing.");
  }
  const shared: SharedReviewEvidence = {
    images: values(data.images).map(image),
    metadata: values(data.metadata).map(record),
  };
  const run = record(data.run);
  return {
    preview: data.preview == null ? undefined : boolean(data.preview),
    evidenceState: data.evidenceState == null ? undefined : oneOf(data.evidenceState, ["summary"]),
    imagesExpired: data.imagesExpired == null ? undefined : boolean(data.imagesExpired),
    run: {
      id: string(run.id),
      ...(run.repository == null ? {} : { repository: string(run.repository) }),
      kind: oneOf(run.kind, ["main", "pull_request", "merge_group"]),
      testedSha: string(run.testedSha),
      attempt: number(run.attempt),
      title: optionalString(run.title),
      createdAt: optionalString(run.createdAt),
      status: string(run.status),
      error: optionalString(run.error),
    },
    comparisonId: string(data.comparisonId),
    comparisonRevision: number(data.comparisonRevision),
    reviewReady: boolean(data.reviewReady),
    comparisonState:
      data.comparisonState == null
        ? undefined
        : oneOf(data.comparisonState, ["comparing", "ready", "invalidated"]),
    recompareAllowed: data.recompareAllowed == null ? undefined : boolean(data.recompareAllowed),
    recompareDisabledReason: optionalString(data.recompareDisabledReason),
    historicalComparisons:
      data.historicalComparisons == null
        ? undefined
        : values(data.historicalComparisons).map((value) => {
            const comparison = record(value);
            return {
              id: string(comparison.id),
              ordinal: number(comparison.ordinal),
              state: oneOf(comparison.state, ["comparing", "ready", "invalidated"]),
              createdAt: number(comparison.createdAt),
            };
          }),
    archived: data.archived == null ? undefined : boolean(data.archived),
    readOnlyReason: optionalString(data.readOnlyReason),
    baselineRevision: number(data.baselineRevision),
    promotionId: data.promotionId === null ? null : string(data.promotionId),
    items: values(data.items).map((value) => item(value, shared)),
  };
}

export function parseReviewPollState(value: unknown): ReviewPollState {
  const data = record(value);
  const run = record(data.run);
  return {
    run: { status: string(run.status), error: optionalString(run.error) },
    comparisonState: oneOf(data.comparisonState, ["comparing", "ready", "invalidated"]),
    reviewReady: boolean(data.reviewReady),
    archived: boolean(data.archived),
  };
}

function selection(value: unknown): ReviewSelection {
  const data = record(value);
  return { itemKey: string(data.itemKey), variantKey: string(data.variantKey) };
}

function commandResult(value: unknown): ReviewCommandResult {
  const data = record(value);
  return {
    model: parseReviewModel(data.model),
    commandId: string(data.commandId),
    selection: selection(data.selection),
    noop: data.noop == null ? undefined : boolean(data.noop),
  };
}

function saveResult(value: unknown): ReviewSaveResult {
  const data = record(value);
  return {
    commandId: string(data.commandId),
    selection: selection(data.selection),
    revisions: values(data.revisions).map((value) => {
      const target = record(value);
      return { id: string(target.id), expectedRevision: number(target.expectedRevision) };
    }),
    baselineRevision: number(data.baselineRevision),
    promotionId: data.promotionId === null ? null : string(data.promotionId),
    runRevision: data.runRevision == null ? undefined : number(data.runRevision),
    reviewer: optionalString(data.reviewer),
    runStatus: optionalString(data.runStatus),
    noop: data.noop == null ? undefined : boolean(data.noop),
    model: data.model == null ? undefined : parseReviewModel(data.model),
  };
}

async function request(path: string, body?: object, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new ReviewCommandError(
      "The service did not return review data. Check your connection and refresh.",
    );
  }
  const result: unknown = await response.json();
  if (!response.ok) {
    const data = record(result);
    const error = record(data.error);
    throw new ReviewCommandError(string(error.message), {
      conflict: response.status === 409,
      status: response.status,
      model: data.model ? parseReviewModel(data.model) : undefined,
      reviewer: optionalString(data.reviewer),
    });
  }
  return result;
}

/** Loads review evidence before creating a session for a review command. */
export function createReviewCommands(runId: string, comparisonId?: string): ReviewCommands {
  const runPath = `/api/runs/${encodeURIComponent(runId)}`;
  let selectedComparisonId = comparisonId;
  const selectedPath = (suffix = "") =>
    selectedComparisonId
      ? `${runPath}${suffix}?comparison=${encodeURIComponent(selectedComparisonId)}`
      : `${runPath}${suffix}`;
  let sessionPromise: Promise<string> | undefined;
  const reviewSession = () => {
    sessionPromise ??= request("/api/review-sessions", {})
      .then((session) => string(record(session).reviewSessionId))
      .catch((error: unknown) => {
        sessionPromise = undefined;
        throw error;
      });
    return sessionPromise;
  };
  return {
    async save(command) {
      const reviewSessionId = await reviewSession();
      return saveResult(
        await request(`/api/comparisons/${encodeURIComponent(command.comparisonId)}/commands`, {
          ...command,
          reviewSessionId,
        }),
      );
    },
    async undo(command) {
      const reviewSessionId = await reviewSession();
      return commandResult(
        await request(`/api/commands/${encodeURIComponent(command.commandId)}/undo`, {
          undoCommandId: command.undoCommandId,
          expectedBaselineRevision: command.expectedBaselineRevision,
          reviewSessionId,
        }),
      );
    },
    async refresh() {
      return parseReviewModel(await request(selectedPath()));
    },
    async pollStatus() {
      return parseReviewPollState(await request(selectedPath("/state")));
    },
    async recompare() {
      const model = parseReviewModel(await request(`${runPath}/recompare`, {}));
      // Historical results have no active run pointer for subsequent refreshes.
      selectedComparisonId = model.archived ? model.comparisonId : undefined;
      return model;
    },
    async export() {
      const data = record(await request(`${runPath}/export`, {}));
      const downloadPath = string(data.downloadPath);
      const url = new URL(downloadPath, window.location.origin);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/exports/")) {
        throw new Error("The service returned an invalid export location.");
      }
      const link = document.createElement("a");
      link.href = url.href;
      link.download = `visonaut-${runId}.tar`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
  };
}

/** Router loaders own reads; command sessions remain local to the review page. */
export async function loadReviewModel(
  runId: string,
  comparisonId?: string,
  signal?: AbortSignal,
): Promise<ReviewModel> {
  const path = `/api/runs/${encodeURIComponent(runId)}`;
  const query = comparisonId ? `?comparison=${encodeURIComponent(comparisonId)}` : "";
  return parseReviewModel(await request(`${path}${query}`, undefined, signal));
}

export async function loadReview(
  runId: string,
  comparisonId?: string,
  signal?: AbortSignal,
): Promise<{ model: ReviewModel; commands: ReviewCommands }> {
  const model = await loadReviewModel(runId, comparisonId, signal);
  return { model, commands: createReviewCommands(runId, comparisonId) };
}
