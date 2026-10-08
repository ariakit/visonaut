# Notice (toast or inline) (notice)

Group: system
Question: Where and how should the app say what just happened?
Description: Feedback for a save, a refusal, a conflict, and a change under the page, shown in a workspace strip: one message and at most one action.
Layout: stack

## Scenarios

- `sending` (Sending): One decision is on its way; the browser is still needed.
- `queued` (Queued): Two decisions are queued on the server; the window can close, but they are not saved yet.
- `saved` (Saved): The server confirmed a decision on the screenshot with the longest name; Undo is available from now.
- `not-saved` (Not saved): The connection was lost: the verdict went back, later decisions are blocked, and Retry sends the same decision.
- `conflict` (Conflict): @nilsson-sofia rejected this variant 2 minutes ago, so the approval was not applied.
- `refused` (Refused): Shift+X on a screenshot with one read-only variant: nothing changed (today only a screen reader hears this).
- `replaced` (Newer run): Attempt 3 replaced this run while the tab was open; this run is read-only now.
- `complete` (All reviewed): The last decision is saved and nothing needs review; the next run is one key away.

## Variant `bar-slot`: Bar slot

One fixed-height slot inside the decision bar holds every message: an icon, at most six words, and one action.

Ideas:

- One place for all eight states, and the bar never changes height (contract map idea F, COPY-R4, WORK bar 1).
- Refusals and completion become visible (RULE-13, A11Y-17).
- Sending, queued, and saved keep three marks and three texts (rule I4).

Tradeoffs:

- On a phone the slot needs its own row.
- Messages are far from the image and from the variant that they concern.
- Long reasons must be cut to one line.

### Spec

```text
| Undo | ^  Sending 1…                        Reject X   Approve A |
| Undo | ~  2 queued · safe to close          Reject X   Approve A |
| Undo | v  Saved                             Reject X   Approve A |
| Undo | !  Not saved. Check your conn…   [Retry]  (decisions off) |
| Undo | #  Nothing changed. 1 variant is read-only. [One by one]  |
```

**Strip (all variants of this surface).** `Frame $border $rounded='xl'` with `relative flex h-56 flex-col overflow-clip`: a stage (`flex-1`, two wells with thumbnails of the `dialog` scene, `aria-hidden`) and the decision bar: `Frame $layer $lighten $p={2}` with `border-t flex items-center gap-2`: `Undo` (`Undo2` slot), a flexible middle, `Reject` with a `kbd` `X`, `Approve` (`$layer='brand'`) with a `kbd` `A`. Under a 30rem container the middle moves to its own row above the buttons.

**Build.** The middle is the slot: `div role='status'` with `flex min-w-0 flex-1 items-center gap-2 text-sm`: the icon in `Text $text`, `Text className='truncate'`, and an optional `Button $size='sm' $border`. Blocking states (`not-saved`, `conflict`, `replaced`): the slot is a `Frame $layer='danger' $mix={15} $rounded='lg' $forceRounded $p={2}` (`warning` for `replaced`) with `role='alert'`.

**Message map (all variants of this surface).**

| Scenario    | Icon                  | Text                                       | Action                           |
| ----------- | --------------------- | ------------------------------------------ | -------------------------------- |
| `sending`   | `ArrowUp`             | `Sending 1…`                               | none                             |
| `queued`    | `Cloud`               | `2 queued · safe to close`                 | none                             |
| `saved`     | `Check`               | `Saved`                                    | `Undo` (`⌘Z`)                    |
| `not-saved` | `TriangleAlert`       | `Not saved. Check your connection.`        | `Retry`; second `Reload`         |
| `conflict`  | `Users`               | `Changed by @nilsson-sofia 2 min ago`      | `Reload`                         |
| `refused`   | `Lock`                | `Nothing changed. 1 variant is read-only.` | `Review one by one`              |
| `replaced`  | `GitCommitHorizontal` | `A newer run replaced this one`            | `Open attempt 3`                 |
| `complete`  | `CircleCheck`         | `All reviewed · 22 approved, 2 rejected`   | `Next run` (`↵`); second `Queue` |

Words: 1 to 7.

**Behavior and keys.** `Saved` clears after 3 s. `Undo` is `disabled` until `Saved` (rule I5) and shows `⌘Z` in a `Tooltip`. Blocking states disable `Reject` and `Approve` and move focus to the action. `Esc` does nothing here. Tab order: Undo, action, Reject, Approve.

**Scenarios.** Each state shows its row of the map in the slot. `saved`: the slot adds the target when it fits: `Saved · Combobox with auto select… · React · Dark` (`truncate`). `refused`: the slot has the warning tint and `role='status'`; decisions stay on. `complete`: `Approve` becomes `Next run` with `↵`, and `Reject` becomes `Queue`.

