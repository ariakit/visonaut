# Trust boundaries: from a fork pull request to the baseline, the auth routes, and the public endpoints

Lane: gap-trust-boundary. Commit `f83fef6`. Read-only. Paths are relative to the worktree root. "RT" means one D1 round trip. Local probes use the repository source with in-memory SQLite (D1-shaped wrapper) and stub GitHub. Scripts and raw outputs are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-trust-boundary/`.

The five most important facts:

1. A fork pull request cannot reach the service at all. Three separate checks refuse a head repository that is not `ariakit/ariakit`. The result is that a fork pull request never gets the required `Visonaut` check (TRUST-08).
2. The code that capture jobs run (a same-repository pull request, or a dependency that such a pull request updates) writes the comparison settings. With `threshold: 1` the trusted CLI and the service call each changed image "unchanged", and the check passes with no review item (TRUST-03). This changes the pull request result. It does not put new pixels in the baseline.
3. The only way from capture output to the main baseline without a human decision is the automatic acceptance of new and removed identities on a main run. This is a contract rule (TRUST-04).
4. Sign-in is open to each GitHub account, and all 30 Better Auth HTTP routes are served. With only a session, `refresh-token` returns the GitHub access token and the refresh token in plain text (TRUST-01). A signed-in account without repository access causes 2 GitHub App API requests on each private request, with no limit (TRUST-02).
5. The 10-minute ingest capability can renew itself through the reference route with no OIDC token, also after Submit (TRUST-05).

## How it works (map)

### What the earlier dated evidence proves, and what changed after it

| Evidence                                                                                                              | Still true at `f83fef6`                                                                                            | Changed after it                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/evidence/deployed-private-boundaries.json` (2026-09-22): anonymous requests get `401 sign_in_required` or `404` | Yes. 7 production GET requests on 2026-10-05 gave the same shapes (see Measurements M6).                           | The paths `/api/exports/*`, `/api/runs/:id/decisions`, and `/api/runs/:id/review-sessions` of that file no longer exist as routes. They still answer 401 because all unknown paths reach the session boundary first.                                                                                                                                     |
| `docs/evidence/deployed-capability-boundaries.md`: a capability cannot read status or review data, and cannot approve | Yes. `apps/web/src/api/index.ts:190-205`: "A signed upload token is never accepted by this live-session boundary." | Local comparison added `POST /v1/runs/:id/reference`. A capability can now read the complete baseline inventory and gets a new capability in each answer (TRUST-05). The probe of that date had no such route.                                                                                                                                           |
| `docs/evidence/e02-quarantine-boundary.md`: public image route reads only `IMAGES`, never `QUARANTINE`                | Yes. `apps/web/src/api/images.ts:24-39`.                                                                           | Uploads no longer go to the quarantine bucket. `apps/web/src/api/workflow-owned.ts:1103` writes the bytes to `IMAGES` at `runs/<run>/images/<uuid>`. They are not public until materialization adds a `visonaut_images` row (`validated = 1`). The service does not decode them (CMP-01). `quarantine_key` is now only the identity of an upload ticket. |
| `docs/evidence/deployed-session-probes.json`, `e02-final-auth.md`: session, renewal, expiry, revocation               | Yes.                                                                                                               | The auth verifier measured three more facts (`audit/auth/verification.md:383-392`). This lane adds: `refresh-token` and `account-info` (TRUST-01), the rows of one sign-in, and the GitHub cost of a denied user (TRUST-02).                                                                                                                             |
| `docs/evidence/authentication.md`: untrusted workflow job gets `403 untrusted_run`                                    | Yes. Measured again locally for a Plan job, a capture job, an unknown job, and another reusable workflow (M3).     | The trust configuration is now two Git blobs (`ci.yml` blob C, `app.yml` blob B) plus one executor digest D (`apps/web/wrangler.jsonc:61-62`).                                                                                                                                                                                                           |

### Actors and assets

Cell text: "blocked by" names the check that stops the actor. "possible" names the path. "by design" means the contract gives this actor the asset.

| Actor                                                                                                               | Private review data                                                                                                                                                             | Decision to approve                                                                                                                                            | Main baseline                                                                                                                                                                             | `Visonaut` check result                                                                                                                                                                    | Stored bytes and rows (cost)                                                                                                                                                                   | GitHub App token                                                            | GitHub user token                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous internet user                                                                                             | blocked by `api/index.ts:194-205` (401, measured). Image bytes are public by ID by contract (`api/images.ts:24-36`). IDs cannot be listed.                                      | blocked (401)                                                                                                                                                  | blocked: no route                                                                                                                                                                         | blocked                                                                                                                                                                                    | possible: 1 to 5 RT for each request, one `verification` row and one `rateLimit` row for each `POST /api/auth/sign-in/social`, one outbound JWKS request for each forged bearer (TRUST-10)     | blocked: 0 GitHub API requests measured                                     | blocked                                                                                                                                                                               |
| Signed-in GitHub user without write access                                                                          | blocked by `packages/security/src/github.ts:226-228` (403 `not_maintainer`, measured)                                                                                           | blocked, same check                                                                                                                                            | blocked                                                                                                                                                                                   | possible indirectly: can use up the App rate budget, then the check cannot be created or updated (TRUST-02)                                                                                | possible: `user`, `account`, `session`, `auth_audit` rows for each sign-in, `update-user` writes, 5 RT for each request (TRUST-01)                                                             | cannot read it. Can spend 2 of its API requests for each request (TRUST-02) | own token only. `get-access-token` for an account of another user answers `ACCOUNT_NOT_FOUND` (measured)                                                                              |
| Maintainer                                                                                                          | by design                                                                                                                                                                       | by design                                                                                                                                                      | by design, only through approvals on a main run                                                                                                                                           | by design                                                                                                                                                                                  | by design                                                                                                                                                                                      | no route returns it                                                         | own token                                                                                                                                                                             |
| Author of a fork pull request                                                                                       | blocked: `packages/security/src/oidc.ts:300` (`pull.head_repository_id`, measured), `api/pre-run-candidates.ts:64-72`, `:360-369`                                               | blocked                                                                                                                                                        | blocked                                                                                                                                                                                   | blocked. The check is never created, so the pull request cannot pass the rule (TRUST-08)                                                                                                   | not determined: GitHub is assumed to give no OIDC token to a fork run, so the CLI stops before a request                                                                                       | blocked                                                                     | blocked                                                                                                                                                                               |
| Code in a capture job of a same-repository pull request (author code, or a dependency from a Renovate pull request) | blocked: capture jobs have `permissions: contents: read` and no token (consumer `app.yml:157-158`)                                                                              | blocked. But the code can remove the need for a decision (TRUST-03)                                                                                            | possible only after the code is merged and runs on main: new identities and removals are accepted automatically (TRUST-04). Changed pixels of an existing identity need a human decision. | possible: check passes with zero review items (TRUST-03)                                                                                                                                   | bounded: 40,000 captures, 2 MiB for each image, 512 MiB shard, 2 GiB run, 8 GiB staged (`apps/web/src/runtime-defaults.ts:8-14`), CLI zip limits (`packages/cli/src/artifact-archive.ts:7-11`) | blocked                                                                     | blocked                                                                                                                                                                               |
| Another job or workflow in `ariakit/ariakit` with an OIDC token                                                     | blocked                                                                                                                                                                         | blocked                                                                                                                                                        | blocked                                                                                                                                                                                   | blocked for Submit by `oidc.ts:186-188` (job workflow) and `oidc.ts:259` (`rest.job_name`), measured. The pinned `Plan` job can only report `visualRequired: false` (`api/pre-run.ts:55`). | 2 to 5 RT and up to 5 GitHub requests before the refusal (M3)                                                                                                                                  | blocked                                                                     | blocked                                                                                                                                                                               |
| Holder of a leaked capability                                                                                       | possible: complete baseline inventory (item keys, variant keys, digests, image IDs) through `POST /v1/runs/:id/reference`, renewable (TRUST-05). No decisions, no review model. | blocked by `api/index.ts:190-205`                                                                                                                              | blocked: Submit needs OIDC (`api/workflow-owned.ts:1209-1225`)                                                                                                                            | possible for that one attempt only: a first manifest from the holder makes the real job fail with `manifest_conflict` (`workflow-owned.ts:645-659`, from code, not probed)                 | possible before Submit, inside the capability limits (`maximumBytes`, `maximumImages`)                                                                                                         | blocked                                                                     | blocked                                                                                                                                                                               |
| Script in the page of a signed-in maintainer                                                                        | possible (same-origin requests)                                                                                                                                                 | possible (same-origin `POST`)                                                                                                                                  | through approvals                                                                                                                                                                         | through approvals                                                                                                                                                                          | possible                                                                                                                                                                                       | blocked                                                                     | possible: `POST /api/auth/get-access-token` and `/refresh-token` return the tokens in plain text (TRUST-01). The raw session token is in `get-session` and `list-sessions` (AUTH-09). |
| Person with a copy of the D1 database                                                                               | all private rows are in the copy                                                                                                                                                | possible while a copied session is live: `Authorization: Bearer <session.token>` (AUTH-09) plus a self-made `Origin` header (`audit/auth/verification.md:392`) | through approvals                                                                                                                                                                         | through approvals                                                                                                                                                                          | not applicable                                                                                                                                                                                 | blocked: not stored in D1                                                   | possible while a copied session is live: bearer session token, then `get-access-token` (measured, M1 part G). The stored ciphertext alone needs `BETTER_AUTH_SECRET`.                 |

### The CI chain for one pull request run, with each claim and each check

Trust configuration (`apps/web/wrangler.jsonc:61-62`): caller workflow `.github/workflows/ci.yml` with Git blob C `4d34ca17…`, job workflow `.github/workflows/app.yml` with Git blob B `202fd63a…`, Submit job name `App / Visual Submit`, capture job name `App / Visual Capture ({shard})`, executor digest D `be4439ac…`. I fetched both live consumer files with `gh api`. Their blob hashes are equal to B and C.

