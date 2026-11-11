---
"@visonaut/web": patch
---

Changed the Visonaut result of a commit from a GitHub check run to a commit status, so a click on it in a pull request opens the run in Visonaut directly. A check run from before this change keeps its last result and gets no more updates. A required check named `Visonaut` with the Visonaut App as its source accepts the status, but GitHub requires both on a commit that also has an old check run, so such a commit whose check run did not pass needs a new commit.
