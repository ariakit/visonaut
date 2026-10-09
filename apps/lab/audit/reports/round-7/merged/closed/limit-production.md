<!--
  Merged copy with the final decision ids.
  Source: /Users/diegohaz/.claude/jobs/f65a6229/tmp/round7/decisions/limit-production/closed.md
  A path that starts with check/, withdrawn/, evidence/, or scripts/, and the file notes.md,
  are in the source folder.
  A path fragments/<decision id>.html, a path closed-fragments/..., and the draft decisions.json
  are in the merged folder: /Users/diegohaz/.claude/jobs/f65a6229/tmp/round7/merged
  The files contract-changes.md, contract-changes.json, and sensitive-findings.json are in the
  folder data/ of the merged folder.
-->

# Things of items 2, 3, and 4 that are not decisions

Lane: `round7/decisions/limit-production`. Date: 2026-10-07. Each fact has a label: measured, counted from code, or assumption. Nothing in this file ran against production.

The lane made one decision, D-PRE-04 (who makes the read-only reads). This file has the four things that need no decision, and how the record closes each. An independent check corrected this file on 2026-10-07. The corrections are in `check/check-notes.md`.

## C1. The capture limit of one run (item 2)

**Verdict: not a choice today. The measurement is a task of the implementation that the maintainer authorized on 2026-10-07. The number comes back to the maintainer one time, in a contract pull request that nobody merges before the maintainer approves it.**

### Why it is not a choice today

- Counted from the documents: the earlier decision D54 is not in `docs/current-contract.md` (0 matches for "D54"). It is in `docs/simplification-audit/contract-issue-1.md`, which `docs/current-contract.md:7` makes binding.
- Counted from the documents: D54 has three forms, and they do not say the same thing about who selects the number.

  | Form                                                                                                                                                        | Words                                                                                                                                                                          |
  | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | The ledger of the binding file, `contract-issue-1.md:462`                                                                                                   | "Measure first, then select and document conservative numeric limits under the maintainer's implementation authorization"                                                      |
  | The prose of the binding file, `contract-issue-1.md:342`                                                                                                    | "D54 selects **measure first, then approve numeric limits**."                                                                                                                  |
  | The option that the maintainer selected, `docs/design-r9.json` (D54, option `measure`), which the contract keeps as history (`current-contract.md:7`, `:9`) | "Return with numeric limits and a full cost report before readiness is declared." Example: "The cost/latency/size limits remain open until the measured proposal is accepted." |

- Each form says "Measure first". So "approve about 20,000 now" is not an option that D54 permits. A decision panel today would ask for the thing that D54 forbids.
- The forms differ only after the measurement. The ledger lets the implementation select the number. The other two forms ask that the maintainer accepts the measured proposal.
- One act satisfies each form: a contract pull request that states the number, with the measurement, and that the maintainer approves. The maintainer agreed to contract pull requests today: "3. Ok". So the record needs no panel today.
- The words of the maintainer that close it: "I authorize the implementation, the GitHub writes, the two writes to production D1, and the package publication and the change in ariakit/ariakit." And "3. Ok".
- The measurement is not a matter of opinion: a small experiment gives it. `AUTHORING.md:463` says: "Do not ask for a fact that the repository or a small experiment can give."
- Counted from code: the limit of today is `maximumCaptures: 40_000` (`apps/web/src/runtime-defaults.ts:14`). The number is one setting, so a change of the setting reverses it. Measured in the record: the largest run of today has 3,832 captures, so "about 20,000" is 5.2 times the suite.
- D54 is about limits of performance and cost in general: "cost/latency/size limits". It does not name a capture count. The record applies it to the capture limit, and that reading is reasonable: D54 lists "Worker CPU/memory" as a thing to measure.

### The thing that stays open, and where it must stay visible

The approval of the number is not closed. It only has a later date. The record must not hide it:

- The settled answer of D-DATA-02 says "about 20,000", and its rationale says that this is "not an approved number". Both stay true until the contract pull request.
- When item 2 leaves the list "What still needs your word", the record keeps one visible line for it, for example in a short list "What comes back to you later": "The capture limit of one run: one contract pull request with the measured number, which waits for your approval."
- The rule that gives the number is a part of the approval. The proposal below (two Submits at the same time) and the alternative (five, the limit of active runs) give very different numbers: about 17,000 and about 6,900 captures with the Node values (estimate, a straight line through `submit.json`). So the pull request states the rule and the table, not only the number.

