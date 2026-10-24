---
"visonaut": patch
---

Fixed Submit failing after one dropped connection, HTTP 502, or HTTP 504 while it reserved the run, uploaded the captures, or submitted the run. Submit now retries these requests, and it also retries an image upload that hangs for 10 seconds.
