# D-RES-05, round 2: research record

Lane: what the page shows about the other reviewer when a decision conflicts.
Date: 2026-10-06. Repository commit: `f83fef6bfcaeb44ad0ed8fa91d5ae6cd4a1ecc90`.
Repository root (read only): `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`.
Lane folder: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/round2/res-05/`.

Changed on 2026-10-07, by the answer of the maintainer: the logins and the user IDs of the invented reviewers in the 10 files of this folder are replaced with the values that the lab uses now. Two of the old logins and one old user ID were accounts of real persons. The script changed 76 values and nothing else, so each other byte of the probe scripts and of their results is as the probes wrote it. The probes did not run again.

Two agents wrote this record. The first agent did the research and the draft. The second agent (the checker) read each cited line, ran the probes again, ran one more probe, and repaired the draft. The section "What the checker changed" lists each repair. The first version of this file is in `checker/notes.first-agent.md`.

Skills loaded before the work. First agent: `ariakit-general-workflow`, `ariakit-general-code-style`, `ariakit-ariakit-api-design`. Checker: `ariakit-general-workflow`, `ariakit-general-code-style`, `ariakit-general-markdown`. The remote is `github.com/ariakit/visonaut`, and no installed skill is specific to that repository.

## Result in short

- A conflict is two decisions for one variant. The service keeps the first and refuses the second.
- The page names nobody because of two gaps. The page does not read the reviewer from the run model of the 409 answer. And the run model has only the numeric GitHub user ID.
- D1 already holds the GitHub profile name of each person who signed in (`user.name`). One read gives it, with 0 rows written and no request to GitHub.
- D1 does not hold a login. A login needs a new column that sign-in fills, and one production statement for each person who signed in before.
- At most 10 people can sign in today (the members of the `ariakit` organization), 4 people can review, and one person made 159 of the 160 merges that a person made in the last 30 days. So the conflict that occurs first is the second tab of one person.
- Recommendation (not a decision): option `stored-name`. It survived the check, with one repair: the name list must hold the person who looks.

## Facts from the code

Each row was read again by the checker at the cited line.

| #             | Fact                                                                                                                                                                                                                                                        | Source                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1            | The guide promises a name: "The message identifies the conflicting reviewer when one is available."                                                                                                                                                         | `docs/review-guide.md:55`                                                                                                                          |
| C2            | The same promise is in the contract issue: "A stale command returns a conflict with current state and identifies the conflicting reviewer in the private UI."                                                                                               | `docs/simplification-audit/contract-issue-1.md:225`                                                                                                |
| C3            | The web client sends each decision with `queued: true`.                                                                                                                                                                                                     | `apps/web/src/review/client.ts:313-318` (the flag is on line 317)                                                                                  |
| C4            | The 409 answer of a queued decision has `error` and `model` only.                                                                                                                                                                                           | `apps/web/src/api/review.ts:817-830`                                                                                                               |
| C5            | The queue stores only the message of a refused decision. A saved decision stores `reviewer: input.actorId` in its result.                                                                                                                                   | `apps/web/src/operations/review-queue.ts:132`, `:140-145`                                                                                          |
| C6            | Only the path without `queued` adds `reviewer` to a 409.                                                                                                                                                                                                    | `apps/web/src/api/review.ts:682-697` (`conflictResponse`)                                                                                          |
| C7            | The conflict text of the decision bar: `Conflict. ` + server message + ` Updated by ${error.reviewer}.` when the answer has a reviewer. The same function puts the run model of the 409 answer into the page.                                               | `apps/web/src/review/use-review-session.ts:260-278`                                                                                                |
| C8            | `reportError` gets the refused command, so the page has the targets with `expectedRevision`.                                                                                                                                                                | `apps/web/src/review/use-review-session.ts:379`                                                                                                    |
| C9            | The Details panel prints `variant.reviewer` as it is.                                                                                                                                                                                                       | `apps/web/src/review/review-workspace.tsx:463-466`                                                                                                 |
| C10           | `reviewer` of a variant is `actor_id` of the decision, which is the numeric GitHub user ID.                                                                                                                                                                 | `apps/web/src/api/review.ts:500`, `:857`; `packages/service/src/review-commands.ts:250`                                                            |
| C11           | A human decision must have an `actor_id`. An automatic decision has none.                                                                                                                                                                                   | `apps/web/migrations/0001_service.sql:139-152`                                                                                                     |
| C12           | The refusal compares `decision_revision` with `expectedRevision`: "A target changed or belongs to another comparison."                                                                                                                                      | `packages/service/src/review-commands.ts:186-193`                                                                                                  |
| C13           | The client test mocks a reviewer that production does not send: "Updated by octocat".                                                                                                                                                                       | `apps/web/src/review/__tests__/review.browser.test.ts:1239-1248`                                                                                   |
| C14           | The auth tables: `user(id, name, email, emailVerified, image, createdAt, updatedAt)` and `account(id, accountId, providerId, userId, 5 token columns, scope, password, createdAt, updatedAt)`. No login column. The only index on `account` is on `userId`. | `apps/web/migrations/0003_auth.sql`                                                                                                                |
| C15           | The sign-in configuration has no `mapProfileToUser` and no `overrideUserInfoOnSignIn`. Sessions last 7 days.                                                                                                                                                | `packages/security/src/auth.ts:29-47`                                                                                                              |
| C16           | Better Auth 1.7.5 stores `name: profile.name \|\| profile.login \|\| ""` and `image: profile.avatar_url`.                                                                                                                                                   | `node_modules/.pnpm/@better-auth+core@1.7.5…/dist/social-providers/github.mjs:80-82`                                                               |
| C17           | Better Auth updates the user row at a later sign-in only with `overrideUserInfo`. It updates the account row (tokens) at each sign-in when `updateAccountOnSignIn` is not false.                                                                            | `node_modules/.pnpm/better-auth@1.7.5…/dist/oauth2/link-account.mjs` (lines 13, 148, 178-181)                                                      |
| C18           | Better Auth drops a provider profile field when the additional field has `input: false`.                                                                                                                                                                    | `node_modules/.pnpm/better-auth@1.7.5…/dist/db/schema.mjs:116-127`                                                                                 |
| C19           | The login of the person who sends the request is in memory only (the login hint) and in `context.identity.login`. `GET /api/session` returns the GitHub user ID and the login of that person, and no page calls it.                                         | `packages/security/src/github.ts:187-262`; `apps/web/src/api/review.ts:713-720`                                                                    |
| C20           | No product code deletes a `user` row or an `account` row. Session rows are deleted on revocation and on installation removal. Tokens are set to NULL on revocation.                                                                                         | `packages/security/src/webhooks.ts:118-151`; `apps/web/src/api/webhooks.ts:131`; search for `DELETE FROM` over `apps/web/src` and `packages/*/src` |
| C21           | No app code reads `user.name`, `user.image`, or `user.email` today.                                                                                                                                                                                         | Search of `apps/web/src`, `packages/*/src`; also `reports/gap-trust-boundary/verification.md:47`                                                   |
| C22           | Who can review: GitHub permission `write` or `admin` on the repository. Each other permission gets 403 `not_maintainer`.                                                                                                                                    | `packages/security/src/github.ts:224-228`                                                                                                          |
| C23           | The run model has two D1 batches. The first is at lines 277-291 (3 statements). The one that reads the decisions is at lines 335-357.                                                                                                                       | `apps/web/src/api/review.ts`                                                                                                                       |
| C24           | The client queues decisions since commit `8ebf821`, "Keep review decisions durable while saving (#190)", 2026-10-02.                                                                                                                                        | `git log -1 8ebf821`; the commit changes `apps/web/src/review/client.ts` and adds `apps/web/src/operations/review-queue.ts`                        |
| C25 (checker) | After a clean save with no model in the answer, the page writes `reviewer: result.reviewer` into the variant. That value is the own GitHub user ID.                                                                                                         | `apps/web/src/review/navigation.ts:85-130` (`applySavedReview`)                                                                                    |
| C26 (checker) | A webhook delivery stores the complete payload, which has the login of its sender. The service sets the payload to `'{}'` when it has handled the delivery. So D1 holds a login only for a delivery that waits.                                             | `packages/security/src/webhooks.ts:84-95`, `:145-149`; `apps/web/src/api/webhooks.ts:150`, `:172`, `:330-334`                                      |
| C27 (checker) | The sign-in uses the GitHub App `visonaut-ci`: `GITHUB_CLIENT_ID` is `Iv23lihLxwLZeW7tlh5u`.                                                                                                                                                                | `apps/web/wrangler.jsonc:55`; `reports/gap-trust-boundary/verification.md:52`                                                                      |

## Facts from the first audit that this lane uses

- RESIL-06 (partly confirmed, medium): the real queued 409 has no reviewer. "Updated by 5550002." was an artifact of the mock. `reports/gap-session-resilience/verification.md:136-154`.
- COPY-15 (confirmed, low): the reviewer value is the numeric ID. `reports/findings.json`.
- STATE-05 (partly confirmed, low): the queued path never names the reviewer. The verifier noted the minimal option: "compute `reviewer` in the receipt route from the model and the targets". `reports/gap-review-state/report.md:375-401`, `verification.md:236-250`.
- STATE-01: a decision also fails with 409 "State changed. Refresh the comparison before trying again." when another write of the project commits in the same moment. That conflict has no reviewer to name. `reports/gap-review-state/report.md:226-268`.
- RESIL-03: after a reload with queued decisions, a second decision for the same variant ends in a conflict. `reports/gap-session-resilience/`.
- TRUST-01: `POST /api/auth/update-user` changes the user row with a session cookie only (measured by the trust lane). `reports/gap-trust-boundary/verification.md:45-47`.
- TRUST-01, correction 1 of its verifier: the sign-in App is private, so sign-in is not open to each GitHub account. `reports/gap-trust-boundary/verification.md:50-58`. The first draft of this lane missed this.

## Experiments

The experiments of the first agent are in `probe/`. The experiment of the checker is in `checker/`. They read repository source and write only into the lane folder.

Run them from the repository root:

```sh
pnpm exec vitest run --config /Users/diegohaz/.claude/jobs/f65a6229/tmp/round2/res-05/probe/vitest.probe.config.mjs
pnpm exec vitest run --config /Users/diegohaz/.claude/jobs/f65a6229/tmp/round2/res-05/checker/vitest.checker.config.mjs
```

Environment: Node 24.18.0, Vitest 5.0.1, Miniflare 5.20260921.0-alpha (a real local D1), the complete numbered migrations, Better Auth 1.7.5 through `createAuth` of `packages/security`, the real `handleApi` and `Service`. GitHub is a stub: the token endpoint, `GET /user`, `GET /user/emails`, and the permission check. `probe/harness.ts` is a copy of the harness of the `gap-review-state` lane with two changes: the users sign in through the real OAuth callback, and each D1 statement is recorded with `meta.rows_read` and `meta.rows_written`.

People and numbers have the shape of the lab fixtures (`apps/lab/src/fixtures/data/people.ts:48-54`, `pulls.ts:20-24`): Haz (`diegohaz`, 3068563), Kenji Mori (`morikenji`, 19044863), pull request #7754.

### The second run of the probes (checker)

- The checker ran all three probes again (65 s). `checker/compare-results.mjs` compares the two sets of result files with the random identifiers removed. The first results are in `checker/results-before/`.
- `sign-in-today.json` and `sign-in-login-column.json`: 0 different lines.
- `conflict-story.json`: 7 different lines of 314. Each is a `rowsRead` total: the run model read 930 rows in the second run and 938 in the first, and the name read with the subquery read 14 and 17 rows in place of 16 and 19. Each status, each key list, each text, each `rowsWritten` (26, 13, 0), and the rows of the proposed read (4, 200, 2,000, and 1,208 for the subquery form) are the same.
- So the record says "about 930 rows" for the run model, not 938.

### E1. What does a sign-in store? (`probe/sign-in.probe.ts`, result `probe/results/sign-in-today.json`)

- Question: does D1 hold a name, a login, or a picture of a reviewer after a sign-in?
- Expected: `user.name` is the profile name, `user.image` is the avatar address, `account.accountId` is the numeric ID, and no cell holds the login.
- Observed: as expected. `user.name` = "Haz" and "Kenji Mori". `user.image` = `https://avatars.githubusercontent.com/u/<id>?v=4`. `user.email` holds the email address. A search of 617 columns in 74 tables for the four logins found one cell: `user.name` = "okafor-amara", for a profile with `name: null` (the fallback of C16).
- Limit of that search: the test database had no webhook delivery. In production a delivery that waits holds the login of its sender (C26).
- A first sign-in wrote 23 rows (D1 `rows_written`): `rateLimit` 3 + 3, `verification` 3 + 1, `user` 3, `account` 3, `session` 4, `auth_audit` 3.

