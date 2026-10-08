# Account menu (account-menu)

Group: shell
Question: How should the app show who is signed in and offer sign out?
Description: The control that names the GitHub account behind each decision and holds the session actions.
Layout: row

## Scenarios

- `closed` (Closed): Signed in as diegohaz; the trigger at rest.
- `open` (Open): The menu, or the expanded state of the control.
- `long-login` (Long login): A 39 character login, the longest that GitHub allows.
- `loading` (Loading): The session is not known yet.
- `no-access` (No access): Signed in as okafor-amara, an account without write access.
- `sign-out-failed` (Sign-out failed): The sign-out request failed.
- `preview` (Preview): Sample data: there is no account and sign-in is off.

## Variant `avatar-only`: Avatar only

A 32 px avatar button; the menu has the login and one action.

Ideas:

- Two rows replace a heading, a sentence, and a button.
- The login is the first row, so the menu answers who signs the decisions.
- Initials need no image request and no CSP change.

Tradeoffs:

- The login is not visible until hover or click.
- Two letters of a login (`DI`) are a weak identity.
- The login is not in the run list answer today.

### Spec

**Sketch**

```text
closed          open
        (DI)            (DI)
                +------------------+
                | diegohaz         |
                | [>] Sign out     |
                +------------------+
```

**Build** `ak.MenuProvider placement='bottom-end'`; trigger: `ak.MenuButton render={<Button $p={1} aria-label='Account, diegohaz' />}` inside a `TooltipAnchor`, with `ButtonSlot $kind='avatar' $layer='brand' $mix={20}` (the first two letters of the login). Menu: `ak.Menu portal {...popover.jsx({ $p: 1, $rounded: 'xl', className: 'grid min-w-44' })}`; row 1 is `TextFrame $p={2} $ink={60} className='truncate text-sm'` (not an item); row 2 is `ak.MenuItem {...option.jsx()}` with `OptionSlot` (`LogOut`) and `OptionLabel`. Lab cell: `div className='flex w-90 flex-col items-end gap-2'`; a header stand-in strip (`Frame $layer $border $rounded='lg' className='flex h-11 w-full items-center justify-end px-3'`) holds the trigger; an open state draws the panel in flow under the strip (a `div` with the `popover` recipe and `data-open`); `closed` uses the real menu. Data: `currentUser`; `no-access` uses `getSignInData('forbidden').user`; `long-login` uses a copy of `people.lucas` with a 39 character login.
**Copy** `Sign out`; tooltip: the login. Words: 2.
**Behavior** Menu keys are the Ariakit menu keys. While sign out runs, the item is `aria-disabled` and its slot is a `ProgressCircular`; the label does not change.
**States**

- `closed`: the avatar `DI`.
- `open`: two rows.
- `long-login`: open; the login row truncates at `max-w-56` and has the full login in `title`.
- `loading`: a skeleton circle of the same size; not focusable.
- `no-access`: a warning dot on the avatar; rows `okafor-amara`, `No write access` (`text-xs`, warning text), and the item `Use another account`.
- `sign-out-failed`: open; `Sign-out failed. Try again.` as `Text $text='danger' className='px-2 text-xs'` above the item.
- `preview`: a `Badge` `Preview` in place of the avatar; tooltip `Sample data. Sign-in is off.`; no menu.

## Variant `login-chip`: Login chip

The trigger shows the avatar and the login in the header at all times.

Ideas:

- The reviewer sees which account signs each decision with no click.
- The menu has actions only, because the login is on the trigger.
- Below a 48rem container the chip drops the text and is the avatar-only form.

Tradeoffs:

- About 120 px of header width, on a row that a run title also needs.
- The header moves when the login arrives unless the skeleton reserves the width.
- A long login truncates in the one place that shows it.

### Spec

**Sketch**

```text
closed                      open
      [ (DI) diegohaz v ]         [ (DI) diegohaz ^ ]
                                  +--------------------+
                                  | GitHub profile   ^ |
                                  | Sign out           |
                                  +--------------------+
```

