# Adversarial verification: lane `gap-cross-browser` (XBR-01 to XBR-18)

Verifier date: 2026-10-05. Read-only. The repository is unchanged.

Scratch directory: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-cross-browser/verify/` (called `$V` below). The auditor's directory is `$S` = `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-cross-browser/`.

## Method and limits

- I copied the auditor's scripts to `$V` and changed only the output path (`$V/lib.mjs`). I re-ran them with Playwright 1.63.0: Chrome 154.0.8037.98 (system Chrome), Firefox 155.0 (Playwright build), WebKit 26.6 (Playwright build).
- New evidence that the auditor did not have:
  - Stock **Firefox 157.0** (`/Applications/Firefox.app`), headless screenshot mode with a scratch profile. Files: `$V/stage-real-firefox157.png`, `$V/real2-firefox157.png`, `$V/gate-real-firefox157.png`.
  - The system **JavaScriptCore** shell (`/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc`), which is the JavaScript engine of the installed Safari 26.6.2.
  - Control experiments: `$V/v-bfcache-control.mjs`, `$V/v-back.mjs`, `$V/v-gate.mjs`, `$V/v-shift-tab.mjs`, `$V/v-primary.mjs`, `$V/v-dates.mjs`, `$V/v-fonts.mjs`, `$V/v-csp-blob.mjs`, `$V/v-strip.mjs`, `$V/v-strip-stop.mjs`, `$V/v-webkit-tabindex-chip.mjs`, `$V/v-tailwind.mjs`, `$V/v-select.mjs`.
- Headed runs: only two short headed Firefox runs (`$V/v-fayt.mjs`, `$V/v-classic.mjs`). All other runs were headless.
- Not done: real Safari, a real iOS device, Windows or Linux, a screen reader. No request went to visonaut.com. No `gh api` call. Web: 2 searches and 2 page reads (WebKit pull request 74300, Chrome bfcache documentation).
- Launch scope: `docs/review-guide.md:94` says "Launch review validation targets Chrome Desktop and keyboard operation. Mobile workflows, other review browsers, and screen-reader certification have separate validation scope." Thus a Firefox-only or Safari-only finding is outside the launch scope. My severities use that scope.
- Skill used: `ariakit-general-workflow` (the remote is `github.com/ariakit/visonaut`; no Visonaut-specific workflow skill is installed).

## Summary table

| ID     | Verdict          | Auditor severity | My severity                                                |
| ------ | ---------------- | ---------------- | ---------------------------------------------------------- |
| XBR-01 | confirmed        | medium           | low                                                        |
| XBR-02 | partly-confirmed | medium           | medium                                                     |
| XBR-03 | confirmed        | medium           | low                                                        |
| XBR-04 | partly-confirmed | medium           | low                                                        |
| XBR-05 | confirmed        | high             | high (Chrome part), the engine difference is informational |
| XBR-06 | partly-confirmed | high             | medium                                                     |
| XBR-07 | partly-confirmed | medium           | low                                                        |
| XBR-08 | partly-confirmed | medium           | low                                                        |
| XBR-09 | confirmed        | low              | low                                                        |
| XBR-10 | partly-confirmed | low              | low                                                        |
| XBR-11 | confirmed        | low              | low                                                        |
| XBR-12 | confirmed        | low              | low                                                        |
| XBR-13 | confirmed        | low              | low                                                        |
| XBR-14 | confirmed        | medium           | medium                                                     |
| XBR-15 | partly-confirmed | medium           | low (launch scope)                                         |
| XBR-16 | partly-confirmed | medium           | low                                                        |
| XBR-17 | confirmed        | low              | low                                                        |
| XBR-18 | confirmed        | low              | low                                                        |

No finding is fully refuted. Six findings have a wrong cause, a wrong recommendation, or a wrong impact statement (XBR-02, XBR-04, XBR-07, XBR-10, XBR-15, XBR-16).

---

## XBR-01 · Firefox draws the stage background as triangles

- Verdict: **confirmed**. Severity: **low** (auditor: medium). Firefox is outside the launch scope, the defect is visual only, and the fix is one token.
- Proof:
  - Code: `apps/web/src/components/screenshot-viewer.tsx:134` has `bg-[repeating-conic-gradient(color-mix(in_oklch,currentColor_6%,transparent)_0%_25%,transparent_0%_50%)] bg-size-[20px_20px]`.
  - Re-run, `node $V/probe-stage.mjs --engine firefox`: `A-current {"contrast":42,"checkerMatch":77.5,"brightShare":27.5}`, `A6-hint-in-srgb {"checkerMatch":100}`, `A9-oklch-opaque 77.5`, `A10-hint-in-oklab 77.5`, `B-plain-rgba 100`, `C-opaque 100`. Chrome and WebKit: `A-current 100`, `A6 100`.
  - Stock Firefox 157.0 (not the Playwright build): `$V/stage-real-firefox157.png` shows triangles for the current CSS, for `oklch()` colors, and for `in oklab`. It shows squares for `in srgb`, `rgba()`, and hex. Thus the defect is real in the released browser.
  - The recommended class compiles. `node $V/v-tailwind.mjs` (Tailwind 4.3.3) gives `background-image: repeating-conic-gradient(in srgb,color-mix(in oklch,currentColor 6%,transparent) 0% 25%,transparent 0% 50%)`.
  - Screenshot `$S/screens/sheet-stage.png` shows what the finding says.
- Corrections:
  1. The cause text is too narrow. The trigger is each color that is not legacy sRGB syntax, not only `oklch()`. Candidate `A3-mix-in-srgb` (`color-mix(in srgb, currentColor 30%, transparent)`) also gives `77.5` in Firefox 155, and triangles in Firefox 157. Reason: a `color-mix()` result is a `color(srgb …)` value, and a gradient with a non-legacy color interpolates in Oklab by default (CSS Color 4, https://www.w3.org/TR/css-color-4/#interpolation-space). Thus the sentence "With sRGB colors … Firefox draws the squares" is true only for hex, `rgb()`, `rgba()`, and named colors.
  2. Alternative (b) is correct for the lab line that it cites: `apps/lab/src/routes/dev.fixtures.tsx:549` uses `#8883` and `#0000`. My Firefox 157 picture confirms squares for that declaration.
  3. The recommendation (add `in_srgb,`) is feasible and correct in the three engines.

