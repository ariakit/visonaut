---
"@visonaut/web": patch
---

Indexed pending webhook lookups. In a local 35,302-delivery fixture with no pending work, 500 repeated lookups were 99.9% faster than the unindexed query.
