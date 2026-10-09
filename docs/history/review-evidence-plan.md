# Review UI evidence

This document defines the captures needed to show the implemented review flow. It is a capture plan, not a record of deployed validation. Store the resulting evidence with the exact source revision and environment. Do not treat a fixture image or a design screenshot as evidence of live authentication or saved review state.

## Capture record

Record these fields for each evidence set:

| Field       | Required value                                                                     |
| ----------- | ---------------------------------------------------------------------------------- |
| Source      | Exact commit and whether the working tree differs                                  |
| Environment | Local fixture, preview, diagnostics, or production; include the origin             |
| Browser     | Chrome version, operating system, and viewport                                     |
| Data        | Run ID, tested SHA, attempt, comparison ID, and initial selection                  |
| State       | Initial verdicts, baseline revision, and whether actions will change them          |
| Results     | Each scenario's observed result, media location, and related test command          |
| Limits      | Mocked requests, injected failures, unavailable integrations, and paths not tested |

The local review suite uses controlled data and a Chrome viewport of 1280 × 900. Run it with:

```sh
pnpm test:browser
```

The suite covers keyboard navigation, shortcut exclusions, readiness and retry, server-confirmed commands, conflict handling, Undo, absent images, zoom, and narrow layout. Keep the command result with the tested revision. Test completion alone does not prove the deployed GitHub sign-in, permission, storage, or baseline path.

## User-facing media

Use a disposable preview or diagnostic run for commands that change verdicts. Use generic capture content suitable for the intended audience. The review app contains private labels, review history, and metadata even though validated image URLs are public. Keep private evidence in the private review context. Do not place screenshots or recordings in the source tree solely for a pull request.

| Planned artifact          | Scene and caption                                                        | What it shows                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `review-dashboard.png`    | “Runs show the tested commit, attempt, and current state.”               | Signed-in dashboard with the repository and full table headings                                                                  |
| `review-attention.png`    | “Service alerts show recovery steps and the last check time.”            | An unresolved backup alert, its recovery link, and the in-app refresh notice                                                     |
| `review-workspace.png`    | “Inspect the selected variant before saving a decision.”                 | Desktop workspace with run identity, pending count, item list, full variant label, result, and paired images                     |
| `review-keyboard.webm`    | “Approve with A, then Undo to restore the prior decision and selection.” | Focus enters the workspace; switch variants and modes; save one decision; wait for confirmation and next-pending selection; Undo |
| `review-removal.png`      | “A removal keeps the reference image and labels the absent candidate.”   | A removed variant in Side by side, explicit absent-image text, and unavailable Pixel diff                                        |
| `review-image-retry.webm` | “Retry the failed image before review actions become available.”         | A controlled image-load error; disabled decisions; Retry; actual visible image success; enabled decisions                        |
| `review-conflict.png`     | “A newer decision is preserved when a command conflicts.”                | Conflict message, current verdict, retained selection, and refresh control                                                       |
| `review-narrow.png`       | “The item list and comparison images stack in a narrow window.”          | Narrow layout with readable actions and no hidden page-level controls                                                            |
| `review-zoom.png`         | “Inspect original pixels at 200% with keyboard pan controls.”            | Zoom control, enlarged original, and pan controls with the selected image still identifiable                                     |

Use focused page or element screenshots. Avoid full-page captures if they make the result too small to read. Keep a recording short and hold its initial and final states long enough to inspect. Put explanatory text in the caption instead of altering screenshot pixels.

For narrow layout evidence, use the suite's tested viewport. Record the exact width and height instead of labeling it as certified mobile support. Distinguish the viewer's 200% image scale from browser page zoom. Capture browser zoom separately if it is part of the accessibility check.

## Deployed checks

1. Open the actual deployed root route while signed out. Confirm that it offers GitHub sign-in and reveals no run list.
2. Sign in as a current maintainer. Confirm that the dashboard loads real runs. Record the visible tested SHA and attempt, then open that run.
3. Confirm that the displayed images belong to the selected comparison. Select another item while its images load and verify that the old pixels cannot be reviewed as the new selection.
4. On the disposable run, perform the keyboard recording above. Reload after the save and verify the stored result. Confirm that reload clears the local Undo stack.
5. Use two authorized sessions to produce a stale decision. Verify the conflict, current result, and unchanged selection. Do not infer atomicity from the screenshot alone; link the service test evidence.
6. Recompare the stored run. Confirm that the page holds review actions until the new comparison is ready. Export the ready run and verify a downloaded archive with `complete.json` and matching checksums.
7. Sign out. Confirm that the direct run URL and private API require a session again. Use the separate authorization test evidence for revocation, denied users, expiry, and preview isolation.
8. Capture the narrow and zoom states and inspect all images at full size before attaching the media.

Keep failure injection in a local or isolated environment. Identify it in the capture record. An injected image failure proves the viewer's recovery behavior; it does not prove a real storage outage or recovery.

## Code inspection result

The integrated routes use `GET /api/me` before loading protected app data. The dashboard then requests `GET /api/runs`; a run route calls `loadReview(runId)`, which reads `GET /api/runs/:id` and creates a server-bound review session. Saves, Undo, recompare, and export use the corresponding private API routes with same-origin credentials.

```text
GET  /api/operations
POST /api/review-sessions
POST /api/comparisons/:id/commands
POST /api/commands/:id/undo
POST /api/runs/:id/recompare
POST /api/runs/:id/export
GET  /api/exports/:id
```

The server checks current maintainer permission for protected API requests. Run reads and commands verify the configured project. The operation alerts endpoint and deployed export adapter also require exactly one project matching the configured repository. These checks are independent of the client route guard. The source inspection found no path or project-boundary mismatch in this flow. Deployed evidence must still establish the runtime behavior.
