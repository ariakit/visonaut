import { Link as RouterLink } from "@tanstack/react-router";
import { Check, Settings, Trash2 } from "lucide-react";
import { Badge, BadgeLabel } from "../../components/ariakit/components/badge.ariakit.react.tsx";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../../components/ariakit/components/frame.ariakit.react.tsx";
import {
  Heading,
  HeadingLevel,
} from "../../components/ariakit/components/heading.ariakit.react.tsx";
import { Input } from "../../components/ariakit/components/input.ariakit.react.tsx";
import { Kbd } from "../../components/ariakit/components/kbd.ariakit.react.tsx";
import { Layer } from "../../components/ariakit/components/layer.ariakit.react.tsx";
import { Link } from "../../components/ariakit/components/link.ariakit.react.tsx";
import { TextFrame } from "../../components/ariakit/components/text-frame.ariakit.react.tsx";
import { Text } from "../../components/ariakit/components/text.ariakit.react.tsx";
import { Example } from "./kit.tsx";
import type { ReferenceEntry } from "./kit.tsx";

const COLORS = ["brand", "secondary", "success", "warning", "danger"] as const;

/** A frame paints when a layer prop moves its color. */
export function LayerSurfaces() {
  return (
    <>
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
    </>
  );
}

export function LayerColors() {
  return (
    <>
      {COLORS.map((color) => (
        <Frame key={color} $layer={color} $rounded="lg" $p={3}>
          {color}
        </Frame>
      ))}
      <Frame $layer="#635bff" $rounded="lg" $p={3}>
        #635bff
      </Frame>
    </>
  );
}

/** `$mix` blends the color into the surface behind it. */
export function LayerTints() {
  return (
    <>
      {COLORS.map((color) => (
        <Frame key={color} $layer={color} $mix={15} $rounded="lg" $p={3}>
          {color}
        </Frame>
      ))}
    </>
  );
}

/** The same props give another color at each level. */
export function LayerNesting() {
  return (
    <Frame $lighten $border $rounded="3xl" $p={2} className="grid gap-2">
      <Text className="px-2 pt-1">Card</Text>
      <Frame $darken $border $p={2} className="grid gap-2">
        <Text className="px-2 pt-1">Well</Text>
        <Frame $lighten $border $p={2} className="px-3">
          Chip
        </Frame>
      </Frame>
    </Frame>
  );
}

function ContextSample() {
  return (
    <>
      <Text>Text</Text>
      <Text className="ak-ink-60">Muted</Text>
      <Link href="#layer">Link</Link>
      <Badge>
        <BadgeLabel>Badge</BadgeLabel>
      </Badge>
      <Kbd>K</Kbd>
      <Button $lightnessOffset>Button</Button>
    </>
  );
}

/** Everything inside a layer adapts to the color of that layer. */
export function LayerContext() {
  return (
    <>
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
    </>
  );
}

/** `Layer` is the color context alone, without frame geometry. */
export function LayerPlain() {
  return (
    <Layer $lighten className="grid gap-1 p-4">
      <Text>Layer</Text>
      <Text className="ak-ink-60 text-sm">No radius, padding or border props.</Text>
    </Layer>
  );
}

/** `$ink` sets the text strength of a layer. Use `ak-ink-*` on text elements. */
export function InkLevels() {
  return (
    <>
      <Frame $ink={60} $lighten $rounded="lg" $p={3}>
        $ink 60
      </Frame>
      <Text>100</Text>
      <Text className="ak-ink-80">80</Text>
      <Text className="ak-ink-60">60</Text>
      <Text className="ak-ink-40">40</Text>
      <Text className="ak-ink-0">0</Text>
    </>
  );
}

export function FrameRadius() {
  return (
    <>
      {(["none", "sm", "md", "lg", "xl", "2xl", "3xl", "full"] as const).map((rounded) => (
        <Frame key={rounded} $lighten $border $rounded={rounded} $p={3}>
          {rounded}
        </Frame>
      ))}
    </>
  );
}

/** `$p` takes spacing steps. One step is 0.25em. */
export function FramePadding() {
  return (
    <>
      {([1, 2, 3, 4, 6] as const).map((padding) => (
        <Frame key={padding} $lighten $border $rounded="lg" $p={padding}>
          {padding}
        </Frame>
      ))}
      <Frame $lighten $border $rounded="lg" $p="1rem">
        1rem
      </Frame>
    </>
  );
}

/**
 * A nested frame takes the radius that is concentric with its parent: the
 * parent radius minus the parent padding and border.
 */
export function FrameConcentric() {
  return (
    <>
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
    </>
  );
}

/**
 * Inside a frame with less than 1rem of padding, a control or a pill loses its
 * own radius. `$forceRounded` keeps it.
 */
export function FrameNestedControls() {
  return (
    <>
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
    </>
  );
}

/** `$cover` stretches a child over the padding of its parent frame. */
export function FrameCover() {
  return (
    <Frame $lighten $border $rounded="2xl" $p={3} className="grid w-64 gap-3">
      <Frame $cover $darken $p={3}>
        Header band
      </Frame>
      <Text>Body</Text>
      <Frame $cover $darken $p={3}>
        Footer band
      </Frame>
    </Frame>
  );
}

export function FrameBorders() {
  return (
    <>
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
    </>
  );
}

export function FrameEdges() {
  return (
    <>
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
    </>
  );
}

/** Shadows and one-sided seams are Tailwind utilities on a painted frame. */
export function FrameShadowsAndSeams() {
  return (
    <>
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
    </>
  );
}

