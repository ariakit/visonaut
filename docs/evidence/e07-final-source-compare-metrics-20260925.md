# Production comparison Worker telemetry during the final Ariakit run

Cloudflare's `workersInvocationsAdaptive` dataset was queried at 14:40 UTC on September 25, 2026, for production `visonaut-compare` between 12:50 and 14:00 UTC. This interval brackets the [final Ariakit PR capture](./e07-final-ariakit-run-20260925.md); the query only read existing telemetry and sent no comparison work. The [sanitized response](./e07-final-source-compare-metrics-20260925.json) retains the deployed version IDs, counts, sampling intervals, and resource measurements.

| Deployed version                       | Estimated requests | Reported errors | Maximum recorded CPU | Maximum recorded isolate memory |
| -------------------------------------- | -----------------: | --------------: | -------------------: | ------------------------------: |
| `76644415-80d3-4204-be33-859852e7e2c0` |              1,018 |               0 |           181.365 ms |                96,748,074 bytes |
| `c7eab191-ff64-410b-84f4-04fe2c20f4cd` |                  4 |               0 |             7.725 ms |                20,459,596 bytes |

The larger value is 92.27 MiB of **sampled invocation-time isolate memory**. Cloudflare [defines the metric](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/) at invocation time and says its quantiles use reservoir sampling. Its [adaptive dataset totals](https://developers.cloudflare.com/analytics/graphql-api/sampling/) are estimates derived from sampled records. The reported average sample intervals were 1.0473 and 1. The maximum is an observed sample, not the maximum at every point inside every invocation. The interval can contain other project activity, and the request estimate cannot be equated with the run's 1,058 review variants. The response does not identify a Worker isolate or provide an intra-invocation high-water mark.

The sanitized receipt preserves the exact script and time filters, the result limit of 100, the two returned rows, and the top-level GraphQL `errors: null` result. No status or version filter was applied. The zero reported errors and maxima cover those returned groups; they are not a complete unsampled invocation log.

This is final-source hosted CPU and bounded memory evidence for E07 and E01. It does not prove the required peak-memory bound or target-scale comparison throughput. The [local process study](./worker-memory/README.md) and [hosted codec probe](../../packages/compare/evidence/hosted-resource-evidence.md) have different accounting scopes. E01 and E07 remain open for their remaining runtime and cost gates.
