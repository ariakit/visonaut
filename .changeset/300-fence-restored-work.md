---
"@visonaut/web": patch
"@visonaut/security": patch
---

Fixed native database recovery to keep old captures, checks, and webhooks inactive and reject workflow identities issued before restoration. New captures require a fresh Plan and check generation, while accepted history remains available.
