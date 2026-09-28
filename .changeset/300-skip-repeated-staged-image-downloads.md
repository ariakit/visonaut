---
"@visonaut/web": patch
---

Reduced repeated image downloads during Submit conversion. In the current-run upload and reuse test fixtures, the second download fell from one per image to zero; older images still receive full byte verification.
