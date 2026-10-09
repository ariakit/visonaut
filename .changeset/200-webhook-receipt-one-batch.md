---
"@visonaut/web": patch
"@visonaut/security": patch
---

One D1 round trip for a webhook receipt

The service now stores the receipt of a GitHub webhook and reads it back in one D1 batch. In the local D1 fixture, the receipt needs 1 D1 round trip instead of 2. It writes the same 4 rows.

If the read fails, the batch now rolls back the insert, and the webhook answers with an error. GitHub then sends it again and the service stores it as a new receipt.
