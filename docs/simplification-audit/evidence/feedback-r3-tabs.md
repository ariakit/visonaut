# U06 automatic linked tabs, pinned-package probe

Decision input: maintainer selected `automatic` with no note. This settles U06 only. It does not change U03's URL-derived selection, real link destinations, or one-panel model.

## Current contract

- Visonaut pins `@ariakit/react@0.4.40` and `@tanstack/react-router@1.170.38` in `apps/web/package.json`.
- The copied `Tabs`/`TabProvider` wrapper forwards `selectedId`, `setSelectedId`, and `selectOnMove` to Ariakit (`apps/web/src/components/ariakit/components/tabs.ariakit.react.tsx:19-62`).
- Pinned Ariakit store `selectOnMove` selects on keyboard `moves`; its `Tab` click handler also calls `store.setSelectedId(id)` for all unprevented clicks. It does not test `metaKey`, `ctrlKey`, or mouse button. Route navigation through `setSelectedId` can therefore change the original page on modified link clicks.

Exact local source: `/Users/diegohaz/Developer/visonaut/node_modules/.pnpm/@ariakit+components@0.1.13/node_modules/@ariakit/components/src/tab/tab-store.ts:141-154`, `/Users/diegohaz/Developer/visonaut/node_modules/.pnpm/@ariakit+react-components@0.6.1_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@ariakit/react-components/src/tab/tab.tsx:60-67`, and `/Users/diegohaz/.codex/worktrees/1de3/visonaut/apps/web/src/components/ariakit/components/tabs.ariakit.react.tsx:19-62`.

## Small route pattern

```tsx
const selectedVariantId = variantFromUrl;

function onTabKeyDownCapture(event: React.KeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const list = event.currentTarget;
  const prior = document.activeElement;
  requestAnimationFrame(() => {
    const next = document.activeElement;
    if (next !== prior && next instanceof HTMLAnchorElement && list.contains(next)) {
      next.click();
    }
  });
}

<Tabs selectedId={selectedVariantId} selectOnMove={false}>
  <TabList aria-label="Variants" onKeyDownCapture={onTabKeyDownCapture}>
    <Tab id="light" render={<Link to="/runs/$runId" params={{ runId }} search={{ ...search, variant: "light" }} />}>Light</Tab>
    <Tab id="dark" render={<Link to="/runs/$runId" params={{ runId }} search={{ ...search, variant: "dark" }} />}>Dark</Tab>
  </TabList>
  <TabPanel single>{selectedImage}</TabPanel>
</Tabs>
```

This lets Ariakit move focus, then follows the focused Link only when keyboard focus changed inside the tab list. Link destinations own all click routing. The URL remains the selected-state source. A direct `navigate(...)` call using the focused tab's data is an alternative if synthetic `.click()` is undesirable; it passed the same probe but duplicates the link target.

## Browser observation

Disposable harness in this directory used the exact pinned versions, Chromium (Playwright 1.63.0), and real TanStack `Link` and router. It passed:

- ArrowRight changed URL search, selected tab, and panel together.
- Browser Back restored URL, selected tab, and panel.
- Programmatic focus alone did not navigate.
- Meta-click and middle-click opened a new tab at the focused variant without changing the original URL or selection.
- Ordinary click navigated. No page errors.

The probe has only two variants and no real image loads. It does not establish panel latency or screen-reader output. The W3C APG recommends automatic tab activation only when panel content appears without noticeable latency. Before product implementation, test real image loading, ArrowLeft/Right/Home/End, rapid key repeats, browser Back/Forward, direct URL, modifier and middle-click, and interaction with the page-wide review shortcuts.

The Chromium probe covered Meta-click on macOS and middle-click, not Ctrl-click on Windows. The disposable source and executable check are `/private/tmp/visonaut-u06-probe/router.tsx` and `/private/tmp/visonaut-u06-probe/router-probe.mjs`. The test used an HTTP preview at `127.0.0.1:4177` because module scripts do not load from `file://` in Chromium.

References: https://ariakit.com/examples/tab-react-router ; https://www.w3.org/WAI/ARIA/apg/patterns/tabs/ .
