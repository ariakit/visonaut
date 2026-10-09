---
"@visonaut/web": patch
---

Fixed the review page to name the true cause of a failed request, such as "No connection." for a failed fetch, and "not available" with the time of `Retry-After` for a 5xx answer that is not JSON.