### What the Node measurement is (verified in the reports)

- Measured, Node v24.18.0, one laptop: one Submit holds 54.6 MB (validation, with the baseline list alive) and 55.6 MB (materialization) at 20,000 captures, and 109.1 MB and 111.0 MB at 40,000. Source: `apps/lab/audit/reports/round-3/data-02/check/submit.json`, lines 25 to 41.
- Counted from the probe: it does not run the real steps. It builds objects in the shapes of `validateLocalSubmission` and `materializeBundle` (`reports/round-3/data-02/check/submit.probe.ts.txt:128-220`). Its note says: "The canonical JSON texts, the digests, and the D1 statements of the real steps are not in these numbers." (`submit.json:3`)
- Counted from the reports: the code of step 1 of D-DATA-02 does not exist. So a Worker measurement is possible only after the service part of step 1 is built.
- Measured in an earlier lane: local workerd holds parsed inventories in 15 to 21% fewer bytes than Node (`reports/gap-unexplained-waits/verification.md:26`, `:243-254`). That lane also found a method for a live heap number in local workerd: `HeapProfiler.takeHeapSnapshot`, then `Runtime.getHeapUsage` (`verification.md:252`).

### What the implementation must do

The order agrees with "3. Ok" (the contract is updated first): the number is in a contract pull request before the code of step 1 is live.

1. Build the service part of step 1 of D-DATA-02 on a branch. The measurement needs the real code.
2. Measure on that branch, in a Worker runtime. Counted from code: the repository has local workerd through `miniflare` 5.20260921.0-alpha (`apps/web/package.json:40`). Run the real Submit validation and materialization at 3,832, 10,000, 20,000, and 40,000 captures. Measure one Submit, two Submits at the same time in one isolate, and five. Counted from code: five is the limit of active runs (`apps/web/src/runtime-defaults.ts:17`). Read the live heap after a heap snapshot, and the backing stores (`Runtime.getHeapUsage.backingStorageSize`, which counts a `Uint8Array`: `docs/evidence/worker-memory/README.md:28`).
3. Select a conservative number, and write the rule that gives it. A proposal for the rule, which is an assumption of this lane: two Submits at the same time hold no more than 96 MB, which is 75% of the 128 MB of one isolate. With the Node values, two Submits hold 111 MB at 20,000 captures, so this rule gives a number below 20,000 unless workerd holds less. The rule must say why it counts two Submits and not five.
4. Open one contract pull request that states the number, the rule, and the measurement, as D54 asks: "State workload, environment, and percentiles." It changes the sentence of line 26 that names the limit. The implementation does not merge this pull request. The maintainer approves it: that is the acceptance that two forms of D54 ask for.
5. After the approval, merge the code of step 1 with that number in one setting, in place of `maximumCaptures: 40_000`. The service refuses a larger run before the uploads, with a reason that names the limit and with its own error code, so that the wait of D-OPS-05 does not apply (rationale of D-OPS-05, revision r4).
6. D54 names issue #61 for the record of the limits. Measured with `gh` on 2026-10-07: issue #61 is closed since 2026-10-01, with the reason "not planned". So the implementation issue of step 1 holds the record.
7. State the scope of the number: local workerd, not a hosted Worker. Counted from the documents: `docs/evidence/worker-memory/README.md:3` and `:22` say that a local value does not establish a hosted peak, and that local workerd enforces the memory limit in another way. Contract line 188 says: "No hosted diagnostic run is authorized by this contract."
8. After the release, the hosted signal is free: the invocation status "Exceeded Memory" of the Worker `visonaut` in the Cloudflare dashboard (assumption: Cloudflare limits page, read on 2026-10-07 through a tool that summarizes it).
9. Stop and ask the maintainer before the pull request in one case only: the measured number is below 10,580 captures. That is the planning number of the contract (`docs/simplification-audit/contract-issue-1.md:340`: "Plan for approximately **10,580 images per full run**"), and it is 2.8 times the suite of today. Below it, step 2 of D-DATA-02 comes sooner. The record names this case in `40-data-storage.html:2536-2541` ("What would make you change the answer").

