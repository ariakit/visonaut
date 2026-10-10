---
"@visonaut/playwright": patch
---

`visual` and `visualBatch` check the image bounds of Submit

`visual` and `visualBatch` now fail a capture that Submit would refuse: an image above 2 MiB encoded, above 2.1 million pixels, or with a side above 8,192 pixels. The test fails in the capture job, with the item key and the variant key, and not later in the Submit job.

```
dialog/open (react-light): 1248x1700 is 2,121,600 pixels. The limit is 2,100,000.
```

The adapter message `Capture exceeds the encoded image limit` (20 MiB) is replaced by the 2 MiB check, which names the item. A screenshot above the memory limits of the adapter (32 million pixels or 20 MiB) still fails earlier, with no item name.
