# Local comparison result consolidation

New local comparison rows store `{"$visonautLocalResult":1}` in `result_json`. The existing `candidate_capture_id` identifies the immutable `metadata_json.localResult`. Readers restore inline JSON and set its outcome from the comparison row. Inline legacy and server results pass through unchanged. Removed rows keep `NULL`.

## Ownership and lifetime

Capture import and run sealing finish before comparison creation. Sealed recovery can create the comparison from the existing captures. The comparison row's foreign key prevents capture deletion while the row refers to it. Snapshot membership can keep a capture after comparison details are cleared. Inherited shards copy the original metadata and receive their own capture IDs.

The signed original result must remain on the capture. Current policy can normalize a signed `changed` result to an effective `unchanged` review without changing that original result. A capture pointer to a comparison row would reverse this lifetime dependency and require extra import and cleanup state.

History exports and comparison supplements resolve results before serialization. Closed summaries resolve results before clearing capture metadata and row references. Archive read limits use the resolved JSON string's encoded bytes. Invalid marker shapes, unsupported versions, missing captures, and missing local results fail the read or conversion.

## Storage and operation evidence

These are representative JSON payload sizes, not database file sizes or production totals. The two examples below have 148 and 268 UTF-8 bytes. The marker has 26 ASCII bytes. The savings are 122 and 242 bytes per comparison row. The original capture result remains stored.

```json
{"outcome":"unchanged","changedPixels":0,"ratio":0,"engineVersion":"playwright-pixelmatch-1.63.0","codecVersion":"pngjs-7.0.0","maskExpected":false}
{"outcome":"changed","changedPixels":100,"ratio":0.123456789,"engineVersion":"playwright-pixelmatch-1.63.0","codecVersion":"pngjs-7.0.0","maskExpected":true,"maskImageId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","thumbnailImageId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}
{"$visonautLocalResult":1}
```

The small native Miniflare D1 fixture in `apps/web/src/operations/result-consolidation.test.ts` inserts one inline row and one referenced row through the same statement and indexes. Both report six `meta.rows_written` and three `meta.rows_read`. The D1 row-write reduction is zero. This fixture is a functional comparison, not a scale model or capacity test. Set `VISONAUT_D1_COST_REPORT` to save its native metadata as JSON lines.

Image and mask storage remains in R2. The result writer and resolver make no R2 requests. The review test verifies that comparison creation does not add an image write. Archive page packing can change when resolved results are larger than markers; archives retain the same complete inline result payload as before this change. No R2 operation saving is claimed.

## Verification and release

Focused tests cover review metrics and stored masks, approval and Undo, original versus effective outcomes, sealed recovery, inherited shards, borrowed baseline images, inline results, invalid references, closed summaries from live and archived data, comparison supplement images, and bounded archive reads.

The red checks temporarily return raw row JSON, omit effective outcome replacement, and restore the old inline writer. Each produces an expected test failure. Restore the exact source and patch before the green run.

The web Worker owns the local writer, review reader, queue operations, archives, and closed summaries. The repository has no independently deployed live D1 result consumer. Ship writer and readers in the same Worker release. A forward rollback must retain marker readers for rows already written. No feature flag, extra table, index, migration, backfill, or staged release subsystem is needed.
