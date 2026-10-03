# Ariakit adapter service pins

This configuration prepares the production service for Ariakit's CLI `0.5.4` and adapter `0.5.0` upgrade. Merge and deployment remain held for the parent operator to coordinate current callers. The candidate tuple below is not a deployment claim. The operator must record live service and repository-variable readbacks before the held consumer change is pushed.

[PR #220](https://github.com/ariakit/visonaut/pull/220) and Ariakit [PR #7718](https://github.com/ariakit/ariakit/pull/7718) completed the earlier issue #204 D07/W05 rollout. Its [completion record](../evidence/issue-204-completion.md) is historical evidence for the before tuple, not proof of this upgrade's deployment or current caller settlement.

## Matching trust tuple

The service trusts one App workflow blob and one executor digest. Keep these values together for `ariakit/ariakit`, repository ID `104133653`, and project `ariakit`.

| Value                     | Before tuple                                                       | Candidate after tuple                                              |
| ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| App workflow blob B       | `3858bc67dda6d70381c3ad189f85dd6266fc7942`                         | `202fd63a37199f5ac4350bd7c4e4bc44ea442216`                         |
| Native CI workflow blob C | `3dbaca30542ae9e84bbbba3f87cc29891bdf7856`                         | `4d34ca17315b19fa90083501eb347ea23d88dda9`                         |
| Adapter archive SHA256 D  | `e1194e2085c15c99eb88ae59b638aaa0462b94233bffb4676fe7a2a60075ea98` | `be4439ac7ce5eccea7b0d253687cae53b114884deed179d9dd17fd966b722e22` |

The candidate D is the verified registry archive for `@visonaut/playwright@0.5.0`, published by [Release run 37089521791](https://github.com/ariakit/visonaut/actions/runs/37089521791) from [Visonaut source `32eb7b6a`](https://github.com/ariakit/visonaut/commit/32eb7b6a5a492eb4284906f1b18d57333bef40d7). The prepared consumer changes the App archive digest and CLI version. It also changes the native CI no-visual CLI version, so both B and C change. Recompute B from the final raw App file with `git hash-object`; recheck C from the final raw CI file. Recheck the registry archive integrity, signatures, provenance, and SHA256 against D before live actions. A Git blob hash is not a commit SHA.

The App `reusableWorkflowRef` ends in `@B`, and `reusableWorkflowSha` equals B. The consumer repository variable `VISONAUT_WORKFLOW_SOURCE_SHA` must equal B. The prepared consumer uses CLI `0.5.4` and adapter `0.5.0`. It retains Playwright `1.63.0`, Node `24.18.0`, and signed Submit checkout [`c87988ef`](https://github.com/ariakit/visonaut/commit/c87988effdff42edf4934ded906aa32ee3c04b66). Preview configuration, job names, shards, partial reruns, and Gate keep their existing behavior.

## Calls that depend on the current pins

| Call or state                                                               | Pin dependency                                                                                                                       | Cutover effect                                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Begin and reserve                                                           | Current B and C authenticate the App job; reserve also checks the current B source digest.                                           | An old App job cannot start or reserve after B changes.                                                            |
| Manifest admission                                                          | Current D plus the stored run, job, attempt, and source digest.                                                                      | An old executor manifest cannot be admitted after D changes.                                                       |
| Reference reads, admitted image upload, image reuse, and shard finalization | Signed capability and stored run/job/attempt/source identities; existing expiry, retention, reference, and image checks still apply. | Existing credentials do not by themselves require B or D. They cannot bypass Submit or unfinished materialization. |
| Signed Submit, including Submit-only reruns                                 | Current B and C, current source digest/ref, job identity, and stored attempt evidence.                                               | An old staged attempt cannot submit after B changes. A repeated Submit still verifies the current source.          |
| New or unfinished materialization                                           | Current B, C Plan proof, D, final GitHub jobs, stored signed Submit, and complete manifests.                                         | A submitted old attempt still needs settlement before the pin change if it needs this path.                        |
| Sealed service run recovery through materialization                         | Current C Plan proof, stored run and receipt, and existing reference/publication checks.                                             | This path checks C before returning ahead of B/D reconciliation. Include old runs that still need this path.       |
| Native Plan report with `visualRequired: false`                             | Current C and native Plan job evidence, including pending completion and carried Plan recovery.                                      | Old C reports and recovery fail the current source check after C changes. Include relevant no-visual callers.      |

These rules come from [workflow admission](../../apps/web/src/api/workflow-owned.ts), [OIDC verification](../../packages/security/src/oidc.ts), [Plan checks](../../apps/web/src/api/pre-run.ts), [reconciliation](../../apps/web/src/api/workflow-reconcile.ts), and [materialization](../../apps/web/src/api/workflow-materialize.ts). Current digest admission remains exact:

```ts
digest === configuration.trustedExecutorDigest;
```

## Fixed caller cohort and rollout

At the approved cutover boundary, the parent operator coordinates a pause of new relevant old-source native CI attempts, including no-visual Plan calls. Save the boundary time and the exact eligible old caller cohort. Scope it to the configured repository/project and native CI workflow. Include running or queued visual-required callers that can still reach Begin or Submit, live old staged attempts that still need admission or materialization, sealed old runs that still need materialization recovery under C, eligible partial or Submit-only reruns that can carry old captures, and no-visual callers that still need a Plan report or completion under C. Inspect an unresolved Plan result before excluding its attempt. Record run ID, attempt, tested SHA, App/CI blobs, executor digest when available, GitHub job IDs/status, staged run ID, service sealing state, and its disposition.

Let each fixed cohort member complete under the before tuple, or record an explicit terminal or replacement disposition. A terminal GitHub workflow does not by itself prove that its submitted staged run has materialized or its no-visual check has completed. Check that submitted live staged evidence no longer needs current B/C/D validation. A sealed run can still need comparison or check publication; identify any recovery path that first checks current C. Read the current attempt and any newer attempt before accepting a disposition.

Do not gate on every GitHub job, every database row, or every OPERATIONS queue item. Unrelated jobs, retained terminal history, publication paths that do not check current C, reviews, Undo, exports, and retention work are outside this pin-dependent cohort. Do not reopen the settled PR205 authority-transfer cohort. A saved earlier census or a zero active-capture count is not proof that today's eligible attempts are settled. Recheck the fixed cohort and the admission boundary immediately before merging or switching pins; account for any new relevant attempt before proceeding.

After both patches and the cohort disposition are approved:

1. Recheck the final service and consumer snapshots, B/C/D, and signed Submit checkout. Complete local consumer validation and review; inspect current live consumer CI for the old caller cohort. Keep live adoption held while the consumer baseline comparison or review remains unresolved.
2. Complete or disposition the fixed old cohort under the before tuple, including current-C no-visual work. Preserve its signed evidence and normal recovery paths. The parent holds merge until this boundary is ready because a main push starts the deployment workflow.
3. The parent merges and deploys the reviewed production service source through the existing deployment workflow. Build with `CLOUDFLARE_ENV=production` and deploy its generated configuration. Read back the deployed source, full tuple, bindings, and serving traffic before continuing.
4. The parent sets and reads back the consumer repository variable B. Keep the consumer push held until the service and variable readbacks match the candidate tuple. Then publish the reviewed consumer change under its current-base and reviewed-push checks. Verify the actual workflow file blobs and archive digest again before resuming matching callers.
5. Verify a fresh complete consumer attempt through native Plan, normal captures, signed Submit, materialization, and Gate. Capture every shard under the new tuple; do not carry old-tuple captures into this attempt. Verify an intended no-visual caller under new C when that path runs. Preserve the existing partial-rerun validation for later attempts under the matching tuple. Record the exact run, attempt, tested SHA, job identities, and service receipt before calling this consumer adopted.

This sequence adds no alternate digest, source exception, queue subsystem, or launch flag. Local tests, a build, and a dry run do not prove live resources, cohort settlement, or adoption.

## Rollback

Keep the before B/C/D tuple, CLI `0.5.3`, adapter `0.4.1`, and source variable `3858bc67dda6d70381c3ad189f85dd6266fc7942` as one rollback set. The parent coordinates rollback under the session's merge/deploy authority after a fresh census of relevant attempts under the tuple being replaced, including no-visual Plan callers and recovery that depends on C. Restore the matching service tuple, consumer source variable, and reviewed consumer configuration through the normal workflows. Verify their readbacks and a fresh complete attempt. Do not combine pins from different tuples, rewrite signed receipts, or assume that partial attempts from either tuple can resume under the other. Worker code rollback does not roll back stored data or connected resources.