1. **Pull request webhook.** HMAC-SHA256 over the raw body (`packages/security/src/webhooks.ts:45-57`), repository ID (`:64-75`), installation and repository scope (`apps/web/src/api/webhooks.ts:45-61`). Then `candidateForWebhook` requires an open pull request to `main` with head repository equal to base repository (`api/pre-run-candidates.ts:64-72`) and creates the pending `Visonaut` check.
2. **Plan job** (`ci.yml`, blob C). The job checks out the event commit to `.visonaut-event` and a fixed planner commit `c87988ef` to `.visonaut-planner`. It runs only the fixed planner. If the planner says `app=false`, the job runs `npm exec --package=visonaut@0.5.4 -- visonaut submit --no-visual`. The service accepts only `visualRequired: false` (`api/pre-run.ts:55`), with audience `<origin>/plan-report`, job name `Plan` (`pre-run.ts:85-97`), and a successful step named `Plan CI` (`api/pre-run-plan.ts:48-80`).
3. **Capture jobs** (`app.yml` `visual`, 2 shards). They run pull request code with `contents: read` and no OIDC permission. Each uploads `manifest.json`, `environment.json`, and `images/` as artifact `visonaut-capture-<run>-<attempt>-<shard>` for one day. All content of this artifact is under the control of pull request code.
4. **Submit job** (`app.yml` `submit`, `id-token: write`). It checks out the fixed commit `c87988ef`, installs `visonaut@0.5.4` with scripts disabled, and runs `visonaut submit --shard linux --shard safari`. It runs no pull request code.
   1. **Begin.** `POST /v1/runs/<run_id>/begin` with an OIDC token, audience `<origin>/submit` (`api/workflow-owned.ts:293-325`).
   2. **OIDC checks** (`packages/security/src/oidc.ts`), in order:

      | Claim or fact                                        | Check                                                                                                                                               | Line             |
      | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
      | Signature, `iss`, `aud`, `alg` RS256                 | GitHub key set, exact issuer and audience                                                                                                           | 120-131          |
      | `sub`, `exp`, `iat`, `nbf`, `jti`                    | must be present. Token age at most 10 minutes.                                                                                                      | 129-130          |
      | `iat`                                                | later than the database restore cutoff                                                                                                              | 140-149          |
      | `repository_id`, `repository`, `repository_owner_id` | equal to the configuration                                                                                                                          | 150-156          |
      | `workflow_sha`                                       | equal to `sha`. `ci.yml` at that commit has blob C.                                                                                                 | 157-172          |
      | `job_workflow_sha`, `job_workflow_ref`               | equal to `sha`, and the ref starts with `ariakit/ariakit/.github/workflows/app.yml@`. `app.yml` at that commit has blob B.                          | 182-194          |
      | `run_id`, `run_attempt`, `sha`                       | equal to the request                                                                                                                                | 210-212          |
      | `event_name`                                         | `push`, `pull_request`, or `merge_group`                                                                                                            | 214-222          |
      | `workflow_ref`                                       | `<repo>/<ci.yml>@<ref>`                                                                                                                             | 223-227          |
      | `sub`                                                | `repo:<repo>:pull_request` or `repo:<repo>:ref:<ref>` (also the immutable-ID form)                                                                  | 228-234          |
      | REST: run                                            | this attempt is the current attempt                                                                                                                 | 240-241          |
      | REST: attempt                                        | run ID, attempt, repository ID, owner ID, event, workflow path                                                                                      | 242-256          |
      | `check_run_id`                                       | names a job of this attempt. The job name is `App / Visual Submit`.                                                                                 | 257-261, 365-387 |
      | REST: run and job state                              | active or successful                                                                                                                                | 264-281          |
      | Pull request                                         | `ref` is `refs/pull/<n>/merge`, open, base `main`, head and base repository equal to the configured repository                                      | 290-301          |
      | Merge commit                                         | merge ref equals `merge_commit_sha`. `head_ref` claim equals the head branch. The tested commit has 2 parents: a main ancestor and the head commit. | 302-335          |

      **Not tied:** `environment`, `runner_environment`, `actor`. A token with `runner_environment: self-hosted` is accepted (measured). **`jti` is required but not stored**, so one token is accepted more than one time inside its 10 minutes (measured 3 times, TRUST-06). **One audience** serves Begin, Reserve, and Submit.

   3. **Artifact download** (`packages/cli/src/github-artifacts.ts`). The run is active and on this attempt (`:135-144`). There is exactly one successful job for each shard (`:150-159`). A carried job has exactly one original execution (`:175-213`). The artifact has the exact name, is unique, not expired, and at most 1 GiB (`:214-232`). The token goes only to `api.github.com`; the redirect target gets no token and must be HTTPS (`packages/cli/src/artifact-archive.ts:183-199`).
   4. **Zip parser** (`artifact-archive.ts:28-171`). Limits: 1 GiB archive, 5,000 entries, 4 MiB directory, 20 MiB image, 8 MiB metadata (`:7-11`). Entry names: only `images/<64 hex>.png`, `manifest.json`, `environment.json`, `receipt.json` (`:101-107`). No encrypted or data-descriptor entries, only stored or deflate (`:92-98`). No overlapping ranges (`:139-143`). Bounded inflate and CRC-32 (`:155-162`). Files are created with `O_EXCL | O_NOFOLLOW` (`:165-169`).
   5. **Manifest and images.** `parseManifest` and profile digests (`packages/cli/src/files.ts:43-58`). Each image: safe relative path, no symbolic link, exact size, SHA-256 (`files.ts:64-110`). Run ID, source attempt, tested commit, shard (`github-artifacts.ts:245-252`). A capture artifact cannot bring its own comparison result (`packages/cli/src/local-comparison.ts:33-35`). Each PNG is validated and decoded (`:44`, `packages/cli/src/png-comparison.ts:10-40`).
   6. **Not checked, because it cannot be:** which adapter code made the manifest. `executorDigest` is a constant from the workflow environment that the capture job writes itself (`docs/operations/ariakit-consumer.patch:824-843`), and the CLI compares it with the same constant (`packages/cli/src/bundles.ts:49-55`). It is a version fence, not a proof. Item keys, variant keys, test list, profiles, images, and `comparison` settings are all candidate data.
   7. **Reserve.** `POST /v1/runs` with OIDC returns a capability for 10 minutes (`workflow-owned.ts:372-394`). It binds run, repository, workflow run, attempt, tested commit, workflow source digest, shard `combined`, job ID, byte limit, image limit, and mode.
   8. **Reference.** `POST /v1/runs/:id/reference` selects an accepted ancestor snapshot, pins it, stores the binding in the staged run (first write wins, `api/local-comparison.ts:343-405`), and returns the capture list and a new capability that also carries the binding (`:444-447`).
   9. **Compare.** Equal digest means unchanged with no fetch (`packages/cli/src/local-comparison.ts:260-274`). Else pixelmatch with the `comparison` object of the capture (`png-comparison.ts:68-83`).
   10. **Declare.** `POST /v1/runs/:id/shards/combined`. Capability against the stored run and job (`workflow-owned.ts:250-275`). Manifest provenance (`:491-521`). Receipt (`validateLocalSubmission`, `api/local-comparison.ts:488-602`): binding, complete identity set, digests, size change, metrics against the manifest's own settings, masks, removals. Limits (`workflow-owned.ts:559-570`). The manifest is immutable after the first declaration (`:645-659`).
   11. **Reuse and upload.** See the token table below. An upload must have the exact declared size and SHA-256 (`workflow-owned.ts:1038-1044`). No decode.
   12. **Finalize and Submit.** Finalize repeats the receipt check (`:1140-1145`). Submit needs a new OIDC verification and records the Submit job (`:1173-1289`).
5. **Materialization** (queue). Current pins equal the stored pins (`api/workflow-reconcile.ts:207-222`). The Submit job is the unique, final, successful job (`:246-257`). Each capture job is successful, and each source in the manifest names the job, attempt, and artifact that GitHub still reports (`:285-341`). Only the Submit job staged data (`:343-352`). GitHub holds exactly one receipt artifact whose name contains the manifest digest (`api/receipts.ts:18-74`). Then lineage, ancestry, image checksum, registration, seal, comparison, and automatic decisions.
6. **Review and merge.** A maintainer decides. After the merge, the push run on main repeats steps 2 to 5 with the current baseline as the only reference (`packages/service/src/local-comparison.ts:460-470`). Promotion is for main runs only (`packages/service/src/baseline-promotion.ts:114`, `:380`).

**What a forged capture artifact can do**

| Forgery by capture-job code                              | Passes the CLI and the service                    | Reach                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Loose `comparison` (for example `threshold: 1`)          | Yes (measured, TRUST-03)                          | The pull request check passes with no review item. No upload, no comparison row. The baseline keeps the old bytes.                   |
| Images that are equal to the reference bytes             | Yes: equal digest is "unchanged"                  | Same as above.                                                                                                                       |
| New item or variant keys with any valid PNG              | Yes                                               | Pull request: accepted automatically in that lineage. Main, after merge: accepted automatically and promoted (TRUST-04).             |
| Omitted identities                                       | Yes, if all capture jobs succeed                  | Pull request and main: removal accepted automatically (TRUST-04).                                                                    |
| Changed pixels for an existing identity, honest settings | Yes                                               | Needs a human decision. An approval is reused only for the exact tuple (`packages/service/src/local-comparison.ts:591`, `:612-624`). |
| Own `localComparison` receipt in the artifact            | No (`packages/cli/src/local-comparison.ts:33-35`) | none                                                                                                                                 |
| Path traversal, zip bomb, symbolic link, wrong digest    | No (step 4.4 and 4.5)                             | none                                                                                                                                 |
| Bytes that are not a PNG                                 | No: the CLI decodes each capture                  | none                                                                                                                                 |

**The three token kinds of `CAPABILITY_SECRET`** (`packages/security/src/capabilities.ts`). Measured in M3 part 1: no kind is accepted as another kind.

| Kind              | Audience                | Separation                          | Binds                                                                                                                                                                                                             | Lifetime                          |
| ----------------- | ----------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Ingest capability | `visonaut:ingest:<env>` | `aud` and `kind` claim (`:117-127`) | run ID, repository, workflow run, attempt, tested commit, source digest, shard, job ID, byte and image limits, mode, reference. Each use is checked against the stored run and job (`workflow-owned.ts:250-275`). | 600 s. Can be renewed (TRUST-05). |
| Upload ticket     | `visonaut:upload:<env>` | same                                | run, shard, object key, image digest, media type, exact byte count. Needs the capability also (`:181-199`). The row must match (`workflow-owned.ts:1019-1032`).                                                   | 600 s                             |
| Reuse challenge   | `visonaut:reuse:<env>`  | same                                | run, job, shard, manifest digest, 32-byte nonce (`:201-248`)                                                                                                                                                      | 600 s                             |

