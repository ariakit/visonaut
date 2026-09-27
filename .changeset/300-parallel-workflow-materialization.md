---
"@visonaut/web": patch
---

Verified staged originals in bounded parallel batches during Submit conversion. In the five-original regression fixture, four R2 reads overlapped, a 4× increase over one-at-a-time verification. Each original still receives a full digest check before its image is registered.
