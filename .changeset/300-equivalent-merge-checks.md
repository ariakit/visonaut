---
"@visonaut/web": patch
---

Fixed duplicate GitHub checks that stayed pending when GitHub regenerated an equivalent pull request merge, including after the pull request was squash merged. The unused check now closes with a neutral result and links to the completed Visonaut run.
