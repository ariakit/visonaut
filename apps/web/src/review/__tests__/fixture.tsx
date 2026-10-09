import { createRoot } from "react-dom/client";
import "../../styles.css";
import { ReviewWorkspace } from "../review-workspace.tsx";
import { ReviewCommandError } from "../model.ts";
import type {
  ReviewCommand,
  ReviewCommands,
  ReviewCommandResult,
  ReviewModel,
  ReviewSaveResult,
  UndoCommand,
} from "../model.ts";

import { fixtureModel } from "./fixture-model.ts";

let model = fixtureModel();
if (new URLSearchParams(window.location.search).has("localComparison")) {
  const variant = model.items[0]?.variants[0];
  if (!variant) throw new Error("Local comparison fixture is missing.");
  Object.assign(variant, {
    kind: "unchanged",
    verdict: null,
    source: null,
    candidate: null,
    candidateOmitted: true,
    diff: null,
    maskExpected: false,
    changedPixels: 1,
    ratio: 1 / 240000,
    engine: "playwright-pixelmatch-1.63.0",
    codec: "pngjs-7.0.0",
    threshold: "Color threshold 0.2; maximum 5 pixels",
  });
  model.recompareAllowed = false;
  model.recompareDisabledReason = "Rerun trusted Submit to compare locally again.";
}
if (new URLSearchParams(window.location.search).has("fifthVariantChanged")) {
  const item = model.items[0];
  if (!item) throw new Error("Variant strip fixture is missing.");
  item.variants = item.variants.slice(0, 6);
  for (const [index, entry] of item.variants.entries()) {
    if (index === 4) continue;
    Object.assign(entry, { kind: "unchanged", verdict: null, source: null, diff: null });
  }
}
const saved = new Map<string, { model: ReviewModel; result: ReviewSaveResult }>();
const undone = new Map<string, ReviewCommandResult>();
const calls: Array<ReviewCommand | UndoCommand> = [];
let behavior = "normal";
let pending: (() => void) | undefined;
let statusReads = 0;
let modelReads = 0;

let processing: Promise<unknown> = Promise.resolve();
const save: ReviewCommands["save"] = (command, options) => {
  if (behavior !== "offline") options?.onQueued?.();
  const result = processing.catch(() => {}).then(() => processSave(command));
  processing = result;
  return result;
};

async function processSave(command: ReviewCommand): Promise<ReviewSaveResult> {
  calls.push(command);
  if (behavior === "delay") {
    await new Promise<void>((resolve) => {
      pending = resolve;
    });
  }
  const existing = saved.get(command.commandId);
  if (existing) return existing.result;
  if (behavior === "offline") throw new Error("Connection lost.");
  if (behavior === "conflict") {
    throw new ReviewCommandError("The decision changed. Refresh and review the current evidence.", {
      conflict: true,
      reviewer: "octocat",
      model,
    });
  }
  if (behavior === "noop")
    return {
      model,
      commandId: command.commandId,
      selection: command.selection,
      revisions: command.targets,
      baselineRevision: model.baselineRevision,
      promotionId: model.promotionId,
      noop: true,
    };
  const previous = structuredClone(model);
  model = structuredClone(model);
  model.comparisonRevision += 2;
  for (const item of model.items) {
    for (const entry of item.variants) {
      const target = command.targets.find((target) => target.id === entry.id);
      if (!target) continue;
      if (target.expectedRevision !== entry.revision) {
        throw new ReviewCommandError("Stale revision.", { conflict: true, model });
      }
      entry.verdict = command.verdict;
      entry.source = "human";
      entry.reviewer = "maintainer-1";
      entry.revision++;
    }
  }
  const variants = model.items.flatMap((item) => item.variants);
  const incomplete = variants.some(
    (entry) =>
      entry.kind === "error" ||
      entry.kind === "pending" ||
      (entry.kind !== "unchanged" && entry.verdict !== "approved"),
  );
  model.run.status = !incomplete
    ? "passed"
    : variants.some((entry) => entry.verdict === "rejected")
      ? "rejected"
      : "needs-review";
  const result = {
    commandId: command.commandId,
    selection: command.selection,
    revisions: command.targets.map((target) => ({
      id: target.id,
      expectedRevision: target.expectedRevision + 1,
    })),
    baselineRevision: model.baselineRevision,
    promotionId: model.promotionId,
    runRevision: model.comparisonRevision,
    reviewer: "maintainer-1",
    runStatus: model.run.status,
  };
  saved.set(command.commandId, { model: previous, result });
  return result;
}

