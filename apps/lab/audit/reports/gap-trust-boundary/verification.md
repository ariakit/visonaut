# Verification: trust boundary lane (gap-trust-boundary)

Commit `f83fef6`. Read-only. I did not write to the repository. Paths are relative to the worktree root unless they are absolute. My scratch directory is `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-trust-boundary/verify/`.

## Method and limits

- I opened each cited file and compared the quoted code with the lines.
- I copied the four probes of the auditor to my scratch directory and ran them again with Node 24.18.0. All four gave the same status codes and counts as the report (`rerun-auth-surface.out.txt`, `rerun-capability-renewal.out.txt`, `rerun-ci-chain.out.txt`, `rerun-webhooks-anon.out.txt`).
- I wrote one new probe, `probe-extra-auth.mjs` (output `probe-extra-auth.out.txt`). It gives three results that the report does not have.
- I installed the published CLI in scratch with pnpm and ran `npm audit signatures` there (`tools-pnpm/`, `npm-audit-signatures.json`, `read-attestation.mjs`).
- GitHub: 12 `gh api` reads, 1 `gh pr list`, and 5 anonymous GET requests to `api.github.com` and `github.com`. All are reads.
- Production (`visonaut.com`): 0 requests.
- Not done: a test with a real GitHub token, a real OIDC token, or a GitHub account that is not a member of the `ariakit` organization. Where a statement depends on GitHub behavior, I cite the GitHub document and say that it is not tested.

## Result

| ID       | Verdict          | Auditor severity | My severity |
| -------- | ---------------- | ---------------- | ----------- |
| TRUST-01 | partly-confirmed | medium           | medium      |
| TRUST-02 | partly-confirmed | medium           | low         |
| TRUST-03 | partly-confirmed | medium           | low         |
| TRUST-04 | judgment         | low              | low         |
| TRUST-05 | confirmed        | low              | low         |
| TRUST-06 | partly-confirmed | low              | low         |
| TRUST-07 | confirmed        | low              | low         |
| TRUST-08 | partly-confirmed | low              | low         |
| TRUST-09 | partly-confirmed | low              | low         |
| TRUST-10 | confirmed        | low              | low         |
| TRUST-11 | confirmed        | low              | low         |

No finding is fully refuted. Three statements in the report are wrong and change the weight of findings:

1. "Sign-in is open to each GitHub account" (TRUST-01, TRUST-02). The GitHub App that does the sign-in is private. GitHub says that only members of the owner organization can authorize a private App. The organization has 10 members.
2. "No document says so" (TRUST-08). The saved issue #1 contract says it, and it records the decision.
3. "It is not determined if a user access token can write check runs" (TRUST-01, open question 1). The GitHub documentation lists the create and update check-run endpoints for GitHub App user access tokens. This makes the token exposure of TRUST-01 more important than the report says.

## TRUST-01 · All Better Auth routes are served, and a session of any GitHub account is sufficient for them

Verdict: partly-confirmed. Severity: medium.

Confirmed (code and rerun):

- `apps/web/src/server.ts:82-87`: all of `/api/auth/*` goes to `auth.handler`. There is no path filter.
- `packages/security/src/auth.ts:21-79`: no `disabledPaths`, no user-create hook. `:36-41`: `encryptOAuthTokens: true, updateAccountOnSignIn: true`.
- Rerun, part A: 31 registered endpoints, 30 with an HTTP path. Part B: with a session cookie only, `POST /get-access-token` gives 200 and the plain text token; `GET /list-sessions` gives raw session tokens; `POST /update-user` changes the user row. Part F: `disabledPaths` gives 404. Part G: the raw `session.token` value as a bearer token gives the same answers.
- `disabledPaths` exists in the installed Better Auth 1.7.5: `packages/security/node_modules/better-auth/dist/api/index.mjs:166-168`.
- No app code reads `user.name`, `user.image`, or `user.email` (search of `apps/web/src`, `packages/service/src`, `packages/security/src`). So `update-user` has no visible effect today.
- The app client calls only `signIn.social` and `signOut` (`apps/web/src/routes/index.tsx:216`, `:232`, `runs.$runId.tsx:175`, `:191`, `pulls.$pullNumber.tsx:124`, `:138`).

Correction 1: sign-in is not open to each GitHub account. The title and Path 1 are too wide.

