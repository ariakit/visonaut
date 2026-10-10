# @visonaut/service

## 0.0.3

### Patch Changes

- 5efa4ec: The cause of a failure in the log of a scheduled service pass

  The log of a scheduled service pass now says why a step or an item failed, with three fixed values: `errorName` is the name of the error class, `code` is the fixed code of a `SecurityError`, and `upstreamStatus` is the HTTP status number that GitHub answered. A request to GitHub that got no answer has the code and no status.

  Each name and each code is on a list in the source code, and a value that is not on its list is `other`. The log gets no message text and no stack of an error.

  The line `operations_pass` has the causes of each step in `causes`, with the number of errors for each cause. For example, when GitHub answers 502 to the check result of one run:

  ```json
  {
    "event": "operations_pass",
    "failedSteps": [],
    "steps": {
      "checks": {
        "elapsedMs": 40,
        "completed": 0,
        "deferred": 0,
        "attention": 1,
        "causes": [
          {
            "errorName": "SecurityError",
            "code": "github_unavailable",
            "upstreamStatus": 502,
            "count": 1
          }
        ]
      }
    }
  }
  ```

  The lines `operation-failed`, `operations-failed`, and `baseline_promotion_step` of a pass have the same three values in `cause`. A pass that stops with an error now writes one line `operation-failed` with the operation `operations-pass`.

- ddccdd3: Fewer D1 reads in three recurring steps

  Three recurring steps of the operations pass now read less from D1. The numbers are from a local D1 fixture, and each rewritten statement returns the same rows as before.

  - **Review links.** The step for old review links now selects only the pull requests that need a mirror check. With 1,000 pull requests that need none, the step needs 1 pass instead of 41, and it reads about 23 times fewer rows (165,690 before, 7,250 after).

  - **Webhook recovery.** An idle page of 100 deliveries now costs one batch of 2 statements instead of 300 statements, so an idle pass runs 5 statements instead of 303. The step now reads the newest page of GitHub in each pass, and then one older page. A new failed delivery therefore gets its first redelivery request in the next pass. The wait before each later request is now two times longer than the wait before it: 5, 10, 20, and 40 minutes, so the 5 requests of one delivery take 75 minutes or more. The step no longer writes a settled recovery row, an unchanged failed delivery, or an open `redelivery-exhausted` alert again in each pass.

  - **Eligible runs.** The filter for the runs that can publish a check update no longer scans every snapshot for each closed accepted run. With 800 runs and 200 snapshots, it reads about 45 times fewer rows (80,816 before, 1,809 after).

- 8e06008: Stored the reason that each run closed: a newer run replaced it, the pull request closed, the merge group was destroyed, its baseline was retired, or it expired before it finished. A run that closed before this update has no stored reason.
- a15e27e: Added two counts of the comparison settings to the header of the run answer (`run.comparisonSettings`): the screenshots whose settings differ from the settings of their baseline, and the screenshots whose settings are looser than the built-in policy (threshold 0.2 and 0 pixels). Submit stores both counts, and the check result does not change.
- ddd23b8: Changed the first answer of a run page to the changed, added, and removed screenshots, with the review counts of the run and the number of unchanged screenshots. The unchanged screenshots load in pages of 2,000 when the reviewer opens their group, searches, or follows a link to one of them. Submit stores the baseline image with each changed and each removed screenshot, so the service reads this answer from the database only. A run that was submitted before this update has no stored baseline image, and its answer still reads the two capture lists of the run.
- 2487e4e: Fewer database reads for the first answer of a run page

  This update removes repeated work from the first answer of a run page:

  - **Each row is read one time.** The answer reads the run, the project, and the comparison one time each. For a run that waits for a review, the answer makes 10 database round trips instead of 13 in the local test.
  - **The read-only reason is sent one time.** The answer of a closed run has its read-only reason in the header only, and not in each screenshot.
  - **No copy of a capture list for its digest.** The service hashes the bytes of a capture list with no copy of them.

- 11987b3: Stored the review state of the run and its three review counts with each update of the GitHub check. An update that was stored before this update has no review state and no counts.
- dd568c7: Reliable delivery of check results to GitHub

  This update fixes three defects in the delivery of a check result to GitHub:

  - **A failed read sets no lock.** When a read from GitHub fails before the service sends a result, the result goes back to the queue. The service tries again after 30 seconds, and then waits two times longer after each failed read, with a maximum of 15 minutes. Each failed read uses one attempt of that result. With the default of 5 attempts, the service stops after the fifth failed read in sequence, and a newer result of the check starts again. Before this update, one failed read locked the check until a manual repair.

  - **A locked check starts no status loop.** A status pass asks for one more pass only when it completed or deferred an update.

  - **A check keeps its duration.** The service sends no update when GitHub already shows the same completed result. An update of a completed check that keeps the conclusion also keeps the first end time.