## XBR-02 · `$layer="primary"` differs in Firefox dark

- Verdict: **partly-confirmed**. Severity: **medium** (same as the auditor). The root cause is the same as PRIM-01, DASH-07, A11Y-13, and PULL-09. Only the Firefox dark value is new.
- Proof:
  - Six uses exist: `apps/web/src/routes/index.tsx:301`, `:310`, `:346`, `:508`, `apps/web/src/routes/pulls.$pullNumber.tsx:194`, `:226`.
  - `apps/web/src/components/ariakit/utils/styles.ts:6-13`: `COLOR_VALUES` is `canvas, brand, secondary, success, warning, danger`. `apps/web/src/components/ariakit/components/layer.ariakit.react.tsx:97-100` returns `class: "ak-layer ak-layer-color-(--layer-color)"` and `style: { "--layer-color": value }` for each other string.
  - `apps/web/node_modules/@ariakit/tailwind/src/output.css:1654-1658`: `@property --_ak-lib { syntax: "<color>"; inherits: false; initial-value: canvas; }` and `:139`: `--_ak-lib: oklch(from var(--_ak-layer-color, var(--ak-layer-parent, canvas)) …)`.
  - Re-run, `node $V/v-primary.mjs`, button background: Chrome dark `oklch(0.949994 0.0000497986 23.7884)`, Firefox dark `oklch(0.276354 0.0135107 291.835)`, WebKit dark `oklch(0.95 0 0)`. Light: about `oklch(0.95 …)` in the three engines.
  - Stock Firefox 157.0 (`$V/real2-firefox157.png`): a registered `<color>` property with `initial-value: canvas` and an invalid value gives `oklch(0.276354 0.0135107 291.835)` under `color-scheme: dark`, and `oklch(0.95 5.96046e-8 0)` under `color-scheme: light`. Thus the mechanism is real in the released browser.
  - Screenshots `$S/screens/sheet-sign-in-card.png` and `sheet-primary-button.png` show what the finding says.
- Corrections:
  1. **"The theme has no `--color-primary`" is wrong for the source.** `apps/web/src/components/ariakit/styles/ui.css:6` has `--color-primary: var(--color-brand);`. The probe read "(not defined)" because Tailwind 4 does not emit a theme variable that no utility uses: the compiled CSS of the dev server has 0 matches for `color-primary` (`curl -s "http://127.0.0.1:4311/src/styles.css?direct"`, 371,158 bytes, `grep -c color-primary` gives `0`). The DASH-07 verification recorded the same fact.
  2. **Alternative (a) does not work.** `$layer` never reads `--color-primary`. It writes the literal word `primary`. Measured (`$V/v-primary.mjs`): after `document.documentElement.style.setProperty("--color-primary", "oklch(56.7% 0.1546 248.5156)")` the button color did not change in any engine. The color changed only when `--layer-color` was `var(--color-primary)` or `var(--color-brand)`: `oklch(0.515341 0.1546 248.516)` in the three engines.
  3. The theme line `--color-primary: var(--color-brand)` shows the upstream intent: primary is brand. That is input for the maintainer decision. The PRIM-01 verification also noted that the contract asks for mostly flat neutral controls, so the decision stays with the maintainer.
  4. The finding says "Dark scheme only" for the engine difference. That is correct. But the impact is not Firefox only: in the light scheme the button is `#eeeeee` on a white card in each engine (`sheet-primary-button.png`, second row). Other lanes already reported that.
  5. Path: the cited file is `apps/web/node_modules/@ariakit/tailwind/src/output.css` (version 0.2.8). There is no `node_modules/@ariakit` at the repository root.
  6. `$layer="brand"` and `$invert` are feasible. `$invert` exists in the vendored layer (`layer.ariakit.react.tsx:120`, defaults at `:368-383`).

## XBR-03 · The native progress element ignores the brand color

- Verdict: **confirmed**. Severity: **low** (auditor: medium). It is a small cosmetic element. It is in the launch scope, because Chrome shows green on gray.
- Proof:
  - Code: `apps/web/src/review/review-workspace.tsx:599-604`, `className="hidden sm:block h-1.5 w-16 accent-brand"`.
  - Re-run, `node $V/probe-stage.mjs`: the `app` row gives fill `#008000` and track `#808080` in Chrome and WebKit, and `#0064b4` on `#e6e6e6` in Firefox. Computed `appearance: auto`, `accent-color: oklch(0.567 0.1546 248.516)`, `border: 0px solid`.
  - The cause is proved by the `no-class` rows: with the preflight border (`0px solid`) and `accent-color: rgb(0, 122, 255)` the fill stays `#008000` (Chrome, WebKit) and `#0064b4` (Firefox). With `border: revert` the fill is `#007aff` in Chrome and Firefox.
  - Stock Firefox 157.0 (`$V/real2-firefox157.png`): a `<progress>` with `border: 0 solid` is a flat blue bar on a light track. With the default border it has the themed look and the accent color.
  - Screenshot `$S/screens/sheet-progress.png` shows what the finding says.