### Where the record states it

- `15-your-answers.html`, list "What still needs your word": item 2 leaves the list of open questions, and one line stays visible for the later approval (see above).
- `40-data-storage.html`, anchor `data-inventory-outside`, first item of the list: new words (below).
- `40-data-storage.html`, anchor `data-scale-order`, item 3 (line 3048 of r7): "after the Worker measurement of D54" stays correct.
- `15-your-answers.html`, demo `demo-answers-order`, step 5: "The capture limit waits for one measurement in a Worker" stays correct. The measurement is now a task of that step.
- `decisions.json`, D-DATA-02, `rationale`: the sentence "the earlier decision D54 asks for a measurement in a Worker first" can get one more sentence (below). The decision stays settled, and its answer does not change.

The proposed words for `data-inventory-outside` are in `closed-fragments/limit-production/closed-C1-data-inventory-outside.html`. The draft build accepts them (see `check/check-notes.md`).

Proposed sentence for the rationale of D-DATA-02, after "asks for a measurement in a Worker first": "On 2026-10-07 the maintainer authorized the implementation. So the measurement is a task of the implementation, and the maintainer approves the number in the contract pull request that states it."

## C2. The UPDATE of D-AUTH-05 (item 4, first write)

**Verdict: authorized on 2026-10-07. Not a decision.** The words: "I authorize the implementation, the GitHub writes, the two writes to production D1, and the package publication and the change in ariakit/ariakit."

### What the statement does, exactly

