---
"@visonaut/web": patch
---

Service alerts close when their cause is gone

This update fixes when the scheduled service pass opens and closes its alerts:

- **Alerts of a closed run.** A promotion alert now closes in the next pass after its run closes or is accepted. It also closes when the run no longer waits for its promotion: its comparison is no longer ready, or the run no longer has the status `passed`. A check creation alert of a closed run closes in the same way, except the alert with the code `ambiguous`: that check can still be in progress on GitHub. Before this update, these alerts stayed open until a person changed the database.

- **No alert while a new run is not ready.** A signed capture run whose Submit job still runs no longer raises the alert `staged` of the step. The pass tries the run again, and a run that fails 5 times still gets its own alert.

- **The alert of a failed pass.** Only a recovery pass now closes the alert `runtime`. Before this update, a pass of any kind closed it, also when the failed recovery pass did not run again.

A pass now closes the alerts of its completed steps with 2 statements. Before this update, a recovery pass ran 19 statements for them, and each one read the complete alert table. With 100 closed alerts in a local D1 fixture, the steps of an idle recovery pass read about 2.4 times fewer rows (2,035 before, 842 after) and write 0 rows as before.
