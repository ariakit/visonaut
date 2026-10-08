Skill loaded: ariakit-general-workflow (the remote is github.com/ariakit/visonaut; no repository-specific workflow skill is installed). No file was edited. Scratch screenshots: /Users/diegohaz/.claude/jobs/f65a6229/tmp/design/scratch/workspace-parts/.

SURFACES. The starting list had nine entries. Seven surfaces remain after two merges. (1) Save status is part of `decision-bar`: the contract lane treats both as one group (G11), the measured defects are in the bar (WORK-03, WORK-10, RULE-13), and each bar shape has a natural place for save feedback. Each bar spec names its feedback part, so the maintainer can ask for a mix in the notes field. (2) The review complete state is part of `review-progress`: it is the end of the same counter, and each page direction also renders the `passed` scenario.

RULES FOR EVERY VARIANT (each one fixes a measured defect).

1. No state adds or removes a row. Status text has a reserved slot or floats (WORK-03, WORK-07).
2. Every variant of a screenshot shows its verdict mark (WORK-04). A mark is a shape plus a color, and the words are in the accessible name (A09).
3. The selected thing is always on screen and has a fill or an edge that works in light. Never `$lighten` alone (WORK-02, WORK-21).
4. A disabled Approve has no brand fill: `$layer={can.approve ? 'brand' : undefined}` (WORK-06).
5. Review keys work after a pointer click on any control. Do not add a control to the shortcut exclusions (WORK-01). Each control group is one Tab stop (WORK-29).
6. Key hints use `Kbd` or a slot with `$kind='shortcut'`. They hide when shortcuts are off and when the pointer is coarse (WORK-19, WORK-26).
7. Counts use changes as the unit (changed, added, removed variants). Unchanged variants never count as progress (WORK-14).
8. `Sending`, `Queued`, and `Saved` stay different, and Undo is enabled only after the server confirms (invariants I4 and I5).
9. Text is `text-xs`, `text-sm`, or `text-base`. Soft text uses `ak-ink-*`. Numbers use `tabular-nums`. Colors come from `$layer`, `$mix`, and `$text` only.

MARK SET (lucide, inside `Text $text`): `Circle` warning = Needs review. `Check` success = Approved. `X` danger = Rejected. `Plus` success = Added. `Minus` danger = Removed. `Equal` ink 50 = Unchanged. `TriangleAlert` danger = Failed. `LoaderCircle` (spin) = Comparing. Framework and browser marks: `src/fixtures/icons` (react, solid, chrome, firefox, safari). Scheme: `Sun`, `Moon`. Forced colors and more contrast are printed as words, not as icons.

COPY (ui-copy terminology). screenshot (not item), variant, change, baseline, current, diff, approve, reject, Auto-approved, Needs review, decision, read-only, Queue, Error ID. These words replace contract strings and need approval (RULE-26): `Accepted`, `Accepted automatically`, `N of M need review` (here `N left`), `Removed, no new image`.

REAL DATA (census of the production run, audit/gap-real-data/census/census.out.txt). 626 screenshots, 3,832 variants. 83.5% of screenshots have six variants: Chromium, Firefox, WebKit by Light, Dark. 9.3% have four, 5.4% have twelve, one has 24. The framework changes inside 0.2% of screenshots. The name is the key: median 37 characters, maximum 68, three path segments in 86% of keys, 26 families (first segment). The lab axes have no viewport axis (desktop, mobile, wide, narrow); production has one.

KEYS. All variants use key map A of the contract lane (arrows, `1` to `6`, `A`, `X`, `Shift+A`, `Shift+X`, `S`, `D`, `F`, `G`, `Cmd/Ctrl+Z`) plus `?` for help and `/` for search (map B). `R` is not Reject. Lab-only keys are named where a variant uses them. In a component cell, pass `scope` to `useReviewShortcuts`, because several variants share one document.

DATA FOR BUILDERS. Put shared scenario data in `src/explorations/components/<surface>/scenarios.ts` (the registry glob reads only `*.tsx`, so a `.ts` file is not a variant). Use `useReviewSession` where a fixture run fits, and plain constants where the hook has no state: queued, conflict, the GitHub check confirmation, and the diff fingerprint do not exist in the hook. `long-names` rows (name = key): `ariakit-ui-combobox/page/combobox-select-content-conditional-content`, `ariakit-ui-combobox/narrow-list/popover-with-long-option-labels`, `ariakit-ui-list/forced-colors/page/list-disclosure-optional-button`, `ariakit-ui-button/page/empty-false-and-unknown-current-values`, `ariakit-tailwind-7466/applied-light-week-hover`, `ariakit-ui-kbd/page/sizes` (rows 1, 3, 4, 5 are real production keys). Build the variant sets of the `variant-switcher` scenarios with `getScreenshotSet` and the `dialog` scene. A `row` surface renders at its natural size, so each variant sets its own width (`w-80`). A `stack` cell is a size container: use `@container` queries, and for a `narrow` or `touch` scenario wrap the variant in a box 390 px wide.

REOPENED DECISIONS (also marked in the tradeoffs): U03 and contract:192 (variant links with a bar glider) by every switcher except `link-strip`; A11 (thumbnail rule) by `thumbnail`; A12 and D29 (declared order) by the sort in `facets`; D02 (item as the unit) is not reopened by any variant; K11 by the armed two-step in `header-actions`; U02 placement by every bar except `header-actions`; the instruction against a hotkey registry by `jump` and `command-list`.