## Variant `toast`: Toast

Messages rise from the bottom start corner as small cards: quiet ones leave by themselves, and blocking ones stay until an action.

Ideas:

- Feedback near the place of attention with no reserved row (WORK bar 6).
- One toast follows a decision through sending, queued, and saved; it does not stack three.
- Undo is offered only when the server has confirmed (rule I5).

Tradeoffs:

- A toast covers a corner of the image, which is the evidence.
- A timed message can be missed; the live region must repeat it.
- The primitives have no toast stack: this is a `div` with the popover recipe and local state.
- Rapid decisions (5 in 3 s) must merge into one toast with a count.

### Spec

```text
|                                                        |
| +-----------------------------+                        |
| | v  Saved              Undo  |       (stage)          |
| +-----------------------------+                        |
+--------------------------------------------------------+
| Undo                             Reject X   Approve A  |
```

**Strip.** As in `bar-slot`: an `h-56` frame with a stage and the decision bar.

**Build.**

- Region: `div role='region' aria-label='Notifications'` with `absolute bottom-16 start-3 grid w-80 max-w-[calc(100%-1.5rem)] gap-2`.
- Toast: a `div` with the `popover` recipe (`popover.jsx({ $p: 3, $rounded: 'xl', $shadow: 'md' })`) and `flex items-center gap-2 text-sm`: icon, `Text className='flex-1'`, action `Button $size='sm' $border`, dismiss `Button $size='sm' aria-label='Dismiss'` with an `X` slot. Quiet toasts have `role='status'`; blocking ones have `role='alert'` and `$layer='danger' $mix={15}` (`warning` for `replaced` and `refused`).

**Copy.** The message map in `bar-slot`. Words: 1 to 7.

**Behavior and keys.** At most 3 toasts, newest at the bottom. `sending`, `queued`, and `saved` update one toast. `Saved` leaves after 4 s; the timer stops on hover and on focus. Blocking toasts stay, disable `Reject` and `Approve`, and take focus on their action. Entry: 150 ms of opacity and a 4 px rise (`motion-reduce`: opacity only). `⌘Z` is Undo. `Esc` dismisses the focused toast. The region is the Tab stop before `Undo`.

**Scenarios.**

- `sending`, `queued`: one toast with the mark and the text; no action and no dismiss button.
- `saved`: `Saved` and `Undo`; a second line with the truncated target.
- `not-saved`: stays; `Retry` and `Reload`.
- `conflict`: stays; the reviewer avatar in place of the icon; `Reload`.
- `refused`: stays for 8 s; `Review one by one`.
- `replaced`: stays; `Open attempt 3`.
- `complete`: stays; `Next run` with `↵` and `Queue`.

## Variant `bar-takeover`: The bar is the message

Success lives inside the pressed button, and a blocking state replaces Reject and Approve with the only actions that are valid.

Ideas:

- The only possible actions are the only visible actions (WORK bar 5, RESIL idea 2 b).
- No message area exists in the normal case: the button says `Approved`.
- The bar color is the state: neutral, warning, danger, success.

Tradeoffs:

- Reject and Approve leave their place in a blocking state, so a fast second key press must do nothing.
- Sending and queued need a small text beside Undo to stay different (rule I4).
- A color field across the bar is loud.

### Spec

```text
sending   | Undo  ^ 1                     Reject X  [(o) Approve A] |
queued    | Undo  ~ 2 queued              Reject X   Approve A      |
saved     | Undo                          Reject X  [v Approved   ] |
not saved | !  Not saved. Check your connection.   [Retry] [Reload] |
replaced  | ~  A newer run replaced this one       [Open attempt 3] |
complete  | v  All reviewed · 22 approved, 2 rejected  [Next run ↵] |
```

**Strip.** As in `bar-slot`: an `h-56` frame with a stage and the decision bar.

**Build.**

- Bar: the `Frame` of the decision bar takes `$layer='danger'`, `'warning'`, or `'success'` with `$mix={15}` in the matching state, and `role='alert'` (`role='status'` for `complete`).
- Normal states: the pressed button's `ButtonLabel` reads `Approved` or `Rejected` with a `Check` slot for 800 ms. While it sends, the button has a `ProgressCircular` slot.
- Receipt beside `Undo`: `Text className='text-xs tabular-nums ak-ink-70'` with the mark and the text: `ArrowUp` `1`, `Cloud` `2 queued`. It has `role='status'`.
- Blocking states: one icon, one `Text className='flex-1 truncate'`, and one or two `Button $size='sm'` (the first with `$layer='brand'`). `Reject` and `Approve` are not rendered.

