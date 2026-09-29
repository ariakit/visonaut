# Operations follow-up: selected decisions

Research date: 2026-09-29. Visonaut source: `7e23173d11b1081f55021ef498e4c5c6d6a08131`. This is a read-only report for the decision artifact. No product, workflow, Infisical, Cloudflare, or npm state was changed.

## O01 — Keep one check owner for each event

**Selected direction:** one owner. This does not require automatic npm publication.

**Verified:** `.github/workflows/checks.yml:3–8` runs on both a main push and `workflow_call`. `.github/workflows/deploy.yml:3–18` handles the same main push and calls those checks again. `release.yml:3–29` is a separate, manual request that also calls the checks. The duplicate main-push pair is unnecessary; a later manual release is a different requested action.

**Recommended wording:** “Run the main checks once. Let the deployment depend on that result. Keep package publication in the manual release workflow, where Changesets selects and publishes the prepared package versions.”

**Smallest change:** remove the main-push trigger from `checks.yml`, keep its PR and callable entry points, and let Deploy own main-push checks. Keep manual Release as its own owner. No cross-workflow artifact lookup or `workflow_run` relay is needed. Do not introduce an automatic Changesets bot or publish-on-push policy unless requested.

```yaml
# checks.yml
on:
  pull_request:
  workflow_call:

# Deploy and manual Release can each call the same checks workflow.
```

The earlier live CI sample showed 802 duplicate aggregate job seconds, or 13m22s, for the independent CI run at the same source SHA. That is runner time, not user-visible wall time. The production environment build in Deploy is distinct and must remain until a tested production artifact replaces it.

## O07 — Let the workflow use Changesets for publication

**Selected direction:** the release workflow runs `changeset publish`. Treat this as settled. The question is how much of the existing exact-tarball mechanism remains useful.

**Verified current mismatch:**

- Root `package.json:14–19` already has Changesets 3.0.3, versioning, and `release: pnpm build && changeset publish`.
- `release.yml:56–60` instead invokes the custom `packages.mjs publish` command.
- `.github/workflows/scripts/packages.mjs:181–229` implements a source-SHA latch, package selection, tag selection, registry integrity/provenance comparison, and retry decisions. Lines 380–406 call `npm publish` directly.
- `.github/workflows/README.md:52–58` documents only that custom path. It requires setting and later clearing `VISONAUT_RELEASE_COMMIT`. The variable was absent during the read-only repository-variable inventory, which is consistent with the documented cleared state between releases.
- Changesets config uses public access, independent versions, and main as the base branch. `changeset publish` publishes package versions that are not already in the registry. It does not consume pending changesets or make version commits; `changeset version` does that first.

**Recommended minimum:** use the checked main source, build the public packages, run the package-install smoke checks, and have the manual workflow invoke `pnpm exec changeset publish --no-git-tag`. Keep `environment: npm`, `id-token: write` on the publication job, main/repository checks, serialized releases, and the existing npm trusted-publisher registration. Keep version changes as reviewed source changes. Make the root `release` command match this workflow path; do not retain two documented publishing systems.

```yaml
# In the manual Release workflow, after the checks and build succeed:
- run: pnpm exec changeset publish --no-git-tag
```

This is the smallest arrangement. It verifies the source and package behavior, then lets the package manager pack for publication. It does **not** promise that the tarball bytes are the same files tested in an earlier job. That extra promise is optional, not a requirement for the user’s selected direction. If package lifecycle scripts are added, test their packing behavior; the current public packages have build/test/typecheck scripts and no publish lifecycle scripts.

**Alternative if exact tested bytes remain a requirement:** Changesets 3.0.3 already supports the standard packed-artifact flow. Use the same pinned CLI version for pack and publish, a small local checker for packed paths/digests, and the current package-install smoke tests. This removes the custom publisher while keeping the exact artifacts.

```sh
# A build/verify job without publish permission:
pnpm exec changeset pack --out-dir "$RUNNER_TEMP/public-packages"
# Verify package contents and installs, then upload this directory.

# The npm publication job downloads that same run's artifact:
node scripts/check-packed-release.mjs "$RUNNER_TEMP/public-packages"
pnpm exec changeset publish --from-pack-dir "$RUNNER_TEMP/public-packages" --no-git-tag
```

The checker name above is illustrative; no file was created. The only extra check needed for the exact-bytes promise is that each planned tarball is within the artifact directory and matches its recorded digest, plus the intended package/source checks. Avoid retaining a second release planner.

**Important verified limits of the native alternative:**

