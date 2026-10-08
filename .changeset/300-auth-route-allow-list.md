---
"@visonaut/web": patch
---

Closed the auth routes that sign-in does not use. Only the sign-in, callback, sign-out, and error routes answer, each other path below `/api/auth/` answers 404, and the unused `/api/session` route is removed.
