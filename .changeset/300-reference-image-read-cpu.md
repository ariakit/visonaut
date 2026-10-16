---
"@visonaut/web": patch
---

Improved the reference image route of Submit to use less Worker CPU time on the first read of a reference in an isolate. In a local measure with a reference of 4,000 captures, the check of an image against the reference used about 60 to 100 times less CPU time on that first read. The answers of the route do not change.
