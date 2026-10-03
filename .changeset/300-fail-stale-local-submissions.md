---
"@visonaut/web": patch
---

Fixed visual checks that stayed pending when a trusted main Submit receipt used an old baseline. Unsealed uploading runs now fail without releasing their retained evidence, so a new trusted Submit attempt can use the current reference.
