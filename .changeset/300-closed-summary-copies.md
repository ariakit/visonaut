---
"@visonaut/web": patch
---

Stopped the copies of the closed summary. The summary of a closed run no longer copies its comparison rows and its decisions into the summary tables, and the scheduled pass deletes the earlier copies in parts of a fixed size. The page of a closed run that is older than 30 days now reads its rows and its decisions in D1, with the change metrics of each row, and takes the names of its captures from its capture list.
