---
"@visonaut/web": patch
"@visonaut/service": patch
---

Reduced database writes for unchanged runs

The native D1 service lifecycle fixture with 100 unchanged items now writes 96.5% fewer rows: 66 instead of 1,866. This measurement includes capture admission, comparison, and promotion; it excludes upload, image registration, and R2 operations.

Complete capture inventories now stay in R2, while D1 stores changed items. Unchanged items remain available in visual review with their current capture settings.

Reference-image downloads reuse verified image membership. In the native 4,000-capture/profile fixture, five sequential image requests now read the full inventory once instead of five times (80% fewer inventory reads), while authorization stays live on every request.

Capture inventories and baseline imports preserve the test IDs used by existing submissions, including IDs qualified by shard.

Existing deployments must import their accepted baseline into a fresh database before switching to this storage model. Keep the old database and images until complete Submit, review, and main promotion pass against the replacement.
