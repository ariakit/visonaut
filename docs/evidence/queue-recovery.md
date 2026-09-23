# E08 · Native queue recovery

The 2026-09-22 probe passed on a dedicated Cloudflare Worker, D1 database, work queue, and dead-letter queue. It had no production, R2, or GitHub binding. Every HTTP route required a fresh diagnostic credential; an unauthenticated report returned 401. Resource IDs, exact code hashes, timestamps, and counts are in [queue-recovery.json](./queue-recovery.json).

The deployed version was `09a1cd1c-afc1-43aa-a035-6538f21bb428`. It used the production work lease/reconciliation functions, comparison finalization service, private operations status projection, and proposed alert helper. Failure injection occurred before a Queue send or a finalization batch commit. Queue delivery, retries, dead-letter delivery, and D1 writes were real.

| Control                    | Observed result                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lost publication           | Four durable tasks remained available after publisher failure. Private publication alerts appeared. Reconciliation later sent the tasks.                   |
| Expired worker lease       | A real one-second lease expired. A replacement worker completed attempt 2. The old lease could not overwrite the result.                                   |
| Duplicate delivery         | Eight extra messages for one task left one committed attempt and one result.                                                                               |
| Repeated work failure      | Two retries preceded terminal failure on attempt 3. No successful result replaced the failure.                                                             |
| Transport retry exhaustion | Three transport deliveries led to one message in the real dead-letter consumer.                                                                            |
| Finalization gap           | An injected batch failure left a private finalization alert. A later successful finalization cleared it.                                                   |
| Explicit recovery          | New replacement work completed once after the failed fixture was explicitly superseded. The old task remained dead with three attempts.                    |
| Private escalation         | Publication, finalization, and exhausted-task alerts were visible. All resolved after the relevant recovery; unrelated page processing did not clear them. |
| Integrity                  | No foreign-key violations.                                                                                                                                 |

The measured interval after successful publication started at 10:19:41.877 UTC and ended at 10:20:05.858 UTC: 23.981 seconds. This is a small failure-control experiment, not a throughput or recovery-time capacity benchmark. The queue used one-second retry delays, two transport retries, and three durable work attempts. Production delay and lease budgets differ.

For example, the final task state retained the failed attempt while recording the replacement separately:

```json
[
  { "id": "bounded:row", "state": "dead", "attempts": 3 },
  { "id": "bounded-replacement:row", "state": "complete", "attempts": 1 }
]
```

The first lease-control fixture was nonpassing: its backdated claim preceded the task's `available_at`, so the claim correctly did not acquire a lease. The original raw output was preserved. The corrected fixture acquires a lease at the actual clock time and waits for its expiry before publication.

The work results are synthetic control values. The finalization fixture has an empty inventory. Neither proves image comparison, capture completeness, or GitHub behavior. Historical-purpose alert handling was present in this deployed version. Archive-receipt alert recovery was added later and has separate seven-test SQLite coverage; it is not claimed as part of this native deployment.

The [portable harness](../../apps/web/tooling/queue-recovery/README.md) includes setup commands, the exact recorded Worker bundle, and compressed native event receipts. Local credentials are excluded. This probe sent no external notifications.

After verification, the probe's own `PROBE_TOKEN` was removed from Cloudflare and its local credential files were deleted. Both the former authenticated request and an unauthenticated request now return 503 because the diagnostic Worker is deliberately unconfigured. No existing project credential was changed. The resource records remain for evidence; the queues have no scheduled producer.
