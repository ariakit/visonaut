---
"@visonaut/web": minor
"@visonaut/security": minor
---

Submit accepts capture pages

**BREAKING** if a workflow uses `visonaut` 0.5.4 or earlier for Submit. The service now accepts only the page form of a Submit, which a later release of the CLI sends.

A Submit job now sends the captures of a run as pages of 2,000 rows and one page index, and it reads the accepted reference one page at a time. The service stores the pages and the index as the capture list of the run. A run with more captures than the capture limit gets the code `capture_limit_exceeded` at the page that takes it above the limit, before the uploads of that page.

A Submit of an earlier CLI gets the status 409 with the code `capture_pages_required` and this message: "The service accepts only capture pages. Upgrade the Visonaut CLI and run Submit again." No capture of that Submit is stored.

The route of a shard path (`POST /v1/runs/:id/shards/:key`) is gone, and with it the answer `400` with the code `invalid_path` for a percent sequence that is not valid.

Before:

```json
{ "comparisonMode": "local-v1" }
```

After:

```json
{ "comparisonMode": "local-pages-v1" }
```

The accepted baseline keeps its stored form until the next run of main replaces it, and a Submit in pages compares against it. For a run with no changed, added, or removed capture, the number of D1 rows that one Submit writes does not grow with the number of captures.
