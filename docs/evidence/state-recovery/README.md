# Frozen E03 hosted state result

A [final-source hosted replay](./final-source-20260923.md) passed the same seven state suites on September 23 against the final production-source tree, with independent D1 and R2 readback. It does not exercise the production sender.

The seven bounded state scenarios passed on September 22, 2026. This is partial E03 evidence. It does not complete the launch gate. The [raw hosted report](../../../tooling/evidence/state-recovery/results/hosted-report.json) records the complete result. The source is frozen at Git tree `8a40dceb1831e14da4d7fe2b6b4e4cf893ab081f`; later product changes need their own source mapping or new run.

| Scenario                                               | Result | Recorded assertions | Worker wall seconds | Attempted D1 statements | Evidence                                                                                    |
| ------------------------------------------------------ | ------ | ------------------: | ------------------: | ----------------------: | ------------------------------------------------------------------------------------------- |
| Atomic whole-item command, replay, and Undo            | Pass   |                   7 |              58.292 |                     650 | [Receipt](../../../tooling/evidence/state-recovery/results/hosted-atomicCommands.json)      |
| Current and stale D22/D26 commands                     | Pass   |                   6 |              49.712 |                     729 | [Receipt](../../../tooling/evidence/state-recovery/results/hosted-currentAndStaleUndo.json) |
| Protected automatic history and mixed rollback         | Pass   |                  14 |              62.410 |                     743 | [Receipt](../../../tooling/evidence/state-recovery/results/hosted-rollbackHistory.json)     |
| Exact source acceptance and queued-status invalidation | Pass   |                  16 |              46.156 |                     719 | [Receipt](../../../tooling/evidence/state-recovery/results/hosted-acceptanceStatus.json)    |
| Protected removal and exact restoration                | Pass   |                   9 |              60.939 |                     759 | [Receipt](../../../tooling/evidence/state-recovery/results/hosted-restoration.json)         |
| Retained-byte GC, promotion, and rollback pins         | Pass   |                  16 |               7.569 |                      20 | [Receipt](../../../tooling/evidence/state-recovery/results/hosted-retentionRaces.json)      |
| Delayed status and ambiguous sender settlement         | Pass   |                  79 |              12.865 |                     124 | [Receipt](../../../tooling/evidence/state-recovery/results/hosted-statusScenarios.json)     |

The 147 recorded assertions are in addition to internal fixture and conflict guards. The time column measures each whole fixture request, including setup, R2 copies, review sequences, and complete database-state verification. It is not a product review-command latency or a throughput benchmark. The largest request attempted 759 D1 statements plus two receipt operations, below the documented 1,000-query limit.

## Exact source and deployment

- Run window: 14:02:13.092 to 14:07:15.433 UTC (302.341 seconds).
- Worker: `ariviso-e03-state-20260922`, version `5073224a-6204-461a-b768-178ec22339f6`.
- D1: `ariviso-e03-state-20260922`, ID `05c51b8e-ac9b-4586-b93e-bc9c10e9ecd9`.
- Private Standard R2 bucket: `ariviso-e03-state-20260922-images`.
- Account: `b04f3af3f0f10a6b9481bc23ba974eca`.
- Worker SHA-256: `675edc6b735823821ee7893fa5fb99d34be35b23b875b3dd3c50b49a902b3e13`.
- Fixture-source digest: `68caa8ef121bf829eb876cd8579bcd5ce403cfd2027fc1e70a1c6dda1558f679`.

The controller checked the remote source manifest, fixture digest, and Worker version before each run set. It checked the local artifact hashes before it sent a request. The Worker accepted only protected fixed scenario routes. Missing and wrong bearer credentials returned 401. Each repeated prefix returned 409 before scenario work. The controller reread each stored receipt and compared it with the response.

The [complete frozen harness](../../../tooling/evidence/state-recovery/frozen-harness.tar.gz) preserves all 62 original files byte-for-byte. Inside that archive, `source-manifest.json` binds production files to the frozen Git tree; `results/build-manifest.json` binds fixture files and the deployed bundle; `frozen-source.tar.gz` and `recorded-worker.js.gz` preserve runtime inputs. The [deployment record](../../../tooling/evidence/state-recovery/results/deployment.json) is also available as a readable extract.

## Native storage observations

The scenario meters recorded 1,825 D1 calls, 3,744 attempted statements, 3,689 successful returned statements, 11,918 rows read, and 3,525 rows written. Returned native D1 metadata reported 650.6985 milliseconds of SQL duration. These counters omit failed-batch internal metadata, schema setup, probe receipt writes, final verification, and export. They are not total billable usage or Worker CPU time.

The R2 fixture meter recorded 36 puts, 70 gets, one delete, and 2,520 encoded bytes written. Each PNG was 70 bytes. Original and protected-copy reads checked SHA-256. The meter excludes HEAD and control-plane operations.

The [final D1 verification](../../../tooling/evidence/state-recovery/results/hosted-database-verification.json) found no foreign-key errors. It confirmed seven passing receipts at the stated source and Worker version, 21 original image records, 12 snapshot image records, 12 command records, and 66 audit records. The retention fixture deliberately ends with one deleted and two claimed/deleting synthetic runs. These rows are test end states, not unattended production work. The remaining rows and objects belong only to this disposable probe.

