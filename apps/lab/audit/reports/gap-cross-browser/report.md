# Firefox and Safari (WebKit): rendering, keyboard, and focus behavior that every lane tested only in Chrome

Lane key: `gap-cross-browser`. Finding prefix: `XBR`. Audit date: 2026-10-05. Read-only audit.

Scratch directory: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-cross-browser/` (called `$S` below). Scripts are in `$S`. Screenshots are in `$S/screens` (921 files). Raw output is in `$S/data` (330 files).

Engines, all through Playwright 1.63.0 on macOS (Darwin 25.6.0):

| Name in this report | Build                              | Version       | User agent                                                         |
| ------------------- | ---------------------------------- | ------------- | ------------------------------------------------------------------ |
| Chrome              | system Chrome, `channel: "chrome"` | 154.0.8037.98 | `HeadlessChrome/154.0.0.0` (headless), `Chrome/154.0.0.0` (headed) |
| Firefox             | Playwright `firefox-1543`          | 155.0         | `Firefox/155.0`                                                    |
| WebKit              | Playwright `webkit-2359`           | 26.6          | `Version/26.6 Safari/605.1.15`                                     |

Limits: Playwright WebKit is not Safari. Playwright Firefox is a patched build. No real iOS device was used. No screen reader was used. The stated launch scope is "Chrome Desktop and keyboard operation" (`docs/review-guide.md:94`). Thus Firefox and Safari findings are outside the launch scope. They are input for the redesign.

## How it works (map)

### The parts of the UI that depend on the engine

1. **Stage background.** `apps/web/src/components/screenshot-viewer.tsx:134` paints the image stage with one arbitrary Tailwind class: `bg-[repeating-conic-gradient(color-mix(in_oklch,currentColor_6%,transparent)_0%_25%,transparent_0%_50%)] bg-size-[20px_20px]`. `currentColor` on a layer is an `oklch()` value. Thus the gradient has non-sRGB colors, and the engine interpolates it in Oklab.
2. **Native controls.** The app has three native widgets with engine styles: `<progress>` (`apps/web/src/review/review-workspace.tsx:599-604`, class `hidden sm:block h-1.5 w-16 accent-brand`), `<select>` (`apps/web/src/routes/index.tsx:674-686`), and `<details>` in the alert cards. The history search is a plain `<input>` with no `type` (`routes/index.tsx:656-662`), so WebKit adds no search decoration.
3. **Layer colors.** Each `$layer` value becomes `--layer-color`. `@ariakit/tailwind` registers its color properties with `initial-value: canvas` (`node_modules/@ariakit/tailwind/src/output.css:1657-1723`) and computes the surface with `oklch(from var(--_ak-layer-color, var(--ak-layer-parent, canvas)) …)` (`output.css:139`). A name that is not a color falls back to the system color `canvas`. The app uses `$layer="primary"` in six places (`routes/index.tsx:301`, `:310`, `:346`, `:508`, `routes/pulls.$pullNumber.tsx:194`, `:226`). The theme has no `primary` color.
4. **Borders.** `$border` with the default border type uses the `ak-frame-bordering` utility (`output.css:1347-1372`). It draws a real 1px border when the layer is dark and a ring (a box shadow) when the layer is light.
5. **Gliders.** The selected marker of the header nav, the item list, and the variant strip is one element that uses CSS anchor positioning (`components/ariakit/styles/glider.ts:14-59`, `components/ariakit/components/nav.ariakit.react.tsx:201-277`). A horizontal nav glider is `position: fixed` (`nav.ariakit.react.tsx:223`). All engines but Firefox change the header bar glider back to `position: absolute` with an `@supports not (-moz-appearance: none)` rule (`nav.ariakit.react.tsx:273-276`). `CSS.supports("anchor-name: --a")` is true in all three engines.
6. **Links against buttons.** The header nav (`components/app-shell.tsx:29`, `:52-64`), "Queue" (`review-workspace.tsx:580`), the variant chips (`review-workspace.tsx:732-780`, `NavLink`), and, on the routed page, the item rows (`review/item-list.tsx:195-215`) are `<a>` elements. All other controls are `ak.Button`.
7. **Dates and numbers.** `routes/index.tsx:156` and `components/operations-attention/index.tsx:206` call `toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })`. The string comes from the ICU data of the engine.
8. **Fonts.** The theme names `"Inter Variable", ui-sans-serif, system-ui, sans-serif` (`components/ariakit/styles/ui.css:12-14`). Code uses the Tailwind default `ui-monospace, SFMono-Regular, Menlo, …`. The app ships no font.

### Keyboard and focus sequence (the same code in all engines)

1. One `keydown` listener on `document` (`review-workspace.tsx:443-448`) calls `onKeyDown` (`:395-442`).
2. The handler returns when the event target is inside `input, textarea, select, [contenteditable], [role="textbox"], [role="menu"], [role="menubar"], [role="dialog"], [role="alertdialog"], [role="tablist"], .review-variants, [data-screenshot-search]` (`:88-97`).
3. The handler calls `preventDefault()` only for a key that it handles (`:441`). All other keys keep the browser default.
4. After a decision and after Undo, `use-review-session.ts` calls `onFocus()`, which is `workspace.current?.focus({ preventScroll: true })` (`review-workspace.tsx:248`). The workspace root is a `div` with `tabIndex={0}` (`:528-534`).
5. Where a mouse click puts focus is engine behavior. Chrome and Firefox focus a clicked link. WebKit does not. WebKit moves focus to the nearest focusable ancestor, which is the workspace root.
6. Which elements Tab stops at is engine behavior. WebKit skips links that have no `tabindex` attribute. Firefox also stops at each scroll container that overflows.

### State by engine

22 states, dark and light, 1440 × 900 (states 21 and 22: 390 × 844). Script: `$S/matrix.mjs`. Comparison: `$S/compare.mjs` (pixelmatch, threshold 0.1) and a box comparison of each DOM element. Files: `$S/screens/<state>--<engine>--<scheme>.png` and `$S/screens/diff--<state>--<engine>--<scheme>.png`.

The pixel column shows the share of different pixels against Chrome as dark / light. Each state has 0.04% to 0.5% of text anti-aliasing noise, because the three engines rasterize the same San Francisco glyphs differently. That noise is ignored below. In the fixture harness an unstyled "Outside search" input is above the app. It is 43 px wider in Firefox and 22 px wider in WebKit. It is not part of the app and is ignored.

| State                     | Firefox 155 against Chrome                                                                                                           | Pixels      | WebKit 26.6 against Chrome                                                                                                                                       | Pixels      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 01 sign-in                | Dark: the "Sign in with GitHub" button and the icon tile are near-black, not near-white (XBR-02). Light: same                        | 1.30 / 0.28 | Same                                                                                                                                                             | 0.15 / 0.15 |
| 02 forbidden              | Dark: "Use another account" is near-black (XBR-02)                                                                                   | 0.57 / 0.25 | Same                                                                                                                                                             | 0.13 / 0.13 |
| 03 queue, 8 runs          | Dark: each "Review changes" button is near-black (XBR-02). No element moves                                                          | 1.04 / 0.43 | Dates read "Oct 5, 2026 at 2:24 PM" (XBR-10). Commit hashes are 2.3 px wider (XBR-11). 16 elements move up to 11.2 px                                            | 0.40 / 0.42 |
| 04 history, 8 runs        | The select is 17 px high with a thin chevron (Chrome 19 px) (XBR-12). Field frames sit on other pixel rows (y 210.50 against 210.48) | 2.04 / 2.17 | Dates with "at": the Created column is 10.4 px wider and the Run column 7.9 px narrower. 67 elements move. The select has up and down chevrons and a 5 px radius | 1.82 / 1.89 |
| 05 service status, alerts | Same                                                                                                                                 | 1.52 / 1.56 | Dates with "at" (+11.2 px). Code in SF Mono                                                                                                                      | 0.83 / 0.85 |
| 06 bell popover           | The popover is 1 px lower (y 50 against 49). Dark: buttons behind it are near-black (XBR-02)                                         | 2.39 / 1.61 | "Last checked Oct 5, 2026 at 2:30 PM" wraps after "Oct 5,"                                                                                                       | 0.80 / 0.82 |
| 07 account menu           | Menu: same. Dark: buttons behind it are near-black (XBR-02)                                                                          | 1.04 / 0.43 | Menu: same                                                                                                                                                       | 0.41 / 0.43 |
| 08 pull page, pending     | Same (largest box difference 0.3 px)                                                                                                 | 0.31 / 0.33 | Same                                                                                                                                                             | 0.18 / 0.19 |
| 09 workspace default      | Stage background is triangles (XBR-01). Progress is blue on near-white (XBR-03)                                                      | 0.64 / 0.52 | Same                                                                                                                                                             | 0.50 / 0.48 |
| 10 many variants          | As state 09. Strip and glider: same                                                                                                  | 0.66 / 0.53 | Same                                                                                                                                                             | 0.51 / 0.49 |
| 11 Details open           | As state 09                                                                                                                          | 1.00 / 0.91 | Commit hash in SF Mono, 2.3 px wider                                                                                                                             | 0.66 / 0.60 |
| 12 Difference mode        | As state 09                                                                                                                          | 0.59 / 0.51 | Same                                                                                                                                                             | 0.44 / 0.46 |
| 13 zoom 200%              | As state 09. Pixelated scaling: same                                                                                                 | 0.49 / 0.50 | Same                                                                                                                                                             | 0.44 / 0.46 |
| 14 whole-item dialog      | Same. Dialog box 480 × 427 at (480, 236) in all three                                                                                | 0.86 / 0.85 | Same                                                                                                                                                             | 0.88 / 0.90 |
| 15 keyboard help dialog   | Same                                                                                                                                 | 1.05 / 1.07 | Same                                                                                                                                                             | 0.48 / 0.52 |
| 16 status filter popover  | Same                                                                                                                                 | 0.93 / 0.82 | Same                                                                                                                                                             | 0.80 / 0.80 |
| 17 search with text       | Same                                                                                                                                 | 0.52 / 0.39 | Same                                                                                                                                                             | 0.39 / 0.37 |
| 18 read-only run          | As state 09                                                                                                                          | 0.63 / 0.60 | Same                                                                                                                                                             | 0.51 / 0.50 |
| 19 save error             | As state 09                                                                                                                          | 0.55 / 0.52 | Same                                                                                                                                                             | 0.50 / 0.49 |
| 20 loading                | Same                                                                                                                                 | 0.11 / 0.12 | Same                                                                                                                                                             | 0.04 / 0.04 |
| 21 phone default          | Stage background is triangles (XBR-01). The progress element is hidden below `sm`                                                    | 1.13 / 1.14 | Same                                                                                                                                                             | 1.18 / 1.20 |
| 22 phone item dialog      | Dialog: same. Behind the dialog, Chrome with `isMobile` locks the body with `position: fixed`. Firefox uses `overflow: hidden` only  | 1.50 / 1.57 | Dialog: same. `overflow: hidden` only                                                                                                                            | 1.40 / 1.45 |

Sheets that were read for this table (columns: Chrome, Firefox, WebKit): `$S/screens/sheet-states-dialogs.png`, `sheet-states-sidebar.png`, `sheet-states-stage.png`, `sheet-states-pages.png`, `sheet-phone-default.png`, `sheet-sign-in-card.png`, plus the full images of state 09 and state 22 in each engine.

### What is the same in all three engines (measured)

- Gliders: position and size against the selected control are equal (delta 0 px) for the header nav, the item list, and the variant strip, at rest, after a chip click, after page scroll, and after strip scroll (`$S/probe-dynamic.mjs`). One exception is headless Firefox (XBR-17).
- Popover and dialog enter: the bell popover and the account menu start at `opacity: 0; scale: 0.95` and settle in 480 to 505 ms in each engine. The three dialogs and the filter listbox have no enter animation in any engine.
- `image-rendering: pixelated`: at 100% and 200%, at device pixel ratio 1 and 2, a block of 1 px lines has exactly 2 colors in each engine. At "Fit" each engine smooths (13 to 22 colors).
- Sticky bars and viewport units: the header and the action bar have the same boxes. `100vh`, `100dvh`, `100svh`, and `100lvh` are equal in each engine (Playwright has no dynamic toolbar).
- Shortcuts: each of the 21 bound keys does the same thing and is `defaultPrevented` in each engine (`$S/probe-keys.mjs`).
- The readiness gate: each of the 8 image cases ends in the same state in each engine (XBR-15).
- Back and forward: the same requests and the same restored state in each engine (XBR-16).
- The UI font: no engine finds "Inter Variable". All three render San Francisco. The same `h1` is 182.73 px (Chrome), 182.35 px (Firefox), and 182.74 px (WebKit) wide.

## Findings

Each finding names the engines and says if headless mode can cause the result. "Headed" means a run with `launch({ headless: false })`.

### XBR-01 · Firefox draws the stage background as triangles, not as a checkerboard

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Engines: Firefox 155. Chrome 154 and WebKit 26.6 are correct. Headless effect: no. Headed Firefox gives the same result.
- Evidence:
  - `apps/web/src/components/screenshot-viewer.tsx:134`: `bg-[repeating-conic-gradient(color-mix(in_oklch,currentColor_6%,transparent)_0%_25%,transparent_0%_50%)] bg-size-[20px_20px]`.
  - Computed value, equal in all three engines: `repeating-conic-gradient(oklch(1 0 0 / 0.06) 0%, oklch(1 0 0 / 0.06) 25%, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0) 50%)`, size `20px 20px`.
  - `$S/probe-stage.mjs` compares each pixel of an 80 × 40 px crop with an ideal checkerboard. 100 = checkerboard, 50 = no relation.

    | Declaration                       | Chrome | Firefox                   | WebKit |
    | --------------------------------- | ------ | ------------------------- | ------ |
    | A. current CSS                    | 100    | 77.5 (bright share 27.5%) | 100    |
    | A9. same, opaque `oklch()` colors | 100    | 77.5                      | 100    |
    | A10. hex colors with `in oklab`   | 100    | 77.5                      | 100    |
    | A6. current CSS with `in srgb`    | 100    | 100                       | 100    |
    | B. `rgba()` colors                | 100    | 100                       | 100    |
    | C. hex colors                     | 100    | 100                       | 100    |
    | F. four linear gradients          | 100    | 100                       | 100    |
    | H. SVG data URI                   | 100    | 100                       | 100    |
    | I. SVG as a mask on a layer color | 100    | 100                       | 100    |

  - Headed Firefox (`$S/probe-headed.mjs`): `"current": {"checkerMatch": 77.5}`, `"srgb": {"checkerMatch": 100}`.
  - Screenshots: `$S/screens/sheet-stage.png` (dark and light), `stage-candidates--firefox--1x.png`.
- What happens: Firefox renders a `repeating-conic-gradient` with hard stops wrong when the gradient interpolates in a non-sRGB color space. An `oklch()` color or a `color-mix(in oklch, …)` color selects Oklab interpolation. Each 20 px tile then shows two triangles. With sRGB colors, or with the `in srgb` hint, Firefox draws the squares.
- Impact: The stage is the largest surface of the product. In Firefox each review image sits on a diagonal pattern. The pattern looks like a rendering defect of the screenshot, which is the thing under review. Transparent areas of a diff mask show the same pattern.
- Recommendation: Do not interpolate. Add the color space hint, which is the smallest change:

  ```tsx
  // screenshot-viewer.tsx:134
  "bg-[repeating-conic-gradient(in_srgb,color-mix(in_oklch,currentColor_6%,transparent)_0%_25%,transparent_0%_50%)] bg-size-[20px_20px]";
  ```

- Alternatives: (a) An SVG tile as a mask on a layer color (candidate I). It follows the theme and uses no gradient. See redesign idea R1. (b) Hex or `rgba()` colors, as the lab does (`apps/lab/src/routes/dev.fixtures.tsx:549`: `repeating-conic-gradient(#8883_0_25%,#0000_0_50%)`). This is safe in Firefox but does not follow the layer color. (c) A plain recessed surface with no pattern, and the pattern only behind images that have transparency.
- Maintainer decision needed: no.

### XBR-02 · `$layer="primary"` is near-white in Chrome and WebKit and near-black in Firefox (dark scheme)

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Engines: Firefox 155 against Chrome 154 and WebKit 26.6. Dark scheme only. Headless effect: no. Headed runs give the same values.
- Evidence:
  - Six uses: `apps/web/src/routes/index.tsx:301` (icon tile), `:310` ("Sign in with GitHub"), `:346` ("Use another account"), `:508` ("Review changes"), `apps/web/src/routes/pulls.$pullNumber.tsx:194`, `:226`.
  - The theme has no `--color-primary`. `$S/probe-primary.mjs` reads `"colorPrimary": "(not defined)"` in each engine.
  - `node_modules/@ariakit/tailwind/src/output.css:1657`: `initial-value: canvas;` and `:139`: `oklch(from var(--_ak-layer-color, var(--ak-layer-parent, canvas)) …)`.
  - Computed `background-color` of the "Review changes" button (`$S/data/primary.json`):

    | Scheme | Chrome                                 | Firefox                             | WebKit            |
    | ------ | -------------------------------------- | ----------------------------------- | ----------------- |
    | dark   | `oklch(0.949994 0.0000497986 23.7884)` | `oklch(0.276354 0.0135107 291.835)` | `oklch(0.95 0 0)` |
    | light  | `oklch(0.949994 …)`                    | `oklch(0.95 5.96046e-8 0)`          | `oklch(0.95 0 0)` |

  - The system color in the same page: `Canvas` is `rgb(18, 18, 18)` (Chrome dark), `rgb(28, 27, 34)` (Firefox dark), `rgb(30, 30, 30)` (WebKit dark).
  - Pixels in the dark sign-in screenshot (`$S/sample.mjs`): button fill `#eeeeee` (Chrome), `#28272e` (Firefox), `#eeeeee` (WebKit). Card behind it: `#17191d`.
  - Screenshots: `$S/screens/sheet-sign-in-card.png`, `sheet-primary-button.png`, `sheet-states-pages.png` (first row).
- What happens: `primary` is not a color. The registered property falls back to its initial value, the system color `canvas`. Chrome and WebKit resolve that initial value as white in both schemes, so the button is `oklch(0.95 0 0)`. Firefox resolves it with the used color scheme. In the dark scheme the base is `rgb(28, 27, 34)` and the button is 5% lighter than that.
- Impact: In Firefox with a dark system theme, the main action of the sign-in page, the forbidden page, the pull page, and each queue card is a dark gray button (`#28272e`) on a dark gray card (`#17191d`). It reads as a secondary action. The design intent (a high-contrast main action) exists in two engines only by accident: the value is undefined in all three.
- Recommendation: Use a color that the theme defines. For the main action:

  ```tsx
  <Button $layer="brand" render={<Link to="/runs/$runId" params={{ runId: run.id }} />}>
    <ButtonLabel>Review changes</ButtonLabel>
  </Button>
  ```

  For a neutral high-contrast surface, use `$invert`, which the layer recipe defines for both schemes.

- Alternatives: (a) Define `--color-primary` in `review.css` so that the six uses keep their meaning. (b) Add a type guard: the `$layer` prop accepts any string today, so a wrong name is not a compile error.
- Maintainer decision needed: yes. Is the main action a brand surface or an inverted neutral surface?

### XBR-03 · The native progress element ignores the brand color in all engines, and its colors differ by engine

- Kind: visual
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Engines: all three. Headless effect: no. Headed runs give the same pixels.
- Evidence:
  - `apps/web/src/review/review-workspace.tsx:599-604`: `<progress aria-label="Review progress" … className="hidden sm:block h-1.5 w-16 accent-brand" />`.
  - Pixels of the bar (`$S/probe-render.mjs`, the same in dark and light, at device pixel ratio 1 and 2):

    |       | Chrome    | Firefox   | WebKit    |
    | ----- | --------- | --------- | --------- |
    | Fill  | `#008000` | `#0064b4` | `#008000` |
    | Track | `#808080` | `#e6e6e6` | `#808080` |

  - Computed style in each engine: `appearance: auto`, `accent-color: oklch(0.567 0.1546 248.516)`, `border: 0px solid`.
  - `$S/probe-stage.mjs` adds the same element with `border: revert`: the fill becomes `#3b78a1` on `#b2b2b2` (Chrome), `#007acc` on `#e9e9ed` (Firefox), `#00c1ff` on `#343434` (WebKit).
  - Screenshots: `$S/screens/sheet-progress.png`, `sheet-progress-candidates.png`, `sheet-states-sidebar.png` (third row).
- What happens: The Tailwind preflight sets `border: 0 solid` on each element. A native widget with an author border leaves the themed look and uses the legacy look of the engine. In that look `accent-color` has no effect. Thus `accent-brand` is dead code. Chrome and WebKit show pure green on mid gray. Firefox shows blue on near-white, in the dark scheme too.
- Impact: The only progress indicator of the run header has colors that no token defines. Green means "approved" in the same page, so the green fill reads as a status. In Firefox the near-white track is the brightest element of the dark header.
- Recommendation: Do not use the native element. Use a `role="progressbar"` element that the theme paints. The upstream `Progress` primitive does this, and the lab copy renders the same in the three engines (`$S/screens/sheet-lab-progress.png`). See redesign idea R2.
- Alternatives: (a) Minimal: `appearance-none` plus `::-webkit-progress-bar`, `::-webkit-progress-value`, and `::-moz-progress-bar` rules. This needs three pseudo-elements and stays engine code. (b) Remove the bar and keep the text "9 of 11 need review", which already carries the value.
- Maintainer decision needed: no.

### XBR-04 · In WebKit, Tab skips all 13 links: the header nav, "Queue", the item rows, and the variant chips

- Kind: accessibility
- Severity: medium. Confidence: high for Playwright WebKit, medium for Safari. Measured: yes. Effort: M
- Engines: WebKit 26.6. Headless effect: no. Headed WebKit gives the same counts.
- Evidence (`$S/probe-tab.mjs`, start on the workspace root, routed run page `/runs/run-42`):

  | Engine and key     | Tab stops | Links reached | "Approve & next" is stop |
  | ------------------ | --------- | ------------- | ------------------------ |
  | Chrome, Tab        | 34        | 13            | 31                       |
  | Firefox, Tab       | 35        | 13            | 32                       |
  | WebKit, Tab        | 21        | 0             | 18                       |
  | WebKit, Option+Tab | 34        | 13            | 31                       |
  - WebKit, Tab, not reached: `a "Visonaut review queue" | a "Review queue" | a "Run history" | a "Service status" | a "Success dialog…" (the selected item row) | a "Queue" | a "1. React …" … a "7. Wide …"`.
  - In the fixture, where item rows are buttons, WebKit reaches the item list. In the real route they are `Link` elements (`apps/web/src/review/item-list.tsx:195-215`).
  - Headed WebKit (`$S/probe-headed.mjs`): `"routedTab": {"stops": 21, "links": 0}`, `"routedAltTab": {"stops": 34, "links": 13}`.
  - `$S/probe-tabindex-links.mjs` sets `tabindex="0"` on the live DOM: with the attribute on the selected chip and the selected row, Tab reaches both (23 stops). With the attribute on each link, Tab reaches 15 links.
  - WebKit adds `tabindex="0"` to no link. Ariakit adds it to each button in WebKit (18 buttons have the attribute in WebKit and 0 in Chrome).

- What happens: WebKit follows the macOS convention: Tab moves between form controls and elements with a `tabindex` attribute. Links need Option+Tab, or the Safari setting "Press Tab to highlight each item on a webpage". The app uses links for four groups of controls. In WebKit a keyboard user cannot focus the item list, a variant chip, the header nav, or "Queue" with Tab.
- Impact: The arrow shortcuts still change the item and the variant, so the review task is possible. But the fallback path of the page (Tab, then Enter) loses the two selection controls and all navigation. A reviewer with shortcuts off (the WCAG 2.1.4 switch) has no keyboard path to another item in Safari with default settings.
- Recommendation: Make each selection group one composite with one Tab stop that is not a bare link. For the variants, a tab list or a radio group. For the items, the existing composite with an explicit `tabIndex={0}` on the active row. See redesign idea R3.

  ```tsx
  // Minimal form for the chips: a roving tabindex.
  <NavLink tabIndex={entry.id === variant.id ? 0 : -1} … />
  ```

- Alternatives: (a) Minimal: add `tabIndex={0}` to each `NavLink` and to "Queue". This keeps 34 stops in each engine. (b) Keep links and document Option+Tab. This is the Safari default, and Safari users know it, but it does not fix the 30 stops before "Approve & next" (WORK-29).
- Maintainer decision needed: yes. Are items and variants navigation (links, open in a new tab) or selection inside one page (tabs or radios)? The answer selects the element type.

### XBR-05 · Where a click puts focus differs: WORK-01 and A11Y-01 reproduce in Chrome and Firefox, and not in WebKit

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Engines: Chrome 154 and Firefox 155 show the defect. WebKit 26.6 hides it. Headless effect: no. Headed runs give the same result.
- Evidence (`$S/probe-focus.mjs`, the same on the fixture and on the routed page):

  | After a mouse click on                     | Chrome                   | Firefox                  | WebKit                   |
  | ------------------------------------------ | ------------------------ | ------------------------ | ------------------------ |
  | a button ("Details")                       | the button               | the button               | the button               |
  | a variant chip (link)                      | the chip                 | the chip                 | `div "Review workspace"` |
  | "Queue" (link)                             | the link                 | the link                 | `div "Review workspace"` |
  | a header nav link                          | the link                 | the link                 | `div "Review workspace"` |
  | an item row (routed, link with `tabindex`) | the row                  | the row                  | the row                  |
  | the heading (not focusable)                | `div "Review workspace"` | `div "Review workspace"` | `div "Review workspace"` |
  - Re-test of WORK-01, after a click on chip 2:

    |                                    | Chrome | Firefox | WebKit |
    | ---------------------------------- | ------ | ------- | ------ |
    | Focus is inside `.review-variants` | true   | true    | false  |
    | `D` changes the view               | false  | false   | true   |
    | `↓` changes the item               | false  | false   | true   |
    | `A` saves a decision               | false  | false   | true   |

  - `apps/web/src/review/review-workspace.tsx:94-96`: the exclusion selector contains `.review-variants`.

- What happens: Chrome and Firefox focus the clicked chip. The chip is inside `.review-variants`, so the page ignores each shortcut until focus moves out. WebKit does not focus a link on click. It focuses the nearest focusable ancestor. That is the workspace root, because the root has `tabIndex={0}`. Thus in WebKit the shortcuts work after a chip click, and the cause is a side effect of an element that A11Y-02 recommends to remove from the tab order.
- Impact: The high finding of two lanes is true for Chrome and Firefox. A fix that depends on click focus (for example "move focus to the stage in the chip `onClick`") works differently in WebKit. Assumption, not measured: if the root loses `tabIndex`, a click on a chip in WebKit leaves focus on `body`, and the shortcuts still work, because the handler listens on `document`. The measured base for this is the plain button test in XBR-07, where WebKit leaves focus on `body` after a click.
- Recommendation: Decide by key and by element type, not by focus region. Then the result does not depend on where a click puts focus.

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

- Alternatives: (a) Remove `.review-variants` from the selector and call `stopPropagation()` in `followVariantLink` for its four keys. (b) Make the strip a tab list (redesign idea R3). Then `[role="tablist"]` owns the arrows by role and letters pass.
- Maintainer decision needed: no.

### XBR-06 · A11Y-02 re-test: focus goes to the page root after each decision in all engines, and the ring on the root differs

- Kind: accessibility
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Engines: all three. Headless effect: no.
- Evidence (`$S/probe-focus.mjs`, `$S/probe-misc.mjs`):

  |                                                                   | Chrome                                                                  | Firefox                                 | WebKit                                           |
  | ----------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------ |
  | Focus after a click on "Approve & next"                           | `div "Review workspace"`, 1440 × 1014                                   | the same                                | the same                                         |
  | Focus after a click on "Undo"                                     | `div "Review workspace"`                                                | the same                                | the same                                         |
  | Focus after Enter on "Approve & next"                             | the root, `:focus-visible` true, `outline: auto 1px rgb(153, 200, 255)` | the root, true, `auto 3px oklch(1 0 0)` | the root, true, `auto 3px oklch(1 0 0)`          |
  | Root ring after the `A` shortcut (root focused by a click before) | `:focus-visible` true, ring                                             | false, no ring                          | true, ring                                       |
  | Next Tab after a decision                                         | `a "Visonaut review queue"`                                             | `a "Visonaut review queue"`             | `input "Search screenshots"` (links are skipped) |
  - `review-workspace.tsx:248`: `workspace.current?.focus({ preventScroll: true })` and `:528-534`: the root has `tabIndex={0}`.
  - Screenshots: `$S/screens/focus-root-after-a-key--webkit.png` (a blue line across the page top after `A`), `sheet-rings-root.png`, `sheet-root-ring-routed.png` (Chrome draws a 1 px line on the right page edge).

- What happens: The finding of the accessibility lane is the same in the three engines. Two details differ. First, the default `auto` ring that the root gets is 1 px light blue in Chrome and 3 px in Firefox and WebKit, and most of it is outside the viewport. Second, after a shortcut key Chrome and WebKit show that ring around the page, and Firefox does not.
- Impact: As in A11Y-02: each decision with Enter or Space sends a keyboard user back to the start of the page. In Chrome and WebKit, a shortcut user also sees a page-size ring appear after the first `A` or `X`.
- Recommendation: As in A11Y-02: do not move focus after a decision, announce the new selection, and take the root out of the tab order. See redesign idea R4.
- Alternatives: Focus the `section aria-label="Selected variant"` (`review-workspace.tsx:787-798`, already `tabIndex={-1}`) and give it an explicit inset focus style, so that no engine default ring shows.
- Maintainer decision needed: yes. The same question as A11Y-02.

### XBR-07 · In WebKit, Shift+Tab does not move focus after a mouse click on the label or the icon of a button

- Kind: bug
- Severity: medium. Confidence: medium (Playwright WebKit, headless and headed; real Safari not verified). Measured: yes. Effort: M
- Engines: WebKit 26.6. Chrome and Firefox are correct. Headless effect: no.
- Evidence (`$S/probe-shift-tab3.mjs`, the same output headless and headed):

  ```
  webkit  click the label (child span)       target=<SPAN>   start=button "Difference D" | Shift+Tab -> button "Difference D" | Shift+Tab -> button "Difference D" | moved=false
  webkit  click the button padding           target=<BUTTON> start=button "Difference D" | Shift+Tab -> button "Compare S"    | Shift+Tab -> button "Details"      | moved=true
  webkit  click a plain <button> (no library) target=<DIV>   start=body                  | Shift+Tab -> button "Plain two"    | Shift+Tab -> button "Plain one"    | moved=true
  chrome  click the label (child span)       target=<SPAN>   start=button "Difference D" | Shift+Tab -> button "Compare S"    | …                                  | moved=true
  firefox click the label (child span)       target=<SPAN>   start=button "Difference D" | Shift+Tab -> button "Compare S"    | …                                  | moved=true
  ```
  - `$S/probe-shift-tab2.mjs`: the same for "Compare", "Details", "Next screenshot", and "Shortcuts on". Tab (forward) works. Shift+Tab works after keyboard focus and after script focus.

- What happens: WebKit does not focus a native button on click. Ariakit focuses it in script (the button has focus after the click in WebKit, and has `tabindex="0"`). WebKit starts the next sequential search at the clicked node, which is a `span` inside the button. The previous focusable element before that `span` is the button itself. Focus does not change, the start point does not change, and each next Shift+Tab gives the same result.
- Impact: A Safari user who clicks a control and then presses Shift+Tab stays on that control. Each button of the app has a label or icon child, so the hit area that avoids this is only the padding. The cause is in the Ariakit button behavior in WebKit, not in Visonaut code.
- Recommendation: Verify in Safari first. If it reproduces, report it upstream to Ariakit (`Focusable` in Safari). No Visonaut change removes it cleanly.
- Alternatives: `pointer-events: none` on the label and slot parts makes the button the click target. This changes hit testing for tooltips and text selection, so it needs a check.
- Maintainer decision needed: yes. Is this known Ariakit behavior in Safari?

### XBR-08 · Firefox find-as-you-type and quick find: a word runs commands, and a match in a chip stops all shortcuts

- Kind: ux
- Severity: medium. Confidence: medium (headed Playwright Firefox with the preference set; the find bar itself is browser UI and is not in the screenshots). Measured: yes. Effort: M
- Engines: Firefox 155 with `accessibility.typeaheadfind = true`, and Firefox with default preferences after the `'` key. Headless effect: yes. Headless Firefox shows none of this. The results below are from headed runs (`$S/probe-fayt.mjs`).
- Evidence (events that the page saw, as `key:prevented or default:target`):

  ```
  ## fayt-on-dialog  (typeaheadfind on, type "dialog")
  keydown:d:prevented:div  keydown:i:default:div  keydown:a:prevented:div  keydown:l:default:div  keydown:o:default:div  keydown:g:prevented:div
  mode side -> original; saved commands: ["approved×1"]; save state: 1 variant approved. Saved.

  ## fayt-on-b-then-d  (typeaheadfind on, press "b" then "d")
  keydown:b:default:div  keydown:d:default:a
  mode side -> side; focus: a "6. WebKit · Chromium · Light ·"

  ## quote-then-dialog  (default preferences, "'" then "dialog")
  keydown:':default:div  keydown:d:prevented:div  keydown:i:default:div  keydown:a:default:a  keydown:l:default:a …
  mode side -> diff; saved commands: []; focus: a "1. React · Chromium · Light · "

  ## fayt-on-shortcuts-off-dialog  (typeaheadfind on, shortcuts off, type "dialog")
  all six keys default; selection: "dialog"
  ```
  - `review-workspace.tsx:441`: `event.preventDefault()` runs only for a handled key. `:94-96`: keys inside `.review-variants` are ignored.
  - Screenshots: `$S/screens/fayt-fayt-on-shortcuts-off-dialog--firefox-headed.png` (the word "dialog" in the heading has the green find highlight), `fayt-fayt-on-b-then-d--firefox-headed.png` (the strip scrolled to the "WebKit" chip).

- What happens:
  1. Bound letters win. With the preference on, `D`, `A`, `X`, `S`, `F`, `G` and the digits still run page commands, because the page prevents the default. A user who types a search word runs each bound letter in it. "dialog" sets Difference, approves one variant, and sets Baseline. This part is the same in each engine.
  2. Unbound letters start a find. When the match is inside a link of the variant strip, Firefox moves focus to that link. Focus is then inside `.review-variants`, and each next shortcut is ignored (the WORK-01 state) with no click.
  3. `'` (quick find, links only) does the same with default preferences. `/` is not prevented by the page.
  4. With "Shortcuts off", find-as-you-type works as the browser intends.
- Impact: A Firefox user with "Search for text when you start typing" can approve or reject a variant by typing a word, and can lose all shortcuts when the search lands in a chip. The off switch exists, but it is not stored (A11Y-07).
- Recommendation: Keep the off switch and store it (A11Y-07). A page cannot detect an active find. Thus fix XBR-05 first, so that a find match in a chip does not stop the shortcuts, and then decide if approve and reject stay on bare letters.
- Alternatives: (a) Move the two decision commands off bare letters (for example `Shift+A`, or `A` then Enter to confirm), and keep bare letters for view changes. (b) Show a visible Undo message after each decision by key, so that an accidental `A` is seen. (c) Minimal: store the off switch and change nothing else.
- Maintainer decision needed: yes. Do approve and reject stay on bare letters?

### XBR-09 · Firefox adds one Tab stop: the variant strip is a focusable scroll container

- Kind: accessibility
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Engines: Firefox 155. Headless effect: no. Headed Firefox has the same 36 stops.
- Evidence:
  - `$S/data/tab-firefox-default.json`, stop 13 on the routed page: `{"tag":"nav","name":"Variants","w":1120,"h":38,"focusVisible":true,"outline":"auto 3px oklch(1 0 0) offset 0px"}`. Chrome has no such stop (`chrome nav stop: null`).
  - `components/ariakit/components/nav.ariakit.react.tsx:73`: a horizontal nav has `overflow-x-auto`. With 7 chips the strip is 1120 px wide and its content is wider.
- What happens: Firefox makes each scroll container that overflows keyboard focusable. Chrome does this only for a scroll container with no focusable child. The strip gets a Tab stop with the default engine ring before the first chip.
- Impact: One more stop (32 against 31 before "Approve & next"), with a ring style that the app does not define. The item list scroll area gets the same stop when the list overflows.
- Recommendation: Remove horizontal scroll from the strip (wrap, or collapse extra variants into a menu), or make the strip a composite that owns its one Tab stop (redesign idea R3).
- Alternatives: Accept it. The stop lets a keyboard user scroll the strip with the arrow keys, which is the reason Firefox adds it.
- Maintainer decision needed: no.

### XBR-10 · Dates read differently in WebKit ("Oct 5, 2026 at 2:24 PM"), and columns shift

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Engines: WebKit 26.6 against Chrome 154 and Firefox 155. Headless effect: no.
- Evidence:
  - `apps/web/src/routes/index.tsx:156` and `apps/web/src/components/operations-attention/index.tsx:206`: `toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })`.
  - `$S/probe-render.mjs`, locale `en-US`, time zone UTC: Chrome and Firefox `"Oct 5, 2026, 2:24 PM"`. WebKit `"Oct 5, 2026 at 2:24 PM"`.
  - History table (`$S/layout-report.mjs`): `<th> "Created"` is 177.14 px wide in Chrome and 187.55 px in WebKit. `<th> "Run"` is 714.5 px against 706.61 px. 67 of 255 elements move by more than 1 px.
  - Bell popover: the sentence "Last checked Oct 5, 2026 at 2:30 PM." breaks after "Oct 5," in WebKit (`$S/screens/sheet-states-sidebar.png`, fourth row).
- What happens: The string comes from the locale data of each engine. WebKit uses another medium date and time pattern.
- Impact: Small. The text and the table columns differ between browsers. A browser test that asserts a date string passes in one engine only. The call with `undefined` also makes the server string and the client string differ when a date is rendered on the server.
- Recommendation: One format helper with fixed parts, used by the dashboard and the operations popover:

  ```ts
  const dateTime = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  export const formatDateTime = (value: number) => dateTime.format(value); // "Oct 5, 2:24 PM" in each engine
  ```

  The lab already has this rule and `formatDateTime` (`apps/lab/docs/fixtures.md:16`, `:160`).

- Alternatives: Relative time ("12 min ago") with the exact time in a `title` attribute and in a `<time dateTime>` element.
- Maintainer decision needed: no.

### XBR-11 · Code text is SF Mono in WebKit and Menlo in Chrome and Firefox. The UI font is the same in all three

- Kind: visual
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Engines: WebKit 26.6 against Chrome 154 and Firefox 155. Headless effect: no.
- Evidence (`$S/probe-render.mjs`):
  - `code` at 14 px, text `aabbccddeeff`: 101.16 px (Chrome), 101.20 px (Firefox), 103.86 px (WebKit). That is 0.602 em per character against 0.618 em.
  - Queue card, `<code> "ede2f700a81b"`: 86.70 px (Chrome) against 89.02 px (WebKit).
  - The `h1` "Success dialog" (28 px, weight 600): 182.73 px, 182.35 px, 182.74 px. Width of the same text in each candidate family: `"Inter Variable"` and `"Inter"` give the fallback width in each engine (not installed). `ui-sans-serif` gives the fallback width in Chrome and Firefox and 182.75 px in WebKit. `system-ui` gives 182.73, 182.35, 182.75 px. `document.fonts` is `[]` in each engine.
- What happens: Finding PRIM-16 holds in each engine: no engine has Inter, and all render San Francisco. Chrome and Firefox reach it through `system-ui`. WebKit reaches it through `ui-sans-serif`. For code, only WebKit resolves `ui-monospace` (SF Mono). Chrome and Firefox fall through to Menlo.
- Impact: Commit hashes, run identifiers, and alert subjects are 2.7% wider and have another letter shape in Safari. Layouts that put a hash and other text in one row shift by about 2 px for each 12 characters.
- Recommendation: Decide with PRIM-16. If the app ships a font, ship the mono font too and name it first in `--font-mono`. If the app uses system fonts, name one mono family that each macOS engine resolves:

  ```css
  @theme {
    --font-mono: "SF Mono", Menlo, ui-monospace, monospace;
  }
  ```

- Alternatives: Accept the difference and never size a column from a hash width.
- Maintainer decision needed: yes. The same decision as PRIM-16: ship fonts or use system fonts.

### XBR-12 · The native select looks different in each engine, and a focus ring with no color is blue in Chrome and text-colored in Firefox and WebKit

- Kind: visual
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Engines: all three differ. Headless effect: no.
- Evidence:
  - `apps/web/src/routes/index.tsx:678`: `className="bg-transparent min-w-0 max-w-48 focus-visible:outline-2 focus-visible:outline-offset-2"` and `:710`: `focus-visible:outline-2 focus-visible:outline-offset-4`. No outline color.
  - Select box (`$S/probe-render.mjs`): 168 × 19 px, radius 0 (Chrome). 168 × 17 px, radius 0 (Firefox). 168 × 20 px, radius 5 px, two chevrons (WebKit).
  - Outline of the focused select: `solid 2px rgb(153, 200, 255)` (Chrome dark), `rgb(0, 95, 204)` (Chrome light), `solid 2px oklch(1 0 0)` (Firefox and WebKit dark), `oklch(0 0 0)` (Firefox and WebKit light). The history row link has the same pair of colors.
  - The history search field: `outline: none` and an underline on the text in each engine (A11Y-09 and PRIM-20 hold in each engine).
  - The clipped rings of A11Y-08 (header nav link, review search, item row) are clipped the same way in each engine.
  - Screenshots: `$S/screens/sheet-history-filters.png`, `sheet-rings-a.png`, `sheet-rings-b.png`.
- What happens: `outline-2` sets a width and a style. The color stays at the engine default. Chrome uses its focus ring color. Firefox and WebKit use the text color. The recipes of the vendored primitives set a brand ring (`oklch(0.625 0.1546 248.516)`), so the two hand-made controls have a third and a fourth ring style.
- Impact: The history page has three ring styles in one row, and the result differs by browser. The select arrow, height, and radius are engine drawings on a custom frame.
- Recommendation: Replace the search and the select with primitives that carry the brand ring: the upstream `Input`, and the "Combobox and select" recipe of `apps/lab/docs/primitives.md`. Until then, add the color:

  ```tsx
  className =
    "… focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
  ```

- Alternatives: `appearance-none` on the select plus a chevron slot, so that only the popup stays native.
- Maintainer decision needed: no.

### XBR-13 · Dark and light have different box sizes: `$border` is a 1 px border in dark and a ring in light

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Engines: the same in Chrome 154, Firefox 155, and WebKit 26.6. Not an engine difference. Headless effect: no.
- Evidence:
  - `node_modules/@ariakit/tailwind/src/output.css:1347-1362`: in `@variant ak-dark`, `border-width: calc((1 - var(--_ak-fbd)) * var(--_ak-frame-bordering))`. In `@variant ak-light`, `border-width: calc(var(--_ak-fbd) * var(--_ak-frame-bordering))`, and the rest becomes `--_ak-frame-ring`, a box shadow.
  - `$S/probe-scheme.mjs` compares the box of each element between the two schemes. Queue: 58 elements have another size, 14 of them have another border width, 44 only follow. Workspace: 40, 12, and 28. The counts are equal in the three engines.
  - Elements whose own border changes (dark size, light size):

    | Page      | Element                                | Dark                     | Light                 |
    | --------- | -------------------------------------- | ------------------------ | --------------------- |
    | Queue     | Bell button                            | 36 × 36                  | 34 × 34               |
    | Queue     | "Refresh runs" button                  | 122.91 × 34.5            | 120.91 × 32.5         |
    | Queue     | 4 run cards (`article`)                | height 239.5 or 271.5    | 237.5 or 269.5        |
    | Queue     | 4 group cards and their 4 link buttons | 69 high, 101.42 × 34.5   | 67 high, 99.42 × 32.5 |
    | Workspace | Search and filter frame                | 215 × 35                 | 215 × 33              |
    | Workspace | "Details" button                       | 86.91 × 34.5             | 84.91 × 32.5          |
    | Workspace | 7 variant chips and the strip glider   | 30 high, each 2 px wider | 28 high               |
    | Workspace | `.review-evidence` frame               | 1184 × 554               | 1184 × 552            |
    | Workspace | "Reject view" button                   | 133.75 × 34.5            | 131.75 × 32.5         |

  - Followers: "Approve & next" (34.5 against 32.5, it stretches to "Reject view" in the same group), the variant strip (38 against 36), the page (queue 1879.73 against 1863.73 px, workspace 1017.8 against 1011.8 px).
- What happens: A border is part of the box. A ring is not. Each element with `$border` and the default border type is 2 px larger in each direction in the dark scheme. An element with `$borderType="border"` (for example `section.review-result`, `review-workspace.tsx:787-798`) keeps its border in both schemes. Its size changes only because its children change.
- Impact: The two schemes are not the same layout. Text wraps at other widths (the card content is 1076 px wide in dark and 1078 px in light). A dark screenshot and a light screenshot of the same state do not align. This explains item 3 of the critic probe.
- Recommendation: This is the design of `ak-frame-bordering` upstream. If equal geometry matters, make the ring take space or the border take none. For the app, the direct tool is the border type:

  ```tsx
  <Button $border $borderType="ring">
    …
  </Button> // same box in both schemes
  ```

- Alternatives: (a) Accept it and record it as a known property of the system. (b) Change the utility upstream so that the light ring is an inset ring plus 1 px of transparent border.
- Maintainer decision needed: yes. Is the 2 px difference between schemes intended in `@ariakit/tailwind`?

### XBR-14 · With classic scrollbars the item list cannot be opened from 1024 to 1038 px, and the variant strip grows by 15 px

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Engines: Firefox 155 headed with `ui.useOverlayScrollbars = 0` (real classic scrollbars). Chrome 154 with a 15 px `::-webkit-scrollbar` (emulation). Not verified in WebKit. Headless effect: yes. Headless Firefox and Playwright WebKit draw no space-taking scrollbar (gutter 0), so they hide the defect.
- Evidence:
  - `apps/web/src/review/review-workspace.tsx:211-213`: `window.matchMedia("(max-width: 1023px)")`. `:538` and `:570`: `$show="5xl"` and `@max-5xl/shell:hidden` (64rem of container width).
  - Headed Firefox, classic scrollbars (`$S/probe-headed.mjs`): `{"innerWidth":1024,"clientWidth":1009,"narrow":false,"sidebar":false,"screenshotsButton":false}`. The same at 1030. At 1039 the sidebar returns.
  - Root font 20 px (`$S/probe-breakpoint.mjs`): no item list from 1024 to 1279 px in Chrome (CDP `Page.setFontSizes`), in Firefox (`font.size.variable.x-western`), and in WebKit (`html { font-size: 20px }`, an emulation).
  - Layout with classic scrollbars at 1440 px (`$S/probe-classic.mjs`, headed Firefox): document width 1440 → 1425. Variant strip height 38 → 53 px. Stage top (from the `h1`) 245 → 260 px. Image viewport 590.5 → 583 px wide with a 15 px gutter on each axis. Item row 215 → 200 px.
  - Screenshots: `$S/screens/headed-classic-scrollbar-1030--firefox.png` (no sidebar, no "Screenshots" button, and a scrollbar under the chips), `classic-layout-classic--firefox-headed.png`.
- What happens: Findings A11Y-03 and SHELL-11 hold in each engine that was tested. A classic scrollbar takes 15 px of the container but not of the media query. The second effect is new: the variant strip is `overflow-x: auto`, so with classic scrollbars it shows a permanent 15 px scrollbar and pushes the stage down.
- Impact: Users with "Show scroll bars: Always" on macOS, and most Windows and Linux users, get a taller strip, and lose the item list in a 15 px window range. Users with a larger default font lose it in a 256 px range.
- Recommendation: One condition for the item list (as in A11Y-03), and no scroll container for the chips:

  ```tsx
  <Button $border className="mb-4 @5xl/shell:hidden" onClick={() => setItemsOpen(true)}>
    …
  </Button>
  ```

- Alternatives: `scrollbar-width: none` on the strip with a visible fade or arrow buttons. Or `scrollbar-gutter: stable` on the page so that the layout width does not depend on overflow.
- Maintainer decision needed: no.

### XBR-15 · The readiness gate accepts a truncated image in all engines

- Kind: bug
- Severity: medium. Confidence: high for the browser behavior, low for how often it can occur. Measured: yes. Effort: M
- Engines: the same in Chrome 154, Firefox 155, and WebKit 26.6. Headless effect: no.
- Evidence:
  - `apps/web/src/components/screenshot-viewer.tsx:49-72`: `await element.decode()`, then the check `element.naturalWidth !== image.width || element.naturalHeight !== image.height`, then `report(role, { status: "ready" })`.
  - `$S/probe-gate.mjs` serves images through `page.route`. Final state of each case, equal in the three engines:

    | Case                                                  | Evidence state                                                | Image                                | "Approve & next" |
    | ----------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------ | ---------------- |
    | 600 × 400 PNG after 2 s                               | `loading` for about 2.05 s, then `ready`                      | visible                              | enabled          |
    | HTTP 404, aborted request, empty body, not an image   | `error`, "The image could not be loaded…"                     | hidden                               | disabled         |
    | 300 × 200 PNG                                         | `error`, "The image dimensions do not match this comparison." | hidden                               | disabled         |
    | First 40% of the bytes of a 600 × 400 PNG, status 200 | `ready`                                                       | visible, only the top rows are drawn | enabled          |

  - Timeline of the last case in WebKit: `0ms:ready -> 37ms:loading/hidden/600x400 -> 67ms:ready/visible/600x400`.
  - Screenshots: `$S/screens/sheet-gate-truncated.png`, `gate-truncated-png--webkit.png` (about 30% of each image is drawn, the rest is the stage pattern, and the decision buttons are enabled).
- What happens: A PNG header carries the size. `decode()` resolves for a file that ends early, and `naturalWidth` and `naturalHeight` are correct. The gate reports `ready`. The slow case and the broken cases work as designed in each engine.
- Impact: A stored object that is shorter than the original, or a proxy that cuts a response and keeps a valid length, gives a partly drawn image that a reviewer can approve. `ReviewImage` has a `digest` field (`apps/web/src/review/model.ts:13`), but the browser does not check it. Assumption, not verified in this lane: the compare Worker validates each image at upload, so the probability is low. The gate text says "verified", and it verifies only the size.
- Recommendation: Fetch the bytes, check the digest, and show the verified bytes:

  ```ts
  const bytes = await (await fetch(image.url)).arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  if (hex(hash) !== image.digest)
    return report(role, { status: "error", reason: "digest", error: "…" });
  element.src = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  ```

  This is correct only if `digest` is the SHA-256 of the served bytes. That was not verified in this lane.

- Alternatives: (a) Minimal: compare `Content-Length` of the response with a byte length in the model. (b) Draw the image to a canvas and check that the last row is not fully transparent. This is a heuristic. (c) Accept the risk and change the copy from "verified" to "loaded".
- Maintainer decision needed: yes. Does the review page prove image integrity, or does the server prove it?

### XBR-16 · Back and forward never use the page cache: the queue shows its loading text again, and view mode and zoom reset

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes (request counts and state, no timing). Effort: M
- Engines: the same in Chrome 154, Firefox 155, and WebKit 26.6. Headless effect: Playwright starts Chrome with the page cache disabled, so Chrome was also run with that flag removed.
- Evidence:
  - `packages/security/src/http.ts:33`: `headers.set("Cache-Control", "no-store, private");`. `curl -D - http://127.0.0.1:4310/` returns `cache-control: no-store, private` for the document.
  - `$S/probe-bfcache.mjs` against port 4310, each engine:

    ```
    queue -> run -> Back
    requests on Back: GET / [document], GET /api/runs [fetch], GET /api/runs [fetch]
    restored from page cache (same document): false; pagehide: {"persisted":false}; loading text at first sample: true
    run -> Queue link -> Back
    requests on Back: GET /runs/…?… [document], GET /api/runs/… [fetch]
    state before: {"variant":"2. …","mode":"diff","zoom":"200%","scrollY":90}
    state after:  {"variant":"2. …","mode":"side","zoom":"Fit","scrollY":90}
    ```

  - Chrome with the page cache enabled reports `notRestoredReasons`: `response-cache-control-no-store`, `response-cache-control-no-store-with-js-network-request`, and `websocket-used-with-ccns` (the last one is the dev server socket).
- What happens: A document with `no-store` is not eligible for the page cache in any of the three engines. Each Back is a full load: the document, the script, the API request, and the "Checking access and loading runs…" state. The selected item and variant return because they are in the URL. The view mode and the zoom are React state and reset. Scroll position returns.
- Impact: This is one concrete part of complaint 1. The most frequent loop of the product is queue → run → Back → next run. Each Back pays the full access check and data load, in each browser. The two `GET /api/runs` requests on one load were seen on the dev server and were not traced in this lane.
- Recommendation: Keep `no-store` on API responses and on documents that embed private data. The queue fetches its data in the browser (`routes/index.tsx:180`), and the run route has `ssr: false` (`routes/runs.$runId.tsx:31`). Thus these two documents carry no run data, and a page cache that the app revalidates is an option:

  ```ts
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void refresh(); // show the old state at once, then update
  });
  ```

  Put the view mode and the zoom in the URL or in `sessionStorage`, next to the item and the variant.

- Alternatives: (a) Keep `no-store` and make the run link a client-side route change, so that Back is a history pop inside one document. "Queue" is a plain `<a href="/">` today (`review-workspace.tsx:580`). (b) Minimal: store the view mode and the zoom only.
- Maintainer decision needed: yes. Can HTML documents that hold no private data drop `no-store`? This is a security policy decision.

### XBR-17 · Headless Firefox moves the header underline away after an instant `scrollTo` (headless only)

- Kind: dx
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Engines: Firefox 155 headless only. Headed Firefox, Chrome, and WebKit are correct.
- Evidence:
  - `apps/web/src/components/ariakit/components/nav.ariakit.react.tsx:223`: `"[.horizontal>&]:fixed!"` and `:273-276`: all engines but Firefox return to `absolute!`.
  - `$S/probe-glider-scroll.mjs`, headless Firefox: `scrollTo-400  scrollY=400 glider=527.6,-362.4,131.8,1.6 selected=527.6,7.7,131.8,31.6 position=fixed | widest bright row under the link: 0%`. The glider is at its rest position minus the scroll offset.
  - The same script headed: `glider=527.6,37.6,…` and `100%` at each step.
  - `$S/probe-glider-scroll2.mjs`, headless: only the first instant `window.scrollTo` detaches the glider. Smooth scroll, `scrollIntoView`, PageDown, Space, and Tab keep it attached. A mouse wheel does not repair it.
  - Screenshot: `$S/screens/sheet-header-glider.png` (second row, Firefox: no underline).
- What happens: In Firefox the header bar glider is `position: fixed` and reads the frame anchor of a sticky header. Headless Firefox computes the anchor once without the sticky offset after an instant programmatic scroll.
- Impact: No user impact. A Firefox capture of a page that scrolls by script (for example the Ariakit visual tests that this product reviews) can show a nav with no selected marker. The lab header glider shows the same in headless Firefox (`$S/data/lab-firefox-2.out`).
- Recommendation: Record it as a capture caveat for Firefox. If Firefox captures matter, test the nav glider in the upstream sandbox with a sticky header and an instant scroll.
- Alternatives: None needed in Visonaut.
- Maintainer decision needed: no.

### XBR-18 · Design lab: pages load with no error in Firefox and WebKit, but the mask images differ, most in WebKit

- Kind: dx
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Engines: Firefox 155 and WebKit 26.6 against Chrome 154, lab on port 4320 (read-only, checked again after the lab files changed). Headless effect: not tested headed.
- Evidence (`$S/probe-lab.mjs`, `$S/lab-masks.mjs`, `$S/probe-lab-progress.mjs`):
  - `/primitives`: status 200, 2483 elements, 21 gliders (17 shown), 0 page errors, 0 console errors in each engine. 0 gliders off their selected control. `/dev/fixtures`: 3205 elements, 314 images, 0 broken images, 0 errors in each engine.
  - `Progress` and `ProgressCircular` of the lab: the same fill share in each engine (57.4%, 57.5%, 57.5% for the 0.65 bar. 26.7%, 26.6%, 26.6% for the 0.7 ring).
  - Mask images, 14 scenes × 2 schemes × 2 states, red pixel count and bounding box against Chrome: Firefox has 35 of 56 equal (within 2% and the same box). WebKit has 21 of 56 equal.
  - Largest WebKit differences: scene `page` 9508 red pixels against 2924 (3.25 times), scene `popover` light 19138 against 12704 (1.51 times), `table` dark 8640 against 7400. Largest Firefox differences: `popover` 0.92 times, `select` 0.86 times, `form` 0.96 times with another top edge (399 against 362).
  - Screenshot: `$S/screens/sheet-lab-masks.png`. In WebKit the changed nav item of the `page` scene is one solid red block. In Chrome and Firefox only the glyphs are red. The WebKit shadow ring of the `popover` scene is thicker.
  - The lab checkerboards use hex colors (`apps/lab/src/routes/dev.fixtures.tsx:549`, `dev.hooks.tsx:343`), so they are safe from XBR-01.
- What happens: The masks are computed in the browser with `mix-blend-mode: difference` and a filter (`apps/lab/src/fixtures/images/index.ts:72-91`, `:148-154`). Each engine rasterizes the two copies and applies the threshold a little differently. WebKit marks more pixels, and in one scene it marks a whole region.
- Impact: The note in `apps/lab/docs/fixtures.md:117` ("verified in Chrome only") is correct and matters. A design that is judged in Safari sees other diff pictures than the same design in Chrome. `changedPixels` and `ratio` are fixed numbers, so they no longer match the picture in WebKit.
- Recommendation: State in the lab that Chrome is the reference browser for diff pictures. If the lab must be judged in Safari, replace the live filter with mask images that are made once (a script that renders in Chrome and writes PNG files to `apps/lab/public`).
- Alternatives: Draw the mask from `regions` (plain red rectangles and glyph-free shapes). This is engine-safe but less realistic.
- Maintainer decision needed: no.

## Measurements (command, raw result, limits)

All commands run from any directory. `$S` is `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-cross-browser`. Each script writes JSON to `$S/data` and prints the lines that are quoted here. Text output of each run is in `$S/data/*.out`.

### M1. Engines and feature support

- Command: `node $S/versions.mjs`
- Raw result: `chrome 154.0.8037.98`, `firefox 155.0`, `webkit 26.6`. No page error in any engine on the workspace fixture.
- `CSS.supports` results that are not true in all three:

  | Feature                            | Chrome | Firefox | WebKit |
  | ---------------------------------- | ------ | ------- | ------ |
  | `corner-shape: squircle`           | true   | false   | true   |
  | `interpolate-size: allow-keywords` | true   | false   | false  |
  | `text-wrap: pretty`                | true   | false   | true   |
  | CSS `if()`                         | true   | false   | true   |
  | `container-type: scroll-state`     | true   | false   | false  |

- True in all three: `anchor-name`, `position-anchor`, `anchor()`, `anchor-size()`, `position-area`, `position-try-fallbacks`, `color-mix(in oklch, …)`, relative colors, `@starting-style`, `dvh`, `field-sizing`, `scrollbar-gutter`, `scrollbar-width`, `accent-color`, `cap`, `lh`, `sibling-index()`, the `popover` attribute, view transitions, `light-dark()`, typed `attr()`.
- Limit: `CSS.supports` proves parsing, not correct rendering (see XBR-01).

### M2. State matrix

- Commands: `node $S/matrix.mjs --engine chrome`, `--engine firefox`, `--engine webkit`, then `node $S/compare.mjs --diff-images` and `node $S/layout-report.mjs --scheme dark`.
- Raw result: 44 captures for each engine, 0 failures, 0 page errors. The ranked table is in `$S/data/compare.json`. Top rows: `06-bell-popover dark firefox 2.39%`, `04-history-8 light firefox 2.17%`, `04-history-8 light webkit 1.89%`. Bottom row: `20-loading-queue webkit 0.04%`.
- Limits: `Date.now()` is fixed with `page.clock.setFixedTime`. Firefox has no `isMobile` option, so the phone states use a 390 × 844 viewport with touch in Firefox.

### M3. Rendering probes

- Command: `node $S/probe-render.mjs --engine <engine>`, then `node $S/render-table.mjs`. Stage and progress candidates: `node $S/probe-stage.mjs --engine <engine>`.
- Raw results are quoted in XBR-01, XBR-03, XBR-10, XBR-11, and XBR-12.
- Scrollbar width, 200% zoom, each engine, headless: `{"document":{"innerWidth":1440,"clientWidth":1440,"gutter":0},"imageViewport":{"offsetWidth":591,"clientWidth":591,"gutter":0,…}}`. This machine has "Show scroll bars: Automatic" (`defaults read -g AppleShowScrollBars` → `Automatic`), so each engine uses overlay scrollbars. Headless Firefox reports `scrollbar-width: none` on the image viewport. Headed Firefox reports `auto`.

### M4. Dynamic rendering

- Command: `node $S/probe-dynamic.mjs --engine <engine>` (sections: gliders, popovers, sticky, pixelated, rings, lock).
- Gliders, each engine: `workspace: after click on chip 3  [Variants] fill fixed glider=…,261.3,392.77,30 selected=…,261.3,392.77,30 delta=0,0,0,0`. Chrome and WebKit leave chip 3 at x 1010.7. Firefox scrolls the strip and puts chip 3 at x 649.6. The chip is fully in view in each engine.
- Popovers: `bell popover first: rect=880.6,49,437,560 opacity=0 scale=0.95 … final: rect=859,49,460,589.5 opacity=1 | changing frames=31 over 481 ms` (Chrome), `483 ms` (Firefox, y 50), `505 ms` (WebKit).
- Sticky: `desktop top: {"actions":[840.5,901,60.5],"actionsGapToBottom":-1,"header":[24,48,"sticky"],"units":{"100vh":900,"100dvh":900,"100svh":900,"100lvh":900,"64rem":1024,"1cap":11.27,"1lh":24}}` in each engine.
- Pixelated: `dpr 1 zoom 100% … distinct colors in the line block=2` and `zoom 200% … =2` in each engine, at device pixel ratio 1 and 2.
- Scroll lock: with a dialog open, `window.scrollTo(0, 300)` still scrolls the page in Firefox and WebKit at 390 px (`scrollY 300`). Chrome with `isMobile` sets `position: fixed` on the body and stays at 0. On the desktop size each engine sets only `overflow: hidden`.
- Limit: the rings section uses Option+Tab in WebKit to reach links.

### M5. Tab order

- Commands: `node $S/probe-tab.mjs --engine <engine> [--mode alt|tabfocus1]`, `node $S/probe-tabindex-links.mjs`.
- Raw result, fixture (item rows are buttons): Chrome 33 stops, "Approve & next" is stop 30 (equal to WORK-29). Firefox 34 stops, stop 31. WebKit Tab 21 stops, stop 18. WebKit Option+Tab 33 stops, stop 30.
- Raw result, routed page: quoted in XBR-04.
- Firefox with `accessibility.tabfocus = 1`: the order did not change (35 stops). Firefox with Alt+Tab: focus leaves the page at once.
- Limit: this machine has macOS keyboard navigation on (`defaults read -g AppleKeyboardUIMode` → `2`). The Safari preference "Press Tab to highlight each item" was not read. Playwright WebKit behaves as Safari with that preference off.

### M6. Shortcuts

- Command: `node $S/probe-keys.mjs --engine <engine>` (Firefox also with `--fayt`).
- Raw result, equal in the three engines. "Prevented" is `event.defaultPrevented` as seen by a listener on `window`.

  | Key                  | Page action                                                                                   | Prevented                                   | Browser action                                                                        |
  | -------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
  | `A`, `X`             | Saves one decision and selects the next pending variant                                       | yes                                         | none                                                                                  |
  | `Shift+A`, `Shift+X` | Saves a decision for all changed variants of the item (2 targets in the test item), no dialog | yes                                         | none                                                                                  |
  | `S`, `D`, `F`, `G`   | Sets the view mode                                                                            | yes                                         | none                                                                                  |
  | `↑`, `↓`             | Selects the previous or next item                                                             | yes                                         | no page scroll                                                                        |
  | `←`, `→`             | Selects the previous or next variant                                                          | yes, also at the last variant               | none                                                                                  |
  | `1` to `6`           | Selects the variant at that position                                                          | yes, also when the item has no such variant | none                                                                                  |
  | `[`                  | Toggles the sidebar and focuses the toggle button                                             | yes                                         | none                                                                                  |
  | `Cmd+Z`, `Ctrl+Z`    | Undo (both work on macOS)                                                                     | yes                                         | none                                                                                  |
  | `/`, `'`, `b`, `?`   | none                                                                                          | no                                          | Firefox: starts a find (XBR-08)                                                       |
  | Space                | none                                                                                          | no                                          | the page scrolls 118 px                                                               |
  | Backspace            | none                                                                                          | no                                          | Playwright WebKit goes back in history (`about:blank`). Chrome and Firefox do nothing |

- Type "dialog" with focus on the page: `d:prevented i:default a:prevented l:default o:default g:prevented`, result `mode: "side" -> "original"; calls: 0 -> 1 … "1 variant approved. Saved."` in each engine.
- Limit: Backspace as "go back" is a setting of the Playwright WebKit build. Safari does not do this by default.

### M7. Focus after a click and `:focus-visible`

- Commands: `node $S/probe-focus.mjs --engine <engine>`, `node $S/probe-shift-tab3.mjs [--headed]`.
- Raw results are quoted in XBR-05, XBR-06, and XBR-07.
- `:focus-visible` on "Details": after a mouse click it is false in each engine and the outline is `none`. After the click and then the Shift key: Chrome true, Firefox false, WebKit false, and each engine draws `solid 2px` (the ring comes from the Ariakit focus-visible attribute, not from the pseudo-class). After a second mouse click on a control that the keyboard focused, Chrome and Firefox keep the ring. This step is not comparable in WebKit, because Shift+Tab did not move there (XBR-07).

### M8. Readiness gate, back and forward, scheme sizes, breakpoints

- Commands: `node $S/probe-gate.mjs --engine <engine>`, `node $S/probe-bfcache.mjs --engine <engine> [--keep-bfcache]`, `node $S/probe-scheme.mjs --engine <engine>`, `node $S/probe-breakpoint.mjs --engine <engine>`, `node $S/probe-classic.mjs`.
- Raw results are quoted in XBR-13, XBR-14, XBR-15, and XBR-16.
- Limit: the back and forward probe runs against the dev server on port 4310. The dev server adds a WebSocket, which is one more reason against the page cache in Chrome.

### M9. Headless against headed

- Commands: `node $S/probe-headed.mjs --engine <engine>`, `node $S/probe-primary.mjs --headed`, `node $S/probe-fayt.mjs`, `node $S/probe-glider-scroll.mjs --engine firefox --headed`.

  | Difference                                          | Headless                              | Headed            | Result             |
  | --------------------------------------------------- | ------------------------------------- | ----------------- | ------------------ |
  | Stage triangles, Firefox (XBR-01)                   | match 77.5                            | match 77.5        | real               |
  | `$layer="primary"`, Firefox dark (XBR-02)           | `oklch(0.276…)`                       | `oklch(0.276…)`   | real               |
  | Progress colors (XBR-03)                            | `#0064b4` on `#e6e6e6` (Firefox)      | the same          | real               |
  | Tab skips links, WebKit (XBR-04)                    | 21 stops, 0 links                     | 21 stops, 0 links | real               |
  | Shortcuts after a chip click (XBR-05)               | Chrome and Firefox dead, WebKit alive | the same          | real               |
  | Shift+Tab after a click, WebKit (XBR-07)            | stays                                 | stays             | real in this build |
  | Header underline after `scrollTo`, Firefox (XBR-17) | detached                              | attached          | headless only      |
  | Classic scrollbars, Firefox (XBR-14)                | gutter 0, preference ignored          | gutter 15         | headed only        |
  | Find as you type, Firefox (XBR-08)                  | no effect                             | active            | headed only        |

### M10. Design lab

- Commands: `node $S/probe-lab.mjs --engine <engine>`, `node $S/lab-masks.mjs`, `node $S/probe-lab-dom.mjs`, `node $S/probe-lab-progress.mjs`.
- Raw results are quoted in XBR-18. `tabindex="0"` count on `/primitives`: Chrome 11, Firefox 11, WebKit 159 (Ariakit adds it to each button in WebKit).
- Limit: read-only. The lab files changed during this audit. The probe ran again after the change, with the same results.

## Screenshots

All paths are under `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-cross-browser/screens/`. In each sheet the columns are Chrome (blue tab), Firefox (orange tab), WebKit (gray tab). Each file in this list was read.

| File                                                                                                                          | Caption                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sheet-stage.png`                                                                                                             | Stage corner at 2x, dark and light. Firefox shows triangles. Chrome and WebKit show squares (XBR-01)                                                                       |
| `stage-candidates--firefox--1x.png`                                                                                           | 25 background declarations in Firefox. Each declaration with `oklch` colors or `in oklab` shows triangles. `in srgb`, hex, `rgba`, linear gradients, and SVG show squares  |
| `09-workspace-default--chrome--dark.png`, `09-workspace-default--firefox--dark.png`, `09-workspace-default--webkit--dark.png` | The workspace in each engine. Firefox: triangle stage and a blue progress bar on a white track                                                                             |
| `sheet-sign-in-card.png`                                                                                                      | Sign-in card, dark. The button and the icon tile are near-white in Chrome and WebKit and near-black in Firefox (XBR-02). Second row: the action buttons in light are equal |
| `sheet-primary-button.png`                                                                                                    | "Review changes" in dark and light. Firefox dark differs (XBR-02)                                                                                                          |
| `sheet-progress.png`                                                                                                          | The run progress bar at 2x, dark and light: green on gray (Chrome, WebKit), blue on near-white (Firefox) (XBR-03)                                                          |
| `sheet-progress-candidates.png`                                                                                               | The same element with `border: revert` and with `appearance: none` in each engine                                                                                          |
| `sheet-states-pages.png`                                                                                                      | Forbidden, pull pending, loading, queue card (light), service header (light). Row 1 shows XBR-02. Rows 4 and 5 show the WebKit date string (XBR-10)                        |
| `sheet-states-dialogs.png`                                                                                                    | Whole-item dialog, keyboard help, account menu: equal in the three engines                                                                                                 |
| `sheet-states-sidebar.png`                                                                                                    | Filter popover, search with text, Details sidebar, bell popover. Row 3 shows the progress colors. Row 4 shows the WebKit date wrap                                         |
| `sheet-states-stage.png`                                                                                                      | Difference mode, 200% zoom, many variants, read-only, save error. Only the Firefox stage pattern differs                                                                   |
| `sheet-phone-default.png`                                                                                                     | Phone layout at 390 px, dark: equal but for the Firefox stage pattern                                                                                                      |
| `22-phone-item-dialog--chrome--dark.png`, `22-phone-item-dialog--firefox--dark.png`, `22-phone-item-dialog--webkit--dark.png` | Phone item dialog: equal                                                                                                                                                   |
| `diff--01-sign-in--firefox--dark.png`                                                                                         | Pixel difference of the sign-in page, Firefox against Chrome: the button and the tile are solid red                                                                        |
| `diff--04-history-8--webkit--dark.png`, `diff--04-history-8--firefox--dark.png`                                               | Pixel difference of the history page. WebKit: the Result and Created columns are doubled (column shift from the date string). Firefox: only frame edges and text           |
| `sheet-history-filters.png`                                                                                                   | History search and select, dark at rest and light with focus on the select: three select drawings and two ring colors (XBR-12)                                             |
| `history-select-focus--chrome--dark.png`, `history-select-focus--firefox--dark.png`, `history-select-focus--webkit--dark.png` | The focused select in dark: light blue ring (Chrome), white ring (Firefox, WebKit)                                                                                         |
| `sheet-rings-a.png`                                                                                                           | Focus rings at 2x: header nav link (only two arcs show), history search (underline only), history select, review search (top edge cut). Equal clipping in each engine      |
| `sheet-rings-b.png`                                                                                                           | Focus rings at 2x: item row (left and right edges cut), variant chip, view mode, Details, Approve. Equal in each engine                                                    |
| `sheet-rings-root.png`, `sheet-root-ring-routed.png`                                                                          | The page root with focus after Enter on "Approve & next". Chrome draws a 1 px line at the right page edge. Firefox draws a line at the top of the root in the fixture      |
| `focus-root-after-a-key--webkit.png`                                                                                          | WebKit after the `A` shortcut: a blue line across the top of the workspace root (XBR-06)                                                                                   |
| `sheet-header-glider.png`                                                                                                     | Header nav at rest and after an instant scroll, headless. Firefox row 2 has no underline (XBR-17)                                                                          |
| `glider-scroll-scrollTo-400-header--firefox-headed.png`                                                                       | The same in headed Firefox at 2x after `scrollTo(0, 400)`: the underline is under "Review queue"                                                                           |
| `headed-stage-corner--firefox.png`                                                                                            | Stage corner in headed Firefox: triangles, as in headless mode                                                                                                             |
| `headed-classic-scrollbar-1030--firefox.png`                                                                                  | Headed Firefox with classic scrollbars at 1030 px: no sidebar, no "Screenshots" button, and a scrollbar under the variant chips (XBR-14)                                   |
| `classic-layout-classic--firefox-headed.png`                                                                                  | Headed Firefox with classic scrollbars at 1440 px, 24 items, 200% zoom: scrollbars in the item list, under the chips, in each image pane, and at the page edge             |
| `fayt-fayt-on-shortcuts-off-dialog--firefox-headed.png`                                                                       | Firefox find-as-you-type with shortcuts off: "dialog" in the heading has the green find highlight                                                                          |
| `fayt-fayt-on-b-then-d--firefox-headed.png`                                                                                   | Firefox find-as-you-type after `b`: the variant strip scrolled to the "WebKit" chip, which now has focus (XBR-08)                                                          |
| `sheet-gate-truncated.png`, `gate-truncated-png--webkit.png`                                                                  | A truncated PNG in each engine: the top rows are drawn, the state is `ready`, and the decision buttons are enabled (XBR-15)                                                |
| `sheet-lab-masks.png`                                                                                                         | Lab mask images, scenes `page` and `popover`: WebKit marks a solid block and a thicker ring (XBR-18)                                                                       |
| `sheet-lab-progress.png`                                                                                                      | Lab `ProgressCircular` and `Progress`: equal in each engine                                                                                                                |

Not read one by one: the rest of the 132 matrix captures and the rest of the 88 difference images. They were compared by pixel count and by element boxes (`$S/data/compare.json`), and the sheets above show one crop of each state in each engine.

## Redesign ideas

Each JSX sketch uses only props that `apps/lab/docs/primitives.md` documents.

### R1 · An engine-safe stage background

- What changes: The stage pattern no longer uses a conic gradient with layer colors. Option A keeps the gradient and adds `in srgb`. Option B uses one SVG tile as a mask on a layer color, so that the pattern follows the theme and the Look controls. Option C drops the pattern and shows it only under images that have transparency (diff masks).
- Why it is better: It renders the same in Chrome, Firefox, and WebKit (measured: candidates A6, H, and I match a checkerboard at 100 in each engine). Option C also removes visual noise around opaque screenshots, which are most images.
- Sketch:

  ```tsx
  // Option B. The mask is the tile. The color is the layer text color at low strength.
  const tile = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Cpath d='M0 0h8v8H0zM8 8h8v8H8z'/%3E%3C/svg%3E")`;

  <Frame $darken $border $rounded="lg" className="relative grid place-items-center overflow-clip">
    <div
      aria-hidden
      className="absolute inset-0 bg-current opacity-[0.06]"
      style={{
        maskImage: tile,
        WebkitMaskImage: tile,
        maskSize: "16px 16px",
        WebkitMaskSize: "16px 16px",
      }}
    />
    <img
      className="relative"
      src={image.url}
      width={image.width}
      height={image.height}
      alt={label}
    />
  </Frame>;
  ```

  ```
  Option C
  ┌──────────────── stage ($darken) ────────────────┐
  │                                                 │
  │        ┌───────── screenshot ─────────┐         │   plain recessed surface
  │        │                              │         │
  │        └──────────────────────────────┘         │
  └─────────────────────────────────────────────────┘
  Difference mode only: ▚▚▚ pattern under the red mask
  ```

### R2 · Progress that does not depend on the native look

- What changes: The run header uses the `Progress` primitive (a `role="progressbar"` element that the theme paints). Variants: a thin bar under the header, a ring beside the count, or a segmented bar with one segment for each state.
- Why it is better: The fill is a theme color in each engine and in both schemes. A status color then has a meaning: success when all are approved, danger when one is rejected. The lab primitive renders the same in the three engines (measured).
- Sketch:

  ```tsx
  const done = (total - pending) / Math.max(total, 1);

  // A. Bar and count.
  <div className="flex items-center gap-3">
    <Text className="ak-ink-60 text-xs tabular-nums">{total - pending} of {total} reviewed</Text>
    <div className="w-24">
      <Progress aria-label="Review progress" value={done} $thickness={1} fill={{ $layer: rejected ? "danger" : "success" }} />
    </div>
  </div>

  // B. Ring with the count inside. The parent gives the size.
  <div className="size-10">
    <ProgressCircular aria-label="Review progress" value={done} $thickness={0.75}>
      <Text className="text-xs font-medium tabular-nums">{pending}</Text>
    </ProgressCircular>
  </div>
  ```

  ```
  C. Segmented bar, one segment for each variant state
  ████████░░░░░░░░░░░░▓▓      8 approved · 12 to review · 2 rejected
  ```

### R3 · Variant and item navigation that Tab can reach in Safari: one composite, one Tab stop

- What changes: The variant strip becomes a tab list (buttons with a roving tabindex). The item list stays a composite, and its active row gets an explicit `tabIndex={0}`. The header nav links and "Queue" stay links, because they are navigation.
- Why it is better: Tab reaches the strip and the list in each engine with default settings (measured: an explicit `tabindex="0"` makes a link reachable in WebKit). The Tab stops before "Approve & next" drop from 31 to about 14. Arrow keys inside the strip come from the tab list role, so the page handler needs no `.review-variants` exception (XBR-05). The extra Firefox stop on the scroll container goes away when the strip does not scroll (XBR-09).
- Sketch:

  ```tsx
  // Variants: one Tab stop, arrows move, the selection updates the URL.
  <Tabs selectedId={variant.id} setSelectedId={(id) => selectVariantById(id)}>
    <TabList aria-label="Variants" $size="sm">
      {item.variants.map((entry, index) => (
        <Tab key={entry.id} id={entry.id} $kind="flat">
          <TabLabel>{entry.label}</TabLabel>
          {index < 6 && <TabSlot $kind="shortcut">{index + 1}</TabSlot>}
        </Tab>
      ))}
      <TabGlider $kind="flat" />
    </TabList>
    <TabPanels>
      <TabPanel single>{/* the stage */}</TabPanel>
    </TabPanels>
  </Tabs>
  ```

  ```tsx
  // Items: keep the composite. Rows are buttons, or links with an explicit tabindex.
  <ak.CompositeProvider store={store}>
    <ak.Composite
      render={<Frame render={<nav aria-label="Review items" />} className="grid gap-1" />}
    >
      {rows.map((row) => (
        <ak.CompositeItem
          key={row.id}
          id={row.id}
          render={<Button $kind="flat" />}
          aria-current={row.selected ? "true" : undefined}
        >
          <ButtonLabel>{row.name}</ButtonLabel>
        </ak.CompositeItem>
      ))}
    </ak.Composite>
  </ak.CompositeProvider>
  ```

  ```
  Tab order after the change (each engine)
  1 header nav  2 search  3 item list (↑↓)  4 variants (←→)  5 view (←→)  6 zoom (←→)  7 stage  8 Reject  9 Approve
  ```

- Note: `TabSlot $kind="shortcut"` follows the slot kinds of the guide (`"icon"`, `"badge"`, `"avatar"`, `"shortcut"`). If the "open a variant in a new tab" link behavior must stay, keep `NavLink` and add `tabIndex={entry.id === variant.id ? 0 : -1}` plus the arrow handler that exists today.

### R4 · Focus handling that does not depend on where a click puts focus

- What changes: The shortcut handler asks "is the user typing or inside a widget that owns this key?" and not "where is focus?". The page root is not focusable. A decision does not move focus. A live region reports the new selection.
- Why it is better: A click on a link gives another focus target in each engine (the link in Chrome and Firefox, an ancestor or `body` in WebKit). A rule by key and by role gives the same result in each engine. No page-size focus ring appears (XBR-06).
- Sketch:

  ```ts
  const typing =
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
  const modal = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
  const arrows = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

  function ownsKey(event: KeyboardEvent) {
    const element = event.target instanceof Element ? event.target : null;
    if (!element) return false; // focus on body or document: the page owns the key
    if (element.closest(typing) || element.closest(modal)) return true;
    // A composite owns its arrow keys only. Letters and digits pass.
    if (element.closest('[role="tablist"], [role="radiogroup"], [data-composite]'))
      return arrows.has(event.key);
    return false;
  }
  ```

  ```tsx
  // No tabIndex={0} on the shell. The live region carries the change.
  <Shell ref={workspace} tabIndex={-1} role="group" aria-label="Review workspace">
    …
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </p>
  </Shell>
  ```

  ```
  After "Approve & next" (mouse, Enter, or the A key)
  focus:        stays on the control that had it
  selection:    next pending variant
  announcement: "Approved. Now on Open menu, variant 1 of 2."
  ```

### R5 · A short "do not rely on this" list for the design lab

- What changes: One section in `apps/lab/docs/primitives.md`, next to "Pitfalls to know first", with the engine facts below.
- Why it is better: Each item was measured in this lane. A variant that follows the list renders and behaves the same in Chrome, Firefox, and Safari.
- The list:

  | Do not rely on                                                                                                                          | Because (measured)                                                                                                                 | Use                                                                                      |
  | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
  | `repeating-conic-gradient` with hard stops and `oklch()`, `color-mix(in oklch, …)`, or layer colors (`currentColor`, `var(--ak-layer)`) | Firefox 155 draws triangles. The soft conic sweep of `ProgressCircular` is correct                                                 | `in srgb` in the gradient, hex colors, or an SVG tile as a mask                          |
  | A color name that the theme does not define (`$layer="primary"`)                                                                        | It falls back to the system color `canvas`: near-white in Chrome and WebKit, near-black in Firefox dark                            | `"brand"`, `"secondary"`, `"success"`, `"warning"`, `"danger"`, `"canvas"`, or `$invert` |
  | Native `<progress>`, `<select>`, `<meter>`, `<input type="range">` and `accent-color`                                                   | Each engine draws them in its own way, and the preflight border turns `accent-color` off                                           | `Progress`, the select recipe, `ak.Composite`                                            |
  | A link as an in-page control                                                                                                            | Safari does not stop at a link with Tab and does not focus it on click                                                             | A button, a tab, a radio, or a link with an explicit `tabIndex` in a composite           |
  | Focus on the clicked element                                                                                                            | WebKit focuses an ancestor or `body` after a click on a link                                                                       | Handlers on `document` that test the key and the role                                    |
  | Raw `:focus-visible` and `outline-2` with no color                                                                                      | The pseudo-class differs after script focus, and the default ring color differs (blue in Chrome, text color in Firefox and WebKit) | The focus props of the primitives, or `outline-brand`                                    |
  | `toLocaleString()` and `Intl` with an undefined locale                                                                                  | WebKit writes "Oct 5, 2026 at 2:24 PM"                                                                                             | The lab `format*` helpers                                                                |
  | The width of `ui-monospace` text                                                                                                        | SF Mono in WebKit, Menlo in Chrome and Firefox, 2.7% apart                                                                         | `tabular-nums` and a `min-w-*` class, not a width from characters                        |
  | Equal sizes in dark and light                                                                                                           | `$border` is a border in dark and a ring in light, 2 px apart                                                                      | `$borderType="ring"` or `"border"` where alignment matters                               |
  | Overlay scrollbars                                                                                                                      | A classic scrollbar takes 15 px, and Firefox makes each scroll container a Tab stop                                                | No horizontal scroll for controls. One breakpoint system (container queries only)        |
  | Bare letter keys for a command that saves                                                                                               | Firefox find-as-you-type and a typed word run them                                                                                 | A stored off switch, and a visible Undo after each saved command                         |
  | `corner-shape`, `interpolate-size`, `text-wrap: pretty`, CSS `if()`, `scroll-state` queries                                             | Not in Firefox 155. `interpolate-size` and `scroll-state` are not in WebKit 26.6                                                   | Use them only as an improvement that the layout does not need                            |
  | The mask images of the lab fixtures                                                                                                     | WebKit marks up to 3.25 times more pixels                                                                                          | Chrome as the reference browser for diff pictures                                        |

### R6 · One select and one search field from primitives on the history page

- What changes: The history filters use the `Input` primitive with an icon slot and the select recipe of the guide, not a native `<select>` in a hand-made frame.
- Why it is better: One ring style, one height, and one chevron in each engine (XBR-12). The result filter can then show a count for each result.
- Sketch:

  ```
  ┌ 🔍 Search runs…                    ⌘K ┐  ┌ Result: All ▾ ┐  ┌ Kind: All ▾ ┐
  └───────────────────────────────────────┘  └───────────────┘  └─────────────┘
                                              │ All        40 │
                                              │ Passed     22 │
                                              │ To review   9 │
  ```

### R7 · A back path that does not reload

- What changes: The run page opens from the queue as a client route change, and Back pops history inside the same document. The view mode and the zoom live in the URL search parameters, next to the item and the variant.
- Why it is better: Back shows the queue at once in each engine, with no access check and no loading text (XBR-16). A copied link opens the same view mode.
- Sketch:

  ```
  /runs/42?item=dialog%2Fopen&variant=dark&view=diff&zoom=2
           └ selection today ┘            └ new ──────────┘
  ```

## Open questions and items not verified

Limits of the method:

- Playwright WebKit 26.6 is not Safari. Three results need a check in Safari: the Tab order with the default Safari settings (XBR-04), Shift+Tab after a click (XBR-07), and focus after a click on a link (XBR-05). The mechanisms are engine behavior, so they are likely the same, but this was not proved.
- Playwright Firefox 155 is a patched build. The find bar is browser UI and is not in page screenshots. XBR-08 is based on the key events that the page received, on the focus target, and on the selection.
- No real iOS device. The `iPhone 15` descriptor of Playwright WebKit reports `navigator.platform: "MacIntel"`, `maxTouchPoints: 0`, and equal `vh`, `dvh`, `svh`, and `lvh` values (659 px). Thus the dynamic toolbar, the Ariakit scroll lock for iOS, and touch focus were not tested. On that descriptor all 30 visible buttons and links are smaller than 44 px in one dimension.
- No screen reader.
- No Windows or Linux engine builds. Fonts, classic scrollbars, and the native select differ there.

Items not verified:

1. Classic scrollbars in WebKit. A `::-webkit-scrollbar` rule did not create a gutter in Playwright WebKit. XBR-14 is proved in headed Firefox (real) and in Chrome (emulated).
2. The macOS setting "Keyboard navigation" off, in Firefox. With `accessibility.tabfocus = 1` the Tab order did not change in the Playwright build. Real Firefox on macOS can skip links in that case.
3. `/` (quick find) in Firefox. The page does not prevent the key. The probe could not prove if the find bar took the next keys.
4. The `digest` field of `ReviewImage`. XBR-15 recommends a digest check in the browser. This lane did not verify that `digest` is the SHA-256 of the served bytes, and did not verify the upload validation.
5. The two `GET /api/runs` requests on one queue load (XBR-16). They were seen on the dev server in each engine. The cause (for example React strict mode in development) was not traced.
6. Text wrap of long identifiers. In a closed `<details>` element Chrome breaks a UUID across two lines (387 × 34.5 px) and Firefox moves it to the next line (259.8 × 15 px). The content was hidden in the capture, so the visible effect was not checked.
7. The lab header glider in headed Firefox. It detaches in headless Firefox after `scrollTop = 300`. The app header has the same recipe and is correct in headed Firefox, so the lab is assumed to be correct too.
8. The lab mask images in headed mode. They were compared in headless mode only.
9. Forced colors, reduced motion, and `prefers-contrast` in Firefox and WebKit. The accessibility lane tested them in Chrome. This lane did not repeat them.
10. Printing, text zoom, and right-to-left layout. The glider recipes have Firefox code for right-to-left scroll (`components/ariakit/styles/glider.ts:34-35`). The app has no right-to-left mode, so it was not tested.

Open questions for the maintainer:

1. Is Safari a supported review browser after launch? XBR-04 and XBR-07 matter only then.
2. Are items and variants navigation (links) or selection (tabs or radios)? (XBR-04, R3)
3. Is the main action a brand surface or an inverted neutral surface? (XBR-02)
4. Do approve and reject stay on bare letter keys? (XBR-08)
5. Is the 2 px size difference between the dark and the light scheme intended in `@ariakit/tailwind`? (XBR-13)
6. Can HTML documents that hold no private data drop `no-store`? (XBR-16)
7. Does the review page prove image integrity, or is that the task of the server? (XBR-15)
8. Is the Shift+Tab result in WebKit known Ariakit behavior? (XBR-07)
