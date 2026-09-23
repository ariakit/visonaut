import type { ReviewCommand, ReviewModel, UndoCommand } from "../model.ts";

export interface FixtureApi {
  calls: Array<ReviewCommand | UndoCommand>;
  setBehavior(value: string): void;
  resolve(): void;
  update(model: ReviewModel): void;
  model(): ReviewModel;
  completeComparison(): void;
}

declare global {
  interface Window {
    reviewFixture: FixtureApi;
  }
}