**Reuse proof** (`workflow-owned.ts:807-1003`). The caller sends `HMAC-SHA256(nonce, bytes)` for a digest that its own manifest declares. The service finds the same digest and size in an earlier submitted run of the same repository (`:880-908`), reads the bytes, checks the SHA-256, checks the HMAC (`:941-948`), and copies the bytes to a new key of the target run (`:969-972`). The answer contains digests only. A caller cannot get bytes that it does not hold, because the HMAC needs the bytes and the nonce is new for each declaration. It cannot bind an object of another run: the copy is a new object, and the source must have the same repository ID. The only signal is that a wrong proof for an existing source gives 422 and a missing source gives no entry. This shows whether a digest exists in an earlier run, to a holder of a capability.

**Reruns and attempts.** A token of an older attempt is refused when a newer attempt exists (`oidc.ts:240-241`, measured `rest.current_attempt`). One staged run exists for each repository, run, and attempt (`apps/web/migrations/0019_staged_workflows.sql:28`). Materialization reads the current attempt from GitHub at the start and again before the seal (`api/jobs.ts:44-53`, `api/workflow-reconcile.ts:234`, `api/workflow-materialize.ts:769-772`) and stops if the run is no longer active (`:758-760`). The sweep skips an attempt when a newer sealed attempt exists (`:871`). From code reading, an older attempt cannot replace a newer result of the same workflow run. The order between two different workflow runs of one pull request head was not examined here.

### Auth route surface (Better Auth 1.7.5, measured)

`apps/web/src/server.ts:82-87` passes each `/api/auth/*` request to `auth.handler`. The instance registers 31 endpoints. 30 have an HTTP path (this count includes `/ok` and `/error`); `setPassword` is server-only. The app client calls only `signIn.social` and `signOut` (`apps/web/src/routes/index.tsx:216`, `:232`, `runs.$runId.tsx:175`, `:191`, `pulls.$pullNumber.tsx:124`, `:138`), and GitHub calls the callback. `get-session` is used by recorded operational probes (`docs/evidence/e02-final-auth.md:9`).

"Session" means a valid session cookie of any GitHub account. No route asks for repository access.

| Method and path                                                                                                                                                                                              | Without session                                                           | With session                                                    | Reads or writes                                                                            | App needs it |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------ |
| `POST /sign-in/social`                                                                                                                                                                                       | 200, GitHub URL                                                           | 200                                                             | writes `verification` (state) and `rateLimit`                                              | yes          |
| `GET /callback/github`                                                                                                                                                                                       | 302 to `/api/auth/error?error=state_mismatch` for an unknown state        | same                                                            | consumes `verification`; a good callback writes `user`, `account`, `session`, `auth_audit` | yes          |
| `POST /sign-out`                                                                                                                                                                                             | 200                                                                       | 200                                                             | deletes the session, writes `auth_audit`                                                   | yes          |
| `GET /get-session`                                                                                                                                                                                           | 200 `null`                                                                | 200 with the raw session token                                  | reads `session`, `user`                                                                    | probes only  |
| `GET /ok`, `GET /error`                                                                                                                                                                                      | 200                                                                       | 200                                                             | `/error` shows an HTML page with the escaped `error` and `error_description` values        | no           |
| `POST /get-access-token`                                                                                                                                                                                     | 401                                                                       | 200 `{"accessToken": "<plain text>"}`                           | decrypts `account.accessToken`                                                             | no           |
| `POST /refresh-token`                                                                                                                                                                                        | 401                                                                       | 200 with new access token **and refresh token** in plain text   | calls GitHub with the client secret, updates `account`                                     | no           |
| `GET /account-info`                                                                                                                                                                                          | 401                                                                       | 200 with the GitHub profile and email addresses                 | calls GitHub `/user` and `/user/emails` with the stored token                              | no           |
| `GET /list-accounts`                                                                                                                                                                                         | 401                                                                       | 200 with the account row ID                                     | reads `account`                                                                            | no           |
| `GET /list-sessions`                                                                                                                                                                                         | 401                                                                       | 200 with raw session tokens                                     | reads `session`                                                                            | no           |
| `POST /revoke-session`, `/revoke-sessions`, `/revoke-other-sessions`                                                                                                                                         | 401                                                                       | 200. Own sessions only: a token of another user changes no row. | deletes `session`, writes `auth_audit`                                                     | no           |
| `POST /update-user`                                                                                                                                                                                          | 401                                                                       | 200                                                             | writes `user.name` and `user.image` (any URL)                                              | no           |
| `POST /update-session`                                                                                                                                                                                       | 401                                                                       | 400 "No fields to update"                                       | none                                                                                       | no           |
| `POST /link-social`                                                                                                                                                                                          | 401                                                                       | 200, GitHub URL                                                 | writes `verification`                                                                      | no           |
| `POST /unlink-account`                                                                                                                                                                                       | 401                                                                       | 400 "You can't unlink your last account"                        | none                                                                                       | no           |
| `POST /change-email`, `/delete-user`, `GET /delete-user/callback`                                                                                                                                            | 401 or 404                                                                | 400 `CHANGE_EMAIL_DISABLED`, 404                                | none                                                                                       | no           |
| `POST /sign-up/email`, `/sign-in/email`, `/request-password-reset`, `/reset-password`, `/send-verification-email`, `/change-password`, `/verify-password`, `GET /verify-email`, `GET /reset-password/:token` | 400 or 401 (feature disabled), one 302 to `<origin>/?error=INVALID_TOKEN` | same                                                            | none                                                                                       | no           |

Each auth request costs 4 RT and one `rateLimit` write before the route runs (2 for the schema check, AUTH-01; 2 for the limiter, AUTH-14).

**Origin checks of Better Auth for a cookie `POST`** (measured): the app origin passes; `https://evil.example` gives 403; no `Origin` with a cookie gives 403 `MISSING_OR_NULL_ORIGIN`; a foreign `Referer` gives 403. `Sec-Fetch-Site` is not read. A bearer token with any `Origin` passes, because the bearer path has no cookie.

**Redirect checks** (measured, 24 cases): `callbackURL`, `errorCallbackURL`, and `newUserCallbackURL` accept a relative path and the app origin. They refuse `https://evil.example/x`, `//evil.example/x`, `/\evil.example/x`, `https://visonaut.example.evil.example/x`, `https://visonaut.example@evil.example/x`, and `javascript:alert(1)` with 403. No open redirect was found.

**Rows of one sign-in of an account without repository access** (measured): `user` +1, `account` +1 (encrypted access token and refresh token), `session` +1, `auth_audit` +1 (`sign_in`), `verification` -1, `rateLimit` +1. 15 RT for the callback. 3 GitHub OAuth requests. A callback without the state cookie (another browser) writes nothing and issues no session.

### Strings from a pull request: where they go

| Sink                     | Result                                                                                                                                                                                                                                                                                                                                                                                                                                            | Evidence                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| SQL text                 | No value from a request, a manifest, or a webhook is put in SQL text. 183 interpolations in 163 source files are 80 distinct expressions: SQL fragments made in code, table aliases, table names from fixed lists, and column names that `PRAGMA table_info` returns and a pattern checks (`apps/web/src/operations/history.ts:437-439`). Values use `?` or one JSON parameter with `json_each`.                                                  | `scan-sql-interpolation.out.txt` (M4)                                        |
| R2 keys                  | No item key, variant key, or title is part of a key. Keys use server-made UUIDs, GitHub job IDs, and checked 64-hex digests: `runs/<uuid>/images/<uuid>`, `quarantine/staged/<uuid>/<job>/<digest>` (`apps/web/src/api/workflow-evidence.ts:77-87`). Capture IDs are `<run>:<digest of [itemKey, variantKey]>` (`api/workflow-materialize.ts:311`). Prefix deletion checks the prefix shape first (`apps/web/src/operations/retention.ts:17-44`). | `rg` in M4                                                                   |
| GitHub API paths         | Interpolated values are the configured repository (pattern at `packages/security/src/github.ts:110`), integers, 40-hex commits, numeric IDs from `parseManifest` (`packages/protocol/src/validate.ts:364-369`), and refs that GitHub signs. The client refuses a path that leaves `api.github.com` (`github.ts:57-63`). Branch names are compared, not interpolated (`oidc.ts:307`).                                                              | `rg` in M4                                                                   |
| Log lines                | Fixed event names, codes, numeric IDs. `oidc_rejected` logs a fixed check name (`oidc.ts:62`).                                                                                                                                                                                                                                                                                                                                                    | code                                                                         |
| HTML                     | React text nodes. One `dangerouslySetInnerHTML` with a constant script (`apps/web/src/routes/__root.tsx:25`). URLs use `encodeURIComponent`.                                                                                                                                                                                                                                                                                                      | `rg` in M4                                                                   |
| Check-run text on GitHub | Fixed text and a URL that the server builds. No title or key.                                                                                                                                                                                                                                                                                                                                                                                     | `packages/security/src/checks.ts:46-52`, `api/pre-run-attempts.ts:1012-1027` |

`validateKey` (`packages/protocol/src/validate.ts:131-139`) accepts only `[a-zA-Z0-9][a-zA-Z0-9._/-]*`, at most 256 characters, with no empty, `.`, or `..` segment. Measured with 20 inputs (M3 part 4): quotes, spaces, `%`, `<`, newline, U+202E, and non-ASCII letters are refused.

One note, not a finding: display strings (`capture.name`, `titlePath`, `test.file`) pass `string()` (`validate.ts:81-92`), which refuses only C0 control characters and DEL. Bidirectional control characters are accepted there and would show in the review list. React escapes them, so this is a display risk only.

### Webhooks

- Signature: `crypto.subtle.verify("HMAC", …)` over the raw body (`packages/security/src/webhooks.ts:45-57`). This comparison is constant-time in the platform. Header shapes are checked first (`:27-43`).
- Body limit: 1 MiB (`:44`). Measured: 1 MiB + 1 byte gives 413.
- Replay: the delivery GUID is the primary key (`:84-115`). The same GUID is stored one time, and revocation runs only while that delivery is pending (`:127-150`). The GUID and the event name are headers, and GitHub does not sign headers. So the same signed body with a new GUID is a new delivery (measured, TRUST-09).
- Two URLs: `/v1/webhooks` and `/webhooks/github` reach the same receiver (`apps/web/src/api/index.ts:127-129`). The alias is kept on purpose (`docs/operations/simplification-cutover.md:47`). `apps/web/src/operations/github-deliveries.ts:170` requires the App to use `/v1/webhooks`.
- Scope: repository ID for repository events (`webhooks.ts:64-75`), installation ID, and App ID and owner ID for installation events (`apps/web/src/api/webhooks.ts:34-106`). Measured: another repository gives 403 `wrong_repository`; another installation gives 403 `webhook_installation`.
- Order: one D1 read (`assertConfiguredProject`, `api/index.ts:123-126`) runs before the signature check.

