---
"@visonaut/web": patch
---

Fixed the Queue to show the title of each pull request again. A processed pull request webhook now keeps the pull request number, its title, and the repository ID in place of an empty payload, including after a database restore.