- The table: `account`, which Better Auth owns. One row is one GitHub identity of one person who signed in. Counted from code: `apps/web/migrations/0003_auth.sql:6`.
- The 5 columns: `accessToken`, `refreshToken`, `idToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`. Counted from code: the tokens are stored encrypted (`packages/security/src/auth.ts:37`), and each sign-in writes them again (`auth.ts:38`, `updateAccountOnSignIn: true`).
- The rows: each row with `providerId='github'` that has a value in one of the 5 columns. Assumption: that is one row for each person who signed in since the cutover of 2026-10-04, about 10 rows or fewer. Counted from the documents: the cutover copied no user (`docs/baseline-delta-cutover.md:3`), and the two later moves copied all D1 data (pull requests #250 and #251). Nobody read the count.
- What stays in the row: the identity (`accountId`, `userId`), `scope`, and the dates. The tables `user` and `session` are not in the statement.

```sql
-- 1. Before: how many rows have a token. A read.
SELECT count(*) AS accounts_with_token FROM account
WHERE providerId='github'
  AND (accessToken IS NOT NULL OR refreshToken IS NOT NULL OR idToken IS NOT NULL
       OR accessTokenExpiresAt IS NOT NULL OR refreshTokenExpiresAt IS NOT NULL);

-- 2. The write. The statement of docs/operations/retire-preview-auth.sql:9-11, with one more
--    condition, so that a second run writes 0 rows.
UPDATE account SET accessToken=NULL,refreshToken=NULL,idToken=NULL,
                   accessTokenExpiresAt=NULL,refreshTokenExpiresAt=NULL
WHERE providerId='github'
  AND (accessToken IS NOT NULL OR refreshToken IS NOT NULL OR idToken IS NOT NULL
       OR accessTokenExpiresAt IS NOT NULL OR refreshTokenExpiresAt IS NOT NULL);

-- 3. After: statement 1 again. The result must be 0.
```

Measured in this lane, on a local SQLite file with the 33 migrations of `apps/web/migrations` (not D1, not production): with 3 accounts, of which 2 have a token, the UPDATE changes 2 rows, a second run changes 0, the count after is 0, and the 3 session rows stay. Script: `scripts/check-sql.mjs`. The check ran the script again with the same result.

### What a signed-in person notices

Nothing. Counted from code: the statement does not touch `session`, so nobody is signed out. No code of the service reads the 5 columns: the only two places outside the tests that name them set them to NULL (`packages/security/src/webhooks.ts:137`, which clears 3 of the 5, and `apps/web/src/operations/recovery.ts:40`). The access check uses the installation token of the App (finding AUTH-16). The routes of Better Auth that return a stored token (`get-access-token`, `refresh-token`) are closed by the allow-list of D-AUTH-01.

### When it runs, and how

1. After the deployment that has the token hook of D-AUTH-05 and the allow-list of D-AUTH-01. Counted from code: without the hook, the next sign-in stores a token again (`auth.ts:38`), so an UPDATE before the hook is not final.
2. One time, from `apps/web`, as three calls of `wrangler d1 execute DB --remote --env production --json --command "<one statement>"`: the count, the UPDATE, and the count again.
3. Not with `--file`. Counted from the code of wrangler 4.136.1 (`apps/web/node_modules/wrangler/wrangler-dist/cli.js:226486-226581`): with `--file` on a remote database, wrangler imports the file. It prints totals and not the rows of a SELECT, so the two counts are lost. It also warns: "This process may take some time, during which your D1 database will be unavailable to serve queries."
4. The result of the UPDATE must have `meta.changes` equal to the first count. The second count must be 0. The issue records the 3 numbers.

It fits standing rule 1: it is a one-time write of one row for each account, and no write that repeats with traffic.

### What the UPDATE does not reach (new facts of this lane, widened by the check)

- Counted from the documents: D1 Time Travel keeps 30 days on a paid plan (`apps/web/src/operations/README.md:74`). For 30 days, a restore of the database to a time before the UPDATE brings the encrypted tokens back.
- Counted from the files of the repository: four earlier databases have a name and an identifier.

  | Database                             | Identifier                             | Role                                                                       | Source                                                                |
  | ------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
  | `visonaut-production`                | `15fcd402-dccb-4359-a1ce-280ff67ca596` | Production before the cutover of 2026-10-04. 680 MB on 2026-09-29.         | `docs/operations/simplification-inventory.json:7-9`                   |
  | `visonaut-production-delta-20261004` | `f33b9393-cd04-4f7f-9213-428d1c3635b6` | Production from the cutover to pull request #250.                          | The diff of `apps/web/wrangler.jsonc` in the commit of #250           |
  | `visonaut-production`                | `441904d8-790b-44e3-9d83-a4c19e45c835` | Production from #250 to #251. "The complete database copy" (body of #250). | The diff of `apps/web/wrangler.jsonc` in the commits of #250 and #251 |
  | `visonaut-preview`                   | `395b539c-c423-4ce4-887c-a5792792a63b` | Preview.                                                                   | `docs/operations/retire-preview-auth-at-cutover.md:9`                 |

  The database of today is `visonaut`, `3c0b122f-9186-4d34-80a8-09a50eed2cc1` (`apps/web/wrangler.jsonc:70-71`).

- Assumption: some of the four still exist. The first has the stored tokens of each sign-in before the cutover. The second and the third have the same account rows as production had on 2026-10-04 and 2026-10-05. The UPDATE reaches none of them. Read 3 of D-PRE-04 (`wrangler d1 list`) says which exist. Their end is not one of the two authorized writes: the runbook says that "Database deletion and old bucket cleanup remain separate operator actions" (`docs/baseline-delta-cutover.md:179`).
- So this sentence of the option that the maintainer selected is too strong: "After the statement, no route and no database copy can give a GitHub user token." It is correct for the production database after 30 days, and only if no earlier database exists.
- A reader of a copy also needs `BETTER_AUTH_SECRET`, because the tokens are encrypted (`auth.ts:37`; option `keep-stored` of D-AUTH-05).

### Where the record states it

- `30-access-trust.html`, anchor `access-app`: the SQL block gets the extra condition, and its first comment changes from "only on your instruction" to "You authorized it on 2026-10-07". Two new paragraphs follow. The words are in `closed-fragments/limit-production/closed-C2-access-app.html`.
- `15-your-answers.html`, anchor `your-answers-d1-once`, row D-AUTH-05 (line 625 of r7): correct as it is ("With one more condition in the statement, a second run writes 0").
- `15-your-answers.html`, table of `your-answers-fit`, row "One App for sign-in and checks" (line 1651 of r7): "Then the UPDATE, on your instruction" becomes "Then the UPDATE, which you authorized on 2026-10-07".
- `15-your-answers.html`, demo `demo-answers-order`, step 3 (line 1702 of r7): "The UPDATE of D-AUTH-05 waits for your separate instruction" becomes "The UPDATE of D-AUTH-05 runs after this deployment".
- `decisions.json`, D-AUTH-05: the settled answer says "it runs only on a separate instruction of the maintainer". The answer stays. The rationale can get two sentences: "The maintainer gave that instruction on 2026-10-07. The UPDATE runs after the deployment with the hook, and it clears the production database only: the 30 days of D1 history and each earlier database are outside it."

## C3. The measurement for the limit of D-SCALE-02 (item 4, second write)

**Verdict: authorized on 2026-10-07, and it waits with its limit. Not a decision.**

- The words that authorize it: "the two writes to production D1".
- The words that make it wait, from round 4: "Let's defer this to when this is a problem." The record reads the selection and the note together: the form of the limit is decided, and nothing is built now (rationale of D-SCALE-02).
- What it is: one measurement that finds how many changed captures one D1 transaction can write in production. Measured on a local D1 in round 4: the run approval writes 5 rows for each change and 8 more, and the closed summary writes 8 rows for each change and 24 more. Nobody tested production D1.
- Estimate, from those formulas: at 20,000 changes the two transactions write 260,032 rows. With the removal of the test rows that is about 520,000 rows, which is 1% of the 50 million rows that the plan includes each month.
- One effect on production that the issue must name: the context of D-SCALE-02 says that "one database runs one query at a time". So a transaction of 160,024 rows holds each other query of production for its time. Nobody measured that time.
- What the implementation must do when the limit is built, and not before: write in the issue of the limit the exact statements, the row count, the tables, the time at which it runs, and how the test rows leave the database. Then run it one time.
- A doubt for that time (see `check/check-notes.md`): a new D1 database in the same account has the same platform limits and holds no data of the service. A measurement there writes no row to production and holds no query of production. It needs a new resource, which is not in the authorization of today.

### Where the record states it

- `40-data-storage.html`, line 3089 of r7, the paragraph "For the limit of D-SCALE-02, when it is built" in the note after the anchor `data-scale-order`: one more sentence, "You authorized its measurement on production D1 on 2026-10-07. It waits with the limit."
- `decisions.json`, D-SCALE-02, `rationale`: the sentence "That measurement writes rows, so it needs the word of the maintainer, and it waits too" becomes "That measurement writes rows. The maintainer authorized it on 2026-10-07, and it waits with the limit."
- `15-your-answers.html`, demo `demo-answers-order`, step 10 (line 1730 of r7): "its number needs the measurement of item 4" names an item of the list. It becomes "its number needs one measurement on production D1, which you authorized on 2026-10-07".
- `15-your-answers.html`, list "What still needs your word": item 4 leaves the list.

## C4. Two parts of item 3 that are not in D-PRE-04

- **The page load before and after the placement key.** It is a part of the settled answer to D-LOAD-02: "one /api/runs request is measured before and after the change." It is a use of the product in the browser of the maintainer, as on 2026-10-05 (`apps/lab/audit/reports/live-authenticated.md:3`). It is a task of the implementation step that sets the key.
- **The two settings of the GitHub App.** The maintainer reads them himself: token expiry and device flow of App 5028451 (`30-access-trust.html:514-522`, rationale of D-AUTH-02). This is a reminder, not a decision. It belongs in the implementation issue of D-AUTH-02 as a check box for the maintainer.

## What the list "What still needs your word" becomes for these three items

| Item of revision r7              | In the next revision                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2. The capture limit of one run  | No question today. The measurement is a task. One line stays visible: the number comes back in a contract pull request that waits for the approval of the maintainer. |
| 3. Read-only reads of production | One decision, D-PRE-04, in a new part `your-answers-reads`.                                                                                                           |
| 4. Two writes to production D1   | Closed. Authorized. The UPDATE runs after the hook. The measurement waits.                                                                                            |
