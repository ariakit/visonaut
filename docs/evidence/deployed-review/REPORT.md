# Deployed review mutation checks, E05

All three checks passed on September 22, 2026 in Chrome 154.0.8037.44. At the end of the capture, the target run was passed and both variants were approved. No restoration action remained. The [sanitized receipts](./receipts.json) contain the recorded commands and state snapshots; the [manifest](./manifest.json) records their checksums and the media checksums.

## Scope and deployment

The target was the [deployed diagnostic review](https://ariviso-diagnostics.ariakit.workers.dev/runs/7f114089-e7e9-41be-bb3a-977d5fa88eec), run `7f114089-e7e9-41be-bb3a-977d5fa88eec`, comparison `2ad5f602-7769-4a38-999a-a51db3689329`, attempt 3. It reviewed synthetic images from [`b68da87`](https://github.com/ariakit/ariviso-diagnostics/commit/b68da87fd96aee172a1fa691c5b0cbea9f444d42).

The coordinating task supplied web deployment `3b60f5b7-c6a9-4412-b9ad-e420cd79f020` and comparator deployment `8753ea45-fc1f-47af-a5ad-599aa3063c85` before the mutation window. The browser task did not independently query those IDs. The coordinating task held diagnostic PRs 7 and 8 outside the merge queue and did not review or recompare the target during this window. This record establishes behavior on those recorded deployments, not equivalence to the later local UI source.

Authentication used an authorized seeded diagnostic session. Its bearer was added only to requests for the exact diagnostic origin and `/api/` path. The backend used real GitHub permission checks. This is deployed application evidence, not OAuth evidence. The conflict check used a separate review session under the same synthetic GitHub identity; it does not prove conflict behavior between two distinct GitHub users.

All models, review commands, and image bytes came from the deployed service. The only failure injection aborted one candidate-image request in the browser. No image or API response was replaced.

## Results

| Check                  | Action and observation                                                                                                                                                                                                                                                                               | Result |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Reject and Undo        | Keyboard `X` saved a rejection with HTTP 200. Keyboard `Meta+Z` saved Undo with HTTP 200 and restored the original selection and approval.                                                                                                                                                           | Passed |
| Stale revision         | A second review session changed the selected row from revision 7 to 8. The browser submitted stale revision 7 and received HTTP 409. The conflict banner named reviewer `3068563`; Refresh current state loaded the current rejected verdict. The second session then used Undo to restore approval. | Passed |
| Failed image and retry | One candidate-image request was aborted. The viewer showed Image evidence unavailable, review controls were disabled, and keyboard `A` and `X` caused no review command. Removing the interceptor and selecting Retry images restored all three 160 × 120 images and enabled review.                 | Passed |

The model immediately before and after the stale command matched exactly. The models before the image error, during the error, and after recovery also matched exactly. The image check observed zero review or recompare POST requests.

| Action                | Command ID                             | HTTP status |
| --------------------- | -------------------------------------- | ----------- |
| Browser Reject        | `33e52a79-f8f3-4962-8ca9-c4ede8fb8cd0` | 200         |
| Browser Undo          | `347a9fb4-3143-4bc0-8fcd-e538c8918919` | 200         |
| Second-session Reject | `e03d8659-b112-4a96-b776-cc051af958f5` | 200         |
| Stale browser Reject  | `bf168d8a-5c79-47d2-a4b5-3352ebb6e504` | 409         |
| Second-session Undo   | `6809bf78-e2be-4738-8cee-548e4469c6da` | 200         |

## Restored state and harness correction

The final run status was `passed`. `synthetic/second` was approved by human review at revision 9; `synthetic/first` was approved by human review at revision 1. The comparison ID, image IDs, baseline revision 1, and promotion ID stayed unchanged. The promotion ID was `promotion-d6a95e35aed3f340f30a4c5df61418e1238ba553856fffd3acd488d5caf45def`.

The live `comparisonRevision` advanced from 15 to 23 through the four successful commands. The stale command made no change:

```text
Browser Reject: selected row 5 → 6, live run 15 → 17
Browser Undo:   selected row 6 → 7, live run 17 → 19
Session Reject: selected row 7 → 8, live run 19 → 21
Stale command:  selected row 8 → 8, live run 21 → 21
Session Undo:   selected row 8 → 9, live run 21 → 23
```

The first Reject/Undo checker incorrectly required the live run revision to stay constant. It reported an assertion error after both commands succeeded. The `reject-undo.errors` field preserves that result. `afterCleanup` is a read-only snapshot after the assertion; `cleanup` is null, and no cleanup API action ran. The embedded `reject-undo.validation` record applies the correct rule to the same before/after data: verdicts and identities were restored, while the selected row and live run revisions advanced. No extra mutation or product change was needed. The next checks used the corrected rule.

An initial read-only preflight timed out before the auth route was installed because the local helper first treated an ISO expiry value as a number. The helper was corrected, the route was installed, and preflight passed before any mutation.

## Visual evidence and limits

The local capture bundle is named `ariviso-deployed-mutation-evidence`. Media are retained outside the repository and await private PR attachment publication. The names below identify bundle members, not repository-relative links. The manifest records their byte counts and SHA-256 values.

| Artifact                | Caption                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `reject-undo.webm`      | Keyboard Reject saves a deployed review command; keyboard Undo restores approval and the original selection. |
| `rejected.png`          | The selected synthetic variant is rejected after the server confirms the command.                            |
| `undo-restored.png`     | Undo restores approval and confirms the restored selection and verdicts.                                     |
| `conflict.png`          | A stale command shows the current reviewer and a Refresh current state action.                               |
| `conflict-restored.png` | Both variants are approved after the second review session undoes its change.                                |
| `image-error.png`       | A failed candidate-image request disables review and offers Retry images.                                    |
| `image-recovered.png`   | Retry images restores the real image bytes and enables review.                                               |

The VP8 recording is 1440 × 1280 at 25 frames per second, with 1,081 frames over 43.24 seconds. The capture agent inspected every frame in 11 sequential contact sheets, full frames at 2, 12, and 42 seconds, and all six screenshots. The video shows the saved rejected state and ends with restored approval and the Undo confirmation. Action labels identify the interaction. The capture agent reported no credentials or private emails in these media. The documentation pass verified all source-bundle hashes; it did not repeat the deployed mutations or the visual inspection.

The dedicated browser session was closed and its disposable metadata removed. The shared credential file stayed unchanged. The capture agent scanned the retained evidence for the bearer value. Headers, session IDs, private emails, and image capability URLs are excluded from the saved receipts. No merge, recompare, baseline change, promotion change, or source edit was made during these checks. These observations supplement the [deployed read-only record](../deployed-review-readonly.md). They do not complete OAuth, multi-user testing, the full accessibility gate, or production readiness.
