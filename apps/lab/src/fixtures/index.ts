// The fixture layer of the lab. Import from this file only. The guide is in
// `apps/lab/docs/fixtures.md`.

export * from "./types.ts";
export { DAY, HOUR, MINUTE, NOW, ago } from "./now.ts";

// The data mode: the decided API, what production sends today, or every
// proposed field.
export {
  DataModeProvider,
  dataModeLabels,
  dataModes,
  getDataMode,
  useDataMode,
} from "./data-mode.ts";
export type { DataModeProviderProps } from "./data-mode.ts";

// One data hook for each page surface. Each takes a scenario identifier of
// the catalog, follows the Data control, and returns a discriminated union on
// `status`.
export {
  useHistoryData,
  useInboxData,
  usePullData,
  useReviewData,
  useReviewSample,
  useSignInData,
  useStatusData,
} from "./use-data.ts";

// The pure getters behind the data hooks, for code outside React. Each takes
// the data mode as its second argument.
export { getSignInData } from "./data/sign-in.ts";
export type { SignInScenario } from "./data/sign-in.ts";
export { getInboxData } from "./data/inbox.ts";
export type { InboxScenario } from "./data/inbox.ts";
export { filterRuns, getHistoryData } from "./data/history.ts";
export type { HistoryScenario, RunFilter } from "./data/history.ts";
export { getStatusData } from "./data/status.ts";
export type { StatusScenario } from "./data/status.ts";
export { getPullData } from "./data/pull.ts";
export type { PullScenario } from "./data/pull.ts";
export { firstSelection, getReviewRun, hasConsistentCounts } from "./data/review.ts";
export type { ReviewScenario } from "./data/review.ts";
export { getReviewSample, reviewSampleIds } from "./data/samples.ts";
export type { ReviewSample, ReviewSampleId } from "./data/samples.ts";

export { currentUser, people, repository } from "./data/people.ts";

// Helpers that need no API change. They give the same result in every mode.
export {
  countVariants,
  formatAxisValue,
  formatKeySegment,
  getFamilyLabels,
  getFitZoom,
  getItemLabel,
  getItemTally,
  getSizeClass,
  getVariantAxes,
  getVariantLabel,
  getVariantMatrix,
  getVariantWords,
  groupItemsByFamily,
  isSizeChange,
  sizeClasses,
  splitItemKey,
  variantAxisOrder,
} from "./derive.ts";
export type {
  FamilyGroup,
  FamilySection,
  FitZoomOptions,
  GroupItemsOptions,
  ImageSize,
  ItemKeyParts,
  SizeClass,
  SizeClassInfo,
  VariantAxisName,
  VariantMatrix,
  VariantMatrixRow,
  VariantTally,
} from "./derive.ts";

// Words, color roles, and run helpers. The hooks module exports the same
// names, so a variant can take them from either module.
export {
  alertSeverityLabels,
  alertSeverityRoles,
  formatCount,
  getRunChangeCount,
  getRunTitle,
  groupRunsByDay,
  groupRunsByPullRequest,
  runKindLabels,
  runStateLabels,
  runStateOrder,
  runStateRoles,
  variantKindLabels,
  variantKindRoles,
} from "./hooks/labels.ts";
export type {
  AlertSeverity,
  ColorRole,
  RunDayGroup,
  RunPullGroup,
  StateLabel,
} from "./hooks/labels.ts";

// Lab-only extras: synthetic screenshots for sizes that production does not
// have. No page scenario uses them.
export {
  brokenImageUrl,
  getScene,
  getScreenshot,
  getScreenshotSet,
  sceneSizes,
  scenes,
} from "./images/index.ts";
export type {
  Appearance,
  ChangeKind,
  Dimensions,
  SceneDefinition,
  SceneId,
  SceneSize,
  Screenshot,
  ScreenshotOptions,
  ScreenshotSet,
  ScreenshotState,
} from "./images/index.ts";

// Deterministic text helpers.
export {
  formatBytes,
  formatDate,
  formatDateTime,
  formatDuration,
  formatRatio,
  formatRelativeTime,
  runKindLabel,
  runStateLabel,
  shortSha,
  variantStatusLabel,
} from "./format.ts";
