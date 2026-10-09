# Deployed capability rejection evidence

Origin: [diagnostic environment](https://ariviso-diagnostics.ariakit.workers.dev)
Target run: 7f114089-e7e9-41be-bb3a-977d5fa88eec
Probe window: 2026-09-22T11:25:45.922Z to 2026-09-22T11:25:52.091Z

These are locally minted diagnostic test capabilities from the public `issueIngestCapability` helper. They are not capabilities issued by a real GitHub OIDC reservation. The normal token lifetime was 90 seconds; the expired fixture was issued for 1 second and verified expired locally before its request. No token value or response body was logged or persisted.

| Case                                    | HTTP | Error code         |
| --------------------------------------- | ---- | ------------------ |
| expired-capability                      | 401  | invalid_capability |
| tampered-signature                      | 401  | invalid_capability |
| wrong-run-route                         | 403  | wrong_run          |
| wrong-shard-finalize                    | 403  | wrong_shard        |
| wrong-environment                       | 401  | invalid_capability |
| capability-cannot-read-status           | 401  | sign_in_required   |
| capability-cannot-list-private-runs     | 401  | sign_in_required   |
| capability-cannot-read-review           | 401  | sign_in_required   |
| capability-cannot-create-review-session | 401  | sign_in_required   |
| capability-cannot-approve               | 401  | sign_in_required   |
| capability-cannot-recompare             | 401  | sign_in_required   |
| capability-cannot-export                | 401  | sign_in_required   |

Every response included a no-store cache policy. The code guard order was inspected before execution. Expired, tampered, and wrong-environment credentials fail signature/claims verification. The wrong-run request fails route binding before state validation. Wrong-shard finalize fails before manifest lookup and UPDATE. Private reads and writes fail the live Better Auth session boundary before CSRF or action processing.

Before and after snapshots have identical canonical SHA-256 digests for the project baseline/promotion, target run, shards, manifests, uploads, captures, comparisons and rows, commands, decisions, promotions, and global run/image/review-session/auth-session counts. Each snapshot used 12 read-only queries and reported 0 rows written. Full per-scope hashes and row counts are in the JSON receipt. This proves unchanged covered state, not an assertion that no Worker log or unrelated cron record was written.

No image bytes or upload tickets were sent. No authentication session was revoked, no resource setting changed, and no source file was edited. There is no public promotion route. The real approval-command route refused the capability, and promotion/baseline state stayed unchanged. Cross-origin cookie/CSRF behavior was outside this probe; valid Origin headers prevented it from masking the session guard.

Root separately redelivered a genuine GitHub ping during the wider task. Webhook receipt state is excluded from this capability mutation proof.

The [sanitized JSON receipt](./deployed-capability-boundaries.json) preserves response codes and before/after state hashes. The probe script stayed local because it reads the diagnostic signing credential; no secret material is part of this record.
