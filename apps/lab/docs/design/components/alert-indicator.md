# Service alert indicator (alert-indicator)

Group: shell
Question: How should every page say that the service needs attention?
Description: The signal for unresolved service alerts, with or without a preview of them.
Layout: row

## Scenarios

- `clear` (No alerts): No unresolved alert; the last check was 18 s ago.
- `one` (One alert): One warning (Backup), which is the normal production state today.
- `several` (Three alerts): One critical and two warnings; a variant with a preview draws it open.
- `overflow` (50 or more): Fifty alerts are loaded and more exist.
- `checking` (Checking): The first check did not answer yet.
- `stale` (Out of date): A refresh failed; the last good list (two alerts) still shows.
- `unknown` (Unavailable): No check ever answered: the state is not known.

## Variant `nav-dot`: Count on the Status link

No control of its own: the Status link carries a count.

Ideas:

- One entry and one name: today a bell and a nav link lead to the same content.
- Nothing shows when nothing is wrong; a bordered bell with no count asks for attention all day.
- The badge slot keeps its width in every state, so the header does not move (the bell changes from 36 to 62 px today).

Tradeoffs:

- No preview: to read one alert title the reviewer must open Status.
- It needs a visible Status link, which `one-button` and `page-tabs` do not have.
- Severity is the tint only; the tooltip has the words.

### Spec

**Sketch**

```text
clear      Status
one        Status 1      warning tint
several    Status 3      danger tint
overflow   Status 50+
checking   Status .      pulsing dot
stale      Status (2)    outline badge
unknown    Status ?      outline badge
```

**Build** `TooltipProvider` + `TooltipAnchor render={<NavLink />}` inside a horizontal `Nav`; `NavLinkLabel` + `NavSlot $kind='badge' className='min-w-5'` with `$layer='warning'` or `$layer='danger'`; the outline form is `$layer='transparent' $border`. The slot is always in the DOM (`invisible` when clear). Lab cell: `div className='flex w-90 flex-col items-end gap-2'` with a header stand-in strip (`Frame $layer $border $rounded='lg' className='flex h-11 w-full items-center justify-end gap-2 px-3'`) that holds the indicator and an avatar stand-in. Data: `useStatus`: `clear` is `healthy`, `several` is `alerts`, `overflow` is `overflow`, `checking` is `loading`, `unknown` is `error`; `one` is the Backup alert of `alerts`; `stale` is the first two alerts of `alerts` with a local stale flag. Short titles by `kind`: `check-delivery` GitHub check, `database-capacity` Database capacity, `backup` Backup, `comparison-task` Comparison retries, `upstream-webhook` GitHub webhook.
**Copy** `Status`. Names: `Status, no alerts`, `Status, 3 alerts`, `Status, checking alerts`. Tooltip lines: `GitHub check · 2 min`, `Database capacity · 4 min`, `Backup · 1 h`. Words: 1.
**Behavior** A click goes to Status. A new alert updates the count, and an `aria-live='polite'` text says `New alert: GitHub check.` No key.
**States**

- `clear`: no badge.
- `one`: `1`, warning; tooltip `Backup · 1 h`.
- `several`: `3`, danger; the tooltip drawn open (`open` on the provider) with three lines.
- `overflow`: `50+`.
- `checking`: a pulsing neutral dot in the slot.
- `stale`: `2` in the outline form; tooltip `These alerts may be out of date.`
- `unknown`: `?` in the outline form; tooltip `Could not load alerts.`

## Variant `icon-popover`: Icon with a preview

A fixed 32 px icon button with a count on it; the popover is a short list of one-line rows.

Ideas:

- The button never changes width: the count lies over the icon.
- The popover is a preview: mark, short title, age. About 20 words in place of 244.
- The check time and the refresh icon keep their place in every state.

Tradeoffs:

- A second way to the same content as the Status link.
- An icon with no word must be learned, and it is on screen when nothing is wrong.
- Rows have no recovery text: the Status page must hold it.

### Spec

**Sketch**

```text
[~3]   +----------------------------------+
       | Alerts          18 s ago    (r)  |
       | (!) GitHub check          2 min  |
       | (^) Database capacity     4 min  |
       | (^) Backup                  1 h  |
       | Open Status ->                   |
       +----------------------------------+
```