- Corrections:
  1. The values after `border: revert` on the app-sized bar (`#3b78a1`, `#00c1ff`) are samples from a bar that is 4.1 px high. They include edge pixels. Do not use them as theme facts. The `no-class-border-revert` rows are the clean proof.
  2. `apps/web` has no vendored `Progress` component (the component folder has badge, button, disclosure, frame, kbd, layer, nav, popover, shell, table, tabs, text-frame, text). The recommendation needs a new vendored primitive or a plain `role="progressbar"` element. `ui.css` already registers `--progress-value` and `--animate-ui-progress`.

## XBR-04 · In WebKit, Tab skips all 13 links

- Verdict: **partly-confirmed**. Severity: **low** (auditor: medium). Safari is outside the launch scope, the behavior is the Safari default for each website, Option+Tab works, and one impact claim is wrong.
- Proof:
  - Re-run, `node $V/probe-tab.mjs --engine webkit`, routed page: 21 stops, 0 links, "Approve & next" is stop 18. Not reached: the 4 header links, the selected item row, "Queue", and the 7 chips. Chrome: 34 stops, stop 31. Firefox: 35 stops, stop 32. `--mode alt` in WebKit: 34 stops, stop 31. (The script prints one more line for the end marker.)
  - `node $V/probe-tabindex-links.mjs`: `selected-chip-and-row Tab stops=23 links reached=2`, `all-links … links reached=15`.
  - Code: item rows are links on the routed page (`apps/web/src/review/item-list.tsx:195-215`), chips are `NavLink` (`review-workspace.tsx:732-780`), "Queue" is `<a href="/">` (`:580`).
- Corrections:
  1. **"A reviewer with shortcuts off … has no keyboard path to another item" is wrong.** The buttons "Previous screenshot" and "Next screenshot" (`review-workspace.tsx:652-672`, `onClick={() => selectItem(order[itemPosition + 1] ?? -1)}`) are Tab stops in WebKit. My run lists `5. <button> button "Next screenshot"`. The real gap is the variant chips, the header nav, and "Queue".
  2. **The link choice is a recorded maintainer decision.** `docs/current-contract.md:192`: "Run views and variants use navigation links with a bar glider; variant links replace the original U03 tabs." Thus the open question "navigation or selection?" already has an answer in the binding contract, and redesign idea R3 (a tab list for variants) reverses it. The finding does not cite this.
  3. **The minimal fix has a side effect in WebKit.** An explicit `tabindex` makes a link mouse-focusable in WebKit. Measured (`node $V/v-webkit-tabindex-chip.mjs`): with a roving `tabindex` on the chips, a click on chip 2 puts focus on the chip (`inStrip: true`), `D` does nothing (`mode` stays `side`), and Shift+Tab stays on the chip. Without the attribute, focus goes to the root, `D` works, and Shift+Tab moves. Thus the fix brings WORK-01 and XBR-07 to WebKit unless XBR-05 is fixed first.
  4. Confidence stays "medium for Safari": I did not run real Safari. The behavior matches the documented Safari default (the setting "Press Tab to highlight each item on a webpage" is off).

## XBR-05 · Click focus differs: WORK-01 reproduces in Chrome and Firefox, not in WebKit

- Verdict: **confirmed**. Severity: **high** for the Chrome part (it is WORK-01 and A11Y-01, in the launch scope). The engine difference itself is information for the fix.
- Proof:
  - Code: `review-workspace.tsx:88-97` (the selector has `.review-variants`), `:443-448` (listener on `document`), `:528-534` (root with `tabIndex={0}`).
  - Re-run, `node $V/probe-focus.mjs --engine chrome|firefox|webkit`:
    - Chrome and Firefox: `WORK-01: focus after chip click = <a> link "2. Solid …"; inside strip = true; D changed mode = false; ArrowDown changed item = false; A saved = false` (fixture and routed).
    - WebKit: `focus after chip click = <div> div "Review workspace"; inside strip = false; D changed mode = true; ArrowDown changed item = true; A saved = true`.
    - Click table: the same as the report in each row (links focus in Chrome and Firefox, the root in WebKit, the routed item row in all three).
- Corrections:
  1. The recommended code is more complex than necessary. `followVariantLink` already calls `event.preventDefault()` for its four keys (`review-workspace.tsx:115`), and the page handler returns on `event.defaultPrevented` (`:396`). Thus the removal of `.review-variants` from the selector is sufficient. The A11Y-01 and WORK-01 verifications measured that. Enter and Space in `stripKeys` are not necessary, because the page handler does not bind them. Alternative (a) with `stopPropagation()` is not necessary.
  2. The Firefox result comes from the Playwright build. I did not automate stock Firefox for clicks.
  3. The assumption in the impact text (no `tabIndex` on the root, focus on `body`, shortcuts still work) is consistent with the code: `excludesShortcuts` returns false for `body`. It is still not measured.

## XBR-06 · A11Y-02 re-test: focus goes to the root, and the ring differs

