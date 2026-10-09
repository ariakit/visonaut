# UI feedback research — 2026-09-29

This report refines the user's selected decisions. It does not change the product or the audit artifact. The accepted option IDs stay `U03: nav-tabs`, `U04: global`, and `U05: task-first`. Integration owns the final routed-tab experiment. Performance owns the CompositeRenderer experiment.

## U03 — Keep `nav-tabs`; render variant tabs as real links

User note: “Tabs should render links as well (with the render prop)”.

This fits the selected option. The copied `TabProps` extends `ak.TabProps`, and `Tab` forwards the non-style props to `ak.Tab`. The copied `TabPanel single` uses the selected tab ID. No new tab wrapper or parallel selected state is needed.

Source:

- [Tabs composition and Tab render forwarding](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/components/ariakit/components/tabs.ariakit.react.tsx:23).
- [Single shared panel](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/components/ariakit/components/tabs.ariakit.react.tsx:190).
- [Current variants already have TanStack destinations](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/review/review-workspace.tsx:732).
- [Current route selection replaces search state](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/routes/runs.$runId.tsx:36).

Minimal manual-activation shape, consistent with the official [Ariakit routed-tabs example](https://ariakit.com/examples/tab-react-router):

```tsx
<Tabs selectedId={variant.id} selectOnMove={false}>
  <TabList aria-label="Variants">
    {item.variants.map((entry) => (
      <Tab
        key={entry.id}
        id={entry.id}
        render={
          <Link
            to="/runs/$runId"
            params={{ runId: route.runId }}
            search={{
              comparison: route.comparisonId,
              item: item.key,
              variant: entry.key,
            }}
          />
        }
      >
        <TabLabel>{entry.label}</TabLabel>
      </Tab>
    ))}
  </TabList>
  <TabPanel single>{/* One current ScreenshotViewer. */}</TabPanel>
</Tabs>
```

This is a source-grounded example, not a product patch. The selected ID must use the same ID as each Tab. URL search remains the state source. Keep existing comparison, item, and variant URL meanings. Item links still target first pending; keyboard item navigation retains the explicit variant memory established by D04 and PR #104. The item list remains navigation, not a variant tablist.

Activation is material to the implementation. Manual tabs let left/right move tab focus, then Enter/Space activate the link; global shortcuts still select variants when a control did not consume the key. Automatic tabs would select immediately on arrow movement, as the current variant Composite does, but need a route callback. Installed Tab calls `setSelectedId` on every unprevented click. TanStack calls the incoming click handler before its own modifier check. A naive `setSelectedId={navigate}` can therefore change the current route on Cmd/Ctrl-click. Do not claim native link behavior is complete until ordinary click, Enter, Space, modified click, middle click, and browser Back are verified. The integration agent is running this check; prefer its verified result over this provisional snippet.

The [APG tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) permits manual activation and recommends automatic activation only when content appears without noticeable latency. Neither choice needs separate panels for every screenshot. A single routed panel avoids mounting every viewer.

## U04 — Keep `global`; extend the listener to the review document

User note: “I also noticed that those shortcuts only work when I focus the page body or an inner element. But it should work globally.”

**Decision result:** Keep `global`. The note specifies its scope; it does not select a different model. Change any “retain current behavior” text to “page-wide review shortcuts with pan controls”. This is an explicit change from workspace scope to document scope. No new confirmation is needed.

Evidence:

- [Current keyboard handler](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/review/review-workspace.tsx:579) is attached only to [Shell.onKeyDown](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/review/review-workspace.tsx:612). Keys from the real document body or the route header outside this Shell cannot reach that handler. A listener on `ownerDocument` will receive them.
- [Current exclusions](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/review/review-workspace.tsx:68) protect inputs, textareas, selects, contenteditable, textbox, menu, menubar, dialog, and alertdialog.
- The handler already checks `defaultPrevented`, repeat, the shortcuts switch, Alt, and Ctrl/Meta. It handles arrow item/variant navigation, 1–6, A/X, Shift+A/X, S/D/F/G, and Cmd/Ctrl+Z. Its existing save guards remain applicable.
- [Current help](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/review/review-workspace.tsx:151) explicitly says workspace scope. This copy must change.
- [Current pan controls](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/components/screenshot-viewer.tsx:65) already scroll each pane by half its viewport size. Four buttons appear when an image is present and zoom is not Fit. Their accessible names include image identity and direction. This is retained behavior, not a new widget.

Minimal behavior:

1. While a review session is mounted, listen on its `ownerDocument` in the bubbling phase. Remove the listener when the session unmounts. A review route still loading or showing an auth/error screen has no active review shortcuts.
2. Do not require focus on the Shell. Keys work after the page opens, after pointer use, and from the route header, image, or ordinary review buttons.
3. Controls that consume a key run first. Honor `defaultPrevented`; retain the current input/menu/dialog exclusions and ignore IME composition. This keeps text editing, menu movement, dialog handling, tablist movement, and native select behavior intact. Do not use a document capture listener to win over controls.
4. Keep the current key map and end boundaries. Do not synthesize clicks or force focus to the Shell to make global keys work. Existing deliberate focus restoration after save/Undo is a separate settled behavior.
5. Keep the visible Shortcuts on/off control. When off, native scrolling works again and A/X are inactive. Keep browser modifier shortcuts; Cmd/Ctrl+Z remains the explicit existing review Undo exception outside editable fields.
6. Global means the active application document. A web page cannot receive keyboard input from the address bar, another browser tab, or another application. This is a platform boundary, not an extra permission or user decision.

Small implementation shape:

```tsx
// Use the DOM KeyboardEvent type for the existing handler.
const onKeyDown = (event: globalThis.KeyboardEvent) => {
  if (event.defaultPrevented || event.isComposing || event.repeat || !shortcuts) return;
  if (excludesShortcuts(event)) return;
  // Keep the existing key map and action guards here.
};

useEffect(() => {
  const document = workspace.current?.ownerDocument;
  if (!document) return;
  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}, [onKeyDown]);

return <Shell ref={workspace} tabIndex={0} aria-label="Review workspace">{/* … */}</Shell>;
```

This version reinstalls the small listener when the handler changes and cannot capture stale review state. A stable callback is also valid if the project already has an appropriate event hook; do not add a hotkey registry. Update `excludesShortcuts` to accept the native event shape. A native event target is nullable, so check it before the existing element test:

```ts
const target = event.target;
if (!target || !("nodeType" in target) || target.nodeType !== 1) return true;
// The existing closest(...) exclusion test follows.
```

Keep the existing pan behavior with copied UI composition:

```tsx
<ButtonGroup aria-label={`Pan ${label}`}>
  <Button aria-label={`Pan ${label} left`} onClick={() => pan(-1, 0)}>←</Button>
  <Button aria-label={`Pan ${label} right`} onClick={() => pan(1, 0)}>→</Button>
  <Button aria-label={`Pan ${label} up`} onClick={() => pan(0, -1)}>↑</Button>
  <Button aria-label={`Pan ${label} down`} onClick={() => pan(0, 1)}>↓</Button>
</ButtonGroup>
```

With global navigation enabled, arrows on the image change the selected comparison. Space/Enter on its pan buttons still scroll the image. Mouse wheel, touchpad, and direct scrolling remain available. This is the user's selected tradeoff. It must not be described as a new accessibility failure merely because the earlier recommendation differed. The retained off switch also supplies an off mechanism for single-character shortcuts under [WCAG 2.2, 2.1.4](https://www.w3.org/TR/WCAG22/#character-key-shortcuts). This is not a full accessibility certification.

Verification for implementation: initial body focus; outer app-header focus; image focus; each pan button by Enter/Space; filter text field; zoom select; open menu/help dialog; manual or automatic Tab arrow handling exactly once; Shortcuts off; IME composition; unmount and mount a different run; save pending/conflict/retry. Confirm no listener remains on the dashboard. No native screen-reader result has been collected for this follow-up.

Artifact change needed later: add an outer-header/body focus target to the U04 global model. Its current in-demo handler can demonstrate image interception but cannot prove document scope. A document listener in the audit page itself must be scoped to the active demonstration and must never intercept the answer controls or notes. A labelled isolated preview document is the cleanest way to test the complete page scope without interfering with the decision artifact.

## U05 — Keep `task-first`; show PR title and stable PR identity

User note: “I think we should also include the pull request title if possible.”

**Decision result:** Accept the title as part of `task-first`. Show `PR #123 · Fix dialog focus` before run ID, attempt, or SHA. Keep the PR number visible when the title is missing or duplicated. A title is display text; it must not identify the run or affect capture equivalence, acceptance, or authorization.

Source:

- [Current dashboard API](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/api/review.ts:666) selects the latest 100 rows and returns raw run state. It omits PR number/title and pending/rejected summary counts.
- [Current dashboard type](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/routes/index.tsx:26) lacks these fields too.
- [Review client already accepts optional run.title](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/review/client.ts:145), but [production review model](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/api/review.ts:516) does not populate it.
- [OIDC verification already fetches the full PR](/Users/diegohaz/.codex/worktrees/1de3/visonaut/packages/security/src/oidc.ts:269). [PR webhook processing already fetches the full PR](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/api/webhooks.ts:244). [Pre-run verification does the same](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/api/pre-run.ts:119). No dashboard request to GitHub is required to learn the title.
- [Run identity already stores pr:N](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/api/workflow-materialize.ts:473). Parse this trusted internal lineage into the response's `pullRequestNumber`; do not add a second PR identity store.
- [Processed webhook JSON is cleared](/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/api/webhooks.ts:302). Therefore reading old webhook payloads is not a viable title source.
- [Service status is derived](/Users/diegohaz/.codex/worktrees/1de3/visonaut/packages/service/src/service.ts:1541): raw `reviewing` can mean needs-review, rejected, passed, or needs-recompare. Do not label the raw state as “ready to review” without applying those rules.

Minimal data plan:

1. Add one nullable display-title field to the existing run row. Fill it from authenticated GitHub data already obtained during capture admission/materialization. Carry it as optional display metadata through existing evidence, or use the verified PR result at the existing call site; do not add a new PR table, title polling job, or fetch per dashboard row.
2. Keep this title outside immutable capture identity and equality checks. `workflow-materialize.ts:443` hashes the full `submit` object, so do not accidentally add mutable title text to that proof. Split display metadata from the object passed to proof hashing before introducing it. Do not reject old payloads that lack a title.
3. Existing verified PR events may update the display title on active rows for that project's `pr:N`. Otherwise it is the last title observed. Do not promise it is a live GitHub view. Old runs keep a PR-number fallback; a historical network backfill is not required.
4. Return optional title, PR number, display status, and review counts in the authenticated list response. Reuse the same title in the review header. Plain text React rendering is sufficient; no HTML or Markdown parser is needed.
5. Build the “Needs review” list from active runs with actionable comparison state, independently of the latest-history limit. A client-side filter of the current latest-100 response can hide older work. Use a bounded, paged query and shared status/count predicates. Do not call the multi-query `service.status()` once for every row or store a second set of status rules in the browser.

Display contract example:

```ts
interface DashboardRun {
  id: string;
  kind: "main" | "pull_request" | "merge_group";
  pullRequestNumber?: number;
  title?: string;
  status: string;
  pending: number;
  rejected: number;
  // Existing testedSha, attempt, createdAt remain available in details.
}
```

```tsx
<Frame render={<section />} $p="1rem" $gap="0.75rem">
  <h2>Needs review</h2>
  {runs.map((run) => (
    <Frame key={run.id} $p="0.75rem" $gap="0.5rem" $border>
      <h3>{run.title || (run.pullRequestNumber ? `PR #${run.pullRequestNumber}` : "Main")}</h3>
      {run.title && run.pullRequestNumber && <p>PR #{run.pullRequestNumber}</p>}
      <p>{run.pending} comparisons need review</p>
      <Button render={<Link to="/runs/$runId" params={{ runId: run.id }} />}>
        Review changes
      </Button>
    </Frame>
  ))}
