# Sign-in step (sign-in-card)

Group: system
Question: What should a signed-out person see?
Description: The one step between a link and the app, in a 360 px cell: the target, the access rule, and one button.
Layout: row

## Scenarios

- `home` (Guest): Opened visonaut.com without a session and without a target.
- `deep-link` (From a check): Opened the review link of #4863 from a GitHub check; the target is known.
- `long-target` (Long title): The target is #4819 with a 170-character title that may take two lines at most.
- `opening` (Opening GitHub): After the click, while the browser leaves for GitHub.
- `failed` (Sign-in failed): GitHub access was cancelled or the sign-in did not start; the step keeps the target.
- `rate-limited` (Too many tries): The service asks for a wait of 8 s before the next try.
- `session-ended` (Session ended): The session ended during a review, and 3 decisions are held in the tab.

## Variant `one-button`: One button

The mark, one button, and one line with the access rule; no card and no heading.

Ideas:

- Nine words in place of 34 (DASH-15).
- The button has focus, so Enter signs in.
- Errors and waits change the button and the line in place; nothing is added.

Tradeoffs:

- The target is not named, so a maintainer does not see which review the sign-in is for (JOUR-10).
- No way back to GitHub on the step.

### Spec

```text
               (o) visonaut

   [ ->  Sign in with GitHub          ↵ ]
     Needs write access to ariakit/ariakit
```

**Build.** Cell `w-[22.5rem] min-h-[20rem] grid place-content-center justify-items-center gap-4`. No frame.

- Mark: `Aperture` in `Text $text='brand'` and `Text className='font-medium'`.
- `Button $layer='brand' $size='lg' autoFocus className='w-full'` with `ButtonSlot` (`LogIn`), `ButtonLabel`, and `ButtonSlot $kind='shortcut'` with a `kbd` `↵`.
- Rule: `Text className='ak-ink-60 text-sm'`.

**Copy.** `Sign in with GitHub` · `Needs write access to ariakit/ariakit`. Words: 9.

**Keys.** Enter or Space on the focused button. No other key.

**Scenarios.**

- `home`, `deep-link`, `long-target`: as sketched. The return path keeps the link.
- `opening`: button `disabled`, a `ProgressCircular` slot in place of the icon, label `Opening GitHub`.
- `failed`: the rule line becomes `Text $text='danger' role='alert'`: `Sign-in failed. Try again.` The button keeps focus.
- `rate-limited`: button `disabled`, label `Try again in 8 s` (`tabular-nums`, counts down, then the first label).
- `session-ended`: line `Session ended. 3 decisions are held in this tab.`; button `Sign in again`.

## Variant `named-target`: Named target

A card that names the review, the repository, and the rule, with a way back to GitHub.

Ideas:

- The heading answers which review the sign-in is for (JOUR-10, audit idea A3).
- One sentence for all three routes (COPY-R8, SHELL-C6, PULL-P6).
- A person without access can stop here, before the GitHub grant (JOUR-04).

Tradeoffs:

- Not in the API today: a 401 answer cannot name the pull request; the number must come from the link or from a new field.
- About 16 words, the most of the static variants.
- A title in an answer without a session is a read of private data; the product may show the number only.

### Spec

```text
+----------------------------------------+
| ariakit/ariakit                        |
| Sign in to review #4863                |
| Migrate component examples to the new  |
| style recipes                          |
|                                        |
| [ -> Sign in with GitHub            ↵ ]|
| Needs write access    Back to GitHub ↗ |
+----------------------------------------+
```

**Build.**

- Card: `Frame $lighten $border $rounded='2xl' $p='1.25rem'` rendered as `section` with `aria-labelledby`, `grid w-[22.5rem] gap-3`.
- Eyebrow: `Text className='ak-ink-60 text-sm'`. Heading: `Heading className='mt-0 mb-0 text-lg'`. Title: `Text className='ak-ink-70 text-sm line-clamp-2'`.
- Button as in `one-button`: brand, full width, `autoFocus`, `LogIn` slot, `kbd` `↵`.
- Footer: `Text className='ak-ink-60 text-xs'` and `Link` with `ArrowUpRight`, `flex justify-between`.

