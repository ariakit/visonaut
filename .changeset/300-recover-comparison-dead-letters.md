---
"@visonaut/compare-worker": patch
"@visonaut/web": patch
---

Recovered exhausted comparison Queue deliveries promptly when their dead-letter receipt matches the current run. Repeated transport failures now leave a visible failed comparison instead of retrying without a limit.
