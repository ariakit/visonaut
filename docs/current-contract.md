# Current implementation contract

This index records the 45 explicit selections in [Visonaut · Less to maintain, revision 6](simplification-audit/index.html). All policies are settled. It is the short repository contract selected by Q03, prepared locally for the implementation authorized on 2026-09-29. GitHub publication and the issue redirect have not occurred. Until that authority handoff, [issue #1](https://github.com/ariakit/visonaut/issues/1) remains the published contract.

Every [saved issue #1 requirement](simplification-audit/contract-issue-1.md) remains binding unless a selected decision below explicitly supersedes it. A historical label does not remove an unaffected requirement, compatibility promise, or evidence limit. The [handoff supersession map](simplification-audit/handoff-draft.md#rules-that-supersede-issue-1) gives the scope of each replacement. The [61 earlier decisions and notes](simplification-audit/prior-r9.json), [revision 9 design](design-r9.html), and dated evidence remain preserved as history.

The audit source is Visonaut [`7e23173`](https://github.com/ariakit/visonaut/commit/7e23173d11b1081f55021ef498e4c5c6d6a08131) and Ariakit [`fe73331`](https://github.com/ariakit/ariakit/commit/fe73331c833108a7ce18e0df6ba04af9e83776b9). New implementation checks must name their source commit and working diff. No deployment date is claimed by this index. Source inspection cannot prove the current Cloudflare inventory, retained state, Infisical grants, GitHub rules, or deployed package versions.

## Selected rules

Each link opens the exact question, selected answer, alternatives, migration, tests, and evidence. These selections do not turn unverified implementation or deployment work into a completed check.

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

Capture trust still binds the tested commit, exact workflow attempt, signed Submit, and complete shard set. Missing, failed, stale, or partial evidence must not pass the App check. An expired one-day capture artifact requires a full visual rerun when its verified source evidence is needed. A trusted Plan with `app=false` can report App success; `app=true` remains pending until capture and review pass. A missing or failed Plan must not report success.

Approval reuse needs exact image, rendering profile, comparison policy, item, variant, and allowed lineage identity. C02 gives a verified copied approval to the new run; later edits to the source do not revoke that copy. C01 makes promoted history read-only. A correction requires a new complete main run. Active baselines and open reviews pin every original they need. A missing required original is a failure. Closed-run summaries must not promise image replay after unpinned bytes expire.

Private reads may reuse a positive GitHub permission result for the same valid session, user, and repository for at most 60 seconds. Writes always check current permission. Preview uses isolated fixtures without GitHub login or production App sessions. Production owns the live App webhook and bounded failed-delivery recovery, followed by an actionable alert.

The manual release publishes every eligible public package in the reviewed Changesets plan from the checked main source. One `latest` or `next` tag applies to that plan. Publication uses npm OIDC. Source publication does not promise byte equality with a previous archive. Verify package contents, registry version, integrity, provenance, and requested tag before reporting success.

## Implementation and evidence

Use the [implementation record](simplification-implementation.md) to track source changes, conversion gates, tests, and remaining external work. Use the [development guide](development.md) for local and CI command scopes, current-schema fixtures, built-app checks, and performance measurements. The [deployment and release guide](../.github/workflows/README.md) owns execution instructions.

Convert retained approvals, baseline references, rendering identity, and closed history before removing their old readers. Rehearse recovery on isolated resources. Read back Cloudflare and Infisical state before removing a resource or grant. Record the evidence and verified deployment date after each cutover. Implementation authorization does not establish that these gates have passed.
