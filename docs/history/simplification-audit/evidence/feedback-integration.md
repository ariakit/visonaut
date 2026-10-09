# Integration feedback research — 2026-09-29

Research only. No artifact or product files changed. Visonaut source: `7e23173d11b1081f55021ef498e4c5c6d6a08131`. Ariakit source: `fe73331c833108a7ce18e0df6ba04af9e83776b9`.

## A04 — Direct App check, conditional on Plan

The user has selected a direct Visonaut App check. Treat the selection as settled. The new note also settles the no-visual-needed outcome: when Plan successfully says that App is not needed, Visonaut must report success promptly. Do not ask whether docs-only changes should run captures.

### Verified current state

Read-only GitHub API access succeeded after the sandbox network failure. The effective `main` rules result on this date is:

```json
{
  "required_status_checks": [{ "context": "Gate", "integration_id": 15368 }],
  "strict_required_status_checks_policy": false,
  "do_not_enforce_on_create": false
}
```

`GET repos/ariakit/ariakit/branches/main/protection/required_status_checks` returned 404 `Branch not protected`. That is the legacy branch-protection endpoint. It does not negate the active ruleset above. Visonaut is not currently a separate required check. This replaces the earlier audit's “live rules unknown” limitation.

Ariakit `.github/workflows/ci.yml:17–48` runs Plan and exposes its outputs. `:59–69` runs App on main push or `needs.plan.outputs.app == 'true'`. `:118–151` makes Gate validate all planned workflow results. `:153–211` adds the visual review polling only when App succeeded. No `merge_group` trigger exists (`:3–7`); that scope remains deferred.

`packages/ariakit-scripts/src/ci.ts:391–440` computes the plan. `:660–675` requires selected jobs to succeed and unselected jobs to be skipped. `:701–707` emits both `app` and structured `plan` outputs. Plan is already the natural owner of this decision.

A local pure-function probe with the current `createCIPlan()` showed:

```text
README.md                              app=false; main
packages/ariakit-react/readme.md        app=false; main,docs
.changeset/sample.md                   app=false; main,release_preview
website/src/pages/index.tsx            app=false; main,plus
app/src/components/example.tsx         app=true;  main,app,perf,og_images
```

Thus, “no visual work” is broader than documentation at the repository root. Visonaut's `apps/web/src/api/pre-run.ts:53–77` contains a second, much smaller docs allowlist. It does not match Plan. Its old completion path (`:588–599`) sends `neutral`, but current webhook paths only record candidates: `apps/web/src/api/webhooks.ts:163–167`, `:294–297`, and `pre-run.ts:765–777` set `createCheck: false`. This is not a functioning Plan-driven immediate-success path.

GitHub rules can require a particular App source. Missing required checks wait; successful, neutral and skipped conclusions can satisfy a rule. The product should use explicit `success` for the selected no-visual-needed outcome and never use a skipped capture as proof that no capture was required. Sources: [required-check troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks), [ruleset requirements](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).

### Recommended minimal shape

Use one Plan result and one Visonaut check for the exact tested commit/run/attempt. Keep the required ordinary Gate. Remove its visual wait after the new path is verified. Require Visonaut from App ID `5028451` alongside Gate.

Add one small internal planning report to the trusted workflow integration. It sends the current run identity and **the actual existing Plan result** to Visonaut. The report occurs as soon as Plan ends, not after App or the whole workflow. It creates or updates the App check:

| Verified planning state | Visonaut result |
| --- | --- |
| Plan succeeded, App false | `completed / success`: “Visual capture is not required” |
| Plan succeeded, App true | Pending until complete signed capture and review |
| Plan failed or was cancelled | Explicit terminal failure/cancellation; Gate also blocks |
| Required capture failed, was cancelled, or never submitted | Explicit failure; never a no-visual success |
| Old run/attempt reports late | Ignore it for the current check |

Main pushes need no Plan result: the current policy always requires App there. Register them as required.

Illustrative private message, **not a new public CLI API**:

```ts
await reportVisualPlan({
  repositoryId,
  workflowRunId,
  workflowAttempt,
  testedSha,
  planResult: "success",
  required: plan.workflows.app,
});
```

Use the existing verified GitHub identity, App client and check/outbox machinery. Do not add another database, queue, shard list or path-filter table. Delete the separate docs allowlist once this replaces it.

The trusted sender must bind the reported boolean to the approved Plan implementation and its real successful output. OIDC proves the job identity, not that an arbitrary `required:false` input is true. Keep candidate capture jobs without OIDC. A small pinned reporter job may receive Plan's output, but trusting any caller-provided boolean without validating the approved caller wiring would weaken the current rule. Two concrete ways to retain that boundary are:

