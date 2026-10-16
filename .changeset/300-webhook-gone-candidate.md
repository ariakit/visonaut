---
"@visonaut/web": patch
---

Fixed the webhook step of the scheduled pass, which tried some `workflow_run` deliveries again in each pass and kept the alert "The webhook step failed" open. A delivery of a run that a newer push canceled before its Plan reported now ends when main moved, or when its pull request has a newer head or another target branch. The log of the step now names each delivery that it could not end, with the message of its error.
