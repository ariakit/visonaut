---
"@visonaut/web": patch
---

Improved Submit conversion for runs with many screenshots. In the 50-original regression fixture, image registration now uses one D1 batch instead of 50, a 50× reduction in registration batches. Every original still receives a full SHA check before registration.
