# Comparison Worker

The Worker consumes IDs from `COMPARISONS`, reads immutable originals from private `IMAGES`, and commits results through `Service` in `DB`. Queue messages never contain image bytes or effective policy values. Service records supply the trusted policy and exact original digests.

The consumer claims a two-minute lease. It writes validated PNG artifacts before the atomic D1 result. The result and task completion use the same lease guard. Retries use stable object keys. Completed delivery repeats acknowledge the durable result. Failed tasks retry at one-minute intervals and become durable dead tasks after the configured attempt limit. Invalid envelopes follow the queue retry/dead-letter policy.

The five-minute scheduled handler publishes due comparison tasks and completes ready comparisons after an interrupted result commit. The service reports exhausted tasks as a failed run. The deployment's alert/recovery handler must inspect durable dead tasks and the dead-letter queue.

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
pnpm --filter @ariviso/compare-worker typecheck
pnpm --filter @ariviso/compare-worker build
pnpm --filter @ariviso/compare-worker deploy
```

The separate `wrangler.probe.jsonc` has no production bindings. Set its `PROBE_TOKEN` secret and deploy it to a disposable environment. The token is required for `POST /probe`. The endpoint has the same encoded/decoded limits as the production codec. It returns fixture digests and bounded resource metrics. The test runner reads its token from the environment and never writes it to evidence.

```sh
# CODEC_PROBE_URL and CODEC_PROBE_TOKEN must already be set.
pnpm --filter @ariviso/compare probe /path/to/largest-capture.webp
```

The probe deliberately encodes a full-size mask for equal images to exercise worst-case buffer allocation. The production consumer emits masks only for changed pairs. The probe reports WASM linear memory and allocated RGBA sizes; these are not peak isolate memory. Attach Cloudflare trace CPU/resource evidence before launch.
