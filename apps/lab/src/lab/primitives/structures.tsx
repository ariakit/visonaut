import { Link as RouterLink } from "@tanstack/react-router";
import {
  Activity,
  Check,
  FolderOpen,
  History,
  Inbox,
  Info,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Badge, BadgeLabel } from "../../components/ariakit/components/badge.ariakit.react.tsx";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../components/ariakit/components/button.ariakit.react.tsx";
import {
  Dialog,
  DialogDescription,
  DialogDisclosure,
  DialogDismiss,
  DialogHeading,
  DialogProvider,
  DialogScroll,
} from "../../components/ariakit/components/dialog.ariakit.react.tsx";
import {
  Disclosure,
  DisclosureButton,
  DisclosureButtonSlot,
  DisclosureGroup,
} from "../../components/ariakit/components/disclosure.ariakit.react.tsx";
import { Frame } from "../../components/ariakit/components/frame.ariakit.react.tsx";
import {
  Heading,
  HeadingLevel,
} from "../../components/ariakit/components/heading.ariakit.react.tsx";
import { Input } from "../../components/ariakit/components/input.ariakit.react.tsx";
import { Kbd } from "../../components/ariakit/components/kbd.ariakit.react.tsx";
import { Link } from "../../components/ariakit/components/link.ariakit.react.tsx";
import { List, ListItem } from "../../components/ariakit/components/list.ariakit.react.tsx";
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
} from "../../components/ariakit/components/nav.ariakit.react.tsx";
import {
  Popover,
  PopoverArrow,
  PopoverDescription,
  PopoverDisclosure,
  PopoverDismiss,
  PopoverHeading,
  PopoverProvider,
} from "../../components/ariakit/components/popover.ariakit.react.tsx";
import { Prose } from "../../components/ariakit/components/prose.ariakit.react.tsx";
import { Separator } from "../../components/ariakit/components/separator.ariakit.react.tsx";
import {
  Shell,
  ShellFooter,
  ShellHeader,
  ShellMain,
  ShellMainBody,
  ShellMainHeader,
  ShellMainIntro,
  ShellSidebar,
  ShellSidebarBody,
} from "../../components/ariakit/components/shell.ariakit.react.tsx";
import {
  Table,
  TableCell,
  TableRow,
  TableRowGroup,
} from "../../components/ariakit/components/table.ariakit.react.tsx";
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
import { Text } from "../../components/ariakit/components/text.ariakit.react.tsx";
import {
  Tooltip,
  TooltipAnchor,
  TooltipArrow,
  TooltipProvider,
} from "../../components/ariakit/components/tooltip.ariakit.react.tsx";
import { Example } from "./kit.tsx";
import type { ReferenceEntry } from "./kit.tsx";

export function Disclosures() {
  return (
    <>
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
    </>
  );
}

/** Members share the edge and the padding of the group. */
export function DisclosureGroups() {
  return (
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
  );
}

/** A content list: bullets, numbers, checks, and progress. Not a menu. */
export function Lists() {
  return (
    <>
      <List>
        <ListItem>Dash marker</ListItem>
        <ListItem>The default</ListItem>
      </List>
      <List $marker="bullet">
        <ListItem>Bullet marker</ListItem>
        <ListItem>For short rows</ListItem>
      </List>
      <List ordered>
        <ListItem>Ordered</ListItem>
        <ListItem>With numbers</ListItem>
      </List>
    </>
  );
}

export function ListChecks() {
  return (
    <List $gap={2}>
      <ListItem checked>Capture</ListItem>
      <ListItem checked>Upload</ListItem>
      <ListItem progress={0.65}>Compare</ListItem>
      <ListItem checked={false}>Review</ListItem>
    </List>
  );
}

/** `$guide` joins the markers with a line. */
export function ListTimeline() {
  return (
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
  );
}

const NAV_PAGES = [
  { title: "Inbox", icon: Inbox, count: 8 },
  { title: "History", icon: History },
  { title: "Status", icon: Activity },
];

