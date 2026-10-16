---
"@visonaut/web": patch
---

The review page has no Recompare control

- **No Recompare.** The footer button **Recompare stored run** and the button **Recompare now** on a failed comparison are gone. The service has retired server comparison, so a new comparison always needs a new complete run through trusted local Submit.
- **Expired images.** A screenshot picture whose image has expired no longer sends a request that fails. The row shows its empty picture mark, and the stage shows **Image history expired**.