**Copy.** `Sign in to review #4863` · `Sign in with GitHub` · `Needs write access` · `Back to GitHub`. Words: 12 to 16.

**Keys.** Enter on the focused button. Tab reaches the back link.

**Scenarios.**

- `home`: heading `Sign in to Visonaut`; no title line and no back link.
- `deep-link`: as sketched.
- `long-target`: the title clamps at two lines with an ellipsis; the full title is the `title` attribute.
- `opening`: button `disabled`, ring slot, `Opening GitHub`.
- `failed`: a `Frame $layer='danger' $mix={12} $border $edge='danger' $rounded='lg' $p={2} role='alert'` above the button: `Sign-in failed. Try again.`
- `rate-limited`: button `disabled`, `Try again in 8 s`.
- `session-ended`: heading `Session ended`; title line `3 decisions are held in this tab`; button `Sign in again`; no back link.

## Variant `straight-through`: Straight through

A check link goes to GitHub by itself after a 1.5 s ring that can be cancelled; the button shows only when something needs a person.

Ideas:

- A maintainer who clicked a check already said what they want (DASH-15 alternative 2, audit idea A3 b).
- Three words on the normal path.
- Home never redirects by itself: there is no intent to follow.
- A tab that holds decisions never redirects by itself.

Tradeoffs:

- Reopens D25 and the evidence-plan line that the signed-out root offers GitHub sign-in (contract map group G17).
- Must stay off in preview (O11).
- A person without access reaches the GitHub grant with no warning (JOUR-04).
- A cancelled redirect must be remembered for the tab, or it loops.

### Spec

```text
               ( (o) )      the ring fills in 1.5 s
           Opening GitHub…
               Cancel
```

**Build.** Cell `w-[22.5rem] min-h-[20rem] grid place-content-center justify-items-center gap-3`.

- Ring: `ProgressCircular value` from 0 to 1 over 1.5 s in a `size-12` box, with the `Aperture` mark as its child; `aria-label='Opening GitHub'`.
- `Text className='text-sm'` and `Link` rendered as `button` for `Cancel`.
- Fallback layout: the `one-button` variant.

**Copy.** `Opening GitHub…` · `Cancel`. Words: 3.

**Behavior and keys.** The redirect starts when the ring is full. `Cancel` or `Esc` stops it and shows the `one-button` layout; the choice is kept in `sessionStorage`. Reduced motion: the text and a 1.5 s wait, no ring motion.

**Scenarios.**

- `home`: no automatic start: the `one-button` layout.
- `deep-link`, `long-target`: the ring, then the redirect. The target is not shown.
- `opening`: the ring is full and becomes an indeterminate ring; `Cancel` is gone.
- `failed`: the `one-button` layout with `Sign-in failed. Try again.`; no automatic retry.
- `rate-limited`: the `one-button` layout, `Try again in 8 s`.
- `session-ended`: the `one-button` layout: `Session ended. 3 decisions are held in this tab.` and `Sign in again`, which opens GitHub in a new window so that the tab keeps the decisions.

## Variant `door`: Page behind the door

The dimmed skeleton of the target page fills the cell, and the sign-in is a bar docked where the decision bar will be.

Ideas:

- The page says that the link is right and what waits behind it, without one private fact.
- The bar sits where the reviewer's hands will work next.
- A session that ends during a review keeps the real workspace behind the bar (RESIL idea 4 b).
- The guest form with a skeleton is not in the audit lanes.

Tradeoffs:

- A skeleton that never loads can read as a stuck page; it must be still and dim.
- The skeleton says nothing true about the run; it is decoration.
- The bar is small on a large screen.

### Spec

```text
+----------------------------------------+
| (o) / [========]                       |
| [=====]   +-----------+ +-----------+  |
| [===]     |           | |           |  |
| [======]  +-----------+ +-----------+  |
+----------------------------------------+
| (o) Sign in to review #4863            |
| [ -> Sign in with GitHub            ↵ ]|
| Needs write access to ariakit/ariakit  |
+----------------------------------------+
```

