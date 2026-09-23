# Fully reviewed archive capacity

A local storage-shape regression exposed a deterministic archive failure: a 35,820-capture run with one approval per changed capture reached the 4,096-page limit. It stopped before the ready transition with a 1,693,426-byte checkpoint. That fixture did not yet include derived-image inventory.

The writer now stores ordinary and image sections at up to 200 rows per page. Capture, reference-capture, command and raw-document pages stay at 100 rows. SQL measures encoded row sizes before loading a page, with a 1 MiB target. Command preparation yields after one page. The 4,096-page limit, 1,900,000-byte checkpoint limit, object bound and UI fallback bound remain unchanged. Both cold export image queries use one JSON array binding, so 200-image pages do not require 200 D1 parameters.

The final local fixture contains 35,820 reviewed candidate captures, a matching baseline, 35,820 approval commands, and 71,640 synthetic derived-image inventory rows. The fixture uses real service review transitions for 359 targets and replicates their single-target record shape for the remaining approvals. It does not run the capture or comparator at this scale, and it does not generate or measure the added derived PNG payloads.

| Result                | Run archive | Historical supplement |
| --------------------- | ----------: | --------------------: |
| Pages                 |       3,395 |                 1,799 |
| Peak checkpoint bytes |   1,414,050 |               787,479 |
| Largest page bytes    |   1,042,764 |               311,638 |
| Writer invocations    |         681 |                   180 |

The run root is 1,414,560 bytes. All 107,460 image inventory rows, 71,640 artifact pointers, 35,820 command payloads and retained decisions matched. Every page passed its hash check. Foreign-key checks passed. The run reached ready and compacted detail; the historical supplement compacted terminal rows and released its manual pin.

[Run receipts](./run-verified.json), [supplement receipts](./supplement-verified.json), [tested bundle hashes](./BUNDLES.json), and [fix source hashes](./HASHES.json) preserve the exact measured state. [Committed packing tests](../../../apps/web/src/operations/history-packing.test.ts) cover bounded command preparation and 206 image identities across 200-row and 6-row pages. The format tests retain support for older 100-row pages.

```sh
pnpm exec vitest run apps/web/src/operations/history-packing.test.ts apps/web/src/operations/history-format.test.ts
```

The full local study ran under a 96 MiB Node JavaScript heap cap. Sampled JS heap and ArrayBuffer maxima were separate observations; native SQLite memory was outside that heap. This is not a hosted Worker peak-memory or throughput proof. Earlier hosted archive costs use the previous packing policy and cannot establish the cost of this final writer. The full synthetic fixture driver was an isolated implementation study; the smaller committed regressions provide the portable code checks.
