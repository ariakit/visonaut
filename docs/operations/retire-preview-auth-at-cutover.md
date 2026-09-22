# Retire nonproduction auth at launch cutover

This is a prepared runbook. It has not been executed. Keep preview and diagnostics active until all readiness evidence is complete.

The selected launch topology retains authenticated access only in production. One GitHub App has one webhook URL. The preview and diagnostics Workers use that same App but separate D1 session databases. A production OAuth-revocation webhook cannot delete sessions in the other databases. Current repository permission checks do not detect OAuth grant revocation because they use an installation token. Better Auth can renew a surviving session each day. This is a revocation delivery gap, not acceptance of a production cookie by a preview database.

Do not add fan-out or a second App during this cutover. A future authenticated preview requires a separate App or a verified durable revocation-delivery mechanism before its auth routes can be enabled.

## Targets

| Environment | Worker              | D1 database ID                       | Current origin                                  |
| ----------- | ------------------- | ------------------------------------ | ----------------------------------------------- |
| Preview     | ariviso-preview     | bc1093fa-c1d8-4da8-9224-dc40f988fe12 | https://ariviso-preview.ariakit.workers.dev     |
| Diagnostics | ariviso-diagnostics | f7030b0b-7697-49db-a7f8-63f92dea5b5d | https://ariviso-diagnostics.ariakit.workers.dev |

Cloudflare account: `b04f3af3f0f10a6b9481bc23ba974eca`. Do not apply cleanup SQL or delete bindings in production.

## Close public access first

At cutover, set both `workers_dev: false` and `preview_urls: false` for the two retired Workers. Persist the values in `apps/web/wrangler.jsonc`, with explicit `workers_dev: true` in `env.production` so the root preview setting cannot disable the production workers.dev origin. Set `env.diagnostics.workers_dev: false` explicitly. Keep production's intended custom-domain/routes configuration unchanged.

Disable the live routes using the authenticated Cloudflare API or the reviewed deployment configuration. The direct API operation for each retired Worker is:

```http
POST /accounts/b04f3af3f0f10a6b9481bc23ba974eca/workers/scripts/ariviso-preview/subdomain
Content-Type: application/json

{"enabled":false,"previews_enabled":false}
```

Repeat with `ariviso-diagnostics`. Credentials must come from the existing approved secret mechanism; do not put token values in commands, logs, or this runbook.

Verify the matching GET endpoint returns both fields false. Confirm neither Worker has a custom domain, zone route, or reachable inbound service binding. The current source config has no custom domains/routes and only an outbound COMPARATOR binding. An out-of-band route must be removed or disabled before access is considered closed. Disabling only workers.dev is insufficient if another route exists.

Cloudflare warns that a later Wrangler deploy can re-enable workers.dev unless the committed config also disables it. Both the live route and config changes are required.

## Revoke local sessions and pending sign-ins

Apply `retire-preview-auth.sql` to the preview database and diagnostics database only. The SQL is idempotent and retains users and audit history. It deletes Better Auth sessions, OAuth verification/state records, and local review sessions, and removes encrypted provider tokens and their expiry data. Retain the databases and evidence buckets.

Example commands from the repository root, after verifying the named DB IDs above:

```sh
pnpm exec wrangler d1 execute ariviso-preview --config apps/web/wrangler.jsonc --remote --file docs/operations/retire-preview-auth.sql
pnpm exec wrangler d1 execute ariviso-diagnostics --config apps/web/wrangler.jsonc --env diagnostics --remote --file docs/operations/retire-preview-auth.sql
```

Remove `BETTER_AUTH_SECRET` and `GITHUB_CLIENT_SECRET` bindings from each retired Worker, and mark the preview/diagnostics Infisical environment as retired so normal setup cannot silently restore them. Delete only the environment bindings; do not revoke the shared App client secret at GitHub, because production still uses that App. Preserve any secret recovery material according to the approved backup policy.

The exact binding-removal commands are:

```sh
pnpm exec wrangler secret delete BETTER_AUTH_SECRET --name ariviso-preview --config apps/web/wrangler.jsonc
pnpm exec wrangler secret delete GITHUB_CLIENT_SECRET --name ariviso-preview --config apps/web/wrangler.jsonc
pnpm exec wrangler secret delete BETTER_AUTH_SECRET --name ariviso-diagnostics --config apps/web/wrangler.jsonc --env diagnostics
pnpm exec wrangler secret delete GITHUB_CLIENT_SECRET --name ariviso-diagnostics --config apps/web/wrangler.jsonc --env diagnostics
```

In current runtime code, absence of either binding makes `authConfiguration()` throw. `/api/auth/*`, `/api/me`, and API bindings fail closed with 503. This is a secondary barrier: removing a secret alone is not the selected disable mechanism because `/health`, static assets, and parts of the rendered login shell do not need auth configuration. The primary barrier is disabling all public routes. `ARIVISO_LAUNCH_ENABLED=false` only changes health display and is not an auth kill switch.

After in-flight requests settle, repeat the SQL cleanup and verify zero sessions, verification records, review sessions, and non-null GitHub tokens. Repeat these checks before any future preview reactivation.

## Probes and evidence

Use the session cookie jars and bearer tokens saved securely during E02; never print them. Probe each retired origin with no credential, its old cookie, its old bearer session token, and the production cookie. Test `/`, `/login`, `/api/auth/get-session`, `/api/auth/sign-in/social`, `/api/auth/callback/github`, `/api/me`, `/api/runs`, and a known private review URL. The public route must be unavailable, with no application success response or OAuth redirect. Do not treat the old login shell alone as proof of access; inspect the HTTP status and request destination. Test each previously recorded version-preview URL too.

Read only aggregate database checks after cleanup:

```sql
SELECT count(*) AS sessions FROM session;
SELECT count(*) AS verification_records FROM verification;
SELECT count(*) AS review_sessions FROM ingest_review_sessions;
SELECT count(*) AS retained_provider_tokens FROM account
WHERE providerId='github' AND
(accessToken IS NOT NULL OR refreshToken IS NOT NULL OR idToken IS NOT NULL);
```

All four counts must be 0. Record only route flags, response status codes, database counts, and deployment/version identifiers in evidence. Do not retain credentials in probe output.

Set the GitHub App's single active webhook URL to production and verify one real OAuth revocation removes the production session and prevents its next private read and mutation. Use an isolated test account/session if available. The local webhook tests prove handler behavior; this final test proves delivery to the retained auth environment. Verify production login, current-permission reads, and session renewal still work after the cutover.

Keep the public synthetic fixture history and private evidence storage as required, but do not claim retained preview/diagnostic auth support after launch. Re-enabling either requires a new revocation-topology review and fresh isolation evidence.

References: [GitHub App webhook delivery](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps), [OAuth revocation event](https://docs.github.com/en/webhooks/webhook-events-and-payloads#github_app_authorization), [disable workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [Cloudflare subdomain API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/).
