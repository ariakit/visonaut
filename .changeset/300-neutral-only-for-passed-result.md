---
"@visonaut/web": patch
---

Fixed the check of a regenerated pull request merge commit to close as `neutral` only after the tested result passed. While the tested result has not passed, that check stays pending.
