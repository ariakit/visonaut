---
"@visonaut/playwright": patch
---

Captures compare the bytes of two screenshots before they decode them

The stability loop of [`visual`](https://github.com/ariakit/visonaut/blob/main/packages/playwright/README.md) and [`visualBatch`](https://github.com/ariakit/visonaut/blob/main/packages/playwright/README.md) now accepts two consecutive screenshots with equal bytes with no PNG decode and no pixel compare. Equal bytes always mean equal pixels. Each screenshot decodes at most one time, and the crops of a batch reuse the decoded pixels of the compare.

On a stable 1280 by 1600 page in Chromium, one `visual` call is about 14% faster, a median of about 369 ms before and about 318 ms after (the mean of two runs of 15 captures each). The PNG bytes and the digests of every capture do not change.
