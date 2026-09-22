# Deployed authentication evidence

These checks ran on September 22, 2026 against the Cloudflare preview and diagnostic deployments. They use Better Auth 1.7.5 with native D1. The results cover authentication and the private API boundary; they do not mark all of E02 complete.

## Real browser login

GitHub OAuth sign-in reached the private preview dashboard. Sign-out returned to the sign-in page and removed the stored session. The private account email remained stored without being included in this evidence.

The renewal probe aged the preview session by two days, then reloaded the dashboard. D1 recorded the new update time `2026-09-22T04:50:26.086Z` and expiry time `2026-09-29T04:50:26.086Z`. The expiry probe set only the current preview session's expiry to the past. Reloading returned to the sign-in page. A later sign-in restored access.

See [browser authentication observations](./deployed-browser-auth.json). These probes changed no production sessions or GitHub account permissions.

## HTTP and session probes

[Anonymous boundary results](./deployed-private-boundaries.json) record 26 requests. Private run, status, review, export, operations, and discovery routes returned `401 sign_in_required` with private, non-stored responses. Missing image routes returned `404` with `no-store`.

[Session probe results](./deployed-session-probes.json) record 18 observations. Two temporary D1 identities supplied session fixtures. The service checked their numeric GitHub identities against the live repository permission endpoint: the maintainer fixture could read runs, and the non-maintainer fixture received `403 not_maintainer`. A preview bearer failed against the separate diagnostic database. A cross-origin mutation failed with `403 invalid_origin`.

Eight concurrent authenticated reads succeeded. One client aborted its request, and a later independent read succeeded. A synthetic, correctly signed revocation payload removed the non-maintainer fixture session. This proves the deployed receiver and revocation handler; it is not evidence of an actual GitHub webhook delivery. Sign-out invalidated the maintainer fixture token. Both fixture users and their sessions were removed after the probes.

## Hosted OIDC and capability refusal

The [hosted negative OIDC receipt](./github/diagnostic-oidc-negative.json) records a real GitHub runner token with the wrong audience returning `401 invalid_oidc`, an untrusted workflow job returning `403 untrusted_run`, and a missing bearer returning `401 credential_required`. The private database check found no run records for that workflow. The changed-repository and spoofed-SHA requests also came from the untrusted workflow, so they do not independently prove the later repository and SHA guards. The disposable dispatch branch did not change main or the trusted capture plan and must never merge.

The [deployed capability probes](./deployed-capability-boundaries.md) separately rejected expired, tampered, wrong-environment, wrong-run, and wrong-shard credentials at their intended guards. A valid write capability could not read private data, create a review session, approve, recompare, or export. Covered capture, review, baseline, promotion, and session state matched before and after. These were locally minted, short-lived test capabilities, not additional credentials issued through CI OIDC. No image bytes or upload tickets were sent. There is no public promotion route; the evidence covers approval refusal and unchanged promotion state.

## Genuine signed App ping

GitHub manually redelivered an existing genuine App ping to the diagnostic receiver. GitHub recorded HTTP `202`, and the matching D1 delivery was processed. The [sanitized receipt](./github/diagnostic-app-ping.json) proves signed transport for that event. It does not prove automatic event delivery, merge-group metadata delivery, installation revocation, or OAuth revocation.

## Remaining E02 observations

The [hosted GitHub integration record](./github-integration.md) also provides real successful OIDC uploads and validated public image reads. The App's automatic webhook remains inactive, and diagnostic OAuth callback registration remains blocked by the GitHub settings sudo/2FA check. Preview OAuth login and diagnostic sessions seeded in D1 do not establish diagnostic OAuth login. Real revocation delivery and production-to-preview isolation still need their required evidence.

The [nonproduction auth retirement runbook](../operations/retire-preview-auth-at-cutover.md) selects production as the only retained authenticated environment because the shared App has one revocation webhook destination. Its route shutdown, session cleanup, and old-credential probes have not run. The genuine ping does not close this revocation-delivery gap. The files here contain no session tokens, account email addresses, private keys, or image bytes.
