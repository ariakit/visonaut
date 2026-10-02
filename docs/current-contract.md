# Current implementation contract

This document became the current repository contract when [PR #205](https://github.com/ariakit/visonaut/pull/205) merged on 2026-10-02. The [pinned issue #1 notice](https://github.com/ariakit/visonaut/issues/1#issuecomment-5958332349) records the authority handoff and preserves the complete historical issue body. The repository contract retains the 45 explicit selections in [Visonaut · Less to maintain, revision 6](simplification-audit/index.html) and records the later approved review, integration, and release rules below.

Only an explicit approved change supersedes a requirement. An unselected question or a passing source check does not change the contract or complete a live cutover.

Every [saved issue #1 requirement](simplification-audit/contract-issue-1.md) remains binding unless an explicit approved rule below supersedes it. A historical label does not remove an unaffected requirement, compatibility promise, or evidence limit. The [handoff supersession map](simplification-audit/handoff-draft.md#rules-that-supersede-issue-1) gives the scope of each replacement. The [61 earlier decisions and notes](simplification-audit/prior-r9.json), [revision 9 design](design-r9.html), and dated evidence remain preserved as history.

The frozen audit source is Visonaut [`7e23173`](https://github.com/ariakit/visonaut/commit/7e23173d11b1081f55021ef498e4c5c6d6a08131) and Ariakit [`fe73331`](https://github.com/ariakit/ariakit/commit/fe73331c833108a7ce18e0df6ba04af9e83776b9). New evidence must name its source and scope. Use this document for current requirements, the [implementation record](simplification-implementation.md) for dated proof, and the [deployment and release guide](../.github/workflows/README.md) for execution. The frozen design, audit, and issue body are not separate current authorities.

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
| [C05](simplification-audit/index.html#C05) | Keep the selected 0.05% allowance                     |
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

Production uses the existing Cloudflare Workers, with one D1 database and separate IMAGES and QUARANTINE R2 buckets in each environment. Comparison runs in the Worker. The repository retains a separate Container probe configuration for independently authorized diagnostics; the former production and preview Container resources are retired. No hosted diagnostic run is authorized by this contract. Infisical supplies only the two deployment credentials from the dedicated project's `prod` root path `/`, with imports and recursive reads disabled. Runtime auth and App secrets remain in Cloudflare. Standard Wrangler deployment owns declared bindings, routes, consumers, cron, and observability.

## Later approved review changes

[PR #184](https://github.com/ariakit/visonaut/pull/184) implements the maintainer's later review feedback. Run views and variants use navigation links with a bar glider; variant links replace the original U03 tabs. The UI can show the requested verdict and advance while saving. Only server-confirmed decisions count as saved, and failed writes restore prior local state.

The maintainer also selected server storage for pending decisions, with processing continuing after the window closes. Separate human [PR #190](https://github.com/ariakit/visonaut/pull/190), merged as [`8ebf821`](https://github.com/ariakit/visonaut/commit/8ebf821681791a66c2d87e8803be9883a486f326), implements a durable review queue in D1. Authorized queued submissions return HTTP 202 after admission. Server operations process linked stored decisions in order. The client distinguishes sending, queued, and saved decisions; a queue receipt is not a saved verdict. Unsent decisions still require the browser. Admitted commands survive its closure, and failed commands remain visible through their receipts. Pending commands block promotion. This source behavior and the separate deployment are verified; no hosted window-close probe or production latency measurement is claimed.

A valid unchanged comparison with zero measured changed pixels needs no review solely because capture profiles differ. Comparison still runs for differing profiles and records their identities. Nonzero differences keep the selected 0.05% allowance and existing review rules. This exception does not make profiles interchangeable or relax the exact identities needed to copy an approval. Immutable comparison and promoted-history rules remain binding.

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

Use the [implementation record](simplification-implementation.md) to track source changes, conversion gates, tests, and remaining external work. Use the [development guide](development.md) for local and CI command scopes, current-schema fixtures, built-app checks, and performance measurements. The [deployment and release guide](../.github/workflows/README.md) owns execution instructions.

Convert retained approvals, baseline references, rendering identity, and closed history before removing their old readers. Follow the approved recovery scope above and the [current cutover guide](operations/simplification-cutover.md). Read back exact Cloudflare and Infisical state before removing a resource or grant. Record dated evidence after each cutover. Authorization does not establish that a gate passed.
