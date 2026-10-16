---
"visonaut": patch
---

Faster image checks and comparisons in Submit

In a local benchmark of 4,000 captures of 1000x700 pixels that differ from their reference by bytes, Submit with 3 image workers (the count on a GitHub runner with 4 cores) did the bundle checks 3.1× faster (25.7 s in place of 79.6 s) and the comparison 2.8× faster (60.8 s in place of 169.9 s). Submit now decodes and compares the images on worker threads. The count of workers is one less than the available parallelism of the computer, at least 1 and at most 4. Each worker holds at most one decoded image pair and one mask, and the results keep the order of the captures.

The comparison line of the log now shows the count of image workers:

```text
Visonaut compared <count> captures in <time> with <count> image workers: <time> waiting for reference images, <time> decoding and comparing, <time> reading reference pages, <time> staging pages.
```
