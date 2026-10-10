# @visonaut/web

## 0.3.0

### Minor Changes

- 3382767: Submit accepts capture pages

  **BREAKING** if a workflow uses `visonaut` 0.5.4 or earlier for Submit. The service now accepts only the page form of a Submit, which a later release of the CLI sends.

  A Submit job now sends the captures of a run as pages of 2,000 rows and one page index, and it reads the accepted reference one page at a time. The service stores the pages and the index as the capture list of the run. A run with more captures than the capture limit gets the code `capture_limit_exceeded` at the page that takes it above the limit, before the uploads of that page.

  A Submit of an earlier CLI gets the status 409 with the code `capture_pages_required` and this message: "The service accepts only capture pages. Upgrade the Visonaut CLI and run Submit again." No capture of that Submit is stored.

  The route of a shard path (`POST /v1/runs/:id/shards/:key`) is gone, and with it the answer `400` with the code `invalid_path` for a percent sequence that is not valid.

  Before:

  ```json
  { "comparisonMode": "local-v1" }
  ```

  After:

  ```json
  { "comparisonMode": "local-pages-v1" }
  ```

  The accepted baseline keeps its stored form until the next run of main replaces it, and a Submit in pages compares against it. For a run with no changed, added, or removed capture, the number of D1 rows that one Submit writes does not grow with the number of captures.

### Patch Changes

- Updated dependencies [3382767]
  - @visonaut/security@0.1.0

## 0.2.4

### Patch Changes

- 6944de9: Replaced the copied Ariakit UI primitives with an exact copy of upstream, so all 27 components are available and the Inter font that the theme names is installed.
- a317c19: A capture limit of 11,000 and its own refusal code

  A Submit with more captures than the capture limit of a run now gets the code `capture_limit_exceeded`, and the message names the limit. Before, the code was `upload_limit`, which is also the code of the byte limits.

  The service refuses such a Submit before it reads the reference and before it stages an image. The capture limit of a run is now 11,000 (before, 40,000), and the HTTP status stays 413. A Submit with 11,000 captures or fewer has no change.

- fb11552: Cheaper access check for each private request

  The access check of a signed-in request now does less work in D1 and sends fewer requests to GitHub:

  - **No schema check on a request.** The sign-in library no longer compares the database schema with its own schema on each request. A test makes that comparison with the numbered migrations.
  - **One statement for the session and its user.** The service reads both rows with one join.
  - **The project read beside the session read.** A private API request reads the project row and the session at the same time. When the project configuration is wrong, the answer of the access check now comes before the answer of the project check.
  - **A stored result after each live check.** A positive result of a live GitHub permission check, also of a write, serves later reads for at most 60 seconds and later Approve or Reject decisions for at most 10 seconds. Each other write still makes its own live check.

- af58cce: State titles and counts in the GitHub check

  The check of a run now has one title for each state of the run, and its summary says who acts next: a maintainer, the author, or CI. Before this update, seven states had three titles.

  - **Counts.** The text has the numbers of changes that need review, are rejected, and are approved, for example `79 changes need review`. Each decision that changes a count updates the check.

  - **Review link.** The summary says that only a person with write access to the repository can open the run.

  - **Same conclusions.** No status and no conclusion changes. A run that waits for a review stays completed with the conclusion `failure`, and a merge queue run that waits stays in progress.

- f84a6ea: Changed the answer of a saved decision to its receipt. The answer has the stored result of the decision, the reviewer, the review state of the run with its three counts, and the run revision at the time of the answer. It has no run model. The run page applies the receipt to the model that it holds, and it reads the model again only when the run revision is not the one that it expects, for example after a decision of another reviewer. In the test of one decision, the read of a receipt makes 6 database round trips in place of 17. A conflict, a decision that failed each attempt, and Undo still answer with the model.
- 706409c: Added the commit of the deployed version to the `/health` answer as `version`, and each production deploy now reads it back.
- 260b0d7: No receipt for a GitHub webhook that starts no work

  The service now writes nothing to D1 for a GitHub webhook that can start no work. It checks the signature, the repository, and the installation as before. Then it writes one log line with the event name and the delivery ID, and it answers `202`. In the local D1 fixture, such a webhook needs 1 statement and writes 0 rows. Before, it needed 6 statements and wrote 4 rows.

  ```json
  {
    "event": "webhook-no-work",
    "githubEvent": "check_run",
    "deliveryId": "0f2d4c1e-9a7b-4c3d-8e5f-6a1b2c3d4e5f"
  }
  ```

  These webhooks get no receipt:

  - A `check_run` event that is not the successful end of the Submit job.
  - A `push` event for a ref that is not `refs/heads/main`.
  - A `ping` event.
  - Each event that the service has no handler for.

  The service stores each other webhook as before, with its receipt in the table `github_webhook_delivery`. It deletes no stored receipt.

  No D1 row says that a webhook with no work arrived: the log line is its only record.

  The delivery recovery no longer needs a receipt as the proof that a delivery arrived. When GitHub lists a delivery as failed, and later lists a successful delivery for the same ID, the recovery sends no more redelivery request for that ID and opens no alert for it. Before, only a receipt stopped the requests.

  The Status page text for a delivery with no redelivery request left no longer asks for a receipt. It now says to verify that GitHub lists the new delivery as successful.

- 1e1e8bb: One base text size for each page

  Each page sets a base text size of 14px, and controls and other text take it instead of 13px.

  - The pull request page and the run page, which used 16px, now use 14px.
  - The smallest texts, which were 10px and 11px, are now 12px.
  - The title of the review page is now the upstream heading at 24.5px for every width, where it was 24px or 28px. Its line is a little shorter.
  - A few small buttons are about 4px lower, because they no longer force a 20px line.

- 802d261: One header for each page

  Each page now has the same header, and a click on one of its links changes the page with no reload of the document.

  - **Page names.** The links of the header are `Queue`, `History`, and `Status`. The Queue link has the number of runs to review.

  - **Alerts.** The link `Status` has the number of open service alerts, and it is the one entry to them. The bell and its panel are removed. The Status page reads the alerts each minute while its tab is visible. A hidden tab sends no request.

  - **Account.** The account menu shows the GitHub login of the viewer.

  - **Run page.** A click on a link of the header while a decision is not saved asks before it leaves the run.

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

- c11311a: Added the kind of the pass, the delivery attempt, the wait in the queue, the names of the failed steps, and the time and the item counts of each step to the log line `operations_pass` of a scheduled service pass.
- 7900104: One D1 round trip for the Service status read

  The Service status read (`/api/operations`) now sends its three reads in one D1 batch. In the local D1 fixture, one status request makes 1 D1 round trip instead of 3, which is 67% fewer. The request reads the same number of rows and sends the same answer.

