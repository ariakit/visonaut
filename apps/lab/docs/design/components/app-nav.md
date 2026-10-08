# App navigation (app-nav)

Group: shell
Question: Which form should the global navigation take?
Description: The frame of every page: the mark, the three destinations (Queue, History, Status), and the places of the alert count and the account.
Layout: stack

## Scenarios

- `queue` (Queue): Signed in, on the Queue, with runs to review and no alerts.
- `run` (On a run): Inside a run page, where the navigation must give the row to the run identity.
- `alerts` (With alerts): On History, with three unresolved alerts, one of them critical.
- `loading` (Loading): The session and the counts are not known yet (300 ms to 6 s).
- `guest` (Signed out): No session: no destination can open, so no dead link shows.
- `narrow` (Phone, 390): The Queue with alerts in a 390 px wide frame.

## Variant `quiet-bar`: Quiet bar

One 44 px top bar with the mark and three one-word links; on a run page the links leave and the bar belongs to the run.

Ideas:

- Three short words replace icons plus long labels. The words fit at 390 px, so no icon-only state exists.
- The Queue count and the alert count sit on the links: no bell, and one entry to Status.
- On a run page the same bar holds the run header: one row in place of three (122 px become 44 px).
- Count slots keep their width, so the bar does not move when data arrives.

Tradeoffs:

- On a run page, History and Status need two steps (the mark, then a link) or a command menu.
- The repository name hides below a 48rem container.
- The bar glider needs CSS anchor positioning.

### Spec

**Sketch**

```text
1440, Queue
| (o)  Queue 4   History   Status                     ariakit/ariakit   (DI) |  44
1440, on a run
| (o)  #4863 Migrate component examples to the new style recipes        (DI) |
390
| (o)  Queue 4  History  Status 3                                       (DI) |
```

**Build** `ShellHeader $height='sm' $border`; the shell sets `[--shell-header-step:calc(--spacing(11)/14)]` (44 px at 16 px). Start: the mark, `Button $p={1} aria-label='Visonaut'` with the `Aperture` icon in `ButtonSlot $layer='brand'`, then `Nav aria-label='Main' $layout='horizontal' glider={[{ $kind: 'bar' }, { $state: 'hover' }, { $state: 'focus' }]}` with three `NavLink` (`NavLinkLabel` + `NavSlot $kind='badge' className='min-w-5'`). End: the repository as `Text className='ak-ink-60 text-sm @max-3xl/shell:hidden'`, then the account stand-in (an avatar button). First focusable element: a skip link, `Button render={<a href='#content' />} className='sr-only focus:not-sr-only'`. Lab cell: `Frame $border $rounded='xl' className='h-56 w-full overflow-clip [container-type:size]'` > `Shell $forceRounded className='h-full [--shell-top:0px]!'`; the page is three quiet stand-in rows (`Frame $lightnessOffset $rounded='md' className='h-8'`), or two image stand-in frames for `run`; `narrow` wraps the cell in `max-w-[24.375rem]`. Links call `preventDefault` and set local state.
**Copy** `Queue`, `History`, `Status`, `ariakit/ariakit`, `Skip to content`. Names: `Queue, 4 to review`, `Status, 3 alerts`. Words at rest: 4.
**Behavior** Links are client links. The current link has `aria-current='page'` and the bar glider only: the same weight as the others, so no link changes width. The alert count is a badge on `Status` (warning tint; danger when one alert is critical). Tab order: skip link, mark, three links, account. No single-key shortcut.
**States**

- `queue`: `Queue` current with its count (`useInbox('busy').counts.review`); `Status` has no badge.
- `run`: the three links are not rendered. The mark is the way back (tooltip `Queue`). The row shows the run stand-in text (`#4863` and the title, truncated) and the account.
- `alerts`: `History` current; `Status 3` in the danger tint.
- `loading`: the mark and the link words render at once; each badge, the repository, and the account are `animate-pulse` frames of the final size.
- `guest`: the mark and the word `visonaut` only.
- `narrow`: the same row; the repository hides; links use `$px='sm'`; all three words stay.

## Variant `breadcrumb`: Breadcrumb bar

