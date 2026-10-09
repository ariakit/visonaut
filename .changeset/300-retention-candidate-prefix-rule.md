---
"@visonaut/web": patch
---

Image retention continues after runs with a refused storage prefix

An expired run with a storage prefix that the service refuses to delete is no longer a deletion candidate. Before this change, 25 such runs (one page of candidates by default) stopped the deletion of the images of each later run.

A run with a refused prefix keeps its images. It no longer raises the `unsafe-prefix` service alert on each maintenance pass.
