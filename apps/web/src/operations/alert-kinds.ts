/**
 * The kind of each alert that the service stores in `operations_events`.
 * `recordEvent` takes only these kinds, and the Status page has one text for
 * each kind, so a new kind with no text fails the type check.
 *
 * Three kinds are written by a statement and not by `recordEvent`:
 * `comparison-publication` and `staged-reconciliation` (code
 * `expired-incomplete`) in `@visonaut/service`, and `restore` in
 * `recovery.ts`. A new statement of that form needs its kind here too.
 */
export type AlertKind =
  // One alert for each record that needs attention.
  | "check-creation"
  | "check-delivery"
  | "comparison-finalization"
  | "comparison-publication"
  | "comparison-task"
  | "database-capacity"
  | "historical-archive"
  | "history"
  | "promotion"
  | "reference-retention"
  | "restore"
  | "retention"
  | "snapshot-retention"
  | "staged-reconciliation"
  | "staged-retention"
  | "upstream-webhook"
  // One alert for each step of a pass that failed. Its subject is `scheduler`.
  // Six kinds above are also the name of a step.
  | "check-aliases"
  | "checks"
  | "exports"
  | "finalization"
  | "main-retirement"
  | "profile-retention"
  | "review-decisions"
  | "review-links"
  | "runtime"
  | "source-retention"
  | "staged"
  | "webhooks";
