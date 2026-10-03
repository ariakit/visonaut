# Issue #204 removal inventory

This is the W03 public summary for [issue #204](https://github.com/ariakit/visonaut/issues/204). Source was checked at the reviewed W01 commit [`4a4cefc`](https://github.com/ariakit/visonaut/commit/4a4cefcb23ad502c5534bc047b94630744e56b26), after current main [`3d575bd`](https://github.com/ariakit/visonaut/commit/3d575bd652ae29b12cb18155310cd8437a8ef826). Production and preview D1 reads ran on 2026-10-02, from approximately 19:37 through 20:07:44 UTC. Each result below has its own evidence time. The reads are not one atomic snapshot.

W03 is complete as an inventory with explicit holds. W06 can prepare stage A once W02 is ready. W06 stage B, W07, and W08 have not passed their removal gates. D14 remains a proposal. No conversion, cleanup, migration, restore, cloud-resource change, deployment, package release, or consumer edit was performed.

The existing authenticated Cloudflare dashboard supplied SELECT-only D1 reads and queue/deployment metadata. Both database UUIDs matched the [checked target inventory](simplification-inventory.json) and [web configuration](../../apps/web/wrangler.jsonc). The cutover runner was not used because it creates a provider proxy even for inspection. Raw target identifiers, queue IDs, exact SELECTs, dated results, query errors, and local logs are in the private W03 handoff receipt outside Git. This summary contains no object keys, actor IDs, account contact data, or private record payloads.

## Targets and evidence limits

| Environment | D1                                  | IMAGES / QUARANTINE bindings from source                        | Active web / compare version prefixes observed |
| ----------- | ----------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| Production  | `visonaut-production`; UUID matched | `visonaut-production-images` / `visonaut-production-quarantine` | `c42bcf84` / `c700ed51`                        |
| Preview     | `visonaut-preview`; UUID matched    | `visonaut-preview-images` / `visonaut-preview-quarantine`       | `6df134dd` / `1abcc345`                        |

Deployment prefixes were read from the four active-deployment rows by 20:07:44 UTC. Web rows showed 100% traffic. The preview comparator row showed conflicting `0%` and `100%` text; its traffic split is unverified. Full version IDs, deployed code commits, live binding parity, R2 object listings, and fresh original-byte hashes were not verified. A version prefix does not prove that deployed code equals the source under review. Preserve the dated [PR #205/#206 completion and #207 transfer-key retirement receipts](../simplification-implementation.md#current-handoff-checkpoint); a later active version does not undo those completed actions.

The checked source has CLI `visonaut@0.5.3`, adapter `@visonaut/playwright@0.4.0`, and the exact Playwright `1.63.0` peer. Its supported repository is `ariakit/ariakit`, repository ID `104133653`, project `ariakit`. Production pins native CI Git blob `3dbaca30542ae9e84bbbba3f87cc29891bdf7856`, App blob `ec8ba1563228164856c33c94f4fa96645448c730`, and executor digest `7e8c77bf386518619fd2a04a8b5a1509fa5a1db1c2a84827b26132672999d3a5`. These are source and completed-adoption facts. A fresh census of all supported clients, their installed package versions, and their ability to submit only the selected format remains unverified.

## D02: schema, conversion, and retained originals

| Check                                                   | Production           | Preview  | SQL evidence time, UTC                            |
| ------------------------------------------------------- | -------------------- | -------- | ------------------------------------------------- |
| Applied migration names                                 | All 29 current files | 26 files | Initial schema reads, approximately 19:37 / 19:54 |
| Missing inspected table/column pairs                    | 0                    | 0        | Initial schema reads; not full schema parity      |
| Required protected snapshots                            | 0                    | 0        | 19:39:49 / 19:54:57                               |
| All protected snapshots, including unrequired history   | 10                   | 0        | 19:39:49 / 19:54:57                               |
| Unconverted closed runs past 30-day retention           | 0                    | 0        | 19:39:49 / 19:54:57                               |
| Unresolved `baseline-conversion` or `history` events    | 0                    | 0        | 19:39:49 / 19:54:57                               |
| Building closed summaries / conversion pages            | 0 / 0                | 0 / 0    | 19:39:49 / 19:54:57                               |
| Required snapshot image entries                         | 50,214               | 0        | 19:39:49 / 19:54:57                               |
| Source owners with absent/non-live retained-run records | 0                    | 0        | 19:39:49 / 19:54:57                               |
| Unconsumed baseline restoration receipts                | 0                    | 0        | 19:39:49 / 19:54:57                               |
| Foreign-key violations                                  | 0                    | 0        | 19:45:20 / 20:02:54                               |

A required snapshot is reference eligible or has a snapshot pin. The 10 unrequired protected snapshots are retained history. Their existence does not authorize deletion. The closed-run check uses `active=0`, `closed_at <= now - 2592000000`, and no ready closed summary. It does not prove every archive page or summary payload is valid.

Preview lacks `0029_zero_pixel_reviews.sql`, `0030_local_zero_pixel_reviews.sql`, and `0030_review_queue_index.sql`. This is a hold on full migration readiness even though the inspected columns exist. Prepare any required migration application as a separate exact-target action. Keep every numbered file, including both `0030_*` files; do not rename, rerun, or broaden the corrective migration as cleanup.

The first all-required-source query counted 2,246 entries with an unsettled copy flag and two owners without a `baseline` reason. A state-specific read at 19:43:22 UTC separated one current `source`/`copying` promotion from 22 accepted required source snapshots. Its copy count progressed during the read sequence. The accepted snapshots had 46,568 entries with no pointer mismatch, unset copy flag, missing image row, or metadata byte absence. The accepted-only owner check at 19:46:17 UTC found zero baseline-owner pin gaps. Preview had zero accepted required source snapshots and zero gaps at 20:03:17 UTC.

This distinction follows normal [source promotion](../../packages/service/src/service.ts): a new snapshot starts in `copying`, entries start with `copied=0`, and its work pin uses `reason='promotion'`. Acceptance changes that reason to `baseline`. Keep this current promotion path. Its transient counts are not proof of a conversion or pin defect. Database flags and matching keys still do not verify R2 bytes or hashes.

The profile check used active-run captures plus captures in required snapshots. At 19:44:16 UTC, production had 10,639 distinct required profile IDs, no missing dictionary rows, and 3,603 rows with `rendering_digest IS NULL`. It found no missing cutover marker among non-null mappings and no active comparison tuple using an older mapped digest. Preview had no required profiles at 19:59:52 UTC. Full profile JSON validation, digest recomputation, approval eligibility, and classification of the null mappings remain unverified. Null mappings are not permission to rewrite retained tuples.

Production retained 18,006 comparison rows and 5,698 decisions with `original_tuple_json`; ready closed summaries had no row/decision count mismatch. Those counts establish preserved fields, not full payload integrity. Keep [rendering conversion and tuple compatibility](../../packages/service/src/service.ts), [compact history creation](../../apps/web/src/operations/closed-summary.ts), [history readers](../../apps/web/src/operations/history.ts), [format verification](../../apps/web/src/operations/history-format.ts), and [comparison supplements](../../apps/web/src/operations/history-supplement.ts) while their retained records need them.

W07 remains held by preview migration readiness and unverified required original bytes, profile/approval coverage, and archive payload integrity. Its dependencies also include W06. Preserve ordinary source promotion, history creation, recovery, and retention. The passing aggregate checks above do not approve removal of every converter or reader.

## D03: active runs, tasks, and delayed delivery

At 19:41:48 UTC, production had 21 active runs. The runtime discriminator below, from [review](../../apps/web/src/api/review.ts) and [sealed materialization recovery](../../apps/web/src/api/workflow-materialize.ts), distinguishes local Submit. Capture rows or native manifest versions alone do not make a run a legacy server comparison.

```sql
EXISTS (
  SELECT 1 FROM visonaut_captures capture
  WHERE capture.run_id = run.id
    AND json_extract(capture.metadata_json, '$.localMode') = 'local-v1'
)
```

A second query joined `run.comparison_id` to the current comparison and tested the immutable row tuple's `comparisonEngineVersion`. At 19:47:14 UTC it classified the runs as follows:

| Runs | Runtime local marker | Current comparison             | Current tuple engine             |
| ---- | -------------------- | ------------------------------ | -------------------------------- |
| 16   | Absent               | `review` / `invalidated`       | `rgba-visible-1`                 |
| 1    | Absent               | `review` / `invalidated`       | Neither inspected engine present |
| 1    | No captures yet      | No comparison; run `uploading` | None                             |
| 3    | Present              | `review` / `ready`             | `playwright-pixelmatch-1.63.0`   |

The 17 runs without the local marker are invalidated records. They are not 17 current executable comparison tasks. Preserve their result identity and give old URLs an explicit terminal state or a fresh-capture instruction. The unclassified tuple does not become a local receipt by default. Keep local engine `playwright-pixelmatch-1.63.0` / codec `pngjs-7.0.0` distinct from legacy engine `rgba-visible-1` / codec `jsquash-png-3.1.1-webp-1.5.0` in retained evidence.

| D1 comparison-work check                                                               | Production | Preview   | SQL evidence time, UTC |
| -------------------------------------------------------------------------------------- | ---------- | --------- | ---------------------- |
| Queued / leased compare tasks                                                          | 0 / 0      | 0 / 0     | 19:41:48 / 20:01:51    |
| Delayed queued / expired leased / retryable tasks                                      | 0 / 0 / 0  | 0 / 0 / 0 | 19:41:48 / 20:01:51    |
| Outstanding published work / replayable dead-letter receipts in queued or leased state | 0 / 0      | 0 / 0     | 19:41:48 / 20:01:51    |
| Current required compare tasks / historical comparisons still comparing                | 0 / 0      | 0 / 0     | 19:41:48 / 20:01:51    |
| Terminal `dead` compare tasks                                                          | 596        | 0         | 19:41:48 / 20:01:51    |
| Unresolved publication / finalization / task events                                    | 0 / 0 / 0  | 0 / 0 / 0 | 20:06:48 / 20:07:44    |
| Unresolved staged-reconciliation events                                                | 2          | 0         | 20:06:48 / 20:07:44    |

The task detail read at 19:47:33 UTC found 4,716 complete linked-row tasks, 1,058 complete tasks without a row, and 596 dead tasks without a row. The dead tasks had exhausted attempts and no dead-letter publication receipt. Complete tasks remain terminal even when their attempt counter is below its maximum. Missing archived row links are not automatically recoverable work. These D1 facts do not settle provider messages, manual replay, or all retained-reader obligations.

An initial broad query counted two recent incomplete stages. The refined [runtime recovery eligibility](../../apps/web/src/api/workflow-materialize.ts) found zero eligible stages at 19:49:28 UTC in production and 20:03:38 UTC in preview. It retained the configured repository/project, 24-hour stage window, restore cutoff, run state, failed-unmaterialized-check exclusion, newer sealed attempt exclusion, and one-hour retry delay after five failures. Its empty-set `SUM` fields returned null. The two unresolved events still need classification before removal; the zero eligibility count does not dispose of their retained evidence. Keep the active sealed local Submit recovery path and its six-hour materialization lease.

The dashboard listed comparison, comparison-dead-letter, operations, and operations-dead-letter queues in each environment. Production's comparison queue had consumer `visonaut-compare`, delivery delay zero, and message retention 345,600 seconds, or four days. Its Last 24 hours Average Backlog view displayed zero backlog, delayed backlog, and lag. This limited chart view is not a full delivery/replay receipt. Other queue retention windows and delayed/dead-letter inventories remain unverified. The [compare configuration](../../apps/compare/wrangler.jsonc) still specifies retries and dead-letter routing.

W08 remains held by the supported-client census, complete delayed/replayable work evidence, retained-reader obligations, and W05-W07. Stop new legacy admissions only after compatible clients are available. Drain the exact old-work cohort before consumer retirement; do not demand an empty OPERATIONS queue. Keep durable review commands, their leases/retries/readiness guard, image validation fetch, codecs and capacity bounds, sealed recovery, and required immutable historical readers. The completed old-caller cohort from PR #205 is separate and remains settled.

## D06: export drain and W06 readiness

| Export check                                   | Production | Preview | SQL evidence time, UTC |
| ---------------------------------------------- | ---------- | ------- | ---------------------- |
| Building / ready and unexpired                 | 0 / 1      | 0 / 0   | 19:40:49 / 19:59:28    |
| Active download leases                         | 0          | 0       | 19:40:49 / 19:59:28    |
| Cleanup candidates under the current predicate | 0          | 0       | 19:40:49 / 19:59:28    |
| Export-owned retained-run / snapshot pins      | 1 / 1      | 0 / 0   | 19:40:49 / 19:59:28    |
| Orphan export-owned run / snapshot pins        | 0 / 0      | 0 / 0   | 19:40:49 / 19:59:28    |
| Export records / created in the past 30 days   | 8 / 8      | 0 / 0   | 19:40:49 / 19:59:28    |

The private receipt contains exact latest expiry and lease times. Eight creation records prove observed use; download frequency is unknown. No product download was requested: a successful GET renews `active_until` and would change live state. No private pages or objects were copied in this inventory, and preservation of required private export evidence remains unverified.

W06 stage A can prepare rejection of all new closed-run comparisons and new exports after W02. It must keep active local review, explicit terminal history, and existing export downloads. Retain [batched page reads at the inventory source](https://github.com/ariakit/visonaut/blob/7715b742da7d0970fe005e04995e3e049aeabf50/apps/web/src/operations/export-pages.ts), checksum and original verification, completion/truncation rules, the 24-hour export expiry, one-hour download lease, renewal, bounded private-page cleanup, and owner-specific pin release in [exports at the inventory source](https://github.com/ariakit/visonaut/blob/7715b742da7d0970fe005e04995e3e049aeabf50/apps/web/src/operations/exports.ts). Do not add a replacement report feature.

The exact source cleanup condition, with `now` bound in milliseconds, is:

```sql
expires_at <= :now AND COALESCE(active_until, 0) <= :now
AND (
  state != 'expired'
  OR EXISTS (
    SELECT 1 FROM work_retention_pins
    WHERE owner = 'export:' || operations_exports.id
  )
)
```

Stage B remains held by the unexpired production export, its owned pins, required private-evidence preservation, and a later drain readback after stage A reaches its target. A zero lease count at one instant is not sufficient. Existing cleanup must finish bounded deletion of its private pages before releasing only its own pins. Keep download and cleanup code until these gates pass in both environments.

## D14: retired-table proposal

The live counts below were read at 19:42:45 UTC in production and 20:02:11 UTC in preview. All backup sets were complete, all groups were ready, and backup/group/object active leases were zero.

| Exact table                     | Production rows | Preview rows | Declared foreign keys                                                         |
| ------------------------------- | --------------- | ------------ | ----------------------------------------------------------------------------- |
| `operations_backups`            | 12              | 14           | None                                                                          |
| `operations_backup_pages`       | 0               | 0            | `backup_id → operations_backups.id`                                           |
| `operations_backup_required`    | 0               | 0            | `backup_id → operations_backups.id`                                           |
| `operations_backup_inventory`   | 0               | 0            | `backup_id → operations_backups.id`                                           |
| `operations_backup_objects`     | 0               | 0            | None                                                                          |
| `operations_backup_groups`      | 260             | 0            | None                                                                          |
| `operations_backup_group_pages` | 0               | 0            | `group_id → operations_backup_groups.id`                                      |
| `operations_backup_members`     | 0               | 0            | `backup_id → operations_backups.id`; `group_id → operations_backup_groups.id` |
| `transfer_key_redemptions`      | 151             | 0            | None                                                                          |

Live `sqlite_master` definitions and the fresh all-migrations local schema agreed on these six edges. The dashboard rejected `pragma_foreign_key_list` with `SQLITE_AUTH`; its failed result was not treated as zero. Production's other named table/view/trigger references were zero at 19:50:27 UTC. Both environments had no named retired-table view/trigger readers in the accepted-source query. Preview's inbound table-definition scan was not performed; generic or external readers remain a separate requirement.

No current application/package runtime source names these nine tables. Applied migrations, schema-parity fixtures, and the [frozen backup-v2 harness](../../apps/web/tooling/backup-v2-recorded/README.md) still contain the historical schema. [Native recovery](../../apps/web/src/operations/recovery.ts) inspects schema generically; native database recovery retains applied data unless the isolated sanitation procedure has an explicit current-purpose action. Retired table name absence does not prove that recovery, external SQL, audit, or private metadata preservation no longer needs the records.

The [2026-09-29 inventory](simplification-inventory.json) and [operations guide](../../apps/web/src/operations/README.md#conversion-before-deployment) record private SHA-256 metadata exports before backup-source retirement. The matching current row totals do not reverify those files, their access, retention ownership, or recovery usefulness. Missing backup image objects are not recreated by metadata exports. The transfer key and executable transfer path are already retired; the 151 redemption records have a separate data-retention obligation.

A future proposal targets only the nine exact tables above in the verified preview and production databases. First identify retention owners and required audit/recovery uses, reverify the existing private preservation receipts, preserve any newly required records through an authorized path, and prove no remaining reader needs the schema. After D02 gates pass, test any separately selected forward migration on a fresh database and an isolated retained-data copy. Child-before-parent dependency order is group pages and members, backup pages/required/inventory, then groups and backups; objects and transfer redemptions have no declared FK order. Absence of an FK does not remove their semantic preservation obligations. D14 selects no destructive migration, deletion SQL, object deletion, or shorter retention in this patch. Keep all applied migration files.

## Checks and handoff

A locked install used Node `24.18.0` and pnpm `12.5.1`. Eight existing test files passed, with 64 tests: all-numbered-migration parity in SQLite and native D1, isolated SQLite snapshot rewind and recovery fencing, history, history formats, exports, local capture history, native streams, and snapshot retention. A separate fresh SQLite read applied all 29 migrations at 20:02:37 UTC, created 73 tables, found the nine retired tables and six FK edges, returned no foreign-key violations, and returned `integrity_check='ok'`. No new tests or runtime code were added.

Representative repeatable local checks are:

```sh
pnpm test apps/web/src/operations/test-migrations.test.ts apps/web/src/operations/recovery.test.ts
pnpm test apps/web/src/operations/history.test.ts apps/web/src/operations/history-format.test.ts apps/web/src/operations/export-history.test.ts apps/web/src/operations/local-capture-history.test.ts
pnpm test apps/web/src/operations/native-stream.test.ts apps/web/src/operations/snapshot-retention.test.ts
```

The private receipt records exact SELECT statements and errors. The initial oversized UNION failed with `SQLITE_ERROR`; successful bounded scalar queries replaced it. The initial event subset omitted finalization/task kinds; the complete later query above supersedes it. No failed query or absent result became zero. Required original-byte/hash and full profile validation remain open. Hosted Time Travel is optional and **UNVERIFIED** under the existing O19 decision; these local checks do not add a hosted rehearsal gate or reopen waived cutover probes.

Use this receipt to prepare the selected code stages. Refresh relevant live facts before a later removal or external action. Keep unknown facts, required data, and their readers until their exact gates pass.