### E2. Does a later sign-in refresh the name? (same file)

- Expected: no (C17).
- Observed: no. After a change of the GitHub profile to name "Kenji M." and login `kenji-mori`, the row still has "Kenji Mori". The second sign-in wrote 18 rows. It updates `account` (1 row) and does not touch `user`.

### E3. The conflict on the real handler (`probe/conflict.probe.ts`, result `probe/results/conflict-story.json`)

- Question: what are the exact requests, answers, and texts of one conflict, and does the 409 answer hold enough to name the reviewer?
- Expected: the 409 has `error` and `model` only (RESIL-06). The model has the variant with a new revision and the reviewer ID.
- Observed:
  - Both open the run: `GET /api/runs/{run}` 200. Variant: revision 0, no verdict. Details text of today: "light · Needs review" (the fixture label is "light").
  - Kenji rejects: `POST /api/comparisons/{comparison}/commands` with `queued: true` gives 202. 26 rows written, in `work_tasks`, `visonaut_decisions`, `visonaut_comparison_rows`, `visonaut_commands`, `visonaut_audit`, `visonaut_projects`, `visonaut_runs`, `visonaut_status_outbox`. Receipt: 200, variant at revision 1, `reviewer: "19044863"`.
  - Haz approves with `expectedRevision: 0`: 202. 13 rows written, all in `work_tasks`. Receipt: 409, keys `["error", "model"]`, message "A target changed or belongs to another comparison." The receipt read wrote 0 rows.
  - The model of the 409 has the variant with `revision: 1`, `verdict: "rejected"`, `source: "human"`, `reviewer: "19044863"`.
  - Decision bar today: "Conflict. A target changed or belongs to another comparison." Details today: "light · Rejected · 19044863".
  - The proposed page function found the variant from the command and the model. The proposed text: "Conflict. Kenji Mori rejected this variant. Your approval was not saved." Details: "light · Rejected · Kenji Mori".
