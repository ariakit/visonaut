# Canonical contract snapshot

Source: https://github.com/ariakit/visonaut/issues/1

Read on 29 September 2026. This is an audit snapshot. The issue remains the current implementation contract. This audit proposes decisions; it does not change that contract.

Visonaut is Ariakit's visual regression capture, comparison, and review service. The merged [Ariakit cutover PR #7635](https://github.com/ariakit/ariakit/pull/7635) replaced in-repository reference screenshots with Visonaut captures. A complete post-merge `main` run established baseline revision 4. Group browser, theme, contrast, viewport, and framework captures as variants of one review item.

This issue is the canonical implementation handoff from maintainer-approved **design revision 9**. All 61 decision panels have answers. Preserve those choices except for the accepted Visonaut naming, capture-integration, launch-scope, and comparator changes below. The [selected ratio-only comparator](https://github.com/ariakit/visonaut/blob/main/docs/evidence/comparator-policy.md) is recorded. Target-scale runtime and numeric cost limits remain open in [#61](https://github.com/ariakit/visonaut/issues/61). The completed initial Ariakit cutover does not establish those measurements. Current readiness is tracked in [the implementation evidence](https://github.com/ariakit/visonaut/blob/main/docs/evidence/current-readiness.md); the original revision 9 evidence-status cells below are historical starting states.

## Source and authority

- [Complete revision 9 design and interactive prototypes](https://github.com/ariakit/visonaut/blob/main/docs/design-r9.html). Download the file or clone the repository and open it locally. It is self-contained, including example images, term help, all decisions, notes, alternatives, research, and feedback behavior.
- [Complete structured revision 9 record](https://github.com/ariakit/visonaut/blob/main/docs/design-r9.json).
- [Design-document verification history](https://github.com/ariakit/visonaut/blob/main/docs/design-verification.md).

The issue body is the current implementation contract. The archived HTML and JSON preserve the full design history and prototypes. Make future accepted contract changes in this issue body, and refresh the interactive companion when relevant. Do not reconstruct the contract from chat, local browser storage, or a continuation prompt containing only changed answers. Historical notes use “Visuaria” and revision 9 selected “Ariviso.” The accepted changes below supersede the corresponding historical naming, capture-integration, and launch-scope decisions.

The maintainer subsequently authorized implementation, Cloudflare and GitHub setup, the two npm releases, and Ariakit’s required-check cutover under the accepted launch-readiness focus below. The maintainer also authorized selecting conservative measured comparator and cost limits, with the decision documented. Alerts stay inside Visonaut. The maintainer registered `visonaut.com` in Cloudflare and authorized its use for launch.

## Accepted naming change, 22 September 2026

The project name is **Visonaut**. The source repository is `ariakit/visonaut`; the synthetic diagnostic repository is `ariakit/visonaut-diagnostics`. Both repositories are public; review data, private R2 objects, database contents, and service credentials remain private. The CLI target is `visonaut`, the adapter target is `@visonaut/playwright`, and active application identifiers, GitHub checks, Workers, databases, buckets, CI variables, documentation, and user-facing text must use Visonaut. The GitHub App display name is **Ariakit Visonaut** because GitHub reserves the exact name “Visonaut”; its App ID and existing installation stay the same. Historical frozen evidence retains its original Ariviso labels and resource IDs so its hashes and provenance remain valid. New Cloudflare resources must be verified before old live resources are retired. The service uses `visonaut.com` for production, `preview.visonaut.com` and `diagnostics.visonaut.com` for isolated environments, and `hooks.visonaut.com` for the GitHub webhook gateway. The published-package and initial Ariakit cutover gates have been met; remaining measured limits stay tracked below.

## Accepted capture integration simplification, 23–25 September 2026

Ariakit's existing `visual()` helper uses Visonaut directly, with explicit stable item keys. Do not add a `VISONAUT_CAPTURE` flag, a separate page map, or a permanent Ariakit executor directory. The existing screenshot assertions stayed through diagnostics and left with [cutover PR #7635](https://github.com/ariakit/ariakit/pull/7635). Ariakit's required Gate now verifies Visonaut when App is selected, and the fresh post-merge `main` capture established baseline revision 4. Merged [PR #7663](https://github.com/ariakit/ariakit/pull/7663) aligned Ariakit's workflow with the selected ratio-only policy; its full post-merge visual matrix and single signed Submit passed on [`f238a8b`](https://github.com/ariakit/ariakit/commit/f238a8bd347a723b22c26a0e4f863cdd55d595e2).

The capture matrix and completion dependency live in Ariakit's existing `app.yml`, called by `ci.yml` for `main` and path-selected collaborator PRs targeting `main`. Ariakit merge-queue integration is deferred because its active main ruleset has no merge queue. The service pins the reviewed `app.yml` Git blob and signed job identity; a candidate workflow change cannot silently change the trusted job set. The app workflow owns its browser/OS matrix, package pin, OIDC-free visual jobs, and one signed Submit job that needs the complete visual matrix without an `always()` override. There is no separate diagnostics workflow in Ariakit, trusted-plan JSON file, expected-shard registration, or duplicate shard list in Visonaut.

Install the published `@visonaut/playwright` adapter through Ariakit's `app/package.json` and the published `visonaut` CLI through the root `package.json`; exclude their package names from pnpm's minimum release age so new approved versions can be installed promptly. Ariakit's existing visual jobs run the `@visual` tests and call `visonaut pack` directly without GitHub OIDC. Each job uploads one short-lived encrypted pack as a GitHub artifact. One signed `Visual / Submit` job downloads both packs and calls `visonaut submit --bundle linux=<file> --bundle safari=<file>` once. It decrypts and validates the packs, combines their captures, uploads them through the Worker, and records submit intent. This job uses a separate OIDC-enabled runner, installs the exact published `visonaut` CLI with pnpm and lifecycle scripts disabled, and does not check out or execute candidate PR dependencies. The manifest remains internal to the capture directory, not a public CLI flag. There is no public `finalize` command.

The service stages the combined bundle under its verified repository, run, attempt, and signed Submit job identity. It accepts submission only from the pinned Submit job, then verifies that job succeeded and supplied a validated combined bundle. The pinned `needs: visual` dependency prevents Submit from running when any visual matrix job fails or is skipped. The outer CI workflow may still be running or may later fail Gate. A missing, failed, skipped, or unsubmitted capture cannot pass the App check or become a confirmed removal. A Submit rerun may reuse encrypted packs from successful visual jobs that GitHub did not rerun under D38; a rerun visual job must provide fresh evidence. Ariakit's required Gate must include the App workflow result whenever path-based CI selects App and verify the separate Visonaut App check on the tested SHA. The App check is not a repository-wide required check for docs-only PRs that do not run App. A caller workflow change cannot make a selected App run pass without the signed capture and Visonaut result.

The visual jobs record their OS and font profiles with the captures. The signed Submit job validates these reported profiles but does not independently remeasure the capture machines. Do not maintain a large precomputed profile-digest catalog. A new or incompatible profile must appear as changed and require review; it cannot silently reuse an acceptance from a different profile. The production project selected `visible-ratio-v3` in project revision 263. Merged [PR #7663](https://github.com/ariakit/ariakit/pull/7663) aligned the trusted Ariakit capture policy digest; historical comparisons keep their recorded policy and digest.

The combined bundle counts as one staged shard under the current 512 MiB distinct-image limit. The measured Ariakit run fits this bound. The September 26 maintainer decision raises only active-run admission to five after an Ariakit main Submit reached the former two-slot cap; it does not establish five-run throughput or recurring cost. [Target-scale capacity remains open](https://github.com/ariakit/visonaut/issues/1#issuecomment-5828975060); do not raise the byte ceilings or claim a workload and cost pass without evidence.

## Accepted launch-readiness focus, 25 September 2026

The maintainer authorized the initial Ariakit cutover and moved nonessential measurements and extended edge-case checks to separate Visonaut issues. The cutover is complete. This section supersedes earlier wording that made every original E01–E08 measurement a pre-cutover gate. Do not mark an unmeasured result as passed; preserve its limitation and follow-up link. Keep the functional checks fail-closed.

The cutover bar is the current 1,058-variant Ariakit workload: published and provenance-verified packages; recorded comparison policy; production GitHub authentication and signed capture; complete pinned visual jobs and one Submit; a sealed production review with real approval, Reject, Undo, and App-check recovery; authenticated in-app desktop Chromium keyboard use, accepted for launch on September 26 with native Chrome confirmation deferred to [review follow-up #62](https://github.com/ariakit/visonaut/issues/62); an approved current-head Ariakit PR with passing Gate and Visonaut check; and a verified image-bearing production backup that can be restored into isolated D1 and R2. Keep the existing 512 MiB bundle and 2 GiB original-byte run limits. Set production and preview active-run admission to five under the September 26 maintainer decision, while keeping physical D1 and SQL byte stops. This is an operational concurrency choice, not a measured five-run capacity or cost pass. Do not start a large synthetic stress run as part of cutover. The cutover PR merged, Ariakit Gate is required, and a fresh full `main` run established baseline revision 4. A missing image, failed job, pending review, or failed service check must not become a passing Gate.

The authoritative hosted comparison-memory peak, approximately 10,580-capture target, delayed billable-usage attribution, retained-byte churn, and numeric monthly incremental cost limit move to [runtime and cost #61](https://github.com/ariakit/visonaut/issues/61). This launch makes no target-scale or exact-bill claim. Extended two-session/recompare/status races, export-download confirmation, and clearer pre-baseline review wording move to [review follow-up #62](https://github.com/ariakit/visonaut/issues/62). A timed production-snapshot RTO and longer observed Cron cadence move to [recovery follow-up #63](https://github.com/ariakit/visonaut/issues/63). Scheduling fairness between large backups and baseline promotion moves to [operations follow-up #115](https://github.com/ariakit/visonaut/issues/115). The existing production backup restore and two observed image-bearing backup slots are sufficient for the initial manual recovery path; they do not certify an RTO or guarantee future Cron delivery.

## Product and project boundaries

- Public monorepo: `ariakit/visonaut`. Ariakit is the first and only launch client. The review app and review data are for Ariakit maintainers.
- Public package targets: **`visonaut` is the only CLI package**; **`@visonaut/playwright` is the capture adapter and reporter**. Use `@visonaut/*` for other public libraries only when needed. Do not create `@visonaut/cli` or an empty name-reservation package. Package/scope control remains to be proved. The authorized service domain is `visonaut.com`.
- Use pnpm, TypeScript, Better Auth with GitHub authentication, TanStack Start, Cloudflare, Oxc, Renovate, Changesets, Infisical, Lefthook, Vitest, Playwright, and a monorepo. Use Ariakit’s existing setup as the reference.
- Keep browser capture in Ariakit’s GitHub Actions runners. The service stores images, compares them independently, manages acceptance, and serves the review UI. A stored run must be recomparable without a new capture job from launch.
- At launch, support `main` and path-selected collaborator PRs targeting `main`. Ariakit currently restricts PRs to collaborators. External-fork capture and Ariakit merge-queue runs are out of scope at launch. Existing service-side merge-group support remains available for later integration work.
- Start with explicit stable item/variant keys and a **fresh first batch**. No baseline import, legacy filename map, or automatic title/path matching. Existing screenshots are workload evidence only.
- Review UI support targets **Chrome Desktop and keyboard-only operation**. For launch evidence, the maintainer accepts an authenticated in-app desktop Chromium keyboard check; native Chrome confirmation is deferred to [review follow-up #62](https://github.com/ariakit/visonaut/issues/62). Test focus, shortcuts/exclusions, readable states, and zoom. Other review browsers, mobile workflows, and screen-reader certification are deferred. This does not reduce the capture browser matrix.
- Preserve behavior and accessibility tests. Screenshots do not establish focus order or spoken labels.
- No customer billing, general signup, organization switcher, hosted browser farm, AI verdicts, automatic approval of visual flakiness, image editing, or comment system at launch.

## Implementation sequence and completion gates

These milestones record the historical implementation sequence and its original gates. The accepted launch-readiness focus above supersedes requirements that moved to follow-up issues; the completed cutover is recorded above.

1. **Foundation and bounded runtime probes.** Set up the monorepo/tooling, identify exact versions, and test Better Auth + D1 + TanStack Start on a deployed Worker under authorized preview scope. Test lossless WebP/PNG decoding, sRGB/alpha interpretation, deterministic comparison, and resource limits in the intended Worker runtime. Prepare and test the Container fallback when needed. Prove the SQL revision/atomicity pattern for review and promotion before building the full UI around it.
2. **Protocol and capture.** Implement explicit identity, prepared one-variant calls, compatible versioned manifests, stable capture, reporter retry selection, workflow-owned full-run accounting, OIDC capabilities, bounded upload, validation, and sealing. Build clean client-package fixtures.
3. **Service state and comparisons.** Implement stored captures, queue/reconciliation, immutable comparison revisions, exact acceptance reuse, automatic additions/removals, review conflicts, baseline promotion, rollback, retention, and repeat-safe GitHub status delivery.
4. **Review workspace and private app access.** Copy Ariakit UI components and recipes, build the chosen hierarchy and keyboard interactions, bind evidence readiness to action targets, and test the accepted launch review/Undo cases in authenticated in-app desktop Chromium, with native Chrome confirmation tracked in #62.
5. **Measured policy and operations.** Run the defect/noise study and select conservative comparator values from its evidence. Measure the expanded workload and select conservative numeric budgets with a documented calculation. Complete daily combined backup/manual restore, recovery/escalation behavior, public-package checks, and the entire evidence ledger.
6. **Authorized integration and cutover.** Prove GitHub behavior in a disposable repository, then run Visonaut jobs directly in Ariakit's path-selected app workflow while the existing screenshot assertions remain in the pre-cutover branch. Run a full Ariakit PR capture cycle. After all readiness evidence passes, require Gate with App and Visonaut for selected PRs before merging the cutover PR. Merge it, then seed the fresh full main baseline. Remove old Git screenshots with the cutover PR only after the new service, exports, and recovery path are usable. There is no optional production pilot. Ariakit merge-queue integration is deferred.

Each milestone needs its relevant tests and an evidence report with date, versions, environment, workload, result, and limitations. A selected plan or passing prototype does not pass production evidence. Do not change a settled rule to make a failed probe green. Use its selected fallback or return with a concrete proposed change.

## Capture identity and public client contract

An **item** is one visual state, for example `dialog/success/open`. A **variant** is a capture condition for that state. Framework is a variant dimension: equivalent React and Solid states share an item. Include explicit browser, theme, contrast, forced-colors, viewport, and framework metadata as needed. Keep high-contrast preference distinct from forced colors. Do not describe WebKit as branded Safari or browser emulation as proof of native Windows high-contrast behavior.

Stable item and variant keys are explicit. Display-name/title edits do not change identity. Preserve declared deterministic order. Reject duplicate item/variant keys in a run. A changed key produces an addition and removal, not an identity-preserving rename; both can be automatically eligible under their selected rules. There is no legacy import or implicit rename support.

Ariakit owns page preparation, variant iteration, cleanup, themes, viewport changes, and reloads. The adapter accepts an already prepared page and captures **one variant per call**. The reporter groups calls by item key. The selected API shape is a page function with explicit variant metadata. The following spelling illustrates the contract; finalize exact exports/types consistently within it:

```ts
import { visual } from "@visonaut/playwright";

await prepareDarkDialog(page);
await visual(page, {
  item: "dialog/success/open",
  name: "Success dialog",
  variant: {
    key: "react-chromium-dark",
    framework: "react",
    browser: "chromium",
    colorScheme: "dark",
  },
});

await prepareLightDialog(page);
await visual(page, {
  item: "dialog/success/open",
  name: "Success dialog",
  variant: {
    key: "react-chromium-light",
    framework: "react",
    browser: "chromium",
    colorScheme: "light",
  },
});
// Two calls, one item, two variants.
```

A preparation failure fails the test attempt. A missing required capture cannot become a success. Retain bounded screenshot stability equivalent to the existing assertion with the same effective capture options. Stable dimensions alone do not establish stable pixels. Timeout is a capture failure even for a new item. A one-shot screenshot must not silently remove the old assertion’s consecutive-image stability guarantee.

Separate stable identity from the capture profile. Record browser version, OS image digest, fonts, viewport, device scale, locale, time zone, animation policy, capture options, and comparison policy/engine versions. Environment changes must be visible and cannot silently reuse incompatible acceptance.

Illustrative internal capture data:

```ts
type Capture = {
  itemKey: string;
  variantKey: string;
  ordinal: number;
  dimensions: Record<string, string | number>;
  profileDigest: string;
  imageDigest: string;
  width: number;
  height: number;
  source: { file: string; titlePath: string[] };
};
```

The public protocol uses a versioned manifest, schema validation, stable identity/order, and compatible optional additions within a major version. Reject unknown major schemas clearly. Test old-client/new-server compatibility. Public release support starts with Ariakit’s pinned toolchain; record exact tested versions. Do not infer broad Node/Playwright support from that choice.

The CLI exposes **upload, submit, and status only** at launch. `upload` reads a capture directory and stages one signed job's validated data. `submit --run <id>` records the final trusted job's intent; `submit --dir <capture-directory>` is the one-upload-job convenience form. Status supports text and JSON. Capture/upload failures return nonzero. A successful upload or submit means data was accepted, not that visual review passed. The capture job does not wait for a person to review. Define and test exact flags and exit codes within this scope. Recompare and export belong in the web app; a larger maintenance CLI is an unselected alternative.

```sh
pnpm add -D visonaut @visonaut/playwright
pnpm exec visonaut status
```

Both initial `0.1.0` packages are published. Keep server code and secrets out of later published artifacts. Use Changesets and inspect packed files, declarations, and clean installs. Both packages have npm trusted publishers. Verify provenance on future releases. See [npm provenance limits](https://docs.npmjs.com/trusted-publishers/#automatic-provenance-generation).

## Trusted runs, upload, and retries

Only full runs are accepted at launch. The service-approved `app.yml` Git blob owns the suite invocation and capture matrix. The pinned Submit job depends on every visual matrix job. The service verifies that signed job's successful completion and combined bundle against GitHub's workflow records, rather than trusting a PR manifest claim such as `coverage: "full"`. Changes to the pinned app workflow need a deliberate rollout. Incomplete bundles are refused; they cannot infer removals, satisfy the required check, or promote a baseline.

Keep two retry levels separate:

- **Playwright test retry:** record test identity and retry index independently from workflow run/attempt and shard. Use captures from the **final successful test attempt** before sealing. If a test captures blue, fails later, retries, captures green, and passes, only green is eligible. Earlier failed-attempt images are private diagnostics. Exhausted retries or missing captures fail the run. Retry success is not visual approval.
- **Workflow failed-job rerun:** reuse encrypted packs only from successful visual jobs that were **not rerun**, at the same tested SHA and pinned workflow source. Keep their source-attempt records. An explicitly rerun visual job must provide its new successful pack; a failed rerun cannot fall back to old success. The current signed Submit job combines the selected packs and supplies a fresh validated bundle. Missing or incompatible evidence leaves the new attempt incomplete and asks for a full rerun. Late old uploads cannot overwrite the selected attempt.

Use GitHub OIDC and short-lived write-only capabilities. Verify issuer, audience, expiry, repository IDs, pinned app workflow source, ref, run, attempt, exact job identity, and actual tested commit against trusted GitHub metadata. A signature proves job identity, not screenshot truth. Upload capabilities may stage bounded data but cannot read private data, submit from another job, review, approve, or promote. The signed Submit job uploads and records intent; service reconciliation determines completion.

Image bytes pass through the Worker into private quarantine. Bind each upload ticket to the run, object key, type, and maximum bytes. Treat submitted content as data; never execute capture manifests or install PR packages in the ingest service. Compute hashes from the bytes on the trusted side; submitted hashes are not proof. Validate format, encoded/decoded sizes, dimensions, total bytes, digest, and supported color data. Short-lived encrypted GitHub artifacts carry the visual jobs' packs to the signed Submit job; bounded Worker upload remains the selected service-ingest transport. Validate pack paths, entries, expansion limits, and image bytes before ingest. Presigned service uploads remain an alternative.

A run seals after the pinned signed Submit job succeeds and its combined bundle is validated. The outer CI Gate may still be running or may have failed while visual review is pending. Validate counts, unique identities, hashes, and profiles. A duplicate shard with the same digest is harmless; a different payload under the same identity is a conflict. An older attempt cannot overwrite a newer active attempt. No files, incomplete captures, corrupt evidence, failed visual jobs, and unavailable required references cannot mean “no changes.”

Review begins only after sealing and all required service comparisons commit. A sealed run stays “comparing” while jobs remain. Upload success is separate from visual acceptance.

Illustrative internal endpoint boundaries:

```text
POST /v1/runs                  Reserve the signed upload attempt's staging identity
POST /v1/runs/:id/shards/:key   Declare manifest and required digests
PUT  /v1/uploads/:ticket       Write a bounded quarantine object
POST /v1/runs/:id/finalize      Internally validate and stage one signed job's bundle
POST /v1/runs/:externalId/submit Record intent from the signed final job
POST /v1/runs/:id/comparisons   Create a new comparison of stored captures
GET  /v1/runs/:id              Private state, errors, progress, review URL
GET  /images/:id               Public validated image bytes only
```

## Baselines and acceptance

**One generic rule:** a complete main capture becomes the baseline when every change has valid acceptance and all capture/comparison checks pass. Accept the full candidate snapshot together. Never mix individual approved images from separate pending main runs into a baseline.

This rule applies to merged PRs, direct-main commits, and the fresh initial batch. Wait for the actual full post-merge main capture to detect drift. For a direct-main commit, a failing check holds baseline promotion; it cannot block a push that already occurred. A valid unchanged run can promote without human review.

### Exact acceptance identity and source

An approval or automatic acceptance covers the complete tuple, not just candidate bytes:

```ts
type ApprovalIdentity = {
  projectId: string;
  itemKey: string;
  variantKey: string;
  referenceDigest: string | null; // null: intentional absent reference
  candidateDigest: string | null; // null: confirmed removal
  referenceProfileDigest: string | null;
  candidateProfileDigest: string | null;
  comparisonPolicyDigest: string;
};
```

Commit/run/snapshot IDs are separate provenance. Unrelated item changes must not invalidate an otherwise exact eligible tuple. Reuse requires the same tuple, still-valid source decision and revision, and verified related PR/retry/merge-group/main lineage. An unrelated unmerged PR cannot approve main merely because its pixels match.

Pin an accepted eligible ancestor snapshot before constructing a comparison. A visible comparison is immutable. If main advances, recompare stored captures in a **new comparison revision** and carry only exact eligible acceptance. Recomparison does not test combined new code; a current merge-result capture is still required. If Ariakit later enables a merge queue, its combined commit will need its own capture. Outside fresh setup, a missing eligible ancestor is an error, not permission to reset the baseline.

If a PR approved gray → blue and main has since accepted gray → red, the new red → blue comparison needs approval. If main already contains blue, the result is unchanged. The same exactness rule applies to automatically accepted additions and removals.

Reuse references the original decision and revision, not a copied detached verdict. Recheck before publishing success and before promotion. Rejection, Undo, or replacement of a source before promotion invalidates affected active comparisons and checks. Merely starting a new capture attempt does not revoke an existing valid acceptance. An already-promoted descendant requires the same current-promotion guards as rollback; do not silently revoke a later baseline.

### Automatic additions, variants, and removals

- Automatically accept the first valid introduction of a new item or variant, including the first complete main batch. Record an explicit automatic source, exact tuple, policy version, and source run; never invent a reviewer.
- First-introduction reservation is per verified PR/main lineage, not global across unrelated PRs. Independent PRs can introduce the same unused key independently. Main still compares the actual merge against its current accepted snapshot.
- Create first acceptance atomically only for the active eligible attempt after validation, sealing, and comparison. An old worker cannot establish first acceptance after supersession. Once recorded, exact eligible retries may reuse it.
- A new PR item captured as absent → blue cannot be automatically reaccepted as absent → green later in that lineage merely because main has no baseline for it yet. Changed tuples need review.
- **Confirmed removal:** a complete workflow-owned capture excludes a former item or variant and all required capture jobs succeed with validated bundles. Accept that removal automatically, retain a Removed row, and record its exact reference → absent tuple. Missing, failed, corrupt, or unavailable required captures remain errors, never removals.
- If a PR accepted blue → absent but main now compares red → absent, review the changed comparison. Do not mint a new automatic acceptance to bypass the earlier one.
- Before promotion, explicit rejection overrides automatic acceptance. A retry cannot recreate rejected or revoked acceptance. Undo of a saved rejection can restore the prior effective verdict, including automatic acceptance.
- Automatic service actions do not enter the maintainer’s session Undo stack. Keep identity/removal/acceptance metadata when historical bytes expire. Removal acceptance does not itself delete historical storage objects.
- A removed key that returns is a **restoration**, not a new first introduction. Reuse earlier absent → image acceptance only when the full tuple, profiles, policy, source revision, and verified lineage remain eligible. Removal alone does not revoke an otherwise eligible earlier acceptance; rejection or Undo does. Otherwise require review. Equal pixels alone are insufficient. An intentionally absent current reference differs from missing required reference bytes.

One current maintainer is enough when human approval is required, including the PR author.

### Promotion, concurrency, and ordering

Atomically check the accepted baseline revision, main ancestry, active run/comparison, and acceptance prerequisites before promotion. A delayed older run cannot replace a newer accepted snapshot. A later complete main run may pass an earlier pending run only when its full comparison resolves all inherited changes. If the baseline advances first, produce a new comparison revision and recheck acceptance.

The whole accepted candidate becomes the next baseline, including candidate bytes judged unchanged by the comparator’s tolerance. Test repeated tolerated changes; do not introduce a hidden separate baseline rule.

## Review commands, rejection, and Undo

Review commands bind to immutable comparison IDs and expected decision revisions. A command must use the evidence currently displayed, not an earlier selection’s pixels. Save through atomic, revision-checked state transitions with unique command IDs and an audit event. Retrying one command returns its existing result.

Use an atomic database operation for verdicts, command history, baseline transitions, audit, and pending external status work. D1 atomic batches alone are insufficient: a conditional update affecting zero rows does not fail a batch. Prove that stale writes cannot commit partial audit/outbox work. A stale command returns a conflict with current state and identifies the conflicting reviewer in the private UI.

Do not report a saved verdict before the server confirms it. Serialize or disable conflicting commands while saving. On disconnect show unsaved state; do not replay a stale approval against a new comparison.

Whole-item commands freeze all added, changed, and removed comparison IDs in the current sealed item. Show their target count and save as one undoable command. Unchanged captures need no verdict. Before promotion, whole-item actions may replace prior verdicts, including automatic acceptance. If any target is protected or stale, refuse the entire command, keep selection, and offer an eligible individual action; never silently skip targets.

Undo lasts for the **current review session only**. Reload clears the local command stack; the audit log persists. Restore the prior verdicts and original selection only if every target still has the revisions written by that command. Never undo another reviewer’s later command. The automatic service action itself creates no Undo entry.

There are three distinct post-promotion operations:

1. **D22: Undo your saved human approval.** Roll back its promotion atomically only while it is still current and all revision/evidence guards pass. Revoke the undone snapshot’s reference eligibility, invalidate active dependent comparisons/checks, and schedule recomparison. A retry cannot silently reinstate the revoked approval. Refuse a stale Undo after a later promotion and offer explicit recovery.
2. **D26: X on a human-approved variant in the current promoted run.** Any current maintainer may save a new rejection and restore the previous snapshot, including after reload and without the original approval command. Bind decision revision, promotion ID, and baseline revision. If a later promotion is current, refuse with no partial changes. The rejection overrides this main comparison’s effective approval; it does not reject unrelated comparisons simply because they reused the same PR acceptance. Keep the rejected capture for review, revoke rejected-snapshot reference eligibility, and update dependent active work. A on already-accepted history is a no-op and must not manufacture an Undo command.
3. **D24/D59: X on automatically accepted promoted history, including removals.** Keep acceptance, baseline, and GitHub result unchanged. Correct code and capture a new complete main run. An existing-image correction needs review. A correction that restores a removed identity follows D35 exact eligible reuse or needs review. There is no automatic action to Undo.

In a mixed snapshot, rejecting an eligible human-approved variant rolls back the complete snapshot, including automatic additions/removals, without revoking their separate automatic acceptance records. Targeting an automatic variant itself remains protected. Whole-item X must enforce this per target and refuse the whole command when a target is protected.

Undo of a saved D26 rejection is a **new audited command** that restores prior verdict and promotion together only if decision and baseline revisions still match the rejection’s result, required bytes remain, and all acceptance prerequisites hold. Compare revision numbers, not only snapshot IDs: moving away and back still makes an older command stale. Restoring a snapshot does not revive its old promotion command or an earlier rollback target. A later valid A can make the complete run eligible again under the generic rule; it bypasses no checks.

Keep the previous snapshot and all needed evidence while an available D22/D26/Undo operation can reference them, regardless of ordinary 30-day expiry.

## Review UI and keyboard behavior

Use compact, mostly flat neutral controls. Copy Ariakit UI recipes and components; keep attention on screenshot pixels. Build additional pieces from `frame`, `layer`, `text`, `edge`, `text-frame`, and related copied primitives. Group the recipe and React component in the same file when appropriate. A file may export only one of them when that is all it needs.

```text
components/button.tsx   exports button (Clava recipe) and Button (React)
components/frame.tsx    recipe and component
components/edge.ts      recipe only is valid
components/screenshot-viewer.tsx  component only is valid
```

Preserve the complete copied recipe and component behavior, including disabled-state handling. Do not copy the design’s illustrative recipe placeholder as implementation.

Layout and information order:

- Item list on the left; selected images in the center; review actions next to the result; commit/run identity above.
- Prioritize run identity, item name, full variant label, review state, image evidence, then secondary metadata. Show counts such as “2 of 6 need review,” not only “changed.” Counts and text must accompany color.
- One sidebar item groups all variants. Thumbnail always uses the item’s first declared candidate variant, not the selected variant. A wholly removed item uses its first reference variant. Build the list from the union of reference and candidate identities: candidate order first, then reference-only entries in reference order.
- Automatically accepted additions/removals remain visible, marked “Accepted automatically,” and are skipped by next-pending navigation. A saved rejection is reviewed but still fails the check.
- Side-by-side shows reference and candidate. Pixel diff paints differences red. New-only shows the full candidate, not browser fullscreen. Preserve zoom and image position when possible. Provide fit/100%/200% inspection without changing stored reference pixels.
- For a new image, distinguish an intentionally absent reference from a reference-load error. For a removal, F shows “Removed, no new image”; S shows the old image and a labeled empty pane. D is unavailable when either paired image is absent; keep the current view and explain why. A load failure is an error with Retry, not an unchanged/new/removed result.
- On selection, clear or cover stale pixels immediately. Show loading/error for the current comparison. Enable variant verdict actions only when its required evidence is ready. Whole-item review need not open every variant, but the displayed current item/comparison must be ready and command targets must be frozen.
- Keep a usable narrow layout with the list above the viewer and stacked comparison images. This is not a promise of certified mobile workflows at launch.

| Input | Contract |
| --- | --- |
| Up / Down | Previous/next visible item; stop at ends. Remember the last variant per item. First visit uses its first variant; if remembered key is absent, use first and announce fallback. |
| Left / Right | Move through declared variant order; visible controls reach all variants. |
| 1–6 | Select that position among the first six variants; absent positions do nothing. |
| A / X | Approve/reject the current variant. Ignore repeat keydown. After successful save, select next pending variant in visible order, wrapping once. If none remain, stay and announce completion. A refused action does not advance. |
| Shift+A / Shift+X | Approve/reject the whole sealed item as one command, with the per-target guards above. |
| S / D / F | Side-by-side / red pixel diff / full new image only. D is unavailable for additions/removals. |
| Cmd/Ctrl+Z | Undo the last eligible saved command in this review session; restore original selection. Leave native text-field Undo alone. |
| Tab / Escape | Reach controls through normal keyboard focus; close help/menus with Escape, never reject an image. |

Scope letter shortcuts to the focused review workspace. Ignore events in editable content, inputs, menus, and dialogs. Preserve native Cmd/Ctrl+A Select All and Cmd/Ctrl+X Cut. Provide visible buttons and a shortcut toggle. Use suitable Ariakit composite/tab semantics; do not add grid semantics unless the interaction is actually a grid. See [W3C character shortcuts](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html), [tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/), and [keyboard guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/).

## Service comparison and codecs

Independent service comparison is required from launch. Start with a separate comparison Worker behind Cloudflare Queues. Read validated originals from private R2, decode/compare them, write thumbnails/masks, and commit results in D1. Process bounded image pairs, not image bytes in queue messages. A stored run can be recomputed without capture CI.

Preserve exact originals. Accept **lossless WebP and PNG**, with a tested static 8-bit sRGB/RGBA contract. Test alpha and color interpretation for unprofiled inputs and Ariakit’s embedded sRGB profile; reject unknown profiles clearly. Reject lossy WebP, animation, invalid files, unsupported depth, and excessive decoded pixels. Lossless encoding does not guarantee identical bytes between encoders. Version any normalization. A thumbnail is never a baseline.

Validate PNG signature, chunks, CRC, bit depth, animation, dimensions, and supported color data before relying on a decoder. The researched jSquash example establishes Worker/WASM feasibility, not color correctness; its decoder source strips 16-bit input and does not prove profile normalization. Test WebP validation and decoding too. Recheck pinned library behavior during implementation.

**The production project selected `visible-ratio-v3`** in project revision 263, with `channelThreshold: 0` and `maxChangedRatio: 0.0005` (0.05%) and no absolute changed-pixel cap; its canonical JSON SHA-256 policy digest is `6a97812c0ad3a5e8e006904995e75f8f15671260fb2ee53d31a1527c7d990fd1`. The [measured decision](https://github.com/ariakit/visonaut/blob/main/docs/evidence/comparator-policy.md) tolerated all 12 differences among 10,746 repeated-capture pairs but missed 98 of 100 injected small defects. At 1,000 × 1,000 pixels, as many as 500 changed pixels can pass, including a 16-pixel missing stroke. A stored `main` recompare under the ratio policy classified all 1,058 variants unchanged and passed its Visonaut check. That stored run promoted accepted baseline revision 5 after 1,058 protected images were copied and verified. Merged [PR #7663](https://github.com/ariakit/ariakit/pull/7663) aligned Ariakit's capture policy. Its fresh `main` run on [`f238a8b`](https://github.com/ariakit/ariakit/commit/f238a8bd347a723b22c26a0e4f863cdd55d595e2) sealed all 1,058 variants unchanged under that policy, and the [D1 delivery receipt](https://github.com/ariakit/visonaut/blob/main/docs/evidence/ariakit-ratio-main-d1-20260927.json) records the [Visonaut App check](https://github.com/ariakit/ariakit/runs/108608911108) passing before baseline promotion; its protected snapshot was accepted as baseline revision 6 after all 1,058 images were copied and verified. The repeated-capture corpus does not establish a production false-positive rate, and this policy decision does not prove target-scale runtime, memory, or cost. Trusted service/project configuration owns effective policy and masks; a PR cannot relax its own gate or submit a trusted “unchanged” verdict. Earlier comparison revisions and acceptance tuples retain their immutable policy and digest; a policy or profile change cannot silently turn a failing comparison green.

Show changed pixel count, ratio, dimensions, engine, and threshold. Record engine, codec, profile, and policy versions with each immutable comparison revision. Size changes are changes. Test cumulative tolerated drift because accepted candidate bytes become the next baseline.

Workers are the first runtime, with a **tested Cloudflare Container fallback** behind the same independent comparison/queue contract if codec, color, memory, or CPU requirements cannot pass. Do not move authoritative comparison back to CI. Native decoder parity, resource use, Container lifecycle, and cost must be proved. Browser Rendering is not needed. Avoid extra coordinators unless required; a Container may use its required lifecycle support.

Queues deliver at least once. Use repeat-safe task identity, leases, bounded retry, dead-letter handling, and commit-once results for each comparison revision. Failed comparison leaves a visible incomplete run, not success. Reconciliation must recover the gap between sealed D1 state and queue publication, and re-enqueue missing work. Acknowledge only after a durable result.

Resource arithmetic is only planning evidence: a 1,248 × 1,650 pair plus full RGBA mask is about 23.6 MiB before codec copies; three 3,840 × 2,160 RGBA buffers are about 95 MiB. Worker memory is shared across concurrent invocations. The [final-run production telemetry](https://github.com/ariakit/visonaut/blob/main/docs/evidence/e07-final-source-compare-metrics-20260925.md) sampled up to 96,748,074 bytes of invocation-time isolate memory and 181.365 ms CPU; it is not a continuous memory peak or a target-scale capacity pass. Measure safe concurrency and authoritative hosted peak under [runtime and cost #61](https://github.com/ariakit/visonaut/issues/61).

## Authentication, authorization, and image privacy

Better Auth with GitHub login establishes identity. Use stable numeric GitHub user IDs. Grant private app access to users with **repository write permission or higher** on Ariakit. Login or organization membership alone does not grant access. Do not equate legacy permission strings directly with named roles; verify maintain/admin handling through the repository permission endpoint.

Use a GitHub App installation for repository permission checks, verified webhooks, run/workflow verification, ancestry as needed, and Checks API writes. Keep installation tokens separate from Better Auth user login tokens. Minimize permissions: metadata, Actions read, Checks write, PR read, plus Contents read only if needed for ancestry; team-members read is not required by the selected repository-write rule. Account email-read permission may be needed for GitHub sign-in. Confirm endpoint requirements in the integration probe.

Check **current permission for protected app reads and all review writes**, including rejection and Undo. D46’s selected five-minute protected-image cache is **inactive** after D13 made image URLs public. Do not silently use that choice to create a five-minute cache for private app metadata. A failed/expired permission check fails closed with a temporary service error; distinguish it from a confirmed non-maintainer. Client-side route guards are not an authorization boundary.

The app, run manifests, review data, labels, reviewer names, per-image verdicts, audit, quarantine, image-bearing traces/reports, and failed-attempt diagnostics remain private. Public image URLs are an explicit separate choice:

- Keep the R2 bucket private. The existing Worker’s public read-only `GET /images/:id` resolves a **validated image record**, serving only its original, thumbnail, or diff bytes.
- No arbitrary bucket paths, listing API, manifests, quarantine files, diagnostic objects, or private review metadata in that route. Keep metadata out of public keys and headers.
- Image requests need no maintainer cookie. Use strict image content types and `X-Content-Type-Options: nosniff`. Separate public image caching from private app responses.
- Anyone with a URL can view and copy pixels. Opaque URLs are not access control. Revoking app access cannot recall downloaded copies. Retention governs service objects, not copies held elsewhere.
- Public validated images do not authorize publishing a cleartext capture archive that also contains private metadata or diagnostics. OIDC ingest/quarantine remain private. Preview environments must not accept production sessions or access production image buckets.

Use secure HTTP-only same-site cookies, fixed trusted origins, server validation, and CSRF protection. Encrypt stored GitHub tokens. Separate production, preview, and local secrets with Infisical. No password signup or independent email invitations. Audit sign-in, review, Undo, promotion, and administrative access changes.

Keep the requested Better Auth + D1 stack and **block launch until a supported pinned setup passes** login, renewal, expiry, logout, private GitHub email, revocation, concurrent/aborted requests, and preview isolation. Do not silently replace auth storage because of an old issue report. The design cites historical transaction and session renewal failures; revalidate current behavior, not issue status alone.

## GitHub checks and cutover

Publish a distinct Visonaut GitHub App check on the **actual tested SHA**. Verify source head, target head, tested merge SHA, and run/attempt from GitHub. Service-side merge-group identity verification remains implemented, but Ariakit does not run merge-group capture at this launch. A later queue rollout must validate a real combined commit before it can require Visonaut there.

Public checks expose only a fixed allowlist: check name, tested commit, generic running/pass/fail status, and a sign-in review link. No thumbnails, item labels, reviewer names, per-image verdicts, or private details in check output, annotations, or logs. The review link grants no access itself.

Capture and Submit jobs can finish while the separate Visonaut check reports changes needing approval. Gate checks that App result when path selection runs App. Gate waits for a bounded period, then fails if review remains pending; after approval updates the App check, rerun Gate to pass. Do not keep browser capture jobs waiting for a person. Pending, rejected, incomplete, unavailable, or stale comparisons cannot make Gate pass. Eligible additions/removals can pass automatically.

Publish external status through an outbox that rereads current run, attempt, and comparison revisions. Serialize updates per external check, reconcile ambiguous failures, and refuse delayed success after rejection, Undo, supersession, or changed source acceptance. Test races explicitly.

The disposable-repository tests and separate Ariakit diagnostics preceded the cutover. The merged [cutover PR #7635](https://github.com/ariakit/ariakit/pull/7635) removed old screenshot assertions. Ariakit Gate is required and verifies the selected App workflow and its separate Visonaut App check; a fresh full `main` capture established baseline revision 4. The App check is not required on docs-only PRs that do not select App. An outage must not manufacture a passing result. Retain behavior tests.

## Storage, cost, retention, and recovery

Use private **R2 Standard** buckets per environment, **per-run objects**, verified content digests in metadata, D1 relationships, and protected accepted-baseline prefixes. Exact-byte cross-run deduplication is deferred. Generate thumbnails once and masks only for changed pairs; disposable masks can expire and be regenerated. Cloudflare Images and Infrequent Access remain alternatives, not defaults. A dedicated public image-delivery bucket/custom domain may be reconsidered if measured cost warrants its extra publication/copy lifecycle; never expose a mixed quarantine bucket or use development `r2.dev` as production delivery.

Closed, unpinned run images remain available for **30 days**. Keep active baselines, open reviews, pinned runs, rollback predecessors, and evidence needed by available commands beyond that window. Release pins only after all active comparison/review/recovery references are gone. Preserve identity and acceptance history after byte expiry.

R2 and D1 do not share a transaction. Reserve uploads, write/validate objects, then link them. Reconcile orphaned objects and interrupted imports; a failed link must not create a visible accepted capture. Copy a validated baseline snapshot to a protected prefix before switching its database pointer, and wait for the promotion lease before deleting expired run prefixes. Quarantine can use short age-based lifecycle rules; accepted originals cannot expire solely by object age. If deduplication is later chosen, use explicit deletion state and a grace period that blocks new references, not only a final race-prone reference check.

Plan for approximately **10,580 images per full run**, roughly 10× the measured count, with a lower but unmeasured mean size after splitting large composite captures and adding examples. Current source evidence is 1,058 lossless WebP images totaling 29,933,072 bytes, mean about 28.29 KB. All use lossless VP8L; 358 contain the same embedded sRGB profile. This does not prove the new codec’s color behavior or establish a future mean file size.

D54 selects **measure first, then approve numeric limits**. Measure compressed bytes, decoded pixels, original/derived writes and reads, staging/copy operations, retries, pinned history, backups, SQL/queue usage, Worker CPU/memory, comparison time, large review-list load, initial image display, and cached navigation. State workload, environment, and percentiles. Record the remaining target-scale latency, size, and incremental cost limits under [runtime and cost #61](https://github.com/ariakit/visonaut/issues/61); the initial cutover does not assert a pass for these limits. The draft $25/month and latency figures in alternatives were **not selected**.

The account already has Workers Paid and may have other R2 use. Do not charge a second fixed Workers subscription or allocate a separate free allowance to this project. Estimate incremental cost as `bill(existing account + Visonaut) - bill(existing account)` with rounding on each bill. Smaller files reduce storage, not object-operation count. The archived calculator’s 10 KB growth mean is an editable illustration, not a measured forecast or budget. At 10,580 × 10 KB × 20 full runs/day × 30 days, originals alone illustrate 63.48 GB and 6.348 million writes, about $27.81/month R2 with unused allowances; this excludes thumbnails, copies, pins, backups, compute, and other charges. Recheck provider prices for implementation estimates.

Provide **daily combined database and image backup with a tested manual restore**. Include manifests, profiles, snapshots, review history, and all originals required by accepted baselines and retained reviews. Database backup alone is insufficient. Keep **30 days of backup sets**, separate from live deletion. The selected proposed targets are **at most 24 hours of recent work lost** and **restoration within one working day**. The image-bearing production backup and isolated manual restore supported the initial cutover. A timed end-to-end production-snapshot RTO and longer observed Cron cadence remain open in [recovery follow-up #63](https://github.com/ariakit/visonaut/issues/63); the proposed targets are not measured guarantees. Restore must reapply current access and retention rules and recover referential integrity.

Use automatic recovery, reconciliation, bounded retry, and dead-letter handling first, then an actionable maintainer alert for persistent failure. Choose numeric timeout/escalation limits from measured workloads. Keep visible failure and safe manual recovery. Failure never becomes success merely to satisfy a budget. Any actual notification setup or sending must follow its later authorization.

## Monorepo and source reference

Illustrative workspace boundaries:

```text
apps/web/               TanStack Start, auth, API, review UI, Worker bindings
apps/compare/           Queue consumer and comparison Worker
packages/protocol/      Manifest schema, types, compatibility fixtures
packages/playwright/    Public @visonaut/playwright adapter and reporter
packages/cli/           Public visonaut CLI
packages/compare/       Internal deterministic comparison code
tooling/                Shared Oxc, TypeScript, Vitest, release configuration
```

Deploy web and comparison Workers separately so decode work does not consume request-handler resources. Start with project, capture profile, run, shard, item, variant, blob, capture, comparison, review command/event, and immutable baseline snapshot records. Branch state points to a snapshot with a revision counter. Unique constraints cover external run+attempt, shard identity, capture identity per run, and command ID.

Inspect Ariakit’s actual setup before choosing versions or copying files. The design research used commit [`3ebb722`](https://github.com/ariakit/ariakit/commit/3ebb72201d5b9380bbe65e603d52de2df6cf2496):

- [Capture helper](https://github.com/ariakit/ariakit/blob/3ebb72201d5b9380bbe65e603d52de2df6cf2496/app/src/test-utils/visual.ts): current title/ID/counter naming, viewport/style expansion, theme reload, WebP requests, and stable screenshot assertions.
- [Playwright configuration](https://github.com/ariakit/ariakit/blob/3ebb72201d5b9380bbe65e603d52de2df6cf2496/app/playwright.config.ts): capture projects and existing strict tolerances.
- [Capture workflow](https://github.com/ariakit/ariakit/blob/3ebb72201d5b9380bbe65e603d52de2df6cf2496/.github/workflows/app.yml) and [visual finalization](https://github.com/ariakit/ariakit/blob/3ebb72201d5b9380bbe65e603d52de2df6cf2496/.github/workflows/visual.yml).
- [Visual CI helper](https://github.com/ariakit/ariakit/blob/3ebb72201d5b9380bbe65e603d52de2df6cf2496/packages/ariakit-scripts/src/ci-visual.js).
- [Ariakit UI source](https://github.com/ariakit/ariakit/tree/3ebb72201d5b9380bbe65e603d52de2df6cf2496/packages/ariakit-ui/src), including complete style recipes and React wrappers. Use normal attribution/license requirements when copying.

The existing matrix uses Ubuntu Chromium/Firefox and macOS WebKit. Preserve reduced motion, disabled animations, font readiness, stable clipping, and theme preparation. Existing helper capture is gated by `CI=true` and `VISUAL_TEST=true`; the replacement integration must preserve intended CI-only capture behavior.

## Required evidence and acceptance tests

The 99 revision-9 Chromium checks validate the **local design artifact**, not an implemented service. They cover prototypes, selections, keyboard behavior, feedback migration/copy/export, tooltips, and layout. At the original design handoff, none of the following production rows had run. The `NOT RUN` cells are historical starting states; see [current readiness](https://github.com/ariakit/visonaut/blob/main/docs/evidence/current-readiness.md) for later results.

| Evidence | Required observation | Status |
| --- | --- | --- |
| E01 · Capture and comparison | Original-byte preservation for lossless WebP and PNG; tested sRGB/alpha fixtures and unknown-profile errors; corrupt and oversized images; stable capture and recovered retry behavior; defect/noise comparison study; measured peak memory and CPU; Container fallback if needed. | NOT RUN |
| E02 · Authentication and image boundary | Deployed login, renewal, expiry, logout, private email, revocation, concurrent/aborted requests, preview isolation, OIDC upload scope, public validated-image reads, private app/metadata/quarantine denial, cache separation, and R2 writes. | NOT RUN |
| E03 · Run and baseline state | Workflow-owned complete-run accounting, verified successful shard inheritance, supersession, source invalidation, exact eligible restoration reuse, atomic review/rollback/Undo, retained bytes, garbage-collection and delayed-check races. Confirmed removals versus missing captures; exact removal acceptance reuse and drift; rejection/retry/Undo; protected automatic-removal history; restoration with and without eligible earlier acceptance. | NOT RUN |
| E04 · Public client releases | Control of visonaut and @visonaut scope; only the bare visonaut package supplies the CLI, with no @visonaut/cli alias; exact supported versions; types; clean installs and pnpm exec visonaut status; compatibility fixtures; prepared capture calls, grouping, failures; CLI status/errors/exit behavior. | NOT RUN |
| E05 · Review UI and accessibility | Chrome Desktop keyboard review: all shortcuts and input exclusions, shortcut toggle, focus and navigation, readable states, image readiness and error recovery, additions/removals with D unavailable, zoom, and undo. Other review browsers, mobile workflows, and screen-reader certification are deferred; capture-browser coverage is unchanged. | NOT RUN |
| E06 · GitHub integration and launch | Actual tested SHA, collaborator authorization, path-selected PR/main capture, complete signed workflow-job accounting, full-suite Ariakit cycle, stale success refusal, and controlled cutover with required Gate. Real Ariakit merge-group capture is deferred. | NOT RUN |
| E07 · Performance and cost | About 10,580 split captures with measured mean bytes/pixels; original and derived operations, staging/copies, pins/backups, incremental shared-account platform cost, comparison time, large review load, and image/navigation latency. Select and document conservative numeric limits from the measurements. | NOT RUN |
| E08 · Recovery and operation | Consistent database-plus-image backups, dated restore drill, re-applied access/retention rules, reconciliation, bounded retry/dead-letter handling, and the chosen escalation path. | NOT RUN |

Minimum contract fixtures must include:

- Protocol versions/optional fields, unknown-major failure, duplicate identity, deterministic ordering, explicit keys, fresh automatic first baseline, old-client/new-server compatibility, title rename without identity change, key rename as addition/removal.
- Two prepared variant calls grouped into one item; caller preparation failure; changing pixels with stable dimensions; recovered versus exhausted test retries; successful GitHub capture jobs with missing staged bundles; identical versus conflicting shard replay; compatible inherited non-rerun jobs; failed rerun unable to reuse old success; superseded late uploads; subsets refused.
- Byte preservation, PNG/WebP equivalence and color/alpha fixtures, known versus unknown profiles, corrupt/truncated files, invalid chunks/checksums, oversized decode, changed size, fonts/animation/antialias noise, repeated tolerated drift, deterministic recomparison, Worker memory/CPU and tested Container fallback.
- First introduction per verified lineage, unrelated PRs unable to lend approval, drifted additions/removals requiring review, confirmed removal versus failed/missing capture, restoration with eligible and ineligible earlier acceptance, explicit rejection before promotion, retry unable to restore rejection, Undo restoring prior automatic verdict, source acceptance invalidation, out-of-order workers, stale SQL/outbox writes, changed baseline before promotion.
- One-maintainer/self approval, atomic whole-item commands and Undo, stale target conflict with no partial writes, direct-main promotion, D22 current/stale Undo, D26 current/stale human rejection after reload, mixed snapshot rollback without revoking automatic records, protected automatic history, protected whole-item X, historical A no-op, Undo of rejection with baseline revision guards, rollback byte pins, garbage-collection and promotion races.
- Private app/direct API authorization, public validated-image reads, arbitrary key/quarantine/manifest/diagnostic denial, public/private cache separation, access revocation, private GitHub email, cookie renewal/expiry/logout, CSRF/origin protection, aborted/concurrent auth requests, preview isolation, webhook signatures/replay, OIDC scope/attempt verification.
- Actual tested SHA, PR/main/rebase/squash/target-change/closed-PR behavior, stale-success refusal, approval updates after capture jobs end, generic public-check fields only, App checks bound to the intended GitHub App, and a full Ariakit diagnostic cycle before cutover. Service-side merge-group fixtures remain; real Ariakit merge-queue behavior is deferred.
- Chrome Desktop keyboard shortcuts, repeat suppression, editable/dialog/menu exclusions, shortcut toggle, boundary behavior, remembered variants, fallback announcements, whole-item count, loading/error evidence guards and Retry, absent-image D behavior, fit/zoom, selection restoration on Undo, command save/error states.
- Packed package contents without server code/secrets, declarations/exports, pinned-toolchain clean installs, bare CLI invocation with no scoped alias, command status/text/JSON/error behavior, backup/export completeness, restore drill, orphan recovery, queue reconciliation, bounded retry and actionable escalation.

## Settled decision ledger

This ledger includes every selected answer. The contract sections above supply cross-decision invariants and the original full record retains all options, examples, notes, and research. D46 is recorded but inactive for public image delivery. D49 and D61 reflect the explicit bare-CLI follow-up. Old names in historical notes do not reopen these choices.

| ID | Decision | Selected answer |
| --- | --- | --- |
| D01 | Where should Visonaut live? | Separate Visonaut monorepo |
| D02 | What does A or X change? | Current variant; separate whole-item actions |
| D03 | What should happen after approval or rejection? | Go to the next pending variant |
| D04 | Which variant should open when up/down changes the item? | Remember the last variant for each item |
| D05 | Should React and Solid share one item? | Framework is a variant dimension |
| D06 | How should the first adapter assign stable item keys? | Explicit stable keys; fresh first batch |
| D07 | What makes a main-branch run the accepted baseline? | Full post-merge capture with valid review coverage |
| D08 | Can approval carry across retries, rebases, or merge queues? | Reuse only exact eligible comparison tuples |
| D09 | Whose approval is enough to pass? | One maintainer, including the PR author |
| D10 | When should external fork pull requests get Visonaut runs? | Maintainer branches first |
| D11 | Must old runs be recomparable without a new CI job? | Independent service comparison at launch |
| D12 | Can maintainers review before all captures arrive? | Only after the run is sealed |
| D13 | Who can view screenshots and review results? | Private app and review data; public image URLs |
| D14 | How does Visonaut determine who is a maintainer? | Repository write permission or higher |
| D15 | How long should closed-run images remain available? | 30 days |
| D16 | Should launch storage deduplicate exact bytes across runs? | Per-run objects first |
| D17 | Which default visual direction fits review work? | Compact, mostly flat controls |
| D18 | Which parts need published packages at launch? | Publish the Playwright adapter and CLI |
| D19 | Which branches must the first release support? | Superseded on September 24: main and path-selected collaborator PRs targeting main; Ariakit merge-queue integration is deferred |
| D20 | When should Visonaut block merges? | Superseded on September 24: require Ariakit Gate after all readiness gates pass; Gate verifies the separate Visonaut check for selected App runs and can be rerun after approval |
| D21 | Which shortcuts should change the whole item? | Shift+A / Shift+X |
| D22 | What should undo do after approval made main the baseline? | Undo the promotion if it is still current |
| D23 | Should a new variant of an existing item be approved automatically? | Automatically approve new variants too |
| D24 | How should rejection work after automatic acceptance promoted main? | Keep the baseline; correct it in a new main capture |
| D25 | What may Visonaut show in Ariakit’s public GitHub checks? | Generic status plus a sign-in review link |
| D26 | Can A/X edit a human-approved run after it promoted main? | Allow X to reject and roll back the current promotion |
| D27 | Who prepares each variant in the public capture API? | Ariakit prepares it; capture one variant per call |
| D28 | When the next-pending search reaches the end, should it wrap? | Wrap once to the first pending variant |
| D29 | Where should removed items appear in the review list? | Candidate order, then removed items |
| D30 | What should D show for a new or removed image? | Make pixel diff unavailable for this case |
| D31 | Should my Undo history survive a page reload? | Current review session only |
| D32 | How should one prepared capture be called from a Playwright test? | A page function with explicit variant metadata |
| D33 | How should capture clients and the service evolve together? | Versioned manifest with compatible optional additions |
| D34 | Where is first automatic acceptance reserved for an unused key? | Per verified PR/main lineage |
| D35 | Should a removed identity need fresh approval when it returns? | Allow exact eligible earlier acceptance |
| D36 | May a later full main run pass an earlier pending run? | Yes, after a complete comparison |
| D37 | Should launch accept intentionally partial capture runs? | Accept full runs only at launch |
| D38 | How should failed-job-only workflow reruns work? | Reuse verified packs from successful visual jobs that GitHub did not rerun; the current signed Submit job always makes a fresh combined bundle |
| D39 | Where should the authoritative capture plan live? | Superseded on September 25: Ariakit’s pinned `app.yml` owns the visual matrix and single signed Submit dependency; the service reconciles its completed job and combined bundle |
| D40 | Which private capture upload path should launch use? | GitHub OIDC and short-lived capabilities |
| D41 | How should image bytes reach private quarantine? | Bounded upload through the Worker |
| D42 | Which image and color contract should launch accept? | Lossless WebP and PNG |
| D43 | Which pixel-difference policy should launch use? | `visible-ratio-v3`, 0.0005 changed-pixel ratio, no absolute pixel cap; production selection recorded at project revision 263, with Ariakit capture-digest alignment in merged [PR #7663](https://github.com/ariakit/ariakit/pull/7663) |
| D44 | How should the adapter confirm stable pixels? | Adapter preserves current assertion stability |
| D45 | What if the comparison Worker fails codec or resource tests? | Worker first; test a Container fallback |
| D46 | How long may image-read permission be cached? | Up to five minutes for reads |
| D47 | Which image storage and delivery path should launch use? | Private R2 Standard with public Worker image URLs |
| D48 | What if Better Auth with D1 fails deployed validation? | Keep D1 and block launch until a supported setup passes |
| D49 | What names should the public adapter and CLI use? | visonaut CLI and @visonaut/playwright adapter |
| D50 | Which toolchain must the first public release support? | Ariakit’s pinned toolchain first |
| D51 | Which operations should the public CLI expose at launch? | Superseded on September 25: pack, upload, submit, and status; Ariakit uses pack and one bundle-submit |
| D52 | What evidence must pass before the required check launches? | Complete the launch readiness set, with real Ariakit merge-queue evidence deferred |
| D53 | Which review-browser and accessibility paths must pass at launch? | Chrome Desktop and keyboard-only review |
| D54 | How should performance and cost limits be chosen? | Measure first, then select and document conservative numeric limits under the maintainer's implementation authorization |
| D55 | What recovery plan should launch provide? | Daily combined backup and tested manual restore |
| D56 | How should stalled service work reach a maintainer? | Automatic recovery, then an actionable alert inside Visonaut |
| D57 | Where should end-to-end GitHub behavior be proved before cutover? | Disposable repository, then separate Ariakit diagnostics |
| D58 | Can a recovered Playwright retry produce an eligible capture? | Use the final successful test attempt |
| D59 | Should confirmed removals be accepted automatically? | Automatically accept confirmed removals |
| D60 | Which project name should replace the current naming targets, if any? | Visonaut |
| D61 | What should the bare project-name package provide? | visonaut as the only CLI package |

## Alternatives, risks, and change control

The selected design rejects or defers: in-repo hosting as the project home; legacy image migration; CI-only authoritative comparison; adapter-owned variant iteration; subsets at launch; mandatory full-workflow reruns when verified shard inheritance is valid; human approval of every new item/variant/removal; read-only current human-approved history; rollback of automatically promoted history through X; cross-run byte deduplication; a public mixed R2 bucket; managed Images as the default; a scoped CLI alias; full maintenance commands in the launch CLI; broad review-browser/mobile/screen-reader certification; external-fork capture; and an optional production pilot. The full design records the alternatives and why they were not selected.

Remaining risks require evidence rather than another broad design round: codec/color correctness and runtime capacity; comparator defects versus rendering noise; atomic revision guards and cross-service reconciliation; exact GitHub provenance/merge behavior; auth adapter/session behavior; image-count-driven write cost; recovery and retained-byte integrity; and package/scope ownership. Recheck external documentation and versions during implementation. A primary-source example is not a production result.

If evidence requires a material change, state the failed condition, compare a smaller repair or selected fallback, and request a concrete revised decision. Update this issue’s contract and evidence in place after approval; keep the interactive companion current. Do not silently alter the policy or scatter specification changes across comments.

## Primary references retained for implementation

- [GitHub merge-group events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group), [job reruns](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs), [OIDC](https://docs.github.com/en/actions/reference/security/oidc), [Checks updates](https://docs.github.com/en/rest/checks/runs#update-a-check-run), [repository permissions](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user).
- [D1 batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/), [R2 bindings](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Queue limits](https://developers.cloudflare.com/queues/platform/limits/), [delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), [Container pricing](https://developers.cloudflare.com/containers/platform/pricing/).
- [Cloudflare TanStack Start guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/), [Better Auth TanStack integration](https://better-auth.com/docs/integrations/tanstack), [database adapter guidance](https://better-auth.com/docs/adapters/other-relational-databases).
- Historical Better Auth reports and fixes: [#4732](https://github.com/better-auth/better-auth/issues/4732), [#4733](https://github.com/better-auth/better-auth/pull/4733), [#4389](https://github.com/better-auth/better-auth/issues/4389), [#10315](https://github.com/better-auth/better-auth/issues/10315), [#10318](https://github.com/better-auth/better-auth/pull/10318). These describe failure modes in cited versions, not proof of current defects.
- [Playwright screenshot assertions](https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1), [PNG color specification](https://www.w3.org/TR/png-3/#11gAMA), [jSquash Worker example](https://raw.githubusercontent.com/jamsinclair/jSquash/main/examples/cloudflare-worker-esm-format/src/index.js), [decoder source](https://raw.githubusercontent.com/jamsinclair/jSquash/main/packages/png/codec/src/lib.rs).
- Prior-art evidence on retry/identity/subsets/merge queues is retained with version and outcome limits in the full design: Argos [SDK #262](https://github.com/argos-ci/argos-javascript/issues/262), [#1189](https://github.com/argos-ci/argos/issues/1189), [SDK #245](https://github.com/argos-ci/argos-javascript/issues/245); Chromatic [#1026](https://github.com/chromaui/chromatic-cli/issues/1026), [#1483](https://github.com/chromaui/chromatic-cli/issues/1483), [#1416](https://github.com/chromaui/chromatic-cli/issues/1416). An issue’s closed state does not prove a deployed fix.

<!-- ariviso-handoff-design-r9-complete -->