1. **Small trusted workflow integration (recommended):** the approved caller wiring passes `needs.plan.outputs.app` to the pinned reporting job. Verify that wiring/source, the successful Plan job and exact run identity. Keep the branch's current review/trust policy for edits to the planner explicit. If the contract requires the planner itself to be immutable, run the existing planner from an approved main revision; do not copy its path rules into Visonaut.
2. **One tiny Plan receipt:** Plan writes its result as a run/attempt-bound artifact; the service verifies the expected successful Plan job and receipt through the existing artifact-verification approach. This adds one artifact and retrieval path. It is justified only if report inputs cannot be bound to the trusted caller without more complexity. Do not execute the candidate-supplied receipt.

A service-side copy of Plan's filters is rejected: it creates two policies that can disagree. Inferring “not needed” from absent capture jobs is also rejected: absence can mean failure or cancellation.

### No normal path may wait forever

The planning message is an idempotent upsert keyed by run, attempt and tested SHA. A later required=true state must not be overwritten by an old false result. A new attempt must invalidate old visual success before Gate for that attempt can finish. A terminal workflow with no valid planning/capture report must settle the check as a visible failure through the existing reconciliation path. Keep a bounded deadline for genuinely lost work; do not maintain a second monitoring service.

A complete service/GitHub outage can temporarily prevent any remote update. Do not claim an impossible guarantee of instant completion in that case and never turn an outage into success. The CI report step should fail visibly, Gate should block, and retry/reconciliation should settle the existing check when service returns. The user requirement removes routine permanent waiting for planned skips; it does not authorize false success during an outage.

Tests before cutover: selected App, each representative app=false path above, Plan failure, cancellation before/after report, same-SHA rerun, stale false after current true, missing Submit, approval after CI completes, and report retry. Add the new App-specific required rule only after these pass, then remove the old visual poll in the same coordinated cutover. Merge-group probes are required only if that deferred scope is later enabled.

## A03 — Apply immediate removal across the project

The user has supplied a global development-stage constraint: one consumer, coordinated updates, remove superseded paths immediately. Remove deprecation windows and speculative old-client support from the selected implementation plan. This does not select still-open product policies or authorize data loss.

The living record should define this once and update these existing decision texts:

| Decisions | Required revision |
| --- | --- |
| A03 | Remove old owned runner, legacy signed upload path, obsolete exports, runtime lock/bootstrap and tests after updating the known consumer in the same work. No deprecation release or external-consumer inventory gate. Keep frozen evidence as evidence. |
| A01 | Replace copied setup and obsolete setup APIs in the coordinated change. Do not retain two public setup styles solely for compatibility. Keep only low-level primitives still used by the chosen implementation. |
| A02 | Remove old workflow/blob transition fields at cutover. Finish or cancel/restart old workflow attempts instead of maintaining dual accepted sources for a compatibility window. |
| A04 | Remove the Gate polling script after the new conditional check path passes. Version control is sufficient rollback for code; no inactive legacy wait implementation is needed. |
| P01 | Update server response and the sole UI consumer together. Remove the old response parser and version branch. Stale open browser tabs should get one clear reload/version error if needed, not an indefinite old API. |
| C03 | Update capture producer, profile interpretation and service together. No compatibility writer or old-manifest upload branch solely for old clients. Preserve historic immutable profile/policy identities or convert data once with verification. |
| S04 | Drain or explicitly cancel/recreate old work before removing the old queue-message decoder. Do not keep a second message format just for rollout convenience. |
| S01/S05/S06 | If a selected storage change changes object/record format, use one explicit, verified data conversion, then one live read path. Remove dual readers. A fresh reset is a separate choice if conversion is unnecessary; the development label alone does not authorize deleting retained evidence. |
| S02 | The “keep legacy restore tools indefinitely” alternative conflicts with the new global constraint unless the user separately chooses to keep a real legacy recovery promise. Verify whether retained backup sets exist; convert/export them or explicitly retire that promise, then remove the tools. |
| C01/C02 | Use one current review policy after the chosen cutover. Remove parallel old/new behavior engines. Keep old decisions and source attribution as read-only facts; do not mutate past approval semantics to make a new result pass. |
| C04/O03/O04 | Retire the unselected production backend/router/deploy path after confirming current resources and in-flight work. Keep an experimental probe only if it remains a current selected research tool, not as a compatibility fallback. |
| O02 | After the selected credential source works, revoke/remove the old identity. Do not maintain duplicate active credential ownership or an arbitrary rollback window. Secrets are not preserved by Git rollback. |
| U01/U02/U03, Q02/Q04 | Replace old UI and duplicate test/script paths in the coordinated change. Preserve required observable behavior, not obsolete implementation wrappers. |

