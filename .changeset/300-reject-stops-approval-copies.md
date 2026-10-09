---
"@visonaut/service": patch
---

Fixed a Reject that later runs with the same pixels did not keep. A new run now gets no copy of an earlier approval after a reviewer rejected the same pixels, until a reviewer approves them again.
