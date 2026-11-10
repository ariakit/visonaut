---
"@visonaut/web": patch
---

Fixed the webhook step of the scheduled pass, which tried some `workflow_run` deliveries again in each pass and kept the alert "The webhook step failed" open. When a push to a pull request came during the creation of its Visonaut check, the check stayed in progress on the old head. Now the completed delivery of the run fails that check when the pull request is closed or has another head or another target branch, and each delivery of the run ends. The log of the step also gives the message of an incomplete-capture error, so a signed capture run that cannot convert names its cause.