- Verdict: **partly-confirmed**. Severity: **medium** (auditor: high). The A11Y-02 verification already set medium. The new engine fact (ring width and visibility) is low.
- Proof:
  - Code: `apps/web/src/review/use-review-session.ts:317` and `:470` call `onFocus()`. `review-workspace.tsx:248`: `workspace.current?.focus({ preventScroll: true })`.
  - Re-run, `node $V/probe-focus.mjs`: after a click on "Approve & next" focus is `div "Review workspace"`, box `1440 x 1014`, in the three engines. After Enter: Chrome `focusVisible true, outline auto 1px rgb(153, 200, 255)`, Firefox and WebKit `auto 3px oklch(1 0 0)`. After the `A` shortcut: Chrome `fv=true`, WebKit `fv=true`, Firefox `fv=false outline none`. Next Tab: `a "Visonaut review queue"` (Chrome), `input "Search screenshots"` (WebKit).
  - Screenshot `$S/screens/focus-root-after-a-key--webkit.png`: a blue line at the top edge of the root. In the fixture the root starts below an extra input, so the line is at y 22. In the real app the root starts at y 0.
- Corrections:
  1. **The recommendation "do not move focus after a decision" is not complete.** Approve and Reject are `disabled` while the next images load (`review-workspace.tsx:1064-1070` and `:1082-1088`, `disabled={!ready || …}`). The A11Y-02 verification measured that focus then falls to `body`. The fix also needs `accessibleWhenDisabled` or no disabling during the load.
  2. **The focus move is deliberate, recorded behavior.** `docs/current-contract.md:196` lists "Retry, Undo, focus, and navigation" as behavior that the UI must preserve, and `:198` says "The workspace keeps layout, image readiness, selection, focus, and navigation." A change is a contract change, not a bug fix.
  3. Kind "accessibility, high" repeats another lane's finding. Count it once.

## XBR-07 · In WebKit, Shift+Tab does not move after a click on a button label

- Verdict: **partly-confirmed**. Severity: **low** (auditor: medium). The behavior is real in Playwright WebKit. The stated cause is wrong.
- Proof:
  - The library adds an attribute. It does not focus in script. `apps/web/node_modules/@ariakit/react-components/src/focusable/focusable.tsx:154-159`: "On Safari, buttons and button-like inputs … require an explicit tabIndex to receive focus on mousedown. `if (safariTabIndex && tabIndexProp == null) { return 0; }`" and `:454-470` sets `safariTabIndex` for buttons. The file has no `focus()` call in a mouse handler. WebKit then focuses the button natively.
  - **The defect needs no library.** `node $V/v-shift-tab.mjs` on a plain page:

    ```
    webkit   click a2  start=BODY   Shift+Tab -> a2     Shift+Tab -> a1     (plain <button><span>)
    webkit   click b2  start=b2     Shift+Tab -> b2     Shift+Tab -> b2     (<button tabindex="0"><span>)
    webkit   click c2  start=c2     Shift+Tab -> c2     Shift+Tab -> c2     (<div tabindex="0"><span>)
    webkit   click d2  start=d2     Shift+Tab -> d2     Shift+Tab -> d2     (<a href tabindex="0"><span>)
    webkit   click e2  start=e2     Shift+Tab -> e2     Shift+Tab -> e2     (<button tabindex="0">text only)
    chrome, firefox: each case moves to the previous element
    ```

  - **It is a known upstream WebKit bug.** WebKit pull request 74300, "Backwards focus navigation is stuck when selection is towards start of focusable element" (bug 316027, opened 2026-09-18, open): a mouse press sets the focus navigation start node to the node under the pointer, and a backward search from a descendant finds the focused ancestor again. https://github.com/WebKit/WebKit/pull/74300
- Corrections:
  1. Cause: an engine bug in WebKit, shown by each element with an explicit `tabindex`. Ariakit only makes buttons subject to it, because it adds `tabindex="0"` in Safari.
  2. Scope: it is wider than buttons. It applies to the two image viewports (`screenshot-viewer.tsx:135`, `tabIndex={0}`), and to each link that gets a `tabindex` from the XBR-04 fix (measured in `v-webkit-tabindex-chip.mjs`).
  3. Recommendation: the upstream target is WebKit, where a fix is in review. An Ariakit workaround is optional. The answer to "Is this known Ariakit behavior?" is: it is a WebKit bug.
  4. The bug is in WebKit source, so real Safari 26.6 very likely has it. I did not run real Safari.
  5. The alternative `pointer-events: none` on label parts does not cover a text-only button (case `e2`).

## XBR-08 · Firefox find-as-you-type and quick find

- Verdict: **partly-confirmed**. Severity: **low** (auditor: medium).
- Proof:
  - Headed re-run, `node $V/v-fayt.mjs` (Playwright Firefox 155):
    - `quote-then-dialog`: `keydown:':default:div … keydown:d:prevented:div keydown:i:default:div keydown:a:default:a …`, `mode side -> diff; saved commands: []; focus: a "1. React · Chromium · Light · "`.
    - `fayt-on-b-then-d`: `keydown:b:default:div keydown:d:default:a`, `focus: a "6. WebKit · Chromium · Light ·"`.
    - `fayt-on-shortcuts-off-dialog`: all keys default, `selection: "dialog"`.
  - Preference defaults in stock Firefox 157: `browser/omni.ja → defaults/preferences/firefox.js:503` has `pref("accessibility.typeaheadfind", false);`. `greprefs.js:220` has `pref("accessibility.typeaheadfind.manual", true);`. Thus find-as-you-type needs a setting that is off by default, and the `'` and `/` quick find keys are on by default.
  - Code: `review-workspace.tsx:441` (`preventDefault()` only for a handled key) and `:94-96`.
