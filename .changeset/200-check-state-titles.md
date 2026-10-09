---
"@visonaut/web": patch
"@visonaut/security": patch
---

State titles and counts in the GitHub check

The check of a run now has one title for each state of the run, and its summary says who acts next: a maintainer, the author, or CI. Before this update, seven states had three titles.

- **Counts.** The text has the numbers of changes that need review, are rejected, and are approved, for example `79 changes need review`. Each decision that changes a count updates the check.

- **Review link.** The summary says that only a person with write access to the repository can open the run.

- **Same conclusions.** No status and no conclusion changes. A run that waits for a review stays completed with the conclusion `failure`, and a merge queue run that waits stays in progress.
