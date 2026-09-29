# Recover exhausted comparison Queue receipts

The comparison Worker sends only `{ taskId, publicationAttempt }` in each new primary Queue message. `publicationAttempt` is the D1 receipt generation. An exhausted message goes to a dedicated comparison dead-letter queue (DLQ). Its consumer changes the matching, still-current task to become due in five minutes. The normal scheduler then republishes it. It does not bypass the 1,024-receipt cap or restart a superseded run. A third exhausted publication marks the task dead, which fails the comparison and its check.

The production and preview operations consumers still use the existing shared `visonaut-*-dead-letter` queues. Never attach the comparison recovery consumer to those queues. Diagnostics is retired; create only the two live comparison DLQs.

## Rollout order

1. Verify the two provisioned comparison DLQs. Neither should have a consumer or messages before step 3. Do not change the primary comparison consumers yet.

   | Environment | Queue                                        | Queue ID                           |
   | ----------- | -------------------------------------------- | ---------------------------------- |
   | Preview     | `visonaut-preview-comparison-dead-letter`    | `24a0be386d6d465c87a0ac71ac6f7822` |
   | Production  | `visonaut-production-comparison-dead-letter` | `54e58a2877004b2d8664509916e05a0d` |

2. Merge the reviewed code and deploy the web and comparison Worker versions. Main CI deploys **production only**. Use the same version uploader for preview with the existing scoped deployment and migration credentials. Build preview web with `CLOUDFLARE_ENV` unset; then deploy its built config and the preview comparison config:

   ```sh
   env -u CLOUDFLARE_ENV pnpm --filter @visonaut/web build
   node .github/workflows/scripts/deploy-version.mjs apps/compare/wrangler.jsonc visonaut-preview-compare
   node .github/workflows/scripts/deploy-version.mjs apps/web/dist/server/wrangler.json visonaut-preview
   ```

   Confirm both environments publish `{ taskId, publicationAttempt }`, and each comparison Worker has `VISONAUT_COMPARISON_DEAD_LETTER_QUEUE` set to its own new queue name. The version uploader removes `queues` from its Worker version upload. A config change in Git does **not** create queues or change live consumer triggers.

