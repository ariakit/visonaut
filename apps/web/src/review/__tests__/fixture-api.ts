import type { ReviewCommand, ReviewModel, UndoCommand } from "../model.ts";

export interface FixtureApi {
  calls: Array<ReviewCommand | UndoCommand>;
  setBehavior(value: string): void;
  resolve(): void;
  resolveState(): void;
  update(model: ReviewModel): void;
  model(): ReviewModel;
  replaceServerModel(model: ReviewModel): void;
  pollReads(): { status: number; model: number };
  setVisibility(value: "visible" | "hidden"): void;
  completeComparison(): void;
}

declare global {
  interface Window {
    reviewFixture: FixtureApi;
  }
}
