---
"@visonaut/web": patch
"@visonaut/service": patch
---

One review command approves the changes of a run

- **The command.** A run approval approves each change of the run that has no decision, in one transaction. The request names the run revision and the count of these changes that the page shows, and no list of changes. The service selects the changes, and it saves nothing when the run revision or the count differs. A rejected variant and a failed comparison are not changes of the approval. A variant whose pixels a reviewer rejected in an earlier run is one.
- **Undo.** One Undo sets each change of the approval back to its earlier state, also in one transaction.
- **A refused approval.** When D1 refuses the transaction, no decision is saved, and the command fails as each other stored decision: after the fifth attempt, the answer has the code `decision_failed`. The status line then says "Not saved. The approval of the run failed. Approve one screenshot at a time, or try again."
- **Fewer writes.** In local D1, a run approval of 246 changes in 41 screenshots writes 1,238 rows, and the same approvals screenshot by screenshot write 1,558.

The review page gets the menu item of the run approval in a later version.
