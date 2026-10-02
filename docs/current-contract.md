# Current implementation contract

This document became the current repository contract when [PR #205](https://github.com/ariakit/visonaut/pull/205) merged on 2026-10-02. The [pinned issue #1 notice](https://github.com/ariakit/visonaut/issues/1#issuecomment-5958332349) records the authority handoff and preserves the complete historical issue body. The repository contract retains the 45 explicit selections in [Visonaut · Less to maintain, revision 6](simplification-audit/index.html) and records the later approved review, integration, and release rules below.

Only an explicit approved change supersedes a requirement. An unselected question or a passing source check does not change the contract or complete a live cutover.

Every [saved issue #1 requirement](simplification-audit/contract-issue-1.md) remains binding unless an explicit approved rule below supersedes it. A historical label does not remove an unaffected requirement, compatibility promise, or evidence limit. The [original audit supersession map](simplification-audit/handoff-draft.md#rules-that-supersede-issue-1) preserves the earlier replacements. The later approved sections and [issue #204 map](#issue-204-supersession-map) control their replaced scope. The [61 earlier decisions and notes](simplification-audit/prior-r9.json), [revision 9 design](design-r9.html), and dated evidence remain preserved as history.

The frozen audit source is Visonaut [`7e23173`](https://github.com/ariakit/visonaut/commit/7e23173d11b1081f55021ef498e4c5c6d6a08131) and Ariakit [`fe73331`](https://github.com/ariakit/ariakit/commit/fe73331c833108a7ce18e0df6ba04af9e83776b9). New evidence must name its source and scope. Use this document as the current guide for requirements, source behavior, selected targets, and remaining gates. Use the [implementation record](simplification-implementation.md) for dated proof and the [deployment and release guide](../.github/workflows/README.md) for execution. The frozen design, audit, and issue body are not separate current authorities.

## Current path and evidence state

W01 of [issue #204](https://github.com/ariakit/visonaut/issues/204#w01) reconciles this guide against source [`3d575bd`](https://github.com/ariakit/visonaut/commit/3d575bd652ae29b12cb18155310cd8437a8ef826), fetched on 2026-10-02. Read the [18 selected decisions and full appendix](https://github.com/ariakit/visonaut/issues/204#issuecomment-5956746624) for their conditions. The issue reviewed [`017f15c`](https://github.com/ariakit/visonaut/commit/017f15c0f910a4599fe53dd85717bdb8aa1d79b0) and checked main at [`3ffee50`](https://github.com/ariakit/visonaut/commit/3ffee5015d0a5afa0bc03fe08a4bab5617072a13). Its file counts and test totals apply only to those snapshots.

The normal visual path is:

```text
Playwright capture -> trusted CLI comparison -> service validation
-> maintainer review when required -> GitHub App status
```

The current package pair is CLI `visonaut@0.5.3` and adapter `@visonaut/playwright@0.4.0`. The adapter has an exact Playwright `1.63.0` peer pin. The CLI is independent of that peer runtime. TanStack Start/Router and React remain the web framework. Keep the [package ownership map](../README.md#work-on-the-repository); D17 does not select a framework rewrite or package merge.

Trusted Submit verifies native Plan, the tested commit, exact workflow Git blobs, source attempts, successful required jobs, artifact digests, and the complete capture inventory. It compares PNG captures against a service-pinned reference, using pixelmatch and the recorded consumer settings. The service validates signed provenance, reference binding, receipt metrics, and image bytes before importing the result. Upload, sealing, and a queued review receipt do not grant approval. See the [CLI](../packages/cli/README.md), [adapter](../packages/playwright/README.md), [receipt validator](../apps/web/src/api/local-comparison.ts), and [review guide](review-guide.md).

| Area                         | Current source behavior                                                                                                                                                       | Selected target and gate                                                                                                                                      | Deployed evidence                                                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal comparison            | Trusted CLI compares PNG; the compare Worker validates images and still serves legacy queued PNG/WebP comparisons.                                                            | D03 retires legacy admissions and then consumers only after supported-client, retained-image, and task/lease/retry/dead-letter checks. Keep image validation. | W01 checked no live inventory. The [W03 readback](operations/issue-204-inventory.md#d03-active-runs-tasks-and-delayed-delivery) records D1 work; clients and the full delivery/replay horizon remain unverified.           |
| Closed history               | Every closed run rejects new stored recomparison. Existing historical links, decisions, approval tuples, available images, and terminal states remain readable.               | D05 requires a fresh complete capture for a new result. Keep historical writers and readers while existing work drains.                                       | No W06 cutover or historical-task drain is proved here.                                                                                                                                                                    |
| Product exports              | New creation returns `410 export_retired`; the create-export control is removed. Existing private downloads retain integrity checks, leases, expiry, cleanup, and owner pins. | D06 stage B removes the remaining code only after existing exports finish or expire and bounded cleanup completes.                                            | [W03](operations/issue-204-inventory.md#d06-export-drain-and-w06-readiness) found one unexpired production export and its pins. Stage B remains held; current download frequency is unknown.                               |
| Conversion and retained data | Conversion helpers, old readers, numbered migrations, and retired tables remain.                                                                                              | D02 removes only completed temporary machinery after exact conversion and image checks. D14 selects inventory and a proposal, with no data deletion.          | [W03](operations/issue-204-inventory.md#d02-schema-conversion-and-retained-originals) records new target facts and exact holds. Preview migrations and required-byte/profile proof remain open. No count defaults to zero. |
| PR baseline and authority    | PR results can retain their verified earlier reference when main advances; main promotion keeps current-baseline guards.                                                      | Preserve the approved PR-baseline rule below and every unaffected requirement.                                                                                | PR #205 completed the authority handoff and readiness marker. PR #206 records its deployment/readback; #207 records exact transfer-key retirement.                                                                         |

W01 performed no cloud readback, mutation, deployment, or publication. Existing dated receipts retain their exact scope. The table separates implemented source, selected targets, and dated deployed evidence. A source patch does not prove a new deployment or drain, even where an older cutover has completed. The [unpublished issue #1 notice update](issue-204-handoff-draft.md) records the new map; it does not repeat or claim a new authority handoff.

## Issue #204 supersession map

An issue #204 D-number is separate from a revision 9 D-number. The replacement scope below is exact. A selected target permits the named work; it does not prove that code, clients, live data, or deployed resources have moved to it.

| Selected rule                                        | Earlier promise or source rule                                                                                                                                    | Exact replacement and retained scope                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01: one current guide                               | Multiple current descriptions and the old pending Q03 handoff text.                                                                                               | This guide owns current requirements. Preserve the completed PR #205 handoff, earlier issue body, 61 revision 9 decisions, 45 audit selections, and dated evidence.                                                                                                                                                                                                                                                                                                                 |
| D02: remove after exit checks                        | Temporary S05/S06/C03 conversion controls and their old-reader paths.                                                                                             | W07 may remove only machinery with verified completion in both environments. Keep required originals, approval tuples, foreign keys, ordinary history creation, recovery, retention, and all applied migrations.                                                                                                                                                                                                                                                                    |
| D03: retire legacy comparison in stages              | Revision 9 D11 and the [runtime rule](simplification-audit/contract-issue-1.md#service-comparison-and-codecs) require service comparison; C04 retains the Worker. | Trusted CI comparison is the normal path. W08 retires only legacy admission, scheduling, consumers, and helpers after compatibility and drain. Keep the Worker's image validation, required codecs/readers, immutable old engine/codec identity, and stored approval tuples.                                                                                                                                                                                                        |
| D04: full-rerun trial                                | Revision 9 D38 and A07 permit verified successful source jobs that did not rerun.                                                                                 | W10 measures full versus partial reruns. It does not supersede partial-rerun support. A later explicit choice is required before removal. Keep every commit, attempt, digest, job, and complete-inventory check.                                                                                                                                                                                                                                                                    |
| D05: all closed history is read-only                 | C01 protects promoted history; S06 and revision 9 D11 retain pre-expiry legacy historical comparisons.                                                            | W06 extends read-only history to all closed runs. Preserve original decisions, exact tuples, existing comparison links, available evidence, the 30-day byte window, owner pins, and explicit terminal states. Outstanding historical work must settle before its writers retire.                                                                                                                                                                                                    |
| D06: remove product export                           | S02 retains manual evidence export; the [recovery runbook](../apps/web/src/operations/README.md#native-database-recovery) includes an export check.               | W06 stage A stops new creation and replaces the recovery export check with fresh capture, history readback, and required image checks. Keep existing private downloads, verification, leases, expiry, cleanup, and export-owned pins through drain. Remove unused export code only after verified zero unfinished exports and active leases, with bounded cleanup complete. No replacement report is selected. D1 cannot recreate deleted R2 bytes.                                 |
| D07: explicit shared comparison defaults             | Adapter `0.4.0` automatically inherits private `info._projectInternal.expect.toHaveScreenshot` settings. C05/revision 9 D43 name the older 0.05% Worker policy.   | W05 replaces private inheritance through a coordinated public adapter/consumer update. Preserve defaults -> batch -> image order, own-property `undefined` clearing, threshold `0.2`, and zero allowed pixels when no cap remains. Require an explicit defaults object, including `{}`; missing configuration must fail with a clear setup error. Keep the tested peer pin and any required compatibility bridge until supported clients can move. This guide changes no threshold. |
| D08/D09: refactor after removal; small review hook   | Current service/API transitions and review-workspace save state.                                                                                                  | W09 follows W06-W08. Preserve public entry points, atomic transactions, expected revisions, exact command IDs, durable queue admission/order/replay, retry, Undo, pending overlays, route-model updates, focus, and navigation. No new workflow framework or global store.                                                                                                                                                                                                          |
| D10: keep copied components                          | U01 and historical prototype imports.                                                                                                                             | Keep the component set, keyboard behavior, license, and source notice. No pruning or replacement is selected.                                                                                                                                                                                                                                                                                                                                                                       |
| D11: measure CI setup                                | Current parallel jobs, builds, and fail-closed Gate.                                                                                                              | W10 permits only proved redundant setup removal. Keep required job names and dependencies unless evidence supports a later change. No branch-rule edit is authorized.                                                                                                                                                                                                                                                                                                               |
| D12: keep manual built-app check                     | Q04's on-demand built-app verification.                                                                                                                           | Keep a recorded actual built-app check after framework, route, build, or deployment changes. Do not add a second automated smoke project.                                                                                                                                                                                                                                                                                                                                           |
| D13/D15: shared failure reference; readable defaults | O06's safe failure fields and current validated numeric limits.                                                                                                   | W04 passes the existing request ID consistently and moves unchanged effective defaults into typed code with narrow validated overrides. Keep safe fields, distinct conflicts, finite admission/image/budget checks, and incident overrides. No new telemetry service or larger bound.                                                                                                                                                                                               |
| D14: inventory retired data                          | Applied backup and transfer tables with no current runtime-source name references.                                                                                | W03 maps live rows, dependencies, retention, and recovery use, then prepares a retirement proposal. No destructive migration, row/table/object deletion, or shorter retention. Source absence is not live evidence.                                                                                                                                                                                                                                                                 |
| D16: document public validated images                | Revision 9 D13's public image URL choice.                                                                                                                         | Keep public validated image bytes and private metadata, export files, and quarantine. A URL is not authorization; access revocation cannot recall copied pixels.                                                                                                                                                                                                                                                                                                                    |
| D17: keep boundaries                                 | Two deployable apps, six package boundaries, and current framework.                                                                                               | Simplify inside them. Keep CLI independence from the Playwright peer runtime. No package merge or framework replacement.                                                                                                                                                                                                                                                                                                                                                            |
| D18: owned browser server                            | Former fixed port `4179` and automatic server reuse.                                                                                                              | W02 now shares one validated optional `VISONAUT_TEST_PORT` between Vite, readiness, and baseURL, with default `4179` and `reuseExistingServer: false` in local and CI runs. Invalid input fails before startup; a busy port fails without reuse or port scanning. Ariakit supplies the port pattern, not its local reuse rule. See the [developer commands](development.md#browser-server-ownership).                                                                               |

W03 and W10 can collect evidence after W01. W04/W05 require W02. W06 needs W02 and W03; W07 needs W03 and W06; W08 needs W03 and W05-W07; W09 needs W02 and W06-W08. Unknown required facts hold dependent removal. Keep independent selected work moving. Cloud mutations, deployments, package publication, consumer changes, GitHub rules, and issue updates each need a separate instruction and one external owner. The remote inspection runner creates a provider proxy during setup, so its setup is an external write. Hosted recovery also needs separate resource/write authorization.

The [W10 measurement record](evidence/issue-204-ci/README.md) retains dated D04/D11 observations and the prepared full-rerun trial. D11 removes only Browser's preceding full build after the source fixture passed with all app/package `dist` output absent. Keep every other build and setup step, required job name, dependency and fail-closed Gate. D04's paired trials remain on hold for separate consumer actions and verified matching inventory evidence. Partial-rerun support remains, and no measured CI improvement or acceptable cost threshold is claimed.

## Request failure references

D13/W04 now passes the outer request UUID and start time to API failure handling. An unexpected API or outer HTTP failure returns HTTP 503 with `error.reference`, the existing private headers, and `Retry-After: 1`. The reference matches exactly one `operation-failed` log with fixed operation, code, correlation ID, and elapsed-time fields. No request body, token, URL, SQL, raw exception, or private label is added to that log.

Known authorization, validation, incomplete-capture, and conflict responses keep their current status, message, and retry semantics without a support reference. The review client shows the reference beside its retry error, including when it cannot confirm an admitted server command. The queued-command notice and exact-command retry remain intact. This is source behavior; deployment of D13 remains unverified. D15's numeric-default change is separate work.

```text
Response: error.reference = request UUID
Safe log: correlationId = the same request UUID
Review error: Reference: request UUID. [Retry same command]
```

## Numeric runtime limits

The D15 source change puts the shared preview and production numeric values in [typed defaults](../apps/web/src/runtime-defaults.ts). The [exact old/new value comparison](evidence/issue-204-d15-runtime-defaults.json) preserves every committed bound. D13 failure-reference work remains a separate patch. This record does not prove deployed values or inventory live incident overrides.

`VISONAUT_API_LIMITS` and `VISONAUT_OPERATIONS_BUDGET` remain JSON strings at their existing read paths. The committed Wrangler values are `{}`. A missing binding or `{}` selects the defaults. Partial overrides change only known fields, and complete existing objects still work. Decimal-string values remain supported. Malformed objects, unknown fields, nonpositive or unsafe integers, and values outside the existing image, page, or capacity bounds fail before use. Validation runs after the merge. Export budget fields remain while their consumers exist.

For example, this operations override changes the task count for each step to 10 and keeps every other default:

```json
{ "tasksPerStep": 10 }
```

Keep incident overrides in the existing deployment configuration. A future deployment must reconcile live values before applying the committed `{}` values. D15 does not authorize a deployment or remove an override path.

## Comparison settings and rendering identity

C03 keeps rendering identity separate from comparison policy, engine, and codec identity. Rendering identity records the browser, OS, fonts, viewport, locale, media, and screenshot settings. Current local comparison uses each capture's recorded `comparison` object; it does not apply a blanket 0.05% allowance. C05/revision 9 D43's `visible-ratio-v3` policy has `maxChangedRatio: 0.0005` and belongs to the retained RGBA Worker path and its dated results. Keep the [historical policy evidence](evidence/comparator-policy.md) unchanged. A source constant or this guide does not change a stored policy or the consumer's settings.

The [current adapter source](../packages/playwright/src/comparison.ts) adds the D07 compatibility API at `project.metadata.visonaut.comparisonDefaults`, beside `profile`. Explicit defaults, including `{}`, take precedence over the pinned private fallback. Malformed explicit defaults fail capture even when a batch or image would override them. The adapter resolves project defaults, batch settings, then image settings. Only own comparison fields count; an explicit `undefined` clears inheritance. Both configured pixel caps apply; the smaller allowance wins without rounding up. The built-in threshold is `0.2` and no remaining cap means zero allowed pixels. Comparison settings do not change rendering profiles or engine/codec identity.

Published adapter `0.4.0` predates this API. The prepared compatible release retains the tested Playwright `1.63.0` private bridge only when explicit defaults are absent. Publication and consumer adoption are unverified here. Final required explicit configuration, a clear error for missing configuration, and private-field removal remain held for verified supported-consumer adoption and a declared breaking release. See the [prepared Ariakit patch and exact holds](operations/adapter-comparison-defaults.md). Do not mark final D07 retirement complete from this compatibility patch.

```ts
// Current capture API: override one setting for this image.
await visual(page, {
  item: "button",
  variant: { key: "react-light", browser: "chromium" },
  maxDiffPixels: 2,
  maxDiffPixelRatio: 0.0005,
});
// For 2,000 pixels, the ratio allows one changed pixel, not two.
```

A dimension change requires review. With equal dimensions, a rendering-profile change alone needs no review when the comparator measures zero changed pixels. A profile change with nonzero changed pixels requires review even within the pixel caps. This exception does not relax approval-copy identity. The [validator](../apps/web/src/api/local-comparison.ts) accepts eligible older signed zero-pixel receipts. The [service import](../packages/service/src/service.ts) normalizes their review outcome only for equal dimensions, zero count/ratio, and no expected or stored mask; it preserves the immutable signed evidence.

Keep [`0030_local_zero_pixel_reviews.sql`](../apps/web/migrations/0030_local_zero_pixel_reviews.sql) as applied history. Its narrow correction excludes existing decisions and promotions and invalidates stale revisions. Do not rerun, broaden, remove, or rename it for cleanup. Both existing `0030_*` files and every other applied numbered migration remain unchanged. Use the [complete migration reader](development.md#database-fixtures) for local schema and recovery checks.

## Original selected rules

Each link preserves the original question, selected answer, alternatives, migration, tests, and evidence. Later approved rules below control the replaced scope. Unaffected decisions, compatibility promises, and evidence limits remain binding.

| Decision                                   | Selected behavior                                     |
| ------------------------------------------ | ----------------------------------------------------- |
| [S01](simplification-audit/index.html#S01) | One D1 plus two R2 buckets                            |
| [S02](simplification-audit/index.html#S02) | Native D1 recovery and manual evidence export         |
| [S05](simplification-audit/index.html#S05) | Point the baseline at an immutable source run         |
| [S06](simplification-audit/index.html#S06) | Detailed active reviews, compact closed history       |
| [C01](simplification-audit/index.html#C01) | Make promoted history read-only                       |
| [C02](simplification-audit/index.html#C02) | Copy verified approval into each new run              |
| [C04](simplification-audit/index.html#C04) | Worker in production; Container as a separate probe   |
| [S04](simplification-audit/index.html#S04) | One queue with small, named work kinds                |
| [U01](simplification-audit/index.html#U01) | Use the copied components throughout                  |
| [U02](simplification-audit/index.html#U02) | Use one review shell                                  |
| [U03](simplification-audit/index.html#U03) | Use item links and variant tabs                       |
| [U06](simplification-audit/index.html#U06) | Open the focused variant immediately                  |
| [U04](simplification-audit/index.html#U04) | Page-wide review arrows with pan buttons              |
| [U05](simplification-audit/index.html#U05) | List review work first with a history view            |
| [P01](simplification-audit/index.html#P01) | One compact complete model                            |
| [P02](simplification-audit/index.html#P02) | Load diff when selected                               |
| [P03](simplification-audit/index.html#P03) | Use the existing router loaders                       |
| [P04](simplification-audit/index.html#P04) | Add a virtual scrolling list                          |
| [P06](simplification-audit/index.html#P06) | Stream GET and use metadata for HEAD/304              |
| [C06](simplification-audit/index.html#C06) | Count first; build a mask only for changed pairs      |
| [P05](simplification-audit/index.html#P05) | One current fixture plus two route checks             |
| [A01](simplification-audit/index.html#A01) | Keep explicit setup in Ariakit                        |
| [A02](simplification-audit/index.html#A02) | Pin one small visual workflow                         |
| [A03](simplification-audit/index.html#A03) | One current path; remove old entry points now         |
| [A04](simplification-audit/index.html#A04) | Require the App check directly                        |
| [A05](simplification-audit/index.html#A05) | Use private files for image attachments               |
| [A06](simplification-audit/index.html#A06) | Use ordinary CI diagnostic artifacts                  |
| [A07](simplification-audit/index.html#A07) | Use ordinary one-day capture artifacts                |
| [C03](simplification-audit/index.html#C03) | Store rendering and comparison identities separately  |
| [C05](simplification-audit/index.html#C05) | Keep the selected legacy Worker 0.05% allowance       |
| [O01](simplification-audit/index.html#O01) | Use one main pipeline                                 |
| [O02](simplification-audit/index.html#O02) | Keep Infisical only for deploy credentials            |
| [O03](simplification-audit/index.html#O03) | Use standard Wrangler deployment                      |
| [O04](simplification-audit/index.html#O04) | Use one production receiver                           |
| [O05](simplification-audit/index.html#O05) | Also cache read permission briefly                    |
| [O08](simplification-audit/index.html#O08) | At most 60 seconds                                    |
| [O06](simplification-audit/index.html#O06) | Use a small structured failure record                 |
| [O07](simplification-audit/index.html#O07) | Run Changesets publish in one verified workflow       |
| [O09](simplification-audit/index.html#O09) | Publish from the checked source                       |
| [O10](simplification-audit/index.html#O10) | Publish every eligible package in the Changesets plan |
| [O11](simplification-audit/index.html#O11) | Use preview fixtures without GitHub login             |
| [Q01](simplification-audit/index.html#Q01) | Read the numbered migration directory by default      |
| [Q02](simplification-audit/index.html#Q02) | Keep a local check and name the extra CI checks       |
| [Q03](simplification-audit/index.html#Q03) | Keep a short current contract in the repo             |
| [Q04](simplification-audit/index.html#Q04) | Keep the suite and record a manual built-app check    |

## Required invariants

Capture trust binds the tested commit, exact workflow attempt, successful native Plan, signed Submit, and complete shard set. Missing, failed, stale, or partial evidence must not pass the App check. An expired one-day capture artifact requires a full visual rerun when its verified source evidence is needed. A missing or failed Plan must not report success.

Approval reuse needs exact image, rendering profile, comparison policy, item, variant, and allowed lineage identity. C02 gives a verified copied approval to the new run; later edits to the source do not revoke that copy. C01 makes promoted history read-only. A correction requires a new complete main run. Active baselines and open reviews pin every original they need. A missing required original is a failure. Closed-run summaries must not promise image replay after unpinned bytes expire.

Private reads may reuse a positive GitHub permission result for the same valid session, user, and repository for at most 60 seconds. The approved decision-only supersession below permits Approve and Reject to reuse a positive GitHub permission check for at most 10 seconds. Live session and linked-account checks still run for every request. All other writes require a live repository-permission check. Preview uses isolated fixtures without GitHub login or production App sessions. Production owns the live App webhook and bounded failed-delivery recovery, followed by an actionable alert.

Production uses the existing Cloudflare Workers, with one D1 database and separate IMAGES and QUARANTINE R2 buckets in each environment. Trusted CLI Submit performs normal PNG comparison. The compare Worker retains image validation and supported legacy comparison. The repository retains a separate Container probe configuration for independently authorized diagnostics; the former production and preview Container resources are retired. No hosted diagnostic run is authorized by this contract. Infisical supplies only the two deployment credentials from the dedicated project's `prod` root path `/`, with imports and recursive reads disabled. Runtime auth and App secrets remain in Cloudflare. Standard Wrangler deployment owns declared bindings, routes, consumers, cron, and observability.

## Later approved review changes

[PR #184](https://github.com/ariakit/visonaut/pull/184) implements the maintainer's later review feedback. Run views and variants use navigation links with a bar glider; variant links replace the original U03 tabs. The UI can show the requested verdict and advance while saving. Only server-confirmed decisions count as saved, and failed writes restore prior local state.

On 2026-10-02, the maintainer requested that items with a new variant stay in the main sidebar list for manual inspection, including after approval. Automatically accepted additions remain approved and do not add pending review work. Ordinary accepted and unchanged items stay under **Accepted**. List placement does not change review actions or GitHub readiness.

The maintainer also selected server storage for pending decisions, with processing continuing after the window closes. Separate human [PR #190](https://github.com/ariakit/visonaut/pull/190), merged as [`8ebf821`](https://github.com/ariakit/visonaut/commit/8ebf821681791a66c2d87e8803be9883a486f326), implements a durable review queue in D1. Authorized queued submissions return HTTP 202 after admission. Server operations process linked stored decisions in order. The client distinguishes sending, queued, and saved decisions; a queue receipt is not a saved verdict. Unsent decisions still require the browser. Admitted commands survive its closure, and failed commands remain visible through their receipts. Keep exact command IDs across retries, actor-specific receipt access, predecessor ordering within the same actor/session/comparison, failed-predecessor handling, leases, and safe replay after a crash. Queued or leased review work blocks completion/promotion through the readiness guard. Aborting a browser receipt wait does not cancel an admitted server command. The UI must preserve multiple rapid decisions, pending overlays, newer route-model handling, Retry, Undo, focus, and navigation. Keep review-queue processing in OPERATIONS when W08 retires legacy comparison work. This source behavior and the separate deployment are verified; no hosted window-close probe or production latency measurement is claimed.

Keep the zero-pixel rules and distinct local/legacy settings in [comparison settings and rendering identity](#comparison-settings-and-rendering-identity). A profile change with nonzero changed pixels still needs review. Immutable comparisons, exact approval-copy identities, and promoted-history rules remain binding.

## Approved decision-permission supersession

On 2026-10-02, the maintainer selected the 10-second decision cache for faster reviews. This explicitly supersedes the original live repository-permission check for every write only for Approve and Reject submissions at `POST /api/comparisons/:id/commands`. These submissions may reuse a positive GitHub permission result for at most 10 seconds from the start of the GitHub permission request that established it. Cache hits do not extend that interval. Live session and linked-account checks still run for every request. Session creation, Undo, promotion, and all other writes retain a live repository-permission check. Repository permission removal can therefore take up to 10 seconds to block another Approve or Reject.

[PR #186](https://github.com/ariakit/visonaut/pull/186) implements the approved cache. See the [security implementation](../packages/security/README.md) and [implementation checkpoint](simplification-implementation.md#current-handoff-checkpoint) for its source and deployment proof. The later durable queue belongs to separate PR #190. No measured production latency improvement is claimed.

## Approved PR baseline independence

On 2026-10-02, the maintainer approved concurrent PRs that use the same earlier target baseline. A newer main baseline alone must not invalidate an otherwise valid PR result or require the PR to compare again. This supersedes the earlier requirement to recompare an active PR solely because main advances. The tested commit, workflow attempt, complete capture evidence, comparison identity, and approval rules still apply. A changed PR source head or a new signed attempt can replace the earlier run.

The required GitHub result must remain available on the unchanged PR head when GitHub regenerates its temporary merge commit. The review keeps the original tested commit as its capture identity. A passing check on an obsolete merge commit alone does not meet this requirement.

For example, PRs A and B compare against baseline X. A merges and promotes baseline Y. B's valid result against X remains valid. After B merges, its complete main run compares the actual merged result against Y. Approval reuse still needs exact identity and eligible lineage. Any remaining change needs valid acceptance before main can promote the full snapshot.

## Native Plan and Submit

Pin the exact Git blobs of `.github/workflows/ci.yml` and `.github/workflows/app.yml`. The native CI job is `Plan`. Its last step runs the following command only after successful `Plan CI` computes `app=false`:

```sh
visonaut submit --no-visual
```

This signed false result needs no capture artifact or upload credential. Native Plan tokens may omit both job-workflow claims. If either claim is present, both `job_workflow_ref` and `job_workflow_sha` must match the corresponding native `workflow_ref` and `workflow_sha`. This does not admit a different reusable workflow. For `app=true`, native CI selects App. `App / Visual Capture (linux)` and `App / Visual Capture (safari)` upload ordinary one-day artifacts with images, `manifest.json`, and `environment.json`. `App / Visual Submit` verifies successful native Plan and all required capture evidence before submitting both shards. There is no separate signed true report or reusable Plan mode.

```sh
visonaut submit --shard linux --shard safari
```

Set `VISONAUT_CAPTURE_JOB_NAME` to `App / Visual Capture ({shard})` and `VISONAUT_SUBMIT_JOB_NAME` to `App / Visual Submit`. The removed prefix setting has no fallback. A Submit-only rerun makes a fresh current-attempt bundle from verified successful source jobs that did not rerun. A rerun capture job needs its new artifact. A prior passing check cannot replace the current result. Capture and Submit success do not grant visual approval.

## Publication and remaining cutover

Main pushes with an effective public Changesets version plan create or update one `Publish` PR. Its reviewed merge permits automatic publication under `latest` when `VISONAUT_AUTOMATIC_PUBLICATION=true`. The separate npm OIDC job publishes the whole eligible public plan from the exact checked main source after normal CI. Private-only Changesets keep their existing policy. Manual dispatch remains available for `latest` or `next` with a reviewed `VISONAUT_RELEASE_COMMIT`. There is no package selector. Verify contents, versions, tag, integrity, signatures, source, and publisher identity. Earlier smoke archives do not promise publication byte identity; same-source retries verify existing versions without creating a new version.

CLI `visonaut@0.5.3` is published and verified under `latest`; adapter `@visonaut/playwright@0.4.0` is unchanged. Ariakit main has adopted the CLI. Normal visual and signed no-visual proof is complete. The required `Visonaut` check from App `5028451` is active beside `Gate` from GitHub Actions App `15368`.

Production trusts native CI Git blob `3dbaca30542ae9e84bbbba3f87cc29891bdf7856` and App Git blob `ec8ba1563228164856c33c94f4fa96645448c730`. The selected old-caller attempts are settled. Ariakit [PR #7708](https://github.com/ariakit/ariakit/pull/7708) merged as [`bb1e20e`](https://github.com/ariakit/ariakit/commit/bb1e20e457b961b005bdf4398d47fe859a473e96), which completes polling-removal and contributor-guide adoption. Native Gate verifies selected CI jobs; the separate required Visonaut check enforces visual review. The [implementation checkpoint](simplification-implementation.md#current-handoff-checkpoint) owns dated release, adoption, test, deployment, and readback receipts.

The matching consumer cutover is complete. [PR #205](https://github.com/ariakit/visonaut/pull/205) published the canonical docs and production readiness marker together on 2026-10-02. Normal deployment and Cloudflare configuration readback are complete; the [dated completion receipt](simplification-implementation.md#pr-205-completion) records their exact scope. Production `VISONAUT_LAUNCH_ENABLED=true` changes only the `/health` label and does not fence API writes. Direct production `/health` HTTP proof remains unverified because the browser blocked that URL; this is not a source failure or a new launch gate. The two obsolete transfer-key bindings were retired on 2026-10-02 after explicit action-time confirmation and exact absence readback; see the [retirement receipt](simplification-implementation.md#transfer-key-retirement-on-2026-10-02).

Existing native Plan/API and public CLI/HTTP/artifact regressions verify the required failure paths, including cancellation, repeated attempts, carried evidence, fresh capture reruns, and missing or expired artifacts. Hosted observation of every negative case is not required. Do not add a natural 24-hour expiry wait, forced artifact deletion, or global negative-queue gate.

Under O19, hosted restore remains **UNVERIFIED** and is not a required drill. The recorded normal capture/export proof retains its original implementation and date; it does not establish a hosted restore or later export behavior. O26 accepted preview retirement through CI, deployment, and Cloudflare readback; hosted health, old-cookie, and auth-denial probes remain **UNVERIFIED**, with drain inferred. O27 accepted a real signed `check_run` HTTP 202 and settled same-GUID receipt with real revocation, fresh sign-in with the same permissions, and safe replay; fresh App ping remains **UNVERIFIED**. These limits do not restore superseded gates or make unperformed probes pass.

## Implementation and evidence

Keep sealed-submission recovery in the current path. An active sealed run with no comparison can resume from its stored local Submit receipt. Preserve the eligibility query and receipt validation in [workflow materialization](../apps/web/src/api/workflow-materialize.ts); missing evidence must fail closed. This recovery is not obsolete legacy comparison work.

Use the [implementation record](simplification-implementation.md) to track source changes, conversion gates, tests, and remaining external work. Use the [development guide](development.md) for local and CI command scopes, current-schema fixtures, built-app checks, and performance measurements. The [deployment and release guide](../.github/workflows/README.md) owns execution instructions.

Convert retained approvals, baseline references, rendering identity, and closed history before removing their old readers. Follow the approved recovery scope above and the [current cutover guide](operations/simplification-cutover.md). Read back exact Cloudflare and Infisical state before removing a resource or grant. Record dated evidence after each cutover. Authorization does not establish that a gate passed.