- Corrections:
  1. **Point 1 is not a Firefox fact.** The auditor's own raw output has the same result with default preferences: `## plain-dialog-default-prefs … mode side -> original; saved commands: ["approved×1"]` (`$S/data/fayt-headed.out`). A typed word runs the bound letters in each browser. That is the design of single-key shortcuts, and the off switch covers WCAG 2.1.4 (A11Y-07 verification). The summary line gives this to find-as-you-type. That is misleading.
  2. **The Playwright build has no working find bar.** Each scenario prints `find bar opened … false; page kept focus: true; blur events: 0`, also `cmd-f-then-dialog`, where the page still got each key and approved a variant. In stock Firefox, Cmd+F moves focus to the find field, and the page gets no key. Thus the `/` and Cmd+F rows prove nothing about stock Firefox. Only the focus move by the in-page type-ahead code is good evidence.
  3. The remaining real effect is: a match in a chip moves focus into `.review-variants`, and then the WORK-01 state applies. The fix of WORK-01 (XBR-05) removes that effect. No other change is necessary for it.
  4. Not verified in stock Firefox.

## XBR-09 · Firefox adds one Tab stop on the variant strip

- Verdict: **confirmed**. Severity: **low**.
- Proof:
  - Re-run, `node $V/probe-tab.mjs --engine firefox`, routed page: `13. <nav> nav "Variants" 1120x38 fv=true`. Chrome has no such stop.
  - Code: `apps/web/src/components/ariakit/components/nav.ariakit.react.tsx:73` (`overflow-x-auto`).
- Corrections:
  1. The stop exists only when the chips overflow. `node $V/v-strip-stop.mjs`: with 7 chips the order after "Details" is `nav "Variants" -> a "1. React …"`. With 2 chips it is `a "1. React …" -> a "2. Solid …" -> button "Compare S"`. Production items have about 6 variants with long labels (`live-authenticated.md:26`: 626 items, 3,832 variants), so overflow is the usual case.
  2. A smaller fix exists that the finding does not list: `tabIndex={-1}` on the `Nav`. Measured in the same script: `7 chips, nav tabindex=-1 … after Details: a "1. React …"`. The chips still scroll into view on focus.

## XBR-10 · Dates read differently in WebKit

- Verdict: **partly-confirmed**. Severity: **low**. The finding is correct. The recommended code is wrong.
- Proof:
  - Code: `apps/web/src/routes/index.tsx:156` and `apps/web/src/components/operations-attention/index.tsx:206`: `toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })`.
  - Re-run, `node $V/v-dates.mjs`: Chrome and Firefox `"Oct 5, 2026, 2:24 PM"`, WebKit `"Oct 5, 2026 at 2:24 PM"`.
  - System JavaScriptCore (the engine of the installed Safari): `jsc -e '…toLocaleString("en-US",{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"})'` prints `Oct 5, 2026 at 2:24 PM`. Stock Firefox 157 prints `Oct 5, 2026, 2:24 PM` (`$V/real2-firefox157.png`). Thus the difference is real outside Playwright.
- Corrections:
  1. **The recommended formatter does not give the same string in each engine.** `new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })` gives `"Oct 5, 2:24 PM"` in Chrome and Firefox and **`"Oct 5 at 2:24 PM"`** in WebKit and in `jsc` (`formatToParts` shows `literal=" at "`). The code comment `// "Oct 5, 2:24 PM" in each engine` is false.
  2. A form that is equal in the three engines (measured, `split` column): one formatter for the date, one for the time, and a fixed separator.

     ```ts
     const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
     const time = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
     export const formatDateTime = (value: number) => `${day.format(value)}, ${time.format(value)}`;
     ```

  3. The lab helper (`apps/lab/src/fixtures/format.ts:34-37`) is not an `Intl` formatter. It builds the string by hand in UTC. It is a fixture helper, not a model for local time in the product.
  4. The recommended format drops the year and fixes the locale to `en`. Run history spans years. That is a product decision, not a bug fix.
  5. The remark about a server string and a client string is hypothetical today. No date is rendered on the server: the queue loads data in an effect (`routes/index.tsx:176-180`) and the run route has `ssr: false` (`routes/runs.$runId.tsx:31`).
  6. I did not re-measure the column widths (177.14 against 187.55 px, 67 of 255 elements).

## XBR-11 · Code text is SF Mono in WebKit and Menlo in Chrome and Firefox

- Verdict: **confirmed**. Severity: **low**.
- Proof: `node $V/v-fonts.mjs`, 14 px, `aabbccddeeff`: app stack 101.16 px (Chrome), 101.2 px (Firefox), 103.86 px (WebKit). `ui-monospace, serif` gives the serif width 74.38 px in Chrome and Firefox and 103.86 px in WebKit. `document.fonts` size is 0 in each engine.
- Corrections:
  1. The reason that is given for the recommended stack is wrong. `"SF Mono"` by name resolves in no engine on this machine: `"SF Mono", serif` gives 74.38 px (the serif width) in the three engines. The stack `"SF Mono", Menlo, ui-monospace, monospace` is equal in the three engines (101.16, 101.2, 101.16 px) only because Menlo is second. On a machine with SF Mono installed as a user font, the result changes to SF Mono in each engine. A plain `Menlo, ui-monospace, …` has the same effect with no surprise.
  2. The fix covers macOS only. Windows and Linux fall through to other fonts, as today.

## XBR-12 · The native select and the ring with no color

