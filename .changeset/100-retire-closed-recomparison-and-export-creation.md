---
"@visonaut/web": minor
---

Closed-run recomparison and export creation are retired

**BREAKING** if you create a comparison from a closed run or create a product export. Closed runs now return `409 history_closed`, and new exports return `410 export_retired`. The export control is removed. A new comparison requires a fresh complete capture through trusted Submit.

Before:

```http
POST /api/runs/<closed-run-id>/recompare
POST /api/runs/<run-id>/export
```

After:

```http
GET /api/runs/<closed-run-id>
GET /api/exports/<existing-export-id>
```

Existing history keeps its original decisions, approval identities, comparison links, and explicit expired states. Existing private export downloads retain verification, leases, expiry, cleanup, and their image pins through drain. The remaining export code is retained until verified drain permits final retirement.
