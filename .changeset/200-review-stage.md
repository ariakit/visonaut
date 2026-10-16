---
"@visonaut/web": patch
---

One stage for the images of a variant

The review page shows the images of the selected variant on one stage:

- **The current image with the mask.** A changed variant opens on the current image with the red mask on it. <kbd>F</kbd> shows the current image, <kbd>G</kbd> shows the baseline in the same place, and <kbd>D</kbd> turns the mask off and on. The browser remembers the mode and the mask switch.
- **The mask is evidence.** Approve and Reject stay off until the baseline, the current image, and the mask of a changed variant have loaded, passed the decode check, and have their stored size. The mask loads with the two images, also while it is off.
- **Zoom and pan.** The zoom control has Fit, Fit width, 50% to 800%, and Actual pixels. A drag pans a zoomed image, the wheel pans it, and the wheel with Ctrl or Command, or a pinch, zooms at the pointer. The zoom stays from variant to variant. The pan buttons are gone.
- **A file that is not an image.** A stored file that the browser cannot show as an image now says so, and no longer names the connection as the cause.

The two-pane view and the separate difference view are gone. The two panes come back with the swipe and the overlay in a later update.
