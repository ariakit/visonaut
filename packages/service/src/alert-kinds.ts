/**
 * The kind of each alert that the service stores in `operations_events`.
 * `recordEvent` of the web app takes only these kinds, and the Status page has
 * one text for each kind, so a new kind with no text fails the type check.
 *
 * Two statements write an alert without `recordEvent`: the expired staged run
 * here (`staged-reconciliation`) and the restore of the web app (`restore`).
 * Each binds a kind of this type, and a test fails when a statement writes a
 * kind as SQL text.
 */
export type AlertKind =
  // One alert for each record that needs attention.
  | "check-creation"
  | "check-delivery"
  | "comparison-finalization"
  | "database-capacity"
  | "history"
  | "promotion"
  | "pull-request-comment"
  | "reference-retention"
  | "restore"
  | "retention"
  | "snapshot-retention"
  | "staged-reconciliation"
  | "staged-retention"
  | "upstream-webhook"
  // One alert for each step of a pass that failed. Its subject is `scheduler`.
  // Six kinds above are also the name of a step.
  | "checks"
  | "comments"
  | "exports"
  | "finalization"
  | "main-retirement"
  | "profile-retention"
  | "review-decisions"
  | "runtime"
  | "source-retention"
  | "staged"
  | "webhooks";
