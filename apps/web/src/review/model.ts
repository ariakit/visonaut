export type ReviewVerdict = "approved" | "rejected";
export type ReviewMode = "side" | "diff" | "new";
export type ReviewZoom = "fit" | 1 | 2;

export interface ReviewSelection {
  itemKey: string;
  variantKey: string;
}

export interface ReviewImage {
  id: string;
  url: string;
  digest: string;
  width: number;
  height: number;
}

export interface ReviewVariant {
  id: string;
  key: string;
  label: string;
  kind: "added" | "changed" | "removed" | "unchanged" | "error";
  revision: number;
  verdict: ReviewVerdict | null;
  source: "human" | "automatic" | null;
  reviewer?: string;
  reference: ReviewImage | null;
  candidate: ReviewImage | null;
  diff: ReviewImage | null;
  thumbnail?: string;
  changedPixels?: number;
  maskExpected?: boolean;
  ratio?: number;
  engine?: string;
  codec?: string;
  policy?: string;
  threshold?: string;
  referenceProfile?: string;
  candidateProfile?: string;
  error?: string;
  /** The server computes history protection from the current promotion. */
  rejectDisabledReason?: string;
  approveDisabledReason?: string;
}

export interface ReviewItem {
  key: string;
  name: string;
  variants: ReviewVariant[];
}

export type ComparisonState = "comparing" | "ready" | "invalidated";

export interface HistoricalComparison {
  id: string;
  ordinal: number;
  state: ComparisonState;
  createdAt: number;
}

export interface ReviewModel {
  run: {
    id: string;
    kind: "main" | "pull_request" | "merge_group";
    testedSha: string;
    attempt: number;
    title?: string;
    createdAt?: string;
    status: string;
    error?: string;
  };
  comparisonId: string;
  comparisonRevision: number;
  reviewReady: boolean;
  comparisonState?: ComparisonState;
  recompareAllowed?: boolean;
  recompareDisabledReason?: string;
  historicalComparisons?: HistoricalComparison[];
  archived?: boolean;
  readOnlyReason?: string;
  baselineRevision: number;
  promotionId: string | null;
  items: ReviewItem[];
}

export interface ReviewTarget {
  id: string;
  expectedRevision: number;
}

export interface ReviewCommand {
  commandId: string;
  comparisonId: string;
  verdict: ReviewVerdict;
  targets: ReviewTarget[];
  wholeItemKey?: string;
  expectedPromotionId?: string;
  expectedBaselineRevision: number;
  selection: ReviewSelection;
}

export interface UndoCommand {
  commandId: string;
  undoCommandId: string;
  expectedBaselineRevision: number;
}

export interface ReviewCommandResult {
  model: ReviewModel;
  commandId: string;
  selection: ReviewSelection;
  noop?: boolean;
}

export interface ReviewCommands {
  save(command: ReviewCommand): Promise<ReviewCommandResult>;
  undo(command: UndoCommand): Promise<ReviewCommandResult>;
  refresh(): Promise<ReviewModel>;
  recompare?(): Promise<ReviewModel>;
  export?(): Promise<void>;
}

export class ReviewCommandError extends Error {
  readonly model?: ReviewModel;
  readonly reviewer?: string;
  readonly conflict: boolean;

  constructor(
    message: string,
    options: {
      model?: ReviewModel;
      reviewer?: string;
      conflict?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "ReviewCommandError";
    this.model = options.model;
    this.reviewer = options.reviewer;
    this.conflict = options.conflict ?? false;
  }
}
