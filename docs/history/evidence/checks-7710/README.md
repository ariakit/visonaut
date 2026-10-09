# Visonaut checks on Ariakit PR #7710

This record describes workflow run `37050749851`, attempt `1`, on 2026-10-02. The [PR](https://github.com/ariakit/ariakit/pull/7710) head was `830ece4e090150023d9f5d8a92dd2dcf2eb7a030`. Its tested merge was `1bdd777e31f106d1339b468dde7de6420fde198d`. Selected GitHub responses and service timestamps are in [timeline.json](timeline.json). No production write, deployment, provider proxy, or manual check update was used.

## Two checks for one review

Both checks belong to App `5028451`, `visonaut-ci`. They have different identities and SHAs. They are not two POSTs for the same external identity.

| Check ID       | Suite ID       | SHA          | External identity                                               | Role                 |
| -------------- | -------------- | ------------ | --------------------------------------------------------------- | -------------------- |
| `110990180117` | `100366893108` | tested merge | `visonaut:pre:1bdd777e31f106d1339b468dde7de6420fde198d`         | Run verdict          |
| `110990341692` | `100360963992` | PR head      | `visonaut:review:7710:830ece4e090150023d9f5d8a92dd2dcf2eb7a030` | Mirrored run verdict |

The pre-run path creates the merge check. `publishReviewLinks` creates the head mirror with the same required name, `Visonaut`. The mirror started as a review link in older code. It now carries a full verdict. Each check already has `details_url`, so a new attempt can use one head check and its direct review link.

GitHub uses the current test merge check when one exists, and otherwise uses the head check. This rule requires compatibility for existing merge checks. The new nullable `check_head_sha` records the immutable target. A null value keeps the old merge target and its mirror. A new PR identity targets the source head. Reruns of a retained identity inherit its target. A fresh identity at the same merge SHA also keeps the merge target when a legacy merge record exists. Main and merge-group checks keep the tested SHA. See [GitHub's required-check rules](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

```ts
// The visible check can be on the PR head.
check.head_sha = sourceHead;
// Capture, Plan, Submit, and run provenance still bind to the signed merge.
run.tested_sha = signedMerge;
```

## Delay after Submit

All times below are UTC. Service timestamps come from read-only D1 SELECT queries. The stored evidence reports zero rows written for every query.

| Event                             | Time         |
| --------------------------------- | ------------ |
| Submit accepted by the service    | 19:17:23.642 |
| Submit job completed              | 19:17:29     |
| Parent CI run completed           | 19:20:51     |
| Service run reserved              | 19:21:16.266 |
| Run sealed                        | 19:22:21.166 |
| Automatic decisions saved         | 19:22:22.960 |
| Human approval command queued     | 19:24:55.636 |
| Human approval committed          | 19:25:48.160 |
| Durable command receipt completed | 19:25:49.005 |
| Merge success intent available    | 19:26:09.674 |
| Head success intent available     | 19:26:21.523 |

Submit acceptance to reservation took `232624 ms`. Reservation to seal took `64900 ms`. Submit acceptance to automatic decisions took `299318 ms`. The approval waited `52524 ms` before its commit and `53369 ms` before its receipt. Success intents followed the approval commit by `21514 ms` and `33363 ms`.

The [Submit job](https://github.com/ariakit/ariakit/actions/runs/37050749851/job/110989996695) staged 12 originals and printed its accepted run ID at 19:17:23.987. It also stated that Submit was not approval. Capture and Submit success permit verification and comparison. Changed images still require a reviewer decision.

The checks eventually passed. The selected final response has head completion at 19:26:20. The merge completion later changed to 19:28:45 after another successful status delivery. That final field is not the first success time. D1 has an earlier complete success intent at 19:26:09.674. The outbox was complete, with no ambiguous delivery or saved error, when inspected. Prior head outbox revisions were removed, so this record cannot reconstruct each earlier failure PATCH from D1. It does not establish a permanent status fault.

## Confirmed code changes

The App already subscribes to `check_run`, but the webhook handler ignores Submit completion. It requests materialization on workflow events or scheduled reconciliation. The new handler wakes ingestion after an exact match to the stored signed Submit check ID, name, source head, live stage, and GitHub Actions App. Existing REST verification still requires the complete pinned capture and Submit job set. The wakeup does not trust a webhook verdict as capture proof. See [GitHub's check-run event](https://docs.github.com/en/webhooks/webhook-events-and-payloads#check_run).

Saved approvals previously waited for the shared operations consumer. The API now starts only the saved command in `waitUntil`, with its existing durable lease, replay, predecessor, and authorization checks. The scheduler and queue still recover interrupted work. GitHub delivery continues through its persistent status outbox.

```ts
await enqueueReview(database, input);
// Start this durable command without first draining unrelated work.
await processReviewQueue(context, input.commandId);
```

New attempts update their original head check for Reject, Approve, and Undo. Legacy merge checks retain the mirror path. The change does not delete old checks or change branch rules. Equivalent merge retirement still requires an exact source, base, and tree match. A changed tree stays pending. Main advancement does not change the signed tested merge. Another workflow attempt gets a new generation. Lost POST and PATCH responses retain their ambiguity fences.

## Evidence limits

The selected timestamps prove the intervals. They do not identify the exact queue occupancy or webhook arrival time before reservation. Historical webhook payloads were compacted. The 65-second materialization interval is recorded, but this patch does not claim to remove it.

The branch has not been deployed. Local tests prove check identity and wakeup behavior; they do not measure new production latency. No live screenshot or recording of the new single-check attempt is available because a deployed workflow is required to show that result. The initial red tests showed merge-target creation, the extra mirror, an ignored Submit event, and an approval left queued. Green tests cover direct status updates, attempt isolation, equivalent and changed trees, main advancement, legacy checks, restore fencing, and durable review recovery.

Only the original reporter, `diegohaz`, supplied human material for this checks investigation. The PR's other comments and automation concern the Ariakit feature. No additional contributor credit applies to this fix.
