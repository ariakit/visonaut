---
"visonaut": patch
---

Retried the GitHub Actions OIDC token request after a temporary failure. Submit now repeats the request after an HTTP 500, 502, 503, or 504 answer, a network error, or a timeout, with the same backoff as the reference reads and the `Retry-After` header of GitHub. After the last attempt, a 5xx answer says that GitHub Actions could not issue the token and that a rerun of the job can work, and no longer names the `id-token: write` permission. An HTTP 401 or 403 answer is not repeated, and its message stays.
