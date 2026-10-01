# Retire preview authentication

Run this cleanup after the reviewed preview fixture deployment and its readiness checks. Preview remains a public site with synthetic, read-only data. Retire its old local sessions and credentials after all prior authenticated handlers have drained. Preserve production authentication and its signed revocation delivery.

## Target

| Environment | Worker           | D1 database ID                       | Origin                       |
| ----------- | ---------------- | ------------------------------------ | ---------------------------- |
| Preview     | visonaut-preview | 395b539c-c423-4ce4-887c-a5792792a63b | https://preview.visonaut.com |

Cloudflare account: `b04f3af3f0f10a6b9481bc23ba974eca`. Verify the live Worker, account, and exact D1 binding before cleanup. Retain this preview database and its evidence buckets.

## Verify the fixture barrier and drain

Read back the successful `visonaut-preview` web Worker deployment, its version, 100% traffic, `VISONAUT_ENVIRONMENT=preview`, and the configured origin. In [server.ts](../../apps/web/src/server.ts), preview enters the fixture branch before authentication or live API dispatch. The configured origin serves synthetic fixtures. Other origins get 403, except the public health response. `/health` reports `environment:preview` and `fixtureMode:true`. `VISONAUT_LAUNCH_ENABLED=false` alone does not disable authentication.

The [fixture handler](../../apps/web/src/review/preview-fixtures.ts) returns 403 with `preview_fixtures_only` for auth, private-data, image, webhook, and mutation paths. It permits only the synthetic GET responses for `/api/runs`, `/api/runs/00000000-0000-4000-8000-000000000001`, and `/api/operations`. The rendered fixture site can remain available. Removing its public routes or deploying the former `apps/webhook` gateway is not part of this cleanup.

Confirm all old authenticated HTTP handlers, admitted OAuth callbacks, and prior attempts have drained before deleting records. The current fixture Worker does not run preview scheduled operations or queue work. Preserve the existing operational fences during cleanup. A fixture deployment receipt alone does not prove that every old invocation has ended.

## Revoke local sessions and pending sign-ins

Use the existing [retire-preview-auth.sql](retire-preview-auth.sql) on the exact preview database after the barrier and drain checks pass. The SQL file's public-route comment predates fixture mode. This procedure requires the verified fixture barrier and drain before applying the same cleanup. The SQL is idempotent. It adds retirement audit records, deletes Better Auth sessions, OAuth verification/state records, and local review sessions, and clears GitHub `accessToken`, `refreshToken`, `idToken`, `accessTokenExpiresAt`, and `refreshTokenExpiresAt` fields. It retains users, account identities, audit history, and application evidence.

From the repository root, after verifying the live database ID:

```sh
pnpm exec wrangler d1 execute visonaut-preview --config apps/web/wrangler.jsonc --remote --file docs/operations/retire-preview-auth.sql
```

This runbook requires removal of two preview authentication bindings: `BETTER_AUTH_SECRET` and `GITHUB_CLIENT_SECRET`. Remove only their preview Worker copies. Preserve recovery material under the approved backup policy. Retire their preview provisioning entries, if present, so normal setup cannot restore them. Verify the actual secret-store owner and path before changing provisioning metadata.

```sh
pnpm exec wrangler secret delete BETTER_AUTH_SECRET --name visonaut-preview --config apps/web/wrangler.jsonc
pnpm exec wrangler secret delete GITHUB_CLIENT_SECRET --name visonaut-preview --config apps/web/wrangler.jsonc
```

Verify absence through a current names-only listing. The old inventory also names `CAPABILITY_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, and `VISONAUT_TRANSFER_PRIVATE_KEY`. These are broader legacy credential candidates, not additional removals authorized by this two-binding procedure. Their removal needs a current consumer check and separate authorized scope. Do not revoke the shared App secret at GitHub or alter production bindings, routes, grants, or webhook delivery.

The fixture barrier returns 403 before `authConfiguration()` runs. Removing secrets does not change the public fixture site into an unavailable origin. Session and token deletion is destructive; a Worker rollback or re-added secret must not restore old sessions. Repeat the SQL after in-flight work has settled, then verify the final counts. Any future authenticated preview requires fresh sign-in and a new revocation-topology and isolation review.

## Readback and probes

Before cleanup, confirm the six required tables (`user`, `auth_audit`, `session`, `verification`, `ingest_review_sessions`, and `account`) and the referenced columns exist. Record aggregate user and account counts. After cleanup, verify the same counts remain and run:

```sql
SELECT count(*) AS sessions FROM session;
SELECT count(*) AS verification_records FROM verification;
SELECT count(*) AS review_sessions FROM ingest_review_sessions;
SELECT count(*) AS retained_provider_credentials FROM account
WHERE providerId='github' AND
(accessToken IS NOT NULL OR refreshToken IS NOT NULL OR idToken IS NOT NULL OR
 accessTokenExpiresAt IS NOT NULL OR refreshTokenExpiresAt IS NOT NULL);
SELECT count(*) AS foreign_key_violations FROM pragma_foreign_key_check;
```

All five counts must be 0. If execution stops between statements, inspect the counts and repeat the same idempotent cleanup. Do not infer completion from a command exit alone.

Use securely saved cookie jars and bearer tokens without printing them. Probe with no credential, an old preview cookie or bearer token, and the production cookie. Check auth session, sign-in, callback, `/api/me`, a known live-data URL, an image URL, and supported mutation paths. Require 403 with no OAuth redirect or private-data response. The three permitted GET paths must return synthetic data, independent of credentials. A public fixture response is not authenticated access. Check other recorded origins and version-preview URLs for origin denial, except `/health`.

Record only binding names, route flags, response statuses, aggregate database counts, and deployment/version identifiers. Keep credential values out of commands, logs, and evidence. Retain private evidence as required. This runbook does not authorize new resources, production changes, or a hosted diagnostic write.