**Build** `ak.MenuButton render={<Button $size='sm' $px='sm' />}` with `ButtonSlot $kind='avatar' $layer='brand' $mix={20}`, `ButtonLabel $truncate className='max-w-40 @max-3xl/shell:hidden'`, and a chevron `ButtonSlot $size='sm'`. Menu as `avatar-only`, with two items: `ak.MenuItem render={<a />}` (`OptionLabel className='flex-1'` + `OptionSlot` with `ArrowUpRight`) and `Sign out`. Lab cell and data: as `avatar-only`.
**Copy** `GitHub profile`, `Sign out`. Words: 3 plus the login.
**Behavior** As `avatar-only`.
**States**

- `closed`: the chip.
- `open`: two items.
- `long-login`: closed; the label truncates at 10rem; a tooltip has the full login.
- `loading`: a skeleton pill `h-7 w-28`.
- `no-access`: the chip has a warning tint (`$layer='warning' $mix={15}`); the open panel shows the line `No write access to ariakit/ariakit` and the item `Use another account`.
- `sign-out-failed`: open; the danger line above `Sign out`.
- `preview`: a `Badge` `Preview`; no chevron and no menu.

## Variant `identity-card`: Identity card

A popover card that confirms identity and access, and holds the settings of this person: scheme and shortcuts.

Ideas:

- One home for per-person state that has no place today: scheme (the app follows the system only) and the shortcut switch (below the fold, not stored).
- The access line states what the server checks on each request.
- A real avatar and a name make the account easy to recognize.

Tradeoffs:

- About 12 words and three controls where one action was enough.
- `name` and the avatar are not in the API today, and a GitHub avatar needs a CSP change or a proxy.
- Settings inside an account popover are hard to find.

### Spec

**Sketch**

```text
                                 (H)
        +-------------------------------------+
        | (H)  Haz                            |
        |      diegohaz                       |
        |      v Write access                 |
        | ----------------------------------- |
        | Scheme     [ System | Light | Dark ] |
        | Shortcuts                    [ on ] |
        | ----------------------------------- |
        | GitHub profile ^           Sign out |
        +-------------------------------------+
```

**Build** `PopoverProvider placement='bottom-end'` + `PopoverDisclosure $p={1} aria-label='Account, diegohaz'` (the avatar image in `ButtonSlot $kind='avatar'`) + `Popover portal $p={3} $rounded='2xl' className='grid w-72 gap-3'`. Identity: `Frame $rounded='full' className='size-10 overflow-clip'` with `img` (`user.avatarUrl`), `Text className='font-medium'`, `Text className='ak-ink-60 text-sm break-all'`, and `Text $text='success' className='flex items-center gap-1 text-xs'` with `Check`. `Separator $line='solid' $gap={0}`. Scheme: `ak.RadioProvider` + `ak.RadioGroup aria-label='Scheme' render={<ButtonGroup $border $size='sm' />}` + `ak.Radio render={<Button />}` + `ButtonGlider`. Shortcuts: the Toggle recipe of the primitives guide. Footer: `Link` and `Button $size='sm'`. Lab cell and data: as `avatar-only`.
**Copy** `Write access`, `Scheme`, `System`, `Light`, `Dark`, `Shortcuts`, `GitHub profile`, `Sign out`. Words: 12.
**Behavior** Popover keys (Esc closes). The scheme and the switch apply at once and are stored in this browser (local state in the lab).
**States**

- `closed`: the avatar.
- `open`: the card.
- `long-login`: open; the login wraps to two lines.
- `loading`: a skeleton circle.
- `no-access`: the access line is `No write access` with `TriangleAlert` in warning text; the settings rows hide; the footer is `Use another account`.
- `sign-out-failed`: the danger line above the footer.
- `preview`: a `Badge` `Preview`, the line `Sample data. Sign-in is off.`, and the scheme row.

## Variant `inline-confirm`: Inline confirm

No popover: the avatar expands in place to show the login, and one click turns it into a sign-out confirm.

Ideas:

- A popover for one action is overhead; here nothing covers the page actions under the header.
- Hover or focus shows the login with no click.
- A two-step confirm in place prevents a sign out by accident.