- Two tabs of one reviewer (step 5): tab 1 approves, tab 2 rejects with revision 0. 409 with `["error", "model"]`. The variant has `reviewer: "3068563"`, the own ID. Proposed text: "Conflict. You already approved this variant. Your rejection was not saved."

### E4. The cost of the name read (same file, steps 4, 6b, 6c, 7; and `checker/checker-result.json`)

- Question: how many rows does the read cost, and does it write?
- Three forms were measured.

| Form                                                                                    | 2 account rows, run of 2 screenshots | 2 account rows, run of 300 screenshots | 10 account rows | 100 account rows | 1,000 account rows | Rows written |
| --------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------- | --------------- | ---------------- | ------------------ | ------------ |
| A. All GitHub accounts with their names; the Worker keeps the names that the page needs | 4                                    | 4                                      | 20 (checker)    | 200              | 2,000              | 0            |
| B. Accounts whose ID is an `actor_id` of the decisions of the comparison (a subquery)   | 14 to 19                             | 1,208                                  | not measured    | 117              | 1,017              | 0            |
| C. Accounts whose ID is in a bound JSON list                                            | 6                                    | not measured                           | not measured    | 104              | 1,004              | 0            |

- Expected before the run: form B is cheap. Observed: form B reads the rows of the comparison again, so it grows with the run (1,208 rows for 300 changed variants). The first agent had written "account rows plus 17" in a first draft. That was wrong for a large run, and the larger run corrected it.
- Selected for the proposal: form A. It is the simplest statement, its cost does not depend on the run, and it is 2 rows for each account row. For scale: the run model read about 930 rows for 2 screenshots and 8,992 rows for 300 screenshots.
- The account table has a real limit today: 10 people can sign in (E7). So form A reads 20 rows at most.
- Query plan of form B: `SCAN account`, then index searches. `account` has no index on `accountId`.
- Form C needs the IDs before the statement, so it is one more round trip on a live run.

