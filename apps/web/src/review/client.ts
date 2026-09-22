import { ReviewCommandError } from "./model.ts";
import type {
  ReviewCommandResult,
  ReviewCommands,
  ReviewImage,
  ReviewItem,
  ReviewModel,
  ReviewSelection,
  ReviewVariant,
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

function variant(value: unknown): ReviewVariant {
  const data = record(value);
  return {
    id: string(data.id),
    key: string(data.key),
    label: string(data.label),
    kind: oneOf(data.kind, ["added", "changed", "removed", "unchanged", "error"]),
    revision: number(data.revision),
    verdict: data.verdict === null ? null : oneOf(data.verdict, ["approved", "rejected"]),
    source: data.source === null ? null : oneOf(data.source, ["human", "automatic"]),
    reviewer: optionalString(data.reviewer),
    reference: image(data.reference),
    candidate: image(data.candidate),
    diff: image(data.diff),
    thumbnail: optionalString(data.thumbnail),
    changedPixels: optionalNumber(data.changedPixels),
    maskExpected: data.maskExpected == null ? undefined : boolean(data.maskExpected),
    ratio: optionalNumber(data.ratio),
    engine: optionalString(data.engine),
    codec: optionalString(data.codec),
    policy: optionalString(data.policy),
    threshold: optionalString(data.threshold),
    referenceProfile: optionalString(data.referenceProfile),
    candidateProfile: optionalString(data.candidateProfile),
    error: optionalString(data.error),
    rejectDisabledReason: optionalString(data.rejectDisabledReason),
    approveDisabledReason: optionalString(data.approveDisabledReason),
  };
}

function item(value: unknown): ReviewItem {
  const data = record(value);
  return {
    key: string(data.key),
    name: string(data.name),
    variants: values(data.variants).map(variant),
  };
}

export function parseReviewModel(value: unknown): ReviewModel {
  const data = record(value);
  const run = record(data.run);
  return {
    run: {
      id: string(run.id),
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
    items: values(data.items).map(item),
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

async function request(path: string, body?: object): Promise<unknown> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
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
      model: data.model ? parseReviewModel(data.model) : undefined,
      reviewer: optionalString(data.reviewer),
    });
  }
  return result;
}

/** Creates a new, server-bound Undo session for this page load. */
export async function loadReview(
  runId: string,
  comparisonId?: string,
): Promise<{ model: ReviewModel; commands: ReviewCommands }> {
  const runPath = `/api/runs/${encodeURIComponent(runId)}`;
  let selectedComparisonId = comparisonId;
  const selectedPath = () =>
    selectedComparisonId
      ? `${runPath}?comparison=${encodeURIComponent(selectedComparisonId)}`
      : runPath;
  const [session, run] = await Promise.all([
    request("/api/review-sessions", {}),
    request(selectedPath()),
  ]);
  const reviewSessionId = string(record(session).reviewSessionId);
  return {
    model: parseReviewModel(run),
    commands: {
      async save(command) {
        return commandResult(
          await request(`/api/comparisons/${encodeURIComponent(command.comparisonId)}/commands`, {
            ...command,
            reviewSessionId,
          }),
        );
      },
      async undo(command) {
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
        link.download = `ariviso-${runId}.tar`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      },
    },
  };
}
