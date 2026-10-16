---
"@visonaut/web": patch
---

Fixed the delivery recovery after a database restore, so that a failed GitHub delivery from after the restore gets its redelivery requests also when its first pass had no request left. A delivery from before the restore still gets no request.
