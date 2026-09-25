# CI, deployment, and release

`checks.yml` runs lint, types, build, three unit-test shards, browser tests, the native comparison Container, and release guards in separate jobs. Each test shard and the browser job build their own workspace dependencies so they can run in parallel. The final `Gate` job requires every check to pass and is the only required status check. The jobs use pinned Node 24.18.0 and pnpm 12.5.1 where needed. The build job audits the public packages and rejects unexpected files, unresolved internal imports, local runtime dependencies, and mismatched package metadata. The artifact `public-packages-<source SHA>` contains exactly `visonaut-<version>.tgz`, `visonaut-playwright-<version>.tgz`, and `manifest.json`. The manifest records the source commit, versions, byte counts, SHA-256 hashes, and npm integrity hashes. The artifact expires after seven days.

`deploy.yml` runs only for this repository's `main` branch. It runs the checks first, builds the production configuration, loads scoped deployment credentials through EU Infisical OIDC, applies D1 migrations, and deploys the comparator before the web Worker. It uploads each version, then deploys that exact version at 100%. Existing runtime secrets remain in Cloudflare. This workflow does not copy authentication, GitHub App, ingest, or backup secrets into the runner. Keep schema migrations compatible with the previous deployed version because a failed deployment can leave the new schema with the previous code. Deployment runs are serialized and are not cancelled during an update.

## Deployment identity

Set these GitHub repository variables:

| Variable                       | Value                                                    |
| ------------------------------ | -------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`        | The Cloudflare account that owns both production Workers |
| `INFISICAL_PROJECT_ID`         | The dedicated deployment-only project UUID               |
| `INFISICAL_ENVIRONMENT`        | `prod`                                                   |
| `INFISICAL_DEPLOY_IDENTITY_ID` | The deployment machine identity UUID                     |

Use the issuer `https://token.actions.githubusercontent.com`, audience `visonaut-deploy`, and immutable subject `repo:ariakit@40200111/visonaut@1380751023:ref:refs/heads/main`. This repository has immutable OIDC subjects enabled. Require all of these exact claims:

```json
{
  "repository_id": "1380751023",
  "ref": "refs/heads/main",
  "workflow_ref": "ariakit/visonaut/.github/workflows/deploy.yml@refs/heads/main"
}
```

The authenticated job runs directly in `deploy.yml`. Do not require `job_workflow_ref`, which applies to reusable workflow jobs. Do not add a GitHub environment to this job without changing the bound subject. Restrict the identity to read secrets in the `prod` environment at `/ci/visonaut-deploy`. Disable imports and recursive secret reads. The path must contain only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_MIGRATIONS_API_TOKEN`. Infisical masks the exported values; do not print environment variables or token responses. See the official [Infisical action](https://github.com/Infisical/secrets-action) and [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc).

Issue `CLOUDFLARE_API_TOKEN` with Editor access to only the seven Visonaut Workers: `visonaut`, `visonaut-compare`, `visonaut-webhook`, `visonaut-preview`, `visonaut-preview-compare`, `visonaut-diagnostics`, and `visonaut-diagnostics-compare`. The preceding deployment token remains scoped to the predecessor Workers and cannot deploy these. This workflow targets only the two production Workers and the App webhook router. Existing resource bindings do not require R2 or D1 write permissions. Creating resources, changing routes, or directly operating on a bound resource requires additional permissions. Provision those resources separately and keep their IDs explicit in the Wrangler configuration. See [Cloudflare Worker roles](https://developers.cloudflare.com/workers/authorization/workers/).

`CLOUDFLARE_MIGRATIONS_API_TOKEN` is a separate credential with D1 Write permission for the production database. The backup credential is authorized for export only and must not be used for deployment or migrations. The workflow uses the migration credential only for `wrangler d1 migrations apply DB --remote --env production`. Use the narrowest D1 resource scope Cloudflare permits. The deployment token does not need Workers Routes Write when existing routes remain unchanged.

Normal `wrangler deploy` queries and updates queue consumers, which the scoped Editor token cannot access. `deploy-version.mjs` checks current Worker resource targets, Durable Object namespace bindings, and cron expressions, then uses a temporary configuration with inherited queue bindings. It resolves the web entry point, base directory, and asset directory to absolute paths. It runs `wrangler versions upload` followed by `wrangler versions deploy <exact-version-id>@100 --yes`, and checks the resource targets, Durable Object namespace IDs, and unchanged cron records again. A mismatch requires a separate infrastructure update.

For a guarded `visonaut-preview` or `visonaut-diagnostics` web upload, provide both `CLOUDFLARE_API_TOKEN` and a separate `CLOUDFLARE_MIGRATIONS_API_TOKEN`. The script checks that the source Wrangler environment and built Worker name the same D1 database, applies remote migrations with the D1 token, and requires Wrangler to report no pending migrations before it uploads a version. The Worker token remains in use for binding checks and deployment. A missing token, changed database target, failed migration, or remaining migration stops the upload. Build with `CLOUDFLARE_ENV=diagnostics` for diagnostics; use the default preview build for preview. The production workflow already applies migrations before its guarded upload.

The version-only path cannot create a Durable Object class or deploy a Container image. Before the first production comparator version upload with `CODEC_CONTAINER`, provision it with a full `pnpm exec wrangler deploy --env production --config apps/compare/wrangler.jsonc` under the authorized Wrangler login, then verify the class binding, Container app, exact image digest, and queue settings. Do the same separately for preview. The environment flag remains `VISONAUT_CODEC_BACKEND=worker` until Container fallback readiness is measured. An image digest or Container application change also needs a full deploy and the same verification; a code-only version upload does not roll out the image. Keep the pinned image in the private Cloudflare registry for rollback. The CI token's seven-Worker Editor scope intentionally cannot make these infrastructure changes.

This path was tested on the predecessor diagnostics comparator with its scoped Editor token on 2026-09-22 and on `visonaut-preview-compare` with the replacement EU Infisical credential on 2026-09-23. The [preview receipt](../../docs/evidence/container-codec/hosted-queue.md) confirms that its Durable Object namespace, resource bindings, and cron survived the upload. It uses Wrangler 4.136.1's experimental `unsafe.bindings` representation; keep Wrangler pinned and repeat the test before upgrading. Queue consumer settings, routes, and observability remain separately provisioned. The token cannot verify consumer batch, retry, concurrency, or dead-letter settings. Consumer resources target the Worker name and persist across version deployment. See [Worker versions](https://developers.cloudflare.com/workers/versions-and-deployments/) and [queue consumers](https://developers.cloudflare.com/api/resources/queues/subresources/consumers/methods/create/).

The App webhook points to `https://hooks.visonaut.com/webhooks/github`. That Worker verifies the signature and repository ID before forwarding the original signed body to the production and preview Workers for Ariakit events, or to diagnostics for synthetic-repository events. Preview does not create workflow-owned pre-run checks; production owns those checks. App-wide authorization and installation events reach all three. A failed downstream acknowledgment returns 503 so GitHub can retry the delivery.