- 249e553: A decision that loses a race, and the limit of one review command

  - **Two writes at the same time.** A decision that loses the race with another write of the project still answers HTTP 409 with the current state, and nothing of it is stored. The answer now has the code `concurrent_change`, and the run page says "Conflict. Another change was saved at the same time. Check the current state and decide again."
  - **The limit of one command.** A review command with more than 200 targets now answers HTTP 400 with the code `too_many_targets`. Before, the limit was the capture limit of the service, and a larger command could fail in the database with HTTP 503. For an item with more than 200 changed variants, review the variants one at a time.
  - **Fewer rows read.** The service reads the targets of a decision by their key. In the test of one target in a comparison of 801 rows, that read is 3 rows in place of 802.

  ```json
  {
    "error": {
      "code": "concurrent_change",
      "message": "Another change was saved at the same time. Decide again."
    }
  }
  ```

- a99cb6f: Fixed the state of a closed run that failed: it is now `failed`, not `superseded`. This applies to a run that expired before its screenshots arrived, which History labeled "Replaced by a newer run", and to each run that a database restore closes.
- b991b7e: Fixed a Reject that later runs with the same pixels did not keep. A new run now gets no copy of an earlier approval after a reviewer rejected the same pixels, until a reviewer approves them again.

## 0.0.2

### Patch Changes

- 6219fdf: Reduced database writes for unchanged runs

  The native D1 service lifecycle fixture with 100 unchanged items now writes 96.5% fewer rows: 66 instead of 1,866. This measurement includes capture admission, comparison, and promotion; it excludes upload, image registration, and R2 operations.

  Complete capture inventories now stay in R2, while D1 stores changed items. Unchanged items remain available in visual review with their current capture settings.

  Reference-image downloads reuse verified image membership. In the native 4,000-capture/profile fixture, five sequential image requests now read the full inventory once instead of five times (80% fewer inventory reads), while authorization stays live on every request.

  Capture inventories and baseline imports preserve the test IDs used by existing submissions, including IDs qualified by shard.

  Existing deployments must import their accepted baseline into a fresh database before switching to this storage model. Keep the old database and images until complete Submit, review, and main promotion pass against the replacement.

## 0.0.1

### Patch Changes

- 7185786: Reduced service database calls for a fresh Approve or Reject from seven to three, about 57% fewer calls in the local decision test. Decision saves can reuse a verified GitHub permission for up to 10 seconds and return before the status Queue wakeup completes. Live session checks and atomic decision saves remain required. Repository permission removal can take up to 10 seconds to block another decision.
- 4a7906c: Reduced the result JSON payload on local comparison rows by approximately 82–90% in the representative unchanged and changed results with masks, from 148/268 bytes to 26 bytes per row. Review pages, history archives, and closed summaries preserve metrics, masks, and the effective review outcome. D1 row writes and R2 image operations are unchanged.
- 722048f: Reduced redundant D1 writes. Repeating identical profile storage performs 100% fewer row writes in the two-profile local regression fixture, from six to zero. Successful transaction checks and unchanged background cursors also avoid row writes, and status acknowledgements preserve earlier delivery times.
- 32c2029: Improved review navigation with bar indicators, compact variant links, and aligned image controls. Review decisions now update the screen before saving completes and restore the previous state if saving fails. Captures with no changed pixels no longer need approval solely because their capture profile changed.
- c30e77d: Fixed stale dashboard reviews and service alerts to retire only after stored state proves supersession or completed delivery. Invalidated current reviews now ask for a fresh Submit. Current failures and uncertain GitHub sends keep their alerts and evidence.
- 8ebf821: Keep Approve and Reject available while earlier decisions save. Store review decisions in the server queue and process them in order, so acknowledged decisions can finish after the window closes. Show which decisions are still sending, preserve command identity on retry, and pause baseline promotion until queued decisions finish.
- 7893072: Fixed validation and import of local comparisons with zero changed pixels. Existing unreviewed local results are corrected without changing saved decisions or promotions. Image size changes and profile changes with different pixels still require review.