### Anonymous surface

| Path                                                    | Answer without a credential                                       | Cost (measured locally)                                                  | What a caller learns                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                           | 200, no origin rule (`apps/web/src/server.ts:60-71`)              | none                                                                     | `service`, `status`, `launchEnabled`, `environment`, `fixtureMode`                                                            |
| Pages (`/`, `/runs/:id`, `/pulls/:n?check=`)            | 200 HTML shell, no data (32 KB in production)                     | render only                                                              | nothing private                                                                                                               |
| `GET /images/:id`                                       | 200 bytes or 404                                                  | 1 RT, and 1 R2 read for a hit                                            | if an image ID exists (public by contract)                                                                                    |
| `/api/*` and `GET /v1/runs/:id`                         | 401 `sign_in_required`                                            | 2 RT for `GET /api/runs`, 3 RT for others, 76 to 77 statements (AUTH-07) | nothing. A known and an unknown run ID give the same 401 and the same cost. A 404 or 409 comes only after sign-in and access. |
| `GET /api/me`                                           | 401                                                               | not measured here                                                        | nothing                                                                                                                       |
| `/api/auth/*`                                           | see the table above                                               | 4 RT and one `rateLimit` row for each request                            | nothing private                                                                                                               |
| `POST /v1/webhooks`, `/webhooks/github`                 | 401 `invalid_webhook`                                             | 1 RT                                                                     | nothing                                                                                                                       |
| `POST /v1/plan`, `/v1/runs`, `/v1/runs/:n/begin`        | 401                                                               | 2 to 5 RT. A bearer in JWT form adds one request to GitHub's key set.    | nothing                                                                                                                       |
| `POST /v1/runs/:n/submit`                               | 401 if a live staged run exists for that workflow run, 404 if not | 3 to 5 RT before the credential check                                    | if Visonaut holds a live staged run for a public workflow run ID (TRUST-10)                                                   |
| `/v1/runs/:id/*` with a capability, `PUT /v1/uploads/*` | 401                                                               | 1 RT, plus 2 RT in the background (AUTH-06)                              | nothing                                                                                                                       |

No request in this table calls the GitHub API (0 measured). There is no rate limit in the application for any path outside `/api/auth/*` (AUTH-14). Production also answers on `visonaut.ariakit.workers.dev`: `/health` and the page shell work, the API answers 403 `wrong_origin` (INFRA-12, measured by the infrastructure lane; not repeated here).

### Short checklist (T7)

| Item                                       | State                                                                                                                                                                                                                 | Evidence                                                                                                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Five runtime secrets are separate bindings | Yes. Nothing checks that their values differ. Three have a length check of 32 characters.                                                                                                                             | `apps/web/wrangler.jsonc:113-121`, `apps/web/src/runtime.ts:122-131`, `:236-240`, `packages/security/src/auth.ts:18`, `capabilities.ts:48`, `webhooks.ts:24` |
| One secret for three token kinds           | Separated by audience and kind (measured)                                                                                                                                                                             | M3 part 1                                                                                                                                                    |
| Rotation procedure                         | Only as one step of database recovery. No procedure for a suspected leak. (TRUST-11)                                                                                                                                  | `apps/web/src/operations/README.md:82`                                                                                                                       |
| `checks.yml`                               | `pull_request` (not `pull_request_target`), `permissions: contents: read`, all actions pinned to a commit, `persist-credentials: false`. A fork pull request gets a read-only token and no secret.                    | `.github/workflows/checks.yml:3-9`, `:21-27`                                                                                                                 |
| `deploy.yml`                               | `push` to main and manual dispatch. The deploy job needs repository ID `1380751023`, `refs/heads/main`, and a push event. `id-token: write` only in the three deploy jobs, for Infisical. Actions pinned to a commit. | `.github/workflows/deploy.yml:3-6`, `:51-56`, `:88`                                                                                                          |
| `release.yml`                              | Publish job: environment `npm`, `id-token: write`, `NPM_CONFIG_PROVENANCE: "true"`, npm 11.20.0 for trusted publishing. Actions pinned to a commit.                                                                   | `.github/workflows/release.yml:99-129`                                                                                                                       |
| npm provenance                             | Enabled at publish. The consumer does not check it at install (TRUST-07).                                                                                                                                             | `release.yml:107-108`                                                                                                                                        |
| CLI install in the consumer Submit job     | `pnpm add --ignore-scripts --save-exact visonaut@0.5.4` in a separate directory. Pinned by version inside blob B. No digest check. The CLI has no runtime dependency.                                                 | live `app.yml:249-253`, `packages/cli/package.json`, `packages/cli/tsup.config.ts`                                                                           |
| Consumer branch rule                       | Required checks: `Gate` (App 15368) and `Visonaut` (App 5028451). One approving review, code owner review, approval of the last push.                                                                                 | `gh api repos/ariakit/ariakit/rules/branches/main` (M7)                                                                                                      |

## Findings

Each security finding has a path: actor, inputs, result. "Real path" means that the steps work today. "Defense in depth" means that a second failure is necessary first. No finding has a disposition. The maintainer decides.

### TRUST-01 · All Better Auth routes are served, and a session of any GitHub account is sufficient for them

