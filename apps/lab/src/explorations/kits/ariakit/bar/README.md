# Bar (folio kit)

The one bar of the review stage. It merges three picks of round 1: the decision bar "Floating pill", the viewer toolbar "Merged bar", and the notice "The bar is the message". It is a pill that floats over the stage: round 2 settled that (UI-STAGE-BAR), and the docked bar is no longer in the lab. The reference surface `notice` (Bar states) forces each state that a page scenario does not reach, over the kit stage.

```tsx
const stored = useStoredView();
const view = useStageView({ variant, mode: stored.mode });

// The pill lays itself over the nearest positioned element.
<div className="relative flex min-h-0 flex-1">
  <ReviewStage
    variant={variant}
    item={item}
    view={view}
    mode={stored.mode}
    mask={stored.mask}
    gutterBottom={4}
    className="flex-1"
  />
  <ReviewBar session={session} view={view} stored={stored} ready={!view.images.failed} />
</div>;
```

## Exports

| File                | Export                                                      | Use                                                           |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| `bar.tsx`           | `ReviewBar`                                                 | The bar                                                       |
| `message.ts`        | `getBarMessage`, `BarMessage`, and one function per message | The message that a session asks for, and the forced messages  |
| `run-approval.tsx`  | `RunApprovalDialog`, `getRunApproval`, `useOpenedChanges`   | The confirmation of `Approve the run…` and its numbers        |
| `view-controls.tsx` | `viewModes`, `canShowMode`, `getShownMode`                  | The five modes with their keys, and what a variant can show   |
| `receipt.ts`        | `useReceipt`                                                | Which control the last decision came from, and its save state |
| `zoom.tsx`          | `ZoomControl`                                               | The zoom control alone                                        |

## Props of `ReviewBar`

| Prop          | Meaning                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `session`     | The ready review session                                                                                           |
| `view`        | The `StageView` of `useStageView`: the zoom and the regions                                                        |
| `stored`      | The `StoredView` of `useStoredView`: the mode and the mask switch                                                  |
| `cover`       | The cover shows: the bar has Undo, the mask switch, `Reject all 6`, `Approve all 6`, and the menu                  |
| `message`     | The message of the bar. The default is `getBarMessage(session)`. Pass one to force a state, or null for none       |
| `ready`       | False while the images of the selected variant are not on screen, or after one failed: Reject and Approve are off  |
| `receipt`     | The save feedback. The default is the receipt of the last decision of the session. Pass one for a still save state |
| `onResetView` | What `Reset the stored view` of the lab menu does. The default is `resetStoredView`                                |

## Rules of the bar

- **One order.** Undo, the five modes, the mask switch, the zoom, the region stepper, Reject, Approve, and the `⋯` menu.
- **The pressed button is the save feedback** (D-RES-02). A ring while the receipt is not final, then `Approved` or `Rejected` with a check for 800 ms. `Saving…` is the tooltip of that button and the text of the live region. More than one waiting decision shows its count in the place of the key. Undo shows the ring too.
- **A whole screenshot shows its count** (D-WORK-06). After `⇧A`, `⇧X`, a menu item, or a run approval, the button of that verdict reads `6 approved`, until the next selection or the next decision. Undo is enabled beside it.
- **A verdict is a state.** On a variant that a person decided, the button of that verdict is pressed, in the tint of its color, and the other button changes the verdict.
- **The bar keeps its width.** Reject and Approve have the width of their widest content, the region stepper is always there, and each number has a fixed room. So the two buttons stay in one place from variant to variant. The stepper is off for a variant without a region.
- **Modes are buttons, not radios.** A radio group keeps the arrow keys, and they belong to the list and the variants. The mode on screen has `aria-current`, which is the state that the stock glider follows. The mask is a switch (`role="switch"`).
- **No key of its own.** The page binds the keys and calls `stored.setMode`, `stored.setMask`, and the session. The bar prints `X` and `A` in the buttons, `⇧A` and `⇧X` in the menu rows, and every other key in a tooltip.
- **The pill fades** to 45% after 3 s without input in the document, and a pointer move, a focus, or a key brings it back. The keyboard focus on one of its controls holds it, and the focus that a click leaves on a button does not. It does not fade while a decision saves, while a message has the bar, while a menu of the bar is open, or with reduced motion. A run that takes no decision is at rest, so its pill fades too.
- **Two rows below 57rem.** The bar is its own size container. The pill measures the element that it lies over, so that element must be the stage. The first row has the view controls, and the second has Undo and the decisions. The pill is 874 px wide, so in one row it has 19 px or more at each side.

## Messages

A message is one value (`BarMessage`). `getBarMessage(session)` builds it from the session, and each function below builds one for a state that the session of the lab does not have.

| Function              | Bar                                                                                             | Tint    |
| --------------------- | ----------------------------------------------------------------------------------------------- | ------- |
| `getNotSavedMessage`  | `Not saved. Check your connection.` with `Reload` and `Retry`                                   | danger  |
| `getConflictMessage`  | `Conflict. Kenji Mori rejected this variant. Your approval was not saved.` with `Reload`        | warning |
| `getRefusedMessage`   | `Nothing changed. 1 variant is read-only.` with `Review one by one`                             | warning |
| `getReplacedMessage`  | `A newer run replaced this one` with `Open attempt 3`                                           | warning |
| `getReadOnlyMessage`  | The view controls, then `Read-only` with its reason as the tooltip, and `Open newer run`        | none    |
| `getComparingMessage` | The view controls, then `Comparing 2,342 of 3,832` with a progress bar (numbers only with data) | none    |

- The first four take the bar over: the tint, the words, and the only valid actions. The last two keep the view controls.
- A tint is a mix with the surface behind it. The well is too dark for that, so the tinted pill keeps its raised surface under the tint, in both themes.
- The conflict texts are the texts of the option `stored-name` of the audit decision D-RES-05. Without a stored name the subject is `Another reviewer`, and for the person's own second tab it is `You already`.
- `getBarMessage` maps the six read-only kinds of the session: `superseded` gets `Open newer run`, `comparing` gets the progress, and `archived`, `expired`, `failed`, and `stale` get `Read-only` with no action.

## The run approval

`Approve the run…` of the menu follows the option `approve-run` of the audit decision D-WORK-04: no key, a confirmation, ordinary decisions, and one Undo. The dialog names the number of changes with no decision, how many of them were never the selected variant in this document, and how many rejected variants stay rejected. Cancel has the focus. `ReviewBar` records the opened changes itself (`useOpenedChanges`), so the page passes nothing.

## Pitfalls

- `ready={false}` turns off the buttons of the bar and the two whole-screenshot rows of the menu. The keys belong to the page: give `A`, `X`, `⇧A`, and `⇧X` the same condition.
- A page that shows the result page in the place of the stage does not render the bar. The receipt state is in the bar, so a bar that mounts again starts without a receipt: it cannot tell a decision from an Undo.
- The reference surface forces a save state with `receipt`, and it wraps the actions of the session so that the first decision of a person ends the forced state.
- The widths of Reject and Approve are in `em` (`buttonWidths` in `decisions.tsx`). Measure them again when a label changes.
