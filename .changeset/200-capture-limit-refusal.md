---
"@visonaut/web": patch
---

A refusal code for a run above the capture limit

A Submit with more captures than the capture limit of a run now gets the code `capture_limit_exceeded`, and the message names the limit. Before, the code was `upload_limit`, which is also the code of the byte limits.

The service refuses such a Submit before it reads the reference and before it stages an image. The limit and the HTTP status 413 do not change.