The bar is a trail (page, run, screenshot), and the first crumb opens the three destinations.

Ideas:

- The bar always says where you are, which the header does not do on a run page today.
- One trail replaces the app header, the main header, and the identity strip.
- The first crumb is a menu of its siblings (Queue, History, Status) with their counts.

Tradeoffs:

- History and Status are one click deeper than today.
- The last crumb repeats the screenshot name that the workspace also shows.
- The alert count shows as a dot until the menu opens.

### Spec

**Sketch**

```text
Queue     | (o) / Queue 4 v                                               (DI) |  44
On a run  | (o) / Queue v / #4863 Migrate component exam... / Dialog      (DI) |
390, run  | <  #4863 Migrate component ex...                              (DI) |
            +----------------+
menu        | Queue        4 |
            | History        |
            | Status       3 |
            +----------------+
```

**Build** `ShellHeader` as `quiet-bar`. Start: the mark, then `ButtonGroup render={<nav aria-label='Location' />} $size='sm' $p='none'` with `ButtonSeparator $kind='slash'` between crumbs. First crumb: `ak.MenuProvider` + `ak.MenuButton render={<Button />}`; menu: `ak.Menu portal {...popover.jsx({ $p: 1, $rounded: 'xl', className: 'grid min-w-44' })}` with `ak.MenuItem {...option.jsx()}` rows (`OptionLabel className='flex-1'` + `OptionSlot $kind='badge'`). Middle crumb: `Button render={<a />}` with `ButtonLabel $truncate`. Last crumb: `TextFrame` with `aria-current='page'`. Lab cell: as `quiet-bar`.
**Copy** `Queue`, `History`, `Status`; the other crumbs come from data. Words at rest: 1 on a list page.
**Behavior** Each crumb goes up one level; the last is text. The number in the run crumb never truncates; the title does (`min-w-0`). Menu keys are the Ariakit menu keys (arrows, Enter, Esc, first letters). A dot on the first crumb marks open alerts.
**States**

- `queue`: the crumb `Queue 4` only.
- `run`: three crumbs; the last is the selected screenshot name.
- `alerts`: the crumb `History` with a danger dot; the menu drawn open (static) with `Status 3`.
- `loading`: the page crumb renders from the URL; a run crumb is a skeleton bar; counts are skeleton pills.
- `guest`: the mark and `visonaut`.
- `narrow`: on a list page the row does not change; on a run page it is a back chevron to the Queue and the run crumb.

## Variant `rail`: Icon rail

A 56 px rail at the start edge holds the navigation; there is no global top bar, and a phone gets bottom tabs.

Ideas:

- Screenshots are wider than tall: the rail costs 56 px of width and returns 44 px of height on every page.
- The rail is the same on every page, so it cannot differ between pages as the header does today.
- On a phone it is a bottom tab bar in reach of the thumb, with a word under each icon.

Tradeoffs:

- Icons without words: the three destinations need tooltips on desktop.
- 56 px less width for two 1280 px screenshots side by side.
- The Shell has no rail width: the variant sets `--shell-slot-width` and `--shell-start-1-width` by hand.
- Bottom tabs and a sticky decision bar stack on a phone.

### Spec

**Sketch**

```text
1440                               390
+----+-------------------------+   +---------------------------+
|(o) | page header (the page)  |   | page                      |
|[Q]4+-------------------------+   |                           |
|[H] | page                    |   +---------------------------+
|[S].|                         |   | [Q]4    [H]    [S].   (DI) |  56
|    |                         |   | Queue  History  Status    |
|[?] |                         |   +---------------------------+
|(DI)|                         |
+----+-------------------------+
 56
```

