---
"@visonaut/web": patch
---

Fixed pull request reviews to keep their signed reference when main advances. Reference reads, trusted Submit, review decisions, Undo, and the required GitHub check now remain valid for the same pull request head and attempt. The required check is also published on the pull request head, so GitHub can still find it after rebuilding the merge commit. New pull request heads and attempts still replace older runs.
