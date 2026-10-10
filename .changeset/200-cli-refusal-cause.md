---
"visonaut": patch
---

Failed requests print their cause

When the service refuses a request, the CLI prints the HTTP status, and the code and the reference when they are safe to print. It never prints the message of the server.

```
visonaut: The service refused the request (HTTP 503, check_pending). Reference: 0b8f2d6e-5c1a-4e0b-9a77-3f6d2c1e8a90. No visual approval was granted.
```

A status 401 or 403 keeps exit code `4` and prints the same detail, for example `Authentication or permission failed (HTTP 403, untrusted_run). Reference: <id>. Check the credential and repository access.`

`visonaut begin` no longer replaces each failure with `The signed Submit check could not be started.` A refusal of the service now ends it with its own message, and a status 503 ends it with exit code `1` (before, `4`).
