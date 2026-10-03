# CI, deployment, and release

Pull requests and manual CI use `checks.yml`. `deploy.yml` owns normal main verification: it calls these checks once, builds with `CLOUDFLARE_ENV=production`, verifies the exact current main commit, applies compatible D1 migrations, then uses standard Wrangler deploy for the comparator and web Worker. An eligible npm release independently verifies its exact source; other release runs skip these checks. Required checks retain their names. Container diagnostics run on demand and do not enter normal CI.

Browser serves the tracked Vite fixture source and does not need a preceding production build. Keep the Build job's full build and installed package smoke check, and the test-shard builds required by adapter and binary coverage. The [D04/D11 measurement record](../../docs/evidence/issue-204-ci/README.md) contains the dated setup evidence, prepared full-rerun trial, and remaining external holds. No before/after CI improvement is claimed.

The web build selects its Cloudflare environment before deployment. Its generated configuration must name `visonaut` and production. Runtime authentication and GitHub App secrets stay in Cloudflare. The runner loads only the two deployment keys. Deployment runs are serialized and cannot cancel an update. Worker rollback does not undo D1 migrations or resource changes. Manual `migrate` still applies the selected existing D1 migrations with independent credentials and fence acknowledgments. The temporary `inspect` and `convert` actions are removed; their [historical instructions](../../docs/operations/simplification-cutover.md#one-time-conversion-runner) remain available.

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

Production receives original signed GitHub events at `https://visonaut.com/v1/webhooks`. Preview has synthetic read-only fixtures, no GitHub login, no live API writes, and no scheduled GitHub work. The legacy router is retired. Keep the approved preview and receiver evidence limits in the [current contract](../../docs/current-contract.md#publication-and-remaining-cutover); do not turn unverified hosted probes into completed checks or new prerequisites.

GitHub does not automatically redeliver a failed webhook. The production scheduler uses an App JWT to inspect one bounded delivery page per recovery run. Missing local receipts get bounded redelivery requests; received events use existing D1 reconciliation. Persistent failures appear in Visonaut's operations alerts. Operators can inspect the delivery GUID in App settings, fix the receiver, request manual redelivery, and verify the D1 receipt. See [GitHub App delivery APIs](https://docs.github.com/en/rest/apps/webhooks).

The selected integration pins native `.github/workflows/ci.yml` and `.github/workflows/app.yml`. Only successful native `Plan CI` with `app=false` runs `visonaut submit --no-visual` as the last Plan step. For `app=true`, `App / Visual Capture (linux)` and `App / Visual Capture (safari)` feed `App / Visual Submit`, which verifies successful native Plan and complete capture evidence. The visual path has no separate signed Plan report. Missing or failed Plan never succeeds. Use ordinary one-day artifacts. Normal visual and signed no-visual consumer proof is complete. The required Visonaut check from App `5028451` is active beside Gate. The matching caller-pin cutover and polling removal are complete; native Gate still verifies other selected jobs. [PR #205](https://github.com/ariakit/visonaut/pull/205) published the canonical docs and production readiness marker on 2026-10-02. Its normal deployment and Cloudflare configuration readback are complete; see the [dated receipt](../../docs/simplification-implementation.md#pr-205-completion) and the [pinned issue #1 notice](https://github.com/ariakit/visonaut/issues/1#issuecomment-5958332349). Direct production `/health` HTTP proof remains unverified because the browser blocked that URL; it is not a new launch gate. The marker changes the health label and does not fence writes.

## npm publication

`release.yml` runs on main pushes. It reads the effective `changeset status` release plan before creating an App token. A nonempty version plan creates or updates one `Publish` version PR. Its reviewed merge makes the new package versions eligible for publication under `latest`. Changesets keeps its existing private-package version policy: pending private-only Changesets remain in source and do not block eligible public versions. A plan with public and private Changesets first creates the public version PR. Ordinary main changes skip publication when the public packages are unchanged. After all normal checks pass, a separate publication job checks out the original main SHA, builds and smoke-tests installed packages, checks registry eligibility, then publishes with npm OIDC. The current-main check refuses a superseded source.

Version PR preparation uses the existing `ARIAKIT_CI_APP_CLIENT_ID` variable and `ARIAKIT_CI_APP_PRIVATE_KEY` secret. Its temporary App token requests only contents and pull-request writes for this repository. It has no npm OIDC permission. Installing the Changesets bot does not provide an Actions token; the workflow needs these existing App credentials. Publication has no App token or pull-request write permission. Automatic publication uses `VISONAUT_AUTOMATIC_PUBLICATION=true`; setting the flag does not start a run. Any main push with no effective version plan and eligible checked versions can reach publication, so the trigger does not depend on a PR title.

Manual dispatch remains available for the requested `latest` or `next` tag. Set `VISONAUT_RELEASE_COMMIT` to the reviewed source SHA before dispatch and clear it after release. Automatic publication binds this value to the exact main SHA whose normal checks passed in the same run. This workflow is the sole publication path; no local release alias exists.

CLI `visonaut@0.5.3` is published under `latest` from [`43a6591`](https://github.com/ariakit/visonaut/commit/43a6591910a715eea9d74fdaadb274ad080b746b). [Release 37004515271, attempt 1](https://github.com/ariakit/visonaut/actions/runs/37004515271/attempts/1) passed. Public package contents, integrity, signatures, source, and publisher provenance are verified. Adapter `@visonaut/playwright@0.4.0` remains unchanged. The earlier CLI `0.5.2` consumer run has successful capture and Submit, the recovered App check and Gate, and a verified normal export. Service PR #200 is deployed, and production settings readback showed the exact CLI `0.5.3` workflow pins. The matching consumer update is published. Its normal CLI `0.5.3` Plan, captures, Submit, App check, and Gate passed. PR #7703 received eligible approval and merged as [`394aec5`](https://github.com/ariakit/ariakit/commit/394aec5cb6debc18dd88d28268b9c4bad9d4726c), which completes main adoption. Normal signed no-visual proof on PR #7552 and App-specific required-check readback are complete. The matching service caller-pin deployment is verified, and PR #7708 has adopted polling removal and the contributor guide on main. PR #205 completed readiness-marker deployment and readback. Exact transfer-key retirement completed on 2026-10-02 after confirmation and absence readback; see the [retirement receipt](../../docs/simplification-implementation.md#transfer-key-retirement-on-2026-10-02). See the [implementation checkpoint](../../docs/simplification-implementation.md#current-handoff-checkpoint) for receipt scope and remaining work.

Changesets versions are reviewed in source. The job builds that checked checkout and runs:

```sh
node .github/workflows/scripts/packages.mjs preflight
pnpm exec changeset publish --tag "$VISONAUT_RELEASE_TAG" --no-git-tag
node .github/workflows/scripts/packages.mjs result
```

Every eligible unpublished public package publishes under one selected tag. There is no package selector. Changesets resolves dependency order. Preflight records a flat local receipt of every new version and partial publication from this checked source. An older version stays outside this source claim only when its published public file contents match the checked source; changed contents without a version change fail. An automatic run with no eligible version skips publication; a manual run fails instead. A same-source rerun still verifies its already published versions. Eligible versions with the wrong requested tag fail. The result checks every receipt version, tag, source commit, package integrity, and GitHub publisher identity through npm 11.20.0 signature auditing and its supported Sigstore verifier. It accepts only main-push and manual-dispatch provenance from this release workflow. No npm attestation or cryptography code is reimplemented. Temporary smoke-test archives do not promise the exact bytes that Changesets packs later.

Each package's npm trusted publisher must name owner `ariakit`, repository `visonaut`, workflow `release.yml`, and environment `npm`. No npm token belongs in GitHub. The job requests npm provenance through `NPM_CONFIG_PROVENANCE=true`. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [Changesets publish](https://changesets.dev/guide/cli).
