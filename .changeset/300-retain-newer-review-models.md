---
"@visonaut/web": patch
---

Fixed newer review evidence being lost when it arrived during a pending or failed decision save. Retries keep the original command identity and revisions, and a replacement comparison starts a separate review session.
