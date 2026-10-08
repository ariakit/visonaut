# No access (no-access)

Group: system
Question: What should a signed-in person without write access see?
Description: The state after GitHub says no, in a 360 px cell: which account is signed in, who reviews, and the way forward.
Layout: row

## Scenarios

- `wrong-account` (Wrong account): A maintainer opened the Queue with a second account, @okafor-amara, that has no write access.
- `author` (Pull request author): The author of #4863 followed the check link; no access is the normal result for this person.
- `long-names` (Long names): A 39-character login and the 170-character title of #4819.
- `switching` (Switching account): After Use another account: the session ends and GitHub opens its account chooser.
- `same-account` (Same account again): GitHub returned the same account after a switch, so the state must not look like a loop.
- `check-failed` (Could not check): GitHub did not answer the permission check: this is not a denial, and Try again can help.

## Variant `one-sentence`: One sentence

The account, one sentence, and one button.

Ideas:

- The refused account is named, which no screen does today (DASH-17, PULL-18).
- The repository is named in place of `this repository` (DASH-14).
- One button set for all routes.

Tradeoffs:

- It does not tell an author that nothing is wrong (JOUR-04).
- No link back to the pull request unless the number is known.

### Spec

```text
 (AO) @okafor-amara
 No write access to ariakit/ariakit

 [ Use another account ]     Back to #4863 ↗
```

**Build.** Cell `w-[22.5rem] grid gap-3`. No frame.

- Account: `Badge $size='sm'` with `BadgeSlot $kind='avatar' $layer='brand'` (initials) and `BadgeLabel`.
- Sentence: `Text` rendered as `p`, `className='text-sm'`, `role='alert'`.
- `Button $lightnessOffset autoFocus` and a `Link` with `ArrowUpRight`, `flex items-center justify-between`.

**Copy.** `No write access to ariakit/ariakit` · `Use another account` · `Back to #4863`. Words: 11.

**Keys.** Enter on the focused button.

**Scenarios.**

- `wrong-account`: no back link (no target).
- `author`: as sketched.
- `long-names`: the login truncates in the badge (`max-w-full`, `$truncate` on the label); the link shows the number only.
- `switching`: button `disabled`, ring slot, `Signing out`.
- `same-account`: sentence `GitHub signed you in as @okafor-amara again`; the button becomes a link `Switch account on github.com` with `ArrowUpRight`.
- `check-failed`: sentence `Could not check your GitHub access`; button `Try again`; `Error ID` with `req_01JZ8Q2N5K` in `Code`. No account button.

## Variant `who-reviews`: Maintainers review

A card that says who acts: the heading names the maintainers, and the first action goes back to the pull request.

Ideas:

- For an author this is an answer, not an error (JOUR-04, audit idea A1).
- The primary action is the way back; switching the account is second.
- The account badge shows which login was refused.

Tradeoffs:

- Not in the API today: the pull request number in a 403 answer.
- About 22 words.
- Two card forms (author, wrong account) must stay in step.

### Spec

```text
+----------------------------------------+
| (AO) Signed in as @okafor-amara        |
| Maintainers review #4863               |
| This account has no write access to    |
| ariakit/ariakit. You do not need to    |
| do anything.                           |
| [ Back to #4863 ↗ ] [Use another acc.] |
+----------------------------------------+
```

**Build.**

- Card: `Frame $lighten $border $rounded='2xl' $p='1.25rem'` rendered as `section`, `grid w-[22.5rem] gap-3`.
- `Badge` with an avatar slot: `Signed in as @okafor-amara`.
- `Heading className='mt-0 mb-0 text-lg'`; `Text` rendered as `p`, `className='ak-ink-70 text-sm'`.
- Actions: `Button $layer='brand' autoFocus` rendered as a link to the pull request (`ArrowUpRight` slot) and `Button $border` `Use another account`; `flex flex-wrap gap-2`.

**Copy.** `Maintainers review #4863` · `This account has no write access to ariakit/ariakit. You do not need to do anything.` · `Back to #4863` · `Use another account`. Words: 22.

**Keys.** Enter on the focused first action.

**Scenarios.**

- `wrong-account`: heading `No access to ariakit/ariakit`; no second sentence; `Use another account` is the brand button.
- `author`: as sketched.
- `long-names`: the badge label truncates; the heading keeps the number only.
- `switching`: the account button is `disabled` with a ring, `Signing out`.
- `same-account`: text `GitHub signed you in as @okafor-amara again. Switch the account on github.com first.`; link button `Open github.com`.
- `check-failed`: a warning card (`$layer='warning' $mix={12} $edge='warning'`): heading `Could not check your access`; text `GitHub did not answer.`; `Try again`; `Error ID`.

## Variant `account-chooser`: Account chooser

The state is drawn as an account list: the refused account is a disabled row, and the next row adds another account.

Ideas:

- It reads as a choice, not as an error.
- The refused login and the reason sit in the row where the eye looks for an account.
- The same list is the natural place for `same account again`.
- Not proposed by the audit lanes.

Tradeoffs:

- It suggests several stored accounts; the app has one session.
- An author has nothing to choose; the list is of little use to that person.
- It depends on GitHub showing its chooser (`prompt=select_account`, DASH-16, not verified).

### Spec

```text
 Choose an account for ariakit/ariakit
+----------------------------------------+
| (AO) @okafor-amara                 (#) |
|      No write access                   |
+----------------------------------------+
| (+)  Use another account           ->  |
+----------------------------------------+
 Back to #4863 ↗
```

**Build.** `grid w-[22.5rem] gap-2`.

