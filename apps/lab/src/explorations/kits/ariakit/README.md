# Folio kit (direction `ariakit`)

The shared parts of the design "Ariakit folio". All six pages use this kit, and the reference surfaces render the same parts. This file is the state of round 3, after the answers of round 2: the picks of the maintainer are parts of the kit, not variants beside it, and each part has one form.

Import from the kit with a relative path that has the file extension. From `src/explorations/pages/<surface>/ariakit.tsx`:

```tsx
import { FolioShell, PageTitle } from "../../kits/ariakit/shell.tsx";
import { StatusPill, getRunResultName } from "../../kits/ariakit/status.tsx";
```

- [The first rule: stock primitives](#the-first-rule-stock-primitives)
- [Rules of the direction](#rules-of-the-direction)
- [Exports](#exports)
- [Folders](#folders)
- [Pitfalls that cost time](#pitfalls-that-cost-time)

## The first rule: stock primitives

The maintainer wants a design that reuses the Ariakit UI primitives, with variations of layout, content, and elements. So:

- Build each surface, control, text, and overlay with a primitive from `src/components/ariakit/components/*.ariakit.react.tsx`, with its documented props and its stock look.
- Do not hand-build a replacement for something that a primitive covers. Do not add custom-drawn controls, custom shadows, custom borders, custom gradients, or glass.
- The identity of Folio comes from its layout, its information architecture, its content (which facts, in which words), its elements (which primitives appear where), and its interactions. It does not come from custom paint.
- Tailwind is for layout only: `grid`, `flex`, `gap-*`, sizes, position, and text size and weight.
- Only parts with no primitive stay custom, on primitive surfaces: for example a screenshot in a `Frame`.

Every part of this kit follows the rule. A status pill is the stock `Badge`. A glyph is a lucide icon in `Text`. A key on a control is the stock shortcut slot. The error band is a `Frame` with a tint. The selected mark of a strip is a `ButtonGlider`, not a painted ring.

## Rules of the direction

### Layers

Four planes, and no more nesting than that. A layout wrapper has no layer.

| Plane | Recipe                                                                    | Use                                                 |
| ----- | ------------------------------------------------------------------------- | --------------------------------------------------- |
| Desk  | The page canvas. `Shell`, `ShellHeader`, and `ShellSidebar` paint nothing | Page background, header, lists that lie on the page |
| Sheet | `Sheet` (`Frame $lighten $border $rounded="2xl" $p="1rem"`)               | Cards, a group of run rows, the main panel          |
| Well  | `Well` (`Frame $darken={1.5} $rounded="xl"`) inside a sheet               | A stage, a preview strip                            |
| Chip  | A control in a well or a bar: `Button $lightnessOffset`, `Badge`          | Buttons in bars, pills                              |

- One brand surface for each view: the one main action is `Button $kind="bevel" $layer="brand"`. Every other action is neutral (`$lightnessOffset`) or see-through. A card is never the brand surface.
- A tint is a status color at 15% with the edge of that color (D-UI-04): `ErrorBand`, the next run card of the Queue, and the stock colored `Badge` all have it.
- No line under the header and no line between a list and the main area: pass `$border={false}` to `ShellHeader` and `ShellSidebar`. Depth separates surfaces.
- `Separator` keeps its dashed line. Use it inside popovers and menus.
- A screenshot is never rounded and has no shadow.

### Color roles

| Role      | Meaning                                                                                     |
| --------- | ------------------------------------------------------------------------------------------- |
| `brand`   | The main action, the current place, news that is no failure                                 |
| `success` | Approved, passed, healthy                                                                   |
| `warning` | Needs review, rerun needed, a warning                                                       |
| `danger`  | Rejected, failed, a critical alert, a failed save, and the diff: mask tint and region boxes |

The diff is red, as the contract says. Never write the role of the diff by hand: use `diffColor` from `tokens.ts`, so that a change is one line.

### One status vocabulary

Run states and variant states share one set of names, colors, and icons. Never invent another word or another icon for a state. `statusStyles` in `status.tsx` is the only table. `getRunResultName(run)`, `getReviewStatusName(variant)`, and `getStripStatusName(variant)` map the fixture states to it.

| Name          | Run state         | Variant state            | Role    | Pill icon          | Glyph           |
| ------------- | ----------------- | ------------------------ | ------- | ------------------ | --------------- |
| Needs review  | `needs-review`    | `needs-review`           | warning | `CircleDot`        | `Circle`        |
| Rejected      | `rejected`        | `rejected`               | danger  | `CircleX`          | `X`             |
| Failed        | `failed`          | `problem`                | danger  | `TriangleAlert`    | `TriangleAlert` |
| Rerun needed  | `needs-recompare` |                          | warning | `RefreshCw`        | `RefreshCw`     |
| Comparing     | `comparing`       | `comparing`              | neutral | `LoaderCircle`     | `LoaderCircle`  |
| Capturing     | `incomplete`      |                          | neutral | `CircleDashed`     | `CircleDashed`  |
| Passed        | `passed`          |                          | success | `CircleCheck`      | `Check`         |
| Replaced      | `superseded`      |                          | neutral | `CircleArrowRight` | `ArrowRight`    |
| Approved      |                   | `approved` by a person   | success | `CircleCheck`      | `Check`         |
| Auto-approved |                   | `approved` by the rule   | neutral | `CheckCheck`       | `CheckCheck`    |
| Unchanged     |                   | `unchanged`              | neutral | `Equal`            | `Equal`         |
| Added         |                   | approved, kind `added`   | success | `CirclePlus`       | `Plus`          |
| Removed       |                   | approved, kind `removed` | danger  | `CircleMinus`      | `Minus`         |

A status has two forms, and each place has one of them:

- **The pill** (`StatusPill`): everywhere outside a strip. It is the full pill with its word where no other word says the state: the pull request sheet, the header of a closed run, the legend. It is compact (the icon in a tinted disc) where text beside it says the state: a run row.
- **The glyph** (`StatusGlyph`): only in a strip of marks, one for each variant of a screenshot. Six pills in a row are too heavy. The glyph is the icon of the pill without its circle.

`Added` and `Removed` show only in a strip, for an approved variant: they say what the approval accepted. `Replaced` and `Unchanged` are closed work without a result, so their pill has no fill. Only `Comparing` moves. A status never relies on color alone: each has its own shape and an accessible name.

### Type

Inter for everything. JetBrains Mono (the `mono` class) for commit SHAs, branch names, pull request numbers in a title, and Error IDs. An image size in a label of the stage is Inter with `tabular-nums`, as the pick "Ring" has it.

One base size and stock sizes (D-UI-03): `text-sm` on each page root, `$size` steps on controls, and stock Tailwind text sizes. No `text-[…em]` in new code.

| Class       | Weight              | Use                                                 |
| ----------- | ------------------- | --------------------------------------------------- |
| `text-xs`   | 500                 | Meta, times, a label above a group                  |
| `text-sm`   | 400, 500 for labels | Default text, rows, buttons. The base of every page |
| `text-base` | 600                 | Card titles, the name of the thing on screen        |
| `text-lg`   | 600                 | The `h1` of a list page (`PageTitle`)               |
| `text-xl`   | 600                 | Sign-in heading, empty state headings               |

- Put `pageRoot` (`text-sm`) on the root of every page. `FolioShell` does it. The sign-in page is the only page with `text-base`.
- A portal leaves the page root. Put `overlayRoot` on every `Popover`, `Dialog`, `Tooltip`, and menu, or its text is 16 px. The kit parts do it.
- Secondary text is `secondary` (`ak-ink-70`). Tertiary text is `tertiary` (`ak-ink-60`). Never use an opacity class for soft text.
- A label above a group is plain soft text: `tertiary` with `text-xs font-medium` in a menu or a dialog, `text-sm` on a page. No uppercase.
- Numbers that change take `tabular-nums`.
- Icons are lucide with `strokeWidth={iconStroke}` (1.5). Glyphs use `markStroke` (2.25).

### Spacing

All values are spacing steps, so the Density control works. At the 14 px base one step is 3.5 px.

- Page gutter: `1.5rem` on list pages (`FolioShell`), and 1rem below 48rem. Column width: `56rem` (the default of `FolioShell`), and `48rem` for the pull request page.
- Sheet padding `$p="1rem"`, so that children keep their own radius. A sheet around rows has `$p={1}`: the rows then take the concentric radius.
- Heights: header 49 px (`$height="sm"`), a control 34 px (the default `$p={2}`), a run row 61 px, a small control `$size="sm"`.
- Radius: sheets `2xl`, wells `xl`, controls `md` (the default), pills `full`. Let nested frames compute their corners. Never write `rounded-*` or pixel values.

### Copy

- Sentence case. No period at the end of a heading, a label, or a one-line note.
- One name for each concept (D-UX-03). Pages: Queue, History, Status. Things: run, screenshot, variant, change. States: the table above.
- Words are a cost. A count is a number with one noun (`formatCount(9, "change")`). Prose goes in a `MoreInfo` popover.
- Handle every optional field. The Data control has three modes. In `decided` (the default) a run has its title, and no author, no counts, no progress, and no previews. In `today` it has no title. A missing field must leave no hole. Check each page with `&data=decided`, `&data=today`, and `&data=improved`.

### Keys

Only the review page binds keys (D-WORK-03). The list pages bind none.

- A key on a control is dimmed text in the stock shortcut slot, with no key cap: `ShortcutSlot` at the end of a `Button` or a `Tab`, and the `shortcut` of a `MenuItem`.
- An icon button shows its key in its tooltip (`IconButton shortcut`, `Hint shortcut`). A tooltip and the Keys list are the two places of the `Kbd` cap.
- A page has no key legend and no `?` button. The account menu of a page with keys has the checkbox `Shortcuts` and the item `Keys`, which opens the list (`ShortcutsDialog`).
- The keys of the review page are `reviewKeyGroups`: Up, Down, Left, Right, `1` to `6`, `[`, `A`, `X`, `Shift+A`, `Shift+X`, `Cmd/Ctrl+Z`, `F`, `G`, `S`, `W`, `O`, and `D` for the mask.
- While the checkbox `Shortcuts` is off, every key hint of the kit hides, and `usePageKeys` binds nothing. The browser stores the switch.

### Motion

Use what the primitives bring: gliders, the progress fill, popovers. The kit adds three classes: `skeletonMotion` (a pulse), `stampMotion` (a glyph arrives), and `imageMotion` (a picture fades in over 80 ms). All three stop with reduced motion.

### Loading

The pick is the destination skeleton. It is a rule, not a part:

- The real chrome at 0 ms: the shell, the header with its nav, the toolbar. Only the content waits.
- One block for each piece of content, with the size of that content: `Skeleton` and `SkeletonLine`, and `RunRowSkeleton` for run rows. A group that loads has the same sheet as the group that replaces it, so nothing moves when the data comes.
- No words and no spinner before 3 s. A block may wait 150 ms before it shows, so a fast answer shows almost no skeleton.
- An image that is not there yet has the median image box: 416 by 170.
- Put `aria-busy="true"` and an `aria-label` on the region, not on each block.
- The skeleton is the first load only (D-LOAD-04, D-LOAD-05). A return to a list shows the last list at once, and a refresh never blanks a page.

### Empty and error

- Empty: one `EmptyState`: a tint mark, a heading, one line, one action.
- Error: the region that failed keeps its shape under one `ErrorBand`. The header stays. Under the band is a still skeleton (`RunRowSkeleton still`) when nothing loaded, the stale rows when a refresh failed, or the image well when an image failed.
- A failed refresh keeps the list and shows its age in the band: `Could not refresh · list of 4 min ago`, with `Try again`.

## Exports

### `tokens.ts`

Class constants, two numbers, one radius step, and one color role: `pageRoot`, `overlayRoot`, `shellRadius`, `mono`, `secondary`, `tertiary`, `diffColor`, `iconStroke`, `markStroke`, `skeletonMotion`, `stampMotion`, `imageMotion`.

Pass `$rounded={shellRadius}` to every `Shell`. The stock shell has a fixed radius of 20 px, and each frame near its edge takes a concentric share of it. `shellRadius` is 21 px at the default radius, and it follows the Radius control of the lab. `FolioShell` passes it.

```tsx
<Text className={cx(mono, tertiary)}>{shortSha(run.testedSha)}</Text>
<Frame $layer={diffColor} $mix={50} />
<Frame $border $edge={diffColor} $edgeRaw />
```

### `shell.tsx`

`FolioShell` is the page of a list surface: the 49 px header on the desk (wordmark, repository, page nav, account menu) and one centered column of 56rem. It renders the `ShortcutsProvider`, the hidden `h1`, and the document title. It binds no key.

```tsx
export default function AriakitInbox({ scenario }: VariantProps) {
  const inbox = useInbox(scenario);
  const user = inbox.status === "loading" || inbox.status === "error" ? undefined : inbox.user;
  return (
    <FolioShell current="inbox" heading="Queue" title="(4) Queue" user={user}>
      <RunRowList aria-label="Runs to review">…</RunRowList>
    </FolioShell>
  );
}
```

| Prop                        | Meaning                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `current`                   | `"inbox"` (the Queue), `"history"`, or `"status"`. Leave it out on the pull request page                                  |
| `heading`                   | The hidden `h1`. Leave it out when the page renders a `PageTitle`                                                         |
| `title`                     | The document title before ` · Visonaut`                                                                                   |
| `user`                      | The account. Without it (loading), the account button is disabled                                                         |
| `maxWidth`                  | The column width. Default `56rem`                                                                                         |
| `reviewCount`, `alertCount` | The two counts of the nav. Without them, the nav shows the counts of the busy Queue (4 and 3). A count of 0 shows nothing |
| `shortcuts`                 | `ShortcutGroup[]` of a page that binds keys. A list page leaves it out                                                    |

The children of the shell are four steps apart (`gap-4`). A page that wants more air puts its blocks in one grid of its own, for example with `gap-6`.

**The bar of the page nav lies on the header edge.** `MainNav` passes `$barOffset="frame"` to its bar glider, which puts the bar on the edge of the nav. So the nav must be as tall as the header: it has `h-full`, its links have `self-center`, and the header part around it stretches. The nav also has three steps of inline room (`px-3`): it clips its content with corners that are concentric with the shell, and without the room the bar of the first and of the last link loses one corner. A page with a header of its own does the same:

```tsx
<ShellHeader
  $height="sm"
  $border={false}
  center={
    <ShellHeaderCenter className="self-stretch">
      <MainNav current="history" />
    </ShellHeaderCenter>
  }
/>
```

Do not give `$barOffset` a length to push the bar down: the distance then depends on the height of the header.

`AccountMenu` is the avatar button with its menu: the login, then the checkbox `Shortcuts` and the item `Keys` on a page with keys, then the GitHub profile and Sign out. `keys` says whether the page has keys. Its default is true inside a `ShortcutsProvider`, so a page with a header of its own (the review page) gets the two rows without a prop, and `FolioShell` passes false for a list page.

`PageTitle` is the visible `h1` of a page with its facts and actions. A page has one `h1`: this one, or `heading` of the shell.

```tsx
<PageTitle
  prefix={`Pull request #${pull.number}`}
  meta={`${shortSha(pull.headSha)} · attempt 3`}
  actions={
    <Button $size="sm" $border render={<a {...getExternalLinkProps(url)} />}>
      GitHub
    </Button>
  }
>
  {pull.title ?? "Pull request"}
</PageTitle>
```

Other exports, for a page with a header of its own: `Wordmark`, `RepositoryLink`, `MainNav`, `AccountMenu`, `AlertsLink`, `useWorldCounts()` (the two header counts from the busy Queue), `useDocumentTitle(title)`, and `getExternalLinkProps(href)` for a link that leaves the app.

### `status.tsx`

```tsx
// The pill, with its word.
<StatusPill status={getRunResultName(run)} />
// A state text that is not the state word. The word stays for a screen reader.
<StatusPill status="needs-review">246 changes</StatusPill>
// The icon alone in a tinted disc. The word is its accessible name.
<StatusPill status="failed" compact />
// On a solid color surface a tint has no contrast.
<StatusPill status="needs-review" invert />

// A strip: one glyph for each variant, each one a link to its variant.
<ButtonGroup aria-label="Variants" $size="sm" $p="none" $gap="xs">
  {item.variants.map((variant) => (
    <Button
      key={variant.key}
      aria-label={`${variant.name}, ${statusStyles[getStripStatusName(variant)].label}`}
      aria-current={variant.key === selected.key ? "true" : undefined}
      render={<PlaceLink itemKey={item.key} variantKey={variant.key} />}
    >
      <ButtonSlot>
        <StatusGlyph status={getStripStatusName(variant)} decorative />
      </ButtonSlot>
    </Button>
  ))}
  <ButtonGlider />
  <ButtonGlider $state="hover" />
  <ButtonGlider $state="focus" />
</ButtonGroup>
```

- `statusStyles[name]` has `label`, `role`, `icon` (the pill), `glyph` (the strip), `turns`, and `quiet`. `runStatusOrder` and `variantStatusOrder` list the eight run states and the seven variant states in the order of a legend.
- `getRunResultName(run)` gives the last result of a closed run (`closedState`, D-UX-04): `passed`, `rejected`, or `failed`, else `replaced`. Use it for a row and for a result filter.
- `getStripStatusName(variant)` is `getReviewStatusName` with `added` and `removed` for an approved variant of that kind.
- `StatusGlyph` props: `status`, `label`, `decorative` (hide it when text or a name beside it says the status), `stamp` (milliseconds before the arrive motion: pass it only in the render that changes the status, with `key={status}`).
- `getRoleLayer(role)` and `getRoleText(role)` give the `$layer` and the `$text` value of a role.
- In a control, do not put a `StatusPill` (a badge in a button). Put the icon in a slot, as `RunRow` does, or a `StatusGlyph`.

The reference surface `status-mark` renders this file: the 15 states in both forms, the compact pill in a run row, a strip of links, counts, and the pill on each surface.

### `run-row.tsx`

The one row of a run, for the Queue, History, and the pull request sheet.

```tsx
<Text className={cx(tertiary, "text-sm")}>Running</Text>
<RunRowList aria-label="Running">
  {runs.map((run) => (
    <RunRow key={run.id} run={run} />
  ))}
</RunRowList>

<RunRowSkeleton count={3} />
```

- `RunRow` takes a `Run` and links to its page (`getRunTarget`). It shows the status as a tinted disc, the title, the identity line (`#7753 · attempt 2 · 23 min ago`, with the login when the data has it), and the state text at the end.
- What the end shows follows the data. A run to review has the review bar over its count: two parts (rejected and open) without `counts`, and three (approved, rejected, open) with them. A running run has its word, and the stock `Progress` with `1,290 of 3,832` only with `progress`. A failed run has `Failed`, or the error sentence when the data has one, on two lines at most. A closed run has the reason (`Replaced`, `Closed`) and its last result as the disc.
- `soft` draws a row in soft ink, for an earlier run under the newest run of its pull request. A run that a newer run replaced is soft by itself.
- `RunRowList` is one group: `Sheet $p={1}` around a vertical `ButtonGroup $p="none"` with a hover and a focus glider. It is the size container of its rows. Below 28rem of list width a row puts its state text under its identity line.
- `RunRowSkeleton` has the same sheet and one row of blocks for each run. A skeleton row has the height of a run row (61 px), and its blocks start where the text of a row starts. `still` stops the pulse, under an `ErrorBand`.
- `getRunRow(run)` is the pure model of a row, `getReviewShares(row)` the parts of the bar, and `ReviewBar` the bar alone (the pull request sheet uses it).

A row holds one link. A second control of a row, for example the button that unfolds earlier runs in History, is a sibling of the `RunRow`, not a child.

### `error-band.tsx`

```tsx
<ErrorBand
  icon={CloudOff}
  title="Could not load runs"
  detail={inbox.message}
  errorId={inbox.reference}
  action={
    <ErrorBandButton busy={inbox.refreshing} onClick={inbox.refresh}>
      Try again
    </ErrorBandButton>
  }
/>
<RunRowSkeleton still />

<ErrorBand
  tone="warning"
  role="status"
  icon={TriangleAlert}
  title="Could not refresh"
  detail="list of 4 min ago"
  action={<ErrorBandButton onClick={inbox.refresh}>Try again</ErrorBandButton>}
/>
```

- `tone`: `danger` (the default), `warning`, `brand` (news that is no failure, for example a new version of the app), `neutral` (a permanent state, for example expired images).
- `title` says what failed. `detail` is one more fact in lower case: the band joins the two with a dot. `errorId` is a small button that copies the identifier.
- `action` is one `ErrorBandButton`: a small outlined button, never the brand button. For a link that leaves the app, pass `render` and an `icon`.
- `role`: `alert` (the default) interrupts. `status` is for a failure that leaves the content on screen, and for a permanent state.
- The band follows its own width. Below 32rem it has two lines: the title with the action, then the detail. From 32rem it is one line. `narrowDetail` fills the second line of a narrow band that has no detail.
- `cover` lays the band flush on the top edge of the frame around it, for an image well. The band must be the first child of that frame.
- `titleId` names the title, so that a control that the error turns off can point at it with `aria-describedby`.

The reference surface `error-state` shows eight failures with this band.

### `place.tsx`

A screenshot and a variant are a place in the URL: `#s=<screenshot key>&v=<variant key>`.

```tsx
// The page: the selection follows the URL, and the URL follows the selection.
const session = useReviewSession(scenario);
useReviewPlace(session);

// A row of the list: a link to a screenshot.
<NavLink
  aria-current={item.key === session.item?.key ? "true" : undefined}
  render={<PlaceLink itemKey={item.key} />}
/>;
```

- `PlaceLink` takes `itemKey` and an optional `variantKey`. A plain click selects the place without a reload and without a new history entry. A click with Cmd or Ctrl opens the place in a new tab. It takes `render`, as `LabLink` does.
- `PlaceLink` does not know the selection. Mark the selected link with `aria-current`, so that a glider finds it.
- `useReviewPlace(session)` selects the place of the URL at load and after each click on a `PlaceLink`, and writes the place when a key or a decision moves the selection. A place that is not in the run changes nothing.
- `usePlace()` reads the place of the URL on a page without a session. `parsePlaceHash` is the pure function behind it.

### `view-store.ts` and `view-types.ts`

```tsx
const stored = useStoredView();
const view = useStageView({ variant, mode: stored.mode });
<ReviewStage variant={variant} item={item} view={view} mode={stored.mode} mask={stored.mask} />
<ReviewBar session={session} view={view} stored={stored} />
```

- `useStoredView()` keeps `{ mode, mask }` in local storage under `visonaut-lab:review-view`, so a selection stays between screenshots, variants, and runs. A browser with no stored value gets the current image with the mask on (D-WORK-02). The server renders that view too.
- A variant that cannot show the stored mode shows the current image for that variant only. Do not write the fallback to the store.
- `resetStoredView()` forgets the stored value. The lab menu of the bar calls it.
- The zoom is not stored. It belongs to `StageView`.
- `view-types.ts` has the contract between the page, the stage, and the bar: `ViewMode`, `ZoomLevel`, `StoredView`, `StageView`, and `zoomSteps` (50 to 800%). The stage and the bar import it, and never each other.

### `regions.ts`

The one reader of changed regions. The service sends the mask of a change and no regions, so the browser reads the regions from the mask image: one box around each group of changed pixels, and groups that lie at most 8 px apart are one region.

```tsx
const getRegions = useRegionLookup(item.variants);
const regions = getRegions(variant);

const regions = useRegions(variant);
```

- The result is the regions of the API when the data has them, else the regions of the mask. It is undefined until the mask is read and for a variant without a mask, and empty when the mask cannot be read.
- Each mask of the document loads one time, whoever asks: the stage, a row of the list, a cell of the cover.
- A part that the browser takes over from the server markup gets no mask regions in that first render, also when another part already read the mask. The regions come with the next render.
- A mask of another origin needs CORS headers.

### `use-hydrated.ts`

```tsx
const hydrated = useHydrated();
const hash = hydrated ? location.hash : null;
```

`useHydrated()` is false on the server and while the browser takes over the server markup, then true. Use it for each fact that only the document knows: the hash of the URL (`place.tsx`), or the images that the document has shown (`stage/images.ts`).

### `surfaces.tsx`

```tsx
<Sheet className="grid gap-3">
  <Well $p={1.5}>…</Well>
</Sheet>

<EmptyState icon={Check} tone="success" title="All reviewed" action={historyButton}>
  Baseline 412
</EmptyState>

<Skeleton className="h-3.5 w-2/3" />
<Skeleton soft className="h-3 w-1/3" />
<Skeleton still className="h-3.5 w-2/3" />
```

`EmptyState` props: `icon`, `tone`, `title`, `children`, `action`, `bare` (no dashed frame, inside a sheet). `Skeleton` props: `soft` (the second line of a row) and `still` (no pulse, under an error band).

### `skeleton-line.tsx`

```tsx
<SkeletonLine className="w-2/3 text-lg" />
<SkeletonLine soft className="w-24 text-xs" />
```

A `Skeleton` bar in a box with the height of one line of text. Give it the text size of the line that it stands for and the width of the bar. A row of these has the height of the words that replace it, at every density.

### `controls.tsx`

```tsx
<IconButton label="Undo" shortcut={["⌘", "Z"]} icon={<Undo2 strokeWidth={iconStroke} />} onClick={undo} />

<Hint label="Queue">
  <Button aria-label="Queue" render={<LabLink to="inbox" />}>…</Button>
</Hint>

<ak.MenuProvider values={{ grid: on }} setValues={(values) => setOn(values.grid === true)}>
  <ak.MenuButton render={<Button aria-label="More" />}>…</ak.MenuButton>
  <Menu>
    <MenuHeading>Lab</MenuHeading>
    <MenuItem shortcut={["⇧", "A"]} onClick={approveAll}>Approve all 6</MenuItem>
    <MenuItemCheckbox name="grid">Pixel grid</MenuItemCheckbox>
    <MenuSeparator />
    <MenuItem icon={<Copy strokeWidth={iconStroke} />} onClick={copy}>Copy link</MenuItem>
  </Menu>
</ak.MenuProvider>

<MoreInfo heading="About this page">Alerts refresh each minute while this page is open.</MoreInfo>

<Avatar user={run.author} />
<ButtonSlot $kind="avatar" $layer="brand"><AvatarContent user={user} /></ButtonSlot>
```

- `MenuItem` prints its `shortcut` as dimmed text in the stock shortcut slot of an option. `MenuItemCheckbox` is a row with the stock check. `MenuHeading` is a soft label, not uppercase.
- `Hint` and `IconButton` print a key as a `Kbd` cap in the tooltip.
- `Avatar` is a `span`, so it can sit in a line of text. Without a picture it shows initials (`getInitials`). Without a user it is an empty disc.

### `keys.tsx`

```tsx
// A key on a control: dimmed text, no cap. It hides while the switch is off.
<Button $kind="bevel" $layer="brand">
  <ButtonLabel>Approve</ButtonLabel>
  <ShortcutSlot keys={["A"]} />
</Button>

// The page: the provider, the list of keys, and the account menu that opens it.
<ShortcutsProvider>
  <AccountMenu user={user} />
  <ShortcutsDialog groups={reviewKeyGroups} readOnly={session.readOnly} />
</ShortcutsProvider>

// Keys of a page. Return false from a handler to leave the key to the browser.
usePageKeys({ "[": () => setListOpen(!listOpen) });
```

- `ShortcutSlot keys={["⇧", "A"]}` prints `⇧A` as one soft text. It is the stock `ButtonSlot $kind="shortcut"` with a plain `<kbd>`.
- `ShortcutsDialog` is the dialog `Keys`. `KeyList` is the list alone. A `ShortcutGroup` has `title`, `items`, `inline` (its rows on one line under the other groups), and `decides` (a read-only run refuses its keys: the rows are soft and the group says `Read-only`). An item has `keys` and `label`. A key is a string, or an array for the caps of one chord: `[["⇧", "A"]]`. Give each chord its own row: the caps column is as wide as its widest row, and a row with two chords pushes the words of its group away from the caps.
- `useShortcuts()` returns `{ enabled, setEnabled, open, setOpen, provided }`.
- `usePageKeys` needs a `ShortcutsProvider` above it. A hook in the component that renders the provider is above it: call the hook in a child component. It ignores text fields, menus, and dialogs, and keys with Meta, Control, or Alt.

### `preview-well.tsx`

`PreviewWell` is a recessed strip with at most four previews of a run. Each preview is a link to the review. It renders nothing without previews, so only the data mode All proposed fields shows it: on the next run card of the Queue.

### `runs.tsx`

- `getRunTarget(run)` gives `{ to, scenario }`: the lab page that a run opens. `RunRow` uses it. Use it for every other link to a run.
- `formatAge(timestamp)` is the relative time without `ago`: `12 min`, `3 h`. `getRunNumber(run)` is `#7754` or `main`. `hasRunWords(run)` is false when the API sent no title and no commit message.

## Folders

The parts of the review page. Each folder is one part with its model, and the review page (`pages/review/ariakit/`) composes them.

| Folder      | Main exports                                                                     | Part of the review page                                                                  |
| ----------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `list/`     | `useScreenshotList`, `ScreenshotList`, `ScreenshotListSkeleton`, `ScreenshotRow` | The sidebar: the one field (status select and search) and the rows with a crop           |
| `variants/` | `VariantNav`                                                                     | The start of the variant row: the stepper, the pager of marks as links, the `All` button |
| `stage/`    | `useStageView`, `ReviewStage`, `ChangeLine`, `DetailsButton`, `CoverPicture`     | The stage, and the end of the variant row. See `stage/README.md`                         |
| `bar/`      | `ReviewBar`, `getBarMessage`, `RunApprovalDialog`                                | The one bar of the stage, a floating pill, and its messages. See `bar/README.md`         |
| `result/`   | `RunProgress`, `ResultPage`                                                      | The run progress of the header, and the page at the end of a review (D-WORK-05)          |

```tsx
const list = useScreenshotList(session);
const stored = useStoredView();
const view = useStageView({ variant, mode: stored.mode, expired: review.imagesExpired });

<ScreenshotList list={list} />
<RunProgress session={session} onShowResult={() => setResultOpen(true)} />
<VariantNav item={item} variant={variant} cover={cover} onCoverChange={setCover} onStep={step} onSelect={session.selectVariant} />
<ReviewStage variant={variant} item={item} view={view} mode={stored.mode} mask={stored.mask} gutterBottom={4} />
<ReviewBar session={session} view={view} stored={stored} ready={!view.images.failed} />
<ResultPage session={session} onLeave={() => setResultOpen(false)} onShowAll={() => list.setStatus("unchanged")} />
```

- Each part has the form that round 2 settled, and no prop selects another one: a row of the list has its picture, the variant control is the stepper with the cover on request, and the bar is the floating pill. `VariantNav` has the `All` button when it gets `onCoverChange`.
- A row of the list, a mark of the pager, and a cell of the cover are `PlaceLink`s.
- The folders import the files of the kit root and never each other.

## Pitfalls that cost time

1. **A tooltip is a popover context.** A `PopoverDisclosure` or an `ak.MenuButton` inside a `Hint` (or an `IconButton`) opens the tooltip store, not your popover. Create the store and pass it by name: `const store = ak.usePopoverStore()`, then `<Hint><PopoverDisclosure store={store} /></Hint>` and `<Popover store={store} portal />`. `MoreInfo` shows the pattern.
2. **`Badge`, `Button`, and every control are `position: relative`.** The class `absolute` does not win over the recipe. Wrap the control in a positioned `span`.
3. **A `div` in a `p` breaks hydration.** `Frame` is a `div`. In a line of text use `Text`, or pass `render={<span />}`.
4. **A row with a truncated label pushes its end slot out of a grid.** `Nav`, `NavGroup`, and the body of a `NavDisclosure` are grids with an automatic column. Give them `className="grid-cols-[minmax(0,1fr)]"` (for a disclosure: `content={{ body: { className: "grid-cols-[minmax(0,1fr)]" } }}`), and give the label `$truncate className="min-w-0 flex-1"`.
5. **`Progress` and `ProgressCircular` fill their parent.** Size a wrapper, not the progress: `<span className="w-32"><Progress /></span>`.
6. **A slot has no `$text`.** Color an icon in a slot, or outside a control, with `<Text $text="warning" className="flex"><TriangleAlert /></Text>`.
7. **A custom key for Enter blocks buttons.** The `keys` option of `useReviewShortcuts` prevents the default action of each key that it has. Do not bind Enter. Give the focus to the button that Enter must press.
8. **Do not read the browser during render.** For a stored setting use `useSyncExternalStore` with a server snapshot, as `ShortcutsProvider` and `useStoredView` do. A `setState` in an effect fails the lint. A value in a module is the browser too: a cache that one part fills is there when the next part takes over its server markup, and that part then fails hydration. A page with several parts in `Suspense` boundaries, such as the component explorer, takes them over one by one. Gate the read with `useHydrated`.
9. **The disabled look removes the surface of a button.** A brand button that waits (`Opening GitHub`) then looks like bare text. Keep the button enabled, pass `aria-busy`, and drop its `onClick` while it waits. An outlined button keeps its edge, so `ErrorBandButton` is disabled while it is busy.
10. **Two classes for one property do not override each other by their order in `className`.** `no-underline` does not win over the `underline` of `Link`. Use a variant that raises the specificity: `not-hover:not-focus-visible:no-underline`.
11. **The router link marks a place as the current page.** A `Link` of the router to the same path has `aria-current="page"`, so every link of a strip would be selected. `PlaceLink` is an anchor that navigates with the router and sets no state. Pass `aria-current` yourself.
12. **A container cannot query itself.** `ErrorBand` and `RunRowList` are size containers, and their children use `@lg:` and `@max-md:`. Classes of that kind on the part itself follow the next container above it.
13. **Other builders edit the same checkout.** A file change of another builder can reload your page in the middle of a capture. When a screenshot shows the first state of the page again, capture it again before you change code.
14. **A value in a module is not state.** A render that only such a value changes never happens. When an event changes what a part shows, put the change in state too: the stage records the end of an image request with `setRequests`, and it reads the set of loaded images only for a request that it did not start.
15. **A Playwright screenshot can look like a hydration mismatch.** While it takes a picture, Playwright sets `caret-color: transparent` on the focused input. When a part hydrates in that moment, React reports the style as a mismatch. Count console errors in a run without screenshots before you search the code.
