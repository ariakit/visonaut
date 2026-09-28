# One-time processed webhook compaction

Deploy the processed-webhook settlement change before running this backfill. New deliveries retain their full JSON while `processed_at` is null and clear it in the same write that marks them processed. Keep `delivery_id`, `event`, `payload_digest`, `received_at`, and `processed_at` for replay detection and audit.

The September 28 production count was 30,562 processed receipts. [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) counts a changed row as a row written; updating this unindexed JSON column should therefore use about 30,562 row writes if that count is still current. At the paid-plan overage rate of $1 per million writes, that is about $0.031 before included usage. Each statement below changes at most 250 rows, so that count needs at most 123 successful statements. Read counts and storage effects must be checked from D1's returned metadata; this estimate does not authorize an unbounded write.

Before writing, count the remaining rows in production and confirm the current row-write budget:

```sql
SELECT COUNT(*) AS remaining
FROM github_webhook_delivery
WHERE processed_at IS NOT NULL AND payload_json != '{}';
```

Run [`compact-processed-webhooks.sql`](./compact-processed-webhooks.sql) once against the production D1 database:

```sh
cd apps/web
../../node_modules/.bin/wrangler d1 execute DB --remote --env production --json \
  --file ../../docs/operations/compact-processed-webhooks.sql
```

Inspect `meta.rows_written`, `meta.rows_read`, and `meta.size_after` after that first statement. Stop if it exceeds 250 writes, if physical size approaches the configured admission stop, if D1 reports an error, or if the database is under incident load. Repeat one statement at a time, checking `remaining` periodically, until it is zero. A retry is safe because compacted rows no longer match the predicate. Do not run it as a migration or schedule it. Never include pending rows in the update. The SQL was tested only with local Miniflare; no remote dry run, synthetic load, or Cloudflare resource was used.

This backfill reduces live payload JSON and the size of any later SQL export. It does not promise an immediate reduction in D1's physical `size_after` or retained Time Travel storage. Do not run `VACUUM` as part of this procedure.
