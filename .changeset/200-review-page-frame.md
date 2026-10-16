---
"@visonaut/web": patch
---

The run page has the frame of the settled review design

- **Header.** The run page has its own header: the way back to the Queue, the run with its commit, attempt, and baseline in a popover, the screenshot on the stage with Previous and Next, and the run progress as a bar and a count, for example `9 left`. A closed run says why it closed, for example `Closed`, or `No longer active` for a run with no stored reason. A run with loose comparison settings shows their count, for example `2 captures with loose settings`. The header has the height of the header of the list pages.
- **Variant control.** A row above the image has a stepper with the selected variant, its status mark, and its position, for example `2 / 6`. Then the row has one status mark for each variant, and each mark is a link to its variant. The variant chips are gone.
- **Opening a screenshot.** A click on a screenshot, and a link that names no variant, open the first variant that needs review, else the first variant with a change. Up, Down, and the two screenshot buttons open the variant that you selected last in that screenshot. A reload forgets it.
- **Fewer bands above the image.** The band of run facts and the heading row above the image are gone, so the image starts higher in the window.