**Copy.** The message map in `bar-slot`; `Approved` and `Rejected` in the button. Words: 0 to 7.

**Behavior and keys.** `A` and `X` do nothing in a blocking state, and the live region says why. Focus moves to the first action. `Undo` is `disabled` until the server confirmed. `⌘Z` is Undo.

**Scenarios.**

- `sending`, `queued`, `saved`, `not-saved`, `replaced`, `complete`: as sketched.
- `conflict`: warning bar: avatar, `Changed by @nilsson-sofia 2 min ago`, `Reload`.
- `refused`: the bar keeps `Reject` and `Approve`; the place of the receipt shows `Lock` and `Nothing changed. 1 variant is read-only.` with the link `Review one by one`.

## Variant `status-line`: Status line

A permanent one-line bar at the bottom edge shows the last event on the start side and the key legend on the end side.

Ideas:

- A fixed home for the save state and for the keys, always in view (SHELL-C7).
- The decision bar holds buttons only.
- The same line can show the load count (`page-load` / `counted-line`).

Tradeoffs:

- 28 px of permanent chrome under the image.
- Small text at the screen edge is the least visible place for a failed save, so a blocking state tints the whole line and adds a button.
- On a phone the legend is hidden and the line holds the message only.

### Spec

```text
| Undo                                  Reject X   Approve A |
+------------------------------------------------------------+
| v Saved · 21 left          ↑↓ screenshot ←→ variant ? keys |
```

**Strip.** As in `bar-slot`: an `h-56` frame with a stage and the decision bar. This variant adds the line under the bar.

**Build.**

- Line: `Frame $layer $darken={0.5}` with `flex h-7 items-center gap-3 border-t px-3 text-xs`.
- Start: `div role='status'` with the icon and `Text className='truncate'`.
- End: `Text className='ak-ink-60 @max-2xl:hidden'` with `Kbd` pairs: `↑↓` screenshot, `←→` variant, `?` keys.
- Blocking state: the line takes `$layer='danger' $mix={20}` (`warning` for `replaced`), `role='alert'`, and one `Button $size='xs' $border` after the text. The legend hides.

**Copy.** The message map in `bar-slot`. Idle: `21 left`. Words: 1 to 7, plus the legend.

**Behavior and keys.** The line never appears or disappears. `Saved` returns to the idle text after 3 s. Blocking states disable `Reject` and `Approve` and move focus to the line button. `?` opens the key list. `⌘Z` is Undo, after the server confirmed.

**Scenarios.**

- `sending`: `Sending 1…`. `queued`: `2 queued · safe to close`.
- `saved`: `Saved · 21 left`; `Undo` in the bar becomes enabled.
- `not-saved`: danger line with `Retry`; a second link `Reload`.
- `conflict`: danger line: `Changed by @nilsson-sofia 2 min ago` and `Reload`.
- `refused`: warning line with `role='status'`: `Nothing changed. 1 variant is read-only.` and `Review one by one`.
- `replaced`: warning line and `Open attempt 3`.
- `complete`: success tint (`$layer='success' $mix={20}`): `All reviewed · 22 approved, 2 rejected` and `Next run` with `↵`.

## Variant `on-the-thing`: On the thing

Feedback appears on the object that changed: a mark on the variant chip, an avatar on a conflict, and a small popover anchored to what blocks.

Ideas:

- The normal path has no text at all: the chip takes the verdict mark.
- A message points at its cause: the read-only variant or the replaced run title.
- Three save states are three marks on the chip: ring, cloud, check (rule I4).
- Not proposed by the audit lanes.

Tradeoffs:

- Revisits rule A09 (text with color): the marks have shapes, tooltips, and live-region text, but no visible words on the normal path.
- A mark on a chip that scrolled out of view is not seen.
- An anchored popover needs its anchor on screen; with many variants the chip row must scroll to it.

### Spec

```text
 [v React·Dark] [(o) Solid·Dark] [~ Solid·Light] [o Vue·Dark]
     saved          sending          queued

 [# Solid·HC]  <--+---------------------------------+
                  | Nothing changed.                |
                  | 1 variant is read-only.         |
                  | [ Review one by one ]           |
                  +---------------------------------+
```

**Strip.** As in `bar-slot`, with a run title row and a variant row above the stage.

**Build.**

