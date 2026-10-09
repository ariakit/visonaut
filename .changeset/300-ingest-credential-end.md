---
"@visonaut/web": patch
"@visonaut/security": patch
---

Fixed the reference page of a Submit to return an ingest credential that ends at the same time as the credential of the request. An ingest credential now ends 10 minutes after the identity check of its reserve call, and the CLI renews it with a new reserve call, as before.
