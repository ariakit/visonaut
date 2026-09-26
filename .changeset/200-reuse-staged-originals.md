---
"visonaut": patch
---

Reduced image-transfer HTTP requests by 89% in a 67-image local fixture exercised through `visonaut upload --dir`, with 66 unchanged originals (71 requests to 8). `visonaut submit` uses the same transfer path to prove it has each image before reusing retained bytes, then uploads images that cannot be reused.
