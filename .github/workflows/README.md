# CI, deployment, and release

Pull requests and manual CI use `checks.yml`. Main has one owner: `deploy.yml` calls these checks once, builds with `CLOUDFLARE_ENV=production`, verifies the exact current main commit, applies compatible D1 migrations, then uses standard Wrangler deploy for the comparator and web Worker. Required checks retain their names. Container diagnostics run on demand and do not enter normal CI.

The web build selects its Cloudflare environment before deployment. Its generated configuration must name `visonaut` and production. Runtime authentication and GitHub App secrets stay in Cloudflare. The runner loads only the two deployment keys. Deployment runs are serialized and cannot cancel an update. Worker rollback does not undo D1 migrations or resource changes.

## Flat deployment credentials

The intended Infisical target is the dedicated deployment project, environment `prod`, path `/`. Do not use the workspace's development project. Disable imports and recursive reads. The dedicated project must contain only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_MIGRATIONS_API_TOKEN`. The workflow requests each key by its explicit name. The scope guard pins the project, identity, and `prod` environment. Verify key names, current Viewer role, other project memberships, and exact OIDC claims before moving keys or enabling the workflow. Retain the reviewed role; the move must not broaden its grants. Do not retrieve values for the inventory.

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

Production receives original signed GitHub events at `https://visonaut.com/v1/webhooks`. Preview has synthetic read-only fixtures, no GitHub login, no live API writes, and no scheduled GitHub work. Disable preview authentication, retire every preview session, verify existing cookies cannot read private data, then remove its App credentials. Change the App webhook only after the production receiver is tested. Verify signed ping and authorization revocation before retiring `visonaut-webhook`.

GitHub does not automatically redeliver a failed webhook. The production scheduler uses an App JWT to inspect one bounded delivery page per recovery run. Missing local receipts get bounded redelivery requests; received events use existing D1 reconciliation. Persistent failures appear in Visonaut's operations alerts. Operators can inspect the delivery GUID in App settings, fix the receiver, request manual redelivery, and verify the D1 receipt. See [GitHub App delivery APIs](https://docs.github.com/en/rest/apps/webhooks).

App check success comes from the trusted Plan report for the exact run, attempt, and tested SHA. `app=false` produces explicit success. `app=true` stays pending through signed Submit, capture, and review. Missing or failed Plan never succeeds. The App-specific required check and removal of Ariakit Gate polling must change together. Preserve Gate for the other jobs.

## npm publication

The manual `release.yml` verifies main, repository identity, source readiness, all normal checks, installed package contents, and the requested `latest` or `next` tag. Set `VISONAUT_RELEASE_COMMIT` to the reviewed source SHA before dispatch and clear it after release. This is the sole publication path; no local release alias exists.

Changesets versions are reviewed in source. The job builds that checked checkout and runs:

```sh
node .github/workflows/scripts/packages.mjs preflight
pnpm exec changeset publish --tag "$VISONAUT_RELEASE_TAG" --no-git-tag
node .github/workflows/scripts/packages.mjs result
```

Every eligible unpublished public package publishes under one selected tag. There is no package selector. Changesets resolves dependency order. Preflight records a flat local receipt of every new version and partial publication from this checked source. An older version stays outside this source claim only when its published public file contents match the checked source; changed contents without a version change fail. Eligible versions with the wrong requested tag fail. The result checks every receipt version, tag, source commit, package integrity, and GitHub publisher identity through npm 11.20.0 signature auditing and its supported Sigstore verifier. No npm attestation or cryptography code is reimplemented. Temporary smoke-test archives do not promise the exact bytes that Changesets packs later.

Each package's npm trusted publisher must name owner `ariakit`, repository `visonaut`, workflow `release.yml`, and environment `npm`. No npm token belongs in GitHub. The job requests npm provenance through `NPM_CONFIG_PROVENANCE=true`. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [Changesets publish](https://changesets.dev/guide/cli).
