# Retire server comparison in stages

[Issue #204 W08](https://github.com/ariakit/visonaut/issues/204#w08) selects trusted local Submit as the normal path. Preparation does not prove live rollout readiness. Keep the two source stages separate. Deploy each stage only after its own evidence passes. W08 integration follows W06, W07, and verified W05 coverage.

## Stage A: stop new admissions

`POST /v1/runs` requires `comparisonMode: "local-v1"`. An omitted mode returns HTTP 409 with `local_comparison_required` and an upgrade and recapture instruction. An unknown mode returns HTTP 400 with `comparison_mode`. The request fails before GitHub work, staging, or capability issuance.

```ts
{ ...reservation, comparisonMode: "local-v1" }
```

Use a compatible trusted CLI and a new complete capture. Adding the field alone does not supply a verified receipt. Reference binding, the complete inventory, signed Submit, source jobs, artifact digests, image limits, and local receipt validation still apply.

Before deploying stage A, record the exact supported client, CLI, adapter, service, workflow pin, and executor versions. Verify their real capture, reservation, reference, upload, signed Submit, recovery, review, status, and promotion flow. Include older in-flight attempts. The public adapter comparison-default setting does not change the `local-v1` Submit format. A published bridge or reviewed consumer patch does not prove deployed adoption.

Previously issued legacy capabilities can finish their declared uploads and signed Submit during drain. Keep server scheduling, comparison publication, consumers, leases, retry, dead-letter handling, and manual recovery executable. Keep their queue bindings and settings. Capture this admitted cohort before final retirement. Existing staged legacy work can create comparison tasks after the new reservation boundary closes.

## Stage B: retire producers and handlers

Before applying the final source patch, prove an exact legacy admission cutoff and terminal cohort. The proof must cover every source that can create or publish server comparison work: staged manifests, unsealed and sealed materialization recovery, historical writers, operations publication, existing publication reservations, Worker leases, retries, delayed delivery, comparison dead letters, manual replay, and any recovery tooling with live-target access. Include deployments or overlapping old versions that can still admit work.

Bind each receipt to the target, deployed version, query time, cutoff, and cohort. Check the cohort's task states, publication tokens and attempts, lease deadlines, delayed and dead-letter messages, and replay closure. An empty global task count or queue chart is not this proof. Do not force retries, cancel work, reset terminal tasks, or acknowledge messages to produce a passing result.

The recorded queue retention of four days is one conservative delivery proof method. Do not start a new four-day wait merely because a public adapter default changes. An earlier boundary can count when it covers all publication and replay sources. Keep the old handler if any required delivery can still arrive.

Apply the final source patch only after the required legacy comparison and historical writers are gone. Remove server task creation, production publication, and the production comparison queue handler. Keep native signed Submit recovery, finalization, durable reviews, status, retention, history, and promotion in OPERATIONS. Keep required historical task and tuple readers. Do not restart terminal work for rollback.

## Retained contracts

Keep the compare Worker's private `fetch` image validation handler, its capacity bounds, and PNG/WebP codecs. Retained images and validation still need them. Keep diagnostic probe support unless separately retired.

Keep historical engine, codec, policy, rendering identities, and saved approval tuples. A local receipt must not relabel an old RGBA approval as pixelmatch. Stored representatives cannot reconstruct omitted tolerated candidate originals. Missing, stale, failed, invalid, or incomplete evidence must require a new complete capture.

Keep every SQL migration and retained record unchanged. Keep ordinary history creation, source promotion, image pins, and recovery. W06 owns export retirement. W07 owns finished conversion controllers. W09 refactors are outside this patch.

## Later resource steps

Resource changes need a separate approved action and a fresh exact-target readback. The source preparation does not authorize queue, Worker, bucket, namespace, database, schedule, or record deletion.

After the terminal cohort and replay closure pass, prepare removal of the web `COMPARISONS` producer binding and the compare Worker's comparison producers and comparison/dead-letter consumers for each approved target. Recheck the deployment workflow's preview barrier before changing preview configuration. Preserve OPERATIONS, its dead-letter queue, schedules, D1, both buckets, and the web `COMPARATOR` service binding. Preserve the compare Worker used for validation.

Record exact queue IDs and names from a fresh provider read, the intended configuration diff, deployed build identities, rollback limits, and readback predicates. After the binding and consumer change is approved and verified, queue resource deletion is another separate approved step. Never infer disposal of messages or retained data from an unused binding.

## Verification

Run the API admission and workflow tests, trusted CLI local comparison tests, local receipt validation, service and durable-work tests, Worker image validation, history, review, status, retention, promotion, and package smoke checks. Preserve size-change review, zero-pixel profile handling, both pixel caps, anti-aliasing and transparency policy, signed older zero-pixel receipt handling, stale and missing evidence rejection, and repeated terminal legacy delivery during stage A. Run the current built-app manual check when the integrated build or deployment changes. A local test pass does not clear the live rollout holds.
