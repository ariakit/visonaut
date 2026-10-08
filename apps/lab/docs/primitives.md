# Ariakit UI primitives for the lab

This guide tells you how to build lab variants with the Ariakit UI primitives in `src/components/ariakit`. Read the mental model and the pitfalls first. Then copy from the primitive sections and the recipes.

The live reference is the `/primitives` route (`src/routes/primitives.tsx`). Every code block in this guide is copied by a script from a typed example in `src/lab/primitives/*.tsx`, and the route renders each example. If a block looks wrong, open the route and compare.

- [Setup facts](#setup-facts)
- [Pitfalls to know first](#pitfalls-to-know-first)
- [Mental model](#mental-model)
- [Shared props](#shared-props)
- [Primitives](#primitives)
- [Recipes](#recipes)
- [Do and do not](#do-and-do-not)
- [What the primitives cannot do yet](#what-the-primitives-cannot-do-yet)

## Setup facts

Import each primitive with a relative path that includes the file extension. From `src/explorations/pages/<surface>/<variant>.tsx`, the path is:

```tsx
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../../../components/ariakit/components/frame.ariakit.react.tsx";
```

- Components are in `components/ariakit/components/<name>.ariakit.react.tsx`. Recipes (the `cv` objects, such as `popover` and `option`) are in `components/ariakit/styles/<name>.ts`. Do not edit either folder.
- For behavior that has no styled wrapper, import `* as ak from "@ariakit/react"` and give the Ariakit component a primitive through `render`, or a recipe through `{...recipe.jsx()}`. Examples: a radio that is a button, a menu, a checkbox store.
- Icons come from `lucide-react`. Join class names with `cx` from `clava`.
- The bare preview renders a variant alone at a 16px base font, with no frame around it. The lab shell renders its own pages at 14px.
- `--spacing` is `0.25em` and `--radius` is `0.25em`. Thus every Tailwind spacing utility (`p-4`, `gap-2`, `w-64`, `size-5`), every `$p` step, and every `$rounded` step scales with the font size of the element. `p-4` is 16px at `text-base` and 14px at `text-sm`.
- The Look menu of the lab changes `--color-brand`, `--color-canvas`, `--radius`, and `--spacing`. A variant follows these controls only if it uses `$layer` colors, named `$rounded` steps, and spacing steps. Do not write pixel values or hex colors.
- The first request after you import a dependency that Vite has not optimized yet can fail one time with `Cannot read properties of null (reading 'useState')`. Reload the page.

## Pitfalls to know first

These facts are verified in this stack. Each one cost time to find.

1. **There is no `"primary"` color.** The named colors are `"canvas"`, `"brand"`, `"secondary"`, `"success"`, `"warning"`, and `"danger"`. `$layer="primary"` is not an error, but it renders a neutral near-white surface. Use `"brand"`.
2. **A nested frame does not keep its own radius.** Inside a frame with less than 1rem of padding, a child frame, button, input, or badge takes the concentric radius: parent radius minus parent padding minus parent border. In a card with `$rounded="xl" $p={3}`, a button has a 2px radius and a badge is not a pill. Fix it with a parent padding of 1rem or more (`$p="1rem"`), with a parent radius that leaves a good remainder (`$rounded="2xl" $p={2}` gives 7px), or with `$forceRounded` on the child. Always pass `$forceRounded` to a `Badge` in a table cell.
3. **The shell is a frame with a 20px radius.** The same rule applies to its parts. A frame that is a direct child of `ShellMainBody` takes 20px minus the main gutter. With the default gutter (`$p={3}`), a card with `$rounded="xl"` renders with 8px. Set `ShellMain $p="1rem"` or more to get the radius that you declare.
4. **`Heading` is an `h1` at 2.25em unless a `HeadingLevel` is around it.** Wrap the page in one `HeadingLevel` and each nested section in another, or pass `$level` or a `text-*` class for the size.
5. **`Heading` has flow margins.** It takes a 1em top margin and a 0.5em bottom margin when it is not the first or last child. In a flex or grid row, remove them with `className="mt-0 mb-0"`. The `m-0` and `my-0` classes do not win.
6. **`$text` on a control colors its labels and icons, not its bare text.** `<Button $text="danger">Delete</Button>` stays neutral. Put the text in `ButtonLabel`.
7. **`Text` has no `$ink` prop.** For soft text, use the `ak-ink-*` class on the text element (`className="ak-ink-60"`). `$ink` exists on layer elements: `Frame`, `Button`, `TextFrame`, slots.
8. **A button has no selected look of its own.** Selection comes from a glider in a `ButtonGroup`, from `Tab`, from `NavLink`, or from props that you derive from React state. `aria-pressed` does not style anything.
9. **Gliders need CSS anchor positioning.** They are hidden in a browser without it. Current Chrome is fine.
10. **`$lighten` cannot go above white.** On the light canvas a raised frame has almost the same color as the canvas. Give raised surfaces a `$border` (it is a border on dark and a ring on light) or a shadow.
11. **`List` is a content list, not a menu or a row list.** For rows that act, use `Button`, `Nav`, or `Table`.
12. **The dark variant of Tailwind follows the page theme, not the surface.** Use `ak-dark:` and `ak-light:` when a style must follow the color of the layer around the element. An inverted or brand frame is a dark surface on a light page.

## Mental model

**Layers are surfaces and color contexts.** The `body` is the canvas layer. An element with a layer takes its background, its text color, and its edge color from that layer, and its descendants compute their colors from it. You never choose a text color for contrast. Add a layer only for a surface with a purpose: a card, a well, a bar, a control. Layout wrappers have no layer.

**Layer colors are relative.** `$lighten` raises a surface and `$darken` recesses it. `$lightnessOffset` separates a surface in the direction that suits the theme (darker on light, lighter on dark). One step is 5% lightness, `true` is one step, and half steps are the normal grain. `$layer="brand"` (or another named color, or a CSS color) starts a new material. `$mix={15}` turns a color into a tint of the surface behind it. `$invert` gives the high-contrast neutral. The same props give another color at each nesting level, so do not nest surfaces without a reason.

<!-- prettier-ignore -->
```tsx
<Frame $rounded="lg" $p={3}>
  Same plane
</Frame>
<Frame $lighten $rounded="lg" $p={3}>
  Raised
</Frame>
<Frame $darken $rounded="lg" $p={3}>
  Recessed
</Frame>
<Frame $lightnessOffset={2} $rounded="lg" $p={3}>
  Separated
</Frame>
<Frame $contrast $rounded="lg" $p={3}>
  Contrast
</Frame>
<Frame $invert $rounded="lg" $p={3}>
  Inverted
</Frame>
```

**`"transparent"` is a layer that paints nothing.** `Frame`, `Button`, `Nav`, and `Shell` open a transparent layer: they give their content a color context, and they paint only when a layer prop or a state moves the color. So `<Frame $lighten>` paints, and `<Frame $layer>` paints the color of the parent, which looks like nothing but covers what is behind it (use it for sticky bars). Do not add a second painted layer where the transparent one works.

**Frames are geometry.** `$rounded` takes a named step, `$p` takes a spacing step, and `$border` draws the edge. Nested frames keep their corners concentric (see pitfall 2). `$cover` stretches a child over the padding of its parent and squares the inner corners, for header and footer bands.

<!-- prettier-ignore -->
```tsx
<Frame $lighten $border $rounded="3xl" $p={2} className="grid w-40 gap-2">
  <Frame $darken $rounded="md" $p={3}>
    Concentric
  </Frame>
  <Frame $darken $rounded="md" $p={3}>
    Concentric
  </Frame>
</Frame>
<Frame $lighten $border $rounded="3xl" $p={2} className="grid w-40 gap-2">
  <Frame $darken $rounded="md" $forceRounded $p={3}>
    Forced md
  </Frame>
  <Frame $darken $rounded="md" $forceRounded $p={3}>
    Forced md
  </Frame>
</Frame>
<Frame $lighten $border $rounded="3xl" $p="1rem" className="grid w-40 gap-2">
  <Frame $darken $rounded="md" $p={3}>
    1rem: own md
  </Frame>
  <Frame $darken $rounded="md" $p={3}>
    1rem: own md
  </Frame>
</Frame>
```

**Edges are part of the layer.** `$border` alone picks a border or a ring for the theme. `$borderType` forces `"border"`, `"ring"`, `"inset"`, `"dashed"`, or `"dotted"`. `$edgeWeight` sets the strength and `$edge` the color. One-sided seams (`border-b`, `border-t`) and shadows (`shadow-md`) are Tailwind classes on an element that has a layer, so they take the adaptive edge color.

**Text has two controls.** Ink is strength: `$ink` on a layer, or `ak-ink-70` on a text element, from 0 (the weakest readable) to 100. Color is `$text` on `Text`, `Heading`, `Link`, and control labels, with automatic contrast. Sizes and weights are Tailwind classes.

**A control is a row of parts.** `Button`, `Badge`, `Input`, `NavLink`, `Tab`, and the option rows share one recipe: a text frame whose padding, gap, and icon size follow the font size (`$size`). Put text in the `*Label` part and each icon, badge, avatar, or shortcut in a `*Slot` part. A slot needs a label element beside it to space itself.

<!-- prettier-ignore -->
```tsx
<Button $lightnessOffset>
  <ButtonSlot>
    <Plus />
  </ButtonSlot>
  <ButtonLabel>Leading icon</ButtonLabel>
</Button>
<Button $lightnessOffset>
  <ButtonLabel>Trailing icon</ButtonLabel>
  <ButtonSlot $size="sm">
    <ChevronDown />
  </ButtonSlot>
</Button>
<Button $lightnessOffset aria-label="Settings">
  <ButtonSlot>
    <Settings />
  </ButtonSlot>
</Button>
<Button $lightnessOffset>
  <ButtonLabel>Badge</ButtonLabel>
  <ButtonSlot $kind="badge" $p="md">
    12
  </ButtonSlot>
</Button>
<Button $lightnessOffset>
  <ButtonLabel>Shortcut</ButtonLabel>
  <ButtonSlot $kind="shortcut">
    <kbd>⌘S</kbd>
  </ButtonSlot>
</Button>
<Button $lightnessOffset>
  <ButtonSlot $kind="avatar" $layer="brand">
    DH
  </ButtonSlot>
  <ButtonLabel>Avatar</ButtonLabel>
</Button>
<Button $lightnessOffset>
  <ButtonSlot $size="xl" $layer="success" $mix={20}>
    <Check />
  </ButtonSlot>
  <ButtonLabel>Painted slot</ButtonLabel>
</Button>
```

**State comes from the DOM.** Hover, focus, press, disabled, invalid, checked, selected, and current styles come from pseudo-classes and ARIA attributes, not from props. An element is selected when it is `:checked` or has `aria-checked="true"`, `aria-selected="true"`, or any `aria-current` value. Props such as `$hoverOffset`, `$focus`, and `$selectedPush` only tune each state.

**A glider marks the active control.** It is one element at the end of a `ButtonGroup` or `TabList`, or the `glider` prop of a `Nav`. It travels to the selected, hovered, or focused control.

**`render` composes.** Every primitive takes `render` to swap its element and keep its styles: a router link, an anchor, a `label`, a `section`. The router link marks the current page with `aria-current`, so a `NavLink` or `Button` that renders it shows the current state.

<!-- prettier-ignore -->
```tsx
<Button $lightnessOffset render={<RouterLink to="/" />}>
  <ButtonLabel>Router link</ButtonLabel>
</Button>
<Button $lightnessOffset render={<a href="https://ariakit.com" />}>
  <ButtonLabel>Anchor</ButtonLabel>
</Button>
<Link render={<RouterLink to="/" />}>Text link</Link>
<Frame $lighten $border $rounded="lg" $p={2} render={<section aria-label="Section frame" />}>
  section
</Frame>
<Text render={<label htmlFor="render-composition-input" />} className="text-sm font-medium">
  label
</Text>
<Input id="render-composition-input" placeholder="Input" $size="sm" />
```

**Dark and light are one design.** The theme sets only `--color-canvas`. Everything else is relative to it. Build in dark, then check light with `?theme=light`.

## Shared props

Most primitives extend `frame`, so they take the layer, frame, and edge props. Controls also take the control and state props.

| Group    | Prop                                                         | Values                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layer    | `$layer`                                                     | `true` (parent color), `"transparent"`, `"canvas"`, `"brand"`, `"secondary"`, `"success"`, `"warning"`, `"danger"`, any CSS color, `false` (no layer)                                                     |
| Layer    | `$lighten`, `$darken`, `$lightnessOffset`, `$lightnessPush`  | `true` (one step) or a number of steps. `$lightnessOffset` also takes `0` and negative values                                                                                                             |
| Layer    | `$invert`, `$contrast`                                       | `true`. `$contrast` also takes 0 to 100 (`true` is 25)                                                                                                                                                    |
| Layer    | `$mix`                                                       | Percent of blend with the parent, 0 to 100 (`true` is 50). Badges use 15                                                                                                                                  |
| Layer    | `$chroma`, `$hue`, `$saturate`, `$desaturate`                | `$chroma`: `"muted"`, `"balanced"`, `"vivid"`, `"neon"`, or 0 to 40. `$hue`: `"red"`, `"orange"`, `"yellow"`, `"green"`, `"cyan"`, `"blue"`, `"magenta"`, a harmony such as `"complementary"`, or degrees |
| Layer    | `$ink`                                                       | 0 to 100                                                                                                                                                                                                  |
| Frame    | `$rounded`                                                   | `"none"`, `"xs"`, `"sm"`, `"md"`, `"lg"`, `"xl"`, `"2xl"`, `"3xl"`, `"4xl"`, `"full"`, or a length. At 16px: 0, 2, 4, 6, 8, 12, 16, 24, 32                                                                |
| Frame    | `$p`, `$m`                                                   | A spacing step (`3` is 0.75em), a length (`"1rem"`), `"none"`                                                                                                                                             |
| Frame    | `$forceRounded`, `$cover`, `$orientation`                    | `true`. `$orientation`: `"horizontal"`, `"vertical"` (for the corners of `$cover` children)                                                                                                               |
| Frame    | `$border`                                                    | `true` (1px), a width in pixels, `false`, `"inherit"`                                                                                                                                                     |
| Frame    | `$borderType`                                                | `"auto"`, `"border"`, `"ring"`, `"inset"`, `"dashed"`, `"dotted"`                                                                                                                                         |
| Edge     | `$edgeWeight`                                                | `"adaptive"` (high contrast only), `"light"`, `"normal"`, `"medium"`, `"bold"`, or 0 to 100                                                                                                               |
| Edge     | `$edge`, `$edgeRaw`                                          | A named color or a CSS color. `$edgeRaw` paints it at full strength                                                                                                                                       |
| Text     | `$text`                                                      | `true` (a tint of the layer), a named color, a CSS color                                                                                                                                                  |
| Text     | `$textPush`, `$textChroma`, `$textHue`                       | Same scales as the layer props                                                                                                                                                                            |
| Control  | `$size`                                                      | `"auto"`, `"xs"`, `"sm"`, `"md"`, `"lg"`, `"xl"`                                                                                                                                                          |
| Control  | `$px`                                                        | `"sm"`, `"md"`, `"lg"`, `"xl"` (the optical side padding), or a length                                                                                                                                    |
| Control  | `$gap`                                                       | `"none"`, `"sm"`, `"md"`, `"lg"`, `"xl"`                                                                                                                                                                  |
| Hover    | `$hoverOffset`, `$hoverLighten`, `$hoverDarken`, `$hoverInk` | Steps, or 0 to 100 for the ink. `false` removes a default                                                                                                                                                 |
| Focus    | `$focus`, `$focusOffset`, `$focusHighlight`                  | `$focus`: `true`, `1`, `2`, `3`. `$focusOffset`: `0`, `1`, `2`. `$focusHighlight` fills with brand in place of the ring                                                                                   |
| Press    | `$active`, `$activeDepth`                                    | `false` removes the press scale                                                                                                                                                                           |
| Selected | `$selectedOffset`, `$selectedPush`, `$selectedInk`           | On `NavLink` and `Tab`                                                                                                                                                                                    |
| Slot     | `$kind`                                                      | `"icon"`, `"badge"`, `"avatar"`, `"shortcut"`                                                                                                                                                             |
| Slot     | `$size`                                                      | `"xs"`, `"sm"`, `"md"`, `"lg"`, `"xl"`, `"2xl"`, `"full"`                                                                                                                                                 |
| Slot     | `$rowSpan`, `$floating`, `$p`, `$mx`                         | `$rowSpan={2}` beside a label with a description. `$p="md"` for a count in a badge slot. `$mx="closeGap"`                                                                                                 |

The width that `$border` sets inherits. A descendant that sets only `$borderType` draws at the width of a bordered ancestor. Pass `$border={false}` to stop it.

Props that do not exist: `$py` (`$p` is the padding of a frame and the vertical padding of a control, and `$px` is the side padding of a control), `$ring` (use `$borderType="ring"`), `$shadow` on anything but a popover, a dialog, or a tooltip (use `shadow-*` classes), and `$gap` on `Frame` (use `gap-*` classes). Layout is always Tailwind: `flex`, `grid`, `gap-*`, `items-*`, sizes.

## Primitives

### Layer

```tsx
import { Layer } from "../components/ariakit/components/layer.ariakit.react.tsx";
```

A `div` with a layer and no frame geometry. It paints the parent color by default (`$layer` is `true`). Use `Frame` when you need radius, padding, or a border, which is almost always.

Colors, and tints of them:

```tsx
const COLORS = ["brand", "secondary", "success", "warning", "danger"] as const;
```

<!-- prettier-ignore -->
```tsx
{COLORS.map((color) => (
  <Frame key={color} $layer={color} $rounded="lg" $p={3}>
    {color}
  </Frame>
))}
<Frame $layer="#635bff" $rounded="lg" $p={3}>
  #635bff
</Frame>
```

<!-- prettier-ignore -->
```tsx
{COLORS.map((color) => (
  <Frame key={color} $layer={color} $mix={15} $rounded="lg" $p={3}>
    {color}
  </Frame>
))}
```

Everything inside a layer adapts to it. `ContextSample` is a row with text, a link, a badge, a key, and a button.

<!-- prettier-ignore -->
```tsx
<Frame $layer="brand" $rounded="xl" $p="1rem" className="flex flex-wrap items-center gap-3">
  <ContextSample />
</Frame>
<Frame $invert $rounded="xl" $p="1rem" className="flex flex-wrap items-center gap-3">
  <ContextSample />
</Frame>
<Frame
  $layer="warning"
  $mix={15}
  $rounded="xl"
  $p="1rem"
  className="flex flex-wrap items-center gap-3"
>
  <ContextSample />
</Frame>
```

Ink:

<!-- prettier-ignore -->
```tsx
<Frame $ink={60} $lighten $rounded="lg" $p={3}>
  $ink 60
</Frame>
<Text>100</Text>
<Text className="ak-ink-80">80</Text>
<Text className="ak-ink-60">60</Text>
<Text className="ak-ink-40">40</Text>
<Text className="ak-ink-0">0</Text>
```

Gotchas:

- Do not give a layer to an element only because it is nested. Each layer costs color work and shifts the tone again.
- A custom color takes the same path as a named one (`$layer="#635bff"`), but it does not follow the Look controls.

### Frame

```tsx
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
```

A `div` with frame geometry and a transparent layer. It is the box for cards, wells, bars, bands, and placeholders.

<!-- prettier-ignore -->
```tsx
<Frame $border $rounded="lg" $p={3}>
  auto
</Frame>
<Frame $border $borderType="border" $rounded="lg" $p={3}>
  border
</Frame>
<Frame $border $borderType="ring" $rounded="lg" $p={3}>
  ring
</Frame>
<Frame $border $borderType="inset" $rounded="lg" $p={3}>
  inset
</Frame>
<Frame $border $borderType="dashed" $rounded="lg" $p={3}>
  dashed
</Frame>
<Frame $border={2} $rounded="lg" $p={3}>
  2px
</Frame>
```

<!-- prettier-ignore -->
```tsx
{(["light", "normal", "medium", "bold"] as const).map((weight) => (
  <Frame key={weight} $border $edgeWeight={weight} $rounded="lg" $p={3}>
    {weight}
  </Frame>
))}
<Frame $border $edge="brand" $edgeWeight="bold" $rounded="lg" $p={3}>
  brand
</Frame>
<Frame $border $edge="danger" $edgeRaw $rounded="lg" $p={3}>
  danger raw
</Frame>
```

Controls and pills inside a padded frame (pitfall 2):

<!-- prettier-ignore -->
```tsx
<Frame $lighten $border $rounded="xl" $p={3} className="flex items-center gap-2">
  <Button $lightnessOffset>Squared</Button>
  <Badge $layer="brand">
    <BadgeLabel>Squared</BadgeLabel>
  </Badge>
</Frame>
<Frame $lighten $border $rounded="xl" $p={3} className="flex items-center gap-2">
  <Button $lightnessOffset $forceRounded>
    Forced
  </Button>
  <Badge $layer="brand" $forceRounded>
    <BadgeLabel>Forced</BadgeLabel>
  </Badge>
</Frame>
<Frame $lighten $border $rounded="xl" $p="1rem" className="flex items-center gap-2">
  <Button $lightnessOffset>1rem</Button>
  <Badge $layer="brand">
    <BadgeLabel>1rem</BadgeLabel>
  </Badge>
</Frame>
```

`$cover` bands keep the corners of the parent:

<!-- prettier-ignore -->
```tsx
<Frame $lighten $border $rounded="2xl" $p={3} className="grid w-64 gap-3">
  <Frame $cover $darken $p={3}>
    Header band
  </Frame>
  <Text>Body</Text>
  <Frame $cover $darken $p={3}>
    Footer band
  </Frame>
</Frame>
```

Shadows and one-sided seams:

<!-- prettier-ignore -->
```tsx
<Frame $lighten $border $rounded="xl" $p={3} className="shadow-md">
  shadow-md
</Frame>
<Frame $lighten $border $rounded="xl" $p={3} className="shadow-xl">
  shadow-xl
</Frame>
<Frame $layer $p={3} className="border-b">
  border-b
</Frame>
<Frame $layer $edgeWeight="bold" $p={3} className="border-s-2">
  border-s-2
</Frame>
```

Gotchas:

- `$p` pads all four sides. For another value on one axis, add `px-*` or `py-*`. Do not replace the whole padding with `p-*`: the radius math reads `$p`.
- Use `$border`, not the Tailwind `border` class, for the outline of a frame. Side borders such as `border-b` are fine.
- `$rounded="full"` on a nested frame also shrinks. Add `$forceRounded`.

### Text

```tsx
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
```

A `span`. Without props it is plain text in the ink of its layer.

<!-- prettier-ignore -->
```tsx
{COLORS.map((color) => (
  <Text key={color} $text={color}>
    {color}
  </Text>
))}
<Text $text="brand" $textHue="magenta">
  hue
</Text>
```

<!-- prettier-ignore -->
```tsx
<Button $text="danger" $lightnessOffset>
  <ButtonSlot>
    <Trash2 />
  </ButtonSlot>
  <ButtonLabel>Delete</ButtonLabel>
</Button>
<Button $text="success" $lightnessOffset>
  <ButtonSlot>
    <Check />
  </ButtonSlot>
  <ButtonLabel>Approve</ButtonLabel>
</Button>
<Button $text="danger" $lightnessOffset>
  Bare text stays neutral
</Button>
```

Gotchas:

- For a block of text, pass `render={<p />}` or a `block` class.
- For an icon in a status color outside a control, wrap it: `<Text $text="warning" className="flex"><TriangleAlert /></Text>`.

### Heading

```tsx
import { Heading, HeadingLevel } from "../components/ariakit/components/heading.ariakit.react.tsx";
```

`Heading` renders `h1` to `h6` from the `HeadingLevel` context. Sizes by element: 2.25em, 1.75em, 1.4em, 1.2em, 1em.

<!-- prettier-ignore -->
```tsx
<HeadingLevel level={1}>
  <Heading>Heading 1</Heading>
  <HeadingLevel>
    <Heading>Heading 2</Heading>
    <HeadingLevel>
      <Heading>Heading 3</Heading>
      <HeadingLevel>
        <Heading>Heading 4</Heading>
        <HeadingLevel>
          <Heading>Heading 5</Heading>
        </HeadingLevel>
      </HeadingLevel>
    </HeadingLevel>
  </HeadingLevel>
</HeadingLevel>
```

<!-- prettier-ignore -->
```tsx
<Heading $level={4}>$level 4</Heading>
<Heading className="text-base">text-base</Heading>
<Heading className="text-sm font-semibold">text-sm font-semibold</Heading>
<Heading $level={5} $text="brand">
  $text brand
</Heading>
```

Gotchas: pitfalls 4 and 5. In app chrome, most headings want `className="mt-0 mb-0 text-base"` or `$level={4}`.

### TextFrame

```tsx
import { TextFrame } from "../components/ariakit/components/text-frame.ariakit.react.tsx";
```

A frame for one line of text that starts where the label of a control with the same `$p` starts. Use it for labels above or beside controls, and for static text in a `ButtonGroup`.

<!-- prettier-ignore -->
```tsx
<div className="grid w-48">
  <TextFrame $p={2} $rounded="md" $ink={60} className="text-sm">
    Workspace
  </TextFrame>
  <Button className="justify-start">Inbox</Button>
  <Button className="justify-start">History</Button>
</div>
```

### Button

```tsx
import {
  Button,
  ButtonContent,
  ButtonDescription,
  ButtonGlider,
  ButtonGroup,
  ButtonLabel,
  ButtonSeparator,
  ButtonSlot,
} from "../components/ariakit/components/button.ariakit.react.tsx";
```

`Button` props that matter: `$kind` (`"flat"`, `"bevel"`), the layer props for the surface, `$size`, `$rounded` (default `"md"`), `$p` (default `2`), `$px`, `$border`, and the state props. `ButtonGroup`: `$layout` (`"horizontal"`, `"vertical"`, `"stretch"`, `"wrap"`, `"none"`), `$gap` (`"auto"`, `"none"`, `"xs"` to `"xl"`), `$size`, `$p` (default `1`), `$rounded` (default `"xl"`), `$border`. `ButtonSeparator`: `$kind` (`"pipe"`, `"slash"`, `"chevron"`), `$size`, `$width`. `ButtonGlider`: `$kind` (`"flat"`, `"bevel"`, `"bar"`), `$state` (`"selected"`, `"hover"`, `"focus"`), `$side`, `$animated`.

The default button is see-through. Choose the surface by priority: `$layer="brand"` for the one main action, `$lightnessOffset` for a neutral button that stands alone, the default inside a toolbar or a group.

<!-- prettier-ignore -->
```tsx
<Button>Ghost</Button>
<Button $lightnessOffset>Neutral</Button>
<Button $border>Outline</Button>
<Button $layer="brand">Brand</Button>
<Button $layer="danger">Danger</Button>
<Button $layer="brand" $mix={20}>
  Tint
</Button>
<Button $invert>Inverted</Button>
<Button $kind="bevel">Bevel</Button>
<Button $kind="bevel" $layer="brand">
  Bevel brand
</Button>
```

<!-- prettier-ignore -->
```tsx
<Button $lightnessOffset $rounded="xl" $p={3} className="w-full justify-start text-start">
  <ButtonSlot $kind="avatar" $layer="brand" $size="lg" $rowSpan={2}>
    <GitPullRequest />
  </ButtonSlot>
  <ButtonContent>
    <ButtonLabel>Add the combobox select</ButtonLabel>
    <ButtonDescription>#7412 · 12 changes · 4 minutes ago</ButtonDescription>
  </ButtonContent>
  <ButtonSlot $kind="shortcut">↵</ButtonSlot>
</Button>
```

Groups own the surface and the edge:

<!-- prettier-ignore -->
```tsx
<ButtonGroup aria-label="Clipboard" $border>
  <Button>Cut</Button>
  <Button>Copy</Button>
  <Button>Paste</Button>
</ButtonGroup>
<ButtonGroup aria-label="History" $border>
  <Button>Undo</Button>
  <ButtonSeparator />
  <Button>Redo</Button>
</ButtonGroup>
<ButtonGroup aria-label="Period" $p="none">
  <Button $border $borderType="border">
    Day
  </Button>
  <Button $border $borderType="border">
    Week
  </Button>
  <Button $border $borderType="border">
    Month
  </Button>
</ButtonGroup>
<ButtonGroup aria-label="Path" $size="sm">
  <Button>Runs</Button>
  <ButtonSeparator $kind="chevron" />
  <Button>#7412</Button>
  <ButtonSeparator $kind="chevron" />
  <Button>Button</Button>
</ButtonGroup>
```

Gliders. `ak.Radio` with `render={<Button />}` makes each button a radio.

<!-- prettier-ignore -->
```tsx
<ak.RadioProvider defaultValue="split">
  <ak.RadioGroup aria-label="Compare mode" render={<ButtonGroup $border />}>
    <ak.Radio value="split" render={<Button />}>
      Split
    </ak.Radio>
    <ak.Radio value="overlay" render={<Button />}>
      Overlay
    </ak.Radio>
    <ak.Radio value="diff" render={<Button />}>
      Diff
    </ak.Radio>
    <ButtonGlider />
  </ak.RadioGroup>
</ak.RadioProvider>
<ak.RadioProvider defaultValue="overlay">
  <ak.RadioGroup aria-label="Compare mode" render={<ButtonGroup $border />}>
    <ak.Radio value="split" render={<Button />}>
      Split
    </ak.Radio>
    <ak.Radio value="overlay" render={<Button />}>
      Overlay
    </ak.Radio>
    <ak.Radio value="diff" render={<Button />}>
      Diff
    </ak.Radio>
    <ButtonGlider $kind="bevel" />
  </ak.RadioGroup>
</ak.RadioProvider>
<ak.RadioProvider defaultValue="diff">
  <ak.RadioGroup aria-label="Compare mode" render={<ButtonGroup $p="none" />}>
    <ak.Radio value="split" render={<Button />}>
      Split
    </ak.Radio>
    <ak.Radio value="overlay" render={<Button />}>
      Overlay
    </ak.Radio>
    <ak.Radio value="diff" render={<Button />}>
      Diff
    </ak.Radio>
    <ButtonGlider $kind="bar" />
  </ak.RadioGroup>
</ak.RadioProvider>
<ButtonGroup aria-label="Project" $border>
  <Button render={<a href="#button" aria-current="page" />}>Overview</Button>
  <Button render={<a href="#button" />}>Activity</Button>
  <Button render={<a href="#button" />}>Settings</Button>
  <ButtonGlider />
  <ButtonGlider $state="hover" />
  <ButtonGlider $state="focus" />
</ButtonGroup>
```

Gotchas:

- An icon-only button needs `aria-label`. One `ButtonSlot` alone makes the button square.
- A button is `inline-flex` with centered content. For a row, add `className="w-full justify-start text-start"`.
- A link that looks like a button is `<Button render={<a href="…" />}>` or `render={<RouterLink to="…" />}`.
- `disabled` gives the disabled look. Do not dim a button by hand.
- Buttons with a border join into one shape only in a group with no padding (`$p="none"`).

### Badge

```tsx
import {
  Badge,
  BadgeLabel,
  BadgeSlot,
} from "../components/ariakit/components/badge.ariakit.react.tsx";
```

A `span` at `$size="xs"`. A neutral badge lifts off its surface. A colored badge is a 15% tint with a ring and text of the same hue.

<!-- prettier-ignore -->
```tsx
<Badge $layer="brand" $mix={0}>
  <BadgeLabel>Solid</BadgeLabel>
</Badge>
<Badge $layer="transparent" $edgeWeight="normal">
  <BadgeLabel>Outline</BadgeLabel>
</Badge>
<Badge $layer="warning" $border={false}>
  <BadgeLabel>No ring</BadgeLabel>
</Badge>
<Badge $invert>
  <BadgeLabel>Inverted</BadgeLabel>
</Badge>
<Badge $layer="secondary" $rounded="md">
  <BadgeLabel>Tag</BadgeLabel>
</Badge>
<Badge $layer="brand" $hue="green">
  <BadgeLabel>$hue green</BadgeLabel>
</Badge>
```

<!-- prettier-ignore -->
```tsx
<Badge $layer="success">
  <BadgeSlot>
    <Check />
  </BadgeSlot>
  <BadgeLabel>Passed</BadgeLabel>
</Badge>
<Badge $layer="warning">
  <BadgeSlot $size="xs">
    <Circle fill="currentColor" />
  </BadgeSlot>
  <BadgeLabel>Needs review</BadgeLabel>
</Badge>
<Badge $layer="brand">
  <BadgeLabel>Details</BadgeLabel>
  <BadgeSlot>
    <ArrowRight />
  </BadgeSlot>
</Badge>
<Badge $size="sm">
  <BadgeLabel>Changes</BadgeLabel>
  <BadgeSlot $kind="badge" $p="md" $layer="danger">
    12
  </BadgeSlot>
</Badge>
<Badge>
  <BadgeSlot $kind="avatar" $layer="brand">
    DH
  </BadgeSlot>
  <BadgeLabel>Diego</BadgeLabel>
</Badge>
```

Gotchas:

- Put the text in `BadgeLabel`. It trims the line box, so the text is centered.
- For a count, pass `$px="md"`. One digit is then a circle.
- Pass `$forceRounded` inside a table cell or a frame with less than 1rem of padding.
- For a count inside a control, use the slot of that control with `$kind="badge" $p="md"`, not a `Badge`.

### Input

```tsx
import {
  Input,
  InputGroup,
  InputSlot,
} from "../components/ariakit/components/input.ariakit.react.tsx";
```

`Input` is a native `input` with a writing surface and a border. `InputGroup` is the same surface around a plain `input` and its slots. Props: `$size`, `$p`, `$rounded` (default `"lg"`), `$edgeWeight` (default `45`), `$focus`. The invalid look comes from `aria-invalid`, and the disabled look from `disabled`.

<!-- prettier-ignore -->
```tsx
<InputGroup className="w-full">
  <InputSlot className="ak-ink-60">
    <Search />
  </InputSlot>
  <input aria-label="Search runs" placeholder="Search runs" className="min-w-0 flex-1" />
  <InputSlot $kind="shortcut">
    <kbd>/</kbd>
  </InputSlot>
</InputGroup>
<InputGroup $size="sm" className="w-full">
  <InputSlot className="ak-ink-60">
    <ListFilter />
  </InputSlot>
  <input aria-label="Filter" placeholder="Filter" className="min-w-0 flex-1" />
  <InputSlot $size="2xl" $square={false}>
    <Button $size="xs">Clear</Button>
  </InputSlot>
</InputGroup>
```

<!-- prettier-ignore -->
```tsx
<Input render={<button type="button" />} className="w-full text-start">
  <InputSlot className="ak-ink-60">
    <Search />
  </InputSlot>
  <Text {...inputPlaceholder.jsx({ className: "flex-1 truncate" })}>Search trigger</Text>
  <InputSlot $kind="shortcut" $size="xl">
    <kbd aria-hidden>⌘K</kbd>
  </InputSlot>
</Input>
<Input
  render={<textarea rows={2} />}
  aria-label="Note"
  placeholder="Textarea"
  className="w-full resize-y"
/>
```

<!-- prettier-ignore -->
```tsx
<div className="grid w-full gap-1.5">
  <Text render={<label htmlFor="labeled-field-input" />} className="text-sm font-medium">
    Repository
  </Text>
  <Input
    id="labeled-field-input"
    defaultValue="ariakit/ariakit"
    aria-describedby="labeled-field-hint"
  />
  <Text id="labeled-field-hint" className="ak-ink-70 text-sm">
    The repository that runs the captures.
  </Text>
</div>
```

Gotchas:

- Inside `InputGroup`, give the plain `input` the classes `min-w-0 flex-1`.
- An input does not fill its container. Add `w-full` or `flex-1`.
- A label is `<Text render={<label htmlFor="…" />}>`.

### Checkbox and Radio

```tsx
import {
  Checkbox,
  CheckboxCard,
  CheckboxCardCheck,
  CheckboxCardContent,
  CheckboxCardDescription,
  CheckboxCardGrid,
  CheckboxCardLabel,
  CheckboxCardSlot,
  CheckboxDescription,
  CheckboxField,
  CheckboxLabel,
} from "../components/ariakit/components/checkbox.ariakit.react.tsx";
import {
  RadioCard,
  RadioCardCheck,
  RadioCardContent,
  RadioCardDescription,
  RadioCardGrid,
  RadioCardLabel,
  RadioDescription,
  RadioField,
  RadioGroup,
  RadioLabel,
  RadioProvider,
} from "../components/ariakit/components/radio.ariakit.react.tsx";
```

`Checkbox` is the box alone. `CheckboxField` is a label row with the box. `CheckboxCard` is a card-shaped label around a hidden checkbox that tints while it is checked. The radio parts mirror them, inside a `RadioProvider` and a `RadioGroup` or `RadioCardGrid`. Card props: `$orientation="vertical"` for a tile, and `$floating` on the check for a corner stamp.

<!-- prettier-ignore -->
```tsx
<div className="grid gap-1">
  <CheckboxField defaultChecked>
    <CheckboxLabel>Hide approved</CheckboxLabel>
  </CheckboxField>
  <CheckboxField>
    <CheckboxLabel>Sync zoom</CheckboxLabel>
    <CheckboxDescription>Both screenshots zoom and pan together.</CheckboxDescription>
  </CheckboxField>
  <CheckboxField disabled>
    <CheckboxLabel>Disabled</CheckboxLabel>
  </CheckboxField>
</div>
```

<!-- prettier-ignore -->
```tsx
<CheckboxCardGrid aria-label="Browsers" $minItemSize="8rem" className="w-full">
  <CheckboxCard value="chrome" defaultChecked>
    <CheckboxCardCheck />
    <CheckboxCardContent>
      <CheckboxCardLabel>Chrome</CheckboxCardLabel>
      <CheckboxCardDescription>148 shots</CheckboxCardDescription>
    </CheckboxCardContent>
  </CheckboxCard>
  <CheckboxCard value="firefox">
    <CheckboxCardSlot>
      <Image />
    </CheckboxCardSlot>
    <CheckboxCardLabel>Firefox</CheckboxCardLabel>
    <CheckboxCardCheck $floating />
  </CheckboxCard>
</CheckboxCardGrid>
```

<!-- prettier-ignore -->
```tsx
<RadioProvider defaultValue="changed">
  <RadioGroup aria-label="Show" className="grid gap-1">
    <RadioField value="changed">
      <RadioLabel>Changed</RadioLabel>
    </RadioField>
    <RadioField value="all">
      <RadioLabel>All</RadioLabel>
      <RadioDescription>Includes the screenshots that match.</RadioDescription>
    </RadioField>
    <RadioField value="failed" disabled>
      <RadioLabel>Failed</RadioLabel>
    </RadioField>
  </RadioGroup>
</RadioProvider>
```

Gotchas:

- `checked="mixed"` draws the dash.
- A card grid needs `aria-label`.
- A radio needs a `RadioProvider` around it.

### Combobox and select

```tsx
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxItemContent,
  ComboboxItemDescription,
  ComboboxItemLabel,
  ComboboxItemSlot,
  ComboboxList,
  ComboboxPopover,
  ComboboxProvider,
  ComboboxSelect,
  ComboboxSelectLabel,
} from "../components/ariakit/components/combobox.ariakit.react.tsx";
```

A select is `ComboboxProvider` with `ComboboxSelect` and `ComboboxPopover`. A combobox is `Combobox` with the suggestions as children. `ComboboxItem` props: `value`, `icon`, `checkmark` (`"before"`, `"after"`). `ComboboxSelect` props: `icon`, `chevron` (`"before"`, `"after"`, `false`), `placeholder`. The popover renders in a portal.

<!-- prettier-ignore -->
```tsx
<ComboboxProvider defaultSelectedValue="Chrome">
  <div className="grid gap-1.5">
    <ComboboxSelectLabel className="text-sm font-medium">Browser</ComboboxSelectLabel>
    <ComboboxSelect className="w-48" />
  </div>
  <ComboboxPopover unmountOnHide>
    <ComboboxItem value="Chrome" checkmark="before" />
    <ComboboxItem value="Firefox" checkmark="before" />
    <ComboboxItem value="Safari" checkmark="before" />
    <ComboboxItem value="Edge" checkmark="before" disabled />
  </ComboboxPopover>
</ComboboxProvider>
```

<!-- prettier-ignore -->
```tsx
<ComboboxProvider defaultSelectedValue="Newest">
  <ComboboxSelect aria-label="Sort" $layer="transparent" icon={<Clock />} />
  <ComboboxPopover unmountOnHide>
    <ComboboxItem value="Newest" checkmark="after" />
    <ComboboxItem value="Oldest" checkmark="after" />
    <ComboboxItem value="Most changes" checkmark="after" />
  </ComboboxPopover>
</ComboboxProvider>
<ComboboxProvider defaultSelectedValue="">
  <ComboboxSelect aria-label="Status" $kind="bevel" $size="sm" placeholder="Status" />
  <ComboboxPopover unmountOnHide>
    <ComboboxItem value="Needs review" />
    <ComboboxItem value="Approved" />
    <ComboboxItem value="Rejected" />
  </ComboboxPopover>
</ComboboxProvider>
```

```tsx
const BRANCHES = ["main", "next", "fix/dialog-focus", "feat/combobox-select", "chore/deps"];
```

```tsx
function ComboboxField() {
  const [value, setValue] = useState("");
  const matches = BRANCHES.filter((branch) => branch.includes(value.trim().toLowerCase()));
  return (
    <Combobox
      aria-label="Branch"
      placeholder="Filter branches"
      inputValue={value}
      setInputValue={setValue}
      className="w-56"
    >
      <ComboboxList>
        {matches.map((branch) => (
          <ComboboxItem key={branch} value={branch} />
        ))}
      </ComboboxList>
      {!matches.length && <ComboboxEmpty />}
    </Combobox>
  );
}
```

Gotchas:

- A flat select looks like a field. Pass `$layer="transparent"` for a toolbar button, or `$kind="bevel"`.
- The store selects the first item. For an empty select with a `placeholder`, pass `defaultSelectedValue=""` to the provider.
- For rich rows, use `ComboboxItemSlot`, `ComboboxItemContent`, `ComboboxItemLabel`, and `ComboboxItemDescription` as children of the item.

### Kbd, Code, Link, Separator

```tsx
import { Kbd } from "../components/ariakit/components/kbd.ariakit.react.tsx";
import { Code } from "../components/ariakit/components/code.ariakit.react.tsx";
import { Link } from "../components/ariakit/components/link.ariakit.react.tsx";
import { Separator } from "../components/ariakit/components/separator.ariakit.react.tsx";
```

<!-- prettier-ignore -->
```tsx
<Text className="text-sm">
  Press <Kbd>⌘</Kbd> <Kbd>K</Kbd> to search, <Kbd>Esc</Kbd> to close.
</Text>
<Kbd $layer="brand">A</Kbd>
<Kbd $invert>R</Kbd>
<Kbd $layer="transparent">Tab</Kbd>
<Kbd className="text-xs">
  <Command className="inline size-[1em]" />
</Kbd>
```

<!-- prettier-ignore -->
```tsx
<Text className="text-sm">
  Run <Code>pnpm dev</Code> and open <Code>/primitives</Code>.
</Text>
<Code $layer="danger">removed</Code>
<Code $layer="success">added</Code>
<Code $invert>inverted</Code>
<Code $layer="transparent">ring only</Code>
<Code $layer={false}>no layer</Code>
```

<!-- prettier-ignore -->
```tsx
<Link href="#link">Default</Link>
<Link href="#link" $text="danger">
  Danger
</Link>
<Link href="#link" $text>
  Layer color
</Link>
<Link href="#link" $text={false} className="ak-ink-70">
  Inherited
</Link>
<Link render={<button type="button" />}>Button</Link>
<Link href="#link" className="no-underline">
  No underline
</Link>
```

<!-- prettier-ignore -->
```tsx
<div className="grid w-full">
  <Text className="text-sm">dashed (default)</Text>
  <Separator />
  <Text className="text-sm">solid</Text>
  <Separator $line="solid" />
  <Text className="text-sm">dotted, bold</Text>
  <Separator $line="dotted" $edgeWeight="bold" />
  <Text className="text-sm">brand, no margin</Text>
  <Separator $line="solid" $edge="brand" $edgeRaw $gap={0} />
</div>
```

Gotchas:

- `Kbd` is a key cap. Inside a slot with `$kind="shortcut"`, a plain `<kbd>` is soft text. Put a `Kbd` there when you want the cap.
- `Link` is an inline text link with an underline. For a navigation row use `NavLink`, and for a link that looks like a button use `Button` with `render`.
- `Separator` is a dashed horizontal rule with its own margin. `$line="solid"` and `$gap={0}` give a plain divider. Inside a `ButtonGroup`, use `ButtonSeparator`.

### Progress

```tsx
import {
  Progress,
  ProgressCircular,
} from "../components/ariakit/components/progress.ariakit.react.tsx";
```

`value` runs from 0 to 1. Without `value`, the progress is indeterminate. `fill` takes the props of the fill (`{ $layer: "success" }`). `$thickness` takes a spacing step.

<!-- prettier-ignore -->
```tsx
<div className="grid w-full gap-4">
  <Progress aria-label="Comparing" value={0.65} />
  <Progress aria-label="Passed" value={1} fill={{ $layer: "success" }} />
  <Progress aria-label="Failed" value={0.3} $thickness={1} fill={{ $layer: "danger" }} />
  <Progress aria-label="Capturing" $thickness={3} />
</div>
```

<!-- prettier-ignore -->
```tsx
<div className="size-16">
  <ProgressCircular aria-label="Reviewed" value={0.7}>
    <Text className="text-xs font-medium tabular-nums">70%</Text>
  </ProgressCircular>
</div>
<div className="size-10">
  <ProgressCircular aria-label="Passed" value={1} fill={{ $layer: "success" }} />
</div>
<div className="size-10">
  <ProgressCircular aria-label="Capturing" $thickness={1} />
</div>
<Text className="flex items-center gap-2 text-sm">
  <span className="size-[1lh] p-0.5">
    <ProgressCircular aria-label="Comparing" value={0.4} $thickness={0.75} />
  </span>
  Comparing 48 of 120
</Text>
```

Gotchas:

- `ProgressCircular` fills its parent. Give the parent a size (`size-10`), or the ring has no height.
- Name each progress bar with `aria-label` or `aria-labelledby`.

### Disclosure

```tsx
import {
  Disclosure,
  DisclosureButton,
  DisclosureButtonSlot,
  DisclosureContent,
  DisclosureGroup,
} from "../components/ariakit/components/disclosure.ariakit.react.tsx";
```

`Disclosure` props: `button` (text, `DisclosureButton` props, or an element), `defaultOpen`, `open`, `setOpen`, `split`, `content` (`{ guide: true }`, `{ prose: true }`). `DisclosureButton` props: `icon`, `label`, `description`, `indicator` (`"chevron-down-end"`, `"chevron-right-start"`, `"plus-end"`, and the other combinations, or `false`).

<!-- prettier-ignore -->
```tsx
<Disclosure button="Default" defaultOpen>
  The button and the content share the padding of the root.
</Disclosure>
<Disclosure
  $border
  $rounded="xl"
  $p={3}
  button={
    <DisclosureButton icon={<Settings />} description="Viewport and threshold">
      Capture settings
    </DisclosureButton>
  }
>
  1440 by 900, strict threshold.
</Disclosure>
<Disclosure
  $border
  $rounded="xl"
  $p={3}
  split
  defaultOpen
  button={
    <DisclosureButton label="Problems" indicator="chevron-down-end">
      <DisclosureButtonSlot $kind="badge" $p="md" $layer="danger">
        3
      </DisclosureButtonSlot>
    </DisclosureButton>
  }
>
  Three screenshots failed to capture.
</Disclosure>
```

<!-- prettier-ignore -->
```tsx
<DisclosureGroup $border $rounded="xl" $p={3}>
  <Disclosure button={{ children: "Baseline", indicator: "plus-end" }} defaultOpen>
    The run on main that this run compares against.
  </Disclosure>
  <Disclosure button={{ children: "Attempts", indicator: "plus-end" }}>
    Three attempts. The newest one needs review.
  </Disclosure>
  <Disclosure button={{ children: "Environment", indicator: "plus-end" }}>
    Chrome 141 on Linux.
  </Disclosure>
</DisclosureGroup>
```

### List

```tsx
import { List, ListItem } from "../components/ariakit/components/list.ariakit.react.tsx";
```

`List` props: `ordered`, `$marker` (`"dash"`, `"bullet"`, `"counter"`), `$guide`, `$gap`, `$itemPadding`. `ListItem` props: `checked`, `progress` (0 to 1).

<!-- prettier-ignore -->
```tsx
<List $gap={2}>
  <ListItem checked>Capture</ListItem>
  <ListItem checked>Upload</ListItem>
  <ListItem progress={0.65}>Compare</ListItem>
  <ListItem checked={false}>Review</ListItem>
</List>
```

<!-- prettier-ignore -->
```tsx
<List $guide $gap={4}>
  <ListItem checked>
    <Text className="font-medium">Run 3 passed</Text>
    <Text className="ak-ink-60 block text-sm">4 minutes ago</Text>
  </ListItem>
  <ListItem>
    <Text className="font-medium">Run 2 rejected</Text>
    <Text className="ak-ink-60 block text-sm">1 hour ago</Text>
  </ListItem>
  <ListItem>
    <Text className="font-medium">Run 1 replaced</Text>
    <Text className="ak-ink-60 block text-sm">Yesterday</Text>
  </ListItem>
</List>
```

### Nav

```tsx
import {
  Nav,
  NavButton,
  NavButtonContent,
  NavDisclosure,
  NavDisclosureButton,
  NavGroup,
  NavGroupLabel,
  NavLink,
  NavLinkContent,
  NavLinkDescription,
  NavLinkLabel,
  NavList,
  NavSlot,
} from "../components/ariakit/components/nav.ariakit.react.tsx";
```

`Nav` renders a `nav` with a list. Props: `$layout` (`"vertical"`, `"horizontal"`), `$gap`, `$groupGap`, `$slotSize` (the size of every icon, badge, and avatar slot, as a spacing step), `glider`, and `list={false}` when the children are groups with their own `NavList`. `glider` takes `true`, `NavGlider` props (`$kind`: `"flat"`, `"bevel"`, `"bar"`; `$state`; `$side`; `$barOffset`), or an array of them.

A `NavLink` is current when it has `aria-current`, when its `href` matches `currentUrl`, or when the router link that it renders is active.

```tsx
const NAV_PAGES = [
  { title: "Inbox", icon: Inbox, count: 8 },
  { title: "History", icon: History },
  { title: "Status", icon: Activity },
];
```

```tsx
function NavRows() {
  const [current, setCurrent] = useState("Inbox");
  return (
    <Nav
      aria-label="Rows"
      $slotSize={5}
      glider={[{ $state: "hover" }, {}, { $state: "focus" }]}
      className="w-56"
    >
      {NAV_PAGES.map((page) => (
        <NavLink
          key={page.title}
          href="#nav"
          aria-current={current === page.title ? "page" : undefined}
          onClick={(event) => {
            event.preventDefault();
            setCurrent(page.title);
          }}
        >
          <NavSlot>
            <page.icon strokeWidth={1.5} />
          </NavSlot>
          <NavLinkLabel>{page.title}</NavLinkLabel>
          {page.count != null && (
            <NavSlot $kind="badge" className="ms-auto">
              {page.count}
            </NavSlot>
          )}
        </NavLink>
      ))}
    </Nav>
  );
}
```

<!-- prettier-ignore -->
```tsx
<Nav list={false} aria-label="Groups" className="w-56">
  <NavGroup>
    <NavGroupLabel>Review</NavGroupLabel>
    <NavList>
      <NavLink href="#nav" aria-current="page">
        Inbox
      </NavLink>
      <NavLink href="#nav">History</NavLink>
    </NavList>
  </NavGroup>
  <NavGroup>
    <NavGroupLabel>Service</NavGroupLabel>
    <NavList>
      <NavLink href="#nav">Status</NavLink>
    </NavList>
  </NavGroup>
</Nav>
```

<!-- prettier-ignore -->
```tsx
<Nav aria-label="Parts" $slotSize={5} className="w-60">
  <li>
    <NavButton>
      <NavSlot>
        <Search strokeWidth={1.5} />
      </NavSlot>
      <NavButtonContent>Search</NavButtonContent>
      <NavSlot $kind="shortcut" className="ms-auto">
        ⌘K
      </NavSlot>
    </NavButton>
  </li>
  <NavDisclosure
    defaultOpen
    button={
      <NavDisclosureButton icon={<FolderOpen strokeWidth={1.5} />}>
        Pull requests
      </NavDisclosureButton>
    }
  >
    <NavList>
      <NavLink href="#nav" aria-current="page">
        #7412 Combobox select
      </NavLink>
      <NavLink href="#nav">#7398 Dialog focus</NavLink>
    </NavList>
  </NavDisclosure>
  <NavLink href="#nav">
    <NavSlot $kind="avatar" $layer="brand">
      DH
    </NavSlot>
    <NavLinkContent>
      <NavLinkLabel>Diego Haz</NavLinkLabel>
      <NavLinkDescription>Maintainer</NavLinkDescription>
    </NavLinkContent>
  </NavLink>
</Nav>
```

<!-- prettier-ignore -->
```tsx
<Nav aria-label="Lab pages" className="w-56">
  <NavLink render={<RouterLink to="/" />}>Lab home</NavLink>
  <NavLink render={<RouterLink to="/primitives" />}>Primitives</NavLink>
</Nav>
```

Gotchas:

- Inside a landmark that exists already (a `ShellSidebar` with `render={<nav />}`), render the nav as a plain element: `<Nav render={<div aria-label="Pages" />}>`.
- A `NavButton` is not a list item. Wrap it in `<li>` inside a `Nav`.
- Push a trailing slot to the end of the row with `className="ms-auto"`.
- The router marks a link as current on its own path and on the paths below it. Pass `activeOptions={{ exact: true }}` to the router link to limit it to its own path.
- To change the row padding of the whole nav, set `--nav-py` with the important flag and pass the same value to the rows, as the index of the reference page does: `className="[--nav-py:--spacing(1)]!"` on the `Nav`, and `$p="var(--nav-py)"` on each `NavLink`.

### Tabs

```tsx
import {
  Tab,
  TabGlider,
  TabLabel,
  TabList,
  TabPanel,
  TabPanels,
  TabSlot,
  Tabs,
} from "../components/ariakit/components/tabs.ariakit.react.tsx";
```

`Tabs` is the root and a card: it takes `defaultSelectedId`, `selectedId`, `setSelectedId`, and the frame props (`$border`, `$p`, `$rounded`). `Tab` props: `$kind` (`"folder"`, the default, `"flat"`, `"bevel"`), `$selectedOffset`. `TabList` props: `$size`, `$layout` (`"horizontal"`, `"stretch"`). `TabPanel` takes `tabId`, or `single` for one panel that follows the selected tab.

<!-- prettier-ignore -->
```tsx
<Tabs defaultSelectedId="tabs-folder-changes" className="w-full">
  <TabList aria-label="Folder tabs">
    <Tab id="tabs-folder-changes">
      <TabLabel>Changes</TabLabel>
      <TabSlot $kind="badge" $p="md">
        12
      </TabSlot>
    </Tab>
    <Tab id="tabs-folder-passed">
      <TabLabel>Passed</TabLabel>
    </Tab>
    <Tab id="tabs-folder-problems">
      <TabLabel>Problems</TabLabel>
    </Tab>
  </TabList>
  <TabPanels>
    <TabPanel tabId="tabs-folder-changes">
      <Text className="text-sm">Twelve changes.</Text>
    </TabPanel>
    <TabPanel tabId="tabs-folder-passed">
      <Text className="text-sm">One hundred and eight passed.</Text>
    </TabPanel>
    <TabPanel tabId="tabs-folder-problems">
      <Text className="text-sm">No problems.</Text>
    </TabPanel>
  </TabPanels>
</Tabs>
```

<!-- prettier-ignore -->
```tsx
<Tabs defaultSelectedId="tabs-flat-split" className="w-full">
  <TabList aria-label="Flat tabs" $size="sm">
    <Tab $kind="flat" id="tabs-flat-split">
      <TabLabel>Split</TabLabel>
    </Tab>
    <Tab $kind="flat" id="tabs-flat-overlay">
      <TabLabel>Overlay</TabLabel>
    </Tab>
    <Tab $kind="flat" id="tabs-flat-diff">
      <TabLabel>Diff</TabLabel>
    </Tab>
    <TabGlider $kind="flat" />
  </TabList>
  <TabPanels>
    <TabPanel single>
      <Text className="text-sm">One panel for every tab.</Text>
    </TabPanel>
  </TabPanels>
</Tabs>
```

Gotchas:

- Give every tab an `id` and pass `defaultSelectedId`. Without them, the server render has no selected tab and no panel.
- The strip is a well and the panel is a raised sheet. For page tabs with no card, see the [page tabs recipe](#page-tabs).
- For tabs that are links to routes, use a horizontal `Nav` with a bar glider.

### Table

```tsx
import {
  Table,
  TableCell,
  TableRow,
  TableRowGroup,
} from "../components/ariakit/components/table.ariakit.react.tsx";
import type { TableRows } from "../components/ariakit/components/table.ariakit.react.tsx";
```

`Table` takes `rows` as data, or the parts as children. In `rows`, the row with `group: "head"` names the columns, and a head cell sets `numeric`, `$fit` (as narrow as the content), `$grow`, and `$sticky` for its whole column. Density: `$p` (default `3`).

Borders: `container={{ $border: true }}` draws the outer border and every line between cells. Add `$borderInline={false}` on the table for row lines only, or `$border={false}` for the outer border only. `$borderBlock` on the table, with no container border, draws row lines on a table that lies flush on its surface.

```tsx
const RUN_ROWS: TableRows<RunColumn> = [
  {
    group: "head",
    run: { children: "Run", $grow: true },
    status: { children: "Status", $fit: true },
    changes: { children: "Changes", numeric: true, $fit: true },
    updated: { children: "Updated", $fit: true },
  },
  {
    key: "7412",
    run: "#7412 Add the combobox select",
    status: (
      <Badge $forceRounded $layer="warning">
        <BadgeLabel>Needs review</BadgeLabel>
      </Badge>
    ),
    changes: 12,
    updated: "4 min",
  },
  {
    key: "7398",
    run: "#7398 Fix the dialog focus",
    status: (
      <Badge $forceRounded $layer="success">
        <BadgeLabel>Passed</BadgeLabel>
      </Badge>
    ),
    changes: 0,
    updated: "1 h",
  },
  {
    key: "7391",
    run: "#7391 Update the tab glider",
    status: (
      <Badge $forceRounded $layer="danger">
        <BadgeLabel>Failed</BadgeLabel>
      </Badge>
    ),
    changes: 3,
    updated: "3 h",
  },
];
```

<!-- prettier-ignore -->
```tsx
<Table aria-label="Runs" rows={RUN_ROWS} container={{ $border: true }} />
```

<!-- prettier-ignore -->
```tsx
<Table
  role="grid"
  aria-label="Screenshots"
  container={{ $border: true }}
  $borderInline={false}
  className="text-sm"
>
  <TableRowGroup group="head">
    <TableRow>
      <TableCell sort="ascending" $grow>
        Screenshot
      </TableCell>
      <TableCell sort="none">Browser</TableCell>
      <TableCell numeric sort="none">
        Diff
      </TableCell>
    </TableRow>
  </TableRowGroup>
  <TableRowGroup>
    <TableRow selected>
      <TableCell header="row">button/default</TableCell>
      <TableCell>Chrome</TableCell>
      <TableCell numeric>0.42%</TableCell>
    </TableRow>
    <TableRow>
      <TableCell header="row">dialog/open</TableCell>
      <TableCell>Firefox</TableCell>
      <TableCell numeric>1.08%</TableCell>
    </TableRow>
  </TableRowGroup>
  <TableRowGroup group="foot">
    <TableRow>
      <TableCell header="row" colSpan={2}>
        Total
      </TableCell>
      <TableCell numeric>1.50%</TableCell>
    </TableRow>
  </TableRowGroup>
</Table>
```

Gotchas:

- A badge in a cell needs `$forceRounded`.
- Rows tint on hover by default. A selected row takes `selected` and a table with `role="grid"`.
- The container clips and rounds the table (`$rounded` default `"xl"`). Cap the height with a `max-h-*` class on the container, and pin the head with `head={{ $sticky: "top" }}`.

### Popover

```tsx
import {
  Popover,
  PopoverArrow,
  PopoverDescription,
  PopoverDisclosure,
  PopoverDismiss,
  PopoverHeading,
  PopoverProvider,
} from "../components/ariakit/components/popover.ariakit.react.tsx";
```

`Popover` is a raised canvas surface with a border and a shadow. Props: `$shadow` (`"none"`, `"md"`, `"xl"`), `$rounded` (default `"2xl"`), `$p` (default `4`), `portal`, and the placement on the provider (`placement="top"`). `PopoverDisclosure` and `PopoverDismiss` are buttons and take the button props. `PopoverDismiss` without children is a close icon button.

<!-- prettier-ignore -->
```tsx
<PopoverProvider>
  <PopoverDisclosure $lightnessOffset>Default</PopoverDisclosure>
  <Popover portal className="grid max-w-72 gap-2">
    <div className="flex items-center justify-between gap-2">
      <PopoverHeading>Baseline</PopoverHeading>
      <PopoverDismiss />
    </div>
    <PopoverDescription>Captured on main, two hours ago.</PopoverDescription>
  </Popover>
</PopoverProvider>
<PopoverProvider placement="top">
  <PopoverDisclosure $lightnessOffset>Compact with arrow</PopoverDisclosure>
  <Popover portal $rounded="xl" $p={2} $shadow="md" className="grid max-w-64 gap-2">
    <PopoverArrow />
    <PopoverDescription className="px-1 text-sm">Copy a link to this run.</PopoverDescription>
    <Button $lightnessOffset $size="sm">
      Copy link
    </Button>
  </Popover>
</PopoverProvider>
<PopoverProvider>
  <PopoverDisclosure $lightnessOffset>Brand</PopoverDisclosure>
  <Popover portal $layer="brand" className="grid max-w-64 justify-items-start gap-2">
    <PopoverArrow />
    <PopoverHeading>New: overlay mode</PopoverHeading>
    <PopoverDescription>Press O to compare in place.</PopoverDescription>
    <PopoverDismiss $kind="bevel">Got it</PopoverDismiss>
  </Popover>
</PopoverProvider>
```

Gotchas:

- Pass `portal`. `ShellMainBody` clips its overflow, and a popover in a sticky bar stacks under later parts.
- A popover does not lay out its children. Add `grid gap-2` or `flex flex-col gap-2`, and a `max-w-*`.

### Dialog

```tsx
import {
  Dialog,
  DialogDescription,
  DialogDisclosure,
  DialogDismiss,
  DialogHeading,
  DialogProvider,
  DialogScroll,
} from "../components/ariakit/components/dialog.ariakit.react.tsx";
```

A modal popover with a blurred backdrop, in a portal. Its width is at most 25em. Change it with a `max-w-*` class.

<!-- prettier-ignore -->
```tsx
<DialogProvider>
  <DialogDisclosure $lightnessOffset>Dialog</DialogDisclosure>
  <Dialog className="grid gap-4">
    <div className="flex items-center justify-between gap-2">
      <DialogHeading>Rename baseline</DialogHeading>
      <DialogDismiss />
    </div>
    <DialogDescription>Pick a name that the team will recognize.</DialogDescription>
    <Input aria-label="Baseline name" defaultValue="main" />
    <div className="flex justify-end gap-2">
      <DialogDismiss>Cancel</DialogDismiss>
      <DialogDismiss $layer="brand">Save</DialogDismiss>
    </div>
  </Dialog>
</DialogProvider>
<DialogProvider>
  <DialogDisclosure $lightnessOffset>Scrolling dialog</DialogDisclosure>
  <Dialog className="flex flex-col gap-4">
    <DialogHeading>Keyboard shortcuts</DialogHeading>
    <DialogScroll className="grid gap-3">
      {Array.from({ length: 24 }, (_, index) => (
        <Text key={index} className="flex items-center justify-between text-sm">
          Shortcut {index + 1}
          <Kbd>{String.fromCharCode(65 + index)}</Kbd>
        </Text>
      ))}
    </DialogScroll>
    <DialogDismiss $lightnessOffset className="self-end">
      Close
    </DialogDismiss>
  </Dialog>
</DialogProvider>
```

Gotchas:

- For long content, the dialog is `flex flex-col` and the content is in `DialogScroll`.
- To control it, pass `open` and `setOpen` to `DialogProvider`.

### Tooltip

```tsx
import {
  Tooltip,
  TooltipAnchor,
  TooltipArrow,
  TooltipProvider,
} from "../components/ariakit/components/tooltip.ariakit.react.tsx";
```

<!-- prettier-ignore -->
```tsx
<TooltipProvider>
  <TooltipAnchor render={<Button $lightnessOffset aria-label="Approve" />}>
    <ButtonSlot>
      <Check />
    </ButtonSlot>
  </TooltipAnchor>
  <Tooltip>
    Approve <Kbd>A</Kbd>
  </Tooltip>
</TooltipProvider>
<TooltipProvider placement="bottom">
  <TooltipAnchor render={<Button $lightnessOffset />}>Below, with arrow</TooltipAnchor>
  <Tooltip>
    <TooltipArrow />
    Shows under the anchor
  </Tooltip>
</TooltipProvider>
<TooltipProvider>
  <TooltipAnchor render={<Button $lightnessOffset />}>Inverted</TooltipAnchor>
  <Tooltip $invert $border={false}>
    High contrast
  </Tooltip>
</TooltipProvider>
```

Gotchas:

- The anchor is the control: `<TooltipAnchor render={<Button aria-label="…" />}>`. Do not put a button inside the anchor.
- The tooltip describes the control. The control still needs its own name.

### Prose

```tsx
import { Prose } from "../components/ariakit/components/prose.ariakit.react.tsx";
```

A column for long text with a shared rhythm. It styles plain `p` and `strong`. Use it for documents, not for app chrome.

<!-- prettier-ignore -->
```tsx
<HeadingLevel>
  <Prose $gap={3} className="text-sm">
    <Heading>Review a run</Heading>
    <p>
      Open the run, compare each screenshot, and <strong>approve</strong> the changes that you
      expect. Read the <Link href="#prose">guide</Link> first.
    </p>
    <List>
      <ListItem>Approved changes become the baseline.</ListItem>
      <ListItem>Rejected changes fail the check.</ListItem>
    </List>
    <Separator />
    <p>A newer run replaces this one.</p>
  </Prose>
</HeadingLevel>
```

### Shell

```tsx
import {
  Shell,
  ShellFooter,
  ShellHeader,
  ShellHeaderCenter,
  ShellHeaderEnd,
  ShellMain,
  ShellMainBody,
  ShellMainHeader,
  ShellMainIntro,
  ShellSidebar,
  ShellSidebarBody,
} from "../components/ariakit/components/shell.ariakit.react.tsx";
```

`Shell` is the page: a grid with a header, up to two sidebars on each side, a main area, and a footer. The page scrolls, the bars stick, and each sidebar body scrolls on its own. Parts are direct children of the shell and place themselves.

| Part                                                   | Props that matter                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ShellHeader`                                          | `start`, `center`, `end` (content, or a `ShellHeaderCenter` element with `$grow` or `$shrink`). `$height`: `"sm"` (3.5em), `"md"` (4em), `"lg"` (4.5em). `$sticky` (default `true`), `$blur`, `$p` (default `3`), `$border`                                                                                                                  |
| `ShellSidebar`                                         | `open`, `$side` (`"start"`, `"end"`), `$width`: `"xs"` (10rem), `"sm"` (12rem), `"md"` (16rem), `"lg"` (20rem), `"xl"` (24rem). `$show`: `true`, `false`, or a container width such as `"3xl"` (the default, 48rem) or `"max-3xl"`. `$from`: `"main"`, `"intro"`, `"body"`. Pass `render={<nav />}` or `render={<aside />}` and `aria-label` |
| `ShellSidebarBody`                                     | The scrolling part of a sidebar. `$p` (default `3`). Also `ShellSidebarHeader` and `ShellSidebarFooter`                                                                                                                                                                                                                                      |
| `ShellMain`                                            | `$p` (the gutter, default `3`), `$maxWidth` (the content column, default 48rem)                                                                                                                                                                                                                                                              |
| `ShellMainHeader`                                      | A sticky bar inside main. `$show`, `$height`, `$blur`, `$sticky`                                                                                                                                                                                                                                                                             |
| `ShellMainIntro`, `ShellMainBody`                      | The content. Each direct child is a grid item in the centered column                                                                                                                                                                                                                                                                         |
| `ShellMainFull`, `ShellMainFeature`, `ShellMainPopout` | Bands that are wider than the column, as direct children of the body                                                                                                                                                                                                                                                                         |
| `ShellFooter`                                          | `start`, `center`, `end`, `$height`. Not sticky                                                                                                                                                                                                                                                                                              |

The shell is a container named `shell`. Use `@3xl/shell:` and `@max-3xl/shell:` classes to follow its width, for example to hide the sidebar toggle at the widths where the sidebar does not show. The main body is a container named `shell-main-body`.

`ShellBoxNav` in this example is a `Nav` with three links.

```tsx
function ShellInBox() {
  const [open, setOpen] = useState(true);
  return (
    <Frame $border $rounded="xl" className="h-96 w-full overflow-auto [container-type:size]">
      <Shell $forceRounded className="[--shell-top:0px]!">
        <ShellHeader
          $height="sm"
          start={
            <Button aria-label="Toggle sidebar" aria-expanded={open} onClick={() => setOpen(!open)}>
              <ButtonSlot>
                <Users />
              </ButtonSlot>
            </Button>
          }
          center={<Text className="text-sm font-medium">ShellHeader</Text>}
          end={<Badge $forceRounded>end</Badge>}
        />
        <ShellSidebar open={open} $width="xs" $show="md" aria-label="Start" render={<nav />}>
          <ShellSidebarBody $p={2}>
            <ShellBoxNav />
          </ShellSidebarBody>
        </ShellSidebar>
        <ShellMain $p={4}>
          <ShellMainHeader $height="sm" $sticky>
            <div className="flex items-center justify-between">
              <Text className="text-sm font-medium">ShellMainHeader</Text>
              <Button $size="sm" $lightnessOffset>
                Action
              </Button>
            </div>
          </ShellMainHeader>
          <ShellMainIntro>
            <Text className="ak-ink-60 text-sm">ShellMainIntro</Text>
          </ShellMainIntro>
          <ShellMainBody>
            <div className="grid gap-3">
              {Array.from({ length: 8 }, (_, index) => (
                <Frame key={index} $lighten $border $rounded="lg" $p={3}>
                  <Text className="text-sm">ShellMainBody row {index + 1}</Text>
                </Frame>
              ))}
            </div>
          </ShellMainBody>
        </ShellMain>
        <ShellSidebar $side="end" $width="xs" $show="2xl" aria-label="End" render={<aside />}>
          <ShellSidebarBody>
            <Text className="ak-ink-60 text-sm">End sidebar</Text>
          </ShellSidebarBody>
        </ShellSidebar>
        <ShellFooter $height="sm" start={<Text className="ak-ink-60 text-sm">ShellFooter</Text>} />
      </Shell>
    </Frame>
  );
}
```

Gotchas:

- Put one wrapper element in `ShellMainBody` and lay out inside it. Direct children are grid items, so margins do not collapse.
- A direct child of `ShellMainHeader` must be an element. Wrap text in a `div`.
- The default content column is 48rem wide. For an app page, pass `$maxWidth="72rem"` or `$maxWidth="100%"`.
- A shell in a box, as above, needs three things: the box is the size container and the scroll container (`[container-type:size] overflow-auto`), the shell resets the sticky offset of the shells around it (`[--shell-top:0px]!`), and the shell keeps its own radius (`$forceRounded`). At the root of a bare preview, none of them is necessary.
- A frame around a shell changes the radius of everything in the shell (pitfall 3). Pass `$forceRounded` to the shell when you are not sure what is around it.

## Recipes

Each recipe is one function in `src/lab/primitives/recipes.tsx` or `page-shell.tsx`.

### Page shell with header and sidebar

```tsx
function PageShell({ brand, actions, sidebar, children, ...props }: PageShellProps) {
  const [open, setOpen] = useState(true);
  const sidebarId = useId();
  return (
    <Shell {...props}>
      <ShellHeader
        $height="sm"
        $blur
        start={
          <>
            <Button
              className="@max-3xl/shell:hidden"
              aria-label="Toggle sidebar"
              aria-expanded={open}
              aria-controls={sidebarId}
              onClick={() => setOpen(!open)}
            >
              <ButtonSlot>
                <PanelLeft />
              </ButtonSlot>
            </Button>
            {brand}
          </>
        }
        end={actions}
      />
      <ShellSidebar id={sidebarId} open={open} $width="sm" aria-label="Sections" render={<nav />}>
        <ShellSidebarBody $p={2}>{sidebar}</ShellSidebarBody>
      </ShellSidebar>
      <ShellMain $p="1.5rem" $maxWidth="64rem">
        <ShellMainBody>{children}</ShellMainBody>
      </ShellMain>
    </Shell>
  );
}
```

Usage, in a box:

<!-- prettier-ignore -->
```tsx
<Frame $border $rounded="xl" className="h-80 w-full overflow-auto [container-type:size]">
  <PageShell
    $forceRounded
    className="[--shell-top:0px]!"
    brand={<Text className="font-medium">Visonaut</Text>}
    actions={
      <Button $size="sm" $lightnessOffset>
        Sign in
      </Button>
    }
    sidebar={
      <Nav render={<div aria-label="Pages" />} className="text-sm">
        <NavLink href="#recipe-page-shell" aria-current="page">
          Inbox
        </NavLink>
        <NavLink href="#recipe-page-shell">History</NavLink>
        <NavLink href="#recipe-page-shell">Status</NavLink>
      </Nav>
    }
  >
    <div className="grid gap-3">
      {Array.from({ length: 6 }, (_, index) => (
        <Frame key={index} $lighten $border $rounded="lg" $p={3}>
          <Text className="text-sm">The page scrolls. Row {index + 1}</Text>
        </Frame>
      ))}
    </div>
  </PageShell>
</Frame>
```

### Fixed app frame

For a workspace that does not scroll as a page. The shell takes the height of its container (`h-dvh` at the root of a page), and the main body and the sidebar bodies scroll.

<!-- prettier-ignore -->
```tsx
<Frame $border $rounded="xl" className="h-96 w-full overflow-clip [container-type:size]">
  <Shell $forceRounded className="h-full [--shell-top:0px]!">
    <ShellHeader
      $height="sm"
      start={<Text className="text-sm font-medium">Fixed app frame</Text>}
      end={
        <Button $size="sm" $layer="brand">
          Approve
        </Button>
      }
    />
    <ShellSidebar $width="xs" $show aria-label="List" render={<nav />}>
      <ShellSidebarBody $p={2}>
        <Nav render={<div aria-label="Screenshots" />} className="text-sm">
          {Array.from({ length: 16 }, (_, index) => (
            <NavLink key={index} href="#shell" aria-current={index === 0 ? "page" : undefined}>
              Screenshot {index + 1}
            </NavLink>
          ))}
        </Nav>
      </ShellSidebarBody>
    </ShellSidebar>
    <ShellMain $p={4} $maxWidth="100%">
      <ShellMainBody className="overflow-y-auto">
        <div className="grid gap-3">
          {Array.from({ length: 8 }, (_, index) => (
            <Frame key={index} $lighten $border $rounded="lg" $p={3}>
              <Text className="text-sm">The body scrolls. Row {index + 1}</Text>
            </Frame>
          ))}
        </div>
      </ShellMainBody>
    </ShellMain>
  </Shell>
</Frame>
```

### Toolbar

A `ButtonGroup` with a border is the surface. `TextFrame` holds static text on the same baseline, and `ms-auto` splits the bar.

<!-- prettier-ignore -->
```tsx
<ButtonGroup role="toolbar" aria-label="Review" $border className="w-full items-center">
  <Button aria-label="Previous">
    <ButtonSlot>
      <ChevronLeft />
    </ButtonSlot>
  </Button>
  <Button aria-label="Next">
    <ButtonSlot>
      <ChevronRight />
    </ButtonSlot>
  </Button>
  <TextFrame $p={2} $ink={60} className="text-sm tabular-nums">
    3 of 12
  </TextFrame>
  <ButtonSeparator className="ms-auto" />
  <Button>
    <ButtonSlot>
      <X />
    </ButtonSlot>
    <ButtonLabel>Reject</ButtonLabel>
    <ButtonSlot $kind="shortcut">
      <kbd>R</kbd>
    </ButtonSlot>
  </Button>
  <Button $layer="brand">
    <ButtonSlot>
      <Check />
    </ButtonSlot>
    <ButtonLabel>Approve</ButtonLabel>
    <ButtonSlot $kind="shortcut">
      <kbd>A</kbd>
    </ButtonSlot>
  </Button>
</ButtonGroup>
```

### Segmented control

<!-- prettier-ignore -->
```tsx
<ak.RadioProvider defaultValue="split">
  <ak.RadioGroup aria-label="Compare mode" render={<ButtonGroup $border $size="sm" />}>
    <ak.Radio value="split" render={<Button />}>
      Split
    </ak.Radio>
    <ak.Radio value="overlay" render={<Button />}>
      Overlay
    </ak.Radio>
    <ak.Radio value="diff" render={<Button />}>
      Diff
    </ak.Radio>
    <ButtonGlider $kind="bevel" />
    <ButtonGlider $state="focus" />
  </ak.RadioGroup>
</ak.RadioProvider>
```

### List row with leading and trailing slots

```tsx
const RUNS: RunRow[] = [
  {
    id: "7412",
    title: "Add the combobox select",
    meta: "#7412 · 4 min ago",
    changes: 12,
    color: "warning",
  },
  {
    id: "7398",
    title: "Fix the dialog focus",
    meta: "#7398 · 1 h ago",
    changes: 0,
    color: "success",
  },
  {
    id: "7391",
    title: "Update the tab glider",
    meta: "#7391 · 3 h ago",
    changes: 3,
    color: "danger",
  },
];
```

<!-- prettier-ignore -->
```tsx
<ButtonGroup aria-label="Runs" $layout="vertical" $border $p={1} className="w-full">
  {RUNS.map((run) => (
    <Button key={run.id} $p={3} render={<a href="#recipe-list-row" />} className="text-start">
      <ButtonSlot $kind="avatar" $size="lg" $rowSpan={2} $layer={run.color} $mix={20}>
        <GitPullRequest className="size-1/2" />
      </ButtonSlot>
      <ButtonContent>
        <ButtonLabel>{run.title}</ButtonLabel>
        <ButtonDescription>{run.meta}</ButtonDescription>
      </ButtonContent>
      {run.changes > 0 && (
        <ButtonSlot $kind="badge" $p="md" $layer={run.color}>
          {run.changes}
        </ButtonSlot>
      )}
      <ButtonSlot $ink={40}>
        <ChevronRight />
      </ButtonSlot>
    </Button>
  ))}
  <ButtonGlider $state="hover" />
  <ButtonGlider $state="focus" />
</ButtonGroup>
```

For a list of links with a current row, use `Nav` with `NavLink`, `NavSlot`, `NavLinkContent`, `NavLinkLabel`, and `NavLinkDescription`.

### Card

<!-- prettier-ignore -->
```tsx
<Frame $lighten $border $rounded="2xl" $p="1rem" className="grid w-full gap-4">
  <div className="flex items-start justify-between gap-3">
    <div className="grid gap-1">
      <Heading className="mt-0 mb-0 text-base">Baseline</Heading>
      <Text className="ak-ink-70 text-sm">Captured on main, two hours ago.</Text>
    </div>
    <Badge $layer="success">
      <BadgeLabel>Current</BadgeLabel>
    </Badge>
  </div>
  <Frame $cover $darken={0.5} $p={2} className="flex justify-end gap-2 border-t">
    <Button $size="sm">Compare</Button>
    <Button $size="sm" $lightnessOffset>
      Open
    </Button>
  </Frame>
</Frame>
```

### Stat

```tsx
function Stat({ label, value, delta, color }: StatProps) {
  return (
    <Frame $lighten $border $rounded="xl" $p="1rem" className="grid gap-1">
      <Text className="ak-ink-60 text-sm">{label}</Text>
      <div className="flex items-baseline gap-2">
        <Text className="text-3xl font-semibold tabular-nums">{value}</Text>
        {delta && (
          <Text $text={color} className="text-sm font-medium tabular-nums">
            {delta}
          </Text>
        )}
      </div>
    </Frame>
  );
}
```

### Media frame

<!-- prettier-ignore -->
```tsx
<Frame $border $rounded="xl" $p={1} className="grid w-full gap-1">
  <Frame $darken $border className="grid aspect-video place-items-center overflow-clip">
    <Text className="ak-ink-40 text-sm">Screenshot</Text>
  </Frame>
  <div className="flex items-center justify-between gap-2 px-2 py-1 text-sm">
    <Text className="truncate font-medium">button/default</Text>
    <Text className="ak-ink-60 tabular-nums">1440 × 900</Text>
  </div>
</Frame>
```

### Status badge with dot or icon

```tsx
const STATUS_STYLES: Record<RunStatus, StatusStyle> = {
  review: { label: "Needs review", color: "warning", icon: CircleAlert },
  passed: { label: "Passed", color: "success", icon: CircleCheck },
  failed: { label: "Failed", color: "danger", icon: CircleX },
  running: { label: "Comparing", color: "brand", icon: LoaderCircle },
  replaced: { label: "Replaced", icon: Clock },
};
```

```tsx
function StatusBadge({ status, dot }: StatusBadgeProps) {
  const { label, color, icon: Icon } = STATUS_STYLES[status];
  return (
    <Badge $layer={color ?? true} $forceRounded>
      <BadgeSlot $size={dot ? "xs" : "md"}>
        {dot ? <Circle fill="currentColor" /> : <Icon />}
      </BadgeSlot>
      <BadgeLabel>{label}</BadgeLabel>
    </Badge>
  );
}
```

### Input with icon and shortcut hint

<!-- prettier-ignore -->
```tsx
<InputGroup $rounded="lg" className="w-full">
  <InputSlot className="ak-ink-60">
    <Search />
  </InputSlot>
  <input aria-label="Search runs" placeholder="Search runs" className="min-w-0 flex-1" />
  <InputSlot $kind="shortcut" $size="xl">
    <Kbd>/</Kbd>
  </InputSlot>
</InputGroup>
```

### Menu-like popover

The recipes come from `components/ariakit/styles/popover.ts` and `styles/option.ts`, and the parts `OptionLabel` and `OptionSlot` from `components/option.ariakit.react.tsx`. To pick one value, use a select.

<!-- prettier-ignore -->
```tsx
<ak.MenuProvider>
  <ak.MenuButton render={<Button $lightnessOffset aria-label="More actions" />}>
    <ButtonSlot>
      <Ellipsis />
    </ButtonSlot>
  </ak.MenuButton>
  <ak.Menu
    portal
    gutter={8}
    {...popover.jsx({ $p: 1, $rounded: "xl", className: "grid min-w-52 outline-none" })}
  >
    <ak.MenuItem {...option.jsx()}>
      <OptionSlot>
        <Copy />
      </OptionSlot>
      <OptionLabel className="flex-1">Copy link</OptionLabel>
      <OptionSlot $kind="shortcut">
        <kbd>⌘C</kbd>
      </OptionSlot>
    </ak.MenuItem>
    <ak.MenuItem {...option.jsx()}>
      <OptionSlot>
        <ExternalLink />
      </OptionSlot>
      <OptionLabel className="flex-1">Open pull request</OptionLabel>
    </ak.MenuItem>
    <ak.MenuItem {...option.jsx()}>
      <OptionSlot>
        <RefreshCw />
      </OptionSlot>
      <OptionLabel className="flex-1">Run again</OptionLabel>
    </ak.MenuItem>
    <ak.MenuSeparator render={<Separator $line="solid" $gap={1} />} />
    <ak.MenuItem {...option.jsx({ $text: "danger" })}>
      <OptionSlot>
        <Trash2 />
      </OptionSlot>
      <OptionLabel className="flex-1">Delete run</OptionLabel>
    </ak.MenuItem>
  </ak.Menu>
</ak.MenuProvider>
```

### Confirm dialog

<!-- prettier-ignore -->
```tsx
<DialogProvider>
  <DialogDisclosure $layer="brand">Approve all</DialogDisclosure>
  <Dialog className="grid max-w-88 gap-4">
    <DialogHeading>Approve 12 changes?</DialogHeading>
    <DialogDescription>They become the baseline for the next runs.</DialogDescription>
    <div className="flex justify-end gap-2">
      <DialogDismiss>Cancel</DialogDismiss>
      <DialogDismiss $layer="brand">Approve</DialogDismiss>
    </div>
  </Dialog>
</DialogProvider>
```

### Tooltip on icon button

```tsx
function IconButton({ label, shortcut, children }: IconButtonProps) {
  return (
    <TooltipProvider>
      <TooltipAnchor render={<Button aria-label={label} />}>
        <ButtonSlot>{children}</ButtonSlot>
      </TooltipAnchor>
      <Tooltip className="flex items-center gap-2">
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </Tooltip>
    </TooltipProvider>
  );
}
```

### Empty state

<!-- prettier-ignore -->
```tsx
<Frame
  $border
  $borderType="dashed"
  $rounded="2xl"
  $p="2rem"
  className="grid w-full justify-items-center gap-3 text-center"
>
  <Frame $layer="brand" $mix={15} $rounded="full" $p={3}>
    <Text $text="brand" className="flex">
      <Inbox className="size-6" />
    </Text>
  </Frame>
  <div className="grid gap-1">
    <Heading className="mt-0 mb-0 text-base">All done</Heading>
    <Text className="ak-ink-70 text-sm">No run needs a decision.</Text>
  </div>
  <Button $lightnessOffset $size="sm">
    Open history
  </Button>
</Frame>
```

### Callout

<!-- prettier-ignore -->
```tsx
<Frame
  $layer="warning"
  $mix={12}
  $border
  $edge="warning"
  $rounded="xl"
  $p={3}
  className="flex w-full items-start gap-3"
>
  <Text $text="warning" className="flex h-lh items-center">
    <TriangleAlert className="size-[1.25em]" />
  </Text>
  <div className="grid flex-1 gap-0.5">
    <Text className="font-medium">A newer run replaced this one</Text>
    <Text className="ak-ink-70 text-sm">Decisions here do not change the check.</Text>
  </div>
  <Link href="#recipe-callout" className="text-sm">
    Open run 3
  </Link>
</Frame>
```

### Skeleton placeholder

<!-- prettier-ignore -->
```tsx
<div aria-busy="true" aria-label="Loading runs" className="grid w-full gap-4">
  {[0, 1, 2].map((row) => (
    <div key={row} className="flex items-center gap-3">
      <Frame $lightnessOffset={2} $rounded="full" className="size-9 animate-pulse" />
      <div className="grid flex-1 gap-2">
        <Frame $lightnessOffset={2} $rounded="sm" className="h-3.5 w-2/3 animate-pulse" />
        <Frame $lightnessOffset={1} $rounded="sm" className="h-3 w-1/3 animate-pulse" />
      </div>
      <Frame $lightnessOffset={1} $rounded="full" className="h-5 w-12 animate-pulse" />
    </div>
  ))}
</div>
```

### Keyboard hint

<!-- prettier-ignore -->
```tsx
<Text className="ak-ink-60 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
  <span className="flex items-center gap-1.5">
    <Kbd>J</Kbd>
    <Kbd>K</Kbd>
    Navigate
  </span>
  <span className="flex items-center gap-1.5">
    <Kbd>A</Kbd>
    Approve
  </span>
  <span className="flex items-center gap-1.5">
    <Kbd>R</Kbd>
    Reject
  </span>
  <span className="flex items-center gap-1.5">
    <Kbd>⌘</Kbd>
    <Kbd>K</Kbd>
    Search
  </span>
</Text>
```

### Run table

```tsx
const RUN_TABLE_ROWS: TableRows<RunColumn> = [
  {
    group: "head",
    run: { children: "Run", $grow: true },
    status: { children: "Status", $fit: true },
    changes: { children: "Changes", numeric: true, $fit: true },
    updated: { children: "Updated", $fit: true },
  },
  {
    key: "7412",
    run: "Add the combobox select",
    status: <StatusBadge status="review" />,
    changes: 12,
    updated: "4 min",
  },
  {
    key: "7398",
    run: "Fix the dialog focus",
    status: <StatusBadge status="passed" />,
    changes: 0,
    updated: "1 h",
  },
  {
    key: "7391",
    run: "Update the tab glider",
    status: <StatusBadge status="failed" />,
    changes: 3,
    updated: "3 h",
  },
];
```

<!-- prettier-ignore -->
```tsx
<Table
  aria-label="Runs"
  rows={RUN_TABLE_ROWS}
  container={{ $border: true }}
  $borderInline={false}
  $p={2}
  className="text-sm"
/>
```

### Page tabs

Flat tabs with a bar and no card. The root has no border or padding, the strip and the panel paint nothing, and the selected tab has no fill.

<!-- prettier-ignore -->
```tsx
<Tabs
  defaultSelectedId="recipe-tabs-changes"
  $border={false}
  $p="none"
  $panelRoundedTop={false}
  className="w-full"
>
  <TabList aria-label="Run" $layer="transparent" $darken={false} className="border-b">
    <Tab $kind="flat" $selectedOffset={false} id="recipe-tabs-changes">
      <TabLabel>Changes</TabLabel>
      <TabSlot $kind="badge" $p="md" $layer="warning">
        12
      </TabSlot>
    </Tab>
    <Tab $kind="flat" $selectedOffset={false} id="recipe-tabs-passed">
      <TabLabel>Passed</TabLabel>
      <TabSlot $kind="badge" $p="md" $layer $lightnessOffset={2}>
        108
      </TabSlot>
    </Tab>
    <Tab $kind="flat" $selectedOffset={false} id="recipe-tabs-problems">
      <TabLabel>Problems</TabLabel>
    </Tab>
    <TabGlider $kind="bar" />
  </TabList>
  <TabPanels $layer="transparent" $lighten={false} $p="none" className="pt-4">
    <TabPanel single>
      <Text className="ak-ink-70 text-sm">The panel follows the selected tab.</Text>
    </TabPanel>
  </TabPanels>
</Tabs>
```

### Progress bar and ring

<!-- prettier-ignore -->
```tsx
<div className="flex w-full items-center gap-6">
  <div className="grid flex-1 gap-2">
    <div className="flex items-baseline justify-between text-sm">
      <Text id="recipe-progress-label" className="font-medium">
        Comparing
      </Text>
      <Text className="ak-ink-60 tabular-nums">78 of 120</Text>
    </div>
    <Progress aria-labelledby="recipe-progress-label" value={0.65} />
  </div>
  <div className="size-14 flex-none">
    <ProgressCircular aria-label="Reviewed" value={0.4} $thickness={1.5}>
      <Text className="text-xs font-medium tabular-nums">40%</Text>
    </ProgressCircular>
  </div>
</div>
```

### Toggle

```tsx
function Switch({ label, defaultChecked = false }: SwitchProps) {
  const store = ak.useCheckboxStore<boolean>({ defaultValue: defaultChecked });
  const checked = ak.useStoreState(store, "value");
  return (
    <label className="flex items-center gap-3 text-sm">
      <ak.Checkbox
        store={store}
        role="switch"
        render={
          <Button
            $layer={checked ? "brand" : true}
            $lightnessOffset={checked ? false : 3}
            $rounded="full"
            $p={0.5}
            $px="sm"
            className="w-9 flex-none justify-start"
          />
        }
      >
        <Frame
          $layer="white"
          $rounded="full"
          className={cx("size-4 transition-transform", checked && "translate-x-4")}
        />
      </ak.Checkbox>
      {label}
    </label>
  );
}
```

### Filter chips

```tsx
const FILTERS: Filter[] = [
  { value: "changed", label: "Changed", count: 9, checked: true },
  { value: "added", label: "Added", count: 2, checked: true },
  { value: "removed", label: "Removed", count: 1 },
  { value: "failed", label: "Failed", count: 0 },
];
```

<!-- prettier-ignore -->
```tsx
<div role="group" aria-label="Filters" className="flex flex-wrap gap-2">
  {FILTERS.map((filter) => (
    <CheckboxCard
      key={filter.value}
      value={filter.value}
      defaultChecked={filter.checked}
      disabled={filter.count === 0}
      $size="sm"
      $rounded="full"
      $p={1}
      $px="lg"
    >
      <CheckboxCardLabel>{filter.label}</CheckboxCardLabel>
      <CheckboxCardSlot $ink={60} className="tabular-nums">
        {filter.count}
      </CheckboxCardSlot>
    </CheckboxCard>
  ))}
</div>
```

## Do and do not

Do:

- Use recipe props before `ak-*` classes: `$lighten`, not `ak-layer-lighten-5`. The exception is `ak-ink-*` on text elements.
- Use spacing steps for `$p` and named steps for `$rounded`, so the Look controls work. Use `$p="1rem"` when the children must keep their own radius.
- Let a group own the surface and the edge: one bordered `ButtonGroup`, not three bordered buttons.
- Use one brand surface for each view. Other actions are neutral or see-through.
- Use `$mix` tints and `$text` colors for status. Use solid colors for the one thing that must stand out.
- Put text in a `*Label` part and each icon in a `*Slot` part.
- Use `Text` with `ak-ink-60` or `ak-ink-70` for secondary text, and `tabular-nums` for numbers that change.
- Give every icon-only control an `aria-label`, and every group, nav, and landmark a name.
- Use `render` for links and other elements. Do not wrap a button in an anchor.
- Check each variant in light (`?theme=light`) and on a narrow width.

Do not:

- Do not use `$layer="primary"`, hex colors, or Tailwind palette classes (`bg-zinc-900`, `text-gray-400`, `border-white/10`).
- Do not paint a layer on a wrapper. If `"transparent"` works, a second painted layer is wrong.
- Do not style states with `hover:` and `dark:` classes when a state prop or an `ak-dark:` variant exists.
- Do not add a `border` class for an outline. Use `$border`.
- Do not override `$rounded` with `rounded-*` classes, or `$p` with `p-*`.
- Do not use `List` for rows that act, `Link` for navigation rows, or `Badge` for a count inside a control.
- Do not put text directly beside a slot when the gap matters. Wrap it in the label part.
- Do not nest a `Shell` in a frame without `$forceRounded`.
- Do not build a selected state with classes on a `Button`. Use a glider, `Tab`, `NavLink`, a `CheckboxCard`, or props from state.
- Do not write long labels. Most captions in this lab are one to three words.

## What the primitives cannot do yet

| Need                                    | Best fallback                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Menu                                    | `ak.Menu` with the `popover` recipe and `ak.MenuItem` with the `option` recipe. See [Menu-like popover](#menu-like-popover)         |
| Switch                                  | A checkbox store on a `Button` with `role="switch"`. See [Toggle](#toggle). Or a `CheckboxField`                                    |
| Toggle button, filter chip              | `CheckboxCard` as a chip, or a `Button` with `aria-pressed` and props from state (`$lightnessOffset={pressed ? 2 : undefined}`)     |
| Avatar                                  | A slot with `$kind="avatar"` inside a control. Outside a control, a `Frame` with `$rounded="full"`, a layer color, and a fixed size |
| Skeleton, spinner                       | `Frame` with `$lightnessOffset` and `animate-pulse`. `ProgressCircular` without a value                                             |
| Alert, callout, toast                   | `Frame` with a status `$layer`, `$mix`, and `$edge`. See [Callout](#callout). No toast stack exists                                 |
| Card, stat, empty state                 | `Frame` recipes above                                                                                                               |
| Image, aspect ratio, media              | `Frame` with `overflow-clip` and Tailwind `aspect-*` classes                                                                        |
| Slider, range                           | A native `input type="range"`, or `ak.Composite`. No styled primitive                                                               |
| Resizable panes, split view             | Plain CSS grid in a fixed app frame. No primitive                                                                                   |
| Scroll area                             | `overflow-auto` on a `Frame`, or `PopoverScroll` and `DialogScroll` inside overlays                                                 |
| Breadcrumb                              | `ButtonGroup` with `ButtonSeparator $kind="chevron"`                                                                                |
| Pagination                              | `ButtonGroup` with icon buttons and a `TextFrame`                                                                                   |
| Shadows as a prop                       | `shadow-*` classes. Only popovers have `$shadow`                                                                                    |
| Selected state on `Button`              | A glider, or props from state                                                                                                       |
| Text truncation on `Text`               | The `truncate` class with `min-w-0` on the flex parent. Labels have `$truncate`                                                     |
| Form field wrapper, error text          | `Text render={<label />}`, `Input aria-invalid`, and `Text $text="danger"`                                                          |
| Date and time formatting, relative time | Plain text in `Text` with `tabular-nums`                                                                                            |
| Gliders without CSS anchor positioning  | None. The glider is hidden, and a `ButtonGroup` shows no selection                                                                  |
