---
"@visonaut/web": patch
---

Changed the Visonaut result of a new commit from a GitHub check run to a commit status, so a click on it in a pull request opens the run in Visonaut directly. A commit that already has a Visonaut check run keeps it. A required check named `Visonaut` with the Visonaut App as its source accepts both.
