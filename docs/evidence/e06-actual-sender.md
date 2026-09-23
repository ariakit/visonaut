# E06: Actual sender stale-status probe

On September 23, 2026, the exact production `sendGitHubCheck` function refused an obsolete success after a genuine GitHub App metadata GET and before any status PATCH. A newer failure then completed on the same synthetic check. The [sanitized live receipt](../../tooling/evidence/e06-actual-sender/results/live.json) records 27 passing assertions, six GET requests, one check-creation POST, and one status PATCH. The [independent GitHub readback](../../tooling/evidence/e06-actual-sender/results/remote-read.json) confirms the final App-owned check was completed with failure.

## Source and target

The probe ran from Visonaut source commit [`a2e2d79`](https://github.com/ariakit/visonaut/commit/a2e2d7940cbe85e2ca59a937ab04cdc68f03d840). The receipt records SHA-256 values for `packages/security/src/checks.ts`, `packages/security/src/github.ts`, `packages/service/src/work.ts`, and `apps/web/src/operations/checks.ts`. These files were unchanged from [`beabb92`](https://github.com/ariakit/visonaut/commit/beabb924dba47ad0ba5b2551283b3d9e7c71d0ed), the source used for diagnostic Worker version `94e3d1c1-7c8a-43ba-8615-358fa77574a0`. This probe ran locally; the Worker version is a source comparison, not a claim that the probe ran inside that deployment. The built probe entry had SHA-256 `199d160a6dd55cfd15ccaf84658c690e524c5870cc2b1bbf2bae52020750ddbb`.

The target was public `ariakit/visonaut-diagnostics`, repository ID `1380792062`, on merged historical commit [`24f508cc`](https://github.com/ariakit/visonaut-diagnostics/commit/24f508cc65c91867d747a8046d4aef6348418ced). At the probe time, that commit was neither the main head nor an open PR head. The new [synthetic App check `107309472830`](https://github.com/ariakit/visonaut-diagnostics/runs/107309472830) had external identity `e06:b2e89d29-cffa-4a3f-bbd6-f704b93e34c8`. The production sender fixes the display name to `Visonaut`; the isolated check ID and historical tested SHA kept this fixture outside active required check decisions. The synthetic details URL names no real review run.

The App installation token was issued for only repository ID `1380792062` with `checks: write` and `metadata: read`; GitHub reported selected-repository scope. It remained in process memory. The probe revoked it with HTTP `204` at 17:54:38 UTC. Neither the token nor the App private key is in the receipt.

## Observed race

The harness called the repository's `statusIntentStatements`, `claimStatus`, `deliverStatus`, and `sendGitHubCheck` against a fresh native local Miniflare D1 database. It inserted revision-one success and claimed its lease. After the sender's genuine App GET returned HTTP `200`, the harness held the callback before the sender's `isCurrent` read. It inserted revision-two failure in D1, then released the callback. The old delivery returned `stale`; its freshness read was false, and the request log still contained zero PATCH calls.

The harness claimed revision two and let the same production sender complete its status PATCH. GitHub returned HTTP `200`, and a later GET showed failure on the exact synthetic check. Native D1 ended with desired and delivered revisions both equal to two, the first outbox row obsolete, the second complete, no lease, no ambiguity, and a clean foreign-key check. The source path under test is the same as:

```ts
sendGitHubCheck({ github, intent, testedSha, origin, isCurrent });
```

The fixed [harness source](../../tooling/evidence/e06-actual-sender/run.ts) guards the repository, commit, request paths, HTTP methods, token scope, and request counts. Its [local Worker](../../tooling/evidence/e06-actual-sender/worker.mjs) exists only to provide native D1. The [recorded run archive](../../tooling/evidence/e06-actual-sender/recorded-run.tar.gz), SHA-256 `11a3c0d52d3f1548742b6128f9aded5eabeed5c41c8457afa5cb69224dc694c8`, preserves the exact executed source and built files. The readable source was formatted, type-checked, and strengthened for future runs after the live probe; the archive is authoritative for executed bytes. Earlier startup attempts stopped before token issuance or any GitHub request; the passing receipt is the only outbound probe run.

## Boundary

The pause was injected after a completed GET. This proves refusal while the sender callback was in flight, before PATCH. The harness supplied `deliverStatus`'s native D1 freshness callback; it did not run the additional domain-status guard in `apps/web/src/operations/checks.ts`. It does not claim an actual GitHub network failure, cancellation of a PATCH already in flight, hosted D1 execution, or a full Ariakit capture and cutover cycle. Those remain separate E06 evidence. The older [custom-sender transport probe](./state-recovery/README.md#boundaries-and-separate-live-transport) covers delayed and ambiguous completed responses; it does not substitute for this production-sender result.
