---
"@visonaut/web": patch
---

The 413 answer of the page step names the limit that caused it. A page that takes the images of its job above the limit of the job, or an image that differs from a staged image, keeps the code `upload_limit`, and its text names the cause. A page that takes the staged images of all runs above their byte limit now gets the code `staged_limit`, so that the CLI shows the cause in `HTTP 413, staged_limit`. The text never gives the value of another run.
