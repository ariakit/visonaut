import { ClientError } from "../client-error.ts";
import type { ClientErrorFacts } from "../client-error.ts";

export type ReviewVerdict = "approved" | "rejected";
export type ReviewMode = "side" | "diff" | "new" | "original";
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

export interface ReviewVariantPart {
  value: string;
  kind: "framework" | "browser" | "colorScheme" | "contrast" | "forcedColors" | "key";
}

export interface ReviewVariant {
  id: string;
  key: string;
  label: string;
  labelParts?: ReviewVariantPart[];
  kind: "added" | "changed" | "removed" | "unchanged" | "pending" | "error";
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
  candidateOmitted?: boolean;
  ratio?: number;
  engine?: string;
  codec?: string;
  policy?: string;
  threshold?: string;
  referenceProfile?: string;
  candidateProfile?: string;
  error?: string;
  /** The read-only reason of a closed run, which the reader takes from the header of the answer. */
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

/** The three review counts of a run, with the definition of the run list. */
export interface ReviewCounts {
  pending: number;
  rejected: number;
  approved: number;
}

/**
 * The first response of a run page. Its items are the screenshots that the
 * service stores a review row for: changed, added, and removed.
 */
export interface ReviewModel {
  preview?: boolean;
  evidenceState?: "summary";
  imagesExpired?: boolean;
  run: {
    id: string;
    repository?: string;
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
  counts: ReviewCounts;
  /** The screenshots that `items` does not have, and the pages that hold them. */
  unchanged: { count: number; pages: number };
  items: ReviewItem[];
}

/** One page of the unchanged screenshots of a run. */
export interface ReviewCapturePage {
  page: number;
  pages: number;
  items: ReviewItem[];
}

/** A page by its number, or the page that holds one screenshot. */
export type ReviewCapturePlace = { page: number } | ReviewSelection;

export interface ReviewPollState {
  run: { status: string; error?: string };
  comparisonState: ComparisonState;
  reviewReady: boolean;
  archived: boolean;
}

export interface ReviewTarget {
  id: string;
  expectedRevision: number;
}

export interface ReviewCommand {
  commandId: string;
  previousCommandId?: string;
  comparisonId: string;
  verdict: ReviewVerdict;
  targets: ReviewTarget[];
  wholeItemKey?: string;
  expectedPromotionId?: string;
  expectedBaselineRevision: number;
  expectedRunRevision: number;
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

/**
 * The receipt of a saved decision. It has no model: the page applies it to the
 * model that it holds.
 */
export interface ReviewSaveResult {
  commandId: string;
  selection: ReviewSelection;
  revisions: ReviewTarget[];
  baselineRevision: number;
  promotionId: string | null;
  /** The run revision that the decision started from. */
  previousRunRevision?: number;
  /** The run revision that the decision made. */
  runRevision?: number;
  /** The run revision when the service answered. */
  currentRunRevision?: number;
  reviewer?: string;
  runStatus?: string;
  counts?: ReviewCounts;
  noop?: boolean;
}

export interface ReviewCommands {
  save(
    command: ReviewCommand,
    options?: {
      onQueued?(): void;
      signal?: AbortSignal;
    },
  ): Promise<ReviewSaveResult>;
  undo(command: UndoCommand): Promise<ReviewCommandResult>;
  pollStatus(): Promise<ReviewPollState>;
  refresh(): Promise<ReviewModel>;
  capturePage(place: ReviewCapturePlace): Promise<ReviewCapturePage>;
  recompare?(): Promise<ReviewModel>;
}

export class ReviewCommandError extends ClientError {
  readonly model?: ReviewModel;
  readonly reviewer?: string;
  readonly conflict: boolean;

  constructor(
    message: string,
    options: ClientErrorFacts & {
      model?: ReviewModel;
      reviewer?: string;
      conflict?: boolean;
    } = {},
  ) {
    super(message, options);
    this.name = "ReviewCommandError";
    this.model = options.model;
    this.reviewer = options.reviewer;
    this.conflict = options.conflict ?? false;
  }
}
