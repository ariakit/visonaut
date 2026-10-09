# CI, deployment, and release

Pull requests and manual CI use `checks.yml`. A new push to a pull request cancels the older checks run of that pull request. Checks run from other events, including the call from `deploy.yml`, are never canceled. `deploy.yml` owns normal main verification: it calls these checks once, builds with `CLOUDFLARE_ENV=production`, verifies the exact current main commit, applies compatible D1 migrations, then uses standard Wrangler deploy for the comparator and web Worker. Package releases use the standard Changesets flow. Public package smoke tests remain in ordinary CI. Required checks retain their names. Container diagnostics run on demand and do not enter normal CI.

Browser serves the tracked Vite fixture source and does not need a preceding production build. Keep the Build job's full build and installed package smoke check, and the test-shard builds required by adapter and binary coverage. The [D04/D11 measurement record](../../docs/history/evidence/issue-204-ci/README.md) contains the dated setup evidence, prepared full-rerun trial, and remaining external holds. No before/after CI improvement is claimed.

The web build selects its Cloudflare environment before deployment. Its generated production configuration must name `visonaut` and production. Runtime authentication and GitHub App secrets stay in Cloudflare. The runner loads only the two deployment keys. Deployment runs are serialized and cannot cancel an update. Worker rollback does not undo D1 migrations or resource changes. Manual `migrate` applies only production D1 migrations with independent credentials and fence acknowledgments. The temporary `inspect` and `convert` actions are removed; their [historical instructions](../../docs/history/operations/simplification-cutover.md#one-time-conversion-runner) remain available.

## Flat deployment credentials

Deployment reads the dedicated Infisical project, environment `prod`, path `/`. Do not use the workspace's development project. Imports and recursive reads are disabled. The project supplies only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_MIGRATIONS_API_TOKEN`, each requested by its explicit name. The scope guard pins the project, identity, and `prod` environment. Preserve the reviewed role, grants, and exact OIDC claims. Read key names rather than values when checking inventory.

Use these GitHub variables:

| Variable                       | Meaning                      |
| ------------------------------ | ---------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`        | Exact Visonaut account       |
| `INFISICAL_PROJECT_ID`         | Dedicated deployment project |
| `INFISICAL_ENVIRONMENT`        | `prod`                       |
| `INFISICAL_DEPLOY_IDENTITY_ID` | Narrow deployment identity   |

Bind EU Infisical OIDC to issuer `https://token.actions.githubusercontent.com`, audience `visonaut-deploy`, subject `repo:ariakit@40200111/visonaut@1380751023:ref:refs/heads/main`, and these exact claims:

```json
{
  "repository_id": "1380751023",
  "ref": "refs/heads/main",
  "workflow_ref": "ariakit/visonaut/.github/workflows/deploy.yml@refs/heads/main"
}
```

The direct deploy job has no GitHub environment. Do not require `job_workflow_ref` for it. Keep independent deployment and D1 migration credentials. Standard Wrangler deploy also reconciles declared routes, queues, cron, and observability, so its credential needs the narrow additional permissions for those declared resources. Read back these resources after an isolated test deployment before production. The workflow checks the live codec backend and refuses Container class retirement without an exact-namespace, zero-active-request receipt less than one hour old. Set `VISONAUT_CONTAINER_RETIREMENT_VERIFIED` to the checked JSON `{ "namespaceId": "...", "activeRequests": 0, "observedAt": 0 }` only after the actual drain observation. Once the live binding is gone, the gate needs no retirement receipt. Keep the migration credential limited to the production D1 database. R2 Worker bindings need no R2 access key.

See [Infisical OIDC](https://github.com/Infisical/secrets-action), [GitHub identity claims](https://docs.github.com/en/actions/reference/security/oidc), and [Wrangler deployment](https://developers.cloudflare.com/workers/wrangler/commands/).

## One App receiver

Production receives original signed GitHub events at `https://visonaut.com/v1/webhooks`. Preview has synthetic read-only fixtures, no GitHub login, no live API writes, and no scheduled GitHub work. Its source configuration has no D1, R2, comparator service, or queue bindings. Build with `CLOUDFLARE_ENV` unset and use manual `preview-web` with target `preview` to deploy the fixture site. There is no preview schema migration or hosted preview comparator action. The legacy router is retired. Keep the approved preview and receiver evidence limits in the [current contract](../../docs/current-contract.md#publication-and-remaining-cutover); do not turn unverified hosted probes into completed checks or new prerequisites.

GitHub does not automatically redeliver a failed webhook. The production scheduler uses an App JWT to inspect one bounded delivery page per recovery run. Missing local receipts get bounded redelivery requests; received events use existing D1 reconciliation. Persistent failures appear in Visonaut's operations alerts. Operators can inspect the delivery GUID in App settings, fix the receiver, request manual redelivery, and verify the D1 receipt. See [GitHub App delivery APIs](https://docs.github.com/en/rest/apps/webhooks).

The selected integration pins native `.github/workflows/ci.yml` and `.github/workflows/app.yml`. Only successful native `Plan CI` with `app=false` runs `visonaut submit --no-visual` as the last Plan step. For `app=true`, `App / Visual Capture (linux)` and `App / Visual Capture (safari)` feed `App / Visual Submit`, which verifies successful native Plan and complete capture evidence. The visual path has no separate signed Plan report. Missing or failed Plan never succeeds. Use ordinary one-day artifacts. Normal visual and signed no-visual consumer proof is complete. The required Visonaut check from App `5028451` is active beside Gate. The matching caller-pin cutover and polling removal are complete; native Gate still verifies other selected jobs. [PR #205](https://github.com/ariakit/visonaut/pull/205) published the canonical docs and production readiness marker on 2026-10-02. Its normal deployment and Cloudflare configuration readback are complete; see the [dated receipt](../../docs/history/simplification-implementation.md#pr-205-completion) and the [pinned issue #1 notice](https://github.com/ariakit/visonaut/issues/1#issuecomment-5958332349). Direct production `/health` HTTP proof remains unverified because the browser blocked that URL; it is not a new launch gate. The marker changes the health label and does not fence writes.

## npm publication

`release.yml` runs on main pushes and manual retry dispatches. The pinned Changesets v2 actions select versioning, publication, or no work. Pending changesets create or update one `Version packages` PR. Changesets owns the version plan, dependency updates, changelogs, and changeset consumption. Private workspaces have `privatePackages: { version: true, tag: false }` and remain `private: true`, so they get versions and changelogs without npm publication or private Git tags. The web workspace starts at `0.1.0`.

After the version PR merges, Changesets selects unpublished public versions, builds the public packages, and packs its native publish plan in a job with read-only GitHub access. The separate publish job uses that packed artifact in the existing `npm` environment. Only this job has `id-token: write`. It requests provenance through `NPM_CONFIG_PROVENANCE=true`, has read-only GitHub access, and creates no GitHub releases or remote tags. Changesets skips versions that npm already has. A run with no pending changesets or unpublished versions does no release work.

Version PR preparation uses the existing `ARIAKIT_CI_APP_CLIENT_ID` variable and `ARIAKIT_CI_APP_PRIVATE_KEY` secret. Its temporary App token requests only contents and pull-request writes for this repository. It has no npm OIDC permission. Pass the token through the version action's `github-token` input. Publication has no App token or pull-request write permission.

Automatic publication needs no release flag or source receipt. The workflow serializes releases and uses the triggering main checkout. The old `VISONAUT_AUTOMATIC_PUBLICATION` and `VISONAUT_RELEASE_COMMIT` variables are unused and can be removed from repository settings. A manual dispatch retries the same standard flow for the selected main commit; it does not override package selection or npm tags.

For a deliberate `next` release, enter Changesets prerelease mode on a reviewed branch, commit `.changeset/pre.json` with the public package changesets, and merge it to main. The standard version PR records prerelease versions. After its reviewed merge, the same workflow publishes them under `next`. To return to stable releases, run `pre exit` on a reviewed branch and merge the change; review and merge the resulting stable version PR. Both transitions use ordinary PR review and CI.

```sh
pnpm changeset pre enter next
# Commit and merge the prerelease state with the intended changesets.
# Review and merge the generated version PR.
pnpm changeset pre exit
# Commit and merge the exit state, then the stable version PR.
```

Consume the existing private changeset backlog through the generated version PR after this configuration merges. Do not delete those changesets or write changelog entries by hand. Adding the starting web version is not backlog consumption.

CLI `visonaut@0.5.3` is published under `latest` from [`43a6591`](https://github.com/ariakit/visonaut/commit/43a6591910a715eea9d74fdaadb274ad080b746b). [Release 37004515271, attempt 1](https://github.com/ariakit/visonaut/actions/runs/37004515271/attempts/1) passed. Public package contents, integrity, signatures, source, and publisher provenance are verified. Adapter `@visonaut/playwright@0.4.0` remains unchanged. The earlier CLI `0.5.2` consumer run has successful capture and Submit, the recovered App check and Gate, and a verified normal export. Service PR #200 is deployed, and production settings readback showed the exact CLI `0.5.3` workflow pins. The matching consumer update is published. Its normal CLI `0.5.3` Plan, captures, Submit, App check, and Gate passed. PR #7703 received eligible approval and merged as [`394aec5`](https://github.com/ariakit/ariakit/commit/394aec5cb6debc18dd88d28268b9c4bad9d4726c), which completes main adoption. Normal signed no-visual proof on PR #7552 and App-specific required-check readback are complete. The matching service caller-pin deployment is verified, and PR #7708 has adopted polling removal and the contributor guide on main. PR #205 completed readiness-marker deployment and readback. Exact transfer-key retirement completed on 2026-10-02 after confirmation and absence readback; see the [retirement receipt](../../docs/history/simplification-implementation.md#transfer-key-retirement-on-2026-10-02). See the [implementation checkpoint](../../docs/history/simplification-implementation.md#current-handoff-checkpoint) for receipt scope and remaining work.

Each package's npm trusted publisher must name owner `ariakit`, repository `visonaut`, workflow `release.yml`, and environment `npm`. No npm token belongs in GitHub. Installed CLI and adapter smoke checks remain in the ordinary CI Build job. The release workflow does not repeat CI or compare existing registry contents, source receipts, or publisher attestations. The `package-attestations.mjs` helper remains available for explicit operations audits.

See [Changesets automation](https://changesets.dev/guide/automating), [private package configuration](https://changesets.dev/guide/config#privatepackages), [prereleases](https://changesets.dev/guide/prereleases), and [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