- de39752: Each page has its own path

  The Queue is at `/`, History is at `/history`, and Status is at `/status`. Before this update, History and Status were views of `/` with the search parameter `view`.

  - **Old links.** A link with `/?view=history` or `/?view=service` now opens the Queue. No redirect exists.

  - **History.** The search text and the result filter are in the URL, for example `/history?q=dialog&state=passed`. A reload or a shared link keeps them.

- 446b96a: Changed the production service to run near its database in eastern North America, and not near the visitor. Static assets still come from the location nearest to the visitor.
- ae3cbf3: The pull request page names the pull request and keeps waiting after a failed read

  The page that a GitHub check opens has the design of the Queue, the History, and the Status page. It opens the review as soon as the newest run is ready. Until then it shows where the capture is.

  - **Context.** The title block has the number, the title of the pull request, the short commit, and the attempt of the workflow, for example `c344d23 · attempt 3`. A `GitHub` button opens the pull request. A page with no title shows `Pull request #7`.

  - **One sheet for each state.** A capture that is on its way shows the steps `Capture`, `Compare`, and `Review` with `Opens when ready`. A failed capture shows the band `Capture failed` with `Open workflow`, which opens the attempt on GitHub. A run that closed before its screenshots were complete shows `Replaced`. A pull request that needs no capture shows `No visual review needed`.

  - **One failed read keeps the state.** While the capture is pending, the page reads each 15 seconds in a visible tab. After a failed read it keeps the steps under the band `Could not refresh the pull request`, and it reads again after 45 seconds. Before this update, one failed read replaced the page with `Review unavailable` and ended the waiting.

  - **Check again.** The button `Check again` is in the steps sheet, and it is busy while its read runs. The first read of a page that opens in a hidden tab starts when the tab becomes visible.

  - **Loading and errors.** While the lookup runs, the page shows its shape in place of a sentence. When the first read fails, a band says `Could not load the pull request` with the cause and the Error ID. The text `Finding this pull request’s visual review…` is removed.

  - **Faster start of the run page.** The page loads the code of the run page while the lookup runs, so the review opens sooner after the answer.

  - **Removed.** The button `Review queue`, the line `Visual review · Pull request #7`, and the button `Open on GitHub` of the page card are removed. The `GitHub` button is in the title block.

- 706409c: Changed a queue message that fails outside the handler to wait 60 seconds before each retry.
- b6d6cef: The Queue and History show runs as rows

  The Queue now shows the next run to review as one card, and each other run as one row of 61 pixels. On the card of a run with a title, the number opens the pull request on GitHub and the commit opens the commit on GitHub. Before this update, each run to review was a card of 240 pixels, and the page stated each count two or three times.

  - **Rows.** A row is one link that covers the row. It has the state as a colored mark, the pull request title, the number, the attempt from the second attempt, the age, and the state in words. A run with no title has its number as the label, and a run of the main branch or of the merge queue has its kind and its commit.

  - **Groups.** The runs to review come first. The runs that are capturing or comparing are under `Running`, and the runs that need a new capture or that failed are under `Needs attention`.

  - **Counts.** A run to review says its open changes and its rejected variants, for example `17 changes · 1 rejected`, with a bar for the approved, rejected, and open variants.

  - **States.** A state has the one name of the settled vocabulary: `Needs review`, `Rejected`, `Capturing`, `Comparing`, `Rerun needed`, and `Failed`.

  - **Loading and errors.** While the list loads, the page shows the shape of the list. When the first read fails, a band says `Could not load runs` with the cause and the Error ID, and the header stays.

  - **Removed.** The three counters, the button `Refresh runs`, and the link `View history` are removed from the Queue. The list reads again on its own, and the header has the link to History.

  History has the same rows in place of its table.

  - **Days and pull requests.** The runs are in groups by day. The runs of one pull request are one row, the row of its newest run. A button such as `2 earlier` shows the earlier runs under it.

  - **Search, filter, and order.** The search field finds a run by its title, its number, or its commit. The result filter says how many runs each result has, and it counts a closed run by its last result. A new select gives the order `Newest` or `Oldest`. The three are in the URL, for example `/history?q=dialog&state=passed&sort=oldest`. A link with a number as its search text, for example `/history?q=7754`, now keeps that text.

  - **Closed runs.** A closed run with a stored reason says why it closed, and its mark shows its last result when the service knows it.

  - **Focus and contrast.** The search field and the two selects show a focus ring, and the placeholder of the search has a contrast of 4.5 to 1 or more.

  - **Removed.** The heading, the two sentences about the 100 runs, the repository name, and the button `Refresh runs` are removed from History. One line under the list says how many runs the page shows.

- 1390877: Read-only capacity check for new capture runs

  The capacity check of a new capture run no longer writes to D1. In the local D1 fixture, a refused reserve call writes 0 rows instead of 3, and a new run writes 2 rows fewer. The scheduled pass still stores the capacity sample and its alerts for Service attention.

  A refusal at the database size limit now answers with the code `database_size_exceeded`. The code `capacity_exceeded` now means only the limit of active runs.

- ddccdd3: Fewer D1 reads in three recurring steps

  Three recurring steps of the operations pass now read less from D1. The numbers are from a local D1 fixture, and each rewritten statement returns the same rows as before.

  - **Review links.** The step for old review links now selects only the pull requests that need a mirror check. With 1,000 pull requests that need none, the step needs 1 pass instead of 41, and it reads about 23 times fewer rows (165,690 before, 7,250 after).

  - **Webhook recovery.** An idle page of 100 deliveries now costs one batch of 2 statements instead of 300 statements, so an idle pass runs 5 statements instead of 303. The step now reads the newest page of GitHub in each pass, and then one older page. A new failed delivery therefore gets its first redelivery request in the next pass. The wait before each later request is now two times longer than the wait before it: 5, 10, 20, and 40 minutes, so the 5 requests of one delivery take 75 minutes or more. The step no longer writes a settled recovery row, an unchanged failed delivery, or an open `redelivery-exhausted` alert again in each pass.

  - **Eligible runs.** The filter for the runs that can publish a check update no longer scans every snapshot for each closed accepted run. With 800 runs and 200 snapshots, it reads about 45 times fewer rows (80,816 before, 1,809 after).