The [native SQL export](../../../tooling/evidence/state-recovery/results/hosted-database.sql.gz) contains 341,711 bytes. It contains synthetic data and safe receipts. The saved export log replaces its temporary signed download URL with a redaction marker. No installation token or probe bearer value is in the database or evidence files.

## Boundaries and separate live transport

The probe uses synthetic maintainer identities, trusted run metadata, plans, and lineage proofs. It verifies native D1 operations and R2 bytes. PNG decode is a fixture: after a stored-byte hash check, the exact comparator receives the known one-pixel RGBA value. This is not OAuth, OIDC, App webhook, full GitHub failed-job inheritance, or the Ariakit capture matrix evidence.

The hosted status tests use recorded sender callbacks. Their clocks and pauses are explicit injections. They establish native status freshness and lease behavior, not actual outbound GitHub request races.

A separate custom-check adapter passed 48 assertions with native local D1 and a strict HTTP mock: one simulated POST, five simulated PATCH calls, and eight simulated GET calls. [Eight negative boundary cases](../../../tooling/evidence/state-recovery/results/github-status-negative.json) also passed. The archived `run-github-local-state.mjs` controller passed its own native local mock run. Its intended live boundary is local native D1 plus genuine GitHub HTTPS, separate from the hosted state result. It does not exercise the production `sendGitHubCheck` sender.

Automatic approval review initially rejected both proposed live paths before process execution: uploading the installation token to the Worker, and using it directly from local Node. Those rejected commands did not read, copy, upload, or use the token payload and made no GitHub requests. The root task then supplied the original user authorization for App Checks writes and public synthetic fixtures in the diagnostic repository, plus the exact safeguards. Automatic review approved the same local controller command. The hosted credential upload was not retried. The [approval record](../../../tooling/evidence/state-recovery/results/approval-blocks.json) preserves the rejected attempts and their resolution.

The [live transport receipt](../../../tooling/evidence/state-recovery/results/live-github-local-state.json) passed 48 assertions from 14:13:39.544 to 14:13:48.511 UTC. It used local native Miniflare D1 with genuine GitHub HTTPS from Node. It created only [non-required custom check 106782938500](https://github.com/ariakit/ariviso-diagnostics/runs/106782938500), named “Ariviso status race fixture,” on the fixed diagnostic commit. The exact request count was one POST, five PATCH calls, and eight GET calls. No existing required check was changed.

The live probe proved three bounded conditions. An obsolete success made no PATCH after a remote metadata GET and an injected revision change. A completed HTTP 200 response, withheld from the sender callback, blocked later claims until the callback settled. An injected callback exception after a verified PATCH 200 retained the ambiguous lock until explicit settlement from that saved response receipt. Final GitHub state was failure with the revision-six marker. Native desired and delivered revisions were both six, with no lease, ambiguity, or started-request flag. At most one HTTP request and one sender callback were active.

The delays and response loss were injected after known transport events. The test does not claim an actual GitHub network failure. It uses the exact work-state functions and a restricted diagnostic sender. It does not exercise production `sendGitHubCheck`, and it is not a combined hosted-D1/actual-sender result. The installation token stayed in the local process. Token revocation returned HTTP 204 at 14:13:48.509 UTC, and the protected local token file was removed.

## Scope and cleanup

Only the new Worker, D1 database, and private R2 bucket were created. No production, preview, regular diagnostic, or v3 drill resource was changed. No cron, queue, or external notification was configured. GitHub credentials were not deployed.

The planning allowance was USD 6, including shared-account R2 unit rounding. This is not a measured invoice. The actual fixture work was below the planned 100-request, 1-million-read, 100,000-write, and 1-MiB-object ceilings. Current rates and the unit-rounding qualification are in the [harness instructions](../../../tooling/evidence/state-recovery/README.md).

The evidence has been preserved. The three isolated resources remain available for root inspection and cleanup, with a target lifetime below 24 hours. Cleanup must name these exact resources and leave all other resources unchanged. The protected probe bearer remains only in its local secrets file and Worker secret.

## Offline replay

Run `python3 tooling/evidence/state-recovery/prepare-replay.py --workspace "$PWD"` from a workspace with the pinned dependencies installed. It creates a new temporary copy and prints the local runner commands. The complete 62-file frozen harness archive preserves the original bytes even if readable extracts are formatted. This replay does not need Git tree `8a40dceb1831e14da4d7fe2b6b4e4cf893ab081f` to remain reachable. See the [replay instructions](../../../tooling/evidence/state-recovery/README.md#local-replay).

The [offline replay receipt](../../../tooling/evidence/state-recovery/results/offline-replay.json) records eight passing native local suites and the separate 48-assertion strict HTTP mock controller. Both printed commands returned exit code zero. The [native log](../../../tooling/evidence/state-recovery/results/offline-replay-native.log) and [controller log](../../../tooling/evidence/state-recovery/results/offline-replay-controller.log) preserve the actual replay output. These are local replay results, with no hosted or live GitHub writes.
