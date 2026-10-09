# Responsive behavior, accessibility, keyboard, theming, and motion

Lane key: `ui-a11y`. Finding prefix: `A11Y`. Audit date: 2026-10-05. Read-only audit.

Scope: `apps/web/src/routes`, `apps/web/src/components`, `apps/web/src/review`.
All measurements used Chrome through Playwright against the two dev servers (ports 4310 and 4311).
Scratch directory: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-a11y/` (called `$S` below). Screenshots are in `$S/screens`. Raw data is in `$S/data`.

Stated product scope, for context: `docs/review-guide.md:94` says "Launch review validation targets Chrome Desktop and keyboard operation. Mobile workflows, other review browsers, and screen-reader certification have separate validation scope." Findings about mobile and screen readers are outside that launch scope. They are still input for the redesign.

## How it works (map)

### Document, CSS, and scheme

1. `apps/web/src/routes/__root.tsx:5-16` sets `lang="en"`, the viewport meta (`width=device-width, initial-scale=1`), and one static title: `{ title: "Visonaut" }` (line 10). No route sets another title.
2. `__root.tsx:23-26` runs a head script (`review/sidebar-preference.ts:5-9`) that copies `localStorage["visonaut.review.sidebar"]` to `<html data-review-sidebar-open>`.
3. CSS entry: `styles.css` imports `review.css`, which imports `tailwindcss` and `components/ariakit/styles/ui.css`.
4. Scheme: `ui.css:75-82` changes `--color-canvas` inside `@variant dark`. No `@custom-variant dark` exists, so `dark` is the Tailwind default: `@media (prefers-color-scheme: dark)`. `@ariakit/tailwind` adds `:root { color-scheme: light dark; }` (`node_modules/@ariakit/tailwind/src/output.css:66-71`). `ak-dark` and `ak-light` are container style queries on the color of each layer (`output.css:77-87`). Result: all colors derive from the canvas color, and the canvas color follows the operating system only. There is no toggle and no stored theme.
5. `output.css:68-70` raises `--contrast` under `prefers-contrast: more`. Some recipes have `forced-colors:` rules (`frame.ariakit.react.tsx:172`, `styles/control.ts:89`, `styles/glider.ts:220-234`).
6. Units: spacing and radius are in `em` (`ui.css:16-18`: `--radius: 0.25em; --spacing: 0.25em`). Tailwind text utilities (`text-xs`, `text-sm`) are in `rem`. The app also uses fixed pixel sizes: `text-[10px]`, `text-[11px]`, `text-[13px]` (18 places, see A11Y-18).
7. Motion: shell transitions read `--shell-motion`, which is `0` under reduced motion (`styles/shell.ts:27`). Popovers use `motion-reduce:transition-none` (`styles/popover.ts:34`). Gliders (`styles/glider.ts:150-153`) and the press scale (`styles/active.ts:8,38`) have no reduced-motion rule.

### Pages

- Every page is a `Shell` with `AppHeader` (`components/app-shell.tsx:21-71`): brand link (`<a href="/">`, line 29), a horizontal `Nav` with three plain `<a href>` links (lines 46-65), and an end slot. Labels hide below `sm` (line 62). The brand text hides below `lg` (line 33). The repository name hides below `xl` (line 38).
- `/` (`routes/index.tsx`): one client `fetch("/api/runs")` in an effect (lines 176-210). States: `loading`, `guest`, `forbidden`, `error`, `ready`. `?view=history` and `?view=service` select the view.
- `/pulls/$pullNumber` (`routes/pulls.$pullNumber.tsx`): one card with the states loading, guest, forbidden, error, pending.
- `/runs/$runId` (`routes/runs.$runId.tsx`): `ssr: false` (line 31). The loader fetches the model. The pending component is one line of text (lines 66-74).

### Review workspace layout (`review/review-workspace.tsx:527-1298`)

```
Shell  tabIndex=0  aria-label="Review workspace"            (528-534)
├─ AppHeader                                                 (535)
├─ ShellSidebar #review-screenshots  $show="5xl"  <aside>    (536-561)  item list
├─ ShellMain                                                 (562)
│  ├─ ShellMainHeader: toggle · Queue · run title · progress (563-608)
│  ├─ ShellMainIntro: sha · attempt · baseline · status      (609-622)  10px, 50% opacity
│  └─ ShellMainBody
│     ├─ [narrow] "Screenshots" button                       (625-632)
│     ├─ h1 item name + status badge + changed pixels        (633-650)
│     ├─ prev / next / Details                               (651-687)
│     ├─ banners (role status / alert)                       (689-710)
│     ├─ Nav "Variants" (links, aria-current)                (712-782)
│     ├─ view modes + zoom (aria-pressed buttons)            (817-923)
│     ├─ ScreenshotViewer (1 to 3 panes)                     (992-1000)
│     └─ sticky "Review actions" bar                         (1017-1139)
├─ ShellSidebar #capture-details  $side="end"                (1142-1171)
├─ ShellFooter: help · Shortcuts on/off · Recompare · live   (1172-1205)
└─ 3 ak.Dialog: items (narrow), details (narrow), batch      (1206-1296)
```

Responsive switches:

- Container query `@5xl/shell` (64rem) shows the two sidebars and the sidebar toggle (`$show="5xl"` at lines 538 and 1147, `@max-5xl/shell:hidden` at line 570).
- JavaScript flag `narrow = matchMedia("(max-width: 1023px)")` (lines 211-225) selects where the item list and the details render: sidebar (`{!narrow && itemNavigation}`, line 559) or dialog (`{narrow && itemNavigation}`, line 1221).
- Image panes: `data-[mode=side]:md:grid-cols-2 max-md:grid-cols-1!` (`components/screenshot-viewer.tsx:211`). Each pane viewport is `h-[min(56vh,650px)] min-h-80 overflow-auto` with `tabIndex={0}` (lines 134-136).

### Keyboard sequence

1. One `keydown` listener on `document` (`review-workspace.tsx:443-448`) calls `onKeyDown` (lines 395-442).
2. It returns when `event.defaultPrevented`, `event.repeat`, or shortcuts are off (line 396).
3. It returns when the target is inside this selector (lines 94-96): `input, textarea, select, [contenteditable]…, [role="textbox"], [role="menu"], [role="menubar"], [role="dialog"], [role="alertdialog"], [role="tablist"], .review-variants, [data-screenshot-search]`.
4. It returns when Alt is down (line 398). `Cmd/Ctrl+Z` calls `undo()` (lines 400-405).
5. `[` toggles the sidebar when not narrow, then focuses the toggle (lines 407-411, 216-219).
6. Arrows change item or variant. `1`-`6` select a variant. `A` / `X` review. `Shift` makes it a whole-item review. `S` `D` `F` `G` set the view (lines 416-437).
7. Handled keys call `preventDefault()` (line 441).
8. After a decision, `use-review-session.ts:313-317` selects the next pending variant and calls `onFocus()`. `onFocus` is `workspace.current?.focus({ preventScroll: true })` (`review-workspace.tsx:248`). Undo does the same (`use-review-session.ts:465-470`).

Two more key handlers exist. The item list handles `ArrowUp`, `ArrowDown`, `Home`, `End` on a focused row (`review/item-list.tsx:316-339`). The variant strip handles `ArrowLeft`, `ArrowRight`, `Home`, `End` on a focused pill (`review-workspace.tsx:99-121`).

### Every shortcut and where a user can discover it

| Key                   | Action                                   | Code                    | Where it is visible                                                              |
| --------------------- | ---------------------------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `↑` / `↓`             | Previous or next item                    | 416-419                 | `title` on two icon buttons (655, 666). Help dialog.                             |
| `←` / `→`             | Previous or next variant                 | 420-423                 | Help dialog only.                                                                |
| `1`-`6`               | Variant by position                      | 424-425                 | 10px number on the first six pills (`variant-summary.tsx:124-133`). Help dialog. |
| `A` / `X`             | Approve or reject, then next             | 426-429                 | Letter on each button (1078, 1096). Help dialog.                                 |
| `Shift+A` / `Shift+X` | Whole item, no confirmation              | 427, 429                | Help dialog only.                                                                |
| `S` `D` `F` `G`       | Compare, Difference, Current, Baseline   | 430-437                 | Letter on each button (846-889). Help dialog.                                    |
| `Cmd/Ctrl+Z`          | Undo                                     | 400-405                 | Help dialog only.                                                                |
| `[`                   | Toggle the item sidebar                  | 407-411                 | `title` and `aria-keyshortcuts` on the toggle (574-575). Help dialog.            |
| `↑` `↓` `Home` `End`  | Move in the item list (row focused)      | `item-list.tsx:324-331` | Not shown.                                                                       |
| `←` `→` `Home` `End`  | Move in the variant strip (pill focused) | 104-113                 | Not shown.                                                                       |

No key opens the help dialog (`?`), focuses the search (`/`), or opens a command list. The help dialog (`ShortcutHelp`, lines 147-189) opens only from an icon button in the footer (line 1178).

### Live regions

- Review: one visually hidden `role="status" aria-live="polite" aria-atomic="true"` in the footer (lines 1202-1204). The save state uses `role="status"` or `role="alert"` (lines 1104-1110). Evidence loading uses `role="status"` (lines 941-949).
- Dashboard: `OperationsAttention` has a visually hidden `role="status"` (`components/operations-attention/index.tsx:473-475`). Loading and error text use `role="status"` and `role="alert"` (`routes/index.tsx:276, 337`).

## Findings

### A11Y-01 · Shortcuts stop after a mouse click on a variant pill

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `review/review-workspace.tsx:94-96`: the exclusion selector contains `.review-variants`.
  - `review-workspace.tsx:729`: `className="review-variants max-w-full mb-4"` on the variant `Nav`.
  - Measurement K3 (`keyboard.mjs`, fixture): `{"focusAfterClick":"a \"2. Solid · Chromium · Light · 1280 × 720. Needs review\"","callsBefore":0,"callsAfterA":0,"modeAfterD":"side","h1AfterArrowDown":"Success dialog"}`.
  - Measurement K3b (real routed app, port 4310): `{"modeBefore":"side","modeAfterD":"side","modeAfterDFromWorkspaceRoot":"diff"}`.
- What happens: A click on a variant pill leaves focus on that link. The link is inside `.review-variants`, so the global handler ignores every key. `A`, `X`, `S`, `D`, `F`, `G`, `↑`, `↓`, and `1`-`6` do nothing until focus moves out of the strip.
- Impact: The most common mouse action (select a variant) disables the keyboard flow that the page promotes on its buttons. The page gives no feedback. A reviewer presses `A` and nothing happens.
- Recommendation: Exclude by key, not by region. The strip needs only its own navigation keys.

  ```ts
  // review-workspace.tsx
  const stripKeys = new Set(["ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "]);
  function excludesShortcuts(event: globalThis.KeyboardEvent) {
    const element = event.target as HTMLElement;
    if (element.closest(textEntrySelector)) return true; // inputs, menus, dialogs
    if (element.closest(".review-variants")) return stripKeys.has(event.key);
    return false;
  }
  ```

- Alternatives: (a) Minimal: remove `.review-variants` from the selector and let `followVariantLink` call `stopPropagation()` for its four keys. (b) Make the strip a real `Tabs` list with one tab stop (see redesign idea R2); then the strip owns arrows by role and the letters pass through.
- Maintainer decision needed: no.

### A11Y-02 · Focus jumps to the page root after each decision and after Undo

- Kind: accessibility
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `review/use-review-session.ts:313-317`: `if (next) { onSelect(next); } onFocus();` and line 470 `onFocus();` after Undo.
  - `review/review-workspace.tsx:248`: `const focusWorkspace = () => workspace.current?.focus({ preventScroll: true });`
  - `review-workspace.tsx:528-534`: the root is `<Shell … ref={workspace} tabIndex={0} aria-label="Review workspace" …>` with no role.
  - Measurement K2: `{"before":"button \"Approve & nextA\"","after":"div \"Review workspace\" 1440x1014 role=div focusVisible=true outline=[auto 1px rgb(153, 200, 255) offset 0px]","nextTabGoesTo":"a \"Visonaut review queue\""}`.
  - Measurement J4 (Tab presses to reach "Approve & next" in a 7-variant item): `{"fromWorkspaceRoot":30,"fromSelectedItemRow":24,"fromFirstVariant":18}`.
  - Tab order (`tab-order.mjs`): stop 1 on the run page is `<div> "Review workspace" 1440x1035` with the browser default ring `auto 1px`.
- What happens: A reviewer who activates Approve, Reject, or Undo with Enter or Space loses focus to a `div` that covers the whole page. The next Tab goes to the brand link. The way back to Approve is 30 Tab presses. The same `div` is also the first tab stop of the page, and it shows a 1px ring around the full viewport.
- Impact: The page works for shortcut users only. A keyboard user without shortcuts, a switch user, or a screen-reader user in browse mode must cross the page again after every decision. The focused `div` has `aria-label` but no role, so assistive technology gets no useful name (ARIA does not allow a name on a generic element).
- Recommendation: Do not move focus after a decision. Announce the new selection in the live region. Keep a programmatic focus target only for the case where the used control disappears.

  ```ts
  // use-review-session.ts, after the optimistic update
  if (next) onSelect(next);
  onAnnounce(`${count} ${verdict}. Now on ${nextItemName}, ${nextVariantLabel}.`);
  // no onFocus() here
  ```

  ```tsx
  // review-workspace.tsx: the root leaves the tab order
  <Shell ref={workspace} tabIndex={-1} role="group" aria-label="Review workspace" …>
  ```

  The browser tests use `getByLabel("Review workspace").focus()` in many places (for example `review/__tests__/review.browser.test.ts:1205`), so the tests need the same change.

- Alternatives: (a) Minimal: keep `onFocus()` for the shortcut path only (focus is already outside a control), and skip it when `document.activeElement` is a button. (b) Move focus to the `section aria-label="Selected variant"` (`review-workspace.tsx:787-798`, already `tabIndex={-1}`) so the next Tab reaches the view controls and the actions, not the header. (c) Add a skip link "Skip to review actions" as the first tab stop.
- Maintainer decision needed: yes. Which focus model does the review page use: "focus stays on the control" or "focus goes to the stage"?

### A11Y-03 · The item list becomes unreachable when the px media query and the rem container query disagree

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `review/review-workspace.tsx:211-213`: `window.matchMedia("(max-width: 1023px)")` drives `narrow`.
  - `review-workspace.tsx:538`: `$show="5xl"` and line 570: `className="@max-5xl/shell:hidden"` use a 64rem container query.
  - `review-workspace.tsx:559`: `{!narrow && itemNavigation}` and lines 625-632: the "Screenshots" button renders only when `narrow`.
  - Measurement M5 (`media.mjs`, CDP `Page.setFontSizes`): default font 20px, window 1200px: `{"rootFontSize":"20px","narrowMediaQuery":false,"sidebarVisible":false,"sidebarToggleVisible":false,"screenshotsButtonVisible":false,"itemRowsInDom":3,"itemRowsVisible":0}`. Default font 32px, window 1440px: the same result. Default font 16px, window 1200px: sidebar visible.
  - Measurement (`scrollbar.mjs`, a 15px space-taking scrollbar, default font 16px): `1024: {"innerWidth":1024,"clientWidth":1009,"narrow":false,"sidebarVisible":false,"toggleVisible":false,"screenshotsButton":false,"visibleRows":0}`. Same result at 1030 and 1038. The sidebar returns at 1039.
  - Screenshots: `$S/screens/user-font20-1200-review.png`, `user-font32-1440-review.png`, `classic-scrollbar-1030-review.png`.
- What happens: The CSS hides the sidebar and its toggle below 64rem of container width. The JavaScript shows the replacement button below 1024px of viewport width. The two values differ when the default font size is not 16px, and when a classic scrollbar takes space. In the gap, the item list, the search, the status filter, and the toggle are all hidden.
- Impact: Affected users have no list. They can still move with `↑` / `↓` and the two arrow buttons. Affected groups: users with a larger default font size (any window narrower than 64rem), and users with space-taking scrollbars at window widths 1024 to 1038px.
- Recommendation: Use one condition. The simplest form removes the JavaScript breakpoint from the visibility decision:

  ```tsx
  // Visible exactly when the sidebar is hidden.
  <Button $border className="mb-4 @5xl/shell:hidden" onClick={() => setItemsOpen(true)}>
    …Screenshots
  </Button>
  ```

  Then mount the list in the dialog only while the dialog is open, and in the sidebar always (a hidden sidebar is `display: none`).

- Alternatives: (a) Measure the shell with a `ResizeObserver` and compare with `64 * rootFontSize`; set `narrow` from that. (b) Minimal: change the media query to `(width < 64rem)`. This fixes the font-size case and not the scrollbar case.
- Maintainer decision needed: no.

### A11Y-04 · `Shift+A` and `Shift+X` skip the confirmation that the button path requires

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `review/review-workspace.tsx:426-429`: `review("approved", event.shiftKey)` saves at once.
  - `review-workspace.tsx:1042-1059`: the button "All {n} changed views…" only opens a dialog (`setBatchScope`). Lines 1242-1296: the dialog lists the targets and asks for "Reject whole item" or "Approve whole item".
  - Measurement K1: after `Shift+A`: `{"calls":1,"lastCall":{"verdict":"approved","targets":7,"wholeItemKey":"dialog/open"},"dialog":[]}`. After a click on the button: `{"calls":0,"dialog":["Review all changed views"]}`.
- What happens: One key press with Shift approves or rejects all changed variants of the item, including variants that have a previous decision. The pointer path for the same command shows a confirmation with the target list.
- Impact: A slip of the Shift key changes seven verdicts instead of one. Undo exists (`Cmd/Ctrl+Z`), but the status line only says "7 variants approved. Saved." in 12px text at the bottom.
- Recommendation: Make the two paths equal. Either the shortcut opens the same dialog (Enter confirms), or both paths save at once and show a visible Undo message.
- Alternatives: (a) Keep the direct shortcut and add a visible toast with an Undo button. (b) Remove the dialog and rely on Undo for both paths.
- Maintainer decision needed: yes. Is a whole-item decision a confirmed action or an undoable action?

### A11Y-05 · Arrow keys are taken from focusable scroll regions and from the page

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `components/screenshot-viewer.tsx:132-137`: the pane viewport is `overflow-auto`, `tabIndex={0}`, with `aria-label={`${label}. Use pan controls or scroll to inspect the image.`}`.
  - The viewport is not in the exclusion selector (`review-workspace.tsx:94-96`), so the global handler handles arrows there (lines 416-423, 441).
  - Measurement K4 (200% zoom, focus on the viewport): `{"scrollBefore":{"top":0,"left":0,"scrollH":836,"clientH":504},"scrollAfterArrowDown":{"top":0,"left":0},"h1Before":"Success dialog","h1AfterArrowDown":"Open menu","variantAfterArrowRight":"2. Menu-dark …","scrollAfterPageDown":{"top":332}}`.
  - Measurement J3: with shortcuts on, `ArrowDown` on the page changes the item and `scrollY` stays 24. With shortcuts off, `scrollY` goes to 64.
- What happens: A user who tabs to a zoomed image and presses `↓` to scroll loses the item. The page selects the next item. `→` selects another variant. `PageDown` and Space still scroll. The help text says "Use the visible pan buttons to move zoomed images", so this is by design, but the element is a native scroll region with focus.
- Impact: The inspection task (pan a zoomed image) and the navigation task (next item) share the same keys. A pan attempt becomes a context change. The pan buttons add 8 controls in side-by-side mode at zoom (4 per pane, see `screenshot-viewer.tsx:108-130`).
- Recommendation: When focus is inside the image stage, arrows pan. Outside the stage, arrows navigate. Add other keys for item navigation that do not conflict (`J` / `K`, or `N` / `P`).

  ```ts
  if (element.closest(".review-image-viewport") && key.startsWith("arrow")) return; // native scroll
  ```

- Alternatives: (a) Keep arrows for navigation and remove `tabIndex` from the viewport, so it is not a focus target that behaves unlike other scroll regions. (b) Use `Shift+Arrow` for pan and show it in the help.
- Maintainer decision needed: yes. Which keys own item navigation when the image stage has focus?

### A11Y-06 · Zoomed panes pan independently

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `components/screenshot-viewer.tsx:34-48`: each `ImagePane` keeps its own `position` ref and restores only its own scroll offsets.
  - Measurement M6 (200%, side by side): after `first.scrollTo(200, 150)`: `{"first":[200,150],"second":[0,0]}`.
- What happens: At 100% and 200%, Baseline and Current scroll separately. Each pane also has its own four pan buttons.
- Impact: To compare the same region, a reviewer must pan both panes by hand to the same offset. This is the main inspection task of the tool.
- Recommendation: Keep one shared `{ left, top }` for the reference and candidate panes and apply it to both on scroll. One pan control group is then enough.
- Alternatives: (a) A "link panes" toggle that is on by default. (b) Replace two zoomed panes with one pane and a hold-to-flip key (see redesign idea R7).
- Maintainer decision needed: no.

### A11Y-07 · Shortcut help is hard to find, hints are always on, and the toggle is not remembered

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - Entry point: `review-workspace.tsx:1178` renders `<ShortcutHelp />` in `ShellFooter`. The trigger is an icon button (`aria-label="Keyboard help"`, line 150), measured 26×26px.
  - The footer is below the fold on the run page at all five measured sizes (`matrix-table.mjs`): footer top `1645` of 844, `1099` of 1024, `914` of 768, `995` of 900, `1096` of 1080.
  - It is tab stop 23 of 24 on the run page and 33 of 35 in the fixture (`tab-order.mjs`).
  - Measurement J2: `Shift+?` opens nothing (`"dialogsAfterQuestionMark":[]`). `/` does not focus the search.
  - Measurement K6: `{"afterClick":"Shortcuts off","localStorage":"{\"visonaut.review.sidebar\":\"true\"}","afterReload":"Shortcuts on"}`. Code: `useState(true)` at line 199.
  - Measurement J3: with shortcuts off, the hints stay: `"hintsStillVisibleWhenOff":["Compare S","Difference D","Current F","Baseline G","Reject viewX","Approve & nextA"]`.
  - Measurement K7: the dialog heading is `H1 Review with the keyboard` at `14px / 400`. The dialog has `"usesKbd":0`. The vendored `Kbd` primitive (`components/ariakit/components/kbd.ariakit.react.tsx`) has no import in the app.
  - `semantics.mjs`: the page has one `aria-keyshortcuts` attribute (`"Collapse screenshots: ["`). The accessible names of six buttons contain the letter: "Approve & next A", "Reject view X", "Compare S" (tab order output).
  - Screenshot: `$S/screens/state-keyboard-help-1440-dark.png`.
- What happens: The only list of shortcuts is behind a small icon at the bottom of a page that needs a scroll to show it. `←` / `→`, `Shift+A`, `Shift+X`, and `Cmd/Ctrl+Z` have no hint anywhere else. A user who turns shortcuts off (WCAG 2.1.4 needs this switch) gets them back on the next load, and the letters stay on the buttons while they do nothing. Screen readers read the letter as part of the name.
- Impact: New reviewers do not find the fast path. Users who need shortcuts off must turn them off on every visit.
- Recommendation: One shortcut registry that feeds the hints, `aria-keyshortcuts`, the help, and the docs. Open the help with `?` and from the user menu. Store the on/off state next to the sidebar preference. Hide hints when shortcuts are off and on devices without a keyboard.

  ```ts
  // review/shortcuts.ts: one source
  export const shortcuts = {
    approve: { keys: "A", label: "Approve and go to the next pending variant" },
    reject: { keys: "X", label: "Reject and go to the next pending variant" },
    help: { keys: "?", label: "Show keyboard shortcuts" },
  } as const;
  ```

  ```tsx
  <Button aria-keyshortcuts={enabled ? shortcuts.approve.keys : undefined} …>
    <ButtonLabel>Approve &amp; next</ButtonLabel>
    {enabled && <ButtonSlot $kind="shortcut" aria-hidden className="pointer-coarse:hidden">A</ButtonSlot>}
  </Button>
  ```

  The browser tests query the name "Approve & next A" (`review/__tests__/review.browser.test.ts:1235`), so the tests change with the name.

- Alternatives: (a) Minimal: add the `?` key, move the help trigger to the header, and write the toggle to `localStorage`. (b) A command palette (`Cmd/Ctrl+K`) that lists every action with its key (redesign idea R3).
- Maintainer decision needed: no.

### A11Y-08 · The focus ring is clipped on the main navigation, the review search, and the item rows

- Kind: accessibility
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Screenshots: `$S/screens/focus-zoom-nav-link-dark.png` (only the right edge of the ring shows), `focus-zoom-nav-link-mobile-light.png`, `focus-zoom-review-search-dark.png` (top edge cut), `focus-zoom-review-item-light.png` (left and right edges cut).
  - `focus-shots.mjs` output for the nav link: the ring is `solid 2px … offset 1px` and the clipping ancestors are `nav … overflow auto/auto rect [528,8,385,32]` and `div.shell-bar-center … overflow clip/clip rect [528,8,385,32]`. The link rect is `132x32 @528,8`: the link fills the scroll container, so 3px of ring have no room.
  - Source of the clip: `components/ariakit/components/nav.ariakit.react.tsx:73`: `"horizontal flex items-start overflow-x-auto overscroll-x-contain [clip-path:inset(-100vmax_0)] …"`. The app header `Nav` has no padding (`components/app-shell.tsx:46-51`).
  - `review/review-workspace.tsx:557`: `className="review-sidebar-body min-h-0 flex flex-col overflow-hidden! pt-0!"` (no top room for the search ring). `review/item-list.tsx:343`: `className="review-item-scroll min-h-0 flex-1 overflow-auto"` (no inline room for the row ring).
  - For comparison: the variant strip has `$p={1}` (`review-workspace.tsx:717`) and its ring is complete (`focus-zoom-variant-dark.png`).
- What happens: Three of the most used focus targets show a partial ring. On the nav links, three of four sides are missing.
- Impact: Weak focus visibility in the header on every page (WCAG 2.4.7 passes only by the remaining edge and the hover fill).
- Recommendation: Give each scroll container at least 3px of padding on the clipped sides.

  ```tsx
  // app-shell.tsx
  <Nav aria-label="Main navigation" $layout="horizontal" $p={1} …>
  // item-list.tsx
  <div className="review-item-scroll min-h-0 flex-1 overflow-auto px-1 -mx-1">
  ```

- Alternatives: (a) Use an inset ring (`-outline-offset-2`) on rows inside scroll containers. The "Accepted" toggle already does this (`outline … offset -2px` in the tab-order output). (b) Use the `$focusHighlight` variant (`components/ariakit/styles/focus.ts:54-70`) for rows of the item list.
- Maintainer decision needed: no.

### A11Y-09 · The history search field has no focus ring

- Kind: accessibility
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `routes/index.tsx:661`: `className="min-w-0 w-full bg-transparent text-sm outline-none focus-visible:underline"`.
  - `tab-order.mjs`: `<input> textbox "Search loaded history" 403x20 … outline=[none 1px …] deco=underline`.
  - Screenshots: `$S/screens/focus-history-search-dark.png` and `focus-history-search-light.png`. The only change on focus is a 1px underline below the placeholder text.
  - `contrast.mjs`: the placeholder is `4.00:1 #7f7f7f on #feffff` in the light scheme.
  - For comparison, the review search uses a ring on the wrapper: `review/screenshot-filter.tsx:71`: `focus-within:outline-2 focus-within:outline-brand`.
- What happens: The focus indicator is the text decoration of the placeholder or of the typed text. The field frame does not change.
- Impact: The focused state of the first field on the history page is hard to see. Two search fields in the same app use two different focus patterns.
- Recommendation: Put the ring on the frame, like the review search: `focus-within:outline-2 focus-within:outline-brand` on the `Frame` at `routes/index.tsx:646-654`.
- Alternatives: Replace both hand-made fields with the upstream `InputGroup` / `Input` / `InputSlot` primitives (`ariakit/packages/ariakit-ui/src/components/input.ariakit.react.tsx`), which carry the `focusWithin` recipe.
- Maintainer decision needed: no.

### A11Y-10 · The selected variant is weak in dark, invisible in light, and equal to the others in forced colors

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `review-workspace.tsx:713-727`: the strip uses a glider with `$kind: "flat", $lighten: 2, $border: true`. Each link has `$border` (line 738).
  - Measurement N1 (`media2.mjs`), dark: selected fill `#232529` on `#0c0e12` = `1.26:1`. Light: selected fill `#feffff` on `#fcfdfd` = `1.02:1`.
  - Screenshots: `$S/screens/state-variant-strip-1440-light.png` (the selected pill is the one without a visible outline; the other pills have an outline), `state-variant-strip-1440-dark.png`.
  - Other state marks, same measurement: pressed view mode `1.1:1` to `1.35:1`; selected item row fill `1.26:1` dark and `1.02:1` light, but the row also has a glider bar at `17.22:1` and `16.58:1`.
  - Measurement M2 (forced colors): `selectedVariant` and `otherVariant` have identical computed styles (`"border":"1px solid rgb(255, 255, 0)"`, transparent background). Screenshot: `forced-colors-review-1440-dark.png`.
- What happens: In the light scheme, selection reads inverted: the unselected pills look like outlined buttons and the selected pill looks like plain text. The remaining cues are font weight 500 against 400 and text opacity 1.0 against 0.7. In forced colors mode there is no visible difference.
- Impact: The reviewer cannot see at a glance which variant the images belong to. A wrong-variant decision is possible.
- Recommendation: Give the selected state a mark with at least 3:1 against the strip: the same bar glider that the item list and the header nav use (`glider={{ $kind: "bar", $state: "selected", … }}`), or a `$layer` fill with `$contrast`. In forced colors, keep a 2px border on the selected link only.
- Alternatives: Move variants to `Tabs` (redesign idea R2); the tab recipe has a selected state and forced-colors rules (`tabs.ariakit.react.tsx:479`).
- Maintainer decision needed: no.

### A11Y-11 · Variant pills do not show the review status

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `review/variant-summary.tsx:88-136` renders icons, labels, and an index. It renders no verdict.
  - The status exists only in `aria-label` and `title`: `review-workspace.tsx:747` `title={`${entry.label} · ${verdictLabel(entry)}`}` and line 776 `aria-label={`${index + 1}. ${entry.label}. ${verdictLabel(entry)}`}`.
  - Screenshot: `$S/screens/review-mixed-verdicts-1440-dark.png`. The fixture has variant 1 approved, 2 rejected, 3 with an error, 4 unchanged. All pills look the same. Only the badge beside the `h1` shows the status of the selected variant.
- What happens: A screen reader hears "2. Solid · Chromium · Light. Rejected". A sighted user sees no status on the pill.
- Impact: To learn which variants still need a decision, a sighted reviewer must select each variant or trust "next pending". The visible label and the accessible name carry different information.
- Recommendation: Add a status mark to each pill (the same icons as `ReviewStatus`, `review/review-status.tsx:19-30`) and keep the text in the accessible name.

  ```tsx
  <TabSlot aria-hidden><StatusIcon variant={entry} /></TabSlot>
  <TabLabel>{shortLabel(entry)}</TabLabel>
  ```

- Alternatives: A compact matrix (rows = items, columns = variants) with one status cell per variant (redesign idea R2, option C).
- Maintainer decision needed: no.

### A11Y-12 · The variant strip hides most variants and costs one tab stop per variant

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - Measurement `mobile.mjs` "strips" (fixture item with 7 variants): fully visible variants: `1 of 7` at 390, `2 of 7` at 768 and 1024, `3 of 7` at 1440, `5 of 7` at 1920. Hidden width at 1440: `959px`. `overflowX: auto`, `offsetHeight == clientHeight == 38` (no visible scrollbar on macOS), `maskImage: none` (no fade).
  - Tab order: 7 tab stops for the strip (stops 14-20 in the fixture), plus arrow navigation (`review-workspace.tsx:99-121`).
  - Number keys cover only six variants (`/^[1-6]$/`, line 424).
  - Each pill repeats shared parts. Fixture labels: "React · Chromium · Light · 1280 × 720", "Solid · Chromium · Light · 1280 × 720", … (pill widths 265 to 307px in `mobile.mjs`).
  - Screenshot: `$S/screens/fixture-review-1440-dark.png` (the fourth pill is cut at the right edge).
- What happens: With the real matrix of Ariakit (framework × browser × scheme), most variants are off screen. Nothing shows that more exist, except a cut pill.
- Impact: Variants can stay unseen. Keyboard users pay 7 or more Tab presses to pass the strip.
- Recommendation: Show only the parts that differ between the variants of the item. Use one tab stop (roving focus). Add an overflow control ("+4") or wrap to two rows.
- Alternatives: See redesign idea R2 (three options: compact tabs, grouped segmented controls per dimension, matrix).
- Maintainer decision needed: yes. Is the variant control a flat list, or one control per dimension (framework, browser, scheme)?

### A11Y-13 · `$layer="primary"` is not a layer color: primary buttons render gray, and three sign-in buttons differ

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `components/ariakit/components/layer.ariakit.react.tsx:84-100`: the known values are `transparent, canvas, brand, secondary, success, warning, danger`. Any other string becomes `style: { "--layer-color": value }`.
  - Call sites: `routes/index.tsx:301, 310, 346, 508` and `routes/pulls.$pullNumber.tsx:194, 226`.
  - Measurement (`semantics.mjs`, "Review changes" link, dark scheme): `"inlineStyle":"--layer-color: primary; …"`, `"background":"oklch(0.949994 0.0000497986 23.7884)"`, `"color":"oklch(0 0 0)"`. `contrast.mjs`: `#000000 on #eeeeee` in both schemes.
  - Screenshots: `$S/screens/queue-1440-dark.png` (white button), `dash-guest-1440-light.png` (pale gray "Sign in with GitHub").
  - The review page uses `$layer="brand"` and renders `#006abb` (`review-workspace.tsx:1081`; `contrast.mjs`: `#ffffff on #006abb`, 5.56:1).
  - Third style: the run guest page uses a flat button with no fill (`routes/runs.$runId.tsx:236-243`; measured `bg … / 0`, width 724px; screenshot `run-guest-1440-dark.png`).
- What happens: `primary` is not a CSS color, so the layer falls back to a neutral gray. The main action of the dashboard is the least colored button in light mode and a white block in dark mode. "Sign in with GitHub" has three looks on three pages.
- Impact: The theme token `--color-primary` (`ui.css:6`) has no effect. Call-to-action hierarchy is lost on the dashboard.
- Recommendation: Use `$layer="brand"` at the six call sites, or pass a real color: `$layer="var(--color-primary)"`.
- Alternatives: Add `primary` to the `COLOR_VALUES` map of the vendored layer. This changes vendored code and drifts from upstream.
- Maintainer decision needed: no.

### A11Y-14 · Controls use 40% to 66% of the viewport above the image; sticky bars leave 71px at 400% zoom

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: L
- Evidence (`matrix-table.mjs`, run page on port 4310, top of the first image viewport):

  | Viewport  | Image top (px) | Share of height | Footer top (px) |
  | --------- | -------------- | --------------- | --------------- |
  | 390×844   | 561            | 66%             | 1645            |
  | 768×1024  | 466            | 46%             | 1099            |
  | 1024×768  | 425            | 55%             | 914             |
  | 1440×900  | 431            | 48%             | 995             |
  | 1920×1080 | 431            | 40%             | 1096            |
  - With banners the top moves down: `review-terminal-failed` 509px, `review-long-names` 536px at 1440×900 in the fixture (`states.mjs`).
  - The page always scrolls: `scrollHeight` 1035 at 900, 954 at 768, 1136 at 1080 (`matrix.mjs`).
  - Zoom (`media2.mjs` N4): at 200% of 1440×900 (720×450 CSS px) the full-width sticky bars total `155px` (34%) and the image top is `465` (below the fold). At 400% of 1280×1024 (320×256): `"fullWidthStickyTotal":185,"share":"72%","freeHeight":71`.
  - Screenshots: `$S/screens/run-1440-dark.png`, `run-1024-light.png`, `zoom200-of-1440x900-run.png`, `zoom400-of-1280x1024-run.png`.

- What happens: Seven horizontal bands sit above the pixels: app header (48), run header (48), meta row (26), title block, variant strip, view controls, pane captions (48). A sticky action bar (61 to 91px) sits below. The footer adds 40px that needs a page scroll.
- Impact: On a 13-inch laptop the comparison gets about 400px of height. At 400% zoom (WCAG 1.4.10 reflow test size) 71px of content height remain between the sticky bars.
- Recommendation: Make the review page a fixed-height application layout: one header row, one tool row, a stage that takes the remaining height, and the action bar. Move run identity and capture details into the Details panel. Drop the footer. Do not make bars sticky when the viewport height is below about 480px.
- Alternatives: (a) Minimal: remove `ShellMainIntro`, merge the two header rows, and use `h-[calc(100dvh-…)]` on the stage in place of `h-[min(56vh,650px)]`. (b) A "focus mode" key that hides all bands except the stage and the action bar.
- Maintainer decision needed: yes. Is the review page a document that scrolls or an application that fits the viewport?

### A11Y-15 · The mobile review flow is a stacked desktop page

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: L
- Evidence (390×844, touch emulation):
  - Page height `1685px`. Each pane is `521px` tall with a `473px` viewport (`matrix-table.mjs`). The two panes stack (`screenshot-viewer.tsx:211`). The sticky action bar is `91px` in two rows.
  - Keyboard hints show on touch: "Compare S", "Reject view X", "Approve & next A" (`$S/screens/run-390-light.png`). The footer shows "Keyboard help" and "Shortcuts on".
  - The view-mode strip hides 35px: "Baseline G" is cut (`mobile.mjs`: `"viewModes":{"clientWidth":366,"scrollWidth":401,"hiddenPx":35}`).
  - Item dialog: after a tap on an item the dialog stays open: `{"h1Before":"Success dialog","h1":"Open menu","dialogStillOpen":true}`. Code: `review-workspace.tsx:1206-1222` has no close on select.
  - At 200% each pane shows four 26px pan buttons although touch scroll works (`mobile-zoom-200-390-dark.png`).
  - Screenshots: `$S/screens/run-390-dark-full.png`, `mobile-screenshots-dialog-390-dark.png`, `mobile-batch-dialog-390-dark.png`, `review-long-names-390-dark.png`.
- What happens: A phone user cannot see Baseline and Current together. The user scrolls 521px between them. The first image starts at 66% of the first screen.
- Impact: A quick approval from a phone (for example from a GitHub notification) is slow. `docs/review-guide.md:94` puts mobile outside the launch validation scope, so this is a design input, not a regression.
- Recommendation: A mobile mode with one image at a time: a segmented control Baseline | Current | Diff, press-and-hold or swipe to flip, a bottom sheet for items, and two large actions in the thumb zone. See redesign idea R6.
- Alternatives: (a) Minimal: close the item dialog on select; hide shortcut hints and the footer under `@media (pointer: coarse)`; default to the "Difference" view on narrow screens. (b) State in the UI that review needs a desktop and show a read-only summary on phones.
- Maintainer decision needed: yes. Is phone review a supported task?

### A11Y-16 · Every page has the same title; client navigation drops focus; header links reload the document

- Kind: accessibility
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `routes/__root.tsx:10`: `{ title: "Visonaut" }`. `rg "title:|head:" apps/web/src/routes` finds no other title. `semantics.mjs`: `"title": "Visonaut"` on queue, history, service, and run.
  - Focus after navigation (`semantics.mjs`): after Enter on "Review changes": `"focus": { "tag": "body" … }, "title": "Visonaut"`. After Back: `body`. After the "Run history" link: `body`.
  - Document loads (`media.mjs` M7): `{"documents":["/","/?view=history","/","/"],"headerHistoryLink":1,"headerQueueLink":1,"reviewChangesLink":0,"workspaceQueueLink":1}`.
  - Code: `components/app-shell.tsx:29` `render={<a href="/" />}`, lines 53-58 `<NavLink href={href} …>` (plain anchors). `review/review-workspace.tsx:580` `render={<a href="/" />}` for "Queue". Lines 474-478: comparison history links are plain anchors.
  - No skip link: `semantics.mjs` `"skipLink": false` on all pages.
- What happens: Browser tabs, history entries, and bookmarks all read "Visonaut". A screen reader announces the same title for every page. The one client-side transition (queue to run) leaves focus on `body` and announces nothing. Every header click and the "Queue" link load a new document, so the dashboard shows "Checking access and loading runs…" again each time.
- Impact: Users with several Visonaut tabs cannot tell them apart. Screen-reader users get no route change signal. The full reloads add to the slow-page complaint: each one repeats server render, hydration, and the `/api/runs` fetch.
- Recommendation: Set a title per route and per run. Use the router `Link` for header and "Queue" links. After a client navigation, move focus to the page `h1` (with `tabIndex={-1}`) or to a route announcer.

  ```ts
  // routes/runs.$runId.tsx
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.status === "ready" ? `${loaderData.model.run.title ?? "Run"} · Visonaut` : "Visonaut" }],
  }),
  ```

- Alternatives: (a) Minimal: titles only ("Review queue · Visonaut", "Run history · Visonaut", "#4801 Dialog focus styles · Visonaut"). (b) Add a skip link "Skip to content" as the first tab stop of `AppHeader`.
- Maintainer decision needed: no.

### A11Y-17 · The end of a review has no visible state

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `review/use-review-session.ts:366-368`: `onAnnounce("Review complete. No variants need review.");`. `onAnnounce` writes only to the visually hidden region (`review-workspace.tsx:1202-1204`).
  - Measurement K8 (all variants approved): `{"h1":"Open menu","progress":"0 of 11 need review","saveState":"1 variant approved. Saved.","srOnlyAnnouncement":"Review complete. No variants need review."}`.
  - Screenshot: `$S/screens/state-review-complete-1440-dark.png`. The page still shows the last variant with "Approve & next" enabled. The only signals are "0 of 11 need review" (12px) and "Check passed" (10px, 50% opacity).
- What happens: After the last decision the workspace looks the same as before. The completion message exists for screen readers only.
- Impact: The reviewer does not get a clear "done" and has no next step (back to the queue, next run).
- Recommendation: Show a completion state in the stage or as a banner: result summary, "Back to queue", "Open next run". Keep the live announcement.
- Alternatives: A toast with the same two actions.
- Maintainer decision needed: no.

### A11Y-18 · A quarter of the review text is below 12px, and fixed pixel sizes ignore the user font size

- Kind: accessibility
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `contrast-table.mjs` (review fixture, 1440): `font sizes (px: text runs): 10:22  11:4  12:52  13:16  16:5  28:1` and `text runs below 12px: 26 of 100`. The dashboard has none below 12px.
  - Fixed sizes in app code (`rg "text-\[1[0-3]px\]"`): 18 matches. Examples: `components/control-button.tsx:10` `text-[13px]` (every `ControlButton`), `components/app-shell.tsx:50`, `review/review-workspace.tsx:548, 551, 610, 1154`, `review/item-list.tsx:249` `text-[10px]`, `review/variant-summary.tsx:128`, `components/screenshot-viewer.tsx:103`.
  - Measurement M5 with a 32px default font: `"fontSizes":"10px:24  11px:4  13px:17  24px:94  28px:19  32px:5"`. Screenshot `$S/screens/user-font32-1440-review.png`: "0.05% changed · 120 changed pixels" (24px) is close to the `h1` (28px fixed at `review-workspace.tsx:638`) and much larger than the buttons (13px).
- What happens: Two size systems are mixed. `text-xs` and `text-sm` follow the user font size. `text-[10px]`, `text-[11px]`, and `text-[13px]` do not. All buttons and the navigation are in the fixed group. With a larger default font the hierarchy inverts.
- Impact: Run identity (commit, attempt, baseline revision) and item counts are at 10px. Users who raise the browser font size get large captions and unchanged controls. Browser zoom still scales everything, so WCAG 1.4.4 passes through zoom.
- Recommendation: One type scale in `rem`, with a minimum of 12px (0.75rem). Replace `text-[13px]` with a theme token:

  ```css
  @theme {
    --text-control: 0.8125rem;
    --text-caption: 0.75rem;
  }
  ```

  ```tsx
  className={`text-control leading-5 shrink-0 ${className}`}
  ```

- Alternatives: Minimal: change the five 10px places that carry data (`review-workspace.tsx:610`, `item-list.tsx:249`, `screenshot-viewer.tsx:103`, `variant-summary.tsx:128`, `review-workspace.tsx:548`) to `text-xs`.
- Maintainer decision needed: no.

### A11Y-19 · Contrast is below 4.5:1 for placeholders and for `opacity-50` text in the light scheme

- Kind: accessibility
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence (`contrast.mjs`, computed colors, 1440 wide):
  - Review search placeholder: `2.19:1 #484a4d on #0c0e12` (dark), `1.84:1 #bdbebe on #fcfdfd` (light). Code: `review/screenshot-filter.tsx:109` `placeholder:opacity-50`.
  - Light scheme, `opacity-50`: `3.96:1 #7e7f7f on #fcfdfd 10px` for "aabbccd", "Attempt", "Baseline revision" (`review-workspace.tsx:610`); the same for "4 items" at 11px (line 551) and for the six `dt` labels in Details at 12px (line 490 `[&>dt]:opacity-50`).
  - History placeholder, light: `4.00:1 #7f7f7f on #feffff`.
  - Passing reference values: `ak-ink-60` text is `5.71:1` light and `7.26:1` dark. Focus ring against canvas: `5.43:1` dark, `5.83:1` light. No other text style is below 4.5:1 on the measured pages.
- What happens: The system utility `ak-ink-*` keeps contrast. The raw `opacity-*` utilities do not.
- Impact: The lowest-contrast text is also the smallest text (10px).
- Recommendation: Replace `opacity-50`, `opacity-55`, `opacity-60` on text with `ak-ink-60` (or the `$ink` variant of `Text`). 14 places: `rg "opacity-[0-9]+" apps/web/src --glob "*.tsx"` lists them.
- Alternatives: Keep opacity and raise it to 70% for text at or below 12px.
- Maintainer decision needed: no.

### A11Y-20 · Pointer targets are 19px to 35px

- Kind: accessibility
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence (`mobile.mjs`, 390 wide with touch; the review controls have the same sizes at 1440):
  - Below 24px (WCAG 2.5.8 AA minimum): brand link `19.4x22.8`; history `<select>` `104x19`; history `<input>` `129.5x20` (the `label` around it is clickable, so the input target is larger in practice; a label click does not open the select).
  - 25 to 26px: view modes and zoom (`98.8x25` … `51x25`), Undo `65.6x26`, "All 7 changed views…" `165.7x26`, "Keyboard help" `26x26`.
  - 29 to 35px: header links `31.6x31.6`, account `29.3x29.3`, previous and next `29.3x29.3`, variants `…x30`, Approve `155.9x34.5`, Reject `133.8x34.5`.
  - Summary lines: `targets review-fixture 390: 31 targets, 2 below 24px, 29 more below 44px`. No target reaches 44px.
- What happens: The control density fits a mouse. Nothing changes for touch.
- Impact: On a phone or a touch laptop the two main actions are 34px tall and sit next to each other in one group (`ButtonGroup $gap="sm"`, `review-workspace.tsx:1061`).
- Recommendation: Under `@media (pointer: coarse)`, raise control padding so that targets reach 44px, and separate Approve from Reject. Give the history select the upstream `ComboboxSelect` or at least full-height padding.
- Alternatives: Keep desktop density and apply the larger size only to the action bar and the header.
- Maintainer decision needed: no.

### A11Y-21 · The color scheme follows the system only, and the image stage has no backdrop control

- Kind: ux
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `components/ariakit/styles/ui.css:75-82`: the only scheme switch is `@variant dark` on `:root`.
  - `rg -i "data-theme|setTheme|prefers-color" apps/web/src` has no match in app code. `semantics.mjs`: `"metaColorScheme": null, "metaThemeColor": null`.
  - `matrix.mjs`: with `colorScheme: "dark"` the body is `oklch(0.1634 0.0091 264.28)`; with `"light"` it is `oklch(0.9933 0.0011 197.14)`. No control in the UI changes it.
  - Stage: `components/screenshot-viewer.tsx:134` draws a checkerboard from `currentColor` at 6%. Screenshot `$S/screens/fixture-review-768-light.png`: a white screenshot on the light stage has almost no visible edge. `run-1440-dark.png`: a dark screenshot on the dark stage has the same problem.
- What happens: A reviewer cannot choose a scheme for the tool, and cannot choose a backdrop for the screenshot. Light captures blend into a light UI. Dark captures blend into a dark UI.
- Impact: Edge changes (padding, shadow, border of the captured component) are hard to see when the capture and the stage have the same lightness.
- Recommendation: Add a theme control (System, Light, Dark) in the user menu, stored like the sidebar preference and applied before first paint. Add a stage backdrop control (Checker, Light, Dark, Auto = opposite of the variant scheme).

  ```css
  /* ui.css: the user choice wins, the system is the default */
  @custom-variant dark {
    &:where([data-theme="dark"], [data-theme="dark"] *) {
      @slot;
    }
    @media (prefers-color-scheme: dark) {
      &:where(:not([data-theme="light"], [data-theme="light"] *)) {
        @slot;
      }
    }
  }
  ```

  All layers derive from the canvas color, so this one variant is enough for the whole UI.

- Alternatives: Minimal: a 1px edge around the image (`outline: 1px solid var(--ak-edge)`) and no toggle.
- Maintainer decision needed: yes. Does the tool need a user theme toggle, or only a stage backdrop control?

### A11Y-22 · Semantics: unnamed focus targets, one heading on the review page, heading jumps, and `title` as the only tooltip

- Kind: accessibility
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence (`semantics.mjs`):
  - Three focusable `div` elements have `aria-label` and no role: `"Review workspace"`, `"Reference. Use pan controls or scroll to inspect the image."`, `"New image. Use pan controls or scroll to inspect the image."` (`review-workspace.tsx:531-532`, `components/screenshot-viewer.tsx:135-136`).
  - Review page headings: one entry, `{"level":"1","text":"Success dialog"}`. The run title, "Screenshots", "Baseline", "Current", and "Capture details" are `Text` spans (`review-workspace.tsx:548, 586, 1154`; `screenshot-viewer.tsx:101`).
  - Heading jumps: service page with alerts `H1 Service status.` then `H3 A backup needs attention` (`states.mjs`). The alerts popover is `H1 Service attention` then `H3`. The help dialog is a second `H1` at `14px / 400` (K7).
  - Tooltips: 13 `title` attributes on the run page, for example `"Toggle screenshots ([)"`, `"Previous screenshot (↑)"`, and on spans inside pills (`"React"`, `"Chromium"`). `title` does not show on keyboard focus or on touch.
  - One group has no name: `"group: "` (the `ButtonGroup` around Reject and Approve, `review-workspace.tsx:1061`).
  - `routes/index.tsx:405`: `<Text render={<time />}>` has no `dateTime` attribute.
  - Good: all images have `alt` (`"imagesWithoutAlt": 0`), all icons are hidden from assistive technology (`"decorativeSvgWithoutAriaHidden": 0`), no control lacks a name (`"unnamed": []`), landmarks are present and named (banner, navigation ×3, complementary, main, 2 regions, contentinfo).
- What happens: Heading navigation gives one stop on the review page. Three focus targets have names that ARIA does not allow on a generic element.
- Impact: Screen-reader users cannot jump between the list, the variants, the stage, and the actions by heading. Region navigation works.
- Recommendation: Give the image viewport `role="group"` (or make the `figure` the focus target). Use visually small real headings: `h1` = run title, `h2` = item name, `h2` in each sidebar. Use `PopoverHeading render={<h2 />}` and `DialogHeading render={<h2 />}`. Replace `title` with the upstream `Tooltip` primitive for icon buttons.
- Alternatives: Minimal: add the roles and fix the two heading jumps (`components/operations-attention/index.tsx:407` `h3` to `h2`).
- Maintainer decision needed: no.

### A11Y-23 · Three vocabularies for the same controls, and the review guide does not match the UI

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Buttons: "Compare", "Difference", "Current", "Baseline" (`review-workspace.tsx:845, 860, 874, 888`). Pane captions: "Baseline", "Current", "Difference" (`screenshot-viewer.tsx:37-38`).
  - Accessible names of the same panes: `label="Reference"`, `label="New image"`, `label="Pixel diff · red pixels changed"` (`screenshot-viewer.tsx:218, 229, 245`). Pan buttons: `aria-label={`Pan ${label} ${direction}`}` = "Pan Reference left", but `title={`Pan ${caption.toLowerCase()} ${direction}`}` = "Pan baseline left" (lines 120-121). Tab order output: `"Reference. Use pan controls or scroll to inspect the image."`.
  - Help dialog: "Side by side, red pixel diff, new image only, or original only." (`review-workspace.tsx:175`).
  - Guide: "Side by side", "Pixel diff", "New only", "Original only" (`docs/review-guide.md:31-34`).
  - Units: "Reject view", "All 7 changed views…" (1055, 1077), "Variants" (728), "1 variant approved. Saved." (`use-review-session.ts:364`), "Screenshots" and "4 items" (549-552), "Previous screenshot" (654), "Review items" (`item-list.tsx:300`).
  - Guide drift: the keyboard table (`docs/review-guide.md:69-80`) has no `[`. Line 92 says "Use **All runs** to return to the dashboard"; the UI says "Queue". Line 15 says "The Runs page"; the UI says "Review queue" and "Run history". Line 88 says "**Recompare stored run** is retired"; the footer still renders that button for non-preview runs (`review-workspace.tsx:1186-1197`, `review/client.ts:355-356`).
- What happens: One image has three names (Baseline, Reference, Original). One unit has four names (view, variant, screenshot, item).
- Impact: A screen-reader user hears "Reference" for the pane that sighted users call "Baseline". Voice-control users cannot rely on visible words. The guide teaches names that are not on screen.
- Recommendation: Choose one term per concept and use it in buttons, captions, `aria-label`, help, announcements, and the guide. Proposal: Baseline, Current, Difference, Compare; "item" for a screenshot name and "variant" for one capture of it.
- Alternatives: none that keeps the three vocabularies.
- Maintainer decision needed: yes. Which terms are canonical?

### A11Y-24 · Shortcuts read `event.key`, so `[` and letters fail on some keyboard layouts

- Kind: bug
- Severity: low. Confidence: medium. Measured: yes. Effort: S
- Evidence:
  - `review-workspace.tsx:398-399`: `if (event.altKey) return; const key = event.key.toLowerCase();`
  - Measurement K5 (synthetic events): `[` toggles the sidebar; `[` with `altKey` and `ctrlKey` (AltGr) does not (`"sidebarAfterPlainBracket":"false","sidebarAfterAltGrBracket":"false"`); `key: "ф", code: "KeyA"` does not approve (`"callsAfterKeyCodeAWithCyrillicKey":0`).
- What happens: On layouts where `[` needs AltGr or Option (German, French, Spanish, Nordic), the bracket shortcut cannot fire because Alt is down. On non-Latin layouts, `A`, `X`, `S`, `D`, `F`, `G` do not match.
- Impact: Limited to reviewers with those layouts. Not tested on a real keyboard with such a layout.
- Recommendation: Match letters on `event.code` (`KeyA`, `KeyX`, …) and choose a sidebar key that does not need a modifier on common layouts (for example `B`).
- Alternatives: Accept both `event.key` and `event.code`.
- Maintainer decision needed: no.

### A11Y-25 · Reduced motion is respected for large motion; small transitions remain

- Kind: ux
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence (`media.mjs` M1, `media2.mjs` N3):
  - No preference: `41x control|scale|100`, `3x glider|top, left, …|100`, `2x shell-sidebar|width|300`, `1x shell-main|…|300`. Sidebar toggle settles at `285ms` over 13 positions.
  - Reduce: the shell entries are gone; the sidebar settles in one frame (`"distinctPositions":1`). `41x control|scale|100` and `5x glider … 100` remain.
  - Popover open: `"transitionProperty":"overlay, display, scale, opacity","transitionDuration":"0.5s"` with the overshoot curve (`ui.css:37-59`). Under reduce: `"transitionProperty":"none"`.
- What happens: The implementation is correct for sidebars and popovers. The selected-state glider still slides for 100ms and buttons still scale on press under reduced motion. The popover open takes 500ms with a bounce when motion is allowed.
- Impact: Small. The 500ms bounce on the alerts and account popovers feels slow for a tool UI.
- Recommendation: Add `motion-reduce:transition-none` to the glider recipe use, or set `duration-0` on the three `glider` props in the app. Consider a 150 to 200ms popover open for this app (`--duration-overshoot`).
- Alternatives: Leave as is; 100ms position transitions are within common reduced-motion practice.
- Maintainer decision needed: no.

### A11Y-26 · Dashboard status color and icon do not follow the status

- Kind: visual
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `routes/index.tsx:132`: `"needs-review"` and `"reviewing"` both get the label "Needs review". Lines 142-151 (`stateColor`) give `warning` to `"needs-review"` only. Screenshot `$S/screens/dash-queue-busy-1440-dark.png`: runs #4801 and #4802 have a yellow badge; run #4803 (state `reviewing`) has a gray badge with the same words.
  - `routes/index.tsx:580-582`: every row in "In progress" and "Needs attention" uses `Clock3Icon`. A failed run and a superseded run look the same as a run in progress (same screenshot).
  - `routes/index.tsx:502`: "1 view await approval" (the verb does not agree; visible on run #4803).
- What happens: The words are correct, so the status is not color-only. Color and icon give a different signal than the words.
- Impact: The queue cannot be scanned by color or shape.
- Recommendation: One status map (label, color, icon) used by the queue cards, the row groups, and the history table.
- Alternatives: none.
- Maintainer decision needed: no.

## Redesign ideas

Each idea names primitives that exist in the vendored copy or upstream (`/Users/diegohaz/Developer/ariakit/packages/ariakit-ui/src/components`).

### R1 · "Stage first" review layout (fits the viewport, no page scroll)

- What changes: One header row (back, run title, progress, help, account). One tool row (variant control, view mode, zoom, backdrop). The stage takes all remaining height. The action bar is the last row of the grid, not a sticky overlay. Run identity and capture details move to the Details panel. The footer is removed.
- Why it is better: Chrome above the image drops from 431px to about 130px at 1440×900 (A11Y-14). No sticky overlap at zoom. The help and the shortcut toggle move to the header where they are visible.
- Sketch:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Queue   #4801 Fix Combobox popover…        ▓▓▓░░ 9/11     ?   ◐   @diego  │ 44
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ⌕ Search   ▾  │ Success dialog ● Needs review   [React|Solid][Chr|Fx|Wk][☀|☾]│ 44
│ ● Success  7/7│ [Compare|Diff|Current|Baseline]        [Fit|100|200]  ▦ ☀ ☾  │ 40
│ ● Open menu 2 │ ┌───────────────────────────┬──────────────────────────────┐ │
│ ○ New item    │ │ Baseline                  │ Current                      │ │
│ ▸ Accepted 12 │ │                           │                              │ │ flex
│               │ │        (stage)            │         (stage)              │ │
│               │ └───────────────────────────┴──────────────────────────────┘ │
│               │ ↶ Undo  Whole item ▾   1 approved · saved   ✕ Reject X  ✓ Approve A │ 52
└───────────────┴──────────────────────────────────────────────────────────────┘
```

```tsx
<Shell className="h-dvh grid grid-rows-[auto_1fr]">
  <ShellHeader
    $height="sm"
    start={<BackAndTitle />}
    center={<RunProgress />}
    end={<HelpThemeAccount />}
  />
  <ShellSidebar $show="5xl" open={sidebarOpen}>
    …
  </ShellSidebar>
  <ShellMain className="grid grid-rows-[auto_auto_1fr_auto] min-h-0">
    <ItemBar /> <ToolBar /> <Stage className="min-h-0" /> <ActionBar />
  </ShellMain>
</Shell>
```

### R2 · Variant control with status, one tab stop, and no hidden variants

- What changes: Three options to explore.
  - A: `Tabs` with compact labels. Show only the parts that differ inside the item. Each tab has a status icon. Overflow goes to a "+N" menu.
  - B: One segmented control per dimension (framework, browser, scheme). The selected combination is the variant. A dot on a segment means "has pending variants".
  - C: A matrix popover: rows = browser, columns = scheme × framework; each cell is a status mark and a link.
- Why it is better: Fixes A11Y-10, A11Y-11, and A11Y-12. One Tab press crosses the control. Status is visible. Selection has a real selected style and forced-colors support.
- Sketch (A):

```tsx
<TabProvider selectedId={variant.id} setSelectedId={selectVariantById}>
  <TabList aria-label="Variants">
    {item.variants.map((entry, index) => (
      <Tab
        key={entry.id}
        id={entry.id}
        aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
      >
        <TabSlot aria-hidden>
          <StatusIcon variant={entry} />
        </TabSlot>
        <TabLabel>{differingParts(entry, item)}</TabLabel>
      </Tab>
    ))}
  </TabList>
</TabProvider>
```

```
B:  Framework [ React • | Solid ]   Browser [ Chromium • | Firefox | WebKit ]   Scheme [ ☀ Light | ☾ Dark • ]
C:              Light        Dark
    Chromium    ✓ R  ✓ S     ● R  ● S
    Firefox     ✓ R  ✕ S     ● R  – S
    WebKit      ✓ R  ✓ S     ! R  ● S
```

### R3 · Shortcut overlay and command palette from one registry

- What changes: A registry object lists every command: id, label, keys, handler, enabled state. The registry renders the button hints, `aria-keyshortcuts`, a `?` overlay built with `Dialog` and `Kbd`, a `Cmd/Ctrl+K` palette built with `Dialog` and `Combobox`, and the table in the guide.
- Why it is better: Fixes A11Y-07 and the docs drift in A11Y-23. Every action is reachable by typing its name, which also serves users who do not use single-key shortcuts.
- Sketch:

```tsx
<Dialog aria-label="Keyboard shortcuts">
  <DialogHeading render={<h2 />}>Keyboard shortcuts</DialogHeading>
  {groups.map((group) => (
    <section key={group.title}>
      <Text render={<h3 />} className="text-caption ak-ink-60">
        {group.title}
      </Text>
      {group.commands.map((command) => (
        <Frame key={command.id} className="flex justify-between">
          <Text>{command.label}</Text>
          <span>
            {command.keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
        </Frame>
      ))}
    </section>
  ))}
</Dialog>
```

```
┌ Type a command…                               ┐
│ Approve and next                          A   │
│ Reject and next                           X   │
│ Approve whole item                   ⇧ A      │
│ Show difference                           D   │
│ Go to item…                                   │
│ Toggle theme                                  │
└───────────────────────────────────────────────┘
```

### R4 · A focus model for decisions

- What changes: Focus stays on the control that the user activated. The page announces "Approved. Now on Open menu, React Chromium Dark." A skip link is the first tab stop. `F6` moves between the four regions (list, variants, stage, actions). The root `div` leaves the tab order.
- Why it is better: Fixes A11Y-02 and A11Y-05 without a change for shortcut users.
- Sketch:

```
Tab order:  [Skip to review actions] → header → list (1 stop) → variants (1 stop) → view (1 stop) → stage → actions
After Enter on Approve: focus = Approve (same button, next variant).
Live region: "Approved. 8 of 11 need review. Now on Open menu, React Chromium Dark."
```

### R5 · Theme control and stage backdrop

- What changes: A three-way control (System, Light, Dark) in the account menu, stored in `localStorage` and applied by the existing head script. A stage backdrop control in the tool row: Checker, Light, Dark, Auto (opposite of the variant scheme part).
- Why it is better: Fixes A11Y-21. Reviewers can put a light capture on a dark stage.
- Sketch:

```tsx
<RadioProvider value={theme} setValue={setTheme}>
  <RadioGroup aria-label="Theme" className="flex">
    <RadioCard value="system">
      <RadioCardSlot>
        <MonitorIcon />
      </RadioCardSlot>
      <RadioCardLabel>System</RadioCardLabel>
    </RadioCard>
    <RadioCard value="light">
      <RadioCardSlot>
        <SunIcon />
      </RadioCardSlot>
      <RadioCardLabel>Light</RadioCardLabel>
    </RadioCard>
    <RadioCard value="dark">
      <RadioCardSlot>
        <MoonIcon />
      </RadioCardSlot>
      <RadioCardLabel>Dark</RadioCardLabel>
    </RadioCard>
  </RadioGroup>
</RadioProvider>
```

```css
.review-stage[data-backdrop="dark"] {
  background: oklch(16% 0 0);
}
.review-stage[data-backdrop="light"] {
  background: oklch(98% 0 0);
}
```

### R6 · Mobile review flow: one image, flip, decide

- What changes: Below the sidebar breakpoint the stage shows one image. A segmented control switches Baseline, Current, Diff. Press and hold on the image shows the other image (flip). Swipe left or right moves to the next or previous variant. Items open in a bottom sheet that closes on select. Two 48px actions sit in the thumb zone. No keyboard hints, no footer.
- Why it is better: Fixes A11Y-15 and A11Y-20. Today the first pane starts at 66% of the first screen. In this layout the image starts below two short rows.
- Sketch:

```
┌──────────────────────────────┐
│ ←  Success dialog      3/11 ⋯│ 44
│ React · Chromium · Dark  ▾   │ 36   (opens the variant sheet)
│ ┌──────────────────────────┐ │
│ │                          │ │
│ │       Current            │ │  flex (hold = Baseline)
│ │                          │ │
│ └──────────────────────────┘ │
│  [ Baseline | Current | Diff ]│ 40
│ ┌────────────┬─────────────┐ │
│ │  ✕ Reject  │  ✓ Approve  │ │ 52
│ └────────────┴─────────────┘ │
└──────────────────────────────┘
```

### R7 · Linked pan and zoom, and more compare modes

- What changes: Baseline and Current share one pan and zoom state. Mouse wheel with Ctrl or pinch zooms at the pointer. `+`, `-`, `0` zoom. Arrows pan when the stage has focus. New modes: overlay with an opacity slider, split slider (drag a divider), and blink (hold `Space` to flip).
- Why it is better: Fixes A11Y-06 and removes the pan buttons. Blink and split modes find small shifts faster than side by side.
- Sketch:

```tsx
const [view, setView] = useState({ x: 0, y: 0, zoom: "fit" as ReviewZoom });
<Stage onPan={setView} view={view}>
  <Pane role="reference" view={view} />
  <Pane role="candidate" view={view} />
</Stage>;
```

```
Split:  ┌───────────────┃───────────────┐      Overlay:  opacity ▁▁▁▃▅▇  42%
        │   Baseline    ┃    Current    │      Blink:    hold Space
        └───────────────┃───────────────┘
```

### R8 · Type and density tokens

- What changes: Three text sizes for the review page, all in `rem`: caption 0.75rem, control 0.8125rem, title 1.125rem. No `text-[Npx]`. No `opacity-*` on text; use `ak-ink-60` and `ak-ink-80`.
- Why it is better: Fixes A11Y-18 and A11Y-19. The review page goes from six sizes (10, 11, 12, 13, 16, 28) to three.
- Sketch:

```css
@theme {
  --text-caption: 0.75rem;
  --text-control: 0.8125rem;
  --text-title: 1.125rem;
}
```

```tsx
<Text className="text-caption ak-ink-60">Attempt 2 · aabbccd</Text>
```

### R9 · Review complete state

- What changes: When no variant needs review, the stage shows a summary: counts of approved and rejected variants, the check result, and two actions: "Back to queue" and "Open next run".
- Why it is better: Fixes A11Y-17. The reviewer gets a clear end and a next step.
- Sketch:

```
        ✓  Review complete
        11 approved · 0 rejected · check passed
        [ Open next run → ]   [ Back to queue ]      Undo last decision (⌘Z)
```

### R10 · Route titles, route announcer, and client links

- What changes: Each route sets `head.meta.title`. Header links and "Queue" use the router `Link`. A visually hidden `role="status"` element in the root announces the new title after navigation, and focus moves to the `h1`.
- Why it is better: Fixes A11Y-16. No full reload on header navigation.
- Sketch:

```tsx
// app-shell.tsx
<NavLink render={<Link to="/" search={{ view: "history" }} />} aria-current={active === "history" ? "page" : undefined}>
```

```tsx
// __root.tsx
const href = useRouterState({ select: (state) => state.location.href });
useEffect(() => {
  setAnnouncement(document.title);
  document.querySelector<HTMLElement>("main h1")?.focus();
}, [href]);
<p className="sr-only" role="status" aria-live="polite">
  {announcement}
</p>;
```

### R11 · Dense queue rows with one target per run

- What changes: One row per run (about 56px): status icon, PR number, title, counts, age, and one primary action. The whole row is a link. `J` / `K` or arrows move, Enter opens. Status color and icon come from one map.
- Why it is better: The queue page with eight runs is 1626px tall today at 1440 wide (`states.mjs`: `mainHeight` 1626). The same list fits in about 500px. Fixes A11Y-26.
- Sketch:

```
 ●  #4801  Fix Combobox popover position when the anchor scrolls…    14 pending · 2 rejected   2h    Review →
 ●  #4802  Dialog focus styles                                        3 pending                 3h    Review →
 ◔  #4804  Tabs: scroll-driven rounding                               comparing…                5h
 !  #4807  Popover: flip in RTL                                       run failed                7h    Open →
```

### R12 · Tooltips with shortcuts for icon buttons

- What changes: Replace `title` on icon buttons with the upstream `Tooltip`. The tooltip shows the label and a `Kbd`.
- Why it is better: Works on keyboard focus. Shows the shortcut where the user looks. Fixes part of A11Y-22 and A11Y-07.
- Sketch:

```tsx
<TooltipProvider>
  <TooltipAnchor render={<Button $p={2} aria-label="Next item" aria-keyshortcuts="ArrowDown" />}>
    <ButtonSlot>
      <ArrowDown />
    </ButtonSlot>
  </TooltipAnchor>
  <Tooltip>
    Next item <Kbd>↓</Kbd>
  </Tooltip>
</TooltipProvider>
```

## Screenshots

All paths are under `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-a11y/screens/`.

Matrix (5 pages × 5 widths × 2 schemes, viewport and full page, 100 files):

- `{queue,history,service,run,fixture-review}-{390,768,1024,1440,1920}-{dark,light}.png`: viewport capture.
- `…-full.png`: full-page capture. Note: sticky bars appear in the middle of full-page captures.

Review workspace:

- `run-1440-dark.png`, `run-1440-light.png`: preview run at 1440. Image top at 431px.
- `run-1024-light.png`: sidebar plus stage at 1024×768. Selected variant has no outline in light.
- `run-768-dark.png`: no sidebar; "Screenshots" button.
- `run-390-dark-full.png`, `run-390-light.png`: phone layout, stacked panes, two-row action bar, keyboard hints on touch.
- `run-1920-dark-full.png`: footer below the fold at 1080.
- `fixture-review-1440-dark.png`: 7 variants; the fourth pill is cut.
- `fixture-review-768-light.png`: light scheme; white capture on light stage.
- `state-variant-strip-1440-light.png`, `state-variant-strip-1440-dark.png`: selected pill against the others.
- `review-mixed-verdicts-1440-dark.png`: approved, rejected, error, and unchanged variants look the same.
- `state-review-complete-1440-dark.png`: all approved; no visible end state.
- `state-keyboard-help-1440-dark.png`, `state-keyboard-help-1440-light.png`, `mobile-keyboard-help-390-dark.png`: help dialog.
- `state-batch-dialog-1440-dark.png`, `mobile-batch-dialog-390-dark.png`: whole-item confirmation.
- `state-details-open-1440-dark.png`, `state-details-open-1440-light.png`, `mobile-details-dialog-390-dark.png`, `mobile-details-dialog-390-light.png`: capture details.
- `state-sidebar-collapsed-1440-dark.png`: sidebar closed with `[`.
- `state-filter-popover-1440-dark.png`: status filter popover of the search.
- `state-zoom-200-pan-buttons-1440-dark.png`, `mobile-zoom-200-390-dark.png`: 200% zoom with pan buttons.
- `mobile-diff-390-dark.png`: difference view on a phone.
- `mobile-screenshots-dialog-390-dark.png`, `mobile-screenshots-dialog-390-light.png`, `mobile-screenshots-dialog-after-select-390-dark.png`: item dialog; it stays open after select.
- `review-archived-{1440,390}-dark.png`, `review-terminal-failed-{1440,390}-dark.png`, `review-not-ready-{1440,390}-dark.png`, `review-long-names-{1440,390}-dark.png`, `review-mixed-verdicts-390-dark.png`: fixture states.
- `state-after-approve-focus-root-1440-dark.png`: the page after Enter on Approve; focus is on the root.

Focus indicators (2× scale crops):

- `focus-zoom-nav-link-dark.png`, `focus-zoom-nav-link-light.png`, `focus-zoom-nav-link-mobile-dark.png`, `focus-zoom-nav-link-mobile-light.png`: clipped ring on the main navigation.
- `focus-zoom-review-search-dark.png`, `focus-zoom-review-search-light.png`: ring cut at the top.
- `focus-zoom-review-item-dark.png`, `focus-zoom-review-item-light.png`: ring cut at left and right.
- `focus-zoom-variant-dark.png`, `focus-zoom-view-mode-dark.png`, `focus-zoom-approve-dark.png`, `focus-zoom-brand-dark.png`, `focus-zoom-user-menu-dark.png` (and `-light`): complete rings.
- `focus-zoom-workspace-root-dark.png`, `focus-zoom-workspace-root-light.png`: the root `div` as a focus target.
- `focus-history-search-dark.png`, `focus-history-search-light.png`: underline-only focus on the history search.
- `focus-history-row-link-dark.png`, `focus-nav-link-light.png` (and the other scheme): 1× crops.

Dashboard and other routes (mocked API through the route fixture):

- `dash-queue-busy-{1440-dark,1440-light,390-dark}.png`: 8 runs in three groups; gray "Needs review" badge on #4803; gray primary buttons.
- `dash-history-busy-{1440-dark,1440-light,390-dark}.png`: 24 rows.
- `dash-service-alerts-{1440-dark,1440-light,390-dark}.png`: three alerts with native `details`.
- `dash-queue-empty-…`, `dash-guest-…`, `dash-forbidden-…`, `dash-error-…`, `dash-loading-…` (each `1440-dark`, `1440-light`, `390-dark`).
- `pull-pending-…`, `pull-failed-…`, `pull-guest-…`, `run-guest-…`, `run-error-…`, `run-loading-…` (each `1440-dark`, `1440-light`, `390-dark`).
- `state-operations-popover-1440-dark.png`, `state-operations-popover-390-dark.png`: alerts popover.
- `state-user-menu-1440-dark.png`, `mobile-user-menu-390-dark.png`: account popover.

Media and scaling:

- `forced-colors-review-1440-dark.png`, `forced-colors-review-1440-light.png`, `forced-colors-queue-1440-light.png`: forced colors emulation.
- `contrast-more-review-1440-dark.png`, `contrast-more-review-1440-light.png`: `prefers-contrast: more`.
- `zoom200-of-1440x900-{queue,history,review,run}.png`, `zoom200-of-1280x1024-{queue,history,review}.png`, `zoom400-of-1280x1024-{queue,history,review,run}.png`: browser zoom equivalents.
- `user-font16-1200-review.png`, `user-font20-1200-review.png`, `user-font32-1440-review.png`: default font size 16, 20, 32px.
- `classic-scrollbar-1030-review.png`: 1030px window with a 15px scrollbar; no sidebar and no "Screenshots" button.

## Measurements (command, raw result, limits)

All commands are `node $S/<script>.mjs`. Each script launches Chrome with `chromium.launch({ channel: "chrome" })` from the repository's `@playwright/test`. Raw JSON is in `$S/data/`.

| Command                                  | What it measures                                                                                 | Raw result (short)                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matrix.mjs` then `matrix-table.mjs`     | 5 pages × 5 widths × 2 schemes: page overflow, key rectangles, `color-scheme`                    | `pageOverflowX` false in all 50 cases. `html color-scheme: light dark`. Image top and footer top per size: see A11Y-14. Data: `matrix.json`.                                        |
| `tab-order.mjs`                          | Tab sequence and focus indicator on 6 page variants                                              | Queue 8 stops, history 9, service 7, run 24, run at 390 22, fixture 35. No skip link. Data: `tab-order.json`.                                                                       |
| `focus-shots.mjs`                        | 2× crops of 10 focus targets and their clipping ancestors                                        | Nav link: `nav overflow auto/auto` and `shell-bar-center overflow clip/clip`, both with the link's own rect.                                                                        |
| `keyboard.mjs`                           | K1 to K10 probes on the fixture and on the routed preview app                                    | Quoted in A11Y-01, 02, 04, 05, 07, 17, 24. Data: `keyboard.json`.                                                                                                                   |
| `keyboard2.mjs`                          | J1 to J6 probes                                                                                  | Search field keeps its keys (`"value":"axsdfg12","calls":0`). `?` and `/` do nothing. Tab distances 30, 24, 18. Mobile dialog returns focus to its trigger. Data: `keyboard2.json`. |
| `mobile.mjs`                             | Target sizes, horizontal strips, mobile states                                                   | Quoted in A11Y-12, 15, 20. Data: `mobile.json`.                                                                                                                                     |
| `contrast.mjs` then `contrast-table.mjs` | WCAG contrast of every visible text run, 7 states × 2 schemes                                    | Quoted in A11Y-18, 19. Data: `contrast.json`.                                                                                                                                       |
| `semantics.mjs`                          | Landmarks, headings, names, live regions, titles, focus after navigation, primary button style   | Quoted in A11Y-13, 16, 22. Data: `semantics.json`.                                                                                                                                  |
| `media.mjs`                              | Reduced motion, forced colors, more contrast, zoom, default font size, pane sync, document loads | Quoted in A11Y-03, 06, 10, 16, 25. Data: `media.json`.                                                                                                                              |
| `media2.mjs`                             | Selected-state contrast, sidebar timing, zoom on the routed run page                             | Quoted in A11Y-10, 14, 25. Data: `media2.json`.                                                                                                                                     |
| `states.mjs`, `run-guest.mjs`            | Dashboard, pull, and run states with mocked API; review states through `window.reviewFixture`    | Headings and status text per state. `dash-queue-busy 1440`: `"wordCount":176,"mainHeight":1626`. Data: `states.json`.                                                               |
| `scrollbar.mjs`                          | Sidebar visibility with a 15px space-taking scrollbar                                            | Quoted in A11Y-03.                                                                                                                                                                  |

Positive results that are not findings:

- No horizontal page scroll at 390, 768, 1024, 1440, 1920, at 200% zoom (720×450, 640×512), or at 400% zoom (320×256), on queue, history, and review.
- `ak-ink-60` text passes 4.5:1 in both schemes. The focus ring color passes 3:1 against the canvas in both schemes.
- Text fields, the combobox, menus, and dialogs keep their own keys. Held keys do not repeat commands (`event.repeat`).
- Dialogs trap and restore focus (help: focus to "Close help", then back to the trigger; mobile items: back to "Screenshots").
- Shell and popover motion stop under `prefers-reduced-motion: reduce`.
- All images have `alt`. All decorative icons are hidden from assistive technology. No control lacks an accessible name.

Limits:

- Chrome only, headless, macOS. No Firefox, no Safari, no real phone, no real touch.
- Dev servers, not a production build. The preview app has one run with one item and two variants; richer states come from the browser-test fixtures and from mocked API responses.
- Contrast comes from computed styles. Text over gradients or images is not sampled. Ancestor opacity is folded into the text alpha.
- Browser zoom is emulated by viewport size and device scale. The default font size is emulated with the DevTools Protocol command `Page.setFontSizes`. Forced colors and `prefers-contrast` use Chromium emulation, not Windows High Contrast.
- The classic scrollbar is emulated with a 15px `::-webkit-scrollbar` on `html`.
- Timings (285ms sidebar) come from a dev server on one machine. They show that motion exists, not production speed.
- The first `run-guest` capture used an error body without a `message` field, which the client rejects (`review/client.ts:273`). `run-guest.mjs` replaced those three files with a valid 401 body.

## Open questions and items not verified

1. Screen readers: not tested with VoiceOver, NVDA, or JAWS. Assumption from documented behavior: in NVDA and JAWS browse mode, single letters (`A`, `X`, `S`, `D`, `F`, `G`, `1`-`6`) are quick-navigation keys and do not reach the page. The page has no modifier-based alternative, so those users depend on the buttons, which makes A11Y-02 more important.
2. Firefox "search for text when you start typing" and Safari were not tested against the single-key shortcuts.
3. Real keyboard layouts (A11Y-24) were simulated with synthetic `KeyboardEvent`s only.
4. `prefers-contrast: more`: in `contrast-more-review-1440-light.png` the status dots of the item list all render near black, so the yellow and green hues are gone. The row text still gives the status. Not analyzed further.
5. Windows High Contrast themes were not tested. Chromium forced-colors emulation shows the selected variant with no distinct style (A11Y-10).
6. The footer button "Recompare stored run" renders for non-preview runs (`review-workspace.tsx:1186-1197`), and `docs/review-guide.md:88` calls it retired. I did not check what the server returns for `recompareAllowed`. Another lane may own this.
7. Variants beyond six have no number key. The real maximum number of variants per item in Ariakit runs is unknown to me; the fixture uses seven.
8. Tall captures (full-page screenshots) were not tested. In "Fit" mode the image is limited by `max-h-full` of a 504px viewport, so a tall capture becomes small. The fixture images are 600×400.
9. iOS safe areas: the shell recipe pads for `env(safe-area-inset-*)` (`styles/shell.ts:136-137, 289`). The sticky action bar inside the main body was not checked on a device with a home indicator.
10. Should phone review be supported at all (A11Y-15)? The guide says it is outside launch validation.
