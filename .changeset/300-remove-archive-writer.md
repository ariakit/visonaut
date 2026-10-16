---
"@visonaut/web": patch
---

Removed the archive writer of closed runs and of historical comparisons, the converter of their archives, and the deletion of the old closed summary copies. No code called the writer after 2026-09-30, and production holds no archive. The scheduled pass now writes only the closed summary of a closed run whose detail is still in D1, and the Status page no longer has the alert kind `historical-archive`.
