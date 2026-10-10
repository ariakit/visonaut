import type { AlertKind } from "../../operations/alert-kinds.ts";

const guideUrl = "https://github.com/ariakit/visonaut/blob/main/apps/web/src/operations/README.md";

/**
 * The parts of the operations guide that have a procedure for an alert. The
 * key is the anchor of the heading, and the value is the heading.
 */
export const guideParts = {
  "locked-check": "Locked check",
  "native-database-recovery": "Native database recovery",
} as const;

export type GuidePart = keyof typeof guideParts;

export function getGuideUrl(part: GuidePart) {
  return `${guideUrl}#${part}`;
}

export interface AlertText {
  title: string;
  /** What the reader does. It names the guide only together with `guide`. */
  action: string;
  /** The part of the guide with the procedure. Most alerts have none. */
  guide?: GuidePart;
}

interface AlertKindText extends AlertText {
  /** The codes of the kind that need other words. */
  codes?: Record<string, Partial<AlertText>>;
}

/** The alert of a step of a pass that failed. Its subject is `scheduler`. */
function stepText(name: string): AlertText {
  return {
    title: `The ${name} step failed`,
    action:
      "The service runs this step again in the next pass, and the alert closes when the step completes. If the alert stays open, read the log of the Worker for the cause.",
  };
}

const storageCleanup: AlertText = {
  title: "Storage cleanup needs attention",
  action:
    "Check storage access and the affected run's retention pins. Preserve required review and recovery images.",
};

/**
 * The words of each alert kind. The type has each kind as a key, so a kind
 * that the service adds needs its words here.
 */
export const alertTexts: Record<AlertKind, AlertKindText> = {
  "check-creation": {
    title: "A GitHub check needs attention",
    action:
      "The service could not create the check of this run on GitHub. Check GitHub App access and GitHub availability.",
    codes: {
      ambiguous: {
        action:
          "The service does not know if GitHub created the check of this run. Look for the check on the commit on GitHub before a new attempt.",
      },
    },
  },
  "check-delivery": {
    title: "A GitHub check needs attention",
    action:
      "Each attempt to send a result to this GitHub check failed. Check GitHub App access and GitHub availability.",
    codes: {
      ambiguous: {
        action:
          "The check is locked: the service does not know if an update reached GitHub, so the check gets no new update. Follow the part “Locked check” of the operations guide with the check ID of this alert.",
        guide: "locked-check",
      },
    },
  },
  "comparison-finalization": {
    title: "A comparison could not finish",
    action:
      "The service could not complete this comparison. Check the comparison results and database access.",
  },
  "comparison-publication": {
    title: "A comparison could not enter the queue",
    action:
      "Check queue access and service availability. The scheduler retries pending work automatically.",
  },
  "comparison-task": {
    title: "A comparison exhausted its retries",
    action:
      "Check the original images and comparison service. Correct the failure, then compare the retained run again.",
  },
  "database-capacity": {
    title: "Database capacity needs attention",
    action:
      "New capture runs pause at the admission limit. Let existing runs finish, then review database size and retained history. Preserve identity and review history.",
    codes: {
      "measurement-unavailable": {
        action:
          "The service could not measure the database in a scheduled pass. The next pass measures again, and the alert closes when a measurement succeeds.",
      },
    },
  },
  "historical-archive": {
    title: "The archive of a closed comparison needs attention",
    action:
      "The service could not store the archive of this closed comparison. Check storage and database access.",
  },
  history: {
    title: "The history of a closed run needs attention",
    action:
      "The service could not store the summary of this closed run. Check storage and database access.",
    codes: { "step-failed": stepText("history") },
  },
  promotion: {
    title: "A baseline update needs attention",
    action:
      "The service could not make this run the new baseline. Check the run and its required original images.",
    codes: { "step-failed": stepText("promotion") },
  },
  "reference-retention": {
    ...storageCleanup,
    codes: { "step-failed": stepText("reference cleanup") },
  },
  restore: {
    title: "A restored deployment needs attention",
    action:
      "Complete the part “Native database recovery” of the operations guide, with the secret rotation and the access checks, before activation.",
    guide: "native-database-recovery",
  },
  retention: {
    ...storageCleanup,
    codes: { "step-failed": stepText("image cleanup") },
  },
  "snapshot-retention": {
    ...storageCleanup,
    codes: { "step-failed": stepText("snapshot cleanup") },
  },
  "staged-reconciliation": {
    title: "A signed capture run needs attention",
    action:
      "Check this GitHub workflow run and its staged images. The service retries each hour. If a restore removed staged bytes, run a fresh signed capture and upload of every shard.",
    codes: {
      "expired-incomplete": {
        action:
          "This workflow attempt expired before its capture was complete. Run the workflow again if the capture is still necessary. The alert can stay open after a newer run replaced the attempt.",
      },
    },
  },
  "staged-retention": {
    ...storageCleanup,
    codes: { "step-failed": stepText("staged cleanup") },
  },
  "upstream-webhook": {
    title: "GitHub webhook delivery needs attention",
    action:
      "Check GitHub App credentials and GitHub availability. The scheduler retries delivery recovery automatically.",
    codes: {
      "production-receiver-mismatch": {
        action:
          "Set the GitHub App webhook URL to the production /v1/webhooks receiver after preview sessions are retired. Verify the signed ping and authorization revocation delivery.",
      },
      "redelivery-exhausted": {
        action:
          "Inspect this delivery ID in the GitHub App settings. Fix the receiver, request manual redelivery, then verify that GitHub lists the new delivery as successful. GitHub permits a redelivery for 3 days. After that time, this alert does not close by itself.",
      },
    },
  },
  "check-aliases": stepText("pull request check"),
  checks: stepText("check delivery"),
  exports: stepText("export cleanup"),
  finalization: stepText("comparison finalization"),
  "main-retirement": stepText("main run retirement"),
  "profile-retention": stepText("capture profile cleanup"),
  "review-decisions": stepText("review decision"),
  "review-links": stepText("review link"),
  runtime: {
    title: "A scheduled pass failed",
    action:
      "The scheduler could not complete a pass. The alert closes when a later scheduled pass completes. If the alert stays open, read the log of the Worker for the cause.",
  },
  "source-retention": stepText("source baseline cleanup"),
  staged: stepText("staged run"),
  webhooks: stepText("webhook"),
};

/** The words for an alert of a kind that this page does not know. */
const unknownAlert: AlertText = {
  title: "A service alert needs attention",
  action:
    "This page has no words for this kind of alert. Use its kind, its code, and its subject to find the cause.",
};

function isAlertKind(kind: string): kind is AlertKind {
  return Object.hasOwn(alertTexts, kind);
}

/**
 * The words of one alert. The service of a newer or an older deployment can
 * send a kind that this list does not have: such an alert gets general words.
 */
export function getAlertText(kind: string, code: string): AlertText {
  if (!isAlertKind(kind)) {
    return unknownAlert;
  }
  const { codes, ...text } = alertTexts[kind];
  if (!codes || !Object.hasOwn(codes, code)) {
    return text;
  }
  return { ...text, ...codes[code] };
}
