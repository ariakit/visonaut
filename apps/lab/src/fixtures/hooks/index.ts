// The state hooks of the lab. Each hook takes the scenario identifier of
// `VariantProps` and returns plain data and actions, so a variant is
// interactive without logic of its own. The state is local React state: no
// network and no storage. The guide is the section "State hooks" in
// `apps/lab/docs/fixtures.md`, and `/dev/hooks` drives every hook.

export { useReviewSession } from "./use-review-session.ts";
export type {
  ReviewAbilities,
  ReviewPosition,
  ReviewSession,
  ReviewSessionActions,
  ReviewSessionError,
  ReviewSessionLoading,
  ReviewSessionOptions,
  ReviewSessionReady,
  ReviewTarget,
} from "./use-review-session.ts";

export { reviewShortcuts, useReviewShortcuts } from "./use-review-shortcuts.ts";
export type { ReviewShortcut, ReviewShortcutOptions } from "./use-review-shortcuts.ts";

export { useViewer, viewerModes, viewerZooms } from "./use-viewer.ts";
export type {
  Viewer,
  ViewerHighlight,
  ViewerOptions,
  ViewerSide,
  ViewerSubject,
} from "./use-viewer.ts";

export {
  defaultReviewFilters,
  getVariantStatus,
  isReviewable,
  reviewStatusLabels,
  reviewStatusOrder,
  reviewStatusRoles,
} from "./review-model.ts";
export type {
  CommandTarget,
  DecisionAction,
  DecisionScope,
  ItemCounts,
  ItemGroup,
  KindProgress,
  ReadOnlyKind,
  ReviewCommand,
  ReviewFacets,
  ReviewFilters,
  ReviewOrder,
  ReviewProgress,
  ReviewStatus,
  SaveState,
  SaveStatus,
  SessionItem,
  SessionVariant,
  VerdictSnapshot,
} from "./review-model.ts";

export { getInboxGroup, inboxGroupLabels, inboxGroupOrder, useInbox } from "./use-inbox.ts";
export type {
  Inbox,
  InboxCounts,
  InboxError,
  InboxGroup,
  InboxGroupId,
  InboxLoaded,
  InboxLoading,
  InboxOptions,
} from "./use-inbox.ts";

export { defaultHistorySort, sortRuns, useHistory } from "./use-history.ts";
export type {
  History,
  HistoryError,
  HistoryLoaded,
  HistoryLoading,
  HistoryOptions,
  HistorySort,
  HistorySortKey,
} from "./use-history.ts";

export { serviceHealthRoles, useStatus } from "./use-status.ts";
export type {
  ServiceHealth,
  Status,
  StatusAlert,
  StatusCounts,
  StatusError,
  StatusLoading,
  StatusOptions,
  StatusReady,
} from "./use-status.ts";

export { pullOutcomeLabels, pullOutcomeRoles, usePull } from "./use-pull.ts";
export type {
  Pull,
  PullCommit,
  PullError,
  PullLoading,
  PullOptions,
  PullOutcome,
  PullReady,
} from "./use-pull.ts";

export { useSignIn } from "./use-sign-in.ts";
export type { SignIn, SignInOptions, SignInStatus } from "./use-sign-in.ts";

export { useSimulatedLoad } from "./use-simulated-load.ts";
export type {
  SimulatedLoad,
  SimulatedLoadOptions,
  SimulatedLoadStatus,
} from "./use-simulated-load.ts";

export type { Refresh } from "./use-refresh.ts";

// Pure helpers: words, color roles, and small formatters.
export {
  alertSeverityLabels,
  alertSeverityRoles,
  formatCount,
  formatRelativeTime,
  getRunChangeCount,
  getRunTitle,
  groupRunsByDay,
  groupRunsByPullRequest,
  runKindLabels,
  runStateLabels,
  runStateOrder,
  runStateRoles,
  shortSha,
  variantKindLabels,
  variantKindRoles,
} from "./labels.ts";
export type { AlertSeverity, ColorRole, RunDayGroup, RunPullGroup, StateLabel } from "./labels.ts";