**Build** `PopoverProvider placement='bottom-end'` + `PopoverDisclosure $p={2} aria-label='Alerts, 3'` (`ButtonSlot` with `Activity`; the count as `ButtonSlot $kind='badge' $floating $layer='danger'`) + `Popover portal $p={2} $rounded='xl' className='grid w-80 gap-1'`. Head: `PopoverHeading className='px-2 text-sm font-medium'`, `Text className='ak-ink-60 text-xs'`, and `Button $size='xs' aria-label='Refresh'` (`RefreshCw`). Rows: `Button render={<a />} className='w-full justify-start text-start'` with a `ButtonSlot` (`CircleAlert` with `$text='danger'`, or `TriangleAlert` with `$text='warning'`), `ButtonLabel className='flex-1'`, and `Text className='ak-ink-60 text-xs tabular-nums'`. Foot: `Button $size='sm'` (`Open Status`, `ArrowRight`). More than five rows: `PopoverScroll`. Lab cell, data, and short titles: as `nav-dot`.
**Copy** `Alerts`, `Open Status`, `No alerts`, `These alerts may be out of date.`, `Could not load alerts.`, `Retry`. Words in the open preview: about 18.
**Behavior** Click, Enter, or Space opens; Esc closes. Refresh spins the icon; nothing else moves. No key.
**States**

- `clear`: the icon in `ak-ink-60` with no count; the popover says `No alerts`.
- `one`: count `1`, warning.
- `several`: drawn open (static) as sketched.
- `overflow`: count `50+`; five rows, then `Open Status (50+)`.
- `checking`: the icon pulses; no count; name `Checking alerts`.
- `stale`: the count in an outline badge; the popover head shows the stale sentence and `Retry`.
- `unknown`: a `?` outline badge; the popover shows `Could not load alerts.` and `Retry`.

## Variant `review-banner`: Banner for review impact

No header control: a slim band under the header, only for an alert that affects reviews.

Ideas:

- Reviewers see only what changes their work, in the place where they work, also on a run page (which has no signal today).
- The band says the effect, not the cause: one sentence and one link.
- Warnings stay on the Status page.

Tradeoffs:

- A warning (for example a failed backup) has no signal outside the Status page.
- 32 px of height on every page while a critical alert is open, which can be days.
- It needs `severity` and `impact`, which are not in the API today.
- The alert list is read-only by decision: Hide is local, and the band returns on reload.

### Spec

**Sketch**

```text
+-----------------------------------------------------------------------+
| (!) The pull request does not show its Visonaut result.  Status (3)  x |  32
+-----------------------------------------------------------------------+
hidden: a 2 px danger line under the header
```

**Build** `Frame role='status' $layer='danger' $mix={12} className='flex min-h-8 items-center gap-2 border-b px-3 text-sm'` under the header: `Text $text='danger' className='flex'` (`CircleAlert`), `Text className='min-w-0 flex-1'` (`alert.impact`), `Link className='flex-none'`, and `Button $size='xs' aria-label='Hide'` (`X`). Lab cell: `div className='grid w-[40rem] max-w-full'` with the header stand-in strip of `nav-dot` and the band under it. Data: as `nav-dot`.
**Copy** The sentence is `alert.impact`; `Status (3)`; `May be out of date`; `Could not load alerts.`, `Retry`. Words: about 12.
**Behavior** Only an alert with `severity: 'critical'` opens the band; with two critical alerts it shows the newest. `Hide` collapses it to a 2 px line for this page session; a new critical alert opens it again. No key.
**States**

- `clear`: no band.
- `one`: no band (the alert is a warning).
- `several`: the band for the critical alert, as sketched.
- `overflow`: the newest critical alert and `Status (50+)`.
- `checking`: no band.
- `stale`: the band stays and ends with `May be out of date` in `ak-ink-60`.
- `unknown`: a neutral band (`$lightnessOffset`): `Could not load alerts.` and `Retry`.

## Variant `status-word`: Status in words

Always-on words at the end of the header: the state of the service as text, quiet when nothing is open.

