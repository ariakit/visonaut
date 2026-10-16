---
"@visonaut/web": patch
---

The pull request page reads fewer rows while it waits

A pull request link with no check ID now looks up the newest check only at each fourth read. The reads between two lookups use the check ID that the service names, and each of them reads one row and not each pull request check of the table. The page still opens the run of a newer head commit, at the next lookup.

A pull request page for a check that is not found now shows the GitHub link, because the 404 answer carries the repository.