- Variant row: `Nav $layout='horizontal'` with `NavLink` chips. Each chip has a `NavSlot` mark: `Circle` needs review, `ProgressCircular` sending, `Cloud` queued, `Check` approved, `X` rejected, `Lock` read-only, `TriangleAlert` not saved. Each mark has an `aria-label` and a `Tooltip` with the text of the message map.
- Anchored message: `Popover portal` on the chip with `PopoverArrow`, `grid max-w-64 gap-2`, the text, and one `Button $size='sm'`. In the lab it is open in the cell.
- One hidden `role='status'` region repeats every change as a sentence.

**Copy.** The message map in `bar-slot`, in tooltips and popovers. Visible words on the normal path: 0.

**Behavior and keys.** A blocking popover takes focus on its action; `Esc` closes it and the mark stays. `⌘Z` is Undo, after the check mark shows.

**Scenarios.**

- `sending`: ring on the chip. `queued`: cloud on two chips. `saved`: check on the chip of the long-named screenshot.
- `not-saved`: the chip returns to `Circle` with a `TriangleAlert` overlay; popover `Not saved. Check your connection.` with `Retry`.
- `conflict`: the chip shows the avatar of @nilsson-sofia and the `X` mark; popover `Changed by @nilsson-sofia 2 min ago` with `Reload`.
- `refused`: as sketched; the read-only chip gets the `Lock` mark.
- `replaced`: the run title gets `Badge $layer='warning' $forceRounded` `Replaced`; popover on the title with `Open attempt 3`.
- `complete`: a `ProgressCircular value={1}` with a `Check` beside the run title; popover `All reviewed · 22 approved, 2 rejected` with `Next run` and `↵`.

## Variant `receipt-log`: Receipt log

The bar shows one counter of decisions in flight, and it opens a list of the reviewer's decisions with the state of each one.

Ideas:

- `Safe to close` becomes checkable: each decision has a row and a state (RESIL idea 7).
- Rapid decisions do not produce rapid messages: the counter changes.
- A failed or refused row jumps to its variant and offers the action there.

Tradeoffs:

- The detail is one click away, so a failed save must also tint the counter and open the list.
- Not in the app today: a list of the reviewer's decisions that survives a reload.
- More UI than a single maintainer may need.

### Spec

```text
| Undo  [ 2 pending · 1 not applied  ^ ]     Reject X  Approve A |
        +--------------------------------------+
        | Your decisions                       |
        | !  Actions menu · Dark   Not applied |
        |    Changed by @nilsson-sofia         |
        | ~  Tabs · Solid          Queued 12 s |
        | ^  Tabs · React          Sending     |
        | v  Dialog · Dark         Saved       |
        +--------------------------------------+
```

**Strip.** As in `bar-slot`: an `h-56` frame with a stage and the decision bar.

**Build.**

- Counter in the bar middle: `PopoverDisclosure $size='sm'` with a `ListChecks` slot, `ButtonLabel`, and a `ButtonSlot $kind='badge' $p='md' $layer='danger'` for rows that need attention. It has `role='status'` text for a screen reader.
- List: `Popover portal $p={2}` with `grid w-80 gap-1`: `PopoverHeading className='px-2 text-sm'`, then `ButtonGroup $layout='vertical' $p='none'` of `Button` rows (`ButtonSlot $kind='avatar'` with the state mark on a `$mix={20}` layer, `ButtonContent` with `ButtonLabel $truncate` and `ButtonDescription`, the state word in a trailing slot), with `ButtonGlider $state='hover'` and `ButtonGlider $state='focus'`. In the lab the list is open in the cell.

**Copy.** Counter: `1 sending` · `2 queued` · `Saved` · `1 not saved` · `1 not applied` · `All reviewed`. Heading `Your decisions`. Row states: `Sending` · `Queued 12 s` · `Saved` · `Not saved` · `Not applied`. Reasons from the message map in `bar-slot`. Words: 1 to 4 in the bar.

**Behavior and keys.** A blocking state tints the counter (`$text='danger'`), opens the list one time, and moves focus to the row. Enter on a row selects its variant. `Esc` closes the list. `⌘Z` is Undo for the newest saved row.

**Scenarios.**

- `sending`: counter `1 sending` with a ring. `queued`: `2 queued` with a `Cloud`; rows show the seconds.
- `saved`: counter `Saved` for 3 s, then `24 decisions`.
- `not-saved`: counter `1 not saved`; the row has `Retry`.
- `conflict`: counter `1 not applied`; the row reads `Changed by @nilsson-sofia`.
- `refused`: counter `Nothing changed`; the row reads `1 variant is read-only` with `Review one by one`.
- `replaced`: the counter becomes a warning `Button`: `Replaced · Open attempt 3`.
- `complete`: counter `All reviewed`; `Approve` becomes `Next run` with `↵`.