- Installed `@changesets/cli/dist/pack.mjs:28–31,68–90` writes SHA-256 integrity and a `publish-plan.json`.
- Installed `getPublishPlan.mjs:592–597` only validates the outer plan shape/version. `publish.mjs:109–127` passes the tarball path to the package manager. I found no native digest comparison before publication in 3.0.3. Do not claim it replaces the existing hash check by itself.
- `publish.mjs:57–59` rejects `--tag` together with `--from-pack-dir`; the tag must be set in the pack plan. Plain `changeset publish --tag next` supports the existing tag choice with less machinery. If the packed alternative is chosen, prefer ordinary Changesets prerelease state or a reviewed plan; do not silently append `--tag` to artifact mode.
- Native `pack` selects unpublished versions. It is not a drop-in replacement for PR package tests that currently pack both packages even when their versions are already published. Keep ordinary `pnpm pack` smoke checks for PRs, and use native Changesets pack only for release if required.
- Native publication skips already-published versions. It does not retain the custom policy that an existing registry version must match this build’s digest, provenance, and selected tag. This is a policy simplification, not a demonstrated failure.
- `--no-git-tag` keeps current source-tag behavior. Without it, Changesets creates local tags by default. No GitHub Release or tag push is required by the selected direction.

**What can be removed:** custom `assertRelease`, `selectedReleaseRecords`, `publicationNeeded`, `registryPackage`, `publish`, custom publish command dispatch, their tests, the `VISONAUT_RELEASE_COMMIT` ritual, and custom package/tag selection when standard Changesets version/prerelease selection replaces them. For the minimum source-based route, the custom artifact manifest and exact-hash handoff can also go. For the native packed route, replace that manifest with the native plan and a short digest/path checker. Keep useful checks that install the public package and run its CLI; they catch missing files and unresolved workspace dependencies. The custom tar parser and fixed runtime file allowlists should shrink further when the selected integration changes remove the embedded capture runtime. Do not delete every packaging check just because Changesets publishes.

**One repository-specific counterexample:** `packages/cli/package.json:34–35` depends on the adapter. `packages/playwright/ci/package.json:6–9` also embeds an older `visonaut@0.1.0` in a nested private runtime that is outside `pnpm-workspace.yaml` package globs. Changesets sees the first dependency, but not that nested runtime as a workspace release dependency. The current pinned older CLI is not a release-order blocker. If that nested lock is later changed to require a not-yet-published CLI, standard workspace ordering will not solve it. Remove the redundant embedded runtime as part of the integration simplification, or retain its focused installation check until it is gone.

**Verification needed before rollout:** dry-run the package contents and normal installation; confirm pending changesets are versioned in the intended release commit; test an already-published version as a no-op; test the dependency order. Run one intended npm release through OIDC and inspect its published provenance afterward. No publication was performed during this audit. The current Changesets detection chooses pnpm in this repo, and pnpm 12 publishes natively; do not assume the command delegates to the npm executable.

