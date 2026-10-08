import type { SurfaceEntry } from "./types.ts";

// The reference surfaces. Round 1 settled each one, and the pages use the
// picked part. A surface stays here when it shows states that no page scenario
// can reach, or when it is the legend of a vocabulary.
export const references: SurfaceEntry[] = [
  {
    id: "status-mark",
    kind: "component",
    decision: "UI-STATUS-MARK",
    title: "Status mark",
    question: "Which mark should show the state of a run and the verdict of a variant?",
    description:
      "The legend of the vocabulary: one mark and one word for each of the eight run states and the seven variant states. A strip of marks uses the bare glyph, and every other place uses the pill.",
    group: "Reference",
    status: "settled",
    layout: "row",
    scenarios: [
      {
        id: "run-states",
        label: "Run states",
        description:
          "The eight run states in the order of a legend, each from a real run of the busy queue.",
      },
      {
        id: "variant-states",
        label: "Variant states",
        description:
          "The seven states of one variant, with the same marks for the words that runs share.",
      },
      {
        id: "compact",
        label: "Compact",
        description:
          "The two short forms: the disc with the icon for a row that has the word at its end, and the bare glyph for a strip of 6 to 24 marks.",
      },
      {
        id: "counts",
        label: "With counts",
        description:
          "The mark next to a count: 246 changes, 17 changes with 1 rejected, capturing 1,290 of 3,832, comparing 2,342 of 3,832.",
      },
      {
        id: "surfaces",
        label: "On surfaces",
        description:
          "Needs review and Failed on the canvas, on a raised sheet, in a row with the hover and the selected state, and on a brand tint.",
      },
    ],
    variants: [
      {
        id: "pill",
        name: "Tinted pill",
        summary:
          "The stock badge with a 15 percent tint, a ring, an icon, and the word. Replaced and Unchanged use the outline badge.",
        ideas: [
          "One table in the kit holds the icon, the word, and the bare glyph of each state. No part keeps a table of its own.",
          "The pill is compact in a row: a tinted disc with the icon, because the text at the end of the row says the state.",
          "The full pill with its word is for a place that has no other word: the pull request sheet, the header of a closed run, and this legend.",
        ],
        tradeoffs: [
          "Six tinted discs in a row are too heavy, so a strip of variant marks uses the bare glyph.",
          'A label of two words makes a wide pill, for example "Rerun needed".',
          "Neutral states look like tags.",
        ],
      },
    ],
  },
  {
    id: "image-states",
    kind: "component",
    decision: "UI-IMAGE-STATES",
    title: "Image states",
    question: "How does the stage show an image that loads, is absent, failed, or changed size?",
    description:
      "The review stage in each state other than one or two loaded images of equal size. Some of these states are in no page scenario: a slow load, a failed load, and an image that CI did not upload.",
    group: "Reference",
    status: "settled",
    layout: "row",
    scenarios: [
      {
        id: "loading",
        label: "Loading",
        description:
          "Both images of a 416 × 136 card load and never arrive. The sizes are known before the bytes, so nothing may move, and Retry shows after 6 s.",
      },
      {
        id: "switching",
        label: "Next variant",
        description:
          "The selection changed to the dark variant, which is 2 px taller: the old pixels go at once, the new images arrive after 1.5 s, and Replay runs it again.",
      },
      {
        id: "added",
        label: "Added",
        description: "No baseline exists. The variant is approved automatically.",
      },
      { id: "removed", label: "Removed", description: "No current image exists." },
      {
        id: "load-failed",
        label: "Failed to load",
        description:
          "The current image failed and the baseline loaded. This is an error with Retry (the image arrives 1.2 s after Retry), not an added or removed image, and the decisions are off.",
      },
      {
        id: "size-changed",
        label: "Size changed",
        description: "416 × 136 became 416 × 138: the same card, 2 px taller, and no mask exists.",
      },
      {
        id: "not-uploaded",
        label: "Not uploaded",
        description:
          "A 1440 × 900 viewport capture has no visible change, and CI did not upload the current image (`candidateOmitted`).",
      },
      {
        id: "expired",
        label: "Images expired",
        description: "A closed run whose images are deleted. The decisions remain.",
      },
    ],
    variants: [
      {
        id: "state-chip",
        name: "State chip",
        summary:
          "One chip at the top center of the stage holds each state as an icon with one to three words, and the images that exist take the rest.",
        ideas: [
          "One place for each state: the reviewer learns where to look.",
          "The chip shows only when the stage is not one or two loaded images of equal size.",
          "The loading chip shows only after 400 ms, so a fast load shows no signal.",
          "Each fact has one place: the label at the image has the name and the size, and the variant row has the numbers of the change.",
        ],
        tradeoffs: [
          "A small chip can be too quiet for an error. Rule A23 asks for an error with Retry, and the chip has both.",
          'The second fact, for example "No baseline", is in a tooltip only. The chip takes keyboard focus to show it.',
          "One pane for one image replaces rule A21.",
          "Expired is an empty stage with one chip.",
        ],
      },
    ],
  },
  {
    id: "error-state",
    kind: "component",
    decision: "UI-ERROR-STATE",
    title: "Error state",
    question: "How should a failed load look?",
    description:
      "A page, a list, or an image that did not load, in a 360 px cell: the cause in plain words, what happened to the work, and the one action that can help. Five of these failures are in no page scenario.",
    group: "Reference",
    status: "settled",
    layout: "row",
    scenarios: [
      {
        id: "unavailable",
        label: "Service problem",
        description:
          "The Queue did not load: a 503 with the Error ID req_01JZ8Q2N5K. The page tries again in 5 s.",
      },
      {
        id: "offline",
        label: "Offline",
        description: "No connection. The load starts again when the connection returns.",
      },
      {
        id: "stale-list",
        label: "Refresh failed",
        description:
          "The Queue is on screen with three real runs of 4 minutes ago and a refresh failed. The list must stay.",
      },
      {
        id: "out-of-date",
        label: "App updated",
        description:
          "A deploy changed the app under an open tab. Reload is the only action that helps.",
      },
      {
        id: "image",
        label: "Image failed",
        description:
          "The current image of Default · Chromium · Light did not load, so Approve and Reject are off.",
      },
      {
        id: "images-expired",
        label: "Images expired",
        description:
          "A closed, approved run whose images are deleted: a permanent state that must not offer Retry.",
      },
      {
        id: "run-failed",
        label: "Run failed",
        description:
          "Run #7748 failed in CI. The fix is on GitHub, not in the app. The reason of the service shows only with the data mode All proposed fields.",
      },
      {
        id: "crash",
        label: "Crash",
        description:
          "A render error with a stack trace of three lines behind Details. The page shell may be gone.",
      },
    ],
    variants: [
      {
        id: "in-place",
        name: "In place",
        summary:
          "The failed region keeps its shape: its content or its still skeleton stays under a tinted band that names the failure, says one more fact, and has the action.",
        ideas: [
          "An error is a state of a region, not a new page: the header, the list, and the scroll position stay.",
          "Stale rows stay readable and stay links.",
          "The band has the same two lines for every state in a narrow region, and one line from 32rem, so nothing jumps.",
          "The Error ID is a small button in the band that copies it.",
        ],
        tradeoffs: [
          "Dimmed stale content can be taken for current content.",
          "With no earlier content, a still skeleton under a band is an odd picture.",
          "In a 360 px region the band takes two lines, and the longest title takes three at compact density.",
          "The Error ID has no visible label.",
        ],
      },
    ],
  },
  {
    id: "notice",
    kind: "component",
    decision: "UI-NOTICE",
    title: "Bar states",
    question: "Where and how should the app say what just happened?",
    description:
      "Every message of the review bar, each one forced in the bar of the page. A page scenario shows the read-only run and the comparison in progress. The save states and the conflict are only here, because the session of the lab has no second reviewer.",
    group: "Reference",
    status: "settled",
    layout: "stack",
    scenarios: [
      {
        id: "sending",
        label: "Saving",
        description:
          'One decision waits for its receipt: a ring in the pressed button, and "Saving…" in its tooltip and in the live region (D-RES-02).',
      },
      {
        id: "queued",
        label: "Saving two",
        description:
          'Two decisions on one screenshot wait for their receipts: the ring and a count. The bar says no "Queued" and makes no promise about a closed window (D-RES-02).',
      },
      {
        id: "saved",
        label: "Saved",
        description:
          "The receipt is final: the pressed button reads Approved with a check for 800 ms, and Undo is available.",
      },
      {
        id: "not-saved",
        label: "Not saved",
        description:
          "The connection was lost: the verdict went back, later decisions are blocked, and Retry sends the same decision.",
      },
      {
        id: "conflict",
        label: "Conflict",
        description:
          "Another reviewer decided this variant first, so the approval was not saved. The message names the reviewer with the stored profile name (your answer to D-RES-05).",
      },
      {
        id: "conflict-own",
        label: "Own second tab",
        description:
          "The same person decided this variant in another tab. The message has a text of its own (D-RES-05).",
      },
      {
        id: "refused",
        label: "Refused",
        description:
          "`Shift+X` on a screenshot with one read-only variant: nothing changed, and the bar says so.",
      },
      {
        id: "replaced",
        label: "Newer run",
        description:
          "Attempt 3 of #7754 replaced this run while the tab was open (D-RES-03). This run takes no decision now, and the bar opens the newer one.",
      },
    ],
    variants: [
      {
        id: "bar-takeover",
        name: "The bar is the message",
        summary:
          "A save shows inside the pressed button, and a blocking state replaces Reject and Approve with the only actions that are valid.",
        ideas: [
          "The only possible actions are the only visible actions.",
          "No message area exists in the normal case: the button says Approved.",
          "The tint of the bar is the state: neutral, warning, danger.",
          "A run that takes no decision keeps the view controls and reads Read-only.",
        ],
        tradeoffs: [
          "Reject and Approve leave their place in a blocking state, so a fast second key press must do nothing.",
          "A tint across the bar is loud.",
          "The conflict names the reviewer with the stored name (D-RES-05). Without a stored name it reads as another reviewer.",
        ],
      },
    ],
  },
];
