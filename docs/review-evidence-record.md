# Review browser evidence record

## Current local UI, round 3

Captured on September 22, 2026 from the working tree based on [`c8c465c`](https://github.com/ariakit/ariviso/commit/c8c465cedd8318b1bbe4b99baec1757ec02347c6). The UI changes were uncommitted at capture time. The [source manifest](./evidence/review-ui.json) records all 62 UI, fixture, style, route, test, configuration, and dependency checksums. They matched before and after the tests and capture. The SHA-256 digest of the sorted, compact JSON checksum map is `d89a6369b0083b68a9e34d566e55bafa7bbc0d1d406e837cea93aa83d5df2dcc`. Verify those checksums before reusing the media for a later revision. The base commit alone does not identify the captured source.

Round 3 includes the final required-mask rule and replaces the previous local UI captures. Its local bundle is named `ariviso-final-ui-evidence-r3`. The media are not repository files. They were later published as attachments to [PR #2](https://github.com/ariakit/ariviso/pull/2), as recorded in the publication check below. Artifact names below identify members of that bundle; the manifest records their byte counts and SHA-256 values.

| Artifact                       | Bundle member                                 | Dimensions  |
| ------------------------------ | --------------------------------------------- | ----------- |
| Review screenshot              | `review-current-source.png`                   | 1280 × 1090 |
| Historical result screenshot   | `history-current-source.png`                  | 1280 × 1252 |
| Service attention screenshot   | `attention-current-source.png`                | 1224 × 540  |
| Keyboard and history recording | `review-keyboard-history-current-source.webm` | 1280 × 1280 |

The origin was `http://127.0.0.1:4393`. The review fixture used synthetic images, run `run-42`, attempt 2, and comparisons 2 and 3. Review commands used simulated saved responses. History links opened the actual run route fixture with simulated access, session, and run responses. A local document redirect mapped each history link to that fixture; the requests selected `/api/runs/run-42` and `/api/runs/run-42?comparison=comparison-3`. No GitHub session, deployed API, or production data was used.

The attention screenshot used simulated missing-backup and database-capacity events. Its 315 MiB database, 275 MiB SQL snapshot, 320 MiB admission limits, and one active-capture slot are fixture values. They are not production measurements or selected launch limits. The panel states that no external notifications are sent. All screenshots have capture-only labels that identify synthetic data; no repository UI source was changed to add those labels.

Chrome 154 ran on macOS through Playwright CLI 0.1.17. The review and historical screenshots used a 1280 × 900 viewport and captured the full page. The attention screenshot uses a focused panel crop from the same viewport size. The recording used a 1280 × 1280 viewport. The VP8 WebM contains 735 frames at 25 frames per second and lasts 29.4 seconds.

The recording starts with 9 of 11 variants needing review. Labels and target outlines identify `D`, `S`, `A`, and `Cmd+Z`. Approval changes the count to 8 of 11, marks React approved, and selects Solid. Undo restores React, its pending verdict, and the count of 9 of 11. A tolerated result with `changedPixels: 1` and `maskExpected: false` has no stored diff mask. Pressing `D` shows “Pixel changes are within the comparison tolerance.” and approval stays available. The next stage requests a comparison for a retained closed run. The previous evidence stays visible until comparison 3 is ready. The final stage opens the original comparison and then historical comparison 3 through their links. Approval, rejection, and Undo remain disabled in the historical view.

Every decoded frame, numbered 0 through 734, was inspected in eight sequential contact sheets. Full frames at 8, 11, 15.5, and 29 seconds were also inspected. All three final screenshots were inspected at full size. The action labels, highlighted targets, saved states, comparison identity, tolerance explanation, and final read-only controls are visible. The route transitions contain brief normal document-loading frames. The capture reported no page errors. The local server returned a benign favicon 404.

All 52 Chrome checks passed against the integrated root UI, with no skipped, unexpected, or flaky results. External test configurations imported the root configurations and changed only the local port, cache/output directories, and server reuse. Product files and browser assertions were not copied or changed. The checks cover review commands, Undo, historical navigation, the sign-in return path, item paging and focus, operation alerts, zero-pixel and tolerated nonzero-pixel results, required-mask failures, and original-image failures. The manifest includes checksums for the local test log and JSON report. Visual capture does not replace those checks.

## Deployed diagnostic checks

The [deployed review report](./evidence/deployed-review/REPORT.md) and [sanitized receipts](./evidence/deployed-review/receipts.json) record browser-driven Reject and Undo, stale-revision conflict and refresh, and forced image-failure recovery on the diagnostic service. These commands used real deployed models and persistence. Authentication used a seeded diagnostic session with live GitHub permission checks. Both conflict participants used separate review sessions under the same GitHub identity. This does not establish OAuth login or conflict behavior between distinct GitHub users.

The deployed capture is tied to the versions recorded in its [manifest](./evidence/deployed-review/manifest.json). It does not establish that those deployed versions contain the final round 3 working-tree source. The [earlier deployed read-only checks](./evidence/deployed-review-readonly.md) separately record real image loading, focus, and Fit/100%/200% zoom.

## PR attachment verification

The three round 3 screenshots and the keyboard/history recording are published in [PR #2](https://github.com/ariakit/ariviso/pull/2). The [publication receipt](./evidence/review-publication.json) records their exact attachment links. On September 22, the in-app browser loaded all three images with the dimensions above and played the 29.4-second video through its end without a media error. An earlier tab renderer had crashed; verification used a fresh PR tab. All 62 source checksums still match the original UI manifest.

Keep the local simulated capture and deployed diagnostic evidence labeled separately. Neither set establishes production readiness, OAuth completion, the full accessibility gate, or the remaining launch checks.
