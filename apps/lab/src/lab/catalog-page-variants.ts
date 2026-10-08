import type { VariantEntry } from "./types.ts";

// The page variants, keyed by page surface. The lab has one design, so each
// page has one variant, and its identifier is the direction identifier. The
// tradeoffs name each place where the page reverses something that the
// maintainer saw in round 1, each reading of a note or an audit answer, and
// what the answers of round 2 did not pick.
export const pageVariants: Record<string, VariantEntry[]> = {
  "sign-in": [
    {
      id: "ariakit",
      name: "Ariakit folio",
      summary:
        "One centered sheet on the empty desk with one brand button. The guest, the no-access, and the error state use the same sheet.",
      direction: "ariakit",
      ideas: [
        "The card is the stock sheet: `$lighten` with a border (your note). The one brand surface of the page is the button.",
        "The `↵` in the button is dimmed text in the shortcut slot, not a key cap (your note). Enter works because the button has the focus, so the page binds no key.",
        "The card keeps its width and its top edge in the four scenarios, and its height while GitHub opens, so nothing jumps.",
        "The access check is never a visible state: the skeleton of the target page shows until the server answers 401.",
      ],
      tradeoffs: [
        "In light, the sheet is almost the canvas (`oklch(1)` on `oklch(0.993)`), so the border and the shadow carry it.",
        "The heading names no repository and the no-access state names no account: a request without access returns no data. Both show with the data mode All proposed fields.",
        "A guest gets no header and no navigation, so the page gives no view of the product.",
      ],
    },
  ],
  inbox: [
    {
      id: "ariakit",
      name: "Ariakit folio",
      summary:
        "One card for the next run to review, then one row design for every other run, in one column of 56rem with about 12 chrome words.",
      direction: "ariakit",
      ideas: [
        "The next run is the only card: number, age, title, the count of changes, and one brand Review button. Its layer is brand at 15% with a border (your answer to `UI-HERO-LAYER`).",
        'Every other run is the picked row "Two lines with review progress": a compact status pill, the title, the identity line, and the state at the end.',
        "No toolbar: the filter, the Refresh button, and the Baseline button are gone. The list reads again on focus and on an interval (D-UX-05).",
        "The bar glider of the header is on the header edge (your note).",
      ],
      tradeoffs: [
        "The first word of the navigation is Queue (D-UX-03). You picked this page with the word Inbox.",
        "The page binds no key: `J`, `K`, `/`, and Enter are gone, and Review has no `↵`. This is a reading of D-WORK-03, which keeps the keys of today for the review page.",
        "The approved part of the row bar shows only with the data mode All proposed fields. With the decided data the bar has two parts, rejected and open, and a run with no rejection shows an empty track.",
        "The approved part needs one count for each run, which D-UX-04 did not select. The query of the run list already sums `pending` and `rejected`, so it is one more `SUM`.",
        "The next run card is a second blue surface beside the brand button. The surface of a sheet (`$lighten`) was not picked.",
        "The next run card has no preview pictures and no author with the decided data. With All proposed fields it shows one row of at most four previews: your answer to `UI-ROW-PICTURE` keeps the pictures.",
        "The next run is the newest run to review, which is not always the most urgent one.",
      ],
    },
  ],
  history: [
    {
      id: "ariakit",
      name: "Ariakit folio",
      summary:
        "A day ledger of run rows, where the runs of one pull request fold under the newest one, below a toolbar with search, result, and sort.",
      direction: "ariakit",
      ideas: [
        "The row is the picked run row, the same part as in the Queue.",
        "Day labels (Today, Yesterday, Oct 3) with one sheet for each day.",
        'Replaced attempts fold into a "2 earlier" button on the newest run of the pull request.',
        "A closed run reads Replaced or Closed, and its pill keeps the last result (D-UX-04).",
      ],
      tradeoffs: [
        "The table with four columns is gone, because the question of the picked run row names History. You picked this page as a table.",
        "The page binds no key: the `/` cap and the row keys are gone (a reading of D-WORK-03).",
        "Folding hides rows. A search match in an older attempt and the Replaced filter must unfold them.",
        "Day labels work only for the time sort.",
        'With API today a run has no title, so a row reads "#7746" and "Pull request" only.',
      ],
    },
  ],
  status: [
    {
      id: "ariakit",
      name: "Ariakit folio",
      summary:
        "One health card that takes the tint of the open alerts and lists them as disclosure rows, above two capacity meters.",
      direction: "ariakit",
      ideas: [
        'The health card is the page heading: "All systems normal" in a success tint, or "3 alerts" in a warning tint, with the time of the last check.',
        "Each alert is one disclosure row: mark, title, subject, last seen. The action and the guide link open on demand.",
        "Capacity is two cards with a `Progress` meter each: the database with its warning point, and the captures in use.",
        'No Refresh button: the page reads again each minute (D-UX-05), and "Checked 12 s ago" stays.',
      ],
      tradeoffs: [
        "With the decided data an alert has no severity, no impact, and no count, so every alert has the warning tint. The danger tint needs All proposed fields.",
        "The page binds no key: `J` and `K` are gone (a reading of D-WORK-03).",
        "The list stays read-only, as the review guide says: no acknowledge and no dismiss.",
        "The text that the list does not certify every dependency is one click away, not on the page.",
      ],
    },
  ],
  pull: [
    {
      id: "ariakit",
      name: "Ariakit folio",
      summary:
        "The page that a GitHub check opens: the title, the commit, the attempt, and one sheet with the state of the newest run and one action.",
      direction: "ariakit",
      ideas: [
        'One action for each state: Review for a run to review, "Open run" for a run that passed, "Open workflow" for a failed capture, and none while the page waits.',
        "Waiting shows three steps (Capture, Compare, Review) in the same sheet, and the page opens the review when it is ready.",
        "The title block has only the fields of D-UX-04: title, commit, attempt, and the workflow link.",
        "In the app, a pull request with a run to review opens that run (D-UX-02). The lab shows the page so that the state can be seen.",
      ],
      tradeoffs: [
        "The page waits for the newest run, as your answer to `UI-PULL-SCOPE` and D-UX-02 say. The page of round 1, which lists every commit and every attempt, was not picked.",
        "The commit folder, the segmented bar with its legend, the preview well, and the list of earlier attempts are gone.",
        "The waiting state has no upper time limit. It needs a rule for a capture that never arrives.",
        "The page binds no key (a reading of D-WORK-03).",
      ],
    },
  ],
  review: [
    {
      id: "ariakit",
      name: "Ariakit folio",
      summary:
        "A fixed-height workspace: a list of the changed screenshots with a picture each, one stage that opens with the current image and the mask, and one floating bar with the view controls and the decisions.",
      direction: "ariakit",
      ideas: [
        'The list has only the screenshots with a change: the picked "One field" over the picked "Diff thumbnail" rows, and Unchanged is an entry of the status select. The bar glider is on the edge of the main panel (your note).',
        'The variant row has the picked stepper, a pager of marks that are links (your note), "All" for the cover, the change in one line, and "Details".',
        "One stage for every mode: `F` current, `G` baseline, `S` two panes, `W` swipe, `O` overlay, and `D` for the mask. Each fact has one place: the label at the image, the chip at the top, and the numbers in the variant row.",
        'The bar is the message: Undo, the view controls, the zoom, Reject, Approve, and a menu with "Approve the run…". A save shows in the pressed button.',
        "After the last decision the panel shows a result page with Undo and the next run (D-WORK-05).",
      ],
      tradeoffs: [
        "The bar is the floating pill (your answer to `UI-STAGE-BAR`). It has 15 controls and is 874 px wide, so it lies over the lower middle of a viewport capture that is zoomed. The docked bar was not picked.",
        "The variant control is the stepper with the cover on request (your answer to `UI-VARIANT-NAV`): one more button and a second view. The stepper without the cover and the folder tabs were not picked.",
        "A row of the list has its picture (your answer to `UI-ROW-PICTURE`): two image requests of full size for each row in view. The row with the marks only was not picked.",
        "The list has the bar glider only (your answer to D-PERF-01). Only the bar travels between rows, and the focus ring of a row in a folder is 3 px inside the row. The hover, selected, and focus gliders that you saw in round 2 are gone.",
        "The page remembers the view between screenshots, variants, and runs (your note), so a stored view opens first in the next run. A mask that is off stays off: the numbers in the variant row and the mask button are then the only signs of a change. The menu of the bar resets the stored view.",
        "The zoom is not a stored selection: it stays inside one run, and a new run opens at Fit. This is a reading of your note.",
        'The diff is red, as the picks "Diff first" and "Outline boxes" and the contract have it. You picked this page with the diff in the secondary color.',
        "A shortcut in a control is dimmed text (your note on the sign-in page). `Kbd` stays in tooltips and in the Keys list. This is a reading of that note.",
        "The keys are the keys of today with `W` and `O` (D-WORK-03). `J`, `K`, `0`, `7` to `9`, `B`, `H`, `C`, `Z`, `+`, `-`, `/`, and `?` are gone.",
        "The zoom levels above 200% change the contract rules K13 and A19.",
        '"Approve the run…" follows your answer to D-WORK-04: a menu item with no key, a confirmation, and one Undo.',
      ],
    },
  ],
};
