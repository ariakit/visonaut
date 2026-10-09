# Paged private export evidence

This is historical evidence from source snapshot [`43552ce`](https://github.com/ariakit/visonaut/commit/43552ce5196448f6dee82da665c5b06863638b08), which matches all five stable source hashes in [the recorded results](./RESULTS.json). Stage B removes the product export implementation and its dedicated tests. The results below retain their original scope.

The final paged export passes a live and archived 35,820-capture regression. Every capture contains the exact hydrated profile. The independent TAR reader checks framing, all member hashes, page and payload inventories, checksum coverage, and the final completion record. The same positive test fails against the earlier monolithic export at its metadata bound.

Eight committed [regression tests](https://github.com/ariakit/visonaut/blob/43552ce5196448f6dee82da665c5b06863638b08/apps/web/src/operations/export-scale.test.ts) cover the two full fixtures, missing and corrupt metadata or entry pages, cancellation of open streams, and paged expiry with pin release. They use [synthetic storage fixtures](https://github.com/ariakit/visonaut/blob/43552ce5196448f6dee82da665c5b06863638b08/apps/web/src/operations/export-scale-fixture.ts) and an [independent reader](https://github.com/ariakit/visonaut/blob/43552ce5196448f6dee82da665c5b06863638b08/apps/web/src/operations/export-scale-reader.ts). The fixture starts with one real sealed, ready service run, then adds storage rows. Its 1,024-byte bodies test export integrity, not screenshot decoding or production image sizes.

To repeat the historical regression, use an isolated checkout of the linked source snapshot with its pinned runtime and lockfile. Run these commands in that historical checkout:

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run apps/web/src/operations/export-scale.test.ts
```

For the current checkout, use the retained cleanup, history, and recovery checks. These checks do not repeat the historical export study:

```sh
pnpm test apps/web/src/operations/operations.test.ts apps/web/src/operations/history.test.ts apps/web/src/operations/recovery.test.ts
```

The separate native local D1/R2 study verifies 35,820 captures and 10,580 distinct payloads. The resulting TAR contains 70,951,424 bytes and 11,171 members. Preparation took 20.492 seconds; preparation and verified consumption took 83.290 seconds. Export orchestration ran in Node with real Miniflare bindings. These observations do not establish hosted latency, Worker memory or CPU bounds, or admission capacity.

A separate entry-count study verifies 143,280 owned-image entries using 32-byte bodies. It produces 3,231 stored pages, a 688,475-byte root, and 147 checksum pages. This checks the count of a 35,820-original, 71,640-derived, 35,820-reference inventory. It does not reproduce those ownership relationships or payload sizes. The 200,000-entry setting leaves room for metadata/history entries; it is a format bound, not a measured throughput promise.

[Exact results and source hashes](./RESULTS.json), [native receipts](./native-result.json), and [entry-count receipts](./cardinality-result.json) preserve the separate scopes. The archived fixture includes 425 immutable history objects plus its 10,580 image payloads. The native and entry-count drivers were isolated studies; the portable eight-test regression is committed. Random export IDs change complete-TAR hashes between otherwise equivalent successful runs.