- Kind: security
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/server.ts:85-86`: `const auth = createAuth(authConfiguration(env)); return securePrivateResponse(await auth.handler(request));` There is no path filter.
  - `packages/security/src/auth.ts:21-79`: no `disabledPaths`, no user-create hook, no profile check. `:36-41`: `encryptOAuthTokens: true, updateAccountOnSignIn: true`.
  - `probe-auth-surface.out.txt`, part B, with the session cookie of a user that has no repository access:

    ```text
    POST /get-access-token {accountId}  200 {"accessToken":"<plaintext access token>","scopes":["read:user","user:email"]}
    POST /refresh-token {accountId}     200 {"accessToken":"<plain text>","refreshToken":"ghr_…", …}   outbound: POST https://github.com/login/oauth/access_token
    GET  /account-info?accountId=…      200 {"user":{"name":…,"email":"…"},"data":{…}}                 outbound: GET api.github.com/user, /user/emails
    GET  /list-sessions                 200 [{"token":"0haetV6I…", …
    POST /update-user {name,image}      200  user row: image null -> "https://evil.example/pixel.png"
    POST /link-social                   200 {"url":"https://github.com/login/oauth/authorize?…"}  verification 0 -> 1
    ```

  - Part E, a full sign-in of GitHub account 999 that has no access to the repository: `"rows":{"user":"2 -> 3","account":"2 -> 3","session":"3 -> 4","verification":"1 -> 0","rateLimit":"1 -> 2","auth_audit":"3 -> 4"},"d1_round_trips":15`. The stored account has an encrypted access token (118 characters) and an encrypted refresh token (120 characters).
  - Part G, a reader of a database copy: `Authorization: Bearer <session.token column>` then `POST /get-access-token` returns the plain text token, and `POST /refresh-token` returns a new access token and refresh token.
  - The App that owns these user tokens has these permissions (from `gh api repos/ariakit/ariakit/check-runs/111214723784`, field `app.permissions`): `actions: read, checks: write, contents: read, emails: read, merge_queues: read, metadata: read, pull_requests: read`.
  - The app client uses only `signIn.social` and `signOut` (`apps/web/src/routes/index.tsx:216`, `:232`).
- Path 1 (real path, low gain): actor is any GitHub account. Inputs: sign in at `visonaut.com`. Result: the service stores 4 rows and two encrypted tokens for this account, and the account can call each route in the table of the map. It gets only its own data. It gets no review data (`403 not_maintainer`).
- Path 2 (defense in depth): actor is a script that runs in the page of a signed-in maintainer. This needs a script injection first; none was found, and the CSP uses a nonce. Inputs: `fetch("/api/auth/list-accounts")`, then `fetch("/api/auth/refresh-token", { method: "POST", body: JSON.stringify({ accountId }) })`. Result: the script holds a GitHub access token and a refresh token of the maintainer. These stay valid after sign-out and after the session ends.
- Path 3 (defense in depth): actor is a person with a copy of the D1 database, while a copied session is live (at most 7 days after its last renewal). Inputs: the `session.token` value as a bearer token, and the account row ID. Result: the same tokens. The encryption of `account.accessToken` does not protect them, because the service decrypts for the caller.
- What happens: Better Auth serves account, session, and profile routes by default. The project turned off email and password, but the other routes are active. The maintainer check (`requireMaintainer`) is not part of these routes.
- Impact: unused rows and secrets for each outside account; a second way to a GitHub user token that does not end with the session; a profile image URL that outside users can set (no page reads `user.image` today: `rg` for `user\.image|user\.name` in `apps/web/src/api` and `packages/service/src` finds nothing). The value of the user token depends on the App permissions. `checks: write` is in that list. It is not determined if GitHub lets a user access token of an App write check runs (see open question 1). If it does, a stolen maintainer token could set the `Visonaut` check.
- Recommendation: block the routes that the app does not use, and keep no user tokens (AUTH-16). Measured with the same options plus `disabledPaths` (part F): the blocked routes answer 404, `get-session` and `sign-out` still answer 200.

  ```ts
  // packages/security/src/auth.ts
  disabledPaths: [
    "/get-access-token", "/refresh-token", "/account-info", "/list-accounts",
    "/list-sessions", "/revoke-session", "/revoke-sessions", "/revoke-other-sessions",
    "/update-user", "/update-session", "/link-social", "/unlink-account",
    "/change-email", "/change-password", "/delete-user", "/delete-user/callback",
    "/sign-up/email", "/sign-in/email", "/request-password-reset", "/reset-password",
    "/verify-email", "/send-verification-email", "/verify-password",
  ],
  ```

- Alternatives, with the guarantee that each one changes:
  - Allow-list in `server.ts` (`/sign-in/social`, `/callback/github`, `/sign-out`, `/get-session`, `/error`). Guarantee: a Better Auth upgrade that adds a route cannot open it. A block list does not give this.
  - No stored OAuth tokens (AUTH-16, `databaseHooks.account`). Guarantee: no route and no database copy can give a GitHub user token. It does not remove the session token exposure.
  - A gate at sign-in. Measured in part F: when `getUserInfo` returns `null`, the callback redirects to `/api/auth/error?error=unable_to_get_user_info` and writes no `user`, `account`, or `session` row. The real gate would call `requireRepositoryWrite` with the GitHub user ID. Guarantee: only accounts with write access at sign-in time hold a session. Cost: 1 to 3 GitHub App requests for each sign-in, and a person who gets access later must sign in again. The request check stays.
  - Minimal: block only `/get-access-token`, `/refresh-token`, and `/account-info`. Guarantee: the GitHub token paths close; the session token and profile writes stay.
- Maintainer decision needed: yes. Which routes are part of a runbook (`get-session` is in `docs/evidence/e02-final-auth.md:9`)? Is a block list sufficient, or do you want an allow-list?

### TRUST-02 · A signed-in account without repository access causes 2 GitHub App requests on each private request

- Kind: security
- Severity: medium. Confidence: high for the counts, medium for the size of the rate budget. Measured: yes (counts). Effort: S
- Evidence:
  - `probe-auth-surface.out.txt`, part E, session of GitHub account 999 with permission `read`:

    ```text
    GET /api/runs, request 1  403 not_maintainer  d1_round_trips 5  github: POST /app/installations/1/access_tokens, GET /user/999, GET /repos/ariakit/ariakit/collaborators/newcomer/permission
    GET /api/runs, request 2  403 not_maintainer  d1_round_trips 5  github: GET /user/999, GET /repos/ariakit/ariakit/collaborators/newcomer/permission
    ```

  - `packages/security/src/github.ts:226-228`: `throw new SecurityError("not_maintainer", 403, …)` inside `checkPermission`. `rememberLogin` runs only after a positive result (`:236`, `:260`). So the login is resolved again on each request.
  - `packages/security/src/authorization.ts:71-82`: only a positive result is stored.
  - `packages/security/src/auth.ts:52`: the rate limit covers only Better Auth routes (AUTH-14). The private API has none.
  - Consumer rule: `{"context":"Visonaut","integration_id":5028451}` is a required status check on `main` (M7).
  - The same installation token serves OIDC verification (9 to 12 requests for each call, AUTH-15), check-run creation and delivery, and the permission checks of maintainers.
- Path (real path): actor is any GitHub account. Inputs: sign in one time (sign-in is open, TRUST-01), then send `GET /api/runs` with the cookie in a loop. Result for each request: 5 RT and 2 requests to the GitHub REST API with the App installation token. If the installation budget is 5,000 requests for each hour (the base value in the GitHub documentation; not verified for this installation), 2,500 such requests in one hour use all of it. That is less than 1 request for each second.
- What happens: the service asks GitHub two questions for each request of a user that it has already refused, and it does not remember the refusal.
- Impact: while the budget is empty, each GitHub call of the service fails with `503 github_unavailable`. Maintainers cannot open reviews. Begin, Reserve, and Submit fail. The `Visonaut` check cannot be created or completed, and that check is required for each merge in `ariakit/ariakit`. The effect ends when the GitHub window resets. The time of GitHub's reaction was not measured.
- Recommendation: remember a refusal for a short time, for the same session and GitHub user. Only a positive result is covered by the contract text (`docs/current-contract.md:186`), so this needs a decision.

  ```ts
  // packages/security/src/authorization.ts (sketch)
  const denied = deniedUntil.get(key);
  if (denied && denied > Date.now()) {
    throw new SecurityError("not_maintainer", 403, "Repository write permission is required.");
  }
  try {
    identity = await requireRepositoryWrite(github, githubUserId);
  } catch (error) {
    if (error instanceof SecurityError && error.code === "not_maintainer") {
      deniedUntil.set(key, Date.now() + 60_000); // a new grant waits at most 60 s
    }
    throw error;
  }
  ```

- Alternatives, with the guarantee that each one changes:
  - Remember the login hint also after a refusal. Guarantee: none for access. Cost falls from 2 requests to 1. Minimal.
  - Gate at sign-in (TRUST-01). Guarantee: an outside account holds no session, so this path does not exist for it. A former maintainer with an old session can still use it until the session ends.
  - A Cloudflare rate limit rule or binding for `/api/*`, keyed by session or address. Guarantee: an upper bound for each caller. It also covers AUTH-07 and TRUST-10.
  - A refusal cache in D1 in place of isolate memory. Guarantee: the bound holds across isolates. Cost: one D1 write for each first refusal.
- Maintainer decision needed: yes. May a negative permission result be reused, and for how long? The effect is that a person who gets write access waits up to that time.

### TRUST-03 · Pull request code selects the comparison settings, and the loosest settings make each change "unchanged"

- Kind: security
- Severity: medium. Confidence: high for the CLI and the validator (measured), medium for the full server path (code reading). Measured: yes. Effort: M
- Evidence:
  - `packages/protocol/src/validate.ts:44-64`: `threshold` can be 0 to 1, `maxDiffPixelRatio` 0 to 1, `maxDiffPixels` any safe integer.
  - `packages/cli/src/png-comparison.ts:68-83`: `pixelmatch(…, { threshold: comparison.threshold, … })`, then `Math.min(comparison.maxDiffPixels ?? Infinity, … pixels * comparison.maxDiffPixelRatio)`.
  - `apps/web/src/api/local-comparison.ts:529` and `:550-561`: `const policy = capture.comparison;` then the server computes the same allowance from that object. It never reads `threshold`. The service has no policy of its own for local comparison.
  - `probe-ci-chain.out.txt`, part 3. Reference: 100 x 50 pixels, all white. Candidate: all black.

    ```text
    {"threshold":0.2,"maxDiffPixels":0}        outcome changed    changedPixels 5000
    {"threshold":1}                            outcome unchanged  changedPixels 0     (also when the rendering profile changed)
    {"threshold":0.2,"maxDiffPixelRatio":1}    outcome unchanged  changedPixels 5000  (changed if the rendering profile changed)
    {"threshold":0.2,"maxDiffPixels":9007199254740991}  outcome unchanged  changedPixels 5000
    validateCaptureComparison accepts all four.
    ```

  - `packages/protocol/src/validate.ts:473-478` (`uploadImages`) and `apps/web/src/api/workflow-materialize.ts:302-306`: an unchanged capture is not uploaded, and the inventory keeps the reference image as its representative.
  - `packages/service/src/local-comparison.ts:173-174`: `if (result.outcome === "unchanged") continue;` No comparison row exists for an unchanged capture, so the review page has nothing to show.
  - The settings come from the capture job: the adapter reads `project.metadata.visonaut.comparisonDefaults` and the per-image options (`packages/playwright/src/comparison.ts:44-59`), and the capture job writes `manifest.json`. The Submit job cannot know which code wrote it (map, step 4.6).
- Path (real path for a same-repository pull request): actor is code in a capture job: the pull request author, or a dependency that a Renovate pull request updates (53 of the last 93 pull requests in `ariakit/ariakit` are from Renovate, M7). Inputs: `visual(page, { item, variant, threshold: 1 })`, or one line that edits `manifest.json` after the reporter. Result: the trusted CLI reports `unchanged` for an image with the same size and any pixels. The service accepts the receipt. The `Visonaut` check passes with zero items to review.
- Reach: this changes the pull request result. It does not change baseline pixels. After the merge, the main run executes the same code and gets the same answer, so the baseline keeps the old image for these identities. The real change then appears as a difference in a later pull request that uses normal settings.
- What happens: the contract moved the comparison policy to the consumer ("Current local comparison uses each capture's recorded `comparison` object", `docs/current-contract.md:107`). The service checks that the receipt is consistent with these settings. It has no upper limit for them, and a change of the settings is not a review event.
- Impact: the visual review can be skipped by a code change that looks like a test option. The code review of the pull request is then the only control. A size change is always "changed" (`png-comparison.ts:64-66`), so this path does not hide a layout change that changes the image size.
- Recommendation: add service-side upper limits for the three settings, in the receipt check. The values are configuration.

  ```ts
  // apps/web/src/api/local-comparison.ts, in validateLocalSubmission (sketch)
  const limit = context.configuration.comparisonLimits; // { threshold: 0.3, maxDiffPixelRatio: 0.01, maxDiffPixels: 500 }
  if (
    policy.threshold > limit.threshold ||
    (policy.maxDiffPixelRatio ?? 0) > limit.maxDiffPixelRatio ||
    (policy.maxDiffPixels ?? 0) > limit.maxDiffPixels
  ) {
    throw new IncompleteError("The consumer comparison settings exceed the service limits.");
  }
  ```

  Guarantee: no capture is classified as unchanged with a rule that is looser than the service permits. Before this change, read the settings that Ariakit uses today; a limit below them makes Submit fail.

- Alternatives, with the guarantee that each one changes:
  - Make a looser setting a review event. The reference inventory stores `comparisonDigest` for each capture (`workflow-materialize.ts:343-344`). If the candidate digest of the settings differs from the reference one and the image digest differs, require `changed`. Guarantee: a loosened setting is seen by a maintainer one time. Cost: each deliberate change of defaults makes one large review.
  - Show the settings in the review header ("3,832 captures; 12 use a threshold above 0.2"). Guarantee: visibility only.
  - Minimal: state in the review guide that comparison settings are code under code review, and add the Playwright config and the visual helper to the consumer's code owner rules. Guarantee: process only.
- Maintainer decision needed: yes. Does the service own an upper limit for comparison settings, or is the consumer the only owner (contract D07)?

### TRUST-04 · On main, new and removed identities reach the baseline with no human decision and no upper bound

- Kind: security
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `packages/service/src/local-comparison.ts:592-593`: `eligibleAutomatic = … (json_extract(row.tuple_json,'$.referenceDigest') IS NULL OR json_extract(row.tuple_json,'$.candidateDigest') IS NULL) …`. `:627`: `INSERT INTO visonaut_decisions … 'approved', 'automatic' …`.
  - Contract: `docs/simplification-audit/contract-issue-1.md:203` ("Automatically accept the first valid introduction of a new item or variant, including the first complete main batch") and `:207` ("Accept that removal automatically").
  - The expected set is not known to the service: `apps/web/src/api/workflow-materialize.ts:656-657` sends `tests: []`, `captures: []` in the plan. `manifest.discovery.inventoryDigest` is a digest of the manifest's own test list (`api/workflow-owned.ts:502-505`).
  - Limits: `apps/web/src/runtime-defaults.ts:14` `maximumCaptures: 40_000`.
- Path (defense in depth): actor is code that runs in the capture jobs of a main push. That code was merged, so it passed code review, or it is a dependency. Inputs: a manifest with fewer identities, or with new identities. Result: all missing identities leave the baseline, and all new identities enter it, with a passed check. The same happens with no attacker if a main run selects too few tests (for example a wrong `--grep`) and all jobs succeed.
- What happens: this is the designed behavior. The finding is that it is the only path from capture output to the baseline without a person, and that its size has no limit.
- Impact: the baseline can lose most of its coverage in one green main run. Later pull requests then show these identities as restorations that need review. New identities with any content become public images.
- Recommendation: add an upper limit for automatic removals in one main run (count or share of the reference). Above the limit, leave the rows pending so that a maintainer confirms them. Guarantee: a large loss of coverage needs one human decision. This changes a contract rule.
- Alternatives:
  - Alert only: record an operations event when a main run removes more than N identities. Guarantee: visibility after the fact.
  - No change, and document the rule in the review guide. Minimal.
- Maintainer decision needed: yes. Is unlimited automatic removal on main intended?

### TRUST-05 · The ingest capability renews itself without OIDC, also after Submit

- Kind: security
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/api/local-comparison.ts:444-448`: each answer of the reference route contains `capability: await issueIngestCapability(context.configuration.capability, { ...capability, reference })` with a new 600 s lifetime.
  - `apps/web/src/api/workflow-owned.ts:277-280` (`stagedReference`) and `:250-275` (`stagedCapability`): no check of `run.submitted_at`. The write routes have that check (`:484`, `:809`, `:1016`, `:1129`).
  - `packages/security/src/capabilities.ts:98-99`: "Ingest credentials must expire within 15 minutes." This limits one token, not the chain.
  - `probe-capability-renewal.out.txt` (clock moved in steps of 9 minutes):

    ```text
    first_capability_lifetime_minutes 10
    the Submit job submits; the staged run is now closed for writes
    round 1   minute 9    status 200  new capability valid until minute 19
    round 16  minute 144  status 200  new capability valid until minute 154
    finalize with the renewed capability after submission  409 closed_shard
    a capability that was not renewed, 16 minutes after issue  401 invalid_capability
    ```

  - The CLI does not need this chain. It renews through a new reservation with a new OIDC token: `packages/cli/src/engine.ts:416-430` (`renewReservation` calls `reserve`, then `readReference`).
- Path (defense in depth): actor is a holder of one leaked capability. A leak needs a failure in the Submit job first. Inputs: `POST /v1/runs/<id>/reference` with `{ schemaVersion, manifestDigest }` each 9 minutes. The `manifestDigest` must be the one of the stored binding; the holder of a capability from after the first reference call has it inside the token. Result: a valid capability for as long as the staged run is live (`stagedAttemptRetentionMs` is 24 hours, `apps/web/src/api/workflow-retention.ts:6`; the exact end was not measured). Each answer lists baseline captures (item key, variant key, digest, image ID), 200 for each page.
- Impact: the "10 to 15 minutes" bound of a leaked capability is not true for read access to the baseline inventory. Writes are closed after Submit. Before Submit, the holder can also upload inside the capability limits.
- Recommendation: do not extend the lifetime in the reference answer. Keep the expiry of the capability that came in.

  ```ts
  // packages/security/src/capabilities.ts (sketch): keep the remaining lifetime
  export function reissueIngestCapability(configuration, capability, expiresAt: number) {
    const remaining = Math.floor(expiresAt - Date.now() / 1000);
    return issueToken(configuration, "ingest", parseCapability(capability), remaining);
  }
  ```

  Guarantee: a capability chain ends at most 10 minutes after the last OIDC verification.

- Alternatives:
  - Refuse the reference route when `submitted_at` is set. Guarantee: no read after Submit. The chain before Submit stays.
  - Add an absolute `notAfter` claim (first issue time plus the job timeout) and copy it on each reissue. Guarantee: one fixed upper bound for a run.
  - Minimal: correct the comment and the documents to say that the bound is for one token.
- Maintainer decision needed: no for the first option, if the CLI behavior at `engine.ts:416-430` is the only client. Yes if another client depends on the chain.

### TRUST-06 · An OIDC token is accepted again inside its 10 minutes, and one audience serves three endpoints

- Kind: security
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `packages/security/src/oidc.ts:129-130`: `requiredClaims: ["sub", "exp", "iat", "nbf", "jti"], maxTokenAge: "10m"`. `rg -n "jti" apps/web/src packages/*/src apps/web/migrations` finds only this line and `capabilities.ts:122`. No table stores a token ID.
  - `apps/web/src/api/workflow-owned.ts:315`, `:342`, `:1224`: Begin, Reserve, and Submit all use `new URL("/submit", origin).href` as the audience.
  - `probe-ci-chain.out.txt`, part 2: the same token is accepted 3 times. A token that is 9 minutes old is accepted; 11 minutes old is refused. A token with `runner_environment: "self-hosted"` and `environment: "production"` is accepted. A token is still accepted after its job and run finished with success.
- Path (defense in depth): actor is a holder of one leaked Submit token that is less than 10 minutes old. Inputs: `POST /v1/runs` with the same body as the CLI. Result: a new capability for that run while the run is not submitted (`workflow-owned.ts:347`, `:468`), then TRUST-05. The holder cannot change which run, attempt, commit, or job the token names.
- What happens: the endpoints are safe to repeat, so a replay makes no second run. But each replay of Reserve gives a new capability.
- Impact: low. The token never leaves the trusted job in the normal flow.
- Recommendation: use one audience for each endpoint (`/submit/begin`, `/submit/reserve`, `/submit`). The CLI already asks for a token before each call (`packages/cli/src/bundle-submit.ts:61`). Guarantee: a token for Begin cannot reserve or submit.
- Alternatives:
  - Store `jti` with its expiry in D1 and refuse a second use for Reserve and Submit. Guarantee: single use. Cost: one write and one read for each verification, and the CLI retry logic must ask for a new token on each retry.
  - Require `runner_environment === "github-hosted"`. Guarantee: a self-hosted runner that someone adds later cannot submit.
  - No change. Minimal.
- Maintainer decision needed: yes, only if single use is wanted.

### TRUST-07 · The Submit job installs the CLI by version only, the saved consumer patch shows a digest check that is not live, and the pinned blobs use action tags

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes (file comparison). Effort: S
- Evidence:
  - Live `ariakit/ariakit/.github/workflows/app.yml` (blob `202fd63a37199f5ac4350bd7c4e4bc44ea442216`, equal to the pin in `apps/web/wrangler.jsonc:61`), lines 249-253:

    ```yaml
    - name: Install Visonaut
      run: |
        mkdir -p "$RUNNER_TEMP/visonaut-tools"
        pnpm --dir "$RUNNER_TEMP/visonaut-tools" add --ignore-scripts --save-exact "visonaut@0.5.4"
    ```

  - `docs/operations/ariakit-consumer.patch:753-758`: `curl … "https://registry.npmjs.org/visonaut/-/visonaut-$VISONAUT_PACKAGE_VERSION.tgz"` then `sha256sum --check --strict`. Line 859 of the same patch: "verifies the tarball SHA256 before installation". The patch also has a `visual.yml` file, a `Plan / Report` job, and job names (`App / Visual / Capture / linux`) that the live consumer does not have.
  - Live `app.yml:11`: `VISONAUT_PACKAGE_SHA256: be4439ac…`. This is the adapter archive digest D (`docs/operations/adapter-service-pins.md:15`), not a CLI digest. It is used as `executorDigest` and `planDigest` of capture manifests (`packages/cli/src/bundles.ts:49-55`).
  - Live `ci.yml:70`: `npm exec --yes --ignore-scripts --package=visonaut@0.5.4 -- visonaut submit --no-visual`.
  - Action references in the two pinned blobs and in the setup action at the fixed commit `c87988ef`: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`, `actions/download-artifact@v8` (tags), `pnpm/action-setup@0977fd99…` (commit).
  - `packages/cli/package.json`: only `devDependencies`. `packages/cli/tsup.config.ts`: `noExternal: ["@visonaut/protocol", "@visonaut/compare", "pixelmatch", "pngjs"]`. So the install fetches one archive.
  - `.github/workflows/release.yml:107-108`: `NPM_CONFIG_PROVENANCE: "true"`.
- What happens: the service pins the two workflow files by Git blob. Those files name the CLI by version and four actions by tag. The blob pin does not fix the content behind a tag. The document that is called the consumer patch describes an older design with a stronger install check.
- Impact: the job that holds the OIDC permission trusts that the npm registry serves the same archive for `0.5.4` and that the `actions/*` tags do not move to bad code. Both are common trust decisions, and the CLI has no transitive dependency. The larger cost is the document: a reader of `docs/operations/ariakit-consumer.patch` gets a wrong picture of the live checks.
- Recommendation: mark `docs/operations/ariakit-consumer.patch` as historical in its first line or in `docs/operations/` index text, and add the live install lines to `docs/operations/adapter-service-pins.md` next to the B, C, D tuple.
- Alternatives, with the guarantee that each one changes:
  - Add the archive check to the consumer (the lines of the saved patch). Guarantee: the Submit job runs exactly the reviewed CLI bytes. Cost: a new blob B for each CLI release (this is already true, because the version is in the file).
  - Check provenance at install (`npm audit signatures` in the tools directory). Guarantee: the archive was built by this repository's release workflow.
  - Pin the four actions to commits in the consumer. Guarantee: the blob pin then covers the action code.
- Maintainer decision needed: yes. Is version pinning sufficient for the Submit job?

### TRUST-08 · A fork pull request never gets the required `Visonaut` check, and no document says so

- Kind: dx
- Severity: low. Confidence: high for the service checks, medium for the GitHub side. Measured: yes (local OIDC case and consumer data). Effort: S
- Evidence:
  - `apps/web/src/api/pre-run-candidates.ts:64-72`: `numericId(object(head.repo).id) !== github.repositoryId` returns `null`, so no check is stored or created.
  - `packages/security/src/oidc.ts:300`: `requireEqual(numericId(record(head.repo).id), github.repositoryId, "pull.head_repository_id");`. Measured: `"pull request head is in a fork" → 403 untrusted_run, check pull.head_repository_id`.
  - `packages/security/test/oidc.test.ts:551`: "still rejects a fork PR when its author has no collaborator permission".
  - Consumer rule (M7): `Visonaut` from App `5028451` is required on `main`.
  - `rg -n -i -w "fork|forks|forked"` over `README.md`, `docs/current-contract.md`, `docs/review-guide.md`, `docs/development.md`, `docs/operations/`, `.github/`, `apps/web/src`, and `packages/` finds only the test above.
  - `gh pr list -R ariakit/ariakit --state all --limit 400`: 0 of 400 pull requests (since 2026-08-19) come from another repository.
- What happens: the fork case is closed at three places. This is the safe direction. But a contributor from a fork gets a pull request that can never pass the branch rule, and nothing explains why. Assumption, not verified: GitHub gives no OIDC token to a fork run, so the `Plan` step `visonaut submit --no-visual` and the Submit job fail there.
- Impact: no security impact. A maintainer must push the branch to the main repository to get a result. There was no such pull request in the measured period.
- Recommendation: write the rule in `README.md` or the review guide: "Visonaut accepts only branches of `ariakit/ariakit`. For a fork, a maintainer pushes the branch to the repository."
- Alternatives:
  - Create a completed check with conclusion `action_required` or `neutral` and a short text for a fork pull request. Guarantee: the contributor sees the reason. A `neutral` conclusion would satisfy the required check, so only `action_required` or `failure` keeps the gate.
  - Support forks with a trusted capture of fork code. This changes the trust model (secrets-free capture already exists, but Submit needs OIDC). Large.
- Maintainer decision needed: yes. Is "no fork support" the intended product rule?

### TRUST-09 · A signed webhook body is accepted again under a new delivery ID

- Kind: security
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/security/src/webhooks.ts:27-29`: the delivery ID and the event name come from headers. `:55`: the HMAC covers only the body.
  - `probe-webhooks-anon.out.txt`, part A:

    ```text
    revocation, delivery GUID 1                              202  sessions_of_user 0
    the user signs in again                                       sessions_of_user 1
    the same body and signature, the same GUID 1             202  sessions_of_user 1   (safe)
    the same body and signature, a new GUID 2                202  sessions_of_user 0   (signed out again)
    the same body through the alias /webhooks/github, GUID 3 202  sessions_of_user 0
    auth_audit: github_revoked 3
    ```

  - `apps/web/src/api/webhooks.ts:130-132`: an `installation` event with action `deleted` or `suspend` deletes all sessions.
- Path (defense in depth): actor is a person who has one real signed body. GitHub's format has no time in the signature, and the body travels only over TLS, so the actor needs a log, a proxy, or the old router Worker. Inputs: the body, its signature, the event name, and any new UUID as delivery ID. Result: the event is processed again. For a revocation, the user is signed out again and one more audit row is written. For an `installation` `suspend` body, all users are signed out again.
- Impact: repeated sign-out and audit noise. No access is gained. For CI events the handlers read the current state from GitHub, so a replay cannot move a check to a wrong state (from code reading: `api/webhooks.ts:186-329` all call GitHub or check stored state).
- Recommendation: for the two session-deleting events, refuse a body whose digest is already stored for the same event. The column exists (`payload_digest`).

  ```sql
  -- before processing a github_app_authorization or installation event
  SELECT 1 FROM github_webhook_delivery
  WHERE event = ? AND payload_digest = ? AND delivery_id != ? AND processed_at IS NOT NULL LIMIT 1
  ```

  Guarantee: one signed revocation body signs a user out one time. Check first that GitHub does not send two equal bodies for two real revocations of the same user; if it does, this rule would skip the second one.

- Alternatives:
  - Retire the alias `/webhooks/github` after the cutover is confirmed. Guarantee: one receiver URL. It does not change replay.
  - Move the signature check before the project read (`api/index.ts:123-129`). Guarantee: an unsigned request costs no D1 read.
  - No change. Minimal.
- Maintainer decision needed: yes. Is the alias URL still needed (`docs/operations/simplification-cutover.md:47`)?

### TRUST-10 · Ingest routes do database work, and one outbound request, before they check the credential

- Kind: cost
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence (`probe-webhooks-anon.out.txt`, part B, requests without a valid credential):

  ```text
  POST /v1/runs/9001/submit, no bearer (a live staged run exists)   401 credential_required  4 RT
  POST /v1/runs/9002/submit, no bearer (no staged run)              404 not_found            3 RT, 5 after 30 ms
  POST /v1/plan, forged bearer                                      401 invalid_oidc         5 RT  outbound: https://token.actions.githubusercontent.com/.well-known/jwks
  POST /v1/runs, forged bearer                                      401 invalid_oidc         4 RT  outbound: the same URL
  POST /v1/runs/<uuid>/shards/%E0%A4%A, no bearer                   503 service_unavailable  1 RT  log: {"event":"operation-failed","operation":"api",…}
  ```
  - `apps/web/src/api/workflow-owned.ts:1177-1196`: Submit reads the staged run, and an older attempt, before `verifyWorkflowJob` at `:1209`.
  - `apps/web/src/api/index.ts:170`: `decodeURIComponent(shardMatch[2])` throws `URIError` for a bad percent sequence. The error is not a `SecurityError`, so it becomes a 503 with an `operation-failed` log line (`index.ts:67-83`).
  - `packages/security/src/oidc.ts:120-124`: a new key set object for each call, so each token in JWT form with an unknown key ID starts one fetch (AUTH-15).

- Path (real path, low gain): actor is anonymous. Inputs: the requests above. Result: 1 to 5 RT and at most one outbound request for each request; a 401 or 404 answer that says if a public workflow run ID has a live staged run; one `operation-failed` log line for each bad percent sequence.
- Impact: small cost and log noise. The run ID oracle gives no private data, because workflow run IDs of a public repository are public. A flood of the bad-percent request can hide real `operation-failed` lines or trigger an alert on them.
- Recommendation: three small changes. Read the bearer token first in `submitStaged` (`bearerToken(request)` before the first query). Catch the decode error and answer 400. Keep the key set in module memory (AUTH-15).

  ```ts
  // apps/web/src/api/index.ts
  let shardKey: string;
  try {
    shardKey = decodeURIComponent(shardMatch[2]);
  } catch {
    throw new SecurityError("invalid_path", 400, "The shard key is invalid.");
  }
  ```

- Alternatives: a Cloudflare rate limit rule for `/v1/*` (see TRUST-02). No change.
- Maintainer decision needed: no.

### TRUST-11 · There is no procedure to rotate a secret outside database recovery

- Kind: dx
- Severity: low. Confidence: medium (absence of a document). Measured: no. Effort: S
- Evidence:
  - `apps/web/wrangler.jsonc:113-121` lists `BETTER_AUTH_SECRET`, `CAPABILITY_SECRET`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`.
  - `rg -n -i "rotat" --glob '*.md'` (without `docs/simplification-audit`) finds rotation only in recovery text: `apps/web/src/operations/README.md:82` ("Rotate authentication and ingest capability secrets in the target") and dated restore evidence.
  - Each verifier accepts one key: `packages/security/src/capabilities.ts:117`, `webhooks.ts:45-51`, `auth.ts:25`.
- What happens: each secret has one value, and no code accepts an old and a new value at the same time. No document says what breaks during a change.
- Impact: in an incident, the operator must work out the effects alone. From the code: a new `CAPABILITY_SECRET` fails Submit jobs that are in progress (at most 10 minutes of work). A new `BETTER_AUTH_SECRET` signs all users out and makes stored OAuth tokens unreadable. A new `GITHUB_WEBHOOK_SECRET` must change at GitHub and in Cloudflare; deliveries between the two changes fail with 401 and need the existing redelivery recovery (`apps/web/src/operations/github-deliveries.ts`). A new App private key or client secret needs the old one to stay valid at GitHub until the deploy is complete.
- Recommendation: add one short section to `apps/web/src/operations/README.md` with one row for each secret: where it is set, what fails during the change, the order of steps, and the readback.
- Alternatives: accept two webhook secrets for a short time (`GITHUB_WEBHOOK_SECRET_PREVIOUS`). Guarantee: no failed delivery during a change. More code for a rare event.
- Maintainer decision needed: no.

## Measurements (command, raw result, limits)

All files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-trust-boundary/`. The probes import repository source files. They write nothing to the repository (`git status --porcelain` shows the same two entries as at the start: `M pnpm-lock.yaml`, `?? apps/lab/`). Common limits: Node 24.18.0, in-process SQLite with a D1-shaped wrapper and all files of `apps/web/migrations`, stub GitHub, no network. Counts and status codes do not depend on the machine. No number here is a production time, except M6.

### M1. Auth route surface

```sh
node --experimental-transform-types --no-warnings probe-auth-surface.mjs > probe-auth-surface.out.txt
```

Parts: A (31 registered endpoints), B (34 route cases, each without and with a session cookie of a user with no repository access), C (7 origin cases for a cookie `POST`), D (24 redirect cases), E (full sign-in of a new GitHub account, then its requests), F (the same options plus `disabledPaths`, and a sign-in gate), G (database copy: raw session token as bearer). Raw lines are quoted in TRUST-01 and TRUST-02 and summarized in the auth route table of the map.

Limits: the GitHub OAuth and REST answers are stubs. `refresh-token` and `account-info` were not run against GitHub. The probe calls `auth.handler` directly, so the `server.ts` origin rule (`url.origin === VISONAUT_ORIGIN`) is not in the path; all probe requests use the configured origin.

### M2. Capability renewal

```sh
node --experimental-transform-types --no-warnings probe-capability-renewal.mjs > probe-capability-renewal.out.txt
```

One staged run and one bundle row, a capability with the claims of `reserveStaged`, a clock that moves 9 minutes for each round. 17 reference calls return 200 and a new capability, 16 of them after `submitted_at` was set. Finalize with the last capability returns `409 closed_shard`. A capability that is 16 minutes old returns 401.

Limits: the project has no baseline, so each page has 0 captures. The staged retention end (24 hours) was not reached.

### M3. CI chain

```sh
node --experimental-transform-types --no-warnings probe-ci-chain.mjs > probe-ci-chain.out.txt
```

- Part 1: each of the three token kinds is accepted only by its own verifier (9 combinations). An upload ticket with a capability of another run: 403 `invalid_ticket`. A reuse challenge with another manifest digest: 403 `invalid_challenge`. A production token in the preview environment: refused. A lifetime of 901 s: refused at issue.
- Part 2: `verifyGitHubOidc` with a local key set and the production-shaped configuration (caller `ci.yml`, job workflow `app.yml`). 25 cases. Accepted: the Submit job token (also 3 times, also with extra claims, also 9 minutes old, also after the job and run succeeded). Refused, with the check name that the code logs: Plan job token (`rest.job_name`), capture job token (`rest.job_name`), unknown job (`untrusted_job`), another reusable workflow (403), other `ci.yml` blob (`rest.caller_workflow_blob`), other `app.yml` blob (`rest.direct_workflow_blob`), fork head (`pull.head_repository_id`), other commit (`claim.sha`), other run (`claim.run_id`), other attempt (`claim.run_attempt`), newer attempt exists (`rest.current_attempt`), Plan audience (401), `workflow_dispatch` (403 `unsupported_event`), 11 minutes old (401), expired (401), cancelled run (409 `inactive_run`), failed job (409 `inactive_job`). An accepted verification makes 9 GitHub requests.
- Part 3: `comparePixels` and `validateCaptureComparison` with 5 settings and 2 profile states (quoted in TRUST-03).
- Part 4: `validateKey` with 20 inputs.

Limits: GitHub REST answers are stubs with the fields that the code reads. Part 3 runs the CLI function and the protocol validator, not the full `declareStaged` path; the server acceptance of such a receipt is from code reading.

### M4. Static scans

```sh
node scan-sql-interpolation.mjs > scan-sql-interpolation.out.txt
# {"files_scanned":163,"interpolations":183,"distinct":80}

rg -n -o --no-heading -U 'request\(\s*`[^`]*`' apps/web/src packages/security/src --glob '!**/*.test.*' | rg -o '\$\{[^}]*\}' | sort | uniq -c | sort -rn
# 64 distinct expressions: repository, numbers, commits, IDs, encodeURIComponent(...), refs from signed data

rg -n "\.(put|get|head|delete|list)\(" apps/web/src --glob '!**/*.test.*' ...   # R2 calls; keys come from rows and server-made IDs
rg -n "dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document\.write|href=\{|src=\{" apps/web/src --glob '!**/*.test.*'
# one dangerouslySetInnerHTML (constant script), href and src values use encodeURIComponent or server-made IDs
rg -n "jti" apps/web/src packages/security/src packages/service/src apps/web/migrations --glob '!**/*.test.*'
# oidc.ts:129 and capabilities.ts:122 only
rg -n -i -w "fork|forks|forked" apps/web/src packages docs/current-contract.md README.md docs/operations .github -g '!*.json'
# packages/security/test/oidc.test.ts:551 only
```

The scan script reads each template literal that contains SQL words and lists each `${…}`. I read the source of each expression that is not a plain SQL fragment: `${table}` (`apps/web/src/api/workflow-retention.ts:38`, the fixed list `stagedChildTables`), `${input.table}`, `${source.table}`, `${source.scope}` (`apps/web/src/operations/history.ts`, fixed maps), `${fields}` and `${columns.join(",")}` (column names from `PRAGMA table_info`, checked with `/^[a-z_][a-z0-9_]*$/` at `history.ts:437`), `${selection}` (`apps/web/src/api/dashboard.ts:69-70`, two literals), `${query}` (`apps/web/src/operations/promotions.ts`, a constant), `${subject}`, `${checkId}`, `${run}`, `${runAlias}`, `${row}`, `${snapshot}` (aliases or `?`).

SQL that is not in a template literal: `rg -n 'prepare\([^`"]' apps/web/src packages/service/src packages/security/src --glob '!**/_.test._'`finds 5 production call sites. Each passes a constant or a constant plus a fixed suffix with`?` (`packages/service/src/work.ts:358`, `apps/web/src/operations/closed-summary.ts:74`, `recovery.ts:59`, `review-links.ts:76`, `:169`).

Limits: the scan covers `apps/web/src`, `packages/service/src`, `packages/security/src`, `packages/protocol/src`, and `apps/compare/src` without tests. It does not follow a SQL string through more than one function.

### M5. Webhooks and requests without a credential

```sh
node --experimental-transform-types --no-warnings probe-webhooks-anon.mjs > probe-webhooks-anon.out.txt
```

Part A: 10 webhook cases through `handleApi` (quoted in TRUST-09; also wrong signature 401, no signature 401, 1 MiB + 1 byte 413, other repository 403, other installation 403, event header changed to `ping` 400). Part B: 23 requests without a valid credential, with RT counts before the answer and 30 ms later, GitHub API calls (0 in all cases), and other outbound requests. Part C: 5 anonymous `POST /api/auth/sign-in/social` write 5 `verification` rows (1,515 bytes) and 5 `rateLimit` rows; one later callback request deletes the expired rows; 62 requests to one auth path from one address give 60 times 200 and 2 times 429.

Limits: in part C the probe sets `X-Forwarded-For` directly. On Cloudflare a client cannot select this value freely (AUTH-14). The background RT counts depend on a 30 ms wait.

### M6. Production, anonymous GET only

7 requests on 2026-10-05, no cookie, no `/api/auth/*` path. Command: `curl -s -o /dev/null -w "%{http_code} %{time_starttransfer}s %{size_download}B %{url_effective}\n" <urls>`. Raw result (`prod-anonymous.out.txt`):

```text
200 0.592115s 107B   https://visonaut.com/health
401 0.433032s 92B    https://visonaut.com/api/runs
404 0.251392s 9B     https://visonaut.com/images/00000000-0000-4000-8000-000000000000
401 0.514697s 92B    https://visonaut.com/v1/runs/00000000-0000-4000-8000-000000000000
200 0.165886s 32237B https://visonaut.com/pulls/1?check=x
401 0.371978s 70B    https://visonaut.com/api/me
401 0.468732s 92B    https://visonaut.com/webhooks/github
```

Limits: one sample for each URL from one network, with connection reuse inside one `curl` call. The times are not a latency measurement. The four JSON 401 bodies have code `sign_in_required`.

### M7. Consumer repository, read-only GitHub API

```sh
gh api repos/ariakit/ariakit/contents/.github/workflows/app.yml --jq .sha   # 202fd63a37199f5ac4350bd7c4e4bc44ea442216
gh api repos/ariakit/ariakit/contents/.github/workflows/ci.yml --jq .sha    # 4d34ca17315b19fa90083501eb347ea23d88dda9
gh api repos/ariakit/ariakit/rules/branches/main
# required_status_checks: Gate (integration 15368), Visonaut (integration 5028451); pull_request: 1 approval, code owner review, last push approval
gh api repos/ariakit/ariakit/check-runs/111214723784
# app.slug visonaut-ci, permissions: actions read, checks write, contents read, emails read, merge_queues read, metadata read, pull_requests read
# events: check_run, merge_group, pull_request, push, workflow_run
gh pr list -R ariakit/ariakit --state all --limit 400 --json number,isCrossRepository,createdAt
# total 400, cross_repository 0, oldest 2026-08-19
gh pr list -R ariakit/ariakit --state all --limit 300 --search "created:>=2026-09-25"
# total 93: app/renovate 53, diegohaz 36, DaniGuardiola 3, app/ariakito 1
```

The two workflow files, the planner at `c87988ef`, and the setup action are saved in `consumer/`. Limits: these are the files on `main` at the time of the read. All calls are reads.

## Open questions and items not verified

1. **Can a GitHub App user access token write check runs?** The App has `checks: write` (M7). The GitHub page for check runs says that write access for checks is available only to GitHub Apps and that OAuth apps and authenticated users cannot create check runs (read through a page summary tool, not as verbatim text). It does not say clearly if a user access token of an App counts as the App. This decides how much a stolen user token is worth (TRUST-01). A test needs a real token and is outside this lane.
2. **Token expiry setting of the GitHub App.** If "expire user authorization tokens" is on, `account.refreshToken` holds a 6-month refresh token. The App setting is not visible from here. The probe shows only that Better Auth stores and returns a refresh token when GitHub sends one.
3. **GitHub and fork runs.** I assume that a `pull_request` run from a fork cannot get an OIDC token. The OIDC reference page that I read does not state it. The service refuses a fork head in any case (TRUST-08).
4. **Size of the installation rate budget.** TRUST-02 uses 5,000 requests for each hour as the base value. The real value for this installation, and GitHub's secondary limits, were not read.
5. **Server acceptance of a `threshold: 1` receipt, end to end.** The CLI function and the validator are measured. `validateLocalSubmission` was read, not run with such a manifest. An existing test (`apps/web/src/api/workflow-owned.test.ts:1999`) uses `{ threshold: 0.2, maxDiffPixels: 1 }` through the same path.
6. **The comparison settings that Ariakit uses today.** A service-side limit (TRUST-03) must be above them. The consumer's Playwright config was not read.
7. **Planner rules for `app=false`.** The fixed planner at `c87988ef` skips the App workflow for changes only in `examples/`, in Markdown files, and in package test files (`consumer/ci.c87988ef.ts`, `safelyCoveredByMain`). `app/package.json` and `nextjs/package.json` have no dependency on the `examples` workspace. I did not check if a path alias lets the app render files from that set. If it does, such a pull request passes the check with no capture; the main run after the merge always captures (`ci.yml` sets `app=true` for a push).
8. **Order between two different workflow runs of one pull request head.** Attempts of one run are covered (map). Two runs (for example after close and reopen) were not traced.
9. **Leaked capability before Submit.** The claim that a holder can make the real job fail with `manifest_conflict` is from code reading (`apps/web/src/api/workflow-owned.ts:645-659`).
10. **PNG decoder in the Submit job.** The CLI decodes pull request images with `pngjs` in the job that has the OIDC permission. `validateImage` bounds the dimensions first. No fuzzing was done.
11. **Production `workers.dev` host.** Not requested by this lane. INFRA-12 has the measurement.
12. **`/api/me` and static assets.** The cost of an anonymous `/api/me` request and the headers of static files were not measured here.
13. **Bidirectional control characters in display strings.** `string()` in `packages/protocol/src/validate.ts:81-92` accepts them for `capture.name`, `titlePath`, and `test.file`. This was read, not probed, and the review UI was not checked for how it shows them.
