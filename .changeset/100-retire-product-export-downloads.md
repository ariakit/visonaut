---
"@visonaut/web": minor
---

Product export endpoints are removed

**BREAKING** if you use a product export URL. After verified drain, the [export endpoints](https://github.com/ariakit/visonaut/blob/main/apps/web/src/operations/README.md#manual-evidence-export) return `404 not_found`. Use retained run history to read existing evidence, or capture a new complete run for new evidence.

Before:

```http
GET /api/exports/<export-id>
POST /api/runs/<run-id>/export
```

After:

```http
GET /api/runs/<run-id>
```

Native recovery and ordinary image retention remain available. Recovery cannot recreate expired R2 image bytes. Remove `maximumExportEntries` and `maximumMetadataBytes` from custom `VISONAUT_OPERATIONS_BUDGET` overrides; the remaining limits keep their defaults.
