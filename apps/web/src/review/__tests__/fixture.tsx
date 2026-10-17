import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../../styles.css";
import { ClientError } from "../../client-error.ts";
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
import { runApprovalTargets } from "../navigation.ts";

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
    cli: "0.7.0",
    threshold: "Color threshold 0.2; maximum 5 pixels",
  });
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
// A run with nothing to review: each screenshot matches the baseline.
if (new URLSearchParams(window.location.search).has("noChanges")) {
  model.run.status = "passed";
  for (const item of model.items) {
    for (const entry of item.variants) {
      Object.assign(entry, { kind: "unchanged", verdict: null, source: null, diff: null });
    }
  }
}
const saved = new Map<string, { model: ReviewModel; result: ReviewSaveResult }>();
const undone = new Map<string, ReviewCommandResult>();
const calls: Array<ReviewCommand | UndoCommand> = [];
let behavior = "normal";
let pending: (() => void) | undefined;
let pendingState: (() => void) | undefined;
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
      model,
    });
  }
  if (behavior === "other-conflict" || behavior === "own-conflict") {
    // A person decided for the first target before this decision: another
    // reviewer, or the same person in another tab.
    model = structuredClone(model);
    model.comparisonRevision += 1;
    const decided = model.items
      .flatMap((item) => item.variants)
      .find((entry) => entry.id === command.targets[0]?.id);
    if (!decided) throw new Error("The fixture has no variant for the other decision.");
    Object.assign(
      decided,
      { source: "human", revision: decided.revision + 1 },
      behavior === "other-conflict"
        ? { verdict: "rejected", reviewer: "Kenji Mori" }
        : { verdict: "approved", reviewer: "maintainer-1", ownDecision: true },
    );
    throw new ReviewCommandError("A target changed or belongs to another comparison.", {
      status: 409,
      code: "conflict",
      conflict: true,
      model,
    });
  }
  if (behavior === "noop")
    return {
      commandId: command.commandId,
      selection: command.selection,
      revisions: command.targets,
      baselineRevision: model.baselineRevision,
      promotionId: model.promotionId,
      noop: true,
    };
  if (behavior === "other-review") {
    // Another reviewer rejects the last variant of the item before this
    // decision. The page learns of it only from the run revision.
    behavior = "normal";
    model = structuredClone(model);
    model.comparisonRevision += 1;
    const other = model.items
      .find((item) => item.key === command.selection.itemKey)
      ?.variants.at(-1);
    if (!other) throw new Error("The fixture has no variant for the other reviewer.");
    Object.assign(other, {
      verdict: "rejected",
      source: "human",
      reviewer: "Kenji Mori",
      revision: other.revision + 1,
    });
  }
  // A run approval names no target: the service approves each change with no
  // decision, in one transaction that saves nothing when the count differs.
  const targets = command.run
    ? runApprovalTargets(model.items).map((entry) => ({
        id: entry.id,
        expectedRevision: entry.revision,
      }))
    : command.targets;
  if (command.run && behavior === "run-failed") {
    throw new ReviewCommandError("Server text.", {
      status: 409,
      code: "decision_failed",
      conflict: true,
      model,
    });
  }
  if (command.run && command.run.count !== targets.length) {
    throw new ReviewCommandError("Stale count.", { conflict: true, model });
  }
  const previous = structuredClone(model);
  model = structuredClone(model);
  model.comparisonRevision += 2;
  for (const item of model.items) {
    for (const entry of item.variants) {
      const target = targets.find((target) => target.id === entry.id);
      if (!target) continue;
      if (target.expectedRevision !== entry.revision) {
        throw new ReviewCommandError("Stale revision.", { conflict: true, model });
      }
      entry.verdict = command.verdict;
      entry.source = "human";
      entry.reviewer = "maintainer-1";
      entry.ownDecision = true;
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
    previousRunRevision: previous.comparisonRevision,
    runRevision: model.comparisonRevision,
    currentRunRevision: model.comparisonRevision,
    reviewer: "maintainer-1",
    runStatus: model.run.status,
    counts: model.counts,
  };
  if (behavior === "later-review") {
    // Another reviewer rejects the last variant of the item after this
    // decision and before the read of its receipt.
    behavior = "normal";
    model = structuredClone(model);
    model.comparisonRevision += 1;
    result.currentRunRevision = model.comparisonRevision;
    const other = model.items
      .find((item) => item.key === command.selection.itemKey)
      ?.variants.at(-1);
    if (!other) throw new Error("The fixture has no variant for the other reviewer.");
    Object.assign(other, {
      verdict: "rejected",
      source: "human",
      reviewer: "Kenji Mori",
      revision: other.revision + 1,
    });
  }
  saved.set(command.commandId, { model: previous, result });
  return result;
}

async function undo(command: UndoCommand): Promise<ReviewCommandResult> {
  calls.push(command);
  const existing = undone.get(command.undoCommandId);
  if (existing) return existing;
  // The client throws this error when a request has no answer.
  if (behavior === "offline") throw new ClientError("No connection.");
  // The service answered, so the Undo can be saved, but the client cannot read the answer.
  if (behavior === "undo-unreadable") {
    throw new Error("The service returned an invalid response. Refresh before reviewing.");
  }
  // D1 refused the transaction of the Undo: the service answers a 500.
  if (behavior === "undo-failed") {
    throw new ReviewCommandError("Server text.", { status: 500 });
  }
  if (behavior === "conflict") {
    throw new ReviewCommandError("A later promotion is current. Refresh to recover explicitly.", {
      conflict: true,
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

// The links of the kit parts need a router. The workspace of this fixture has
// no route, so it keeps its selection, and the memory history holds the URLs
// that the links write.
const FixtureContent = createContext<ReactNode>(null);
const router = createRouter({
  routeTree: createRootRoute({ component: () => useContext(FixtureContent) }),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

const element = document.getElementById("root");
if (!element) throw new Error("Fixture root is missing.");
const root = createRoot(element);
function render() {
  root.render(
    <FixtureContent.Provider value={content()}>
      <RouterProvider router={router} />
    </FixtureContent.Provider>,
  );
}

function content() {
  return (
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
            if (behavior === "delay-state") {
              await new Promise<void>((resolve) => {
                pendingState = resolve;
              });
            }
            return {
              run: { status: model.run.status, error: model.run.error },
              comparisonState: model.comparisonState ?? "comparing",
              comparisonRevision: model.comparisonRevision,
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
        }}
      />
    </>
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
    resolveState() {
      pendingState?.();
      pendingState = undefined;
    },
    update(value: ReviewModel) {
      model = value;
      render();
    },
    model() {
      return structuredClone(model);
    },
    // The state of the service changes, and the page gets no new model.
    replaceServerModel(value: ReviewModel) {
      model = value;
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
