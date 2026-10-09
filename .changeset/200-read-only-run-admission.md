---
"@visonaut/web": patch
---

Read-only capacity check for new capture runs

The capacity check of a new capture run no longer writes to D1. In the local D1 fixture, a refused reserve call writes 0 rows instead of 3, and a new run writes 2 rows fewer. The scheduled pass still stores the capacity sample and its alerts for Service attention.

A refusal at the database size limit now answers with the code `database_size_exceeded`. The code `capacity_exceeded` now means only the limit of active runs.
