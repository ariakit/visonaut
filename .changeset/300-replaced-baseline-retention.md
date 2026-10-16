---
"@visonaut/web": patch
---

Replaced baselines no longer keep their images without end

A replaced baseline now keeps its images for 30 days after the newer run closes. The scheduled maintenance pass then deletes these images. Before this change, each main run kept the images of the runs before it, so the images of each replaced baseline and of the imported baseline stayed in storage.

The current baseline, each open run, and each run with a manual pin still keep every image that they show. The capture inventories, the comparison rows, and the decisions of a run stay.
