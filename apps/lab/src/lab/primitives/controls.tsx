import * as ak from "@ariakit/react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  Clock,
  Command,
  GitPullRequest,
  Image,
  ListFilter,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import {
  Badge,
  BadgeLabel,
  BadgeSlot,
} from "../../components/ariakit/components/badge.ariakit.react.tsx";
import {
  Button,
  ButtonContent,
  ButtonDescription,
  ButtonGlider,
  ButtonGroup,
  ButtonLabel,
  ButtonSeparator,
  ButtonSlot,
} from "../../components/ariakit/components/button.ariakit.react.tsx";
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
} from "../../components/ariakit/components/checkbox.ariakit.react.tsx";
import { Code } from "../../components/ariakit/components/code.ariakit.react.tsx";
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
} from "../../components/ariakit/components/combobox.ariakit.react.tsx";
import { Frame } from "../../components/ariakit/components/frame.ariakit.react.tsx";
import {
  Input,
  InputGroup,
  InputSlot,
} from "../../components/ariakit/components/input.ariakit.react.tsx";
import { Kbd } from "../../components/ariakit/components/kbd.ariakit.react.tsx";
import { Link } from "../../components/ariakit/components/link.ariakit.react.tsx";
import {
  Progress,
  ProgressCircular,
} from "../../components/ariakit/components/progress.ariakit.react.tsx";
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
} from "../../components/ariakit/components/radio.ariakit.react.tsx";
import { Separator } from "../../components/ariakit/components/separator.ariakit.react.tsx";
import { Text } from "../../components/ariakit/components/text.ariakit.react.tsx";
import { inputPlaceholder } from "../../components/ariakit/styles/input.ts";
import { Example } from "./kit.tsx";
import type { ReferenceEntry } from "./kit.tsx";

const COLORS = ["brand", "secondary", "success", "warning", "danger"] as const;

/** The default button is see-through. A layer prop gives it a surface. */
export function ButtonSurfaces() {
  return (
    <>
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
    </>
  );
}

/** `$size` sets the font size. The padding, gap, and icons follow it. */
export function ButtonSizes() {
  return (
    <>
      {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
        <Button key={size} $size={size} $lightnessOffset>
          <ButtonSlot>
            <Plus />
          </ButtonSlot>
          <ButtonLabel>{size}</ButtonLabel>
        </Button>
      ))}
    </>
  );
}

export function ButtonShapes() {
  return (
    <>
      <Button $lightnessOffset $p={1}>
        $p 1
      </Button>
      <Button $lightnessOffset>$p 2</Button>
      <Button $lightnessOffset $p={3}>
        $p 3
      </Button>
      <Button $lightnessOffset $rounded="full" $px="lg">
        Pill
      </Button>
      <Button $lightnessOffset $rounded="none">
        Square
      </Button>
    </>
  );
}

/** A slot holds an icon, a badge, an avatar, or a shortcut. */
export function ButtonSlots() {
  return (
    <>
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
    </>
  );
}

/** A label over a description. The leading slot spans both rows. */
export function ButtonWithDescription() {
  return (
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
  );
}

export function ButtonStates() {
  return (
    <>
      <Button $lightnessOffset disabled>
        Disabled
      </Button>
      <Button $layer="brand" disabled>
        Disabled brand
      </Button>
      <Button $ink={60}>
        <ButtonSlot>
          <Settings />
        </ButtonSlot>
        <ButtonLabel>Dimmed</ButtonLabel>
      </Button>
      <Button $text="danger">
        <ButtonSlot>
          <Trash2 />
        </ButtonSlot>
        <ButtonLabel>Danger text</ButtonLabel>
      </Button>
    </>
  );
}

/** The group owns the surface and the edge. The buttons rest on it. */
export function ButtonGroups() {
  return (
    <>
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
    </>
  );
}

export function ButtonGroupLayouts() {
  return (
    <>
      <ButtonGroup aria-label="Decision" $border $layout="stretch">
        <Button>Reject</Button>
        <Button>Skip</Button>
        <Button>Approve</Button>
      </ButtonGroup>
      <ButtonGroup aria-label="File actions" $border $layout="vertical" className="w-40">
        <Button $focusHighlight>Open</Button>
        <Button $focusHighlight>Duplicate</Button>
        <Button $focusHighlight>Download</Button>
      </ButtonGroup>
      <ButtonGroup aria-label="Browsers" $layout="wrap" $gap="sm" $p="none">
        <Button $lightnessOffset>Chrome</Button>
        <Button $lightnessOffset>Firefox</Button>
        <Button $lightnessOffset>Safari</Button>
      </ButtonGroup>
    </>
  );
}