/** Gliders mark the hovered, the current, and the focused row. */
export function NavRows() {
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

/** `list={false}` when the groups bring their own lists. */
export function NavGroups() {
  return (
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
  );
}

/** A command row, a section that opens, and a row with a description. */
export function NavParts() {
  return (
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
  );
}

/** One scrolling row with a bar under the current link. */
export function NavHorizontal() {
  const [current, setCurrent] = useState("Changes");
  return (
    <Nav
      aria-label="Run sections"
      $layout="horizontal"
      $p={1}
      glider={{ $kind: "bar", $barOffset: "frame" }}
      className="w-full border-b"
    >
      {["Changes", "Passed", "Problems", "Details"].map((title) => (
        <NavLink
          key={title}
          href="#nav"
          aria-current={current === title ? "page" : undefined}
          onClick={(event) => {
            event.preventDefault();
            setCurrent(title);
          }}
        >
          {title}
        </NavLink>
      ))}
    </Nav>
  );
}

/** The router link marks the current page itself. */
export function NavRouterLinks() {
  return (
    <Nav aria-label="Lab pages" className="w-56">
      <NavLink render={<RouterLink to="/" />}>Lab home</NavLink>
      <NavLink render={<RouterLink to="/primitives" />}>Primitives</NavLink>
    </Nav>
  );
}

/** Folder tabs merge into the panel. Give every tab an id. */
export function TabsFolder() {
  return (
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
  );
}

/** Flat tabs are pills in the strip. One `single` panel follows them. */
export function TabsFlat() {
  return (
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
  );
}

/** No card around the tabs: a bar under the selected tab. */
export function TabsBar() {
  return (
    <Tabs
      defaultSelectedId="tabs-bar-changes"
      $border={false}
      $p="none"
      $panelRoundedTop={false}
      className="w-full"
    >
      <TabList aria-label="Bar tabs" $layer="transparent" $darken={false} className="border-b">
        <Tab $kind="flat" $selectedOffset={false} id="tabs-bar-changes">
          <TabLabel>Changes</TabLabel>
        </Tab>
        <Tab $kind="flat" $selectedOffset={false} id="tabs-bar-passed">
          <TabLabel>Passed</TabLabel>
        </Tab>
        <Tab $kind="flat" $selectedOffset={false} id="tabs-bar-problems" disabled>
          <TabLabel>Problems</TabLabel>
        </Tab>
        <TabGlider $kind="bar" />
      </TabList>
      <TabPanels $layer="transparent" $lighten={false} $p="none" className="pt-3">
        <TabPanel single>
          <Text className="text-sm">The panel paints no surface.</Text>
        </TabPanel>
      </TabPanels>
    </Tabs>
  );
}

type RunColumn = "run" | "status" | "changes" | "updated";

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

/** Rows as data. A head cell sets the format of its whole column. */
export function TableDeclarative() {
  return <Table aria-label="Runs" rows={RUN_ROWS} container={{ $border: true }} />;
}

/** Row lines only, for a table that lies flush on its surface. */
export function TableFlush() {
  return <Table aria-label="Runs" rows={RUN_ROWS} $borderBlock $p={2} />;
}

/** Parts written by hand: sortable heads, a selected row, a foot. */
export function TableComposed() {
  return (
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
  );
}

/** Pass `portal` so that no ancestor clips the popover. */
export function Popovers() {
  return (
    <>
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
    </>
  );
}

/** A modal with a backdrop. It renders in a portal. */
export function Dialogs() {
  return (
    <>
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
    </>
  );
}

/** The anchor is the control. The tooltip is its description. */
export function Tooltips() {
  return (
    <>
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
    </>
  );
}

/** A column for long text: headings, paragraphs, lists, and rules. */
export function ProseColumn() {
  return (
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
  );
}

function ShellBoxNav() {
  return (
    <Nav render={<div aria-label="Pages" />} className="text-sm">
      <NavLink href="#shell" aria-current="page">
        Inbox
      </NavLink>
      <NavLink href="#shell">History</NavLink>
      <NavLink href="#shell">Status</NavLink>
    </Nav>
  );
}

/**
 * A shell is the page: it scrolls with its scroll container and its header and
 * sidebars stick. In a box, the box is the size container and the scroll
 * container, the sticky offset of the shells around it is reset, and the shell
 * keeps its own corner radius for the parts inside it.
 */
export function ShellInBox() {
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

/**
 * An app frame that does not scroll as a page: the shell takes the height of
 * its container, and the main body and the sidebar bodies scroll on their own.
 */
export function ShellFixed() {
  return (
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
  );
}

function ShellNote() {
  return (
    <Text className="ak-ink-70 flex items-start gap-2 text-sm">
      <Info className="mt-[0.2em] size-[1.1em] flex-none" />
      <span>
        This page is a shell inside the lab shell: a sticky index, and a bar that shows only while
        the index does not fit.
      </span>
    </Text>
  );
}

function ButtonLabelLink() {
  return (
    <Button
      $lightnessOffset
      $size="sm"
      className="justify-self-start"
      render={<a href="#recipe-page-shell" />}
    >
      <ButtonLabel>Page shell recipes</ButtonLabel>
    </Button>
  );
}

export const structureEntries: ReferenceEntry[] = [
  {
    id: "disclosure",
    title: "Disclosure",
    file: "disclosure.ariakit.react.tsx",
    note: "Disclosure, DisclosureButton, DisclosureContent, DisclosureGroup. The button prop takes text, props, or an element.",
    render: () => (
      <>
        <Example title="Disclosure" stack>
          <Disclosures />
        </Example>
        <Example title="DisclosureGroup" stack>
          <DisclosureGroups />
        </Example>
      </>
    ),
  },
  {
    id: "list",
    title: "List",
    file: "list.ariakit.react.tsx",
    note: "List and ListItem are for content. For rows that act, use Button, Nav, or Table.",
    render: () => (
      <>
        <Example title="Markers" className="items-start gap-6!">
          <Lists />
        </Example>
        <Example title="Checks and progress">
          <ListChecks />
        </Example>
        <Example title="Timeline ($guide)">
          <ListTimeline />
        </Example>
      </>
    ),
  },
  {
    id: "nav",
    title: "Nav",
    file: "nav.ariakit.react.tsx",
    note: "Nav, NavLink, NavSlot, NavGroup, NavDisclosure, NavButton. A link is current while it has aria-current.",
    render: () => (
      <>
        <Example title="Rows, slots, gliders">
          <NavRows />
        </Example>
        <Example title="Groups">
          <NavGroups />
        </Example>
        <Example title="Button, disclosure, description">
          <NavParts />
        </Example>
        <Example title="Horizontal with bar">
          <NavHorizontal />
        </Example>
        <Example title="Router links">
          <NavRouterLinks />
        </Example>
      </>
    ),
  },
  {
    id: "tabs",
    title: "Tabs",
    file: "tabs.ariakit.react.tsx",
    note: "Tabs, TabList, Tab, TabLabel, TabSlot, TabGlider, TabPanels, TabPanel.",
    render: () => (
      <>
        <Example title="Folder (default)">
          <TabsFolder />
        </Example>
        <Example title="Flat with glider">
          <TabsFlat />
        </Example>
        <Example title="Bar, no card">
          <TabsBar />
        </Example>
      </>
    ),
  },
  {
    id: "table",
    title: "Table",
    file: "table.ariakit.react.tsx",
    note: "Table with rows data, or TableRowGroup, TableRow, and TableCell by hand.",
    render: () => (
      <>
        <Example title="Declarative rows" wide bare>
          <TableDeclarative />
        </Example>
        <Example title="Row lines only" wide bare>
          <TableFlush />
        </Example>
        <Example title="Composed, sortable, selected" wide bare>
          <TableComposed />
        </Example>
      </>
    ),
  },
  {
    id: "popover",
    title: "Popover",
    file: "popover.ariakit.react.tsx",
    note: "PopoverProvider, PopoverDisclosure, Popover, PopoverHeading, PopoverDescription, PopoverDismiss, PopoverArrow.",
    render: () => (
      <Example title="Popovers">
        <Popovers />
      </Example>
    ),
  },
  {
    id: "dialog",
    title: "Dialog",
    file: "dialog.ariakit.react.tsx",
    note: "DialogProvider, DialogDisclosure, Dialog, DialogHeading, DialogDescription, DialogDismiss, DialogScroll.",
    render: () => (
      <Example title="Dialogs">
        <Dialogs />
      </Example>
    ),
  },
  {
    id: "tooltip",
    title: "Tooltip",
    file: "tooltip.ariakit.react.tsx",
    render: () => (
      <Example title="Tooltips">
        <Tooltips />
      </Example>
    ),
  },
  {
    id: "prose",
    title: "Prose",
    file: "prose.ariakit.react.tsx",
    render: () => (
      <Example title="Text column">
        <ProseColumn />
      </Example>
    ),
  },
  {
    id: "shell",
    title: "Shell",
    file: "shell.ariakit.react.tsx",
    note: "Shell, ShellHeader, ShellSidebar, ShellMain with its header, intro, and body, and ShellFooter.",
    render: () => (
      <>
        <Example title="Parts, in a scrolling box" wide bare>
          <ShellInBox />
        </Example>
        <Example title="This page" stack>
          <ShellNote />
          <ButtonLabelLink />
        </Example>
      </>
    ),
  },
];
