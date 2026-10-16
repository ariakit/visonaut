---
"@visonaut/web": patch
"@visonaut/security": patch
---

Fixed Submit to check the signature of the GitHub token before it reads the database. A Submit request with a token that has no valid signature of GitHub now gets the same `401 invalid_oidc` answer for each workflow run number, also for a run that has no staged attempt, which got `404 not_found` before.
