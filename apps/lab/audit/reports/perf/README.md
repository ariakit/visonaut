# Why the lab is slow

The maintainer asked on 2026-10-07: "the Lab app is extremely slow. And I believe it's because of the huge generated CSS. Are you doing something unnecessary there or is the problem our ariakit-ui primitives? I'm afraid the app will also be slow when we implement the new design."

Three research lanes measured it, and an independent checker repeated the key measurements of each lane and tried to refute its cause. This file is the combined answer. The folders `css`, `runtime`, and `dev-loop` have the notes, the scripts, and the recorded results of each lane and of its checker (`check`).

## Limits to read first

- The machine was never free. The load average was 12 to 850 on 14 cores, because other agent sessions ran at the same time. So no time in this record is the speed of the app on a quiet machine. The counts and the ratios between two forms that ran in turns are the stable facts.
- Only headless Chrome ran. Safari and Firefox were not tested.
- The lab that was measured is the state of 04:18 to 04:27 on 2026-10-07 (round 2, with 15 gallery cards). The lab of round 3 has 10 gallery cards.
- The three checkers do not agree on one point: the cost of rules that match no element. See "The size of the file".

## Corrections from the follow-up lane

A fourth lane and its checker ran later on 2026-10-07. Its record is the folder `record` (`notes.md` has the checker record first). It is the source of the part "Speed of the primitive layer and of the settled design" of the audit document (revision r7). Where this file and that part differ, the part is correct. The follow-up corrects five things below:

- **The typed `@property` rules are not the cost. They limit it.** The cost for each element is the formulas that `ak-layer` writes (`output.css:118`): about 170 µs for one element with `ak-layer` at a full recalculation, against 2 µs for an element with no class. Without a type, the colors are 15 times slower. No faster registration with an equal picture was found.
- **The cause of the 400 ms case is found.** Three class names (`glider.ts:129`, `glider.ts:138`, `tabs.ts:381`) make a sibling rule shape. With one of them in the sheet, an element that is added or removed before a sibling makes Chrome recalculate the subtree of its parent. Ariakit removes the portal node of a tooltip from `<body>`, and the variant control of the lab makes new tooltips for a screenshot. With each folder open, 8 of the first 60 arrow keys recalculate 2,435 of 2,589 elements. A tested rewrite of two custom variants gives 85.
- **Only the hover glider costs, not each glider.** One arrow key recalculates 1,217 of 1,734 elements with the hover glider, and 70 with the bar glider only. A tested rewrite of two class names of `nav.ts` gives 72 with four gliders.
- **The four gliders of the lab list are not a lab mistake.** The direction document of the lab has hover and focus gliders in each list. Only the selected glider is more than the plan.
- **The gallery numbers are for the lab of round 2** (15 frames, load average 12 to 850). The lab of today has 10 frames: 3,185 requests and quiet after 3.8 to 5.1 s on a development server, against 223 requests and 0.9 to 1.1 s with the frame documents blocked.

The times of the follow-up are from a load average of 3 to 12, so they are lower than the times below.

## The answer in short

The belief is partly right.

- **Wrong: the size of the generated file.** Chrome parses the 475 KB sheet in 5 to 13 ms for one document. A sheet of double size changes nothing.
- **Right: the CSS work.** With an empty sheet, the main thread work of one page goes down by 42% to 71% in the production form. The cost is in what the rules of the primitive layer make the browser compute for each element, and in how many elements one change makes it compute again.
- **The lab does things that it does not need.** They multiply the cost. The largest is the live preview frames.
- **The real app will not be slow as the lab is.** But the review page of the settled design is heavier than the review page of today, and two things in the primitive layer must be fixed or avoided before it goes into the real app.

## Causes, largest first for what a person feels in the lab

