---
"@visonaut/web": patch
"@visonaut/service": patch
---

Submit reads the capture lists one page at a time, and the capture limit is 20,000

In the heap test of Submit in local workerd, one Submit of 11,000 captures with 4 changed captures held 3.2× less live heap (5.6 MB in place of 18.1 MB), and one of 50,000 captures held 7.2× less (11.4 MB in place of 81.5 MB). Submit validation, materialization, the reference selection, promotion, and the recovery check now read the pages of a capture list one at a time, and keep only a short value for each capture for the checks across the pages.

The capture limit of a run is now 20,000 captures (before, 11,000). A Submit with more captures still gets the code `capture_limit_exceeded`. In the same heap test, a Submit of 20,000 captures held 7.3 MB with 4 changed captures, and 62.9 MB when each capture changed.

The materialization of a run of 11,000 captures also makes fewer D1 requests (287 statements and 72 round trips in place of 493 and 174), and it writes the same rows.
