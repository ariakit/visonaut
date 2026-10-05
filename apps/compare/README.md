# Comparison Worker

The [current guide](../../docs/current-contract.md) defines the normal trusted CLI path. This Worker owns private image validation. The [W08 retirement runbook](../../docs/operations/retire-server-comparison.md) defines the live gate and the separate consumer-detachment steps before deployment of this fetch-only handler. Keep `POST /validate`, required codecs, and finite image bounds.

Trusted local Submit supplies comparison results. The web Worker's five-minute scheduler recovers local receipts, finalizes ready comparisons, and delivers the durable status outbox through OPERATIONS. This Worker has no queue handler or cron. Its source configuration has no comparison producer binding or consumer entries. Existing live consumer assignments must be detached explicitly before this version is deployed. Queue resources remain in place.

Retained history and status readers, immutable comparison tuples, and image identities remain available. The diagnostic Container transport still uses `readOriginalValidated` and `ArtifactStorage` to verify exact stored bytes. Local fixtures seed the old comparison format to test history, review, status, pins, and retention.

`POST /validate` is an internal service-binding endpoint. It returns trusted image dimensions, byte count, MIME type, digest, and color profile after PNG/WebP structure validation and a complete Worker decode. Invalid input returns HTTP 422. A busy isolate returns HTTP 503 with `Retry-After: 1`. The one-job capacity token limits concurrent validation and releases capacity after errors. Keep `workers_dev: false` and configure no public routes for this Worker.

```ts
const response = await env.COMPARATOR.fetch("https://compare/validate", {
  method: "POST",
  body: originalBytes,
});
```

The production Wrangler environment retains the provisioned D1, R2, and OPERATIONS bindings. Verify exact resource IDs and detached comparison consumers before production deployment. The default `visonaut-compare-local` configuration has no backend bindings or Durable Object migrations. The public preview serves fixtures and does not use a hosted comparator. Generate binding types after configuration changes. The following local commands do not deploy:

```sh
pnpm --filter @visonaut/compare-worker typecheck
pnpm --filter @visonaut/compare-worker build
```

The separate `wrangler.probe.jsonc` has no production bindings. Set its `PROBE_TOKEN` secret and deploy it to a disposable environment. The token is required for `POST /probe`. The endpoint has the same encoded/decoded limits as the production codec. It returns fixture digests and bounded resource metrics. The test runner reads its token from the environment and never writes it to evidence.

```sh
# CODEC_PROBE_URL and CODEC_PROBE_TOKEN must already be set.
pnpm --filter @visonaut/compare probe /path/to/largest-capture.webp
```

The probe follows the production result contract: equal images return `maskBytes: 0` and allocate no review mask. The returned RGBA size includes both decoded images and a mask only when one exists. The probe reports WASM linear memory and allocated RGBA sizes; these are not peak isolate memory. Attach Cloudflare trace CPU/resource evidence before launch.

Production uses the Worker codec only. There is no backend environment switch or Container binding. The production `worker-only-v2` Durable Object migration deletes the former `ComparisonContainer` storage. Before deploying that migration, check the live deployment, old Container activity, queued and leased tasks, and stored namespace data. Do not deploy the deletion while any live work or retained data still needs the class. This source change and a dry-run do not establish that live gate.

The alternate Container remains an explicit diagnostic probe in `wrangler.container-probe.jsonc`. Its separate Worker has no D1, R2, or queue bindings. It accepts only token-authorized `POST /compare` requests with bounded, synthetic image payloads. It cannot consume production work or become an automatic fallback. The local transport fixture in `container/transport.ts` retains the earlier validation research. Container thumbnails still have different research keys; a future production migration must qualify that difference.

```sh
pnpm --filter @visonaut/compare-worker typecheck:container
pnpm --filter @visonaut/compare-worker probe:container
```

Set `PROBE_TOKEN` only for the disposable diagnostic Worker. The committed image digest preserves the existing research executor. A new image requires an explicit diagnostic build and pin; verify availability before relying on it. The [mask study](../../packages/compare/evidence/two-pass-mask-study.json) measures local comparison CPU and returned allocations. Equal and tolerated 2.1-million-pixel pairs remove an 8,400,000-byte mask. Changed pairs retain exact mask bytes and use a second pixel scan. This is not hosted peak-memory or end-to-end throughput evidence.