Tradeoffs:

- No room for a second action: the pattern cannot grow to hold scheme or a profile link.
- Hover does not exist on touch: a tap goes to the confirm, which must name the login.
- The expanding chip must lie over its neighbors (`absolute end-0`) or it moves them.
- No audit lane proposed an account control without a popover.

### Spec

**Sketch**

```text
rest      hover or focus         after a click
   (DI)      [ (DI) diegohaz ]      [ Sign out diegohaz?   Yes   No ]
```

**Build** One `ButtonGroup $border $size='sm' $rounded='full' className='absolute end-0'` inside a `relative size-8` anchor; React state `rest | peek | confirm` picks the children. Rest and peek: `Button aria-label='Account, diegohaz' aria-expanded` with `ButtonSlot $kind='avatar'` and, in peek, `ButtonLabel $truncate className='max-w-48'`. Confirm: `TextFrame $p={2} className='text-sm'`, `Button $text='danger'` with `ButtonLabel` (`Yes`), and `Button` (`No`). The group is `aria-live='polite'`. Lab cell and data: as `avatar-only`.
**Copy** `Sign out diegohaz?`, `Yes`, `No`. Words: 5.
**Behavior** Pointer enter or focus: peek. Click, Enter, or Space: confirm, with focus on `No`. `Yes` signs out and shows a `ProgressCircular` in its slot. `No`, Esc, or blur: rest. With reduced motion the width changes at once.
**States**

- `closed`: rest.
- `open`: confirm.
- `long-login`: peek, drawn static; the login truncates at 12rem.
- `loading`: a skeleton circle.
- `no-access`: always expanded in a warning tint: `okafor-amara · no access`; a click asks `Use another account?` with `Yes` and `No`.
- `sign-out-failed`: the confirm row reads `Sign-out failed` in danger text, then `Try again` and `No`.
- `preview`: a `Badge` `Preview`; no interaction.

## Variant `sidebar-row`: Sidebar row

A row at the bottom of a rail or sidebar; the menu opens upward.

Ideas:

- The form that a rail or sidebar navigation needs: an avatar at 56 px, a two-line row at 224 px.
- Name and login show as label and description, with no click.
- The top end corner of the page stays free for page actions.

Tradeoffs:

- It fits only the `rail` navigation or a sidebar.
- The bottom start corner is not where people look for the account.
- `name` is not in the API today.

### Spec

**Sketch**

```text
rail      sidebar                        open
 (DI)     [ (DI) Haz               ... ]  +----------------------+
          [      diegohaz              ]  | GitHub profile     ^ |
                                          | Sign out             |
                                          +----------------------+
                                          [ (DI) Haz         ... ]
```

**Build** In `ShellSidebarFooter`: `Nav render={<div aria-label='Account' />} $slotSize={6}` > `li` > `ak.MenuProvider placement='top-start'` + `ak.MenuButton render={<NavButton />}` with `NavSlot $kind='avatar' $layer='brand' $mix={20}`, `NavButtonContent` (two `Text` lines: the name in `font-medium`, the login in `ak-ink-60 text-xs truncate`), and `NavSlot className='ms-auto'` (`Ellipsis`). The rail form renders the avatar slot only, with a tooltip and `placement='right-end'`. Menu as `login-chip`. Lab cell: `div className='flex w-90 items-end gap-4'` with two stand-in columns (`w-14` and `w-56`, each `Frame $layer $border $rounded='lg' $p={2} className='flex h-40 flex-col justify-end'`). Data: as `avatar-only`.
**Copy** `GitHub profile`, `Sign out`. Words: 3 plus the name and the login.
**Behavior** As `avatar-only`; the menu opens above the row.
**States**

- `closed`: both forms.
- `open`: the sidebar form with the panel above it.
- `long-login`: the login line truncates.
- `loading`: a skeleton circle and two skeleton bars.
- `no-access`: the second line is `No write access` in warning text; the menu has `Use another account`.
- `sign-out-failed`: open; the danger line above `Sign out`.
- `preview`: a `Badge` `Preview` in the row; no menu.