**Build** Outer `Shell className='[--shell-start-1-width:--spacing(14)]!'`; `ShellSidebar $side='start' $show='3xl' render={<nav />} aria-label='Main' className='[--shell-slot-width:--spacing(14)]!'` with `ShellSidebarHeader` (mark), `ShellSidebarBody $p={2}`, and `ShellSidebarFooter` (keys button, account). Links: `Nav render={<div />} $layout='vertical' $slotSize={5} glider={[{}, { $state: 'hover' }, { $state: 'focus' }]}`; each `NavLink` is icon-only (`Inbox`, `History`, `Activity`) inside `TooltipProvider placement='right'`; the count is `NavSlot $kind='badge' $floating`. Phone: `Frame $layer className='sticky bottom-0 flex h-14 items-center justify-around border-t @3xl/shell:hidden'` with a horizontal `Nav` (icon over a `text-xs` word). Lab cell: as `quiet-bar`.
**Copy** Tooltips and phone labels: `Queue`, `History`, `Status`, `Keys`. Names: `Queue, 4 to review`. Words at rest: 0 on desktop, 3 on a phone.
**Behavior** Client links. On a run page `Queue` keeps the selected look with `aria-current='true'`, because the run belongs to the Queue. `Status` shows a warning or danger dot and the count. The page owns the only header row.
**States**

- `queue`: `Queue` selected with its count.
- `run`: `Queue` marked; the page header shows the run stand-in.
- `alerts`: `History` selected; `Status` has a danger dot and `3`.
- `loading`: icons render; badges and the avatar are skeleton frames.
- `guest`: no rail; the mark and `visonaut` in a top row.
- `narrow`: bottom tabs.

## Variant `page-tabs`: Tabs in the page

The header has no navigation; the page has one tab row for the list states and History, and Status is a dot.

Ideas:

- The three header items are not equal: Queue is home, History is another view of the same list, Status is an indicator.
- Counts sit on the tabs where they filter, so the three large counters go away.
- On a run page the header is the mark and the run: one row.

Tradeoffs:

- Status has no word in the header: a neutral dot is easy to miss.
- Two rows (44 + 40 px) on list pages.
- History as a tab beside the work lists is close to the merged list that U05 rejected (`recent-clear`). It stays a separate view here, so the selected `task-first` holds.

### Spec

**Sketch**

```text
| (o) visonaut   ariakit/ariakit                            (.) 3   (DI) |  44
|  To review 4    In progress 2    Needs attention 2    History          |  40
|  -----------                                                           |
On a run
| (o)  #4863 Migrate component examples to the new...       (.) 3   (DI) |
```

**Build** `ShellHeader` (start: mark, word mark, repository; end: the status dot, `Button $p={2} aria-label='Status, 3 alerts'` with a filled `Circle` in `Text $text`, then the account). Tab row: `ShellMainHeader $height='sm'` > one `div` > `Nav aria-label='Runs' $layout='horizontal' glider={{ $kind: 'bar' }}` with `NavLink` + `NavSlot $kind='badge'`. Tabs that are links are a horizontal `Nav`, not `Tabs`. Lab cell: as `quiet-bar`.
**Copy** `To review`, `In progress`, `Needs attention`, `History`. Words at rest: 7 plus the repository.
**Behavior** Each tab is a link with its own URL, so Back works and a tab can be shared. A work tab with a zero count hides, except `To review`. The dot is `ak-ink-40` with no alerts, and warning or danger with alerts; it links to Status.
**States**

- `queue`: `To review` current; counts from `useInbox('busy').counts`.
- `run`: no tab row; the mark and the run stand-in.
- `alerts`: `History` current; the dot is danger with `3`.
- `loading`: tab words render; counts are skeleton pills.
- `guest`: the mark and the word mark.
- `narrow`: the tab row scrolls sideways (`overflow-x-auto`) with a fade at the end edge; the repository hides.

## Variant `status-line`: Status line

An editor-style line at the bottom holds the whole global navigation; the top of every page belongs to its content.

Ideas:

- No global row at the top: on a run page the first image pixel can start under one tool row.
- The line gives a fixed home to state that has none today: the alert count, the keys entry, the signed-in login.
- One 28 px line of 12 px mono text, the same on every page.

Tradeoffs:

- Navigation at the bottom is unusual on the web: a new user looks at the top first.
- Targets are 28 px high: above the 24 px minimum, below the 32 px of the other variants.
- A sticky decision bar and the line stack at the bottom of a run page.
- `ShellFooter` is not sticky: the page must be a fixed app frame in which the body scrolls.
- No audit lane proposed a bottom line as the navigation.

