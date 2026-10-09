---
"@visonaut/web": patch
---

Waits between the attempts of a queued review decision

A queued review decision whose save fails now waits before its later attempts, and a decision that failed each attempt answers with its own error code. The numbers are from a local D1 fixture.

- **Waits between the attempts.** The second attempt comes at once, as before. The third, fourth, and fifth attempts wait 5 seconds, 30 seconds, and 3 minutes or more. Before this update, the five attempts took a few seconds, so a short storage fault ended the decision.

- **A decision that failed five times.** When the page sends or reads such a decision, the service answers HTTP 409 with the error code `decision_failed` and the current review state. Before this update, the send answered HTTP 202 and the read answered HTTP 409 with the code `conflict`.

  ```json
  {
    "error": {
      "code": "decision_failed",
      "message": "This decision failed too many times and cannot run again. Review the current evidence and decide again."
    },
    "model": {}
  }
  ```

- **A stopped worker.** A decision of a worker that stopped returns to the queue after 30 seconds instead of 12 minutes.

- **Fewer D1 rows.** The read that finds the next decision reads only the decisions that wait. With 2,000 completed decisions in the table, it reads 4 rows instead of 2,002. One decision for one variant writes 25 rows instead of 28, because an unused index is removed.