- Verdict: **confirmed**. Severity: **low**.
- Proof:
  - Code: `apps/web/src/routes/index.tsx:674-686`, `:678` (`focus-visible:outline-2 focus-visible:outline-offset-2`, no color), `:710`, and `:656-662` (`outline-none focus-visible:underline`).
  - Re-run, `node $V/v-select.mjs`: Chrome `168x19, radius 0px, solid 2px rgb(153, 200, 255)` (dark) and `rgb(0, 95, 204)` (light). Firefox `168x17, solid 2px oklch(1 0 0)` and `oklch(0 0 0)`. WebKit `168x20, radius 5px, solid 2px oklch(1 0 0)` and `oklch(0 0 0)`. Search input `outline: none` in each engine.
  - Screenshot `$S/screens/sheet-history-filters.png` shows the three select drawings and the two ring colors.
  - `focus-visible:outline-brand` compiles to `outline-color: var(--color-brand)` (`$V/v-tailwind.mjs`). The same class is already in `screenshot-viewer.tsx:134`.
- Corrections: none. The finding overlaps A11Y-09 and PRIM-20.

## XBR-13 · `$border` is a border in dark and a ring in light

- Verdict: **confirmed**. Severity: **low**. It is not an engine difference, as the finding says.
- Proof:
  - `apps/web/node_modules/@ariakit/tailwind/src/output.css:1347-1362`: `@variant ak-dark { border-width: calc((1 - var(--_ak-fbd)) * var(--_ak-frame-bordering)); … }` and `@variant ak-light { border-width: calc(var(--_ak-fbd) * var(--_ak-frame-bordering)); … }`.
  - Re-run, `node $V/probe-scheme.mjs --engine chrome`: `workspace: 40 elements have another size in dark than in light; 12 of them have another border width`. Examples: `<button> "Details" dark 86.91x34.5 light 84.91x32.5`, `<a> "1. React …" dark 295.08x30 light 293.08x28`, `review-evidence dark 1184x554 light 1184x552`.
  - `$borderType="ring"` exists: `apps/web/src/components/ariakit/components/frame.ariakit.react.tsx:164-175`.
- Corrections:
  1. The behavior is documented upstream design, not an open question: `frame.ariakit.react.tsx:161-162` says "Setting it to `auto` uses either a border or a ring, depending on the parent layer's lightness." The 2 px size difference follows from that choice.
  2. The rule is by layer, not by scheme. `--_ak-fbd` is 1 when the layer is darker than its parent. Thus a `$darken` layer has the reverse result (a ring in dark and a border in light).

## XBR-14 · Classic scrollbars: no item list from 1024 to 1038 px, and a taller variant strip

- Verdict: **confirmed**. Severity: **medium**. This is the one finding of the lane that applies to the launch browser: Chrome on Windows and Linux has space-taking scrollbars by default. No lane ran Chrome on those systems.
- Proof:
  - Code: `review-workspace.tsx:211-213` (`matchMedia("(max-width: 1023px)")`), `:538` (`$show="5xl"`), `:570` (`@max-5xl/shell:hidden`).
  - Headed Firefox with `ui.useOverlayScrollbars = 0`, `node $V/v-classic.mjs`: `1030 {"innerWidth":1030,"clientWidth":1015,"narrow":false,"sidebar":false,"toggle":false,"screenshotsButton":false,"stripHeight":53,"stripGutterY":15}`. At 1039 the sidebar is back. At 1023 the "Screenshots" button shows.
  - Chrome with a 15 px `::-webkit-scrollbar`, `node $V/probe-breakpoint.mjs --engine chrome`: `NO ITEM LIST` at 1024, 1030, and 1038. With a 20 px root font: `NO ITEM LIST` at 1024, 1200, and 1279.
  - Strip, Chrome emulation, `node $V/v-strip.mjs`: 7 chips `height 38 -> 53`, `stageTop 414 -> 429`.
- Corrections:
  1. The strip scrollbar is not permanent. It shows only when the chips overflow: with 2 chips the height stays 38 px (`variants=2 classic {"height":38,"overflows":false}`). Production items usually overflow (see XBR-09).
  2. **The recommended snippet does not fix the dead zone alone.** The dialog still depends on the flag: `review-workspace.tsx:1207` has `open={itemsOpen && narrow}` and `:1221` has `{narrow && itemNavigation}`. In the dead zone `narrow` is false, so the button opens nothing. Each use of `narrow` (`:407`, `:559`, `:625`, `:1149`, `:1170`, `:1207`, `:1221`, `:1224`, `:1240`) must use the same condition as the CSS. The details panel has the same defect (SHELL-11 verification).
  3. **The alternative `scrollbar-gutter: stable` does not fix it.** It reserves the 15 px always. The container is then always 15 px narrower than the media query width, so the dead zone becomes permanent for those users.
  4. The WebKit part is not verified, as the finding says.

## XBR-15 · The readiness gate accepts a truncated image

