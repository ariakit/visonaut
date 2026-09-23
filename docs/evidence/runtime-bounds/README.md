# Backup runtime bounds

The September 22, 2026 [real queue measurements](./runtime-bounds.json) support these selected limits in each web Worker environment:

| Bound                        | Selected value |
| ---------------------------- | -------------: |
| Queue CPU                    |    240 seconds |
| SQL backup size              |          2 GiB |
| Export and download deadline |    420 seconds |
| Operation lease              |    720 seconds |

The fixture contains 2,772,468 image ownership rows across 774 compacted runs. Its SQL export is 1,182,101,421 bytes. It excludes the corresponding R2 object corpus and some full application history, so it is a lower bound for that workload. Export readiness plus download and hashing took 110.58 seconds. The dedicated queue used one message per batch and one active consumer.

| Native queue path                                          |           CPU | Worker wall time | Sampled isolate memory |
| ---------------------------------------------------------- | ------------: | ---------------: | ---------------------: |
| Known-size stream and complete stored-object rehash        | 66.39 seconds |   127.17 seconds |       22,239,308 bytes |
| Bounded multipart upload and complete stored-object rehash | 35.16 seconds |   173.06 seconds |       30,718,028 bytes |

Both results matched the exact source length and SHA-256. The multipart path used one reusable 8 MiB buffer and 141 parts. Each mode has one official metric sample with sample interval 1. The memory values are sampled invocation memory, not a continuous peak-memory trace.

At the selected 2 GiB ceiling, linear estimates are 120.61 seconds for the worst observed queue CPU, 314.40 seconds for the longest stream-and-verification wall time, and 515.28 seconds for serialized export plus that queue path. These are projections from the measured input, not measurements of every possible 2 GiB input. The 240-second CPU limit leaves 119.39 seconds above the CPU estimate. The 720-second lease leaves 204.72 seconds above the serialized wall estimate and remains below the 900-second queue wall limit. The 420-second exporter deadline covers polling, download, and upload backpressure while retaining lease time for final verification.

Five-minute cron triggers only publish a continuation. Heavy work executes through the operations queue because frequent cron events have a 30-second CPU cap. See the [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [Queues limits](https://developers.cloudflare.com/queues/platform/limits/). Failed publication records an in-app event; later publication does not clear it until queue work succeeds.

The [earlier HTTP measurements](./http-runtime-bounds.json) remain valid observations of a different event path. The real queue CPU result was higher. It supersedes the earlier 120-second CPU, 300-second export, and 600-second lease recommendation. The original 30-second CPU configuration failed on this fixture.

These values are execution bounds. Overall admission capacity, sustained workload, incremental cost, full object restore time, and launch readiness remain separate gates. One sample per mode does not establish every regional or network condition. Timeout and lease failures remain visible and recoverable. The sanitized JSON files preserve exact values, units, object-operation counts, source digests, and available metric populations. They contain no SQL content, credentials, or signed URLs.
