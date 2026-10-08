import * as ak from "@ariakit/react";
import { cx } from "clava";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  Ellipsis,
  ExternalLink,
  GitPullRequest,
  Inbox,
  ListFilter,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
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
  CheckboxCard,
  CheckboxCardLabel,
  CheckboxCardSlot,
} from "../../components/ariakit/components/checkbox.ariakit.react.tsx";
import {
  Dialog,
  DialogDescription,
  DialogDisclosure,
  DialogDismiss,
  DialogHeading,
  DialogProvider,
} from "../../components/ariakit/components/dialog.ariakit.react.tsx";
import { Frame } from "../../components/ariakit/components/frame.ariakit.react.tsx";
import { Heading } from "../../components/ariakit/components/heading.ariakit.react.tsx";
import { InputGroup, InputSlot } from "../../components/ariakit/components/input.ariakit.react.tsx";
import { Kbd } from "../../components/ariakit/components/kbd.ariakit.react.tsx";
import { Link } from "../../components/ariakit/components/link.ariakit.react.tsx";
import { Nav, NavLink } from "../../components/ariakit/components/nav.ariakit.react.tsx";
import {
  OptionLabel,
  OptionSlot,
} from "../../components/ariakit/components/option.ariakit.react.tsx";
import {
  Progress,
  ProgressCircular,
} from "../../components/ariakit/components/progress.ariakit.react.tsx";
import { Separator } from "../../components/ariakit/components/separator.ariakit.react.tsx";
import { Table } from "../../components/ariakit/components/table.ariakit.react.tsx";
import type { TableRows } from "../../components/ariakit/components/table.ariakit.react.tsx";
import {
  Tab,
  TabGlider,
  TabLabel,
  TabList,
  TabPanel,
  TabPanels,
  TabSlot,
  Tabs,
} from "../../components/ariakit/components/tabs.ariakit.react.tsx";
import { TextFrame } from "../../components/ariakit/components/text-frame.ariakit.react.tsx";
import { Text } from "../../components/ariakit/components/text.ariakit.react.tsx";
import {
  Tooltip,
  TooltipAnchor,
  TooltipProvider,
} from "../../components/ariakit/components/tooltip.ariakit.react.tsx";
import { option } from "../../components/ariakit/styles/option.ts";
import { popover } from "../../components/ariakit/styles/popover.ts";
import { Example } from "./kit.tsx";
import type { ReferenceEntry } from "./kit.tsx";
import { PageShell } from "./page-shell.tsx";
import { ShellFixed } from "./structures.tsx";

/** One surface and one edge for the group. The buttons stay see-through. */
export function ToolbarRecipe() {
  return (
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
  );
}

/** A radio group on a button group. The glider marks the checked button. */
export function SegmentedControlRecipe() {
  return (
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
  );
}

interface RunRow {
  id: string;
  title: string;
  meta: string;
  changes: number;
  color: "warning" | "success" | "danger";
}

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

/**
 * A row is a button: a leading slot that spans two lines, a label over a
 * description, and trailing slots. The group owns the surface, and a hover
 * glider travels between the rows.
 */
export function ListRowRecipe() {
  return (
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
  );
}

/** A raised frame. The footer covers the padding and keeps the corners. */
export function CardRecipe() {
  return (
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
  );
}

interface StatProps {
  label: string;
  value: string;
  delta?: string;
  color?: "success" | "danger";
}

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

/** A label with soft ink over a large number in tabular figures. */
export function StatRecipe() {
  return (
    <div className="grid w-full grid-cols-2 gap-3">
      <Stat label="To review" value="12" delta="+4" color="danger" />
      <Stat label="Passed" value="96%" delta="+2%" color="success" />
    </div>
  );
}

type RunStatus = "review" | "passed" | "failed" | "running" | "replaced";

interface StatusStyle {
  label: string;
  color?: "warning" | "success" | "danger" | "brand";
  icon: LucideIcon;
}

const STATUS_STYLES: Record<RunStatus, StatusStyle> = {
  review: { label: "Needs review", color: "warning", icon: CircleAlert },
  passed: { label: "Passed", color: "success", icon: CircleCheck },
  failed: { label: "Failed", color: "danger", icon: CircleX },
  running: { label: "Comparing", color: "brand", icon: LoaderCircle },
  replaced: { label: "Replaced", icon: Clock },
};

