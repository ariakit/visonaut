---
"visonaut": patch
"@visonaut/web": patch
"@visonaut/security": patch
---

Fixed Submit failing at once when the service could not reach GitHub because of a GitHub server error, timeout, or network error (HTTP 503, `github_unavailable`). The service now marks these errors as retryable, and Submit retries them with a growing wait within the same deadline. Submit still stops at once when GitHub refuses the request in a way that repeats, such as a missing resource or a rate limit.