### E5. A reviewer whose session rows were deleted (same file, steps 6 and 8)

- Expected: the name stays, because only `session` rows go.
- Observed: after `DELETE FROM session WHERE userId = <Kenji>` the read still gives "Kenji Mori". After the token clear of D-AUTH-05 (`UPDATE account SET` the 5 token columns `= NULL`) the read still gives both names.
- After `DELETE FROM "user"` for Kenji by hand (the account row goes with it, by the foreign key), the read gives no name. Proposed fallback text: "Conflict. Another reviewer rejected this variant. Your approval was not saved." and "light · Rejected · GitHub user 19044863".

### E6. The cost of a login (`probe/sign-in.probe.ts`, result `probe/results/sign-in-login-column.json`)

- Question: what does it cost to store the login at sign-in?
- Setup: `ALTER TABLE "user" ADD COLUMN login TEXT`, `user.additionalFields.login`, and `mapProfileToUser: (profile) => ({ login: profile.login })`, on the options of the real `createAuth`.
- Expected: a new reviewer gets the login in the same INSERT. An existing reviewer gets none without `overrideUserInfoOnSignIn`.
- Observed:
  - With `input: false` on the field, the login stayed NULL also for a new reviewer (C18). The first agent did not expect this. The Better Auth documentation says the same: "mapped values for fields marked `input: false` are ignored".
  - With the default `input`, a new reviewer got `login: "okafor-amara"`. Rows written: 23, the same as today.
  - An existing reviewer signed in again: login still NULL. Rows written: 18, the same as today.
  - With `overrideUserInfoOnSignIn: true`: the login is filled. Rows written: 20, which is 2 more for each sign-in (one `UPDATE "user"`).