| Cause                                                                                                            | Owner                                                   | Size                                                                                                                                                                                                                                                                                      | In the real app?                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Live preview frames. The gallery is 10 to 16 full apps in one page.                                              | Lab                                                     | About 94% of the wait of the gallery. With the frame documents blocked, the gallery is usable after about 1 s in development and 0.5 s in the production form, against 9 to 19 s and 4 to 10 s with frames (the range is the machine load).                                               | No. The real app is one document.                                                      |
| The machine load from agent sessions, and agents that edit the lab source while a person uses the shared server. | This machine                                            | The same production page was usable after 0.4 s at a load of 22 to 47 and after 0.5 to 2.2 s at a load of 150 to 580. One saved source file makes each open document download the complete sheet and compute all styles again: 2.3 to 5.5 s of blocked main thread with the gallery open. | The mechanism yes, for one document: about 0.2 s. The factor of 10 to 16 documents no. |
| The development form of the tool stack: React development mode with StrictMode, and unbundled modules.           | Tool stack                                              | Script of one interaction is 3.8 to 5.7 times the production script. One preview is 363 requests and about 20 MB in development, against 104 requests in the production form.                                                                                                             | Yes, in development only.                                                              |
| The style cost for each element of the primitive layer.                                                          | Primitives                                              | 0.21 to 0.25 ms of style for each element at each full style calculation, with no throttle. CSS work is 42% to 71% of the main thread time of a page.                                                                                                                                     | Yes, in production too.                                                                |
| How many elements one change invalidates: the nav glider on the long list, and a `:has()` rule shape.            | Primitives, and the use of four gliders in the lab list | Arrow down in the review page: 88 ms to the next frame, 37 ms without the glider on the list. Scroll of 10 wheel steps: 848 ms of style and layout, 57 ms without it. With the CPU slowed 4 times: 450 ms against 162 ms.                                                                 | Yes. The real app has one glider in its list today, and 6 to 8 rules of the shape.     |
| Tailwind scanned the audit document and the design records of the lab.                                           | Lab                                                     | 10% of the sheet (44,747 bytes), and a full reload of each open document when an agent wrote one of those files.                                                                                                                                                                          | Small. `apps/web` scans 78 files outside `src`, which add 0 bytes.                     |
| A development server that ran for days.                                                                          | Tool stack                                              | Its sheet had 614,316 bytes. A new server gives 465,045 bytes with the fix below.                                                                                                                                                                                                         | Yes, in a long development session.                                                    |
| The plugin `freshStyles` of the lab.                                                                             | Lab                                                     | Not a cause. It is necessary for a new file, and its cost could not be measured.                                                                                                                                                                                                          | No.                                                                                    |

## The primitives: what costs time

Two mechanisms, from two lanes. They are not the same thing: the first is the cost of one element, and the second is the count of elements that one change touches.

### 1. Typed registered properties (`@property`) in `@ariakit/tailwind`

The layer, text, and frame utilities (`ak-layer*`, `ak-text`, `ak-ink-*`, `ak-frame*`) write registered custom properties with a type, and Chrome computes their formulas (`oklch(from ...)`, `calc()`, `clamp()`) as typed values for each element.

```css
/* node_modules/@ariakit/tailwind/src/output.css, line 1654 (one of 51 in lines 1547 to 2251) */
@property --_ak-lib {
  syntax: "<color>";
  inherits: false;
  initial-value: canvas;
}
```

Measured on the history page (1,116 elements, production form, CPU slowed 4 times, 5 runs of each in turns), style recalculation:

| Removed from the sheet                                | Style recalculation |
| ----------------------------------------------------- | ------------------- |
| Nothing                                               | 752 ms              |
| The 51 typed `@property` rules of `@ariakit/tailwind` | 313 ms              |
| The 30 `@property` rules of `ui.css`                  | 597 ms              |
| The 78 `@property` rules of Tailwind                  | 691 ms              |
| All 247 `@property` rules                             | 231 ms              |
| Each selector with `:has()`                           | No change           |
| Each size container                                   | No change           |
| Each style query                                      | 11% to 32% less     |

The page needs these rules: without them the layer colors and the frames are gone. So this is not a fix. It shows the place, and 56% to 69% is an upper limit of a gain. Nobody measured which of the 51 properties cost the most, or what a real change in the package would save.

### 2. A `:has()` rule shape, and the nav glider

One rule of this shape anywhere in the sheet makes Chrome invalidate the complete subtree of each `:has()` anchor, also when no element matches the rule:

```css
/* slow: a :has() compound, then a combinator, then * (also inside :is() or :not()) */
.zz-never:has(.qq-never) * {
  --zz: 1;
}
.zz-never:has(.qq-never) > * {
  --zz: 1;
}
.yy-never:is(.zz-never:has(.qq-never) *) {
  --zz: 1;
}
/* fast */
.zz-never:has(.qq-never) .yy-never {
  --zz: 1;
}
```

The nav glider makes the Nav root a `:has()` anchor (`ui-nav-glider-selected` in `styles/ui.css`, and `nav.ts`). The shape comes from `@custom-variant` blocks with `:has()` in `src/components/ariakit/styles/ui.css` (`ui-disabled-within`, `ui-field-disabled`, `ui-choice-on`, `ui-choice-disabled`), joined in the recipes with `**:`, `*:`, `group-…/name:`, and `not-…:` (`choice.ts`, `control.ts`, `input.ts`). The lab sheet has 23 rules of the shape, and the sheet of the real app has 8.

With one such rule, each change of the selected row computes 1,233 to 1,704 elements again. Without it, 167 to 607. Chrome names it in its own trace: "Invalidation set invalidates subtree" on `div.nav`.