- `gh api apps/visonaut-ci`: owner `ariakit` (Organization), `client_id` `Iv23lihLxwLZeW7tlh5u`. This is the same value as `GITHUB_CLIENT_ID` in `apps/web/wrangler.jsonc:55`. So Better Auth signs users in with this GitHub App.
- The App is private. Anonymous `GET https://api.github.com/apps/visonaut-ci` gives 404 (the public App `renovate` gives 200). The anonymous page `https://github.com/apps/visonaut-ci` contains the text "Visonaut CI is a private GitHub App."
- GitHub documentation (source file `content/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private.md` in `github/docs`, page https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private): "If you set your GitHub App registration to private, it can only be installed on the account that owns the app. Only members of the organization that owns it can authorize it."
- Measured counts: the `ariakit` organization has 10 members. `ariakit/ariakit` has 10 collaborators, 5 with push permission, 0 outside collaborators.
- Result: the actor of Path 1 is one of about 5 organization members without write permission, or a person who lost access and still has a live session. It is not "any GitHub account".
- Not tested: I have no account outside the organization. The maintainer can test this in one minute: open the sign-in with such an account and look for a GitHub 404 page.
- The protection is a setting at GitHub. No file in the repository records it or checks it (search for "private" near "App" in `docs/`, `README.md`, `packages/security/README.md` finds nothing). If a person makes the App public, sign-in opens to all accounts with no code change. See Missed 1.

Correction 2: the impact is higher than the report says for a maintainer token.

