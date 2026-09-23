# Security

This private package owns the authentication and GitHub boundaries. Public client packages must not import it.

Construct Better Auth inside each Worker request. Use separate D1 databases, OAuth credentials, capability keys, webhook secrets, and Better Auth secrets for production and preview. Apply `migrations/0001_auth.sql` before the first request. The schema was generated with Better Auth 1.7.5.

```ts
const auth = createAuth({
  database: env.DB,
  origin: env.APP_ORIGIN,
  environment: "preview",
  secret: env.BETTER_AUTH_SECRET,
  githubClientId: env.GITHUB_CLIENT_ID,
  githubClientSecret: env.GITHUB_CLIENT_SECRET,
});
return auth.handler(request);
```

Call `requireMaintainer` for every protected read and write. It reads the live D1 session, resolves the numeric GitHub account ID, and checks current repository permission with an installation token. Forward its `sessionHeaders` on the response to preserve cookie renewal. Do not put those headers in JSON. Apply `requireSameOrigin` before cookie-authenticated mutations. Apply `securePrivateResponse` to all private metadata and app responses. Public validated images use their separate image response policy.

GitHub App credentials and user OAuth credentials have separate code paths. App private keys must use PKCS8 PEM. `createGitHubClient` restricts requests to GitHub's API host and obtains a token limited to the configured repository. Required repository permissions are Metadata read, Actions read, Checks write, Pull requests read, and Contents read. Merge-group webhooks also require Merge queues read. GitHub sign-in requires the account Email addresses read permission for private email addresses. Named custom roles use the permission endpoint's base permission; its `write` result includes maintain access.

The App client pins REST API `2022-11-28` because OIDC, lineage, and stale-PR webhook checks use `merge_commit_sha`. API `2026-03-10` [removes that field from all PR responses](https://docs.github.com/en/rest/about-the-rest-api/breaking-changes#version-2026-03-10). GitHub [supports the pinned version through March 10, 2028](https://docs.github.com/en/rest/about-the-rest-api/api-versions#supported-api-versions), consistent with its minimum 24-month support window after the next release. Migrate those checks together before that date; do not change the header alone.

`verifyGitHubOidc` requires an immutable trusted reusable workflow reference and SHA, the configured plan digest, the exact signed job check ID, and current GitHub workflow metadata. Pull requests must be from the same repository, target main, and have a current writer as author. The actual tested SHA must be the current two-parent PR merge commit. Merge groups need stored metadata from a verified `checks_requested` webhook. `loadTrustedMainFile` resolves main to a commit before fetching the plan. Never construct trusted configuration from the upload body.

Ingest capabilities and upload tickets expire within 15 minutes. They have different audiences from app sessions and from each other. Their verification does not replace the service's active-attempt check, manifest conflict checks, image validation, byte accounting, or sealed-run guard. Only ingest endpoints accept ingest capabilities. Private status and review endpoints use `requireMaintainer`.

`verifyGitHubWebhook` checks the signature over the original bounded bytes. Persist a verified event with `persistWebhook` before acknowledging receipt. Pending payloads remain available for reconciliation. Domain handlers must be idempotent and set `processed_at` in the same transaction as their domain changes. `revokeGitHubAuthorization` provides this behavior for OAuth revocation.

`ensureGitHubCheck` creates or finds a check for one tested SHA and stable external identity. Run it under the service's persistent per-check lock. `sendGitHubCheck` is the transport callback for the durable status outbox. Pass the outbox's `isCurrent` callback; a stale intent returns `not-sent` before PATCH. A thrown transport error remains ambiguous. Do not release its lock based on a timeout or observed remote status alone. The outbox must retain a newer desired revision when an older response arrives.

The tests cover 43 cases with Vitest 5.0.1, TypeScript 6.0.2, Better Auth 1.7.5, jose 6.2.12, and the Miniflare version pinned by Wrangler 4.136.1. Seven tests use real local D1 bindings. These checks do not substitute for deployed login, private-email OAuth, aborted Worker requests, GitHub endpoint probes, or production evidence E02/E06.

References: [Better Auth options](https://better-auth.com/docs/reference/options), [GitHub authentication](https://better-auth.com/docs/authentication/github), [current repository permissions](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user), [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc), and [Checks API](https://docs.github.com/en/rest/checks/runs).
