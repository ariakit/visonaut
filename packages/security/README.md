# Security

This private package owns the authentication and GitHub boundaries. Public client packages must not import it.

Construct Better Auth inside each production Worker request. Production owns the live D1 database, OAuth credentials, capability keys, webhook secrets, and Better Auth secrets. Preview serves synthetic fixtures without authentication or backend bindings. Local tests use separate ephemeral storage and credentials. Apply `migrations/0001_auth.sql` before the first authenticated request. The schema was generated with Better Auth 1.7.5.

```ts
const auth = createAuth({
  database: env.DB,
  origin: env.APP_ORIGIN,
  environment: "production",
  secret: env.BETTER_AUTH_SECRET,
  githubClientId: env.GITHUB_CLIENT_ID,
  githubClientSecret: env.GITHUB_CLIENT_SECRET,
});
return auth.handler(request);
```

Call `requireMaintainer` for every protected read and write. It reads the live D1 session and resolves the linked numeric GitHub account ID on every request. Pass `access: "read"` for private GET and HEAD requests. A positive repository-write permission for that session, user, repository, and App configuration can be reused for at most 60 seconds. Denials are never cached. The default `access: "write"` checks current permission and numeric identity live, even after a cached read. Logout and expired or replaced sessions cannot use a cached permission. Forward `sessionHeaders` on the response to preserve cookie renewal. They hold only `Set-Cookie`. Do not put those headers in JSON. Apply `requireSameOrigin` before cookie-authenticated mutations. Apply `securePrivateResponse` to all private metadata and app responses. Public validated images use their separate image response policy.

```ts
await requireMaintainer({ request, auth, database, github, access: "read" });
await requireMaintainer({ request, auth, database, github, access: "write" });
```

Only decision submissions at `POST /api/comparisons/:id/commands` use `access: "review"`. These requests can reuse a successful permission check for at most 10 seconds from the start of that check. Cache hits do not extend this interval. This permits up to 10 seconds of delay before a repository permission removal blocks another decision. Live session and linked-account checks still run for every submission. Session creation, Undo, promotion, and all other writes use the default live check. A failed live check removes the cached grant; there is no fallback to an expired grant when GitHub is unavailable.

`createGitHubClient` reuses only resolved installation-token bytes until their expiry, with a 30-second safety margin. The cache is bounded and isolated by the exact App key, installation, repository, and transport. Pending token requests stay within the current request's client. A rejected token is removed; a failed mutation is not retried.

`requireSessionCredential` refuses a request with no session cookie and no bearer token, with no I/O. Call it before the first read and before `createAuth`. It reads only the two headers and checks no value, so `requireMaintainer` must still run for each request that passes.

GitHub App credentials and user OAuth credentials have separate code paths. App private keys must use PKCS8 PEM. `createGitHubClient` restricts requests to GitHub's API host and obtains a token limited to the configured repository. Required repository permissions are Metadata read, Actions read, Checks write, Pull requests read, and Contents read. Merge-group webhooks also require Merge queues read. GitHub sign-in requires the account Email addresses read permission for private email addresses. Named custom roles use the permission endpoint's base permission; its `write` result includes maintain access.

The App client pins REST API `2022-11-28` because OIDC, lineage, and stale-PR webhook checks use `merge_commit_sha`. API `2026-03-10` [removes that field from all PR responses](https://docs.github.com/en/rest/about-the-rest-api/breaking-changes#version-2026-03-10). GitHub [supports the pinned version through March 10, 2028](https://docs.github.com/en/rest/about-the-rest-api/api-versions#supported-api-versions), consistent with its minimum 24-month support window after the next release. Migrate those checks together before that date; do not change the header alone.

`verifyGitHubOidc` requires a pinned reusable workflow reference and SHA or an approved direct-workflow file blob at the signed commit. It also checks the configured plan digest, the exact signed job check ID, and current GitHub workflow metadata. Pull requests must have a head branch in the same repository and target main; the author does not need separate collaborator permission. It keeps the signing keys of GitHub in module memory as plain data between requests, and each verification builds its own key set from them.

The tested SHA must be a two-parent PR merge commit whose first parent is an ancestor of current main and whose second parent is the current PR head. GitHub's live merge ref must match its current PR merge SHA. If GitHub regenerates that merge, its tree and PR-head parent must match the tested commit, and its base parent must remain in main history. Lineage keeps the tested commit's first parent as its target head. Merge groups need stored metadata from a verified `checks_requested` webhook. `loadTrustedMainFile` resolves main to a commit before fetching the plan. Never construct trusted configuration from the upload body.

Ingest capabilities and upload tickets expire within 15 minutes. They have different audiences from app sessions and from each other. `issueIngestCapability` starts the life of an ingest capability, after an identity check. `bindIngestReference` adds a reference to a verified capability: the new capability has the same claims and the same end. Their verification does not replace the service's active-attempt check, manifest conflict checks, image validation, byte accounting, or sealed-run guard. Only ingest endpoints accept ingest capabilities. Private status and review endpoints use `requireMaintainer`.

`verifyGitHubWebhook` checks the signature over the original bounded bytes. Persist a verified event with `persistWebhook` before acknowledging receipt. Pending payloads remain available for reconciliation. Domain handlers must be idempotent and set `processed_at` in the same transaction as their domain changes. `revokeGitHubAuthorization` provides this behavior for OAuth revocation.

`ensureGitHubCheck` creates or finds a check for one tested SHA and stable external identity. Run it under the service's persistent per-check lock. `sendGitHubCheck` is the transport callback for the durable status outbox. Pass the outbox's `isCurrent` callback; a stale intent returns `not-sent` before PATCH. A failed read of the check returns the result of `statusReadFailure`, with its cause, because no write request exists: the outbox sets no lock and tries again later. The sender sends no PATCH when GitHub already shows the same completed result, and a PATCH keeps the stored `completed_at` when the check is completed with the same conclusion. A thrown transport error remains ambiguous. Do not release its lock based on a timeout or observed remote status alone. The outbox must retain a newer desired revision when an older response arrives.

The tests use Vitest 5.0.1, TypeScript 6.0.2, Better Auth 1.7.5, jose 6.2.12, and the Miniflare version pinned by Wrangler 4.136.1. The tests in `auth-d1.test.ts` and `session-credential.test.ts` use real local D1 bindings. These checks do not substitute for deployed login, private-email OAuth, aborted Worker requests, GitHub endpoint probes, or production evidence E02/E06.

References: [Better Auth options](https://better-auth.com/docs/reference/options), [GitHub authentication](https://better-auth.com/docs/authentication/github), [current repository permissions](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user), [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc), and [Checks API](https://docs.github.com/en/rest/checks/runs).