- 3fc93a2: Changed a review read of a capture list to check the key, the size, and the digest of the stored bytes, with no second validation of the content: in local workerd, the read of the two lists of a run with 3,832 screenshots takes 88 ms instead of 552 ms. Submit, promotion, and recovery keep the complete validation.
- 8e06008: Stored the reason that each run closed: a newer run replaced it, the pull request closed, the merge group was destroyed, its baseline was retired, or it expired before it finished. A run that closed before this update has no stored reason.
- a15e27e: Added two counts of the comparison settings to the header of the run answer (`run.comparisonSettings`): the screenshots whose settings differ from the settings of their baseline, and the screenshots whose settings are looser than the built-in policy (threshold 0.2 and 0 pixels). Submit stores both counts, and the check result does not change.
- e0f7cc7: Run list and pull request page data

  The service now returns more of the data that the pages need:

  - **Run list.** Each closed run has the reason that it closed. A closed run that sealed also has the state that it had before it closed. The answer also has the count of open service alerts and the login of the viewer.

  - **History.** A closed run now shows why it closed: `Replaced`, `Closed`, `Removed from queue`, `Retired`, or `Expired`. A run that closed before the service stored the reason shows its last result when the service knows it, and `No longer active` when it does not. Before this update, each closed run showed "Replaced by a newer run".

  - **Pull request page.** The answer has the title of the pull request, its head commit, the workflow attempt, and the link to that attempt on GitHub. It has the state `not-required` when the Plan selected no visual capture, and the new state `replaced` when the run closed before its screenshots were complete. A request without a check answers for the newest head commit of the pull request.

  - **Fewer reads.** The history query reads about 6.6 times fewer database rows in a local D1 fixture with 2,000 runs (38,540 rows before, 5,844 after), and it returns the same rows.

- f1f47c6: The run list refreshes on its own

  The Queue and History now read the run list again with no action of the person.

  - **When.** The list reads again when the tab becomes visible, and each minute while it is visible. While a run is capturing or comparing, it reads each 15 seconds. A hidden tab sends no request.

  - **A failed read.** When a refresh fails, the page keeps the list. A band above it says `Could not refresh runs` with the age of the list and the cause, and it has the button `Try again`. Before this update, a failed read replaced the list with an error screen.

  - **No access.** A read that the service refuses because the session ended, or because the account has no access, still replaces the list at once.

- c04d77b: The run list starts with the document

  The server now starts the read of the run list while it sends the document of the Queue or of History. The document sends the page shell first and the list after it, so the page needs no second request for its first list.

  - **Between pages.** A move between the Queue and History reads nothing. A return to the Queue from a run shows the last list at once and reads again in the background.

  - **Refresh.** A new read of the list keeps the list, the scroll position, and the focus while it runs.

  - **Status.** The Status page reads only the alerts, so it also loads when the run list fails.

  - **Failures.** A failed read of the run list says its cause in one sentence, with the reference of the request when the service gives one.

  - **Sessions.** The read that starts with the document does not renew the session, because its answer cannot set a cookie. The next request of the page renews it. The access check is the same as for each other request.

- ddd23b8: Changed the first answer of a run page to the changed, added, and removed screenshots, with the review counts of the run and the number of unchanged screenshots. The unchanged screenshots load in pages of 2,000 when the reviewer opens their group, searches, or follows a link to one of them. Submit stores the baseline image with each changed and each removed screenshot, so the service reads this answer from the database only. A run that was submitted before this update has no stored baseline image, and its answer still reads the two capture lists of the run.
- 2487e4e: Fewer database reads for the first answer of a run page

  This update removes repeated work from the first answer of a run page:

  - **Each row is read one time.** The answer reads the run, the project, and the comparison one time each. For a run that waits for a review, the answer makes 10 database round trips instead of 13 in the local test.
  - **The read-only reason is sent one time.** The answer of a closed run has its read-only reason in the header only, and not in each screenshot.
  - **No copy of a capture list for its digest.** The service hashes the bytes of a capture list with no copy of them.

- ca37a11: A run page reads the state of its run when its tab becomes visible

  A run page that stayed open in a hidden tab showed the state of the time when it was loaded. The page learned of a change only from the answer to a decision.

  - **One small read.** When the tab becomes visible, the page reads the small state of the run one time. It reads the run again only when the state changed. A hidden tab sends no request, and the page has no timer for this read.
  - **A replaced run.** After a newer attempt replaced the run, the page says "A newer run replaced this run.", links to the Queue, and shows that the evidence cannot be reviewed, with no save.
  - **A decision of another reviewer.** The page shows the decision when you return.
  - **A session that ended in another tab.** The page shows the sign-in page.

- e6dae7c: The decision bar says "Saving…" until a decision is confirmed

  The decision bar of a run page no longer says that the window can close while a decision waits in the queue of the service.

  - **One text.** The bar says "Saving…" until the service confirms each decision. After 30 seconds it says "Saving… Still queued after 30 seconds."
  - **The leave prompt.** The browser asks before the reviewer leaves the page until the service confirms each decision. Before, it stopped when the service had queued the decision.
  - **A faster result.** The page reads the result of a decision after 100 ms in place of 500 ms. It makes no read while the tab is hidden.

- 7447c6e: One sign-in page, one no access page, and page titles

  The pages that are not a page of the app itself are now the same on each route.

  - **Sign-in.** One sign-in page serves each page. It comes with the document when the request has no session, so it needs no script and no request to show. A sign-in returns to the page that the person opened.

  - **A failed sign-in.** A sign-in that fails at GitHub returns to the app, and the sign-in page says the reason. Before this update, the person saw an error page of the sign-in library outside the app.

  - **Too many attempts.** When the service answers a sign-in with HTTP 429, the sign-in button is off for the time that the service names, and the page says for how long.

  - **No access.** One page serves an account with no write access on each route. It names the account when the app knows it, and it has two ways forward: `Use another account` and `Back to GitHub`.

  - **Titles.** Each page has its own title: `Queue`, `History`, `Status`, `Pull request #<number>`, and the title of the run, each before `· Visonaut`.

  - **Not found.** An unknown address shows a page with the header and a link to the Queue. Before this update, it showed the bare text `Not Found`.

  - **Errors.** A page that fails to load or to render shows one error screen with a `Reload` button.

