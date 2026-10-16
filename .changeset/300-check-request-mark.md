---
"@visonaut/web": patch
"@visonaut/service": patch
"@visonaut/security": patch
---

Fixed the delivery of check results to GitHub, so that a check is locked only when a PATCH request possibly reached GitHub. A D1 error, a stopped Worker, or a failed test of the check before the PATCH now sets no lock: the update waits and tries again, and after its last attempt it asks for attention. An update that GitHub already shows sends no PATCH and sets no lock.
