---
"@visonaut/web": patch
---

The run page has the frame of the settled review design

- **Header.** The run page has its own header: the way back to the Queue, the run with its commit, attempt, and baseline in a popover, the screenshot on the stage with Previous and Next, and the run progress as a bar and a count, for example `9 left`. A closed run says why it closed, for example `Closed`, or `No longer active` for a run with no stored reason. A run with loose comparison settings shows their count, for example `2 captures with loose settings`. The header has the height of the header of the list pages.
- **Variant control.** A row above the image has a stepper with the selected variant, its status mark, and its position, for example `2 / 6`. Then the row has one status mark for each variant, and each mark is a link to its variant. The variant chips are gone.
- **Opening a screenshot.** A click on a screenshot, and a link that names no variant, open the first variant that needs review, else the first variant with a change. Up, Down, and the two screenshot buttons open the variant that you selected last in that screenshot. A reload forgets it.
- **Screenshot list.** The list shows the screenshots with a change, in run order. Each row has a picture of the change, the name, the family, one status mark for each variant, and the largest change. A status select replaces the group **Accepted**: **Changes**, **Needs review**, **Rejected**, **Approved**, and **Unchanged**, which loads the unchanged screenshots by family. Up, Down, and the move to the next variant after a decision follow the screenshots that the list shows, also with a search or a status. A link to a screenshot brings its row into view, and a link to an unchanged screenshot with no variant opens it.
- **Fewer bands above the image.** The band of run facts and the heading row above the image are gone, so the image starts higher in the window.
