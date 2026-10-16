---
"@visonaut/web": patch
---

Removed the updates of the second check that Visonaut kept on the head commit of a pull request whose check is on its merge commit, which is the form from before 2026-10-02. That check keeps the text of its last update, and the operations pass no longer reads such a pull request from GitHub. The service closes the open alerts of that check at the deploy.