/**
 * A glider is one element that travels to the selected, hovered, or focused
 * button of its group. It is the last child of the group.
 */
export function ButtonGliders() {
  return (
    <>
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
    </>
  );
}

/** A colored badge is a tint with a ring and text of the same hue. */
export function BadgeColors() {
  return (
    <>
      <Badge>
        <BadgeLabel>Neutral</BadgeLabel>
      </Badge>
      {COLORS.map((color) => (
        <Badge key={color} $layer={color}>
          <BadgeLabel>{color}</BadgeLabel>
        </Badge>
      ))}
    </>
  );
}

export function BadgeStyles() {
  return (
    <>
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
    </>
  );
}

export function BadgeSlots() {
  return (
    <>
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
    </>
  );
}

export function BadgeSizes() {
  return (
    <>
      <Badge $px="md">
        <BadgeLabel>1</BadgeLabel>
      </Badge>
      <Badge $px="md" $layer="brand">
        <BadgeLabel>128</BadgeLabel>
      </Badge>
      {(["xs", "sm", "md", "lg"] as const).map((size) => (
        <Badge key={size} $size={size} $layer="brand">
          <BadgeLabel>{size}</BadgeLabel>
        </Badge>
      ))}
      <Badge className="max-w-28">
        <BadgeLabel $truncate>Waiting for the comparison</BadgeLabel>
      </Badge>
    </>
  );
}

export function InputFields() {
  return (
    <>
      <Input aria-label="Name" placeholder="Placeholder" />
      <Input aria-label="Name" defaultValue="Value" />
      <Input aria-label="Email" defaultValue="not an email" aria-invalid />
      <Input aria-label="Name" defaultValue="Disabled" disabled />
    </>
  );
}

export function InputShapes() {
  return (
    <>
      <Input aria-label="Small" placeholder="$size sm" $size="sm" />
      <Input aria-label="Compact" placeholder="$p 1" $p={1} />
      <Input aria-label="Pill" placeholder="Pill" $rounded="full" />
      <Input aria-label="Subtle" placeholder="$edgeWeight normal" $edgeWeight="normal" />
    </>
  );
}

/** A group is one field surface around a plain input and its slots. */
export function InputGroups() {
  return (
    <>
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
    </>
  );
}

export function InputVariants() {
  return (
    <>
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
    </>
  );
}

export function LabeledField() {
  return (
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
  );
}

export function Checkboxes() {
  return (
    <>
      <Checkbox aria-label="Unchecked" />
      <Checkbox aria-label="Checked" defaultChecked />
      <Checkbox aria-label="Mixed" checked="mixed" />
      <Checkbox aria-label="Disabled" disabled />
      <Checkbox aria-label="Disabled checked" disabled defaultChecked />
    </>
  );
}

export function CheckboxFields() {
  return (
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
  );
}

/** A card is a label around a hidden checkbox. It tints while checked. */
export function CheckboxCards() {
  return (
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
  );
}

export function RadioFields() {
  return (
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
  );
}

export function RadioCards() {
  return (
    <RadioProvider defaultValue="strict">
      <RadioCardGrid aria-label="Threshold" $minItemSize="8rem" className="w-full">
        <RadioCard value="strict">
          <RadioCardCheck />
          <RadioCardContent>
            <RadioCardLabel>Strict</RadioCardLabel>
            <RadioCardDescription>Every pixel</RadioCardDescription>
          </RadioCardContent>
        </RadioCard>
        <RadioCard value="relaxed">
          <RadioCardCheck />
          <RadioCardContent>
            <RadioCardLabel>Relaxed</RadioCardLabel>
            <RadioCardDescription>No antialiasing</RadioCardDescription>
          </RadioCardContent>
        </RadioCard>
      </RadioCardGrid>
    </RadioProvider>
  );
}

/** A select is a button that opens a list of options. */
export function SelectField() {
  return (
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
  );
}

/** `$layer="transparent"` keeps the button look for a toolbar. */
export function SelectButtons() {
  return (
    <>
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
    </>
  );
}

const BRANCHES = ["main", "next", "fix/dialog-focus", "feat/combobox-select", "chore/deps"];

