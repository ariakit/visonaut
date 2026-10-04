---
"@visonaut/web": patch
"@visonaut/service": patch
---

Reduced database writes for unchanged runs

The native D1 service lifecycle fixture with 100 unchanged items now writes 96.5% fewer rows: 66 instead of 1,866. This measurement includes capture admission, comparison, and promotion; it excludes upload, image registration, and R2 operations.

Complete capture inventories now stay in R2, while D1 stores changed items. Unchanged items remain available in visual review with their current capture settings.

Existing deployments must import their accepted baseline into a fresh database before switching to this storage model. Keep the old database and images until complete Submit, review, and main promotion pass against the replacement.