- 3eb4378: The signed GitHub Actions identity alone proves a CI run

  The service now accepts a run from the signed GitHub Actions identity alone. It still checks the issuer, audience, and expiry of the token, the repository and owner IDs, the event, the ref, the run, the attempt, the signed job and its name, the tested commit, and the pull request state.

  - **No workflow file comparison.** The service compares no workflow Git blob and reads no workflow file. A pull request that changes `.github/workflows/ci.yml` or `.github/workflows/app.yml` in the consumer repository needs no change of the service.
  - **No adapter digest comparison.** The service compares `run.planDigest` and `discovery.executorDigest` with no setting. Each value must still have the form of a SHA-256 digest, and the service stores the value of the request. A Submit of CLI `0.5.4` passes with no change in the consumer repository.
  - **Configuration.** `VISONAUT_WORKFLOW_OWNED` now has four fields: `callerWorkflowPath`, `reusableWorkflowPath`, `captureJobName`, and `submitJobName`. The variable `VISONAUT_TRUSTED_EXECUTOR_DIGEST` is removed.
  - **Main pushes.** A push to main records its check candidate without a read of the App workflow file. The scheduled pass that retired a main check without the pinned workflow is removed.

  Accepted limit: a pull request from an account with push access can replace the Submit job, or send the no-visual report for itself. The workflow edit is in the diff of that pull request.

- f90663c: Failed decisions and capture counts in the Service status

  The Service status read (`/api/operations`) now has two more fields. They come from the same D1 batch, so the request still makes 1 D1 round trip and writes no row.

  - **`deadReviewTasks`.** The count of the queued decisions that failed each attempt in the last 7 days, and the time of the newest one. A restore of the database does not count.
  - **`captures`.** The run with the largest capture count among the 20 newest runs that have one, with the capture limit of the service. It is `null` when no run has a capture count.

  ```json
  {
    "deadReviewTasks": { "count": 1, "newestAt": 1790000000000 },
    "captures": { "runId": "run-id", "count": 3832, "limit": 11000 }
  }
  ```

- a5d97c4: The Status page shows one card of alerts and three meters

  The Status page now has one card with the verdict, `All systems normal` or the number of alerts, and one row for each open alert. Under the card, three meters show the database size, the capture runs in progress, and the largest run against the screenshot limit.

  - **Alert rows.** A row has the title of the alert, the affected record, and the time of the last occurrence. Open the row to read what to do, the first-seen time, and the kind, the code, and the subject of the alert. Each alert title is a heading.

  - **Words for each alert kind.** Each alert kind that the service stores now has its own words. Before this update, 13 kinds showed the same general sentence, for example the alert of a scheduler step that failed. An alert has the button `Open guide` only when the operations guide has a procedure for it: the alert of a locked check, and the alert of a restored deployment.

  - **Three more alerts.** The page shows an alert when the last capacity sample of the scheduler is older than 15 minutes, when a review decision failed each attempt in the last 7 days, and when a run has 90% or more of the screenshot limit. The page finds them in its reads, and the count in the header does not include them.

  - **A status that the page cannot read.** When the capacity part of the answer has an unknown form, the alerts still show, and one row says which part the page could not read. Before this update, the page showed an error and no alert.

  - **Loading and errors.** While the status loads, the page shows its shape. When the first read fails, a band says `Could not load the status` with the cause and the Error ID. When a later read fails, the status stays under a band that says `Could not refresh the status`.

  - **Screen readers.** The page says its state one time, and then each alert that enters or leaves the list one time. When an alert closes while its row has the focus, the focus stays in the page.

  - **Removed.** The heading `Service status.`, the intro text, the button `Refresh alerts`, the link `Open the operations and recovery guide` under the list, and the line `No external notifications are sent.` are removed. The page reads again each minute, and the button `More info` of the card has the sentences about the refresh and the notifications.

- 11987b3: Stored the review state of the run and its three review counts with each update of the GitHub check. An update that was stored before this update has no review state and no counts.
- 8cf9ebe: Fewer GitHub requests and no plan object for a Submit

  This update removes repeated work from the Submit path:

  - **Reference selection stops at the first ancestor.** In the local fixture with 100 accepted baseline commits, the first reference page of a run sends 1 compare request to GitHub instead of 100. The selected reference does not change.
  - **No plan evidence object in R2.** A new run no longer writes `plans/workflow/<digest>.json` to the quarantine bucket. The provenance row in D1 keeps the same evidence.
  - **Fewer repeated GitHub reads.** The service reads the workflow run of a first attempt 2 times instead of 3 while it reconciles the job set, and it reads the pull request 1 time instead of 2 for a pull request webhook that can record a candidate.

- b594274: One D1 round trip for a webhook receipt

  The service now stores the receipt of a GitHub webhook and reads it back in one D1 batch. In the local D1 fixture, the receipt needs 1 D1 round trip instead of 2. It writes the same 4 rows.

  If the read fails, the batch now rolls back the insert, and the webhook answers with an error. GitHub then sends it again and the service stores it as a new receipt.

- 6475245: Closed the auth routes that sign-in does not use. Only the sign-in, callback, sign-out, and error routes answer, each other path below `/api/auth/` answers 404, and the unused `/api/session` route is removed.
- 2642d3f: Gave the main action its brand color and the warning banners a surface

  The sign-in, "Use another account", and "Review" buttons, and the icon tile of the sign-in card, had no recipe color, so they looked pale gray on a white card. They now have the brand color with a white label. The four warning banners of the review page are now a tinted warning surface.

- dd568c7: Reliable delivery of check results to GitHub

  This update fixes three defects in the delivery of a check result to GitHub:

  - **A failed read sets no lock.** When a read from GitHub fails before the service sends a result, the result goes back to the queue. The service tries again after 30 seconds, and then waits two times longer after each failed read, with a maximum of 15 minutes. Each failed read uses one attempt of that result. With the default of 5 attempts, the service stops after the fifth failed read in sequence, and a newer result of the check starts again. Before this update, one failed read locked the check until a manual repair.

  - **A locked check starts no status loop.** A status pass asks for one more pass only when it completed or deferred an update.

  - **A check keeps its duration.** The service sends no update when GitHub already shows the same completed result. An update of a completed check that keeps the conclusion also keeps the first end time.

