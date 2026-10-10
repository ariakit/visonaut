---
"visonaut": patch
---

Reduced the PNG decodes of Submit for an unchanged or a new capture from two to one, which halves the decode work of such a capture. A capture that needs a pixel comparison keeps its decodes.