### E7. Who can sign in, who can review, and who decides (read-only commands, 2026-10-06)

- `gh api "repos/ariakit/ariakit/collaborators?per_page=100"`: 10 accounts. 5 have push permission: 2 with the role `admin`, 3 with the role `write`. 1 of the 5 is the automation account `ariakit-bot`. 5 have the role `triage`. The checker ran the command again and got the same counts.
- Checker: `gh api "orgs/ariakit/members?per_page=100"`: 10 members. `...collaborators?affiliation=outside`: 0.
- Checker: the sign-in App is private. `gh api apps/visonaut-ci` gives owner `ariakit` (Organization). Anonymous `GET https://api.github.com/apps/visonaut-ci` gives 404, and the same request for the public App `renovate` gives 200.
- Checker: `gh pr list --repo ariakit/ariakit --state merged --limit 1000 --search "merged:2026-09-06..2026-10-06" --json mergedBy`: 232 merged pull requests. 159 merged by one person, 72 by `app/renovate`, 1 by a second person.
  - Expected before the run: 2 or 3 people who merge. Observed: one person made 159 of the 160 merges that a person made.
  - This is a proxy. It counts merges on GitHub, not review decisions in Visonaut.
- The record names counts only.

### E8. A clean save with no model, and the name list (checker; `checker/checker.probe.ts`, result `checker/checker-result.json`)

- Question: the first draft said that the run model gets the names "for the reviewers of this run only". Does the page then have a name for the own decision of the person who looks?
- Why it matters: D-RUN-05 has the answer `receipt-only`, so a clean save returns no new model. The real `applySavedReview` then writes the own GitHub user ID into the variant (C25).
- Setup: Haz opens the run of pull request #7754 with no decision in it. Haz approves one variant. The probe removes `model` from the real 200 receipt and gives the rest to the real `applySavedReview`.
- Expected: the variant gets `reviewer: "3068563"`, and a list with only the earlier reviewers is empty.
- Observed: as expected. The receipt without the model has the keys `commandId, revisions, selection, baselineRevision, promotionId, previousRunRevision, runRevision, reviewer, runStatus`. The variant: revision 1, approved, human, reviewer "3068563". With the list of the first draft (`{}`), the proposed Details text is "light · Approved · GitHub user 3068563". With Haz in the list, it is "light · Approved · Haz".
- Result: the name list must hold the person who looks. The record and the option text now say so.
- The same probe measured form A with 10 account rows: 10 rows returned, 20 rows read, 0 rows written.

## Platform sources (read on 2026-10-06, and read again by the checker)

- D1 pricing and counting: https://developers.cloudflare.com/d1/platform/pricing/ . Free plan: 5 million rows read and 100,000 rows written in one day. Paid: 25 billion rows read and 50 million rows written in one month included, then $0.001 and $1.00 for each million. A full table scan counts each row. "Indexes will add an additional written row when writes include the indexed column."
- Better Auth OAuth options: https://www.better-auth.com/docs/concepts/oauth . `mapProfileToUser` can "populate additional user fields from the provider profile". `overrideUserInfoOnSignIn` is false by default.
- GitHub username changes: https://docs.github.com/en/account-and-profile/concepts/username-changes . "After changing your username, your old username becomes available for anyone else to claim."
- Private GitHub Apps (checker): https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private . For a private App that an organization owns: "it can only be installed on the account that owns the app. Only members of the organization that own it can authorize it."

## The three standing rules, for each option

| Option             | D1 writes                                                                                                                  | Backward compatibility                                                                       | Simpler                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `nobody`           | No change.                                                                                                                 | Not necessary: nothing changes.                                                              | The smallest change: one sentence leaves the guide. It does not solve the problem of the reviewer.                                         |
| `you-or-another`   | No change. No read more.                                                                                                   | Not used: the page may replace the server sentence, and the test with the mock changes.      | One field and one page function. No dependency.                                                                                            |
| `stored-name`      | No change: 0 rows written (measured). 20 rows read more for each run model read.                                           | Not used: no old answer shape is kept. The dead `reviewer` key of `conflictResponse` can go. | One statement in a batch that exists, one list, and the page function. No column, no migration. It depends on the allow-list of D-AUTH-01. |
| `login-at-sign-in` | No change for a decision or a sign-in (23 and 18 rows, measured). One production write for each person of today, one time. | Not used.                                                                                    | One migration, two auth options, and a production statement. More parts than a name for the same sentence.                                 |

