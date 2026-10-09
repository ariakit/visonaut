---
"@visonaut/web": patch
---

One failure no longer stops a service pass

This update fixes two cases in which one failure stopped the other work of a scheduled service pass:

- **A review decision during a check update.** When a review decision is saved while the pass prepares the check update of a run, the pass now reads that run one more time and then continues with the next run. Before this update, the pass then sent no check update to GitHub and raised a service alert.

- **A failed step at the start or at the end of a pass.** A failure in the retirement of replaced main runs, in the finalization of comparisons, or in the cleanup of expired exports now raises a service alert for that step, and the pass continues with its other steps. The alert closes after the next pass that completes the step. Before this update, a failure at the start of a pass stopped the complete pass, which includes the delivery of check results and the cleanup of expired images.