3. Attach `visonaut-preview-compare` to its new preview DLQ and `visonaut-compare` to its production DLQ. Use batch size 1, concurrency 1, ten retries, and a 60-second retry delay. Read the consumers back and confirm each queue has exactly one matching Worker consumer. Keep the old shared DLQs with their operations routing.
4. Drain old untagged primary receipts before changing a primary consumer. For each environment, confirm that the comparison Queue has no ready, delayed, or in-flight messages in Cloudflare, and run the following read-only D1 query. The count must be zero. The [Queue metrics API](https://developers.cloudflare.com/api/resources/queues/) exposes `backlog_count`, but it is approximate; also check the dashboard and repeat the read after two minutes. Repeat both checks immediately before each primary-consumer update. If either is nonzero, wait for the existing consumer to finish; do not switch while an old `{ taskId }` message can still exhaust into the new DLQ. Current code acknowledges an untagged DLQ envelope after recording an alert, but cannot safely infer its D1 generation.

   ```sql
   SELECT count(*) AS active_comparison_tasks
   FROM work_tasks
   WHERE kind = 'compare' AND state IN ('queued', 'leased');
   ```

5. Update each existing **primary** consumer in place with Cloudflare's [Update Queue Consumer API](https://developers.cloudflare.com/api/resources/queues/subresources/consumers/methods/update/). Preserve its consumer ID, script name, batch size 1, one-second batch wait, and existing concurrency (preview 1; production 5). Set its `dead_letter_queue` to its environment's new comparison DLQ, `max_retries` to 10, and `retry_delay` to 60. Do preview first. The update is a `PUT /accounts/{account_id}/queues/{queue_id}/consumers/{consumer_id}` with `type: "worker"`, `script_name`, `dead_letter_queue`, and `settings`. Read back each consumer and its queue before moving to production. Do not remove and re-add the primary consumer: that creates an unconsumed interval.
6. Confirm the comparison queues point only to the new comparison DLQs, the new DLQs point to their comparison Workers, and the operations queues still point to the original shared DLQs. Record the live IDs, settings, Worker versions, D1 count, Queue backlogs, and check results without message bodies or credentials.

Inspect the old shared DLQ separately. It may contain pre-cutover comparison messages mixed with operations messages. Do not replay or acknowledge it as a batch. If a comparison task is still active, inspect its exact D1 receipt and Queue state and resolve that task before the four-day unconsumed-DLQ retention expires. If the task is already complete, dead, or superseded, leave the old message for normal retention. Never copy an untagged message into the new DLQ and assume it matches the current publication.

## Small verification

Run the focused local SQLite and Worker tests first. They use one task fixture and no image processing. Read back the primary consumer settings after rollout; observe normal primary delivery if an existing preview capture naturally produces a comparison, but do not create a new capture for this probe. To exercise the recovery handler, use a **separate synthetic preview receipt that was never sent to the primary Queue**. Verify the preview D1 ID is `395b539c-c423-4ce4-887c-a5792792a63b`, the read-only query `SELECT id FROM visonaut_projects WHERE id='ariakit'` returns one row there, and the primary Queue backlog is zero. Then apply [the fixture SQL](./comparison-dead-letter-preview-fixture.sql) only to `visonaut-preview`:

```sh
pnpm exec wrangler d1 execute visonaut-preview --config apps/web/wrangler.jsonc --remote --file docs/operations/comparison-dead-letter-preview-fixture.sql
```

The fixture inserts an inactive historical run, one comparison row, and one queued task with publication generation 1 and a future receipt deadline. Its final statement activates the comparison after all rows exist; do not assume the whole SQL file is one transaction. If any statement fails, use the cleanup SQL and inspect the exact rows before retrying. The task's `available_at` is 24 hours ahead, so the scheduler cannot publish it before cleanup. The script contains no `Queue.send`. Confirm the exact row exists and the primary Queue backlog remains zero, then use the [Queue Push Message API](https://developers.cloudflare.com/api/resources/queues/subresources/messages/methods/push/) on preview DLQ `24a0be386d6d465c87a0ac71ac6f7822` with this JSON request body:

```json
{
  "content_type": "json",
  "body": { "taskId": "issue-68-dlq-preview:row", "publicationAttempt": 1 }
}
```

Confirm the DLQ consumer records `comparison-dead-letter-receipt` with result `requeued`, D1 sets `publication_token` to `dead-letter:1`, and `publication_due_at` moves to roughly five minutes ahead. The task must remain queued and unavailable to the primary scheduler. Local tests prove the later scheduler publication path. A normal preview run is **not** suitable for this injection: its original message could still be delayed or in flight. Do not inject into production, lower the live primary retry limit for a probe, or run bulk synthetic captures. After saving aggregate evidence, apply [the cleanup SQL](./comparison-dead-letter-preview-cleanup.sql) to `visonaut-preview` and verify the four fixture rows are absent. Finish before its 24-hour availability time. If this no-primary-message fixture cannot be established, stop the live injection and retain the local regression evidence instead.

The primary consumer makes at most eleven delivery reads per publication (initial delivery plus ten retries), then hands the message to the DLQ. Each busy-codec delivery waits up to two minutes before requesting a Queue retry after 60 seconds. Exhaustion takes about ten minutes when no delivery waits for codec capacity, or about 32 minutes when all eleven deliveries use their full wait. The DLQ update adds a five-minute cooldown, and the five-minute scheduler adds at most another five minutes, so first recovery is about 15–20 minutes or 37–42 minutes, respectively. Three exhausted publications use at most 33 primary delivery reads plus DLQ deliveries. Queue backlog, an outage, or a live lease can make these times longer; these are operational expectations, not deadlines.

If the DLQ consumer cannot reach D1, it retries at 60-second intervals up to ten times. A persistent DLQ consumer failure can still exhaust this final Queue. Watch its consumer failure metric and Worker logs. Keep the in-app operations alert visible; a task without a recovered DLQ receipt remains pending on its original 14-day-plus-one-hour receipt deadline. Investigate such a task by its ID and D1 `publication_attempts`, `publication_due_at`, `publication_token`, `published_at`, state, and current-run link before any manual correction. Do not republish directly: only the normal scheduler applies the current-run fence and outstanding-receipt cap. On the third exhausted publication the task is dead, so the run and check fail rather than pass with missing evidence.

References: [Cloudflare dead-letter queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/), [Queue retries](https://developers.cloudflare.com/queues/configuration/batching-retries/), [Queue limits](https://developers.cloudflare.com/queues/platform/limits/), and [Update Queue Consumer API](https://developers.cloudflare.com/api/resources/queues/subresources/consumers/methods/update/).
