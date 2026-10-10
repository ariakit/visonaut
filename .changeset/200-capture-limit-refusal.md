---
"@visonaut/web": patch
---

A capture limit of 11,000 and its own refusal code

A Submit with more captures than the capture limit of a run now gets the code `capture_limit_exceeded`, and the message names the limit. Before, the code was `upload_limit`, which is also the code of the byte limits.

The service refuses such a Submit before it reads the reference and before it stages an image. The capture limit of a run is now 11,000 (before, 40,000), and the HTTP status stays 413. A Submit with 11,000 captures or fewer has no change.
