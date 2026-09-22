# Paged private export evidence

The final paged export passes a live and archived 35,820-capture regression. Every capture contains the exact hydrated profile. The independent TAR reader checks framing, all member hashes, page and payload inventories, checksum coverage, and the final completion record. The same positive test fails against the earlier monolithic export at its metadata bound.

Eight committed [regression tests](../../../apps/web/src/operations/export-scale.test.ts) cover the two full fixtures, missing and corrupt metadata or entry pages, cancellation of open streams, and paged expiry with pin release. They use [synthetic storage fixtures](../../../apps/web/src/operations/export-scale-fixture.ts) and an [independent reader](../../../apps/web/src/operations/export-scale-reader.ts). The fixture starts with one real sealed, ready service run, then adds storage rows. Its 1,024-byte bodies test export integrity, not screenshot decoding or production image sizes.

```sh
pnpm exec vitest run apps/web/src/operations/export-scale.test.ts
```

The separate native local D1/R2 study verifies 35,820 captures and 10,580 distinct payloads. The resulting TAR contains 70,951,424 bytes and 11,171 members. Preparation took 20.492 seconds; preparation and verified consumption took 83.290 seconds. Export orchestration ran in Node with real Miniflare bindings. These observations do not establish hosted latency, Worker memory or CPU bounds, or admission capacity.

A separate entry-count study verifies 143,280 owned-image entries using 32-byte bodies. It produces 3,231 stored pages, a 688,475-byte root, and 147 checksum pages. This checks the count of a 35,820-original, 71,640-derived, 35,820-reference inventory. It does not reproduce those ownership relationships or payload sizes. The 200,000-entry setting leaves room for metadata/history entries; it is a format bound, not a measured throughput promise.

[Exact results and source hashes](./RESULTS.json), [native receipts](./native-result.json), and [entry-count receipts](./cardinality-result.json) preserve the separate scopes. The archived fixture includes 425 immutable history objects plus its 10,580 image payloads. The native and entry-count drivers were isolated studies; the portable eight-test regression is committed. Random export IDs change complete-TAR hashes between otherwise equivalent successful runs.
