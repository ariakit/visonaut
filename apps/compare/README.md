# Comparison Worker

The [current guide](../../docs/current-contract.md) defines the normal trusted CLI path and D03/W08 retirement gates. This Worker still owns image validation and supported legacy comparison. W08 may retire legacy queue work only after client, retained-reader, and task drain checks. Keep `POST /validate`, required codecs, and finite image bounds.

The Worker consumes IDs from `COMPARISONS`, reads immutable originals from private `IMAGES`, and commits results through `Service` in `DB`. Queue messages never contain image bytes or effective policy values. Service records supply the trusted policy and exact original digests.

The consumer claims a two-minute lease. It writes validated PNG artifacts before the atomic D1 result. The result and task completion use the same lease guard. Retries use stable object keys. Completed delivery repeats acknowledge the durable result. Failed tasks retry at one-minute intervals and become durable dead tasks after the configured attempt limit. Invalid envelopes follow the queue retry/dead-letter policy.

The web Worker's five-minute scheduler publishes due comparison tasks and completes ready comparisons after an interrupted result commit. The comparison Worker has no cron. Its first review-ready transition sends a small `status` wakeup to the existing operations queue; the durable outbox remains available if that send fails. It admits at most 1,024 unfinished Queue receipts per D1 database, including leased work and receipts from superseded comparisons. Slots reopen as tasks complete or receipts expire; a replacement run can wait while old receipts fill the cap. It reserves each receipt immediately before its Queue send, so an interrupted send leaves later tasks due. Each deployment uses one project per D1 database; `assertOperationsProject` rejects a different project count. A future shared database needs a project-scoped admission count. The service reports exhausted tasks as a failed run. A busy Queue delivery waits up to two minutes for the isolate's codec, then retries after one minute. At most ten primary Queue retries occur before the dedicated comparison dead-letter consumer receives the exhausted receipt.

An accepted message or an ambiguous `Queue.send` response holds its admission slot for 14 days and one hour. That covers Cloudflare Queues' maximum [14-day retention](https://developers.cloudflare.com/queues/platform/limits/) plus a final consumer run. A documented Queue rejection retries after five minutes because the message was not accepted; it reuses the unsent generation if its reservation still owns the task. The consumer's one-minute native retry retains the same receipt, so the scheduler does not publish a duplicate while the original message waits. The web scheduler records failed publication in the private operations dashboard and resolve it only after a later accepted send or durable consumer recovery. A dead-letter receipt carries its publication generation; the dead-letter consumer can make that same task due after five minutes, and the scheduler republishes it under the existing capacity and current-run guards. After three exhausted publications, the task becomes durably dead and the run fails. Follow [the comparison dead-letter runbook](../../docs/operations/recover-comparison-dead-letters.md) for rollout, monitoring, and operator recovery.

Thumbnails use per-run original identity and codec/version identity. A recomparison reads and verifies an existing thumbnail instead of encoding it again. A changed paired image gets a red diff mask. An unchanged pair, addition, or removal has no mask artifact. R2 metadata stores the verified digest. The D1 artifact registration is idempotent and guards all identity fields.

`POST /validate` is an internal service-binding endpoint. It returns trusted image dimensions, byte count, MIME type, digest, and color profile after PNG/WebP structure validation and a complete Worker decode. Invalid input returns HTTP 422. A busy isolate returns HTTP 503 with `Retry-After: 1`. The one-job capacity token covers validation and queued comparison work, so requests cannot hold multiple decoded pairs in the same isolate. Keep `workers_dev: false` and configure no public routes for this Worker.

```ts
const response = await env.COMPARATOR.fetch("https://compare/validate", {
  method: "POST",
  body: originalBytes,
});
```

The Wrangler configurations name the provisioned D1, R2, and queue resources for each environment. Verify those resource IDs before deployment. The queue consumer uses batch size one, with one concurrent invocation in preview and five in production. Generate binding types after configuration changes.

```sh
pnpm --filter @visonaut/compare-worker typecheck
pnpm --filter @visonaut/compare-worker build
pnpm --filter @visonaut/compare-worker deploy --env=""
pnpm --filter @visonaut/compare-worker deploy --env production
```

The separate `wrangler.probe.jsonc` has no production bindings. Set its `PROBE_TOKEN` secret and deploy it to a disposable environment. The token is required for `POST /probe`. The endpoint has the same encoded/decoded limits as the production codec. It returns fixture digests and bounded resource metrics. The test runner reads its token from the environment and never writes it to evidence.

```sh
# CODEC_PROBE_URL and CODEC_PROBE_TOKEN must already be set.
pnpm --filter @visonaut/compare probe /path/to/largest-capture.webp
```

The probe follows the production result contract: equal images return `maskBytes: 0` and allocate no review mask. The returned RGBA size includes both decoded images and a mask only when one exists. The probe reports WASM linear memory and allocated RGBA sizes; these are not peak isolate memory. Attach Cloudflare trace CPU/resource evidence before launch.

Production uses the Worker codec only. There is no backend environment switch or Container binding. The `worker-only-v2` Durable Object migration deletes the former `ComparisonContainer` storage. Before deploying that migration in either environment, check the live deployment, old Container activity, queued and leased tasks, and stored namespace data. Do not deploy the deletion while any live work or retained data still needs the class. This source change and a dry-run do not establish that live gate.

The alternate Container remains an explicit diagnostic probe in `wrangler.container-probe.jsonc`. Its separate Worker has no D1, R2, or queue bindings. It accepts only token-authorized `POST /compare` requests with bounded, synthetic image payloads. It cannot consume production work or become an automatic fallback. The local transport fixture in `container/transport.ts` retains the earlier validation research. Container thumbnails still have different research keys; a future production migration must qualify that difference.

```sh
pnpm --filter @visonaut/compare-worker typecheck:container
pnpm --filter @visonaut/compare-worker probe:container
```

Set `PROBE_TOKEN` only for the disposable diagnostic Worker. The committed image digest preserves the existing research executor. A new image requires an explicit diagnostic build and pin; verify availability before relying on it. The [mask study](../../packages/compare/evidence/two-pass-mask-study.json) measures local comparison CPU and returned allocations. Equal and tolerated 2.1-million-pixel pairs remove an 8,400,000-byte mask. Changed pairs retain exact mask bytes and use a second pixel scan. This is not hosted peak-memory or end-to-end throughput evidence.
