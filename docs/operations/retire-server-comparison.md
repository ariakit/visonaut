# Retire server comparison in stages

[Issue #204 W08](https://github.com/ariakit/visonaut/issues/204#w08) selects trusted local Submit as the normal path. Preparation does not prove live rollout readiness. Keep the two source stages separate. Deploy each stage only after its own evidence passes. The admission fence can precede W06 export drain and W07 conversion cleanup when supported trusted local Submit is verified and all admitted-work handlers and readers remain in place. Final handler removal follows W06, W07, and verified W05 coverage.

## Stage A: stop new admissions

`POST /v1/runs` requires `comparisonMode: "local-v1"`. An omitted mode returns HTTP 409 with `local_comparison_required` and an upgrade and recapture instruction. An unknown mode returns HTTP 400 with `comparison_mode`. The request fails before GitHub work, staging, or capability issuance.

```ts
{ ...reservation, comparisonMode: "local-v1" }
```

Use a compatible trusted CLI and a new complete capture. Adding the field alone does not supply a verified receipt. Reference binding, the complete inventory, signed Submit, source jobs, artifact digests, image limits, and local receipt validation still apply.

`POST /api/runs/:id/recompare` also stops new server comparison work for active legacy runs. It returns HTTP 409 with `local_comparison_required` and a new complete capture instruction. Review models set `recompareAllowed: false`. Current review, approval, history, originals, and already-admitted task recovery retain their existing rules. Closed and promoted history still returns `history_closed`; local runs retain their complete-Submit guidance.

Before deploying stage A, record the exact supported client, CLI, adapter, service, workflow pin, and executor versions. Verify their real capture, reservation, reference, upload, signed Submit, recovery, review, status, and promotion flow. Include older in-flight attempts. The public adapter comparison-default setting does not change the `local-v1` Submit format. A published bridge or reviewed consumer patch does not prove deployed adoption.

Verified bridge PR/main adoption can supply this compatibility proof. Strict adapter publication is a separate release step; the admission fence does not require a second consumer rollout when the already-supported trusted Submit sends the required local mode and receipt. Stage A keeps existing export drain and conversion controllers executable. Its rollout closes new request paths; it does not declare old work terminal or authorize consumer removal.

Previously issued legacy capabilities can finish their declared uploads and signed Submit during drain. Keep server scheduling for already-admitted stages, comparison publication, consumers, leases, retry, dead-letter handling, and manual recovery executable. Keep their queue bindings and settings. Capture this admitted cohort before final retirement. Existing staged legacy work can create comparison tasks after the new reservation and recompare boundaries close.

## Stage B: retire producers and handlers

Before deploying the final source patch, prove an exact legacy admission cutoff and terminal cohort. Local source preparation, integration, and review can run while the live gates remain open. The live proof must cover every source that can create or publish server comparison work: staged manifests, unsealed and sealed materialization recovery, historical writers, operations publication, existing publication reservations, Worker leases, retries, delayed delivery, comparison dead letters, manual replay, and selected recovery tooling with live-target access. Include deployments or overlapping old versions that can still admit work.

Bind each receipt to the target, deployed version, query time, cutoff, and cohort. Check the cohort's task states, publication tokens and attempts, lease deadlines, delayed and dead-letter messages, and replay closure. An empty global task count or queue chart is not this proof. Do not force retries, cancel work, reset terminal tasks, or acknowledge messages to produce a passing result.

The recorded queue retention of four days is one conservative delivery proof method. Do not start a new four-day wait merely because a public adapter default changes. An earlier boundary can count when it covers all publication and replay sources. Keep the old handler if any required delivery can still arrive.

Deploy the final source patch only after the required legacy comparison and historical writers are gone. The service requires a verified local receipt and no longer creates server comparison tasks. Materialization rejects missing receipts before it reserves a new run. OPERATIONS finalizes imported results without publishing comparison work. The compare Worker keeps its private image validation handler and removes its comparison and dead-letter queue handler. Keep native signed Submit recovery, finalization, durable reviews, status, retention, history, and promotion in OPERATIONS. Keep required historical task and tuple readers. Do not restart terminal work for rollback.

The unused server retry setting `comparisonMaxAttempts` is removed from `VISONAUT_API_LIMITS`. Require selected live overrides to omit this field before deployment; the updated runtime rejects it as unsupported. The committed preview and production overrides are `{}`. Remaining API bounds and `VISONAUT_OPERATIONS_BUDGET.maxAttempts` keep their existing values. Older deployed versions keep their recorded configuration contract until their selected update.

## Retained contracts

Keep the compare Worker's private `fetch` image validation handler, its capacity bounds, and PNG/WebP codecs. Retained images and validation still need them. Keep diagnostic probe support unless separately retired.

Keep historical engine, codec, policy, rendering identities, and saved approval tuples. A local receipt must not relabel an old RGBA approval as pixelmatch. Stored representatives cannot reconstruct omitted tolerated candidate originals. Missing, stale, failed, invalid, or incomplete evidence must require a new complete capture.

Keep every SQL migration and retained record unchanged. Keep ordinary history creation, source promotion, image pins, and recovery. W06 owns export retirement. W07 owns finished conversion controllers. W09 refactors are outside this patch.

## Later resource steps

Resource changes need a separate approved action and a fresh exact-target readback. The source preparation does not authorize queue, Worker, bucket, namespace, database, schedule, or record deletion.

After the terminal cohort and replay closure pass, remove the web `COMPARISONS` producer binding and the compare Worker's comparison producer and comparison/dead-letter consumer configuration for each selected target. The source includes these configuration removals. They do not change live assignments until the parent completes the deployment steps. Preserve the deployment workflow's preview barrier. Preserve OPERATIONS, its dead-letter queue, schedules, D1, both buckets, and the web `COMPARATOR` service binding. Preserve the compare Worker used for validation.

Deleting a consumer entry from Wrangler configuration does not detach the live consumer. [Cloudflare requires explicit consumer removal](https://developers.cloudflare.com/queues/reference/how-queues-works/#remove-a-consumer). The pinned Wrangler 4.136.1 deployment code updates only the consumers present in configuration. Its `deleteWorkerConsumer` command uses a separate consumer-assignment DELETE request. This is distinct from queue resource deletion.

Use these steps for the final deployment. The parent owns all remote actions.

1. Reuse the verified admission cutoff, exact terminal cohort, retained-reader evidence, and known replay ownership. Read the bounded post-fence delta for selected staged writers, tasks, reservations, and leases. An unresolved selected identity keeps its handler in place. Local test results do not clear this gate.
2. Read the exact queue and consumer identities for the selected account and target. Save both comparison consumer assignments and queue metadata. Preserve the OPERATIONS assignments.
3. Detach only the selected primary and comparison dead-letter consumer assignments while the compatible old comparator is still deployed. For production, the expected queues are `visonaut-production-comparisons` (`56f8f86170914a0492c0bbe93a42c553`) and `visonaut-production-comparison-dead-letter` (`54e58a2877004b2d8664509916e05a0d`). For preview, verify the accepted consumer-free fence and skip detachment when it is already absent. Do not pull, acknowledge, purge, or delete queues or messages.
4. Read both exact queues again and require `consumers: []`. Require the same queue identities and retention settings. The read-only `deploy-comparison-retirement.mjs` guard checks the exact queue IDs, names, and absent consumers before the production or preview comparator deployment. It fails when metadata is missing or any consumer remains attached.
5. Deploy the integrated source and configuration. The normal production workflow deploys the comparator before web, so consumer detachment and its readback must precede the workflow. Read back the deployed versions, removed comparison producer bindings, retained OPERATIONS consumer, schedule, D1, buckets, and `COMPARATOR` service binding. Verify private PNG/WebP validation and native Submit recovery, review, status, and promotion.

For a selected production detachment, the pinned command is:

```sh
pnpm exec wrangler queues consumer remove visonaut-production-comparisons visonaut-compare
pnpm exec wrangler queues consumer remove visonaut-production-comparison-dead-letter visonaut-compare
```

Run these commands only after the exact live gate and identity readback pass. They remove consumer assignments; they do not delete queue resources. Physical queue deletion remains outside this retirement patch. A rollback must preserve the admission fence and must not restart terminal legacy work.

Record exact queue IDs and names from a fresh provider read, the intended configuration diff, deployed build identities, rollback limits, and readback predicates. After the binding and consumer change is approved and verified, queue resource deletion is another separate approved step. Never infer disposal of messages or retained data from an unused binding.

## Verification

Run the API admission and workflow tests, trusted CLI local comparison tests, local receipt validation, service and durable-work tests, Worker image validation, history, review, status, retention, promotion, and package smoke checks. Preserve size-change review, zero-pixel profile handling, both pixel caps, anti-aliasing and transparency policy, signed older zero-pixel receipt handling, stale and missing evidence rejection, and repeated terminal legacy delivery during stage A. Run the current built-app manual check when the integrated build or deployment changes. A local test pass does not clear the live rollout holds.