**Build.** Cell `w-[22.5rem] h-[24rem]`: a `Frame $border $rounded='xl'` with `overflow-clip flex flex-col`.

- Back (`flex-1`): a static skeleton of the target (the geometry of `skeleton` / `still-blocks`, `opacity-50`, `aria-hidden`, `inert`). A run link shows the workspace. Home shows Queue rows.
- Bar: `Frame $layer $lighten $p='1rem'` with `border-t`, rendered as `section aria-label='Sign in'`, `grid gap-2`. Mark and `Text className='font-medium text-sm'`; the brand `Button` (`autoFocus`, full width, `LogIn` slot, `kbd` `↵`); rule line `Text className='ak-ink-60 text-xs'`.

**Copy.** `Sign in to review #4863` · `Sign in with GitHub` · `Needs write access to ariakit/ariakit`. Words: 14.

**Keys.** Enter on the focused button. The back is `inert`, so Tab stays in the bar.

**Scenarios.**

- `home`: Queue skeleton; bar text `Sign in to Visonaut`.
- `deep-link`: as sketched.
- `long-target`: the bar shows the number only; the title is not shown.
- `opening`: button `disabled`, ring slot, `Opening GitHub`.
- `failed`: the rule line becomes the danger text `Sign-in failed. Try again.` with `role='alert'`.
- `rate-limited`: `Try again in 8 s`.
- `session-ended`: the back is the real workspace of the `changes` run, dimmed and `inert`. Bar: `Session ended · 3 decisions held` and `Sign in again`.

## Variant `split-preview`: Picture and button

A sample screenshot pair with a slow swipe sits above the button: the product shown, not described.

Ideas:

- Image-first: a divider that moves over a baseline and a current image says what the tool does with no slogan (DASH-C7 split).
- Sample art only, never data of a run.
- The pointer can drag the divider: the first interaction is the product's own.

Tradeoffs:

- Decoration on a step that most maintainers pass in one second.
- Motion on a sign-in step; it stops for reduced motion.
- It shows the swipe technique, which the viewer may not get.

### Spec

```text
+----------------------------------------+
| Baseline         ||           Current  |
|     [ sample button screenshot ]       |
+----------------------------------------+
  (o) visonaut
  [ ->  Sign in with GitHub            ↵ ]
  Needs write access to ariakit/ariakit
```

**Build.** Cell `w-[22.5rem] grid gap-4`.

- Picture: `Frame $darken $border $rounded='xl'` with `relative overflow-clip aspect-[8/3]`, `aria-hidden`. `getScreenshotSet({ scene: 'button', scheme })`: `baseline` below, `current` above with `clip-path: inset(0 0 0 var(--x))`. Divider: `Frame $layer='brand'` with `absolute inset-y-0 w-0.5` at `--x`. Captions: two `Badge $forceRounded` at the top corners.
- `--x` moves from 30 % to 70 % and back in 6 s (`motion-reduce`: fixed at 50 %). A pointer drag sets it and stops the motion.
- Below: mark, brand `Button` (`autoFocus`, full width, `LogIn` slot, `kbd` `↵`), rule line `Text className='ak-ink-60 text-sm'`.

**Copy.** `Baseline` · `Current` · `Sign in with GitHub` · `Needs write access to ariakit/ariakit`. Words: 11.

**Keys.** Enter on the focused button. The picture is not a Tab stop.

**Scenarios.**

- `home`: as sketched.
- `deep-link`, `long-target`: one line above the button: `To review #4863` (`ak-ink-70 text-sm`); the title is not shown.
- `opening`: the divider stops; button `disabled`, `Opening GitHub`.
- `failed`: danger line `Sign-in failed. Try again.` with `role='alert'`.
- `rate-limited`: `Try again in 8 s`.
- `session-ended`: no picture: the `one-button` layout with the line `Session ended. 3 decisions are held in this tab.` and `Sign in again`.