Primary references: [Changesets CLI](https://changesets.dev/guide/cli), [pnpm publish](https://pnpm.io/cli/publish), [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [pnpm’s merged OIDC implementation correction](https://github.com/pnpm/pnpm/pull/11495). npm documents automatic provenance for public packages published from public repositories with trusted publication. Keep the workflow identity registered to `release.yml` and `npm`; do not add an npm token.

## O02 — Keep narrow OIDC access and flatten the secret layout

**Selected direction:** narrow Infisical OIDC plus flat top-level secrets. Folder depth and credential scope are separate choices. A flat path does not require an account-wide token.

**Verified in source:** `deploy.yml:53–65` uses EU Infisical OIDC, audience `visonaut-deploy`, a deployment identity and project from repository variables, `/ci/visonaut-deploy`, imports off, recursive reads off. `.github/workflows/README.md:18–32` specifies exact repository/ref/workflow claims and only two exported deployment credentials: Worker deployment and D1 migrations. These policy instructions are evidence of intended configuration, not proof of the live identity rules.

**Verified from live read-only metadata:**

- The application project configured in `.infisical.json:2` differs from the deployment project configured in the GitHub repository variable. Both use EU Infisical.
- The deployment project’s `prod` root has `ci`; `/ci` has `visonaut-deploy`.
- The application project’s `prod` root folder listing returned `billing`.
- Four metadata-only secret-list requests used `viewSecretValue=false` and disabled reference expansion/imports. They returned HTTP 403. No secret values were requested or printed. Therefore secret-key inventory, actual bucket credentials, imports, and live OIDC permission rules remain unverified. Folder visibility does not prove secret-read access.

**Recommended concrete layout:** put the existing deployment credentials directly in `/` of the already dedicated deployment project/environment. Point the action and identity permission to `/`. Keep import and recursion disabled. Put any still-needed bucket credential at the top level of its intended project/environment, with a name that describes the credential. Do not add one R2 credential per bucket unless some client actually needs that separate capability.

```yaml
# Dedicated deployment project, prod environment:
secret-path: /
include-imports: "false"
recursive: "false"
# Root keys: CLOUDFLARE_API_TOKEN, CLOUDFLARE_MIGRATIONS_API_TOKEN
```

**Bucket detail:** `apps/web/wrangler.jsonc:43–50,122–129` and `apps/compare/wrangler.jsonc:46–49,112–115` bind the images and quarantine buckets directly. Bucket names are ordinary configuration. These Worker operations do not need S3 access-key secrets per bucket. The latest checkout has retired backup bucket bindings. Do not describe unobserved Infisical entries as confirmed stale bucket secrets, and do not move bucket names into Infisical merely because this decision mentions buckets.

**Migration and counterexample:** first inventory names and consumers without values under an authorized metadata route. Copy only needed credentials to the intended root, update the identity path and workflow together, verify one deployment, then remove old folder entries. If the destination root contains application runtime secrets or unrelated credentials, granting unrestricted root read would expand access. Keep the dedicated deployment project or key-scoped permission; do not merge all project secrets just to flatten folders. Existing credentials can retain the same values and permissions. Rotation is not inherently required by a path change.

Primary reference: [Infisical secret-list API](https://infisical.com/docs/api-reference/endpoints/secrets/list) documents the `viewSecretValue=false` option. No assertion about live secret names or OIDC grants is supported beyond the metadata above.

## A06 — Use ordinary CI artifacts for capture transfer

**Selected direction:** ordinary GitHub Actions artifacts. Do not retain or preselect encrypted packs. The user accepts the visibility of these test captures and wants the transfer code removed.

**Recommended wording:** “Upload capture files as ordinary GitHub Actions artifacts for one day. Let Submit validate the captures from the same workflow run and then upload them to Visonaut. Remove the transfer encryption key and its exchange endpoints.”

**Verified exposure and retention:** Ariakit is a public repository. GitHub permits signed-in users with repository read access to download its workflow artifacts. Thus ordinary captures in this public repository are available to signed-in readers, not only maintainers. This is the selected policy; it is not an allegation that secrets are present in screenshots. Artifact expiry limits GitHub storage time but does not remove copies a reader has downloaded. Source currently sets transfer retention to **one day**, diagnostic test-result retention to **seven days**, and receipt retention to **seven days**. These are explicit workflow settings, not GitHub’s default.

Evidence: current Ariakit `.github/workflows/app.yml:208–217` encrypts and uploads captures; `:219–226` uploads `app/test-results` on non-cancelled runs for seven days; `:228–270` gives only Submit the upload OIDC permission and uses a trusted toolchain; `:272–278` uploads receipts. Current `app/playwright.config.ts:140–141` emits screenshots on failure and traces on first retry. I did not download live artifact contents. I did not verify that every capture attachment is written into `test-results`; Playwright buffer attachments do not establish that claim.

```yaml
- uses: actions/upload-artifact@v7
  with:
    name: visonaut-captures-${{ runner.os }}
    path: ${{ runner.temp }}/visonaut/
    if-no-files-found: error
    retention-days: 1
```

This replaces the encrypt step and encrypted upload. Keep each shard in a separate artifact/directory. Submit should download the exact expected names from the current workflow run and fail if a shard is missing, duplicated, stale, or malformed. Avoid merging arbitrary wildcard artifacts into one directory. The CLI spelling for reading plain directories can be settled with the integration design; it need not preserve a `.enc` wrapper.

**Keep the small checks that establish trust:** run ID, attempt, tested SHA, required shards, manifest/image digests, approved profile, file paths, sizes, and counts. Keep the trusted Submit job’s identity check. Encryption hides bytes; it does not prove that candidate-rendered data is correct, and removing it does not require candidate jobs to receive publishing authority. This choice changes capture confidentiality, not who can approve a review.

**Remove when all callers use plain artifacts:** `packages/playwright/ci/transfer.mjs`; the encryption/decryption calls in `ci/runner.mjs:201,223–247`; CLI private-key fetch and decryption in `packages/cli/src/bundle-submit.ts:18–55,76–82`; `apps/web/src/api/transfer-key.ts`; `/v1/transfer/public-key` and `/v1/transfer/private-key` routes in `api/index.ts:124–129`; `VISONAUT_TRANSFER_PRIVATE_KEY` in runtime/wrangler bindings; encryption exports/types/tests and the README prohibition on plaintext screenshots. The now-unused `transfer_key_redemptions` writes/table can be retired by a new migration after compatibility is no longer needed. Existing applied migration history remains intact.

**One side effect must move:** `transfer-key.ts:139–143` starts the signed attempt’s check before lengthy upload work. Preserve that useful state transition at Submit initialization before deleting the key endpoint. `bindSignedJob`, manifest validation, and `rebindManifest` still serve signed submission and should not be removed merely because they are near decryption calls.

**Migration and test:** accept plain artifacts in a coordinated CLI/workflow update; run a normal PR and retry; reject a missing shard and a changed manifest; check the pending/completed check lifecycle. After the old path has no consumers, remove its private key and endpoints. No second storage service or private R2 transfer bucket is required. A future private-capture product could use different artifact access, but it is outside this selected Ariakit policy.

Primary reference: [GitHub artifact download permissions and expiry](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts). Current public workflow: [Ariakit app workflow](https://github.com/ariakit/ariakit/blob/main/.github/workflows/app.yml).