### Spec

**Sketch**

```text
+---------------------------------------------------------------------------+
| page (owns the whole top)                                                 |
+---------------------------------------------------------------------------+
| (o) ariakit/ariakit   Queue 4   History   Status ! 3     ? Keys   diegohaz |  28
+---------------------------------------------------------------------------+
390
| (o)  Queue 4   History   Status 3                                    (DI) |  44
```

**Build** Fixed app frame: `Shell className='h-dvh'` (in the lab: `h-full`), `ShellMainBody className='overflow-y-auto'`, and `ShellFooter className='h-7 min-h-0 font-mono text-xs @max-3xl/shell:h-11'` with `start` (the mark at `size-4`, the repository in `ak-ink-60`, a horizontal `Nav $gap='sm'` with `NavLink $p={1}` and a bar glider) and `end` (`Button $size='xs'` with `Kbd` `?` and `Keys`, then the login as `Button $size='xs'`). Lab cell: as `quiet-bar`.
**Copy** `ariakit/ariakit`, `Queue`, `History`, `Status`, `Keys`, `diegohaz`. Words at rest: 6.
**Behavior** Client links; `aria-current='page'` on the current word. The alert count follows `Status` with a severity icon. The login opens the account menu upward (`placement='top-end'`). A skip link is still the first focusable element of the page.
**States**

- `queue`: `Queue` current with its count.
- `run`: the same line; the top shows the run stand-in.
- `alerts`: `History` current; `Status ! 3` in the danger tint.
- `loading`: words render; counts and the login are skeleton bars.
- `guest`: the mark and `visonaut` only.
- `narrow`: the line is 44 px high; the repository and `Keys` hide; the login becomes the avatar.

## Variant `one-button`: One menu button

The mark is the only global control: one menu holds the destinations, the alert count, keys, scheme, and sign out.

Ideas:

- No visible navigation on any page: the whole row is free for the page.
- One dot on the mark is the only global signal.
- Everything that is used a few times a day or less lives in one list.

Tradeoffs:

- Each destination costs two actions (open, pick).
- The alert count is hidden until the menu opens.
- A mark that opens a menu breaks the habit that the logo goes home.
- No audit lane proposed the mark as the only navigation control.

### Spec

**Sketch**

```text
| (o) v   Queue 4                                                         |  44
  +--------------------------+
  | Queue                  4 |
  | History                  |
  | Status                 3 |
  | ------------------------ |
  | Keys                   ? |
  | Scheme            System |
  | ------------------------ |
  | diegohaz        Sign out |
  +--------------------------+
```

**Build** `ShellHeader`; start: `ak.MenuProvider` + `ak.MenuButton render={<Button $p={1} aria-label='Visonaut menu' />}` (the mark and a small chevron slot), then the page title as `Text className='font-medium'`. Menu: `ak.Menu portal {...popover.jsx({ $p: 1, $rounded: 'xl', className: 'grid min-w-56' })}`; rows are `ak.MenuItem {...option.jsx()}` with `OptionLabel className='flex-1'` and a trailing `OptionSlot` (`$kind='badge'` for a count, `$kind='shortcut'` for `?`); `ak.MenuSeparator render={<Separator $line='solid' $gap={1} />}`. Lab cell: as `quiet-bar`.
**Copy** `Queue`, `History`, `Status`, `Keys`, `Scheme`, `Sign out`. Words at rest: 1 (the page title).
**Behavior** The menu opens on click, Enter, or ArrowDown; first letters move the highlight (menu typeahead). The row of the current page has `aria-current='page'` and a check. The mark shows a warning or danger dot when alerts are open.
**States**

- `queue`: closed; title `Queue` with its count.
- `run`: closed; the run stand-in takes the row.
- `alerts`: the menu drawn open (static); a dot on the mark; `Status 3`.
- `loading`: the mark renders; the title and counts are skeleton bars.
- `guest`: the mark is a plain link with no chevron; `visonaut`.
- `narrow`: the same; the menu is as wide as the frame minus 2rem.
