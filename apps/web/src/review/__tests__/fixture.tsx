import { createRoot } from "react-dom/client";
import { ReviewWorkspace } from "../review-workspace.tsx";
import { ReviewCommandError } from "../model.ts";
import type { ReviewCommand, ReviewCommandResult, ReviewModel, UndoCommand } from "../model.ts";

import { fixtureModel } from "./fixture-model.ts";

let model = fixtureModel();
const saved = new Map<string, { model: ReviewModel; result: ReviewCommandResult }>();
const undone = new Map<string, ReviewCommandResult>();
const calls: Array<ReviewCommand | UndoCommand> = [];
let behavior = "normal";
let pending: (() => void) | undefined;

async function save(command: ReviewCommand): Promise<ReviewCommandResult> {
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
    return { model, commandId: command.commandId, selection: command.selection, noop: true };
  const previous = structuredClone(model);
  model = structuredClone(model);
  for (const item of model.items) {
    for (const entry of item.variants) {
      const target = command.targets.find((target) => target.id === entry.id);
      if (!target) continue;
      if (target.expectedRevision !== entry.revision) {
        throw new ReviewCommandError("Stale revision.", { conflict: true, model });
      }
      entry.verdict = command.verdict;
      entry.source = "human";
      entry.revision++;
    }
  }
  const result = { model, commandId: command.commandId, selection: command.selection };
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
          refresh: async () => {
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
          export: async () => {
            if (behavior === "offline") throw new Error("The export service is unavailable.");
            if (behavior === "delay")
              await new Promise<void>((resolve) => {
                pending = resolve;
              });
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
