---
"@visonaut/web": patch
---

Fixed three kinds of Status page alerts that stayed open when no action could close them. The alert of an exhausted webhook redelivery now closes 3 days after it opened, because GitHub no longer lists the delivery then. The alert of an expired capture attempt now closes when retention deletes the staged images of the attempt, which normally happens in the pass that expires it, or when a newer run of the same pull request or branch is complete. The alert of a locked GitHub check whose run is closed or replaced now closes after the lock is removed.