export function TextColors() {
  return (
    <>
      {COLORS.map((color) => (
        <Text key={color} $text={color}>
          {color}
        </Text>
      ))}
      <Text $text="brand" $textHue="magenta">
        hue
      </Text>
    </>
  );
}

/**
 * On a layer element such as a button, `$text` colors the labels and the icons
 * inside it. It does not color bare text.
 */
export function TextOnControls() {
  return (
    <>
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
    </>
  );
}

export function TextSizes() {
  return (
    <>
      <Text className="text-xs">text-xs</Text>
      <Text className="text-sm">text-sm</Text>
      <Text className="text-base">text-base</Text>
      <Text className="text-lg font-medium">text-lg</Text>
      <Text className="font-mono text-sm tabular-nums">font-mono 0123</Text>
    </>
  );
}

/** Each `HeadingLevel` adds one level. `$level` sets the size alone. */
export function HeadingLevels() {
  return (
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
  );
}

export function HeadingSizes() {
  return (
    <>
      <Heading $level={4}>$level 4</Heading>
      <Heading className="text-base">text-base</Heading>
      <Heading className="text-sm font-semibold">text-sm font-semibold</Heading>
      <Heading $level={5} $text="brand">
        $text brand
      </Heading>
    </>
  );
}

/** A text frame starts its text where a control label starts. */
export function TextFrameLabels() {
  return (
    <div className="grid w-48">
      <TextFrame $p={2} $rounded="md" $ink={60} className="text-sm">
        Workspace
      </TextFrame>
      <Button className="justify-start">Inbox</Button>
      <Button className="justify-start">History</Button>
    </div>
  );
}

/** `render` swaps the element and keeps the styles and the behavior. */
export function RenderComposition() {
  return (
    <>
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
    </>
  );
}

/** Hover, press, and tab to these. `aria-current` and `aria-selected` select. */
export function ControlStates() {
  return (
    <>
      <Button $lightnessOffset>Rest</Button>
      <Button $lightnessOffset $hoverOffset={3}>
        Strong hover
      </Button>
      <Button $lightnessOffset $active={false}>
        No press scale
      </Button>
      <Button $lightnessOffset $focusHighlight>
        Focus highlight
      </Button>
      <Button $lightnessOffset $focus={3} $focusOffset={2}>
        Thick focus ring
      </Button>
      <Button $lightnessOffset disabled>
        Disabled
      </Button>
      <Button $ink={60}>
        <ButtonSlot>
          <Settings />
        </ButtonSlot>
        <ButtonLabel>Dimmed</ButtonLabel>
      </Button>
    </>
  );
}

export const foundationEntries: ReferenceEntry[] = [
  {
    id: "layer",
    title: "Layer",
    file: "layer.ariakit.react.tsx",
    note: "A layer is a surface and a color context. Its text, edges, and children take their colors from it.",
    render: () => (
      <>
        <Example title="Surfaces">
          <LayerSurfaces />
        </Example>
        <Example title="Colors">
          <LayerColors />
        </Example>
        <Example title="Tints ($mix)">
          <LayerTints />
        </Example>
        <Example title="Nesting" stack>
          <LayerNesting />
        </Example>
        <Example title="Color context" stack>
          <LayerContext />
        </Example>
        <Example title="Ink">
          <InkLevels />
        </Example>
        <Example title="Layer component" stack>
          <LayerPlain />
        </Example>
      </>
    ),
  },
  {
    id: "frame",
    title: "Frame",
    file: "frame.ariakit.react.tsx",
    note: "A frame is geometry: radius, padding, and border. It paints nothing until a layer prop moves its color.",
    render: () => (
      <>
        <Example title="$rounded">
          <FrameRadius />
        </Example>
        <Example title="$p" className="items-start">
          <FramePadding />
        </Example>
        <Example title="Concentric radius" wide className="items-start">
          <FrameConcentric />
        </Example>
        <Example title="Controls in a padded frame" wide>
          <FrameNestedControls />
        </Example>
        <Example title="$cover">
          <FrameCover />
        </Example>
        <Example title="$border and $borderType">
          <FrameBorders />
        </Example>
        <Example title="$edge and $edgeWeight">
          <FrameEdges />
        </Example>
        <Example title="Shadows and seams">
          <FrameShadowsAndSeams />
        </Example>
      </>
    ),
  },
  {
    id: "text",
    title: "Text",
    file: "text.ariakit.react.tsx",
    note: "A span that takes an adaptive text color. Sizes and weights are Tailwind utilities.",
    render: () => (
      <>
        <Example title="$text">
          <TextColors />
        </Example>
        <Example title="$text on a control">
          <TextOnControls />
        </Example>
        <Example title="Sizes" className="items-baseline">
          <TextSizes />
        </Example>
      </>
    ),
  },
  {
    id: "heading",
    title: "Heading",
    file: "heading.ariakit.react.tsx",
    note: "The element comes from the HeadingLevel context. Without a context, every heading is an h1.",
    render: () => (
      <>
        <Example title="Levels" stack className="gap-0!">
          <HeadingLevels />
        </Example>
        <Example title="Sizes" stack className="gap-0!">
          <HeadingSizes />
        </Example>
      </>
    ),
  },
  {
    id: "text-frame",
    title: "TextFrame",
    file: "text-frame.ariakit.react.tsx",
    render: () => (
      <Example title="Label on the control column">
        <TextFrameLabels />
      </Example>
    ),
  },
  {
    id: "composition",
    title: "Composition and state",
    note: "Every primitive takes render. State styles come from the DOM state, not from props.",
    render: () => (
      <>
        <Example title="render">
          <RenderComposition />
        </Example>
        <Example title="States">
          <ControlStates />
        </Example>
      </>
    ),
  },
];
