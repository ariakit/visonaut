# P03 and P04 follow-up research

Research only. No application or artifact files changed. Inspected the installed packages on 2026-09-29: `@tanstack/react-router` 1.170.38, router core 1.171.32, `@tanstack/react-start` 1.168.57, `@ariakit/react` 0.4.40, and its dependency `@ariakit/react-components` 0.6.1.

## P03 — Keep the selected route-loader direction

**Yes. A route loader is idiomatic TanStack Router.** The router already provides route loading, pending/error states, cancellation signals, and a cache. This change does not require TanStack Query. Use the run path parameter and only `comparison` in `loaderDeps`. Item and variant select from the same model. They must not become loader dependencies. Pass the loader signal through the request helper to `fetch`. Consume the result with `Route.useLoaderData()`. These are the documented APIs in the [TanStack loading guide](https://tanstack.com/router/latest/docs/guide/data-loading).

Proposed shape, with `readReview` extracted from the existing client:

```tsx
export const Route = createFileRoute("/runs/$runId")({
  // Keep the existing validateSearch.
  ssr: false,
  loaderDeps: ({ search }) => ({ comparison: search.comparison }),
  loader: ({ params, deps, abortController }) =>
    readReview(params.runId, deps.comparison, abortController.signal),
  gcTime: 0,
  pendingComponent: RunPending,
  errorComponent: RunError,
  component: Run,
});

function Run() {
  const model = Route.useLoaderData();
  // Keep commands and edit history local to this review session.
}
```

The explicit `ssr: false` is the smallest safe migration for the current client: it uses relative API paths and browser credentials. Start otherwise executes initial loaders on the server. If server-rendered review data is wanted, use an authenticated server function and return the model from it. That is a separate increase in scope, not a requirement for P03. [Start execution model](https://tanstack.com/start/latest/docs/framework/react/guide/execution-model), [selective SSR](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr).

Local evidence: `apps/web/src/routes/runs.$runId.tsx:14` has no loader; lines 79–103 create an AbortController but do not pass its signal to `loadReview`. `apps/web/src/review/client.ts:224` does not accept a signal. `client.ts:252–322` combines the model with command closures, a mutable comparison pointer, a session promise, and browser export behavior. Split this into `readReview` and `createReviewCommands`. Cache the model, not a mutable command session. `review-workspace.tsx:185–198` already owns edits and undo history. Keep that ownership; do not let a background route reload replace a pending save. Preserve the existing guest/403/retry behavior in the route boundary.

I suggest route-local `gcTime: 0` initially because the app loads a complete review and currently releases it on exit. It avoids keeping many inactive large models. Do not add global infinite freshness or automatic model preloads. If revisit caching is later justified, change this route's policy and measure retained memory. An alternative is the default Router cache; another is the much smaller signal-only patch, but that leaves the manual route state machine which the user has selected to remove.

**Verified:** A mounted `RouterProvider` in Chrome 154.0.8037.58, with the installed versions and a synthetic loader, made 1 call initially, still 1 after changing item+variant, 2 after changing comparison, and 3 after `router.invalidate({ sync: true })`. No extra `shouldReload` override was needed for these transitions. This was a memory-history behavior test, not an HTTP, SSR, authentication, cancellation, or performance test. Evidence: `/tmp/visonaut-loader-browser-probe.json`; harness `/tmp/visonaut-loader-browser.tsx` and `/tmp/visonaut-loader-browser-check.mjs`. Discard the earlier unmounted Node probe `/tmp/visonaut-loader-probe.json`; it does not represent mounted Router navigation.

Migration tests: stale request cancellation with real fetch; comparison change while a load is pending; guest and forbidden responses; retry; item/variant navigation without refetch; save/undo and explicit refresh without losing local session state.

## P04 — Use CompositeRenderer for the selected virtualization

**Yes. CompositeRenderer can implement the virtual item list.** Prefer it to adding a second virtualization library. It is not exported by the installed `@ariakit/react` facade. It is available at:

```tsx
import { CompositeRenderer } from
  "@ariakit/react-components/composite/composite-renderer";
```

Declare and pin `@ariakit/react-components` 0.6.1 directly if this path is used. Its installed README explicitly says that it is an internal dependency and does not follow semantic versioning. This caveat must remain visible in the choice. It is suitable for an Ariakit-owned application that accepts that coupling; it is not a promise that this is the stable facade API.

The installed renderer keeps the first, active, and last enabled rows mounted, adds position metadata, supports overscan, and passes the positioning style/ref/id to each rendered item. A fixed `itemSize` avoids measurement when row height can truly be fixed; omit it and use `estimatedItemSize` when labels can wrap. Do not clip useful labels just to force fixed height. Source: `@ariakit/react-components/src/composite/composite-renderer.tsx:168–218` and `src/collection/collection-renderer.tsx:553–654`; [upstream source location](https://github.com/ariakit/ariakit/blob/main/packages/ariakit-react-components/src/composite/composite-renderer.tsx). Installed package source was read because the web source fetch failed.

A focused integration shape is:

```tsx
<CompositeRenderer store={itemsStore} items={rows} estimatedItemSize={72}>
  {({ index, entry, ...itemProps }) => (
    <CompositeItem
      {...itemProps}
      key={itemProps.id}
      render={<Link to="/runs/$runId" params={params} search={entry.search} />}
    >
      <ReviewRow entry={entry} />
    </CompositeItem>
  )}
</CompositeRenderer>
```

This is an outline, not a product patch. Use stable IDs based on item keys, not the current index ID at `item-list.tsx:123`. Retain `ref`, `style`, ID, and the applicable ARIA metadata on the item element. Keep real link destinations. The renderer controls which rows exist; the item component and the product's navigation contract control role, selection, activation, and URL changes. U03's Tab/Link composition must use tab semantics, not the current `role="option"`. Do not add a duplicate array to the store only for this simple renderer case: the bounded probe did not require it.

**Verified:** A production React fixture with 1,000 stable anchor items, 40px rows and a 300px viewport mounted only 11–14 items. Thirty ArrowDown presses focused item 30, End focused 999, Home focused 0, and `store.move("item-700")` mounted/focused/scrolled to item 700; the next arrow focused 701. Anchor hrefs survived. No page errors. Chrome 154.0.8037.58. Evidence: `/tmp/visonaut-renderer-probe.json`; exact fixture `/tmp/visonaut-renderer-probe.tsx`; runner `/tmp/visonaut-renderer-check.mjs`.

These results prove basic renderer feasibility. They do not prove faster Visonaut rendering, variable-height behavior, screen-reader speech, Tab semantics, or rapid concurrent selection/save behavior. The earlier app measurements already show only 50 rows rendered through pagination. The main immediate benefit of P04 is continuous navigation without page boundaries; do not claim it fixes model transfer or parse cost.

Migration tests: move beyond a virtual window; Home/End and global next/previous; link open-in-new-tab; offscreen restored selection; selection moved into collapsed Accepted after save; filter/reorder stability; wrapped labels and zoom; back/forward URL state. Use the complete model for global navigation and stable keys for remembered variants. Keep server model loading separate from viewport scrolling. One renderer per visible group is simpler than introducing a general-purpose nested virtualization layer.
