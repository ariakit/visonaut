# Production comparison consumer, September 26, 2026

The Ariakit PR backlog had three active comparisons with 3,174 rows. At 17:39 UTC, 1,511 comparison tasks were still queued. The live `visonaut-production-comparisons` consumer had `max_concurrency: 1` although production admitted five active runs. Its other settings were batch size 1, wait 1,000 ms, 100 retries, retry delay 0, and dead-letter queue `visonaut-production-dead-letter`.

Later that day, `wrangler deploy --config apps/compare/wrangler.jsonc --env production` deployed `visonaut-compare` version `89d56150-d1d1-4fa3-b075-728366d4573e`. A subsequent `wrangler queues consumer list visonaut-production-comparisons` readback showed the same consumer ID `1b514eb4386e45b190fef0a260cdba6b` and all other settings unchanged, with `max_concurrency: 5`. The deployment reported no Container application change.

This verifies the live capacity setting, not a fivefold speedup. Compare row throughput and error rates on the already queued PR runs before attributing a latency result to this change. The normal main-branch version deployment leaves Queue consumer settings unchanged.