- 6c9ea68: Fixed the conflict text of the run page, which named no reviewer for a queued decision and showed a GitHub user ID in other cases. The text now names the reviewer of the newer decision with the stored profile name, for example "Conflict. Kenji Mori rejected this variant. Your approval was not saved." For a decision of your own, for example in another tab, it says "Conflict. You already approved this variant. Your rejection was not saved." The Details panel shows the same name in place of the GitHub user ID.
- 6cb8faa: Credential checks before other work

  The service now checks the credential of a request before it does other work:

  - **Private API routes.** On each private route that the API handler serves, a request with no session cookie and no bearer token gets `401` before any database work.

  - **Identity route.** On `/api/me`, a request with no session cookie and no bearer token gets `401` with the code `sign_in_required` before the sign-in instance exists.

  - **Ingest routes.** A request with no bearer token gets `401` with the code `credential_required` before any database work. This includes Submit.

  - **Webhooks.** The service checks the signature of a webhook before it reads the project.

  - **Paths.** A shard path with a percent sequence that is not valid gets `400` with the code `invalid_path`.

  The service also keeps the signing keys of GitHub between requests, and it keeps the verified login of a user after a refused permission check. A request of the CLI gets the same answer as before, because the CLI sends a bearer token with each request.

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

- db2d5c2: Colored the error text and used the text color scale for muted text

  Error text, the warning icon, and the success icon had a color class that matched no rule, so they kept the body color. They now take their color from the text system. Muted text now uses the text color scale instead of `opacity`, so it keeps a readable contrast. The variant strip of the review page has its bar glider again.

- a99cb6f: Fixed the state of a closed run that failed: it is now `failed`, not `superseded`. This applies to a run that expired before its screenshots arrived, which History labeled "Replaced by a newer run", and to each run that a database restore closes.
- 26f312b: Cached hashed assets for one year, so a returning browser no longer revalidates them.
- b03e5e5: Fixed the reference page of a Submit to return an ingest credential that ends at the same time as the credential of the request. An ingest credential now ends 10 minutes after the identity check of its reserve call, and the CLI renews it with a new reserve call, as before.
- 71e8d54: Fixed the check of a regenerated pull request merge commit to close as `neutral` only after the tested result passed. While the tested result has not passed, that check stays pending.
- d53b62e: Stopped storing the GitHub user token of a sign-in. Each sign-in now writes NULL to the `accessToken`, `refreshToken`, `idToken`, `accessTokenExpiresAt`, and `refreshTokenExpiresAt` columns of its account row, also when the row has values of an earlier sign-in.
- 230b329: One failure no longer stops a service pass

  This update fixes two cases in which one failure stopped the other work of a scheduled service pass:

  - **A review decision during a check update.** When a review decision is saved while the pass prepares the check update of a run, the pass now reads that run one more time and then continues with the next run. Before this update, the pass then sent no check update to GitHub and raised a service alert.

  - **A failed step at the start or at the end of a pass.** A failure in the retirement of replaced main runs, in the finalization of comparisons, or in the cleanup of expired exports now raises a service alert for that step, and the pass continues with its other steps. The alert closes after the next pass that completes the step. Before this update, a failure at the start of a pass stopped the complete pass, which includes the delivery of check results and the cleanup of expired images.

- 2fb617c: Fixed the preview environment to show a current date, the meters of the Status page, and the sample run for a pull request link.
- ef41d4a: Fixed the Queue to show the title of each pull request again. A processed pull request webhook now keeps the pull request number, its title, and the repository ID in place of an empty payload, including after a database restore.
- 8316ea2: Waits between the attempts of a queued review decision

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

- 7f13ad3: Image retention continues after runs with a refused storage prefix

  An expired run with a storage prefix that the service refuses to delete is no longer a deletion candidate. Before this change, 25 such runs (one page of candidates by default) stopped the deletion of the images of each later run.

  A run with a refused prefix keeps its images. It no longer raises the `unsafe-prefix` service alert on each maintenance pass.

- 884428a: Fixed the review page to name the true cause of a failed request, such as "No connection." for a failed fetch, and "not available" with the time of `Retry-After` for a 5xx answer that is not JSON.
- 602a670: A run page keeps a decision when a session ends

  A run page lost a decision when its review session or its sign-in session ended. The page said "Conflict. Your review session ended. Reload the page to continue.", and a reload dropped the decision.

  - **A review session that ended.** After a new sign-in with the same account, the page starts a new review session and sends the same decision again, with no action from you. The page can then no longer undo the decisions that it saved before that moment.
  - **Another account.** The page names the account that it was loaded for, and the service starts a review session only for that account. While another account is signed in, the page keeps the decision and says "Another account is signed in. Sign in with the account of this page, and then retry."
  - **A session that ended.** The decision bar keeps the decision, says "Your session ended. Sign in again, and then retry.", and shows the link "Sign in again", which opens a new tab.
  - **Refresh current state.** The button drops a decision that waits for a retry only after its read succeeds.
  - **A replaced run.** After a save fails because a newer run replaced the run, the bar says "Not saved. A newer run replaced this run." and links to the Queue.
  - **A decision that failed each attempt.** The bar says "Not saved. This decision failed too many times and cannot run again. Check the current state and decide again." in place of the text of a conflict.

- 54602c1: Service alerts close when their cause is gone

  This update fixes when the scheduled service pass opens and closes its alerts:

  - **Alerts of a closed run.** A promotion alert now closes in the next pass after its run closes or is accepted. It also closes when the run no longer waits for its promotion: its comparison is no longer ready, or the run no longer has the status `passed`. A check creation alert of a closed run closes in the same way, except the alert with the code `ambiguous`: that check can still be in progress on GitHub. Before this update, these alerts stayed open until a person changed the database.

  - **No alert while a new run is not ready.** A signed capture run whose Submit job still runs no longer raises the alert `staged` of the step. The pass tries the run again, and a run that fails 5 times still gets its own alert.

  - **The alert of a failed pass.** Only a recovery pass now closes the alert `runtime`. Before this update, a pass of any kind closed it, also when the failed recovery pass did not run again.

  A pass now closes the alerts of its completed steps with 2 statements. Before this update, a recovery pass ran 19 statements for them, and each one read the complete alert table. With 100 closed alerts in a local D1 fixture, the steps of an idle recovery pass read about 2.4 times fewer rows (2,035 before, 842 after) and write 0 rows as before.

- e1e8bc1: Stricter session handling and private headers

  The service now handles a session and a private answer more strictly:

  - **A bearer token needs its signature.** `visonaut status` must get `VISONAUT_TOKEN` in the form `<session token>.<signature>`, which is the URL-decoded value of the session cookie.
  - **Session headers.** A private answer forwards only `Set-Cookie` from the session headers of the sign-in library, so a renewed session still reaches the browser.
  - **Client address.** The sign-in library reads the client address from the `CF-Connecting-IP` header.
  - **Private headers.** Each private answer has `Cross-Origin-Resource-Policy: same-origin`, and `/health` has the same private headers as each other private answer.

