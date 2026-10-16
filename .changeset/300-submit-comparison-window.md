---
"visonaut": patch
---

Faster comparison of changed captures in Submit

Submit compared 4,000 small captures 7.5× faster in a local benchmark, where half of the captures differ from their reference by bytes and each reference download has a simulated delay of 100 ms. Submit now keeps up to 32 reference downloads in flight while it compares the captures in order, in place of groups of 8 that waited for each other. The encoded references in memory stay at most 16 MiB.

Submit also prints the time of each phase, so that the job log shows where the time goes:

```text
Visonaut prepared <count> captures in <time>: <time> for the capture artifacts, <time> for the bundle checks, <time> for the capture records, <time> for the session.
Visonaut compared <count> captures in <time>: <time> waiting for reference images, <time> decoding and comparing, <time> reading reference pages, <time> staging pages.
```
