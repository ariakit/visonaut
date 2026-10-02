---
"@visonaut/web": patch
---

Fixed visual reviews that could remain pending if comparison creation failed after uploads completed. Submitted runs now retry comparison creation automatically, and retry alerts remain visible until a comparison exists.