The web build uses `CLOUDFLARE_ENV=production`. The [Vite plugin selects the environment at build time](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/), so the final web version upload uses its generated configuration. Setting this variable only on the deploy command does not select production.

## Ariakit client packages

The public `visonaut@0.3.2` and `@visonaut/playwright@0.3.1` packages are the versions pinned by Ariakit. Its capture workflow does not need a package-download credential. The [current release audit](../../docs/evidence/public-packages/current-release-20260925.md) records their public tarballs and provenance.

## npm publication

`release.yml` is manual and runs only from `main`. It repeats all checks, downloads the tarballs from that same workflow run, verifies their source and hashes, and publishes those exact bytes. It never publishes from a push. Set the repository variable `VISONAUT_RELEASE_COMMIT` to the exact 40-character source SHA only after that version's checks and release decision. Clear the variable after the release. A different source commit requires new evidence and a new value. Production cutover has its own launch gates; a package release alone does not satisfy them.

The maintainer bootstraps each new npm package once, then configures its GitHub trusted publisher: owner `ariakit`, repository `visonaut`, workflow filename `release.yml`, and environment `npm`. Allow direct publishing for that publisher. No npm token is stored in GitHub. Both package manifests must use repository URL `https://github.com/ariakit/visonaut` and their correct package directory. The workflow reads versions from the audited tarballs; use Changesets to set versions before the readiness commit.

Choose the `latest` or `next` npm tag and either one package or `both` when dispatching the workflow. CI still packs and audits both tarballs from the exact source commit, but publication and registry integrity checks apply only to the selected package. Release `visonaut` before `@visonaut/playwright` when the adapter's locked CI runtime needs the new CLI version. The packages can have independent versions. An interrupted selected release can resume: a published version is skipped only if its integrity hash, provenance attestation, and requested tag match. A conflicting published version stops the workflow. An existing version with a different tag requires a separate authenticated tag change. The workflow does not create source releases or public Git tags.

The source repository is public. The trusted-publishing workflow requests npm provenance for each new release and checks the package bytes before publication. The historical `0.3.0` packages have valid registry signatures but no provenance attestations because their release disabled provenance; npm cannot add an attestation to an immutable published version. The current CLI and adapter have verified provenance, recorded in the [release audit](../../docs/evidence/public-packages/current-release-20260925.md). Verify each later release with `npm audit signatures`. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [viewing package provenance](https://docs.npmjs.com/viewing-package-provenance/).
