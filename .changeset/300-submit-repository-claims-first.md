---
"@visonaut/web": patch
"@visonaut/security": patch
---

Fixed Submit to check the repository claims of the GitHub token before it reads the database. A Submit request with a valid GitHub token of another repository, or of another repository owner, now gets the same `403 untrusted_run` answer for each workflow run number, also for a run that has no staged attempt, which got `404 not_found` before.
