# @visonaut/security

## 0.0.2

### Patch Changes

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

- c04d77b: The run list starts with the document

  The server now starts the read of the run list while it sends the document of the Queue or of History. The document sends the page shell first and the list after it, so the page needs no second request for its first list.

  - **Between pages.** A move between the Queue and History reads nothing. A return to the Queue from a run shows the last list at once and reads again in the background.

  - **Refresh.** A new read of the list keeps the list, the scroll position, and the focus while it runs.

  - **Status.** The Status page reads only the alerts, so it also loads when the run list fails.

  - **Failures.** A failed read of the run list says its cause in one sentence, with the reference of the request when the service gives one.

  - **Sessions.** The read that starts with the document does not renew the session, because its answer cannot set a cookie. The next request of the page renews it. The access check is the same as for each other request.

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

- b594274: One D1 round trip for a webhook receipt

  The service now stores the receipt of a GitHub webhook and reads it back in one D1 batch. In the local D1 fixture, the receipt needs 1 D1 round trip instead of 2. It writes the same 4 rows.

  If the read fails, the batch now rolls back the insert, and the webhook answers with an error. GitHub then sends it again and the service stores it as a new receipt.

- dd568c7: Reliable delivery of check results to GitHub

  This update fixes three defects in the delivery of a check result to GitHub:

  - **A failed read sets no lock.** When a read from GitHub fails before the service sends a result, the result goes back to the queue. The service tries again after 30 seconds, and then waits two times longer after each failed read, with a maximum of 15 minutes. Each failed read uses one attempt of that result. With the default of 5 attempts, the service stops after the fifth failed read in sequence, and a newer result of the check starts again. Before this update, one failed read locked the check until a manual repair.

  - **A locked check starts no status loop.** A status pass asks for one more pass only when it completed or deferred an update.

  - **A check keeps its duration.** The service sends no update when GitHub already shows the same completed result. An update of a completed check that keeps the conclusion also keeps the first end time.

- 6cb8faa: Credential checks before other work

  The service now checks the credential of a request before it does other work:

  - **Private API routes.** On each private route that the API handler serves, a request with no session cookie and no bearer token gets `401` before any database work.

  - **Identity route.** On `/api/me`, a request with no session cookie and no bearer token gets `401` with the code `sign_in_required` before the sign-in instance exists.

  - **Ingest routes.** A request with no bearer token gets `401` with the code `credential_required` before any database work. This includes Submit.

  - **Webhooks.** The service checks the signature of a webhook before it reads the project.

  - **Paths.** A shard path with a percent sequence that is not valid gets `400` with the code `invalid_path`.

  The service also keeps the signing keys of GitHub between requests, and it keeps the verified login of a user after a refused permission check. A request of the CLI gets the same answer as before, because the CLI sends a bearer token with each request.

- b03e5e5: Fixed the reference page of a Submit to return an ingest credential that ends at the same time as the credential of the request. An ingest credential now ends 10 minutes after the identity check of its reserve call, and the CLI renews it with a new reserve call, as before.
- d53b62e: Stopped storing the GitHub user token of a sign-in. Each sign-in now writes NULL to the `accessToken`, `refreshToken`, `idToken`, `accessTokenExpiresAt`, and `refreshTokenExpiresAt` columns of its account row, also when the row has values of an earlier sign-in.
- e1e8bc1: Stricter session handling and private headers

  The service now handles a session and a private answer more strictly:

  - **A bearer token needs its signature.** `visonaut status` must get `VISONAUT_TOKEN` in the form `<session token>.<signature>`, which is the URL-decoded value of the session cookie.
  - **Session headers.** A private answer forwards only `Set-Cookie` from the session headers of the sign-in library, so a renewed session still reaches the browser.
  - **Client address.** The sign-in library reads the client address from the `CF-Connecting-IP` header.
  - **Private headers.** Each private answer has `Cross-Origin-Resource-Policy: same-origin`, and `/health` has the same private headers as each other private answer.

## 0.0.1

### Patch Changes

- 7185786: Reduced service database calls for a fresh Approve or Reject from seven to three, about 57% fewer calls in the local decision test. Decision saves can reuse a verified GitHub permission for up to 10 seconds and return before the status Queue wakeup completes. Live session checks and atomic decision saves remain required. Repository permission removal can take up to 10 seconds to block another decision.
- 863c4b3: Fixed native database recovery to keep old captures, checks, and webhooks inactive and reject workflow identities issued before restoration. New captures require a fresh Plan and check generation, while accepted history remains available.
- 126436d: Fixed no-visual CI Plan submissions with GitHub job workflow claims that match the trusted caller.
- 896fd8a: Fixed duplicate Visonaut verdicts for new pull request attempts by using one head check with a direct review link. Existing merge checks keep their required verdicts. Signed Submit completion now requests ingestion, and saved review decisions start their durable task without waiting for the shared operations consumer.
