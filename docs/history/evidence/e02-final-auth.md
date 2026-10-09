# Final-source authentication and revocation

On September 23, 2026, the deployed Visonaut authentication path passed the remaining E02 checks. Production ran main source [`507179f`](https://github.com/ariakit/visonaut/commit/507179fd59fad0333880be40d2b4a33ba2e0e653); the deployed preview and diagnostic web code and configuration were unchanged across the later main-only diagnostic repair changes. The production, preview, and diagnostic sites used separate D1 databases and host-only, Secure, HttpOnly, SameSite=Lax session cookies. The consenting `ariakit-bot` GitHub account supplied disposable sessions. The maintainer's grant and sessions were not used for revocation. The [sanitized receipt](./e02-final-auth-receipt.json) records the measured counts, statuses, and delivery times.

## Renewal, expiry, and environment isolation

The probe read the bot's session rows from the three deployed D1 databases. For each environment it guarded an update of one bot session's `updatedAt` and `expiresAt` against its previous values and GitHub account ID, then called the deployed `/api/auth/get-session` endpoint with that session's bearer token. The response set a new host-only session cookie with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`. D1 retained the same session and token, advanced `updatedAt`, and extended expiry beyond six days. No maintainer session row was changed.

The nine cookie-to-host paths produced this matrix. Each cell shows `/api/auth/get-session` session count and `/api/me` status:

| Cookie source | Production | Preview | Diagnostics |
| ------------- | ---------- | ------- | ----------- |
| Production    | 1 / 200    | 0 / 401 | 0 / 401     |
| Preview       | 0 / 401    | 1 / 200 | 0 / 401     |
| Diagnostics   | 0 / 401    | 0 / 401 | 1 / 403     |

The bot has read-only access to `ariakit/visonaut-diagnostics`, so its valid diagnostic session receives 403 at the maintainer-only `/api/me` route. This is the expected permission result, not an authentication failure. Cross-environment `/api/auth/get-session` returns HTTP 200 with a null session, while `/api/me` returns 401.

The production expiry probe began with two independent bot sessions. It guarded an update that set only the second session's expiry in the past while exactly two bot sessions were active. The deployed endpoint then returned a null session and `/api/me` returned 401 for the expired cookie; the first production cookie still returned a session and `/api/me` 200. A D1 read found one active production bot session. The one-use probe then stopped on an inventory assertion that incorrectly dereferenced a second row after expiry; this occurred **after** those HTTP and survivor assertions. A corrected follow-up probe independently renewed the survivor and repeated the nine-path matrix, with exactly one active bot session in each environment before and after. This explains the probe failure without treating it as a service failure.

## Genuine GitHub grant revocation

The bot's Visonaut GitHub App access token was checked against GitHub's `/user` and App token-check endpoints before revocation. GitHub returned HTTP 204 to deletion of this bot grant at `/applications/{client_id}/grant`. GitHub then delivered one signed `github_app_authorization` `revoked` webhook to Visonaut's router. The same delivery, identified in this record only by SHA-256 prefix `f317f9cb448f4440`, was processed in all three environments between `2026-09-23T07:09:32.411Z` and `2026-09-23T07:09:32.599Z`. Each environment recorded one `github_revoked` audit entry and had zero bot sessions after delivery. GitHub returned HTTP 401 for the revoked App token. Non-bot session counts in every database were unchanged.

This is a real GitHub grant revocation and automatic signed webhook fanout, unlike the earlier locally signed fixture. The probes printed no session token, cookie value, GitHub token, private account email, or webhook payload. The [earlier deployed authentication record](./authentication.md) and [hosted image-boundary record](./github-integration.md#public-image-and-private-metadata-boundary) cover the other E02 checks.