export interface StatusBadgeProps {
  status: RunStatus;
  /** A dot in place of the icon. */
  dot?: boolean;
}

/** One map from status to label, color, and icon. No color means neutral. */
export function StatusBadge({ status, dot }: StatusBadgeProps) {
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

export function StatusBadgeRecipe() {
  return (
    <>
      <StatusBadge status="review" />
      <StatusBadge status="passed" />
      <StatusBadge status="failed" />
      <StatusBadge status="running" />
      <StatusBadge status="replaced" />
      <StatusBadge status="review" dot />
      <StatusBadge status="passed" dot />
      <StatusBadge status="replaced" dot />
    </>
  );
}

/** A plain input in a group, with a leading icon and a key hint. */
export function SearchFieldRecipe() {
  return (
    <InputGroup $rounded="lg" className="w-full">
      <InputSlot className="ak-ink-60">
        <Search />
      </InputSlot>
      <input aria-label="Search runs" placeholder="Search runs" className="min-w-0 flex-1" />
      <InputSlot $kind="shortcut" $size="xl">
        <Kbd>/</Kbd>
      </InputSlot>
    </InputGroup>
  );
}

/**
 * There is no menu primitive. An Ariakit menu takes the popover recipe, and
 * each item takes the option recipe, which marks keyboard focus with the brand
 * fill.
 */
export function MenuRecipe() {
  return (
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
  );
}

/** A confirmation: a heading, one sentence, and two end-aligned actions. */
export function ConfirmDialogRecipe() {
  return (
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
  );
}

interface IconButtonProps {
  label: string;
  shortcut?: string;
  children: ReactNode;
}

/** The label names the button. The tooltip shows it with the shortcut. */
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

export function IconButtonTooltipRecipe() {
  return (
    <ButtonGroup aria-label="Screenshot actions" $border>
      <IconButton label="Approve" shortcut="A">
        <Check />
      </IconButton>
      <IconButton label="Reject" shortcut="R">
        <X />
      </IconButton>
      <IconButton label="Filter">
        <ListFilter />
      </IconButton>
    </ButtonGroup>
  );
}

/** A tinted disc for the icon, a short heading, one line, and one action. */
export function EmptyStateRecipe() {
  return (
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
  );
}

/** A callout: a tint of the status color with an icon in that color. */
export function CalloutRecipe() {
  return (
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
  );
}

/** Frames with a lightness offset and the pulse animation. No text. */
export function SkeletonRecipe() {
  return (
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
  );
}

/** Key caps with one or two words each, in soft small text. */
export function KeyboardHintRecipe() {
  return (
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
  );
}

type RunColumn = "run" | "status" | "changes" | "updated";

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

/** Rows as data, no column lines, and columns that fit their content. */
export function RunTableRecipe() {
  return (
    <Table
      aria-label="Runs"
      rows={RUN_TABLE_ROWS}
      container={{ $border: true }}
      $borderInline={false}
      $p={2}
      className="text-sm"
    />
  );
}

/** Page tabs: flat tabs with counts and a bar, with no card around them. */
export function PageTabsRecipe() {
  return (
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
  );
}

/** A label row over the bar, and a ring that holds its own label. */
export function ProgressRecipe() {
  return (
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
  );
}

export interface SwitchProps {
  label: string;
  defaultChecked?: boolean;
}

/**
 * There is no switch primitive. A checkbox store drives a button with the
 * switch role, and the props follow the state: a brand track while on.
 */
export function Switch({ label, defaultChecked = false }: SwitchProps) {
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

export function SwitchRecipe() {
  return (
    <>
      <Switch label="Sync zoom" defaultChecked />
      <Switch label="Hide approved" />
    </>
  );
}

interface Filter {
  value: string;
  label: string;
  count: number;
  checked?: boolean;
}

const FILTERS: Filter[] = [
  { value: "changed", label: "Changed", count: 9, checked: true },
  { value: "added", label: "Added", count: 2, checked: true },
  { value: "removed", label: "Removed", count: 1 },
  { value: "failed", label: "Failed", count: 0 },
];

/** A checkbox card as a chip. It tints while checked, with no React state. */
export function FilterChipsRecipe() {
  return (
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
  );
}

/** A screenshot in a frame: a recessed bed, a clip, and a caption band. */
export function MediaFrameRecipe() {
  return (
    <Frame $border $rounded="xl" $p={1} className="grid w-full gap-1">
      <Frame $darken $border className="grid aspect-video place-items-center overflow-clip">
        <Text className="ak-ink-40 text-sm">Screenshot</Text>
      </Frame>
      <div className="flex items-center justify-between gap-2 px-2 py-1 text-sm">
        <Text className="truncate font-medium">button/default</Text>
        <Text className="ak-ink-60 tabular-nums">1440 × 900</Text>
      </div>
    </Frame>
  );
}

/**
 * `PageShell` in a box. At the root of a page, render it alone: the frame, the
 * forced radius, and the sticky offset are only for the box.
 */
export function PageShellRecipe() {
  return (
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
  );
}

export const recipeEntries: ReferenceEntry[] = [
  {
    id: "recipe-page-shell",
    title: "Page shell",
    render: () => (
      <>
        <Example title="Header and sidebar: the page scrolls" wide bare>
          <PageShellRecipe />
        </Example>
        <Example title="Fixed app frame: the panes scroll" wide bare>
          <ShellFixed />
        </Example>
      </>
    ),
  },
  {
    id: "recipe-toolbar",
    title: "Toolbar",
    render: () => (
      <Example title="ButtonGroup as a toolbar" wide>
        <ToolbarRecipe />
      </Example>
    ),
  },
  {
    id: "recipe-segmented-control",
    title: "Segmented control",
    render: () => (
      <Example title="Radio group, button group, glider">
        <SegmentedControlRecipe />
      </Example>
    ),
  },
  {
    id: "recipe-list-row",
    title: "List row",
    render: () => (
      <Example title="Rows with leading and trailing slots" wide>
        <ListRowRecipe />
      </Example>
    ),
  },
  {
    id: "recipe-card",
    title: "Card, stat, media",
    render: () => (
      <>
        <Example title="Card">
          <CardRecipe />
        </Example>
        <Example title="Stat">
          <StatRecipe />
        </Example>
        <Example title="Media frame">
          <MediaFrameRecipe />
        </Example>
      </>
    ),
  },
  {
    id: "recipe-status-badge",
    title: "Status badge",
    render: () => (
      <Example title="Icon or dot">
        <StatusBadgeRecipe />
      </Example>
    ),
  },
  {
    id: "recipe-search-field",
    title: "Input with icon and shortcut",
    render: () => (
      <Example title="InputGroup">
        <SearchFieldRecipe />
      </Example>
    ),
  },
  {
    id: "recipe-menu",
    title: "Menu, dialog, tooltip",
    render: () => (
      <>
        <Example title="Menu-like popover">
          <MenuRecipe />
        </Example>
        <Example title="Confirm dialog">
          <ConfirmDialogRecipe />
        </Example>
        <Example title="Tooltip on icon buttons">
          <IconButtonTooltipRecipe />
        </Example>
      </>
    ),
  },
  {
    id: "recipe-empty-state",
    title: "Empty state, callout, skeleton",
    render: () => (
      <>
        <Example title="Empty state">
          <EmptyStateRecipe />
        </Example>
        <Example title="Callout">
          <CalloutRecipe />
        </Example>
        <Example title="Skeleton">
          <SkeletonRecipe />
        </Example>
      </>
    ),
  },
  {
    id: "recipe-keyboard-hint",
    title: "Keyboard hint",
    render: () => (
      <Example title="Kbd in soft text">
        <KeyboardHintRecipe />
      </Example>
    ),
  },
  {
    id: "recipe-table",
    title: "Run table",
    render: () => (
      <Example title="Runs" wide bare>
        <RunTableRecipe />
      </Example>
    ),
  },
  {
    id: "recipe-tabs",
    title: "Page tabs",
    render: () => (
      <Example title="Page tabs with a bar" wide bare>
        <PageTabsRecipe />
      </Example>
    ),
  },
  {
    id: "recipe-progress",
    title: "Progress bar and ring",
    render: () => (
      <Example title="Labeled progress">
        <ProgressRecipe />
      </Example>
    ),
  },
  {
    id: "recipe-toggle",
    title: "Toggle and filter chips",
    render: () => (
      <>
        <Example title="Switch" className="gap-6!">
          <SwitchRecipe />
        </Example>
        <Example title="Filter chips">
          <FilterChipsRecipe />
        </Example>
      </>
    ),
  },
];
