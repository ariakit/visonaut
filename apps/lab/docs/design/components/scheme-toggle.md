# Scheme toggle (scheme-toggle)

Group: shell
Question: Where does the color scheme control live, and which form does it take?
Description: The control for dark, light, or system; today the app follows the system and has no control.
Layout: row

## Scenarios

- `system` (System): The default: the app follows the system setting.
- `dark` (Dark): Dark is forced.
- `light` (Light): Light is forced.
- `open` (Open or focused): The menu, tooltip, or focus state of the control.
- `compact` (Compact): The control in a 44 px header at 390 px.

## Variant `cycle-button`: Cycle button

One icon button that steps through system, light, and dark.

Ideas:

- 32 px and no words.
- The icon shows the current value; the tooltip and the name say it in words.

Tradeoffs:

- Up to two clicks to reach a value.
- An icon that shows state can read as an action (does the sun mean light now, or go to light?).
- The value System is not visible as an option.

### Spec

**Sketch**

```text
system  [mon]      light  [sun]      dark  [moon]         tooltip: Scheme: system
```

**Build** `TooltipProvider` + `TooltipAnchor render={<Button $p={2} aria-label='Scheme: system' />}` with one `ButtonSlot` (`Monitor`, `Sun`, or `Moon`) + `Tooltip`. An `sr-only` text with `aria-live='polite'` repeats the new value. Lab cell: a header stand-in strip (`Frame $layer $border $rounded='lg' className='flex h-11 w-60 items-center justify-end px-3'`) with the control. The choice is local state: the Look menu of the lab owns the real theme.
**Copy** `Scheme: system`, `Scheme: light`, `Scheme: dark`. Words: 0.
**Behavior** Click, Enter, or Space goes to the next value in the order system, light, dark. The product stores the value in this browser and applies it before the first paint. No key.
**States**

- `system`: `Monitor`.
- `dark`: `Moon`.
- `light`: `Sun`.
- `open`: the tooltip drawn open (`open` on the provider).
- `compact`: the same button.

## Variant `segmented`: Segmented

Three segments with a glider: all values visible, one click.

Ideas:

- No hidden state: the three values and the current one are on screen.
- It is a radio group, so the arrow keys move the choice.
- Icons only in a header; icons with words in a menu row.

Tradeoffs:

- 96 px of header for a control that is used a few times a year.
- The glider needs CSS anchor positioning.

### Spec

**Sketch**

```text
header   [ mon | sun | moon ]          menu row   Scheme   [ System | Light | Dark ]
```

**Build** `ak.RadioProvider` + `ak.RadioGroup aria-label='Scheme' render={<ButtonGroup $border $size='sm' />}` + three `ak.Radio render={<Button aria-label='System' />}` (`ButtonSlot` icon; `ButtonLabel` in the menu row form) + `ButtonGlider` + `ButtonGlider $state='focus'`. The glider is flat (D17 selected flat controls). Lab cell: as `cycle-button`.
**Copy** `Scheme`, `System`, `Light`, `Dark`. Words: 0 in a header, 4 in a menu row.
**Behavior** A click or an arrow key selects. Stored and applied as `cycle-button`. No key.
**States**

- `system`, `dark`, `light`: the glider is on that segment.
- `open`: the menu row form with words, drawn in a panel with the `popover` recipe and `data-open`.
- `compact`: icons only.

## Variant `menu-rows`: Rows in a menu

No header control: three radio rows in the account menu.

Ideas:

- Zero header space.
- Words, not icons: there is no meaning to guess.
- The menu stays open after a choice, so the effect is visible.

Tradeoffs:

- Two clicks, and hidden: people look for a sun or a moon in the header.
- It needs an account menu that is a menu (not `inline-confirm`).

### Spec

**Sketch**

```text
+----------------------+
| Scheme               |
|   System           v |
|   Light              |
|   Dark               |
+----------------------+
```

**Build** Inside the account menu: `ak.MenuGroup` + `ak.MenuGroupLabel render={<TextFrame $p={2} $ink={60} className='text-xs' />}` + three `ak.MenuItemRadio name='scheme' hideOnClick={false} {...option.jsx()}` with `OptionLabel className='flex-1'` and `ak.MenuItemCheck` in an `OptionSlot`. Lab cell: as `cycle-button`, with an avatar stand-in as the trigger; the panel is drawn in flow with the `popover` recipe and `data-open`.
**Copy** `Scheme`, `System`, `Light`, `Dark`. Words: 4.
**Behavior** Up, Down, Enter, or Space in the menu. Stored and applied as `cycle-button`.
**States**

- `system`: the trigger only (nothing shows in the header).
- `dark`: the panel open, `Dark` checked.
- `light`: the panel open, `Light` checked.
- `open`: the panel open, `System` checked, with the focus ring on that row.
- `compact`: the panel at the frame width.

## Variant `match-variant`: Match the screenshot

A fourth value: the workspace takes the scheme of the screenshot under review.

Ideas:

- A dark screenshot in light chrome glares; the scheme of the selected variant is known (`axes.colorScheme`).
- Only the workspace (tool row, stage surround, list) follows; the header keeps the base scheme.
- A 150 ms cross-fade softens the change; none with reduced motion.

Tradeoffs:

- The chrome changes each time the reviewer moves between a light and a dark variant: a flash that can be worse than the glare.
- Two schemes are on screen at one time.
- `Match` needs a tooltip to be understood, and it does nothing outside a run.
- No audit lane and no earlier decision covers it.

### Spec

**Sketch**

```text
[ mon | sun | moon | match ]        tooltip on match: Match the screenshot
stand-in:  [ Light variant ] [ Dark variant ]   ->   the surround flips
```

**Build** As `segmented`, with a fourth `ak.Radio` (`SunMoon` icon, name `Match`) in a `TooltipAnchor`. Lab cell: as `cycle-button` at `w-90`, plus a stage stand-in under the strip: `Frame $rounded='lg' $p={3} $invert={flipped}` around the image of `getScreenshot({ scene: 'button', scheme, state: 'current' })`, and a two-button `ButtonGroup` (`Light variant`, `Dark variant`) that sets `scheme`. `flipped` is true when `Match` is on and the variant scheme differs from the lab theme (`usePreview().theme`).
**Copy** `System`, `Light`, `Dark`, `Match`; tooltip `Match the screenshot`. Words: 0.
**Behavior** With `Match`, a change of the selected variant sets the workspace scheme. Stored as `cycle-button`. No key.
**States**

- `system`, `dark`, `light`: that segment; the stand-in does not flip.
- `open`: `Match` selected, the tooltip drawn open; the stand-in follows the variant buttons.
- `compact`: four icons.
