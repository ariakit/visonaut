---
"@visonaut/web": patch
---

Fixed an image error with Retry on the page of a closed run whose closed summary is late. The scheduled pass deleted the images of an older run that this page names, and Retry could not load them. The pass now keeps these images until the closed summary of the run is ready, and the page then shows "Image history expired".
