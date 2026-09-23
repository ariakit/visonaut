# Comparison Worker

The Worker consumes IDs from `COMPARISONS`, reads immutable originals from private `IMAGES`, and commits results through `Service` in `DB`. Queue messages never contain image bytes or effective policy values. Service records supply the trusted policy and exact original digests.

The consumer claims a two-minute lease. It writes validated PNG artifacts before the atomic D1 result. The result and task completion use the same lease guard. Retries use stable object keys. Completed delivery repeats acknowledge the durable result. Failed tasks retry at one-minute intervals and become durable dead tasks after the configured attempt limit. Invalid envelopes follow the queue retry/dead-letter policy.

The five-minute scheduled handler publishes due comparison tasks and completes ready comparisons after an interrupted result commit. It admits at most 1,024 unfinished Queue receipts per D1 database, including leased work and receipts from superseded comparisons. Slots reopen as tasks complete or receipts expire; a replacement run can wait while old receipts fill the cap. It reserves each receipt immediately before its Queue send, so an interrupted send leaves later tasks due. Each deployment uses one project per D1 database; `assertOperationsProject` rejects a different project count. A future shared database needs a project-scoped admission count. The service reports exhausted tasks as a failed run. The deployment's alert/recovery handler must inspect durable dead tasks and the dead-letter queue.

An accepted message or an ambiguous `Queue.send` response holds its admission slot for 14 days and one hour. That covers Cloudflare Queues' maximum [14-day retention](https://developers.cloudflare.com/queues/platform/limits/) plus a final consumer run. A documented Queue rejection retries after five minutes because the message was not accepted. The consumer's one-minute native retry retains the same receipt, so the scheduler does not publish a duplicate while the original message waits. Both comparison and web schedulers record failed publication in the private operations dashboard and resolve it only after a later accepted send or durable consumer recovery. If all Queue deliveries end in the dead-letter queue before a consumer claim, D1 republishes after the receipt expires. This worst-case automatic recovery can take over 14 days; inspect the dead-letter queue and service alerts promptly.

Thumbnails use per-run original identity and codec/version identity. A recomparison reads and verifies an existing thumbnail instead of encoding it again. A changed paired image gets a red diff mask. An unchanged pair, addition, or removal has no mask artifact. R2 metadata stores the verified digest. The D1 artifact registration is idempotent and guards all identity fields.

`POST /validate` is an internal service-binding endpoint. It returns trusted image dimensions, byte count, MIME type, digest, and color profile after container validation and a complete decode. Invalid input returns HTTP 422. A busy isolate returns HTTP 503 with `Retry-After: 1`. The one-job capacity token covers validation and queued comparison work, so requests cannot hold multiple decoded pairs in the same isolate. Keep `workers_dev: false` and configure no public routes for this Worker.

```ts
const response = await env.COMPARATOR.fetch("https://compare/validate", {
  method: "POST",
  body: originalBytes,
});
```

The Wrangler configurations name the provisioned D1, R2, and queue resources for each environment. Verify those resource IDs before deployment. The queue consumer requires batch size one and concurrency one until deployed measurements establish a larger safe limit. Generate binding types after configuration changes.

```sh
pnpm --filter @visonaut/compare-worker typecheck
pnpm --filter @visonaut/compare-worker build
pnpm --filter @visonaut/compare-worker deploy
```

The separate `wrangler.probe.jsonc` has no production bindings. Set its `PROBE_TOKEN` secret and deploy it to a disposable environment. The token is required for `POST /probe`. The endpoint has the same encoded/decoded limits as the production codec. It returns fixture digests and bounded resource metrics. The test runner reads its token from the environment and never writes it to evidence.

```sh
# CODEC_PROBE_URL and CODEC_PROBE_TOKEN must already be set.
pnpm --filter @visonaut/compare probe /path/to/largest-capture.webp
```

The probe deliberately encodes a full-size mask for equal images to exercise worst-case buffer allocation. The production consumer emits masks only for changed pairs. The probe reports WASM linear memory and allocated RGBA sizes; these are not peak isolate memory. Attach Cloudflare trace CPU/resource evidence before launch.
