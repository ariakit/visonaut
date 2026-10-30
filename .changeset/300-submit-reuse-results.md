---
"visonaut": patch
"@visonaut/web": patch
---

Submit reuses stored comparison results

Submit no longer downloads and decodes the reference of a capture when the last accepted run compared the same bytes and found no changed pixel. In a model over the stored rows of 24 `ariakit/ariakit` main runs, the reference downloads of a run go from a mean of 3,239 to 141.

The first Submit after a CLI update compares each capture again, because another version can have another comparator.
