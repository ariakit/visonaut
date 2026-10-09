---
"@visonaut/web": patch
"@visonaut/service": patch
---

Fewer D1 reads in three recurring steps

Three recurring steps of the operations pass now read less from D1. The numbers are from a local D1 fixture, and each rewritten statement returns the same rows as before.

- **Review links.** The step for old review links now selects only the pull requests that need a mirror check. With 1,000 pull requests that need none, the step needs 1 pass instead of 41, and it reads about 23 times fewer rows (165,690 before, 7,250 after).

- **Webhook recovery.** An idle page of 100 deliveries now costs one batch of 2 statements instead of 300 statements, so an idle pass runs 5 statements instead of 303. The step now reads the newest page of GitHub in each pass, and then one older page. A new failed delivery therefore gets its first redelivery request in the next pass. The wait before each later request is now two times longer than the wait before it: 5, 10, 20, and 40 minutes, so the 5 requests of one delivery take 75 minutes or more. The step no longer writes a settled recovery row, an unchanged failed delivery, or an open `redelivery-exhausted` alert again in each pass.

- **Eligible runs.** The filter for the runs that can publish a check update no longer scans every snapshot for each closed accepted run. With 800 runs and 200 snapshots, it reads about 45 times fewer rows (80,816 before, 1,809 after).
