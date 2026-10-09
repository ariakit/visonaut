---
"@visonaut/web": patch
"@visonaut/service": patch
---

Added two counts of the comparison settings to the header of the run answer (`run.comparisonSettings`): the screenshots whose settings differ from the settings of their baseline, and the screenshots whose settings are looser than the built-in policy (threshold 0.2 and 0 pixels). Submit stores both counts, and the check result does not change.
