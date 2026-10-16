---
"@visonaut/web": patch
---

Marks, texts, and states on the review stage

The stage of the review page now points to each change and says the state of its images in one place:

- **Marks of the changes.** A box marks each changed region on the current image, and a click on a box zooms to its region. A size change has no mask: a band marks the rows and the columns that only one image has, and the stage says "Size changed" with the two sizes. <kbd>D</kbd> turns the boxes off and on with the mask.
- **States inside the stage.** The state of a variant (added, removed, not uploaded, size changed, comparing), a load that takes more than 400 ms, and each image error with Retry images show in one row at the top of the stage, so the stage does not move. When the browser is online again, the images that failed to load load again.
- **The pixel line.** The line above the stage says "1 changed pixel" for one pixel and "< 0.01%" for a ratio that rounds to zero. A size change says "Size changed" with the two sizes, and an added or a removed variant has no pixel line. The screenshot list also prints "< 0.01%".