async function undo(command: UndoCommand): Promise<ReviewCommandResult> {
  calls.push(command);
  const existing = undone.get(command.undoCommandId);
  if (existing) return existing;
  if (behavior === "offline") throw new Error("Connection lost.");
  if (behavior === "conflict") {
    throw new ReviewCommandError("A later promotion is current. Refresh to recover explicitly.", {
      conflict: true,
      reviewer: "octocat",
      model,
    });
  }
  const original = saved.get(command.commandId);
  if (!original) throw new Error("Unknown command.");
  model = original.model;
  const result = { model, commandId: command.undoCommandId, selection: original.result.selection };
  undone.set(command.undoCommandId, result);
  return result;
}

const element = document.getElementById("root");
if (!element) throw new Error("Fixture root is missing.");
const root = createRoot(element);
function render() {
  root.render(
    <>
      <label>
        Outside search
        <input aria-label="Outside search" />
      </label>
      <ReviewWorkspace
        model={model}
        commands={{
          save,
          undo,
          pollStatus: async () => {
            statusReads++;
            if (behavior === "offline") throw new Error("Connection lost.");
            return {
              run: { status: model.run.status, error: model.run.error },
              comparisonState: model.comparisonState ?? "comparing",
              reviewReady: model.reviewReady,
              archived: Boolean(model.archived),
            };
          },
          capturePage: async () => ({ page: 0, pages: 0, items: [] }),
          refresh: async () => {
            modelReads++;
            if (behavior === "offline") throw new Error("Connection lost.");
            return model;
          },
          recompare: async () => {
            if (behavior === "closed-before-recompare") model = { ...model, archived: true };
            model = {
              ...model,
              comparisonId: "comparison-3",
              comparisonRevision: 3,
              reviewReady: false,
              comparisonState: "comparing",
              historicalComparisons: model.archived
                ? [
                    {
                      id: "comparison-3",
                      ordinal: 3,
                      state: "comparing",
                      createdAt: 1_790_055_000_000,
                    },
                  ]
                : undefined,
              run: { ...model.run, status: "comparing" },
            };
            return model;
          },
        }}
      />
    </>,
  );
}
render();

Object.assign(window, {
  reviewFixture: {
    calls,
    setBehavior(value: string) {
      behavior = value;
    },
    resolve() {
      pending?.();
      pending = undefined;
    },
    update(value: ReviewModel) {
      model = value;
      render();
    },
    model() {
      return structuredClone(model);
    },
    pollReads() {
      return { status: statusReads, model: modelReads };
    },
    setVisibility(value: "visible" | "hidden") {
      Object.defineProperty(document, "visibilityState", { configurable: true, value });
      document.dispatchEvent(new Event("visibilitychange"));
    },
    completeComparison() {
      if (behavior === "comparison-failed") {
        model = {
          ...model,
          comparisonState: "invalidated",
          reviewReady: false,
          run: { ...model.run, status: "failed", error: "A stored image could not be read." },
        };
        return;
      }
      model = {
        ...model,
        reviewReady: !model.archived,
        comparisonState: "ready",
        historicalComparisons: model.historicalComparisons?.map((comparison) => ({
          ...comparison,
          state: "ready",
        })),
        run: { ...model.run, status: model.archived ? "compared" : "needs-review" },
      };
    },
  },
});