- a44c770: Fixed the review page so keyboard shortcuts keep working after a click on a variant chip, and so the strip scrolls to show the selected variant chip.
- Updated dependencies [fb11552]
- Updated dependencies [af58cce]
- Updated dependencies [5efa4ec]
- Updated dependencies [ddccdd3]
- Updated dependencies [8e06008]
- Updated dependencies [a15e27e]
- Updated dependencies [c04d77b]
- Updated dependencies [ddd23b8]
- Updated dependencies [2487e4e]
- Updated dependencies [7447c6e]
- Updated dependencies [3eb4378]
- Updated dependencies [11987b3]
- Updated dependencies [b594274]
- Updated dependencies [dd568c7]
- Updated dependencies [6cb8faa]
- Updated dependencies [249e553]
- Updated dependencies [a99cb6f]
- Updated dependencies [b03e5e5]
- Updated dependencies [d53b62e]
- Updated dependencies [b991b7e]
- Updated dependencies [e1e8bc1]
  - @visonaut/security@0.0.2
  - @visonaut/service@0.0.3

## 0.2.3

### Patch Changes

- f83fef6: Redesigned the review queue, run history, service status, and screenshot review workspace. Added screenshot search and status filters, a saved sidebar preference, capture details, and a compact action bar with visible keyboard shortcuts.

## 0.2.2

### Patch Changes

- 6219fdf: Reduced database writes for unchanged runs

  The native D1 service lifecycle fixture with 100 unchanged items now writes 96.5% fewer rows: 66 instead of 1,866. This measurement includes capture admission, comparison, and promotion; it excludes upload, image registration, and R2 operations.

  Complete capture inventories now stay in R2, while D1 stores changed items. Unchanged items remain available in visual review with their current capture settings.

  Reference-image downloads reuse verified image membership. In the native 4,000-capture/profile fixture, five sequential image requests now read the full inventory once instead of five times (80% fewer inventory reads), while authorization stays live on every request.

  Capture inventories and baseline imports preserve the test IDs used by existing submissions, including IDs qualified by shard.

  Existing deployments must import their accepted baseline into a fresh database before switching to this storage model. Keep the old database and images until complete Submit, review, and main promotion pass against the replacement.

- cf00e2b: Fixed large visual submissions that exceeded the inventory size limit. Inventories now store repeated capture facts once and restore the complete evidence when read.
- Updated dependencies [6219fdf]
  - @visonaut/service@0.0.2

## 0.2.1

### Patch Changes

- 426080e: Fixed repeated retries of historical terminal pull-request workflow receipts, including closed pull requests with an unstarted candidate.

## 0.2.0

### Minor Changes

- 19dc91b: New submissions require trusted local comparison

  **BREAKING** if a client reserves a run without `comparisonMode: "local-v1"` or requests server recomparison of a stored legacy run. Upgrade the Visonaut CLI and capture a new complete run with trusted local Submit. Previously issued upload capabilities and legacy recovery remain available during drain. Existing reviews, approvals, history, and originals retain their current rules.

  Before:

  ```ts
  const request = { ...reservation };
  ```

  After:

  ```ts
  const request = { ...reservation, comparisonMode: "local-v1" };
  ```

- 34d1165: Closed-run recomparison and export creation are retired

  **BREAKING** if you create a comparison from a closed run or create a product export. Closed runs now return `409 history_closed`, and new exports return `410 export_retired`. The export control is removed. A new comparison requires a fresh complete capture through trusted Submit.

  Before:

  ```http
  POST /api/runs/<closed-run-id>/recompare
  POST /api/runs/<run-id>/export
  ```

  After:

  ```http
  GET /api/runs/<closed-run-id>
  GET /api/exports/<existing-export-id>
  ```

  Existing history keeps its original decisions, approval identities, comparison links, and explicit expired states. Existing private export downloads retain verification, leases, expiry, cleanup, and their image pins through drain. The remaining export code is retained until verified drain permits final retirement.

