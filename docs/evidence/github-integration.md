# E06: Hosted GitHub integration

This record covers the public synthetic diagnostic repository. It does not establish Ariakit cutover readiness. The production required visual check remains unchanged.

## First complete diagnostic main run

On September 22, 2026, [workflow run 35711882889](https://github.com/ariakit/ariviso-diagnostics/actions/runs/35711882889) captured and uploaded both fixed Chromium shards. Both jobs used the immutable reusable workflow at [`dcf4278`](https://github.com/ariakit/ariviso-diagnostics/commit/dcf42788b6c284a1affb4d2df65954672b04bae0). The tested main revision was [`24f508c`](https://github.com/ariakit/ariviso-diagnostics/commit/24f508cc65c91867d747a8046d4aef6348418ced).

The jobs completed real GitHub OIDC authorization, constrained scenario retrieval, capture, manifest-bound uploads, and independent artifact receipts. The service later verified successful jobs and complete shard evidence, sealed the run, accepted the initial additions, and promoted their protected snapshot. The diagnostic project reached baseline revision 1. No manual database state change supplied the run's accepted outcome or its baseline pointer.

The Ariviso App created check `106695088379` on that exact tested revision. The check completed with success. Its output contained only the fixed pass title, generic sign-in summary, and review URL; it had no annotations, screenshots, capture labels, or reviewer details. See the [workflow record](./github/diagnostic-main-capture.json), [service state](./github/diagnostic-main-state.json), and [App check](./github/diagnostic-main-check.json).

This run used reviewed, checksum-verified private bootstrap tarballs. The packages were not yet published to npm. An earlier run stopped before upload because the CLI's ordinary text limit rejected the larger GitHub runner credential. The corrected CLI uses a separate bounded credential validator. Native client tests cover a valid larger credential, invalid controls, and an oversized credential. The successful hosted run above supplies the real runner evidence.

## Public image and private metadata boundary

[Anonymous HTTP probes](./github/public-image-boundary.json) retrieved both real validated PNG originals without cookies. Their bodies matched their digest ETags and declared lengths. They returned `image/png`, `nosniff`, immutable public caching, and no session cookie. Private run and operation endpoints returned `401` with `no-store, private`. An arbitrary history path and an unknown image ID returned `404` with `no-store`.

These probes add positive validated-image and real OIDC-upload evidence to the earlier [authentication record](./authentication.md). The separate [deployed capability probes](./deployed-capability-boundaries.md) provide cross-shard and expired-token refusal evidence using locally minted test credentials.

## Private export

The private API created and downloaded a 34,304-byte tar archive for the accepted diagnostic run. Both original PNGs, both shard manifests, and the trusted plan matched the checksums in its completion record. The two full exported capture profiles matched their canonical profile digests. The metadata included decisions, provenance, comparison rows, and snapshot records. The [sanitized verification record](./github/diagnostic-private-export.json) contains counts and hashes; the export itself remains private.

This probe used a temporary synthetic diagnostic session with a live GitHub repository-permission check. It establishes the private export path, not an additional OAuth login. The diagnostic callback still requires registration.

## Changed-image PR review

[Diagnostic PR #7](https://github.com/ariakit/ariviso-diagnostics/pull/7) changed both synthetic images. [Workflow attempt 3](https://github.com/ariakit/ariviso-diagnostics/actions/runs/35713469611/attempts/3) completed both shards after a recovered Playwright test retry. The service used the final successful captures and reached review readiness with two changed variants.

The deployed private API saved a rejection, restored the prior unreviewed state through Undo, saved an approval, and restored that prior state through Undo. Exact command replays returned the original command IDs. Approving both variants then moved the run to `passed`. The [command record](./github/diagnostic-pr-review.json) includes every state and revision. The App-owned check on the tested merge commit reported failure after rejection; the same App-owned check later reported success after both variants were approved.

Anonymous GET and HEAD requests also retrieved both references, candidates, masks, and thumbnails. All eight responses were public, cookieless, and length-consistent; originals and masks matched their declared digests. The [derived-image record](./github/diagnostic-derived-images.json) records hashes and deployment identity. This exposed and fixed two API boundary defects: promotion IDs are opaque strings, and derived-image IDs are SHA-256 digests rather than UUIDs.

The [deployed browser checks](./deployed-review-readonly.md) also loaded the real run, displayed its originals and pixel differences, and verified keyboard focus and Fit/100%/200% image sizes without changing a decision.

These review probes used temporary D1-seeded diagnostic sessions with live GitHub repository-permission checks. They prove deployed API persistence and current-session Undo, not OAuth login or browser interaction. The separate local browser recording uses simulated API responses.

## Hosted authentication refusal

[Run 35720575311](https://github.com/ariakit/ariviso-diagnostics/actions/runs/35720575311) exercised the deployed endpoint from a reviewed, disposable GitHub workflow branch. A missing bearer returned `401 credential_required`; a real GitHub token with the wrong audience returned `401 invalid_oidc`; a job outside the trusted reusable workflow returned `403 untrusted_run`. The [sanitized receipt](./github/diagnostic-oidc-negative.json) records all five cases and the private database check showing zero run records for that workflow.

The changed-repository and spoofed-SHA cases also used the untrusted workflow job, so they prove that earlier workflow boundary, not independent evaluation of the later repository or SHA checks. The disposable branch must never merge because it temporarily replaces the capture entry workflow for dispatch. Its execution did not change main, the service's trusted plan, or any required check.

The first real merge-group capture correctly refused uploads with `409 missing_merge_group`: the App webhook is inactive, and no signed merge-group metadata reached the service. Both synthetic PRs were removed from the queue without merging. The diagnostic ruleset retains the required `Ariviso` check bound to App ID `5028451`, in addition to the fixture check. No synthetic metadata was inserted and no security check was bypassed. Successful merge-group evidence remains open until actual webhook delivery is enabled.

The [deployed capability probes](./deployed-capability-boundaries.md) separately rejected expired, tampered, wrong-environment, wrong-run, and wrong-shard test credentials at their intended guards. A valid write capability could not read private data, create a review session, approve, recompare, or export. Before/after state hashes matched. Those capabilities were locally minted test fixtures, not additional CI-issued credentials.

## Genuine signed App ping

GitHub's existing App ping was manually redelivered to the diagnostic receiver on September 22, 2026. GitHub recorded HTTP `202`, and D1 recorded the same delivery UUID as processed. The [delivery receipt](./github/diagnostic-app-ping.json) proves transport and signature processing of a genuine GitHub App event without a fabricated payload.

The App's automatic webhook activation is still pending the settings access check. This manual ping does not prove merge-group delivery, installation revocation, or OAuth revocation. Those launch checks remain open.

## Remaining launch evidence

Successful failed-job inheritance, merge-group checks, stale status refusal, the full Ariakit capture cycle, and controlled required-check cutover remain open. The App webhook is still inactive pending the GitHub settings access check. Scheduled reconciliation completed these runs without a webhook. The diagnostic OAuth callback also needs registration; the preview OAuth login evidence does not establish diagnostic login.