- The report leaves open if a user access token can write check runs. The GitHub page "Endpoints available for GitHub App user access tokens" (https://docs.github.com/en/rest/authentication/endpoints-available-for-github-app-user-access-tokens) lists `POST /repos/{owner}/{repo}/check-runs` and `PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}`.
- GitHub also says: "A user access token only has permissions that both the user and the app have." The App has `checks: write` (measured). A maintainer has write permission.
- So, by the documentation, the sign-in token of a maintainer can create or update a check run of App `5028451`. The required check is `{"context":"Visonaut","integration_id":5028451}`. A person who gets this token can set the required check without a Visonaut decision. Not tested with a real token.
- The contract says: "Keep installation tokens separate from Better Auth user login tokens" (`docs/simplification-audit/contract-issue-1.md:304`). The code paths are separate. The App identity is not: one App gives both the sign-in and `checks: write`. See Missed 2.

Correction 3: the `refresh-token` result depends on a GitHub App setting.

- My probe, with a stub GitHub that sends no refresh token: `POST /refresh-token` gives `400 REFRESH_TOKEN_NOT_FOUND`, and `POST /get-access-token` still gives 200 with the plain text token.
- With a refresh token in the stub answer, `refresh-token` gives 200 with both tokens. This agrees with the report.
- So fact 4 of the report summary ("`refresh-token` returns the GitHub access token and the refresh token") is true only if the App has "Expire user authorization tokens" on. The setting is not visible from here. `get-access-token` is the path that always works.

Correction 4: the first probe of part E did not test what its label says.

- `{"new_user":"POST /get-access-token","status":400, ... "VALIDATION_ERROR"}` comes from a wrong request body (`{ providerId }`). Better Auth 1.7.5 needs `{ accountId }` (`dist/api/routes/account.mjs:309-315`).
- My probe does the full flow for a new user: sign-in, `GET /list-accounts`, then `POST /get-access-token {accountId}`. Result: 200 with the plain text token. The finding holds.

Corrections to the options:

- Block list. `disabledPaths` is an exact string match on the path (`index.mjs:167-168`). A path with a parameter is not matched. Measured: with `"/reset-password"` in the list, `GET /reset-password/some-token?callbackURL=/` still answers 302 (7 D1 round trips). `/callback/:id` has the same property. This is not a risk today, but "the blocked routes answer 404" is not true for this one route. The allow-list in `server.ts` has no such gap.
- Cost. Measured: a disabled path answers 404 with 2 D1 round trips in place of 4. The rate limiter does not run. The schema check of the new instance still runs.
- Allow-list. Correct and feasible. `/get-session` over HTTP is used only by recorded probes (`docs/evidence/e02-final-auth.md:7`). The app reads the session on the server with `auth.api.getSession`, which a path filter does not touch.
- Gate at sign-in. Feasible, with more work than the sketch shows. A custom `getUserInfo` replaces the default profile read, so it must read `/user` and `/user/emails` itself. `createAuth` has no GitHub App client today (`server.ts:85`), so the configuration must pass one in.
- New option that the report does not have: use a separate GitHub App (or OAuth App) with no repository permission for sign-in. Guarantee: a user token cannot write a check run, also if it leaks. Cost: one more App registration, and its own private or public setting.

Exploitability: Path 2 needs a script injection in a maintainer page first (none known). Path 3 needs a database copy and a live session. Path 1 gives an organization member only its own data. The fix is one option line. I keep medium because the exposed token can, by the documentation, write the one check that the product exists to protect.

## TRUST-02 · A signed-in account without repository access causes 2 GitHub App requests on each private request

Verdict: partly-confirmed. Severity: low (the auditor says medium).

Confirmed:

- `packages/security/src/github.ts:226-228` throws `not_maintainer` inside `checkPermission`. `rememberLogin` runs only at `:236` and `:260`, after a positive result. `packages/security/src/authorization.ts:71-82` stores only a positive result.
- Rerun, part E: request 1 makes 3 GitHub requests (token, user, permission). Request 2 makes 2 (`GET /user/999`, `GET /repos/ariakit/ariakit/collaborators/newcomer/permission`). Both answer `403 not_maintainer` with 5 D1 round trips.
- The contract permits only a positive cache (`docs/current-contract.md:186`). A refusal cache needs a decision, as the report says.
- GitHub rate limit text (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api): "GitHub Apps authenticating with an installation access token use the installation's minimum rate limit of 5,000 requests per hour." The organization has 10 members, so the per-user increase (above 20 users) does not apply. The repository count of the installation was not read.
- A rate-limited answer is not `ok`, so `githubRequest` throws `GitHubUnavailableError` (`github.ts:84-87`) and the service answers `503 github_unavailable`.

Correction 1: the actor is not "any GitHub account". See TRUST-01, correction 1. By the GitHub documentation, only members of the `ariakit` organization can sign in. About 5 of the 10 members have no write permission. The other possible actor is a person who lost write permission and still has a session. Each of these is a known person, and each request carries a session that names the GitHub account. This is misuse by an insider, not an attack from the internet.

Correction 2: the sketch does not give the bound that it promises.

```ts
const denied = deniedUntil.get(key); // key includes session.session.id
```

- `key` (`authorization.ts:49-54`) contains the session ID. A person can sign in many times and get many sessions. Each new session causes 2 GitHub requests each 60 seconds. About 42 sessions that are polled one time each minute use 5,000 requests in one hour.
- Key the refusal by GitHub user ID and repository, not by session. The session and account checks before it still run on each request.
- The map needs a size limit, as `privatePermissions` has (`maximumPrivatePermissions = 128`).
- The cache is in isolate memory. Each isolate asks GitHub again. The report says this in its D1 alternative.

Options checked:

- "Remember the login hint also after a refusal": correct. With a hint, `checkPermission(hint)` throws `not_maintainer`, and `:240-246` passes it on. The cost falls from 2 requests to 1.
- Cloudflare rate limit binding: feasible. The binding key is `ratelimits`, the period must be 10 or 60 seconds, and Wrangler 4.36.0 or later is necessary (https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). The repository uses Wrangler 4.136.1. Two limits that the report does not state: the count is "local to the Cloudflare location that your Worker runs in", and the page says the system is "permissive, eventually consistent". The page recommends a user ID as key and does not recommend an address.

Impact: a temporary loss of GitHub calls until the window resets. The actor needs organization membership first and gains nothing. So I lower the severity.

## TRUST-03 · Pull request code selects the comparison settings, and the loosest settings make each change "unchanged"

Verdict: partly-confirmed. The facts are correct. The class ("security") and the severity are too high. Severity: low.

Confirmed:

- `packages/protocol/src/validate.ts:44-64`: `threshold` 0 to 1, `maxDiffPixelRatio` 0 to 1, `maxDiffPixels` any safe integer.
- `packages/cli/src/png-comparison.ts:68-83`: `pixelmatch` with `comparison.threshold`, then the allowance from the same object.
- `apps/web/src/api/local-comparison.ts:529` and `:550-561`: the server takes `capture.comparison` and never reads `threshold`. A search for `threshold` and `maxDiffPixel` in `apps/web/src/api` and `packages/service/src` finds no service limit.
- Rerun, part 3: white reference, black candidate, `{"threshold":1}` gives `outcome unchanged, changedPixels 0`. `{"threshold":0.2,"maxDiffPixels":9007199254740991}` gives `unchanged` with 5,000 changed pixels. The validator accepts both.
- Server path, from code reading (I did not run it): for `threshold: 1` the receipt has `changedPixels 0`, `ratio 0`, `outcome unchanged`. In `validateLocalSubmission`, `allowance` is `Infinity`, `maximum` is 0, and `expectedChanged` is false. No check fails.
- Reach: correct. `apps/web/src/api/workflow-materialize.ts:302-306` keeps the reference image as the representative of an unchanged capture, and `referenceCaptures` (`local-comparison.ts:194-206`) gives that image digest to the next run. So a later run with normal settings compares with the old pixels. The baseline pixels do not change.
- `packages/service/src/local-comparison.ts:174`: `if (result.outcome === "unchanged") continue;`.

Correction 1: the human actor gains no right that the contract does not already give.

- `gh api repos/ariakit/ariakit`: `"pull_request_creation_policy":"collaborators_only"`. A pull request from a fork gets no check (TRUST-08). So each pull request that can get a `Visonaut` check comes from a branch in the repository. A human author of such a branch has write permission. The other authors are Apps with write access (`app/renovate`, `app/ariakito`).
- A person with write permission is a maintainer for Visonaut, and decision D09 says: "Whose approval is enough to pass? | One maintainer, including the PR author" (`docs/simplification-audit/contract-issue-1.md:417`).
- So the author can approve the same change in the review page. The bypass saves a click. What it removes is the record: there is no row, no decision, and no actor.

Correction 2: the settings are one of several ways, and the recommendation closes only this one. The capture job runs pull request code. That code makes the image. It can also write image bytes that are equal to the reference (the report says so in its own table: "Images that are equal to the reference bytes: Yes"). A service limit for the three settings does not change this. The guarantee in the report ("no capture is classified as unchanged with a rule that is looser than the service permits") is true and narrow.

Correction 3: the settings are not fully hidden. `apps/web/src/api/review.ts:523-526` puts "Color threshold …; maximum … pixels; ratio …" in the review data of a capture from `metadata.comparison`. The review reads the full inventory (`docs/current-contract.md:26`). I did not check where the page shows this text for an unchanged item.

Corrections to the options:

- Service limit: feasible in the service only. It fails Submit with a 409. The contract gives the settings to the consumer (`docs/current-contract.md:107`, D07 "This guide changes no threshold"), so this is a contract change. The report says that.
- "Make a looser setting a review event": this is larger than the report says. The server cannot change an outcome. It can only refuse a receipt. The CLI must make the rule, and the reference page (`local-comparison.ts:194-206`) does not send `comparisonDigest` today. So this option needs a protocol field, a CLI release, a new workflow blob B, and a service pin update. Also, a digest that differs is "changed settings", not "looser settings". A stricter setting would also start a review.

What remains: a real gap in visibility. A merged change of the defaults (for example `threshold: 1`) turns the visual check off for all later runs, and nothing in Visonaut shows it. The same result can come from a dependency update. 54 of 94 pull requests since 2026-09-25 are from Renovate (measured again). That is a reason to show the settings, not a privilege problem.

## TRUST-04 · On main, new and removed identities reach the baseline with no human decision and no upper bound

Verdict: judgment. The facts are confirmed. Severity: low.

Confirmed:

- `packages/service/src/local-comparison.ts:592-593` and `:627`: the automatic decision for a row with no reference digest or no candidate digest.
- Contract: `docs/simplification-audit/contract-issue-1.md:203` and `:207`.
- `apps/web/src/api/workflow-materialize.ts:656-657`: `tests: []`, `captures: []`. `apps/web/src/api/workflow-owned.ts:502-505`: the inventory digest is a digest of the manifest's own test list.

Additions:

- The contract also rejects the opposite design in words: "The selected design rejects or defers: … human approval of every new item/variant/removal" (`contract-issue-1.md:473`). So the question "Is unlimited automatic removal on main intended?" has a recorded answer for the rule. An upper limit is a new idea, and it is a contract change.
- "All new identities enter" is a little too wide. `eligibleAutomatic` (`local-comparison.ts:593`) accepts an introduction only if `visonaut_identity_history` has no row for that key in the lineage or on main. A key that returns is a restoration and needs review. The report says this for later pull requests.
- The actor is code that is already on main, or a wrong test selection. This is a reliability risk (loss of coverage in one green run), not an attack path.

## TRUST-05 · The ingest capability renews itself without OIDC, also after Submit

Verdict: confirmed. Severity: low.

Proof:

- `apps/web/src/api/local-comparison.ts:444-448`: a new capability with a new 600 s lifetime in each answer.
- `apps/web/src/api/workflow-owned.ts:250-280`: no `submitted_at` check. `:484`, `:809`, `:1016`, `:1129` have it.
- Rerun: 17 reference calls give 200 and a new capability, 16 of them after Submit, to minute 154. Finalize gives `409 closed_shard`. A capability that was not renewed gives 401 at minute 16.
- `packages/cli/src/engine.ts:416-430`: the CLI renews with `reserve` (new OIDC token) and then `readReference`.
- End of the chain, from code: `stagedRun` needs `retention_state = 'live'`. `apps/web/src/api/workflow-retention.ts:6` and `:114-153` move a staged run out of `live` only after 24 hours. For a main run, `currentReference` (`local-comparison.ts:250-256`) also stops the chain when the baseline revision changes. For a pull request run it does not.

Corrections to the recommendation (the direction is correct):

1. The sketch needs the expiry of the token that came in. `verifyIngestCapability` returns only the parsed claims, not `exp` (`packages/security/src/capabilities.ts:147-152`). It must return `exp` too.
2. The JSON field must change with the token. `local-comparison.ts:448` returns `expiresAt: new Date(Date.now() + 600_000)`. CLI 0.5.4 reads this field to decide when to renew (`packages/cli/src/local-comparison.ts:109-111`, `:162`, `:220`). If the token keeps its old expiry and the field says 10 minutes, the CLI gets a 401 in the middle of a comparison.
3. `issueToken` throws a plain `Error` for `expiresIn < 1` (`capabilities.ts:98-100`). That becomes a 503. Answer 401 when the remaining time is less than 1 second.
4. The reissue itself must stay. Its purpose is to put the `reference` binding in the token (`referenceImage` checks it at `local-comparison.ts:459-468`). Only the lifetime must not grow.

With these four points, the live CLI 0.5.4 keeps working: it renews through `reserve` when less than 45 seconds remain.

Exploitability: the holder needs a capability first. It exists only in the Submit job, which runs fixed code, and the CLI masks it in logs. The gain is the list of baseline keys, digests, and image IDs of a public open-source project. Low.

## TRUST-06 · An OIDC token is accepted again inside its 10 minutes, and one audience serves three endpoints

Verdict: partly-confirmed. Severity: low.

Confirmed:

- `packages/security/src/oidc.ts:129-130`. A search for `jti` finds only this line and `capabilities.ts:122`.
- `apps/web/src/api/workflow-owned.ts:315`, `:342`, `:1224`: one audience. Plan has its own (`apps/web/src/api/pre-run.ts:86`).
- Rerun, part 2: the same token is accepted 3 times. A token with `runner_environment: self-hosted` is accepted. A token is accepted after its job and run ended with success.

Correction: the window for a real GitHub token is probably 5 minutes, not 10.

- The probe case that passes at 9 minutes uses a test token with a lifetime of 15 minutes ("issued 9 minutes ago, lifetime 15 minutes").
- `jwtVerify` checks `exp` and `maxTokenAge`. The smaller one wins.
- The example token in the GitHub documentation has `"exp": 1632493867` and `"iat": 1632493567` (https://docs.github.com/en/actions/concepts/security/openid-connect). The difference is 300 seconds. The page states no lifetime in words, and I did not read a real token. If real tokens follow the example, `maxTokenAge: "10m"` never decides, and the replay window is 5 minutes.

Options checked:

- One audience for each endpoint: feasible, small gain. One job gets all three tokens inside a short time, so a leak of one is probably a leak of all. Cost that the report does not state: a new CLI release, a new workflow blob B and C (both files name the CLI version), a service pin update, and a time in which the service accepts the old and the new audience.
- `runner_environment === "github-hosted"`: the claim exists. GitHub: "The type of runner used by the job. Accepts the following values: `github-hosted` or `self-hosted`." This is the cheapest option, and it needs no client change.

## TRUST-07 · The Submit job installs the CLI by version only, the saved consumer patch shows a digest check that is not live, and the pinned blobs use action tags

Verdict: confirmed. Severity: low.

Proof:

- `gh api repos/ariakit/ariakit/contents/.github/workflows/app.yml --jq .sha` gives `202fd63a37199f5ac4350bd7c4e4bc44ea442216`. `ci.yml` gives `4d34ca17315b19fa90083501eb347ea23d88dda9`. Both are equal to `apps/web/wrangler.jsonc:61`. `git hash-object` of the saved copies gives the same two values.
- Live `app.yml:249-253`: `pnpm --dir "$RUNNER_TEMP/visonaut-tools" add --ignore-scripts --save-exact "visonaut@0.5.4"`. `ci.yml:70`: `npm exec --yes --ignore-scripts --package=visonaut@0.5.4 -- visonaut submit --no-visual`.
- `docs/operations/ariakit-consumer.patch:753-758`: `curl` of the archive and `sha256sum --check --strict`.
- Action references: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`, `actions/download-artifact@v8`, and `pnpm/action-setup@0977fd99…`.
- I found no recorded decision that removes the archive check (search of `docs/` for `sha256sum`, `tarball`, `VISONAUT_PACKAGE_SHA256`).

Corrections and additions:

1. The documents call the patch "prepared" (`docs/simplification-implementation.md:100-106`, `:145`: "The prepared patch is copied locally. No remote branch, workflow pin, required rule, or dependency lockfile is changed."). So it is a plan record, and a careful reader can see that. But `docs/operations/simplification-cutover.md:48` still tells the operator to apply it with a "released package digest", and the contract calls that file the current cutover guide (`docs/current-contract.md:252`). The inconsistency is real.
2. Provenance check, measured. In a directory that pnpm 12.3.0 installed, `npm audit signatures` (npm 12.0.1) works:

   ```text
   audited 1 package in 1s
   1 package has a verified registry signature
   1 package has a verified attestation
   ```

   The guarantee in the report is too strong. The plain command proves that a valid signature and a valid attestation exist. It does not compare the source repository. The attestation does contain it (`read-attestation.mjs`): `"workflow":{"ref":"refs/heads/main","repository":"https://github.com/ariakit/visonaut","path":".github/workflows/release.yml"}`. To get "built by this repository's release workflow", the job must read `npm audit signatures --json --include-attestations` and compare these three values. The consumer's npm version was not checked.

3. Commit pins for actions have a cost that the report does not state. Each new pin changes blob B or C. Renovate updates such pins. Each update then needs a service pin deploy before the `Visonaut` check can pass again.
4. `VISONAUT_PACKAGE_SHA256` is the adapter digest D and not a CLI digest: confirmed (`packages/cli/src/bundle-submit.ts:80`, `packages/cli/src/bundles.ts:49-55`, `docs/operations/adapter-service-pins.md:15`).

## TRUST-08 · A fork pull request never gets the required `Visonaut` check, and no document says so

Verdict: partly-confirmed. The service facts are correct. "No document says so" is wrong. Severity: low.

Confirmed:

- `apps/web/src/api/pre-run-candidates.ts:64-72` returns `null` for a head repository that is not the configured one. `:360-369` has the same check. `packages/security/src/oidc.ts:300`. Rerun: `"pull request head is in a fork"` gives `403 untrusted_run`, check `pull.head_repository_id`.
- GitHub and fork runs: the workflow syntax page says "You can use the `permissions` key to add and remove `read` permissions for forked repositories, but typically you can't grant `write` access." (https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions). `id-token` has only `write` or `none`. This supports the assumption in the report. Not tested.
- A `neutral` conclusion passes a required check: correct.

Corrections:

1. A document says it. The auditor did not search `docs/simplification-audit`. `docs/current-contract.md:7` makes each saved issue #1 requirement binding. `docs/simplification-audit/contract-issue-1.md:53`: "At launch, support `main` and path-selected collaborator PRs targeting `main`. Ariakit currently restricts PRs to collaborators. External-fork capture and Ariakit merge-queue runs are out of scope at launch."
2. The decision exists. `contract-issue-1.md:418`: "D10 | When should external fork pull requests get Visonaut runs? | Maintainer branches first". So "Maintainer decision needed: yes. Is 'no fork support' the intended product rule?" is already answered.
3. GitHub enforces the restriction that the contract names. `gh api repos/ariakit/ariakit` gives `"pull_request_creation_policy":"collaborators_only"`. This explains 0 cross-repository pull requests (measured again: 0 of 94 since 2026-09-25).
4. Who can still meet this case: a collaborator without push permission. 5 of the 10 collaborators have no push permission. Such a person can open a pull request only from a fork, and that pull request gets no check and no text.

What remains: `README.md` and `docs/review-guide.md` do not state the rule in one place that a contributor reads. One sentence there is sufficient.

## TRUST-09 · A signed webhook body is accepted again under a new delivery ID

Verdict: partly-confirmed. The behavior is confirmed. The main recommendation is not safe. Severity: low.

Confirmed:

- `packages/security/src/webhooks.ts:27-29` reads the delivery ID and the event from headers. `:55` verifies the HMAC over the body only. `:84-115`: the delivery ID is the key. `:127-150`: the revocation runs while that delivery row is pending.
- `apps/web/src/api/webhooks.ts:130-132`: `DELETE FROM session` for `installation` `deleted` or `suspend`.
- Rerun, part A: same body with GUID 2 gives 202 and `sessions_of_user_777` goes from 1 to 0. The alias URL with GUID 3 gives the same. `auth_audit` has 3 `github_revoked` rows.
- The earlier evidence covers only a replay with the same GUID (`docs/current-contract.md:244`, O27).

Correction 1: the recommended rule drops a real revocation.

```sql
SELECT 1 FROM github_webhook_delivery
WHERE event = ? AND payload_digest = ? AND delivery_id != ? AND processed_at IS NOT NULL LIMIT 1
```

- The GitHub documentation shows no field other than `action` and `sender` for `github_app_authorization` (https://docs.github.com/en/webhooks/webhook-events-and-payloads#github_app_authorization, read through a page summary tool). There is no time and no event ID in the body.
- So two real revocations by one user have the same body bytes, unless the profile of the user changed between them.
- No code deletes rows of `github_webhook_delivery` (search of `apps/web/src` and `packages`). The first digest stays for all time.
- Result with the rule: the user revokes, signs in again, and revokes again. The second revocation is refused as a replay. The sessions and stored tokens of that user stay. This is worse than the replay.
- The report asks the reader to check this first. The check gives a negative answer for `github_app_authorization`. For `installation` events the body has timestamps, so the rule would work there.
- The query also has no index. The table has indexes only on `(last_attempt_at, received_at)` and on the pull request title (`apps/web/migrations/0023_pending_webhook_index.sql`, `0028_pr_title_index.sql`). Each call would read the full table.

Correction 2: who can hold a signed body. The table does not help an attacker: `payload_json` is the parsed JSON and is set to `'{}'` after processing (`webhooks.ts:147`), and the signature is never stored. A person who can see "Recent deliveries" in the GitHub App settings can see bodies and headers, and that person is an App manager. I found no path for an outside party.

Because GitHub does not sign the delivery ID and puts no time in this body, I see no safe server rule against this replay. "No change" is a reasonable option. The other two alternatives (retire the alias after the cutover, verify the signature before `assertConfiguredProject` at `apps/web/src/api/index.ts:123-129`) are correct and small.

## TRUST-10 · Ingest routes do database work, and one outbound request, before they check the credential

Verdict: confirmed. Severity: low.

Proof:

- Rerun, part B: all five lines of the report repeat with the same status and counts.
- `apps/web/src/api/workflow-owned.ts:1177-1196` reads the staged run and an older attempt before `verifyWorkflowJob` at `:1209`.
- `apps/web/src/api/index.ts:170`: `decodeURIComponent(shardMatch[2])` runs before `declareStaged` checks the capability. The `URIError` reaches `errorResponse` as an unknown error (`:67-83`).
- `packages/security/src/oidc.ts:120-124`: a new key set for each call. `jose` 6.2.12 has `jwksCache` (`jose/dist/types/jwks/remote.d.ts:27`, `:48`).

Corrections:

1. The input `%E0%A4%A` has a broken escape at its end. An edge proxy could refuse such a URL before the Worker. The input `%E0%A4` has only valid escapes and is not valid UTF-8. `decodeURIComponent("%E0%A4")` also throws `URIError: URI malformed` (measured). So the finding does not depend on how Cloudflare handles a broken escape. Not tested on Cloudflare.
2. "Read the bearer token first" does not remove the 401 or 404 signal. A caller can send `Authorization: Bearer x`. Then a run with a staged row goes to the OIDC check and answers `401 invalid_oidc`, and a run without one answers 404. The change only saves database work for a request with no bearer. Submit needs the staged row before the OIDC check, because the tested commit in the request identity comes from that row (`:1219`). The signal has no value (workflow run IDs and check runs of a public repository are public), so this is acceptable.
3. "Trigger an alert on them": no code in the repository reads `operation-failed` lines (`apps/web/src/operations/failure.ts:14-26` is a `console.error`). The effect today is log noise only.
4. "Keep the key set in module memory": use the `jwksCache` object of `jose` and make the key set function in each request. Do not keep the function itself at module level. It holds a pending fetch, and the repository avoids I/O that crosses requests (`packages/security/src/github.ts:106`: "pending I/O stays within the request's client").

## TRUST-11 · There is no procedure to rotate a secret outside database recovery

Verdict: confirmed. Severity: low.

Proof:

- A search for "rotat" in Markdown files (without `docs/simplification-audit`) finds `apps/web/src/operations/README.md:82`, the drill tooling (`apps/web/tooling/backup-v2-recorded/README.md`), and dated restore evidence. No current document has a procedure for a suspected leak.
- `apps/web/wrangler.jsonc:113-121` lists the five secrets.
- One key in each verifier: `packages/security/src/capabilities.ts:117`, `webhooks.ts:45-51`, `auth.ts:25`.

Addition: for one of the five secrets, the library already has a way to keep an old value readable. Better Auth 1.7.5 accepts a `secrets` array with versions (`better-auth/dist/context/create-context.mjs:70`, `dist/context/secret-utils.mjs:13-27`), and `dist/oauth2/utils.mjs` uses it for the stored OAuth tokens. So "makes stored OAuth tokens unreadable" is true for the present option (`secret`) and can be avoided. I did not test if signed session cookies stay valid after such a change. The new section in the operations document can name this option.

## Missed

1. **A GitHub setting is the only limit on who can sign in, and nothing records it.** The App `visonaut-ci` is private, so GitHub lets only `ariakit` organization members authorize it (GitHub documentation; not tested with an outside account). The code has no limit of its own. No document names this setting as a requirement. A change to "public" opens sign-in, the Better Auth routes of TRUST-01, and the cost path of TRUST-02 to all GitHub accounts.
2. **The sign-in App is the App that has `checks: write`.** The GitHub documentation lists the create and update check-run endpoints for GitHub App user access tokens. So the sign-in token of a maintainer can, by the documentation, set the required `Visonaut` check. A maintainer can read this token from `POST /api/auth/get-access-token` today. A separate sign-in App with no repository permission removes this, also if a token leaks. Not tested with a real token.
3. **Two recorded decisions and one GitHub setting change the weight of TRUST-03 and TRUST-08, and the report does not cite them.** D09 ("One maintainer, including the PR author"), D10 ("Maintainer branches first"), and `pull_request_creation_policy: collaborators_only` on `ariakit/ariakit`.
4. **The digest rule of TRUST-09 would ignore a second real revocation.** The `github_app_authorization` body has no time and no ID, and delivery rows are never deleted. See TRUST-09.
5. **A refusal cache keyed by session does not limit an actor with many sessions.** See TRUST-02, correction 2.
6. **`disabledPaths` matches exact strings.** `GET /reset-password/:token` stays active with `"/reset-password"` in the list (measured, 302). An allow-list in `server.ts` does not have this gap.
7. **The window of TRUST-06 was measured with a 15-minute test token.** The documented GitHub example token lives 300 seconds. The 10-minute `maxTokenAge` is then not the active limit.
8. **`setup-node` and other actions by tag run in the job that has `id-token: write`.** The fixed setup action at `c87988ef` calls `actions/setup-node@v7` with no cache input. If a later release of a tag turns a cache on by default, the Submit job would restore data that jobs with pull request code can write. I did not verify the cache behavior of these action versions. This is one more reason for the tag item in TRUST-07.