## Options

| Option             | Status                                         | Reason                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nobody`           | In the decision (id kept)                      | The minimal option. It removes the promise. It also needs a note for C2.                                                                                                                            |
| `you-or-another`   | In the decision (new id, added by the checker) | Page code and one field from the access check. No D1 read. It gives the full text for the case that occurs first (the second tab of one person). Its texts are the fallback texts of `stored-name`. |
| `stored-name`      | In the decision (new id), recommended          | E1, E3, E4, E5, E8: one read, 0 rows written, no schema change, no GitHub request, no production statement.                                                                                         |
| `login-at-sign-in` | In the decision (new id)                       | Replaces `login`. E6 gives its cost.                                                                                                                                                                |

### Rejected

- `numeric-id` of revision r1 (the queue keeps the target, and the receipt gets a reviewer field): more server code than a page function for the same text. The model of the 409 already has the reviewer (E3).
- `numeric-id-client` of the first draft (the page prints "Updated by 19044863." with no server change): removed by the checker. For the case that occurs first, the second tab of one person, it prints the own number of that person: "Updated by 3068563." The option `you-or-another` costs one field more and gives a text that a person can read in both cases.
- `login` of revision r1 (store the login with each decision): the login is free at decision time (`context.identity.login`, C19), and it adds no row. But it needs a column on `visonaut_decisions` and on `visonaut_closed_summary_decisions`, a change of the copy statement for carried approvals (`packages/service/src/local-comparison.ts:614`), and the queue payload. Decisions of today would have no login. That is more parts than a column on `user`, for the same text.
- Write the login into `user.name` with `mapProfileToUser` (no new column): the column would mean a name for old rows and a login for new rows. That is not clear to a reader of the table.
- `overrideUserInfoOnSignIn: true` to refresh the name or the login: 2 more rows written for each sign-in (E6). It breaks standing rule 1.
- Ask GitHub for the login at the time of a conflict (`GET /user/{id}`): a request to GitHub in the receipt path, and a new failure mode. The stored name needs none. It also gives no name to the Details panel.
- An index on `account(providerId, accountId)`: it removes the scan and adds one row written at each first sign-in. Not necessary for a table with 10 rows at most.
- The name read as a subquery over the decisions of the comparison (form B of E4): its cost grows with the run.
- A name from the browser (the public GitHub API or the avatar address by ID): a request from the page to GitHub with a rate limit for each address, and a new origin for the page.
- The names of all people who signed in, with no filter in the Worker (checker): two lines less, but a reviewer would get the names of organization members who signed in and never reviewed. The filter costs a few lines.
- The login from a stored webhook payload (checker, C26): the service empties the payload after it has handled the delivery, and a reviewer is not always a sender.

## Design of the recommended option, in short

1. Server, `apps/web/src/api/review.ts`: one more statement in the first batch of `reviewModel` (form A). The model gets `viewer` (`context.identity.githubUserId`) and `reviewers` (GitHub user ID to name, for the person who looks and for each reviewer of the run). The `reviewer` of a variant stays the ID. D-UX-04 adds the login of the person who looks: one `viewer` field can hold both.
2. Page, `apps/web/src/review/use-review-session.ts`: in `reportError`, find the target whose revision in the 409 model differs from `expectedRevision`. Build the text from its verdict and its reviewer. No changed target, an Undo, or an automatic decision: print the server message, as today.
3. Page, `apps/web/src/review/review-workspace.tsx:465`: print the name, or "GitHub user <id>" when the model has no name.
4. Cleanup that backward compatibility does not block: remove `reviewer` from `conflictResponse` and from `ReviewCommandError`, and change the client test so that it tests the real 409.
5. Order: after the allow-list of D-AUTH-01, because `/api/auth/update-user` lets a signed-in person change their own `user.name` today.

The option `you-or-another` is steps 2 to 4 and the `viewer` field of step 1, with no statement and no `reviewers` list.

Texts (run by the text builder of `probe/conflict.probe.ts` on the real 409 model):

- Another reviewer: "Conflict. Kenji Mori rejected this variant. Your approval was not saved."
- Own decision: "Conflict. You already approved this variant. Your rejection was not saved."
- No row for the reviewer, and the option with no name: "Conflict. Another reviewer rejected this variant. Your approval was not saved."
- Details: "… · Rejected · Kenji Mori", or "… · Rejected · GitHub user 19044863".
- Not run: "… · Approved · you" (the option with no name), the login texts with "@morikenji", and a decision for a whole screenshot: "Conflict. Kenji Mori rejected 1 of the 6 variants. Nothing was saved."

## How the checker tried to refute the recommendation

| Attack                                                 | Result                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A hidden D1 write.                                     | None. The read is one SELECT: `rows_written` 0 in each run. `viewer` comes from the access check. The page code writes nothing.                                                                                                                                                                                                                                                              |
| A case that the page function does not cover.          | Read in the code: a new comparison (other row IDs), a row that is not `changed`, an Undo, an automatic decision, and the conflict of STATE-01 have no changed human decision, and the function then prints the server message. A third reviewer who decided after the second: the text names the last one, which is the decision that is there. Not run: the whole-screenshot case and Undo. |
| The own decision after a clean save.                   | Found a gap (E8). Repaired: the name list holds the person who looks.                                                                                                                                                                                                                                                                                                                        |
| The selected answers of other decisions.               | D-RUN-05 `receipt-only` keeps the model in a conflict answer, so the page function has its input. D-RUN-02 `attention-first-response` keeps the changed rows in the first response, and a conflict is always on a changed row. D-AUTH-05 `stop-and-clear` keeps the rows (E5). D-UX-04 `fields-with-a-source` adds the login of the person who looks, which fits the same `viewer` field.    |
| The account table grows without limit.                 | The first draft said that each person on GitHub gets a row at sign-in. Wrong: the App is private, and only the 10 organization members can sign in (E7, documented by GitHub, not tested with an outside account). The read is 20 rows at most today.                                                                                                                                        |
| A rule of the contract.                                | `docs/current-contract.md:83` keeps the status and the message of a conflict response. The server answer does not change: the page builds its own sentence from the model, as the accepted list of D-RES-01 does for a replaced run. No line of the contract names the reviewer text.                                                                                                        |
| A simpler option that names a person.                  | None found. A name needs a source: the stored row (one read), GitHub (a request), or a new column. The stored row is the smallest.                                                                                                                                                                                                                                                           |
| A simpler option that solves the problem with no name. | Found: `you-or-another`. It is now the second option. It does not make the guide sentence true, and it prints a number for another person. The recommendation stays with `stored-name`, because the difference is one read-only statement, and the record says when the simpler option is the better answer.                                                                                 |

## What would make the recommendation wrong

- The maintainer expects to stay the only reviewer and wants no read for a text that only a second reviewer sees. Then `you-or-another` gives the same text for the own tabs.
- The stored names in production do not tell the reviewers apart (an empty name cannot occur: C16 falls back to the login; two equal names can). One read-only statement shows them: `SELECT account."accountId", "user".name FROM account JOIN "user" ON "user".id = account."userId" WHERE account."providerId" = 'github'`.
- The maintainer wants the GitHub login on the page.
- D-AUTH-01 is not implemented, so a person can still edit their own stored name.

## What the checker changed

| #   | First draft                                                                                                                                 | Problem                                                                                                                                                               | Repair                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "A person without access also gets an account row at sign-in, so the first slider goes to 1,000." The calculator started at 5 account rows. | The sign-in App is private. GitHub lets only organization members authorize it, and `ariakit` has 10 members. The first audit had this fact (TRUST-01, correction 1). | The record says that 10 people can sign in and that the read is 20 rows at most. The calculator starts at 10. The value 1,000 stays as the case of a public App. |
| 2   | "The run model of the same test read 938 rows."                                                                                             | The second run read 930. The number is not stable.                                                                                                                    | "about 930 rows".                                                                                                                                                |
| 3   | The run model gets the names "for the reviewers of this run only".                                                                          | After a clean save the page writes the own ID into the variant, and the list has no name for it (E8).                                                                 | The list holds the person who looks and each reviewer of the run.                                                                                                |
| 4   | Option `numeric-id-client`: "Updated by 19044863."                                                                                          | For the second tab of one person it prints the own number. One person made 159 of 160 human merges, so that case is the main one.                                     | Replaced by `you-or-another`.                                                                                                                                    |
| 5   | "It is rare for 4 people" with no number.                                                                                                   | The task asks how often, from data.                                                                                                                                   | Added the member count, the App rule, and the merge count of 30 days. The sentence stays an assumption and names its base.                                       |
| 6   | "`morikenji` is in no cell" and "No table has a login".                                                                                     | True for the test database. In production a webhook delivery that waits holds the login of its sender (C26).                                                          | One sentence in the table. The claim is now "no column, and never for a reviewer".                                                                               |
| 7   | The table of reviewer data had no email row.                                                                                                | `user.email` is stored at sign-in too.                                                                                                                                | Added the row, with the note that no option reads it.                                                                                                            |
| 8   | The part started with the definition and gave the recommendation after about 7,000 px.                                                      | The maintainer wrote "I don't understand this".                                                                                                                       | A "Today" and "Recommended" pair at the top with the two exact texts, and a link to the options.                                                                 |
| 9   | The compare demo had 5 panels, and "Today" and "Name nobody" had the same text.                                                             | Two panels with equal text.                                                                                                                                           | 4 panels. Each has a row "What changes" and a row "D1". The badge counts added D1 statements (0, 0, 1, 1).                                                       |
| 10  | The calculator output for rows written showed `decisions * 26` only.                                                                        | The rule of the maintainer is about added writes.                                                                                                                     | One more output: rows written that each option adds. It stays 0 for each slider position.                                                                        |
| 11  | The page code sample had one function.                                                                                                      | The fallback rule (when the page prints the server message) was only in prose.                                                                                        | The sample has the text function too, in the code style of the repository.                                                                                       |
| 12  | The calculator said "Run model reads in one day" with no explanation.                                                                       | A reader cannot know what counts as a read.                                                                                                                           | A hint: one page load is one read, and today each saved decision is one more (D-RUN-05 removes that one).                                                        |

## Limits

- No production read. Nobody saw the real `user` rows, the number of people who decided, or the number of conflicts. The two statements that give the counts: `SELECT COUNT(DISTINCT actor_id) FROM visonaut_decisions WHERE kind = 'human'` and `SELECT COUNT(*) FROM work_tasks WHERE kind = 'review' AND json_extract(result, '$.error') LIKE 'A target changed%'`.
- The merge count is a proxy for who decides. It is not a count of Visonaut decisions.
- The rule that only organization members can sign in comes from the GitHub documentation and from the private state of the App. Nobody tried a sign-in with an account from outside the organization. If a person makes the App public, the rule ends with no code change.
- The rows read and written are from Miniflare's local D1, not from production D1. The counts of rows written were the same in two runs. The times are not measured.
- The proposed server change was not written into the product. The statement ran alone on the same database, not inside `reviewModel`. The page function and the text builder ran in the probe, not in the React page. No browser test of the new texts.
- The closed-run path (`archive`) was read in the code and not run. The first batch of `reviewModel` runs for a closed run too, so form A fits it.
- The whole-screenshot text, the Undo case, the text "you" of the Details panel, and the login texts were not run.
- The conflict of STATE-01 (a write at the same moment) was not run again. It has no changed target, so each option prints the server message.
- The fixture label of a variant is "light". The record uses a label in the production form, "React · Chromium · Light · 1280 × 720", which the verifier of the first audit recorded.
- No screen reader check of the new part. The page check (`check.mjs`) passed for both outputs at 1440 px and at 400 px, and both agents looked at the part and used the three demos in Chrome at both widths (`look/` for the first draft, `checker/look/` for the repaired part).
- Line 163 of the section (the demo of D-RES-01: "As today. Decision D-RES-05 adds the name.") is outside this lane. With the second, third, or fourth option the page replaces that sentence, so "D-RES-05 decides this text" is more exact. The coordinator can change it at the merge.
- First agent: during the session two ignored state files below the repository changed: `apps/lab/audit/.wrangler/cache/cf.json` (18:15) and a `.sqlite-wal` file of `apps/lab/.wrangler` (18:10). Other processes run there (the lab dev server since 2026-10-05, and a second Node and workerd pair that started at 18:08). The commands of the lane ran from the repository root and name no path below `apps/lab` for writing. Nobody proved which process wrote the two files. `git status` is the same as at the start, also after the work of the checker.

## Files of the lane

- `content/`: the copy of the record. Changed: `sections/65-resilience-a11y.html` (only the D-RES-05 part), `decisions.json` (only D-RES-05), `terms.json` (4 new terms).
- `decisions.patch.json`, `terms.patch.json`: the patches.
- `draft/res-05-block.html`: the source of the new part. `draft/rebuild-copy.py` makes the copy again from the repository files, the block, and the patches. Run `pnpm exec oxfmt` on the three files after it.
- `draft/look.mjs`, `look/`: the browser pictures of the first draft at 1440 px and 400 px.
- `probe/`: the experiments of the first agent and `probe/results/*.json` (the results of the second run).
- `checker/`: the work of the checker. `results-before/` (the results of the first run), `compare-results.mjs`, `checker.probe.ts` with `checker-result.json`, `terms-check.mjs`, `look.mjs` with `look/`, and the first versions of the block, the decision patch, and these notes (`*.first-agent.*`).
- `out/`: the built page.