Ideas:

- A word needs no legend and no hover.
- It stays in one place with a fixed minimum width in every state.
- It is a link to Status; the tooltip lists the alert titles.

Tradeoffs:

- Two words in the header at all times, also when nothing is wrong.
- `No alerts` can read as a health promise; the list reports alerts and does not test every dependency.
- No preview beyond a tooltip.

### Spec

**Sketch**

```text
clear      (.) No alerts
one        (^) 1 alert
several    (!) 3 alerts
overflow   (!) 50+ alerts
checking   (o) Checking
stale      (^) 2 alerts · stale
unknown    (?) Unknown
```

**Build** `TooltipProvider` + `TooltipAnchor render={<Button $size='xs' render={<a />} className='min-w-24 justify-start' />}` with a `ButtonSlot` (a filled `Circle` in `ak-ink-40`, `TriangleAlert`, `CircleAlert`, `LoaderCircle` with `animate-spin`, or `CircleHelp`) and `ButtonLabel`; the warning and danger states set `$text` on the button. Lab cell, data, and short titles: as `nav-dot`.
**Copy** `No alerts`, `1 alert`, `3 alerts`, `50+ alerts`, `Checking`, `2 alerts · stale`, `Unknown`. Tooltips as `nav-dot`. Words: 2.
**Behavior** A click goes to Status. A text change is announced with `aria-live='polite'`. No key.
**States**

- `clear`: `No alerts` in `ak-ink-60`.
- `one`: `1 alert` in warning text.
- `several`: `3 alerts` in danger text; the tooltip drawn open.
- `overflow`: `50+ alerts`.
- `checking`: the spinner and `Checking`.
- `stale`: `2 alerts · stale`; tooltip `These alerts may be out of date.`
- `unknown`: `Unknown`; tooltip `Could not load alerts.`

## Variant `new-since`: New since you looked

The count shows only alerts that are new since this reviewer last opened the list; known alerts are a quiet outline.

Ideas:

- In production one alert is open on every view: a permanent red count teaches people to ignore it.
- An unread model keeps the signal for change. `firstSeenAt` is in the API; the time of the last look is stored in this browser.
- The preview has two groups, `New` and `Known`; opening it marks all as seen.

Tradeoffs:

- Seen is stored for each browser: another device shows the same alert as new.
- A critical alert that stays open turns quiet after one look; it keeps a danger outline to limit that risk.
- Two badge forms (solid, outline) are one more thing to learn.
- No audit lane proposed an unread model for alerts.

### Spec

**Sketch**

```text
new           [~2]     solid count
known only    [~o]     outline ring
          +----------------------------------+
          | Alerts          18 s ago    (r)  |
          | New                              |
          | (!) GitHub check          2 min  |
          | Known                            |
          | (^) Database capacity     4 min  |
          | (^) Backup                  1 h  |
          | Open Status ->                   |
          +----------------------------------+
```

**Build** As `icon-popover`. The badge is solid (`$layer='danger'` or `$layer='warning'`) for new alerts, and `ButtonSlot $kind='badge' $floating $layer='transparent' $border` (a ring with no number) for known alerts; a known critical alert sets `$edge='danger'`. Group labels: `TextFrame $p={2} $ink={60} className='text-xs'`. New means that `firstSeenAt` is later than the stored time of the last look (local state in the lab; the lab starts with the newest alert as new). Lab cell, data, and short titles: as `nav-dot`.
**Copy** `Alerts`, `New`, `Known`, `Open Status`. Names: `Alerts, 1 new`, `Alerts, 3 known`. Words in the open preview: about 20.
**Behavior** Opening the popover stores the present time; the badge takes the outline form when the popover closes. No key.
**States**

- `clear`: the icon only.
- `one`: solid `1`, warning.
- `several`: drawn open as sketched: one new, two known.
- `overflow`: solid `50+` only if one alert is new; the group labels show their counts; five rows in all.
- `checking`: the icon pulses.
- `stale`: the outline ring; the popover head shows the stale sentence and `Retry`.
- `unknown`: a `?` outline badge; `Could not load alerts.` and `Retry`.