- Verdict: **partly-confirmed**. Severity: **low** for the launch scope (auditor: medium). The measured case is real. The claim "the same in all engines" is not complete, and the recommended code cannot run under the app's policy.
- Proof:
  - Code: `apps/web/src/components/screenshot-viewer.tsx:49-72` (`await element.decode()`, the size check, then `report(role, { status: "ready" })`).
  - `node $V/v-gate.mjs --all` with a real Node server:

    | Case                                                                      | Chrome                 | Firefox 155        | WebKit          |
    | ------------------------------------------------------------------------- | ---------------------- | ------------------ | --------------- |
    | A. 40% of the bytes, `Content-Length` = short length (the auditor's case) | ready, Approve enabled | ready, enabled     | ready, enabled  |
    | B. 40% of the bytes, `Content-Length` = full length, socket closed        | error, disabled        | **ready, enabled** | error, disabled |
    | C. 40% of the bytes, chunked, socket closed with no last chunk            | error, disabled        | **ready, enabled** | error, disabled |

  - Stock Firefox 157.0 (`$V/gate-real-firefox157.png`): for A, B, and C the page prints `load fired, decode resolved, natural 600x400, complete true`, and each picture is partly drawn.
- Corrections:
  1. **Case A needs a short object in storage, which the server prevents.** Upload validation decodes the whole image (`apps/compare/src/validate.ts:23-25`: `readBounded`, `validateImage`, `decodeImage`). The image route serves only rows with `validated = 1` and sends `Content-Length: stored.size` (`apps/web/src/api/images.ts:26`, `:50`). "A proxy that cuts a response and keeps a valid length" is not a plausible fault for a response with a length header.
  2. **A real transport cut is an engine difference.** Chrome and WebKit report an error. Firefox reports `ready` on a part image. The sentence "each of the 8 image cases ends in the same state in each engine" is true for the 8 cases of the probe, but the probe has no transport cut. See "Missed".
  3. **The recommended code is blocked by the document policy.** `packages/security/src/http.ts:43` has `img-src 'self' data:`. A `blob:` image is refused. Measured on the app document (`node $V/v-csp-blob.mjs`): `img-src: 'self' data: | {"blob":"error","dataUrl":"loaded 1x1","violations":["img-src blocked blob"]}` in the three engines. The fix needs `blob:` in `img-src`, which is a security policy change.
  4. The open item about `digest` has an answer: it is the SHA-256 hex of the uploaded bytes (`packages/compare/src/image.ts:35`, `packages/compare/src/binary.ts:35-38`), and it is the `ETag` of the image response (`api/images.ts:37`, `:53`). But the preview fixtures use `digest: id` (`apps/web/src/review/preview-fixtures.ts:13`), so a digest check in the browser fails for each preview image until the fixtures change. The snippet also sets `image/png`, and images can be WebP (`api/images.ts:32`).
  5. Alternative (a) needs a byte length that `ReviewImage` does not have (`apps/web/src/review/model.ts:10-16`), and an `<img>` gives no response headers to script.
  6. A digest check in the browser cannot find an image that was already short when it was captured, because the digest then matches. The server decode is the control for that case.

## XBR-16 · Back and forward never use the page cache

- Verdict: **partly-confirmed**. Severity: **low** (auditor: medium). Two observations are true. The cause and the main scenario are wrong.
- Proof of the true parts:
  - `packages/security/src/http.ts:33`: `headers.set("Cache-Control", "no-store, private");`. `apps/web/src/server.ts:23-28` applies it to each rendered document. `curl -s -D - -o /dev/null http://127.0.0.1:4310/` returns `cache-control: no-store, private`.
  - View mode and zoom are component state: `review-workspace.tsx:197-198` (`useState<ReviewMode>("side")`, `useState<ReviewZoom>("fit")`).
  - "Queue" is a plain link: `review-workspace.tsx:580` (`render={<a href="/" />}`).
- Corrections:
  1. **The main scenario "queue → run → Back" does not reload a document in real use.** The queue link is a client route link (`routes/index.tsx:507-511`, `render={<Link to="/runs/$runId" params={{ runId: run.id }} />}` at `:510`). The history row (`:707-710`) and the group card link (`:592`) are client route links too. The auditor's probe used `page.goto(run)`, which forces a document load. With a click on the link (`node $V/v-back.mjs`), in each engine:

     ```
     click to run: GET /api/runs/0000…0001 [fetch] | same document: true
     Back: GET /api/runs [fetch], GET /api/runs [fetch] | same document: true | loading text at first sample: true
     Forward: GET /api/runs/0000…0001 [fetch] | state: {"mode":"side", zoom "Fit"}   (set to diff and 200% before)
     ```

     Thus the loading text and the second `/api/runs` request on Back are real, but the cause is that the queue route mounts again and has no client data cache. The page cache and `no-store` have no part in this path. A change of the header does not improve it.

  2. **View mode and zoom reset on a client-side Forward too.** Thus the page cache is not the cause of that reset. Alternative (b) (store the two values in the URL or in `sessionStorage`) is the fix.
  3. **The Firefox and WebKit results prove nothing about `no-store`.** The Playwright builds do not restore any page. Control, `node $V/v-bfcache-control.mjs`, two plain pages with no `no-store`: Firefox `{"sameDocument":false,"shows":[false]}`, WebKit `{"sameDocument":false,"shows":[false]}`. The Firefox build says so: `playwright.cfg:38-40`, "Disable BFCache in parent process … `pref("fission.bfcacheInParent", false);`".
  4. **"A document with `no-store` is not eligible … in any of the three engines" is false for Chrome 154.** Same control, Chrome with the page cache on: a plain `no-store, private` page gives `{"sameDocument":true,"shows":[false,true]}`. Chrome restores such a page unless, for example, the page made a fetch that got a `no-store` response (https://developer.chrome.com/docs/web-platform/bfcache-ccns: "If a `Cache-control: no-store` page makes a fetch or XHR request and that returns `Cache-control: no-store` on its response, then this will also evict the page."). That is the app's case, and it matches the auditor's reason `response-cache-control-no-store-with-js-network-request`.
  5. Alternative (a) names the wrong link. The run link from the queue is already a client link. The plain link is "Queue" on the run page. A full document load remains for: "Queue", a reload, and an entry from GitHub.
  6. Real Firefox and real Safari very likely refuse a `no-store` HTTPS document for the page cache. That is platform knowledge. This lane has no measurement for it.

## XBR-17 · Headless Firefox moves the header underline after `scrollTo`

- Verdict: **confirmed**. Severity: **low**. No user impact.
- Proof:
  - Code: `nav.ariakit.react.tsx:223` (`"[.horizontal>&]:fixed!"`) and `:273-276` (`[@supports_not_(-moz-appearance:none)] … absolute!`).
  - Re-run headless, `node $V/probe-glider-scroll.mjs --engine firefox`: `scrollTo-400 scrollY=400 glider=527.6,-362.4,131.8,1.6 selected=527.6,7.7,131.8,31.6 position=fixed | widest bright row under the link: 0%`. Chrome: `glider=527.6,37.6,… position=absolute … 100%` at each step.
  - Headed part: I did not run it again. The recorded data `$S/data/glider-scroll-firefox-headed.json` has `glider [527.6, 37.6, 131.8, 1.6]` at `scrollTo-100` and `scrollTo-400`, and `$S/screens/glider-scroll-scrollTo-400-header--firefox-headed.png` shows the underline.
- Corrections:
  1. The sentence about the lab header glider did not reproduce in my run: `firefox 155.0 /: … gliders detached after scrollTop 300: 0 of 1`. The lab files changed during this work, so the runs are not comparable.

## XBR-18 · Design lab: no errors, but the mask images differ

- Verdict: **confirmed**. Severity: **low**.
- Proof: `node $V/probe-lab.mjs` in the three engines, then `node $V/lab-masks.mjs`:
  - `/primitives`: `status 200 elements=2483 … gliders=21 (shown 17)`, `page errors and console errors: none`, `gliders off their selected control at rest: 0`, in each engine.
  - `/dev/fixtures`: `status 200 elements=3223 images=314 broken images=0`, no error, in each engine. (The report has 3205 elements. The lab changed.)
  - `firefox against chrome: 35 of 56 masks have the same red pixel count (within 2%) and the same bounding box`. `webkit against chrome: 21 of 56`.
  - `page|light|diff chrome red=2924 | webkit red=9508 ratio=3.25`, `popover|light|diff chrome red=12704 | webkit red=19138 ratio=1.51`, `table|dark|diff chrome red=7400 | webkit red=8640`.
  - Code: `apps/lab/src/fixtures/images/index.ts:148` (`mix-blend-mode:difference`), `:153` (`filter: "url(#mask)"`), `apps/lab/docs/fixtures.md:117` ("verified in Chrome only"), `apps/lab/src/routes/dev.fixtures.tsx:549` and `dev.hooks.tsx:343` (hex colors).
  - Screenshot `$S/screens/sheet-lab-masks.png` shows the solid block and the thicker ring in WebKit.
- Corrections: none. Headed mode was not tested, as the finding says.

---

## Missed

1. **Firefox accepts an image after a dropped connection.** With a real transport cut (full `Content-Length` and a closed socket, or chunked with no last chunk), Chrome and WebKit fire `error`. Firefox 155 and stock Firefox 157 fire `load`, `decode()` resolves, the size is correct, the state is `ready`, and Approve is enabled on a part image (`$V/v-gate.mjs`, `$V/gate-real-firefox157.png`). This is the realistic form of XBR-15, and it is an engine difference.
2. **The Playwright Firefox and WebKit builds never restore a page from the page cache.** Each back and forward conclusion for those engines needs a real browser (`$V/v-bfcache-control.mjs`, `playwright.cfg:38-40`).
3. **The real queue → run → Back path is a client route change.** Back fetches `/api/runs` again and shows the loading text because the queue has no client data cache. Forward resets view mode and zoom. `no-store` has no part in it (`$V/v-back.mjs`).
4. **The WebKit Shift+Tab defect is an upstream WebKit bug (316027) and applies to each element with an explicit `tabindex`**, also the two image viewports and each link that gets a `tabindex` (`$V/v-shift-tab.mjs`).
5. **The XBR-04 fix moves WORK-01 into WebKit.** A `tabindex` on a chip makes WebKit focus the chip on a click, and then the shortcuts stop there too (`$V/v-webkit-tabindex-chip.mjs`).
6. **The date formatter in the XBR-10 recommendation still differs in WebKit** (`"Oct 5 at 2:24 PM"`, also in the system JavaScriptCore).
7. **The document policy `img-src 'self' data:` blocks `blob:` images**, so the digest check of XBR-15 cannot ship without a policy change (`$V/v-csp-blob.mjs`).
8. **The theme source defines `--color-primary: var(--color-brand)` (`ui.css:6`), but Tailwind drops it and `$layer` never reads it.** This changes the options of XBR-02.
9. **Chrome on Windows and Linux is in the launch scope and has space-taking scrollbars.** XBR-14 applies there. No lane ran those systems.
10. **Only the newest engine builds were run.** The glider code has a path for engines with no anchor positioning (`glider.ts:22` `not-supports-anchor:hidden`, `:227-229` `supports-anchor:`). No lane tested that path (for example Safari 18 or Firefox ESR).
11. **Stock Firefox and the system JavaScriptCore were on the machine and were not used.** They confirm XBR-01, XBR-02, XBR-03, and XBR-10 outside the Playwright builds.