- 767eec9: Product export endpoints are removed

  **BREAKING** if you use a product export URL. The [export endpoints](https://github.com/ariakit/visonaut/blob/main/apps/web/src/operations/README.md#manual-evidence-export) return `404 not_found`, including existing links whose promised expiry has not passed. Endpoint retirement does not wait for export expiry, active download leases, or completed cleanup. Use retained run history to read existing evidence, or capture a new complete run for new evidence.

  Before:

  ```http
  GET /api/exports/<export-id>
  POST /api/runs/<run-id>/export
  ```

  After:

  ```http
  GET /api/runs/<run-id>
  ```

  Retained export pages and matching owner pins remain until ordinary bounded cleanup is eligible under its unchanged expiry and active-lease checks. Pins release only after private-page deletion completes. No forced expiry or deletion is required. Native recovery and ordinary image retention remain available. Recovery cannot recreate expired R2 image bytes. Preserve any specifically required private evidence. Remove `maximumExportEntries` and `maximumMetadataBytes` from custom `VISONAUT_OPERATIONS_BUDGET` overrides; the remaining limits keep their defaults.

- e9d150a: Server comparison producers and handlers are removed

  **BREAKING** if an old workflow stage requires server image comparison. After the terminal legacy cohort passes the retirement gate, the service requires a verified local Submit receipt to create a comparison. Upgrade the CLI and capture a new complete run. Existing reviews, approval tuples, history, originals, and native Submit recovery retain their current rules.

  Before:

  ```ts
  await service.createComparison({ ...comparison, maxAttempts: 5 });
  ```

  After:

  ```ts
  await service.createComparison({ ...comparison, localComparison: verifiedReceipt });
  ```

  The private image validation endpoint still supports PNG and WebP. Remove the retired `comparisonMaxAttempts` field from selected `VISONAUT_API_LIMITS` overrides before deployment. Remaining numeric bounds keep their existing values. Operators must detach the existing comparison and comparison dead-letter consumers before they deploy the fetch-only validation Worker. Queue resources and stored records remain in place. Follow the [retirement runbook](https://github.com/ariakit/visonaut/blob/main/docs/history/operations/retire-server-comparison.md).

### Patch Changes

- 25eb687: Updated the dashboard with a compact header, a bell that opens service alerts, a clearer run table, and colored run status badges.
- af4a132: Improved run export preparation for large project histories, with about 90% fewer history page reads and writes in an 82,556-row local benchmark.
- e382ba5: Made private page navigation faster by reducing GitHub identity and permission lookups from two calls to one on warm authorization checks, 50% fewer in the test fixture. Each request still checks current repository access.
- 306f127: Reduced R2 metadata requests for large workflow submissions while preserving checks for missing, modified, and legacy original images.
- 8d6bfd0: Delivered independent GitHub check updates with bounded parallel requests. In the four-check regression fixture, three PATCH requests overlapped, a 3× increase in concurrent status delivery over serial execution. Each check still keeps its own delivery fence when GitHub's response is uncertain.
- eb9b414: Added an informational review link to the pull request checks list so maintainers can open the matching Visonaut review from the pull request.
- ad1e71a: Added a support reference to unexpected request failures and review retry messages. The reference matches one safe server log entry.
- 779eb32: Updated the runs dashboard so narrow screens show each run's commit, creation time, attempt, and state without horizontal table scrolling. The alert count now floats at the bell's corner.
- 15fb75b: Replaced the review variant placeholders with recognizable framework and browser icons and clarified tooltips for display preferences.
- 859ad6f: Added an original-only image view, grouped image controls, flatter and rounder Sign out buttons, and item navigation that opens the first variant needing review unless the reviewer chose another. Review saves update the open page from the saved result and authoritative run status when current, refresh it after another run change, and wake check delivery after saves and Undo.
- 7185786: Reduced service database calls for a fresh Approve or Reject from seven to three, about 57% fewer calls in the local decision test. Decision saves can reuse a verified GitHub permission for up to 10 seconds and return before the status Queue wakeup completes. Live session checks and atomic decision saves remain required. Repository permission removal can take up to 10 seconds to block another decision.
- 816b329: Added direct links to review items and variants, compact visual variant labels, and a sidebar that keeps long item lists scrollable. Item navigation now uses supplied thumbnails without loading full comparison images for other items.
- 2d97f1a: Reduced image writes during Submit. In the small local D1 fixture, declaring, completing, and registering one uploaded image now writes 10 rows instead of 12, a 16.7% reduction. The count includes image and index writes and excludes transaction checks, run admission, retries, and retention.
- 3e28c71: Kept items with new variants visible in the main review list while preserving automatic acceptance and pending review counts. Ordinary accepted and unchanged items remain under Accepted.
- 4930189: Updated production trust pins for Ariakit's `@visonaut/playwright@0.4.1` captures. Deploy the matching service and consumer changes after the old visual attempts that still need admission or materialization are settled.
- 6f55c57: Updated production trust pins for Ariakit's CLI `0.5.4` and adapter `0.5.0` upgrade. Coordinate old visual and no-visual callers before deployment, then verify the matching service and workflow source pins before publishing the consumer upgrade.
- d703f27: Reduced D1 round trips for nine live-review metadata reads from nine calls to two batches, 78% fewer calls for those reads. Run pages still show the same review result.
- b51aafe: Improved Submit conversion for runs with many screenshots. In the 50-original regression fixture, image registration now uses one D1 batch instead of 50, a 50× reduction in registration batches. Every original still receives a full SHA check before registration.
- b3df20b: Blocked recompare for active pull requests captured under an older comparison policy. The review page now asks maintainers to refresh the pull request against main and rerun CI. Stored historical runs can still be compared again after policy changes.
- bba0c34: Bounded backup group copy pages to 100 objects, including distinct protected-snapshot keys.
- 6197ecf: Reduced image-update transactions by up to 16× for protected-baseline conversion. Each bounded group still verifies original bytes and retains protected copies until the baseline is complete.
- 4a7906c: Reduced the result JSON payload on local comparison rows by approximately 82–90% in the representative unchanged and changed results with masks, from 148/268 bytes to 26 bytes per row. Review pages, history archives, and closed summaries preserve metrics, masks, and the effective review outcome. D1 row writes and R2 image operations are unchanged.
- 369b2d5: Fixed Visonaut checks appearing on pull requests whose App job was skipped. The check now starts when the signed Submit job begins.
- 863ffc2: Store new signed upload and recovery evidence in temporary D1 pages. Keep existing R2 declarations readable, preserve image reuse and stored review masks, and retire the pages after the durable comparison handoff.
- 97f3651: Fixed approved visual reviews so their GitHub checks update before main baseline promotion finishes.
- c4980bb: Fixed pending visual checks for admitted main runs whose signed local reference became stale before a workflow or executor rollout. Reconciliation now detects the old baseline before source validation, fails the unsealed uploading run, and retains its evidence.
- a00d927: Fixed duplicate GitHub checks that stayed pending when GitHub regenerated an equivalent pull request merge, including after the pull request was squash merged. The unused check now closes with a neutral result and links to the completed Visonaut run.
- 991fe4e: Fixed run exports that failed when the database contained images from other runs.
- 078d4d2: Fixed visual checks that stayed pending when a trusted main Submit receipt used an old baseline. Unsealed uploading runs now fail without releasing their retained evidence, so a new trusted Submit attempt can use the current reference.
- 938707a: Reduced the wait to promote large baselines by copying and verifying protected images concurrently within each bounded pass.
- 863c4b3: Fixed native database recovery to keep old captures, checks, and webhooks inactive and reject workflow identities issued before restoration. New captures require a fresh Plan and check generation, while accepted history remains available.
- e92facd: Reduced approval lookup time by over 99% in a local SQLite workload with 3,646 changed rows and 36,460 saved decisions. Exact approval and lineage requirements remain unchanged.
- 1d119b1: Kept a signed pull request visual check valid when main advances during capture and GitHub still reports the tested merge or an equivalent tree as current.
- 80af2f1: Linked Visonaut GitHub checks directly to their review page so reviewers can open the run from a pull request.
- 9e71ee5: Staged unchanged screenshots with bounded parallel image reuse. In the two-original regression fixture, both source reads and both target writes overlapped, doubling in-flight R2 operations in each phase. Available sources are verified before any target write starts; missing sources still fall back to upload.
- 57c1919: Verified staged originals in bounded parallel batches during Submit conversion. In the five-original regression fixture, four R2 reads overlapped, a 4× increase over one-at-a-time verification. Each original still receives a full digest check before its image is registered.
- 79f919e: Indexed pending webhook lookups. In a local 35,302-delivery fixture with no pending work, 500 repeated lookups were 99.9% faster than the unindexed query.
- 896fd8a: Fixed duplicate Visonaut verdicts for new pull request attempts by using one head check with a direct review link. Existing merge checks keep their required verdicts. Signed Submit completion now requests ingestion, and saved review decisions start their durable task without waiting for the shared operations consumer.
- 41fc1e6: Fixed pull request reviews to keep their signed reference when main advances. Reference reads, trusted Submit, review decisions, Undo, and the required GitHub check now remain valid for the same pull request head and attempt. The required check is also published on the pull request head, so GitHub can still find it after rebuilding the merge commit. New pull request heads and attempts still replace older runs.
- dfc8397: Linked pull-request checks to their Visonaut review page, including a pending page before capture is ready.
- 44a116e: Fixed signed visual submission when GitHub still reports a workflow attempt as queued after its submission job starts.
- d3daf44: Raised the production and preview admission limit from two to five active upload or comparison runs, allowing more signed Submit jobs to start while earlier runs remain active.
- bfbd356: Stopped retrying verified historical main and closed pull-request workflow deliveries while preserving completed App checks and valid signed submissions.
- d3332f0: Recovered exhausted comparison Queue deliveries promptly when their dead-letter receipt matches the current run. Repeated transport failures now leave a visible failed comparison instead of retrying without a limit.
- 3f86d41: Fixed visual reviews that could remain pending if comparison creation failed after uploads completed. Submitted runs now retry comparison creation automatically, and retry alerts remain visible until a comparison exists.
- 722048f: Reduced redundant D1 writes. Repeating identical profile storage performs 100% fewer row writes in the two-profile local regression fixture, from six to zero. Successful transaction checks and unchanged background cursors also avoid row writes, and status acknowledgements preserve earlier delivery times.
- 204f320: Fixed visual submission, lineage, and check lifecycle when GitHub regenerates a pull request merge commit with the same parents and file contents.
- 1b9435f: Fixed baseline promotion and rollback so invalidated pull request comparisons stop using active comparison capacity. Reconciliation now frees their stale Queue slots so other reviews can proceed while those pull requests await recompare.
- b99e23b: Cleared stale snapshot-cleanup alerts when protected snapshots cannot retire or an earlier failure has recovered.
- e849c13: Fixed newer review evidence being lost when it arrived during a pending or failed decision save. Retries keep the original command identity and revisions, and a replacement comparison starts a separate review session.
- 7e23173: Moved private run-export metadata to the images bucket and removed the web Worker's dependency on the retired backup buckets and D1 export token.
- d5ad1cb: Stopped retrying completed webhook deliveries for closed or superseded pull requests when an earlier verified workflow attempt identifies the pull request.
- 70b77ec: Retired queued visual comparison work when its review run was superseded, so stale tasks no longer occupy queue capacity.
- a168e98: Allowed a verified capture or Submit job to retry transfer-key retrieval after a lost response.
- 776d415: Fixed the review page in dark mode and grouped accepted screenshots in a collapsible sidebar section so comparisons that need attention stay visible. Comparisons still running now show a pending state instead of an evidence error.
- 1866935: Fixed review evidence controls to explain failed comparisons and offer image retry only for loading or decode errors. The reference and new image panes now appear as each image is verified, while review actions wait for all required evidence.
- d81e885: Reduced full review-model requests by 100% across two pending comparison polls in the browser fixture. Review pages now check a small status response while comparing, pause polling when hidden, and load the complete result when the comparison finishes.
- 32c2029: Improved review navigation with bar indicators, compact variant links, and aligned image controls. Review decisions now update the screen before saving completes and restore the previous state if saving fails. Captures with no changed pixels no longer need approval solely because their capture profile changed.
- 774658f: Verified staged originals with six concurrent R2 reads during Submit conversion. In the seven-original regression fixture, six reads overlapped, a 1.5× increase over the previous four-read limit. Each original still receives a full digest check before registration.
- 124ccac: Skipped pixel comparison for validated screenshots with identical bytes and capture profiles. In the two-pair identical-image regression fixture, queued pixel tasks fell from two to zero, a 100% reduction. Changed screenshots still use the comparator.
- ee797e8: Acknowledges invalidated review comparisons without decoding their images and releases their queue admission slots.
- d91066a: Skipped pixel comparison when validated screenshots have identical bytes and their capture profiles differ only in comparison policy. In the two-pair policy-change fixture, queued pixel tasks fell from two to zero, a 100% reduction.
- 527eca3: Reduced repeated image downloads during Submit conversion. In the current-run upload and reuse test fixtures, the second download fell from one per image to zero; older images still receive full byte verification.
- a1d38a4: Fixed Visonaut checks to appear when signed Submit requests its transfer key, before it uploads images.
- c30e77d: Fixed stale dashboard reviews and service alerts to retire only after stored state proves supersession or completed delivery. Invalidated current reviews now ask for a fresh Submit. Current failures and uncertain GitHub sends keep their alerts and evidence.
- 1620814: Added a percentage-only visual comparison policy with a 0.0005 changed-pixel ratio for a controlled rollout. Matching screenshots no longer need review solely because the comparator policy changed.
- 51a3605: Trusted Ariakit's updated App workflow so pull requests can submit captures with Visonaut CLI 0.3.4.
- 97ab1d5: Stopped scheduling new SQL and image backups, while allowing an in-progress backup to finish and retained sets to expire. D1 Time Travel remains available for emergency database rollback, but it does not restore R2 images or reactivate the service safely by itself. Removed SQL backup size from run admission and cleared the old backup-age alert.
- 7e49647: Fixed ready review comparisons waiting for scheduled operations before their GitHub checks update.
- a235461: Fixed upstream webhook recovery requests in the Workers runtime.
- 8ebf821: Keep Approve and Reject available while earlier decisions save. Store review decisions in the server queue and process them in order, so acknowledged decisions can finish after the window closes. Show which decisions are still sending, preserve command identity on retry, and pause baseline promotion until queued decisions finish.
- 7893072: Fixed validation and import of local comparisons with zero changed pixels. Existing unreviewed local results are corrected without changing saved decisions or promotions. Image size changes and profile changes with different pixels still require review.
- 4c12b8d: Added safe failure reasons to webhook recovery logs without logging response data or credentials.
- c7d1185: Fixed webhook recovery to preserve 64-bit GitHub delivery IDs and reject fractional ID tokens.
- 5b0cf8d: Pinned production to the Ariakit workflow and adapter archive for Visonaut 0.4.0.
- Updated dependencies [7185786]
- Updated dependencies [4a7906c]
- Updated dependencies [863c4b3]
- Updated dependencies [126436d]
- Updated dependencies [896fd8a]
- Updated dependencies [722048f]
- Updated dependencies [32c2029]
- Updated dependencies [c30e77d]
- Updated dependencies [8ebf821]
- Updated dependencies [7893072]
  - @visonaut/service@0.0.1
  - @visonaut/security@0.0.1