Measured on the review page (production form, 5 runs in turns):

| Form                                                                  | Arrow down, next frame | Scroll of 10 wheel steps, style and layout |
| --------------------------------------------------------------------- | ---------------------- | ------------------------------------------ |
| As built                                                              | 88 ms                  | 848 ms                                     |
| No `glider` prop on the two Nav elements of the list                  | 37 ms                  | 57 ms                                      |
| The 10 class names of the shape removed from the recipes, glider kept | 41 ms                  | 355 ms                                     |
| Both                                                                  | 32 ms                  | not measured                               |

The removal of the 10 class names was a test of the gain. It changes the look of disabled and checked choice controls, so it is not a proposal. Nobody tested a rewrite of those states without `:has()` before a `*`.

One case has no fix yet: with all 24 folders of the list open (585 rows), arrow down needs about 400 ms also after both changes. The trace shows a `:has()` invalidation of the whole document from `body`. The rule that causes it was not found.

## The size of the file

- Counted: the built sheet of the lab had 474,725 bytes (66 KB gzip, 45 KB brotli), 3,022 rules, and no duplicate rule. The primitive recipes are 73% to 76% of it. That is a fixed cost: Tailwind reads each file of `src/components/ariakit/styles` as text and compiles each class of each variant, used or not. One Button alone adds about 119 KB.
- Counted: the real app has 332,367 bytes of different rules. Its build has 464,666 bytes because 581 rules are in it two times (audit finding FE-09). So the equal size of the two files was a coincidence.
- Measured: one page of the design uses 8% to 24% of the rules.
- The three checkers disagree about rules that match no element. A sheet with only the rules of the page gave: no stable effect (0.97 to 1.42 times in four sessions, CSS lane), the same first style and layout time (111 against 110 ms, run time lane), and 24% to 43% less style time (development lane). So the effect is between 0 and about 40% of the style time, and a quiet machine is necessary to settle it.

## What the lab did without need, and what changed

Done on 2026-10-07, after the investigation:

```css
/* apps/lab/src/styles.css */
@import "tailwindcss" source("./");
```

- Tailwind now scans only `src`. Before, it scanned the complete app folder with the audit document and the design records.
- The lab development server was started again. Its sheet went from 614,316 bytes to 465,045 bytes.
- A write to a document below `apps/lab/audit` or `apps/lab/docs` no longer reloads each open lab page (measured by two checkers on copies: 0 reload messages in 4 of 4 writes).

Not done, because each changes the lab or the settled design:

- **Pictures in place of live frames** in the gallery and the directions page. Live frames stay in the page explorer and the component explorer. Measured gain: the gallery is usable after about 1 s in development. It breaks the live theme and look change of the cards.
- **No glider on the long screenshot list**, or only after the rule shape is fixed in the primitive layer. The maintainer asked for the bar glider of that list in a note of round 1, so this is his choice.
- **A client entry without StrictMode** for a design session. It cuts the next frame by 18% to 38% in development and loses the StrictMode checks.
- **Fewer elements for each row** of the review list (29 elements for a changed row, against 5.4 in the real app today), and no `getBoundingClientRect` in an effect (`screenshot-list.tsx`, `use-row-fit.ts`: 12.5 ms for each key press in development).

To judge the speed of a design, use the production form: `pnpm --filter @visonaut/lab build`, then `vite preview` in `apps/lab`.

## What follows for the real app

- It will not be slow as the lab is. The largest factor, the frames, does not exist there.
- The file size is not a risk.
- The review page of the settled design is heavier than the review page of today. Load, production form: 1.4 to 1.65 s of main thread work and 1,740 elements, against 0.26 s and 705 elements for the run page of the real app today.
- As built, with the CPU slowed 4 times, the main keys are above the limit of 200 ms for a good interaction: arrow down 450 to 515 ms, approve 538 to 615 ms. Without the glider on the list: 162 ms and 260 ms.
- So, before the design goes into `apps/web`: fix the `:has()` rule shape in the Ariakit UI style layer or keep gliders off long lists, find the cause of the 400 ms with all folders open, and render long lists in parts.
- The cost of the typed registered properties stays for each element. Only a change in `@ariakit/tailwind` can lower it. That change would help each app that uses the package.
- Two small changes for `apps/web`: compile the sheet one time (FE-09), and `@import "tailwindcss" source(".")` in `apps/web/src/review.css`, which stops a page reload when `CHANGELOG.md`, a migration, or a tooling file changes.

A script, a log, and a patch file in the lane folders have the suffix `.txt` after their real extension, so that the lint and the formatter of the repository do not read them. The copies of the apps, the traces, and the pictures are not kept.