- Label: `Text className='ak-ink-70 text-sm'` with an `id` that names the group.
- List: `ButtonGroup $layout='vertical' $border $p={1} $rounded='xl'` with `aria-labelledby`.
- Row 1: `Button disabled className='w-full justify-start text-start'` with `ButtonSlot $kind='avatar' $rowSpan={2}`, `ButtonContent` (`ButtonLabel $truncate`, `ButtonDescription`), and a `Lock` slot.
- Row 2: `Button autoFocus` with a `Plus` slot, `ButtonLabel`, and an `ArrowRight` slot. `ButtonGlider $state='hover'` and `ButtonGlider $state='focus'`.
- `Link` with `ArrowUpRight` below.

**Copy.** `Choose an account for ariakit/ariakit` · `No write access` · `Use another account` · `Back to #4863`. Words: 14.

**Keys.** Enter on the focused row opens GitHub. Tab reaches the back link.

**Scenarios.**

- `wrong-account`: no back link.
- `author`: as sketched.
- `long-names`: the login truncates.
- `switching`: row 2 is `disabled` with a ring: `Opening GitHub`.
- `same-account`: row 1 description `No write access · signed in again`; row 2 `Switch account on github.com` with `ArrowUpRight`.
- `check-failed`: row 1 description `Access not checked` with a `TriangleAlert` slot; row 2 `Try again` with `RotateCw`; `Error ID` under the list.

## Variant `author-summary`: Summary for the author

A person without write access sees what waits for a maintainer: the state and the counts, with no images and no decisions.

Ideas:

- The author can answer `did I mean to change this?` before a maintainer spends time (audit idea A2).
- The page explains the red check in the product's own words.
- Copy review link gives the author the next step.

Tradeoffs:

- Changes the access contract: today labels, verdicts, and counts are private to maintainers (issue 1 and D25). A maintainer decision is needed.
- Not in the API today: counts for a person without write access.
- Screenshot names stay hidden, so the summary is thin.

### Spec

```text
+----------------------------------------+
| #4863 · Needs review                   |
| 24 changes wait for a maintainer       |
| [#######.................]  16 of 40   |
|                                        |
| [ Copy review link ]   Back to #4863 ↗ |
+----------------------------------------+
 (AO) @okafor-amara · no write access · Switch
```

**Build.** `grid w-[22.5rem] gap-2`.

- Card: `Frame $lighten $border $rounded='2xl' $p='1.25rem'`, `grid gap-3`.
- Line 1: `Text className='font-medium tabular-nums'` and `Badge $layer='warning' $forceRounded` with a `CircleAlert` slot.
- Line 2: `Text className='text-sm'`. Line 3: `Progress value` (`aria-label='Reviewed'`) and `Text className='ak-ink-60 text-xs tabular-nums'`.
- Actions: `Button $lightnessOffset autoFocus` (`Copy` slot; label `Copied` for 2 s, announced in a `role='status'`) and `Link` with `ArrowUpRight`.
- Account line under the card: `Text className='ak-ink-60 text-xs'` with a `Link` rendered as `button` for `Switch`.

**Copy.** `Needs review` · `24 changes wait for a maintainer` · `16 of 40` · `Copy review link` · `Back to #4863` · `no write access` · `Switch`. Words: 18.

**Keys.** Enter on the focused button copies the link.

**Scenarios.**

- `wrong-account`: no target, so no summary: the layout of `one-sentence`.
- `author`: as sketched.
- `long-names`: the title is not shown; the login truncates.
- `switching`: the `Switch` link reads `Signing out…`.
- `same-account`: account line `signed in again as @okafor-amara · Switch on github.com`.
- `check-failed`: card text `Could not check your GitHub access`, `Try again`, `Error ID`; no counts.

## Variant `ask-maintainer`: Ask a maintainer

The state gives the author the real next step: copy a ready sentence with the review link for a maintainer.

Ideas:

- The contributing guide tells the author to ask a maintainer; this makes that one click.
- Nothing private is shown, so the access contract stays as it is.
- The action is first; the words about access are second.
- Not proposed by the audit lanes.

Tradeoffs:

- It is useless for a maintainer on the wrong account; that case falls back to the account button.
- A copied sentence can add noise to a pull request that maintainers already watch.
- Not in the API today: the pull request number in a 403 answer.

### Spec

```text
 Visual changes in #4863 wait for a maintainer

 +--------------------------------------+
 | Visual changes are ready for review: |
 | visonaut.com/pulls/4863              |
 +--------------------------------------+
 [ Copy for the pull request ]  Back to #4863 ↗

 (AO) @okafor-amara has no write access · Switch
```

**Build.** `grid w-[22.5rem] gap-3`.

- `Heading className='mt-0 mb-0 text-base'`.
- Quote: `Frame $darken $border $rounded='lg' $p={3}` with `Text className='font-mono text-xs'`; the text can be selected.
- `Button $layer='brand' autoFocus` (`Copy` slot; label `Copied` for 2 s, announced in a `role='status'`) and a `Link` with `ArrowUpRight`.
- Account line: `Text className='ak-ink-60 text-xs'` with a `Link` rendered as `button`.

**Copy.** `Visual changes in #4863 wait for a maintainer` · `Visual changes are ready for review: visonaut.com/pulls/4863` · `Copy for the pull request` · `Back to #4863` · `@okafor-amara has no write access` · `Switch`. Words: 24.

**Keys.** Enter on the focused button copies the sentence.

**Scenarios.**

- `wrong-account`: no target: heading `No write access to ariakit/ariakit`, no quote, brand button `Use another account`.
- `author`: as sketched.
- `long-names`: the heading keeps the number only; the login truncates.
- `switching`: the `Switch` link reads `Signing out…`.
- `same-account`: account line `GitHub signed you in as @okafor-amara again · Switch on github.com`.
- `check-failed`: heading `Could not check your GitHub access`; `Try again`; `Error ID`; no quote.
