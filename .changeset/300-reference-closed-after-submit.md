---
"@visonaut/web": patch
---

Fixed the reference page route and the reference image route to refuse a run that is already submitted. They now answer `409 closed_shard`, as the other ingest routes do. The CLI reads the reference before it submits, so a Submit of the CLI is not affected.