Safety exceptions are narrow, based on current state, and have an exit condition: active runs, queued messages, accepted baseline bytes, retained records, current auth credentials, and already applied database migrations. For example, drain a queue rather than silently dropping signed work; verify a new bucket before deleting the old one; keep a historic migration ledger rather than rewriting it to look new. These are data-integrity and deployment-order requirements, not backward-compatibility product promises. If the user wants a complete reset of retained data, put that explicit destructive decision in the record first.

Do not preserve deprecated APIs merely because npm versions have been published. Do not unpublish old package versions as part of source cleanup. Update the one consumer and the release together. Old historical version artifacts can remain in the registry without a live compatibility branch in this codebase.

## U03 — Tabs can be real links through render

The user's correction is valid. Do not frame this as “links versus tabs” or imply that tabs lose URLs. A tab can be an anchor and still have tab semantics.

Actual Ariakit UI source at `packages/ariakit-ui/src/components/tabs.ariakit.react.tsx:66–73` extends `ak.TabProps` and forwards remaining props to `ak.Tab`. Visonaut's current copied file has the same behavior at `apps/web/src/components/ariakit/components/tabs.ariakit.react.tsx:63–70`. `Tabs` forwards controlled `selectedId` and `selectOnMove` (`:20–50` in the copy). The upstream implementation gives the element `role=tab`, selected state, panel control and composite keyboard behavior; the `render` element supplies the anchor. [Tab render reference](https://ariakit.com/reference/tab#render) and the [official router tabs example](https://ariakit.com/examples/tab-react-router) support this composition.

```tsx
<Tabs selectedId={selectedVariantId} selectOnMove={false}>
  <TabList aria-label="Variants">
    <Tab
      id={variant.id}
      render={<Link to="/runs/$runId" params={{ runId }} search={{ item, variant: variant.id }} />}
    >
      {variant.label}
    </Tab>
  </TabList>
  <TabPanel single>{selectedImage}</TabPanel>
</Tabs>
```

This is a proposed TanStack routing sketch. Exact route/search types must match Visonaut's existing route API. Do not add another local selected-variant state if the route already owns it. Keep `selectedId` derived from the route, including Back/Forward and direct links. Manual activation (`selectOnMove={false}`) preserves separate focus movement: arrows can focus another tab without loading its image; Enter activates the link. If the current shortcut policy selects immediately, preserve that explicit policy rather than silently changing it.

### Local browser probe result

An isolated fixture imported **Visonaut's actual copied Tabs components**, used installed `@ariakit/react@0.4.40`, rendered `Tab render={<a href="#light"/>}` and `Tab render={<a href="#dark"/>}`, controlled selection from the URL and used manual activation.

```text
Rendered elements: A[href="#light"][role="tab"], A[href="#dark"][role="tab"]
Initial: Light selected
Tab, ArrowRight: Dark focused; URL unchanged; Light still selected
Enter: URL #dark; Dark selected; Dark panel displayed
Back: URL restored; Light selected again
Cmd-click Dark (macOS Chromium): new tab #dark selected; original URL and Light selection unchanged
Middle-click Dark: new tab #dark selected; original URL and Light selection unchanged
```

The probe passed. The sole console error was the fixture's missing favicon (404). The temporary server and browser are stopped. Sources and CLI snapshots remain under `/tmp/visonaut-tab-link-probe/`; no audit artifact file was edited. This proves the actual component's anchor composition, basic keyboard/history path, and native Cmd-click/middle-click new-tab behavior in macOS Chromium. It does not prove TanStack Link composition, pending route transitions, 200% zoom or screen-reader output. Verify those relevant paths when editing the real prototype/app.

Keep navigation in the rendered Link. Do **not** also navigate from `Tabs.setSelectedId`: Ariakit Tab's click handler calls `setSelectedId` after the incoming click handler unless the event was prevented (`packages/ariakit-react-components/src/tab/tab.tsx:74–78`). A router's modifier guard can run later in its composed handler. A navigation callback there could change the current route on Cmd-click even though the anchor correctly opens another tab. The passing probe uses URL-derived `selectedId`, `selectOnMove={false}`, and **no** `setSelectedId` callback. This is the safe contract to verify with TanStack Link in the actual app.

Use native links in the item Nav and anchor-rendered Tabs for the variant panel. Preserve PR #104's first-pending target for item links and D04's separate remembered keyboard variant behavior. Link targets, tab semantics, and keyboard selection policy are distinct choices; the render prop allows the selected design to keep all three.
