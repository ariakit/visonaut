# Deployed quarantine and public-image boundary

On September 23, 2026, the diagnostic deployment denied anonymous access to a **known existing** synthetic quarantine object. The synthetic run `0c19d0a2-c139-4340-a6bf-a6c684e04c90` had an `ingest_run_provenance.plan_object_key` in D1. An authenticated Cloudflare R2 read of that exact object succeeded and returned 1,178 bytes; the object contents were neither printed nor saved by this probe. The [sanitized receipt](./e02-quarantine-boundary-receipt.json) records the object key, measured status, and public-access settings.

An anonymous `GET /images/5fe5fa31186359dd8f065e6f7a34aebcc9ea81ef38622e8607b55bba10b905ed` returned HTTP 404, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`. The identifier is the digest inside the known quarantine plan key. In the same deployed environment, an anonymous `GET` for a validated synthetic PNG returned HTTP 200, `Content-Type: image/png`, and immutable public caching. This positive control shows that the 404 was not a general image-service outage.

The public route in [`apps/web/src/api/images.ts`](../../apps/web/src/api/images.ts) first selects a validated `visonaut_images` record by exact ID, then reads only the `IMAGES` binding. It has no `QUARANTINE` read path:

```sql
SELECT id, object_key, content_type, digest, bytes_present
FROM visonaut_images WHERE id = ? AND validated = 1
```

Cloudflare reported no public custom domain and disabled `r2.dev` access for each of the production, preview, and diagnostic quarantine buckets. This proves the named buckets had no direct Cloudflare public endpoint at the time of the check. The diagnostic object probe proves the deployed route refused this known object. It does not claim that every possible private object was individually requested. The earlier [validated-image and private-API record](./github-integration.md#public-image-and-private-metadata-boundary) covers the other boundary probes.
