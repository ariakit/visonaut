---
"@visonaut/web": patch
---

Fixed the webhook step of the scheduled pass, which tried more `workflow_run` deliveries again in each pass and kept the alert "The webhook step failed" open. A `requested` or `in_progress` delivery of a pull request run whose check already failed now ends when the pull request has a newer head or another target branch. A delivery of a run whose head has two recorded candidates with no check now ends when the pull request closes or moves.
