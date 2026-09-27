---
"@visonaut/web": patch
---

Made private page navigation faster by reducing GitHub identity and permission lookups from two calls to one on warm authorization checks, 50% fewer in the test fixture. Each request still checks current repository access.
