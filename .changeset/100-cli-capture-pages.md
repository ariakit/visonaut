---
"visonaut": minor
---

Submit sends capture pages

**BREAKING** if you run `visonaut submit --shard` against a service that does not accept capture pages. This release sends only the page form.

Submit sends the captures of a run as pages of 2,000 rows, in the order of the item key and then the variant key. Then it sends one page index that names each page by its digest. It reads the accepted reference one page at a time, in the same order, and holds one page of the run and one page of the reference in memory. So a run has no limit for its capture count in the CLI, and a run is no longer limited to 16 capture jobs. One capture job keeps its limits: its manifest file, its archive, and 1 GiB of images.

Before:

```
POST /v1/runs                       comparisonMode: "local-v1"
POST /v1/runs/:id/shards/combined   the complete manifest
POST /v1/runs/:id/finalize          the end of the staging
```

After:

```
POST /v1/runs                       comparisonMode: "local-pages-v1"
POST /v1/runs/:id/pages             one page of 2,000 rows
POST /v1/runs/:id/index             the page index
```

The service of visonaut.com accepts only the page form after its switch. Then it answers an earlier CLI with the status 409 and the code `capture_pages_required`, and the earlier CLI stops. A service that does not know the page form answers the new CLI with `visonaut: The service refused the request (HTTP 400, comparison_mode). No visual approval was granted.`

Messages that change:

- The success text is now `The captures are staged and run <id> is submitted. Visonaut will verify the complete workflow.`
- Submit prints how many originals it staged and how many capture pages it sent.
- A page above 4 MiB stops Submit with a message that asks for shorter test titles.
- `Submit requires --no-visual or 1–16 --shard pairs.` is now `Submit requires --no-visual or at least one --shard pair.`
- `The shard exceeds the 1 GiB encoded-image limit.` is now `A capture job exceeds the 1 GiB encoded-image limit.`
