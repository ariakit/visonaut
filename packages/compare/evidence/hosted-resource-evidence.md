# Hosted codec resource measurements

Collected 2026-09-22T04:17:57.133Z from the deployed codec probe. Fifty sequential requests passed PNG/WebP decoded-pixel parity: 25 per format, each 1248 × 1650 (2,059,200 pixels). No deployment changed.

The tables use Cloudflare's official GraphQL measurements. CPU units below are milliseconds. Indexed/issued shows the available metric population, not an estimated count.

| Format | Indexed/issued | CPU P50 | CPU P90 | CPU P99 | CPU max | Isolate memory max (bytes) |
| ------ | -------------: | ------: | ------: | ------: | ------: | -------------------------: |
| WEBP   |          25/25 | 199.335 | 245.758 |  301.31 |  301.31 |                 67,033,622 |
| PNG    |          23/25 | 291.906 | 398.906 | 431.753 | 431.753 |                101,049,668 |

| Format | Isolate P50 (bytes) | Isolate P90 (bytes) | Isolate P99 (bytes) | Isolate max (bytes) | WASM max (bytes) |
| ------ | ------------------: | ------------------: | ------------------: | ------------------: | ---------------: |
| WEBP   |          67,025,430 |          67,033,624 |          67,033,624 |          67,033,622 |       29,818,880 |
| PNG    |         101,049,660 |         101,049,660 |         101,049,660 |         101,049,668 |       38,076,416 |

The deployed version was `347d78ef-9909-4478-87ce-03bfbf35e1a4`. The API reported sample interval 1 and no invocation errors. Ten later requests also produced ten filtered live tail events; all returned HTTP 200 with outcome `ok`. Raw official quantiles, maxima, queries, and field descriptions are in `hosted-resource-metrics.json` and `hosted-metrics-schema.json`. Probe responses and filtered tail metadata are in `hosted-resource-probes.json` and `hosted-resource-probes-tail.json`.

The PNG input is a lossless conversion of the largest existing Ariakit WebP fixture. Both decode to SHA-256 `a25aae65f6149aa2cd362e337061f37a693c6722a0a7f856f2097a304b80e90b`. The probe runs two decodes, strict comparison, thumbnail encoding, and full-size mask encoding. It therefore includes mask cost even for unchanged pixels. It does not include production R2 or D1 operations.

Cloudflare defines this memory metric as shared V8 isolate memory at invocation time. It is not an intra-invocation peak. Quantiles use reservoir sampling; their numeric representation can differ from a maximum by a few bytes. The client serialized all calls, but the runtime did not expose an isolate ID, so this report does not claim isolate affinity. See [Workers metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/) and [the official GraphQL query guide](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/).

These measurements support the bounded Worker codec path. They do not establish production queue throughput, cost for the full capture collection, or maximum memory between metric samples. The original 2 MiB encoded, 2.1 million decoded pixel, and one active decode/comparison per isolate bounds still apply. No modeled RGBA total or zero-valued Worker timer is used as a CPU or memory measurement.

At collection time the API indexed fewer requests than the client received. The report preserves the exact indexed count; it does not fill missing measurements or treat them as zero.

The initial tail command rejected an explicit sampling rate of 1 before connection. Its corrected follow-up used the default rate and retained only resource/status/version metadata. The saved files contain no request headers, credentials, client IPs, or cookies.