</Frame>
```

The snippet shows the hierarchy only; use the copied recipes' supported variants and the app's typed route/search contract in the patch. Long titles wrap; ID, PR number, status, and primary action stay readable at narrow widths. Use Main/Merge queue fallback according to `kind`, not the simplified fallback above. Keep failure/incomplete states separate from reviewable work with their existing next actions. Keep the existing OperationsAttention details secondary; a title feature does not need another operational dashboard.

Verification for implementation: long title; punctuation and `<script>` as literal text; missing title/old record; PR renamed during a run; same title for two PRs; non-PR run; title absent from identity/digest comparisons; closed/superseded rows excluded from current review work; pending work older than the newest 100 history rows; count/status parity with the review page; no extra dashboard GitHub calls and no per-row status-query loop.

## P04 / U03 integration — virtual navigation remains navigation

CompositeRenderer can remove the bespoke page-window/focus machinery, but it is a renderer, not a role choice. Upstream code adds first/active/last persistent indices and item-position metadata. Use stable item IDs and pass renderer item props to the actual CompositeItem/anchor. Keep the selected item registered when it leaves the rendered viewport. Preserve current URL destinations and variant-memory rules; do not let the virtualizer create a second router state.

With Nav links, do not copy `role="option"` back into the list just because the renderer supports Composite. The UI still needs a named navigation region and real anchors. Confirm that the renderer's position attributes apply to the chosen semantic structure. Virtualization also removes offscreen links from browser find and from the static accessibility tree. The local item filter supplies a direct route to a known name. Keyboard tests must include the last item, scroll to a distant item, selection outside the current window, and a selected item moving into Accepted after save/Undo. Do not require every item to remain mounted to make these pass.

The performance agent tested the installed lower package 0.6.1 with production React and Chrome 154. In a synthetic 1,000-anchor list with fixed 40px rows and a 300px viewport, 11–14 elements stayed mounted. Thirty ArrowDown presses reached item 30; End reached 999; Home returned to 0; `store.move("item-700")` mounted, focused, and scrolled to 700; the next arrow reached 701. Anchor hrefs were preserved and no errors were reported. The store did not need a duplicate full item array in this case. Evidence: [/tmp/visonaut-renderer-probe.json](/tmp/visonaut-renderer-probe.json) and [/tmp/visonaut-renderer-probe.tsx](/tmp/visonaut-renderer-probe.tsx).

This is feasibility evidence, not a measured Visonaut speedup, router integration test, or accessibility certification. The probe uses listbox/option roles, so its passing results do not establish the final U03 navigation semantics. The lower package says its internal API does not follow semantic versioning. If chosen, use an explicit pinned dependency for that package instead of depending on the transitive package through `@ariakit/react`. The performance report owns the exact export path and dependency decision.
