# Retire nonproduction auth if an environment is closed

This is a contingency runbook. It has not been executed. Keep preview and diagnostics active through readiness work. The launch contract requires isolated sessions and verified revocation delivery, not retirement of these environments.

The GitHub App sends signed events to `hooks.visonaut.com`, which forwards authorization revocations and installation suspension or deletion to the production, preview, and diagnostics Workers. Each Worker has a separate D1 session database and handles revocation locally. Verify this delivery and separate-session behavior before launch. Current repository permission checks use an installation token and do not by themselves detect OAuth grant revocation.

If preview or diagnostics is deliberately closed later, keep the webhook gateway in place for the remaining environments. Do not point the App webhook directly at one Worker while another environment still accepts sessions.

## Remove the retired webhook destination first

Before changing routes, sessions, or secrets, make a reviewed gateway change for each environment being retired. Remove that destination from every branch of `routeWebhook()` in `apps/webhook/src/index.ts`: App-wide events, `installation_repositories`, and repository-specific events. Remove its service binding and origin from `apps/webhook/wrangler.jsonc` and the corresponding runtime binding. Keep all remaining destinations in each branch. The gateway must still return 503 when any **remaining** destination fails.

Test a signed App-wide event, a signed event for each installed repository, and an `installation_repositories` event that includes the retired repository. Assert that the retired Worker receives no requests and every remaining destination receives its applicable request. Deploy the revised gateway while all Workers are still healthy. Replay a real GitHub App delivery from the GitHub delivery log and verify HTTP 202, the retained Workers' receipt records, and no retired-Worker request. Keep the GitHub App webhook URL at `https://hooks.visonaut.com/webhooks/github`.

Do not remove the retired Worker's auth secrets until this deployed gateway check passes. If it fails, restore gateway forwarding and resolve the failure while the retired Worker can still accept events. Repeat the HTTP 202 and receipt check after the steps below; stop retirement if GitHub reports a failed delivery.

## Targets

| Environment | Worker               | D1 database ID                       | Current origin                   |
| ----------- | -------------------- | ------------------------------------ | -------------------------------- |
| Preview     | visonaut-preview     | 395b539c-c423-4ce4-887c-a5792792a63b | https://preview.visonaut.com     |
| Diagnostics | visonaut-diagnostics | 6d68da10-2754-433f-99d1-fdfc080dfe11 | https://diagnostics.visonaut.com |

Cloudflare account: `b04f3af3f0f10a6b9481bc23ba974eca`. Do not apply cleanup SQL or delete bindings in production.

## Close public access first

When retiring an environment, set both `workers_dev: false` and `preview_urls: false` for that Worker. Persist the values in `apps/web/wrangler.jsonc`; set `workers_dev` explicitly in every remaining environment so the inherited root value cannot change it. Keep the production custom domain and routes unchanged.

Disable the live routes using the authenticated Cloudflare API or the reviewed deployment configuration. The direct API operation for each retired Worker is:

```http
POST /accounts/b04f3af3f0f10a6b9481bc23ba974eca/workers/scripts/visonaut-preview/subdomain
Content-Type: application/json

{"enabled":false,"previews_enabled":false}
```

Repeat with `visonaut-diagnostics` only if that environment is also being retired. Credentials must come from the existing approved secret mechanism; do not put token values in commands, logs, or this runbook.

Remove the retired Worker's `preview.visonaut.com` or `diagnostics.visonaut.com` custom-domain entry from `apps/web/wrangler.jsonc` and from the live Cloudflare Worker routes. Verify the matching subdomain GET endpoint returns both fields false, inspect the live custom-domain and zone-route lists, and confirm the retired hostname has no application response. Check for any out-of-band route or inbound service binding before considering access closed. The current source has both custom domains and outbound COMPARATOR bindings. Disabling only workers.dev leaves the custom domain reachable.

Cloudflare warns that a later Wrangler deploy can re-enable workers.dev unless the committed config also disables it. Both the live route and config changes are required.

## Revoke local sessions and pending sign-ins

Apply `retire-preview-auth.sql` only to the database of each environment being retired, never to production or an environment that remains active. The SQL is idempotent and retains users and audit history. It deletes Better Auth sessions, OAuth verification/state records, and local review sessions, and removes encrypted provider tokens and their expiry data. Retain the databases and evidence buckets.

Example commands from the repository root, after verifying the named DB IDs above:

```sh
pnpm exec wrangler d1 execute visonaut-preview --config apps/web/wrangler.jsonc --remote --file docs/operations/retire-preview-auth.sql
pnpm exec wrangler d1 execute visonaut-diagnostics --config apps/web/wrangler.jsonc --env diagnostics --remote --file docs/operations/retire-preview-auth.sql
```

Remove `BETTER_AUTH_SECRET` and `GITHUB_CLIENT_SECRET` bindings from each retired Worker, and mark its Infisical environment as retired so normal setup cannot silently restore them. Delete only that environment's bindings; do not revoke the shared App client secret at GitHub, because production still uses that App. Preserve any secret recovery material according to the approved backup policy.

The exact binding-removal commands are:

```sh
pnpm exec wrangler secret delete BETTER_AUTH_SECRET --name visonaut-preview --config apps/web/wrangler.jsonc
pnpm exec wrangler secret delete GITHUB_CLIENT_SECRET --name visonaut-preview --config apps/web/wrangler.jsonc
pnpm exec wrangler secret delete BETTER_AUTH_SECRET --name visonaut-diagnostics --config apps/web/wrangler.jsonc --env diagnostics
pnpm exec wrangler secret delete GITHUB_CLIENT_SECRET --name visonaut-diagnostics --config apps/web/wrangler.jsonc --env diagnostics
```

In current runtime code, absence of either binding makes `authConfiguration()` throw. `/api/auth/*`, `/api/me`, and API bindings fail closed with 503. This is a secondary barrier: removing a secret alone is not the selected disable mechanism because `/health`, static assets, and parts of the rendered login shell do not need auth configuration. The primary barrier is disabling all public routes. `VISONAUT_LAUNCH_ENABLED=false` only changes health display and is not an auth kill switch.

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

Keep the GitHub App webhook URL at `https://hooks.visonaut.com/webhooks/github`. Verify one real OAuth revocation removes sessions in every environment that remains authenticated and prevents the next private read and mutation. Use an isolated test account/session if available. The local webhook tests prove handler behavior; this final test proves delivery to the retained auth environments. Verify production login, current-permission reads, and session renewal still work after retirement.

Keep the public synthetic fixture history and private evidence storage as required. Do not claim authenticated access to an environment after retiring it. Re-enabling it requires a new revocation-topology review and fresh isolation evidence.

References: [GitHub App webhook delivery](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps), [OAuth revocation event](https://docs.github.com/en/webhooks/webhook-events-and-payloads#github_app_authorization), [disable workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [Cloudflare subdomain API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/).