/** Children are the suggestions. Filter them with the input value. */
export function ComboboxField() {
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

/** Rows with a slot, a label, a description, and a shortcut. */
export function ComboboxRichItems() {
  return (
    <ComboboxProvider defaultSelectedValue="Split">
      <ComboboxSelect aria-label="View" className="w-48" />
      <ComboboxPopover unmountOnHide sameWidth={false}>
        <ComboboxItem value="Split">
          <ComboboxItemSlot>
            <Image />
          </ComboboxItemSlot>
          <ComboboxItemContent>
            <ComboboxItemLabel>Split</ComboboxItemLabel>
            <ComboboxItemDescription>Before and after, side by side</ComboboxItemDescription>
          </ComboboxItemContent>
          <ComboboxItemSlot $kind="shortcut" aria-hidden>
            <kbd>1</kbd>
          </ComboboxItemSlot>
        </ComboboxItem>
        <ComboboxItem value="Overlay">
          <ComboboxItemSlot>
            <Image />
          </ComboboxItemSlot>
          <ComboboxItemContent>
            <ComboboxItemLabel>Overlay</ComboboxItemLabel>
            <ComboboxItemDescription>One over the other, with a slider</ComboboxItemDescription>
          </ComboboxItemContent>
          <ComboboxItemSlot $kind="shortcut" aria-hidden>
            <kbd>2</kbd>
          </ComboboxItemSlot>
        </ComboboxItem>
      </ComboboxPopover>
    </ComboboxProvider>
  );
}

export function KbdKeys() {
  return (
    <>
      <Text className="text-sm">
        Press <Kbd>⌘</Kbd> <Kbd>K</Kbd> to search, <Kbd>Esc</Kbd> to close.
      </Text>
      <Kbd $layer="brand">A</Kbd>
      <Kbd $invert>R</Kbd>
      <Kbd $layer="transparent">Tab</Kbd>
      <Kbd className="text-xs">
        <Command className="inline size-[1em]" />
      </Kbd>
    </>
  );
}

export function CodeChips() {
  return (
    <>
      <Text className="text-sm">
        Run <Code>pnpm dev</Code> and open <Code>/primitives</Code>.
      </Text>
      <Code $layer="danger">removed</Code>
      <Code $layer="success">added</Code>
      <Code $invert>inverted</Code>
      <Code $layer="transparent">ring only</Code>
      <Code $layer={false}>no layer</Code>
    </>
  );
}

export function TextLinks() {
  return (
    <>
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
    </>
  );
}

/** The rule keeps a margin of its own. `$gap={0}` removes it. */
export function Separators() {
  return (
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
  );
}

/** A value from 0 to 1. Without a value, the progress is indeterminate. */
export function ProgressBars() {
  return (
    <div className="grid w-full gap-4">
      <Progress aria-label="Comparing" value={0.65} />
      <Progress aria-label="Passed" value={1} fill={{ $layer: "success" }} />
      <Progress aria-label="Failed" value={0.3} $thickness={1} fill={{ $layer: "danger" }} />
      <Progress aria-label="Capturing" $thickness={3} />
    </div>
  );
}

/** A ring takes the size of its box. Give the box a size. */
export function ProgressRings() {
  return (
    <>
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
    </>
  );
}

function BrandFrame() {
  return (
    <Frame $layer="brand" $rounded="xl" $p="1rem" className="flex flex-wrap items-center gap-2">
      <Button>Ghost</Button>
      <Button $lightnessOffset>Neutral</Button>
      <Button $kind="bevel">Bevel</Button>
      <Button $chroma={0} $lightnessOffset>
        Gray
      </Button>
      <Button $invert>Inverted</Button>
      <Badge>
        <BadgeLabel>Badge</BadgeLabel>
      </Badge>
      <Input aria-label="Field" placeholder="Field" $size="sm" className="w-28" />
    </Frame>
  );
}

function IconNote() {
  return (
    <Text className="ak-ink-70 flex items-center gap-2 text-sm">
      <CircleAlert className="size-[1.25em] flex-none" />
      Outside a slot, size an icon in em.
    </Text>
  );
}

export const controlEntries: ReferenceEntry[] = [
  {
    id: "button",
    title: "Button",
    file: "button.ariakit.react.tsx",
    note: "Button, ButtonLabel, ButtonSlot, ButtonContent, ButtonDescription, ButtonGroup, ButtonSeparator, ButtonGlider.",
    render: () => (
      <>
        <Example title="Surfaces">
          <ButtonSurfaces />
        </Example>
        <Example title="$size">
          <ButtonSizes />
        </Example>
        <Example title="Shape">
          <ButtonShapes />
        </Example>
        <Example title="Slots">
          <ButtonSlots />
        </Example>
        <Example title="Label and description" stack>
          <ButtonWithDescription />
          <IconNote />
        </Example>
        <Example title="States">
          <ButtonStates />
        </Example>
        <Example title="On a colored layer" stack>
          <BrandFrame />
        </Example>
        <Example title="Groups">
          <ButtonGroups />
        </Example>
        <Example title="Group layouts" stack>
          <ButtonGroupLayouts />
        </Example>
        <Example title="Gliders" wide>
          <ButtonGliders />
        </Example>
      </>
    ),
  },
  {
    id: "badge",
    title: "Badge",
    file: "badge.ariakit.react.tsx",
    note: "Badge, BadgeLabel, BadgeSlot. A span, so it sits in a line of text.",
    render: () => (
      <>
        <Example title="Colors">
          <BadgeColors />
        </Example>
        <Example title="Styles">
          <BadgeStyles />
        </Example>
        <Example title="Slots">
          <BadgeSlots />
        </Example>
        <Example title="Counts and sizes">
          <BadgeSizes />
        </Example>
      </>
    ),
  },
  {
    id: "input",
    title: "Input",
    file: "input.ariakit.react.tsx",
    note: "Input, InputGroup, InputSlot. The disabled and invalid looks follow the DOM state.",
    render: () => (
      <>
        <Example title="States" stack>
          <InputFields />
        </Example>
        <Example title="Shape" stack>
          <InputShapes />
        </Example>
        <Example title="InputGroup" stack>
          <InputGroups />
        </Example>
        <Example title="Button and textarea" stack>
          <InputVariants />
        </Example>
        <Example title="Label and hint">
          <LabeledField />
        </Example>
      </>
    ),
  },
  {
    id: "checkbox",
    title: "Checkbox",
    file: "checkbox.ariakit.react.tsx",
    note: "Checkbox, CheckboxField, CheckboxCard, CheckboxCardGrid, and their parts.",
    render: () => (
      <>
        <Example title="Checkbox">
          <Checkboxes />
        </Example>
        <Example title="CheckboxField">
          <CheckboxFields />
        </Example>
        <Example title="CheckboxCard">
          <CheckboxCards />
        </Example>
      </>
    ),
  },
  {
    id: "radio",
    title: "Radio",
    file: "radio.ariakit.react.tsx",
    note: "RadioProvider, RadioGroup, RadioField, RadioCard, RadioCardGrid, and their parts.",
    render: () => (
      <>
        <Example title="RadioField">
          <RadioFields />
        </Example>
        <Example title="RadioCard">
          <RadioCards />
        </Example>
      </>
    ),
  },
  {
    id: "combobox",
    title: "Combobox and select",
    file: "combobox.ariakit.react.tsx",
    note: "Combobox, ComboboxProvider, ComboboxSelect, ComboboxPopover, ComboboxItem, and their parts.",
    render: () => (
      <>
        <Example title="Select field">
          <SelectField />
        </Example>
        <Example title="Select button">
          <SelectButtons />
        </Example>
        <Example title="Combobox">
          <ComboboxField />
        </Example>
        <Example title="Rich items">
          <ComboboxRichItems />
        </Example>
      </>
    ),
  },
  {
    id: "kbd",
    title: "Kbd",
    file: "kbd.ariakit.react.tsx",
    render: () => (
      <Example title="Keys">
        <KbdKeys />
      </Example>
    ),
  },
  {
    id: "code",
    title: "Code",
    file: "code.ariakit.react.tsx",
    render: () => (
      <Example title="Inline chips">
        <CodeChips />
      </Example>
    ),
  },
  {
    id: "link",
    title: "Link",
    file: "link.ariakit.react.tsx",
    render: () => (
      <Example title="Text links" className="gap-4!">
        <TextLinks />
      </Example>
    ),
  },
  {
    id: "separator",
    title: "Separator",
    file: "separator.ariakit.react.tsx",
    render: () => (
      <Example title="Rules">
        <Separators />
      </Example>
    ),
  },
  {
    id: "progress",
    title: "Progress",
    file: "progress.ariakit.react.tsx",
    note: "Progress and ProgressCircular. The fill prop takes the props of the fill.",
    render: () => (
      <>
        <Example title="Bar">
          <ProgressBars />
        </Example>
        <Example title="Ring">
          <ProgressRings />
        </Example>
      </>
    ),
  },
];
