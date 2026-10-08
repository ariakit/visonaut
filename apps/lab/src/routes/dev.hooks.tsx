import * as ak from "@ariakit/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";
import { Badge, BadgeLabel } from "../components/ariakit/components/badge.ariakit.react.tsx";
import {
  Button,
  ButtonGlider,
  ButtonGroup,
  ButtonLabel,
  ButtonSlot,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import { Code } from "../components/ariakit/components/code.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Heading, HeadingLevel } from "../components/ariakit/components/heading.ariakit.react.tsx";
import { Input } from "../components/ariakit/components/input.ariakit.react.tsx";
import { Kbd } from "../components/ariakit/components/kbd.ariakit.react.tsx";
import { Table } from "../components/ariakit/components/table.ariakit.react.tsx";
import type { TableRows } from "../components/ariakit/components/table.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import {
  alertSeverityLabels,
  formatCount,
  formatRelativeTime,
  getRunTitle,
  groupRunsByDay,
  inboxGroupLabels,
  pullOutcomeLabels,
  pullOutcomeRoles,
  reviewShortcuts,
  reviewStatusLabels,
  reviewStatusOrder,
  reviewStatusRoles,
  runKindLabels,
  runStateLabels,
  runStateOrder,
  runStateRoles,
  serviceHealthRoles,
  shortSha,
  useHistory,
  useInbox,
  usePull,
  useReviewSession,
  useReviewShortcuts,
  useSignIn,
  useSimulatedLoad,
  useStatus,
  variantKindLabels,
  variantKindRoles,
  viewerModes,
  viewerZooms,
} from "../fixtures/hooks/index.ts";
import type {
  ColorRole,
  HistorySortKey,
  ReviewFilters,
  ReviewOrder,
  ReviewSession,
  ReviewSessionReady,
  SessionVariant,
  StateLabel,
  Viewer,
  ViewerHighlight,
} from "../fixtures/hooks/index.ts";
import {
  DataModeProvider,
  dataModeLabels,
  dataModes,
  getFitZoom,
  getSizeClass,
  sizeClasses,
  useDataMode,
} from "../fixtures/index.ts";
import type { DataMode, ReviewImage, Run, RunState } from "../fixtures/index.ts";
import { useDataGate } from "../lab/knob-store.ts";
import { isDataMode } from "../lab/knobs.ts";

const hookNames = ["review", "inbox", "history", "status", "pull", "signIn"] as const;

type HookName = (typeof hookNames)[number];

/** The scenario of each hook, so a link can open one state. */
interface HooksSearch extends Partial<Record<HookName, string>> {
  /** Pins the data mode of the page. Without it, the Look menu decides. */
  data?: DataMode;
}

export const Route = createFileRoute("/dev/hooks")({
  validateSearch: (search: Record<string, unknown>): HooksSearch => {
    const result: HooksSearch = {};
    for (const name of hookNames) {
      const value = search[name];
      if (typeof value === "string") {
        result[name] = value;
      }
    }
    if (isDataMode(search.data)) {
      result.data = search.data;
    }
    return result;
  },
  head: () => ({ meta: [{ title: "State hooks · Visonaut design lab" }] }),
  component: HooksPage,
});

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

function toLayer(role: ColorRole) {
  return role === "neutral" ? true : role;
}

interface FactProps {
  /** The key of the value. It is also the `data-fact` attribute. */
  name: string;
  value: string | number | boolean | null;
  role?: ColorRole;
}

/** One value of a hook as a badge that a test can read. */
function Fact({ name, value, role = "neutral" }: FactProps) {
  return (
    <Badge $layer={toLayer(role)} $forceRounded data-fact={name}>
      <BadgeLabel>
        <span className="ak-ink-60">{name}</span> {String(value)}
      </BadgeLabel>
    </Badge>
  );
}

interface ActionProps {
  /** The `data-action` attribute. */
  id: string;
  onClick(): void;
  disabled?: boolean;
  /** Shows the button as on. */
  pressed?: boolean;
  children: ReactNode;
}

function Action({ id, onClick, disabled, pressed, children }: ActionProps) {
  return (
    <Button
      data-action={id}
      $size="sm"
      $rounded="full"
      $forceRounded
      $layer={pressed ? "brand" : undefined}
      $mix={pressed ? 30 : undefined}
      $lightnessOffset={!pressed}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <ButtonLabel>{children}</ButtonLabel>
    </Button>
  );
}

interface ChoiceOption<T> {
  value: T;
  label?: string;
  count?: number;
  disabled?: boolean;
}

interface ChoiceProps<T extends string | number> {
  /** The prefix of the `data-action` attribute of each option. */
  id: string;
  label: string;
  value: T;
  options: Array<ChoiceOption<T>>;
  onChange(value: T): void;
}

/** One value out of a few, as a radio group with a glider. */
function Choice<T extends string | number>({
  id,
  label,
  value,
  options,
  onChange,
}: ChoiceProps<T>) {
  const setValue = (next: string | number | null) => {
    const option = options.find((entry) => entry.value === next);
    if (option) {
      onChange(option.value);
    }
  };
  return (
    <ak.RadioProvider value={value} setValue={setValue}>
      <ak.RadioGroup aria-label={label} render={<ButtonGroup $border $size="sm" $layout="wrap" />}>
        {options.map((option) => (
          <ak.Radio
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            render={<Button data-action={`${id}:${option.value}`} />}
          >
            <ButtonLabel>{option.label ?? option.value}</ButtonLabel>
            {option.count != null && (
              <ButtonSlot $kind="badge" $p="md">
                {option.count}
              </ButtonSlot>
            )}
          </ak.Radio>
        ))}
        <ButtonGlider $kind="bevel" />
      </ak.RadioGroup>
    </ak.RadioProvider>
  );
}

interface ScenarioPickerProps {
  name: HookName;
  scenarios: string[];
  value: string;
}

/** Links that put the scenario in the URL, so a state has an address. */
function ScenarioPicker({ name, scenarios, value }: ScenarioPickerProps) {
  return (
    <ButtonGroup aria-label="Scenario" $border $size="sm" $layout="wrap">
      {scenarios.map((scenario) => (
        <Button
          key={scenario}
          data-scenario={`${name}:${scenario}`}
          aria-current={scenario === value ? "true" : undefined}
          render={
            <Link
              to="/dev/hooks"
              search={(previous) => ({ ...previous, [name]: scenario })}
              replace
              resetScroll={false}
            />
          }
        >
          <ButtonLabel>{scenario}</ButtonLabel>
        </Button>
      ))}
      <ButtonGlider $kind="bevel" />
    </ButtonGroup>
  );
}

interface RowProps {
  label: string;
  children: ReactNode;
}

/** A named line of controls or facts. */
function Row({ label, children }: RowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Text className="w-20 shrink-0 text-xs font-medium ak-ink-60">{label}</Text>
      {children}
    </div>
  );
}

interface DumpProps {
  id: string;
  value: unknown;
}

/** The state as JSON. A test reads it by its identifier. */
function Dump({ id, value }: DumpProps) {
  return (
    <Frame
      $darken
      $border
      $rounded="lg"
      $forceRounded
      $p={3}
      render={<pre id={id} />}
      className="max-h-[36rem] min-w-0 overflow-auto font-mono text-xs"
    >
      {JSON.stringify(value, null, 2)}
    </Frame>
  );
}

interface SectionProps {
  id: string;
  title: string;
  signature: string;
  children: ReactNode;
}

function Section({ id, title, signature, children }: SectionProps) {
  return (
    <section id={id} className="grid scroll-mt-16 gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Heading className="mt-0 mb-0 text-lg font-semibold">{title}</Heading>
        <Code className="text-xs">{signature}</Code>
      </div>
      <HeadingLevel>{children}</HeadingLevel>
    </section>
  );
}

interface RunLineProps {
  run: Run;
}

function RunLine({ run }: RunLineProps) {
  return (
    <Frame $lighten $border $rounded="lg" $forceRounded $p={2} className="flex items-center gap-3">
      <Badge $layer={toLayer(runStateRoles[run.state])} $forceRounded>
        <BadgeLabel>{runStateLabels[run.state].short}</BadgeLabel>
      </Badge>
      <Text className="min-w-0 flex-1 truncate text-sm">
        <span className="ak-ink-60">
          {run.pullRequestNumber ? `#${run.pullRequestNumber}` : runKindLabels[run.kind].short}
        </span>{" "}
        {getRunTitle(run)}
      </Text>
      <Text className="text-xs whitespace-nowrap tabular-nums ak-ink-60">
        <Code>{shortSha(run.testedSha)}</Code> · attempt {run.attempt} ·{" "}
        {formatRelativeTime(run.createdAt)}
      </Text>
    </Frame>
  );
}

interface FailureProps {
  message: string;
  reference?: string;
}

function Failure({ message, reference }: FailureProps) {
  return (
    <Frame $layer="danger" $mix={15} $border $rounded="lg" $p={3} role="alert">
      <Text className="text-sm">
        {message}
        {reference ? ` Reference: ${reference}.` : ""}
      </Text>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// useReviewSession
// ---------------------------------------------------------------------------

const reviewScenarios = [
  "changes",
  "large",
  "one-browser",
  "problems",
  "one-change",
  "clean",
  "passed",
  "read-only",
  "comparing",
  "loading",
  "error",
  "expired",
  "probes",
];

const checkerboard = "bg-[repeating-conic-gradient(#8883_0_25%,#0000_0_50%)] bg-size-[16px_16px]";

interface PictureProps {
  image: ReviewImage | null;
  label: string;
  /** The zoom factor. Null fits the image to the column. */
  scale: number | null;
  /** Layers over the image. */
  children?: ReactNode;
}

function Picture({ image, label, scale, children }: PictureProps) {
  if (!image) {
    return (
      <Frame
        $border
        $borderType="dashed"
        $rounded="md"
        $forceRounded
        $p={4}
        className="grid min-h-24 place-items-center"
      >
        <Text className="text-xs ak-ink-60">No {label.toLowerCase()}</Text>
      </Frame>
    );
  }
  return (
    <figure className="grid min-w-0 content-start gap-1.5">
      <Text render={<figcaption />} className="text-xs ak-ink-60">
        {label} · {image.width} × {image.height}
      </Text>
      <Frame
        $border
        $rounded="md"
        $forceRounded
        className={`max-h-[28rem] overflow-auto ${checkerboard}`}
      >
        {/* Fit scales a large image down. It never enlarges a small one, as
            in the app today. `getFitZoom` gives the zoom that does. */}
        <div
          className="relative mx-auto"
          style={scale ? { width: image.width * scale } : { maxWidth: image.width }}
        >
          <img
            src={image.url}
            width={image.width}
            height={image.height}
            alt={label}
            // A real screenshot shows its pixels at a whole-number zoom.
            className={`block h-auto w-full ${scale && scale >= 2 ? "[image-rendering:pixelated]" : ""}`}
          />
          {children}
        </div>
      </Frame>
    </figure>
  );
}

interface ViewerPreviewProps {
  variant: SessionVariant;
  viewer: Viewer;
}

/** The changed pixels or the changed areas over the current image. */
function Highlight({ variant, viewer }: ViewerPreviewProps) {
  const { candidate, diff, regions } = variant;
  if (viewer.highlight === "mask" && diff) {
    return <img src={diff.url} alt="" className="absolute inset-0 size-full opacity-70" />;
  }
  if (viewer.highlight !== "regions" || !candidate) return null;
  // The API today sends no regions, so `today` mode has nothing to draw.
  return regions?.map((region, index) => (
    <span
      key={index}
      className={`absolute outline-offset-2 outline-fuchsia-500 ${index === viewer.region ? "outline-4" : "outline-2"}`}
      style={{
        left: `${(region.x / candidate.width) * 100}%`,
        top: `${(region.y / candidate.height) * 100}%`,
        width: `${(region.width / candidate.width) * 100}%`,
        height: `${(region.height / candidate.height) * 100}%`,
      }}
    />
  ));
}

/** A small reference picture of each compare technique, from viewer state. */
function ViewerPreview({ variant, viewer }: ViewerPreviewProps) {
  const { reference, candidate, diff } = variant;
  const { effectiveMode: mode, scale } = viewer;
  const highlight = <Highlight variant={variant} viewer={viewer} />;
  if (mode === "side") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Picture image={reference} label="Baseline" scale={scale} />
        <Picture image={candidate} label="Current" scale={scale}>
          {highlight}
        </Picture>
      </div>
    );
  }
  if (mode === "original") return <Picture image={reference} label="Baseline" scale={scale} />;
  if (mode === "diff") return <Picture image={diff} label="Pixel diff" scale={scale} />;
  if (mode === "overlay") {
    return (
      <Picture image={candidate} label="Overlay" scale={scale}>
        {diff && (
          <img
            src={diff.url}
            alt=""
            className="absolute inset-0 size-full"
            style={{ opacity: viewer.overlayOpacity }}
          />
        )}
      </Picture>
    );
  }
  if (mode === "swipe") {
    const position = `${viewer.swipePosition * 100}%`;
    return (
      <Picture image={candidate} label="Swipe: baseline, then current" scale={scale}>
        {reference && (
          <img
            src={reference.url}
            alt=""
            className="absolute inset-0 size-full"
            style={{ clipPath: `inset(0 calc(100% - ${position}) 0 0)` }}
          />
        )}
        <span className="absolute inset-y-0 w-0.5 bg-fuchsia-500" style={{ left: position }} />
      </Picture>
    );
  }
  if (mode === "blink") {
    const baseline = viewer.blinkSide === "reference";
    return (
      <Picture
        image={baseline ? reference : candidate}
        label={baseline ? "Blink: baseline" : "Blink: current"}
        scale={scale}
      />
    );
  }
  return (
    <Picture image={candidate} label="Current" scale={scale}>
      {highlight}
    </Picture>
  );
}

// The stage of the review page at 1440 x 900 without its padding, from the
// audit of the production data: one full-width stage, and one compare pane.
const fullStage = { width: 1146, height: 468 };
const comparePane = { width: 555, height: 468 };

/** The size class of a variant and the zoom at which it fits each stage. */
function getImageFacts(variant: SessionVariant) {
  const image = variant.candidate ?? variant.reference;
  if (!image) return null;
  return {
    size: `${image.width} × ${image.height}`,
    sizeClass: sizeClasses[getSizeClass(image)].label,
    fitZoomInOneStage: Number(getFitZoom(image, fullStage).toFixed(2)),
    fitZoomInComparePane: Number(getFitZoom(image, comparePane).toFixed(2)),
  };
}

function getSessionDump(session: ReviewSession) {
  const { refreshing, refreshCount } = session;
  if (session.status === "loading") return { status: session.status, refreshing, refreshCount };
  if (session.status === "error") {
    const { status, message, reference } = session;
    return { status, message, reference, refreshing, refreshCount };
  }
  const { item, variant, viewer, save } = session;
  return {
    status: session.status,
    runStatus: session.run.status,
    selection: session.selection,
    selected:
      item && variant
        ? {
            key: item.key,
            family: item.family,
            leaf: item.leaf,
            label: item.label,
            displayName: item.displayName,
            itemStatus: item.status,
            variant: variant.name,
            productionLabel: variant.label,
            axes: variant.axes,
            kind: variant.kind,
            status: variant.status,
            verdict: variant.verdict,
            source: variant.source,
            reviewer: variant.reviewer,
            reviewerLogin: variant.reviewerLogin,
            thumbnail: variant.thumbnail,
            regions: variant.regions?.length,
            image: getImageFacts(variant),
          }
        : null,
    families: session.families.slice(0, 4).map((family) => {
      const { items, changedItems, undecided } = family.counts;
      return `${family.label}: ${items} items, ${changedItems} changed, ${undecided} undecided`;
    }),
    position: session.position,
    progress: session.progress,
    counts: session.counts,
    complete: session.complete,
    save: {
      status: save.status,
      pending: save.pending,
      failed: save.failed.length,
      failsNext: save.failsNext,
    },
    history: session.history.map(
      (command) => `${command.action} ${command.scope} x${command.targets.length}`,
    ),
    can: session.can,
    readOnly: session.readOnly,
    readOnlyKind: session.readOnlyKind,
    readOnlyReason: session.readOnlyReason,
    filters: session.filters,
    filtered: session.filtered,
    visible: { items: session.visibleItems.length, queue: session.queue.length },
    groups: Object.fromEntries(
      session.groups.map((group) => [
        group.id,
        { visible: group.items.length, total: group.total },
      ]),
    ),
    firstVisibleItems: session.visibleItems.slice(0, 4).map((entry) => entry.key),
    facets: session.facets,
    viewer: {
      mode: viewer.mode,
      effectiveMode: viewer.effectiveMode,
      available: viewer.available,
      zoom: viewer.zoom,
      scale: viewer.scale,
      overlayOpacity: viewer.overlayOpacity,
      swipePosition: viewer.swipePosition,
      blinkSide: viewer.blinkSide,
      blinkPaused: viewer.blinkPaused,
      highlight: viewer.highlight,
      region: viewer.region,
      regionCount: viewer.regionCount,
    },
    announcement: session.announcement,
    shortcutsEnabled: session.shortcutsEnabled,
    refreshing,
    refreshCount,
  };
}

interface SessionProps {
  session: ReviewSessionReady;
}

const saveRoles: Record<ReviewSessionReady["save"]["status"], ColorRole> = {
  idle: "neutral",
  saving: "warning",
  saved: "success",
  error: "danger",
};

function ReviewFacts({ session }: SessionProps) {
  const { progress, item, variant, save } = session;
  return (
    <Row label="State">
      <Fact name="run" value={session.run.status} role={runStateRoles[session.run.status]} />
      <Fact name="title" value={session.run.title ?? null} />
      <Fact name="item" value={item?.label ?? null} />
      <Fact
        name="variant"
        value={variant ? `${variant.name} (${variant.status})` : null}
        role={variant ? reviewStatusRoles[variant.status] : "neutral"}
      />
      <Fact name="decided" value={`${progress.decided} of ${progress.total}`} />
      <Fact name="remaining" value={progress.remaining} />
      <Fact name="save" value={save.status} role={saveRoles[save.status]} />
      <Fact name="undo" value={session.history.length} />
      {session.readOnlyKind && (
        <Fact name="read-only" value={session.readOnlyKind} role="warning" />
      )}
      {session.complete && <Fact name="complete" value="yes" role="success" />}
    </Row>
  );
}

function ReviewDecisions({ session }: SessionProps) {
  const { can, save } = session;
  return (
    <>
      <Row label="Decide">
        <Action id="approve" disabled={!can.approve} onClick={() => session.approve()}>
          Approve
        </Action>
        <Action id="reject" disabled={!can.reject} onClick={() => session.reject()}>
          Reject
        </Action>
        <Action id="clear" disabled={!can.clear} onClick={() => session.clear()}>
          Clear
        </Action>
        <Action id="approve-item" disabled={!can.approveItem} onClick={() => session.approveItem()}>
          Approve item
        </Action>
        <Action id="reject-item" disabled={!can.rejectItem} onClick={() => session.rejectItem()}>
          Reject item
        </Action>
        <Action
          id="approve-visible"
          disabled={!can.approveRemaining}
          onClick={() => session.approveRemaining("visible")}
        >
          Approve visible
        </Action>
        <Action
          id="approve-remaining"
          disabled={!can.approveRemaining}
          onClick={() => session.approveRemaining()}
        >
          Approve remaining
        </Action>
        <Action id="undo" disabled={!can.undo} onClick={session.undo}>
          Undo
        </Action>
      </Row>
      <Row label="Save">
        <Action
          id="fail-next-save"
          pressed={save.failsNext}
          onClick={() => session.failNextSave(!save.failsNext)}
        >
          Fail next save
        </Action>
        <Action id="retry-save" disabled={save.status !== "error"} onClick={session.retrySave}>
          Retry
        </Action>
        <Action
          id="discard-save"
          disabled={save.status !== "error"}
          onClick={session.discardFailedSave}
        >
          Discard
        </Action>
        <Action id="refresh" disabled={session.refreshing} onClick={session.refresh}>
          {session.refreshing ? "Refreshing" : "Refresh"}
        </Action>
        <Action
          id="shortcuts"
          pressed={session.shortcutsEnabled}
          onClick={() => session.setShortcutsEnabled(!session.shortcutsEnabled)}
        >
          Shortcuts
        </Action>
      </Row>
    </>
  );
}

function ReviewNavigation({ session }: SessionProps) {
  const { position } = session;
  return (
    <Row label="Move">
      <Action id="previous" disabled={position.queue <= 0} onClick={session.previous}>
        Previous
      </Action>
      <Action id="next" disabled={position.queue >= position.queueCount - 1} onClick={session.next}>
        Next
      </Action>
      <Action id="previous-item" disabled={position.item <= 0} onClick={session.previousItem}>
        Previous item
      </Action>
      <Action
        id="next-item"
        disabled={position.item >= position.itemCount - 1}
        onClick={session.nextItem}
      >
        Next item
      </Action>
      <Action
        id="previous-variant"
        disabled={position.variant <= 0}
        onClick={session.previousVariant}
      >
        Previous variant
      </Action>
      <Action
        id="next-variant"
        disabled={position.variant >= position.variantCount - 1}
        onClick={session.nextVariant}
      >
        Next variant
      </Action>
      <Action id="next-undecided" onClick={session.nextUndecided}>
        Next to review
      </Action>
      <Fact name="queue" value={`${position.queue + 1} of ${position.queueCount}`} />
    </Row>
  );
}

const browserOptions: Array<ReviewFilters["browser"]> = ["all", "chromium", "firefox", "webkit"];

function ReviewFilterControls({ session }: SessionProps) {
  const { filters, facets } = session;
  return (
    <>
      <Row label="Filter">
        <Input
          $size="sm"
          aria-label="Search items"
          placeholder="Search"
          data-action="query"
          value={filters.query}
          onChange={(event) => session.setQuery(event.target.value)}
          className="w-44"
        />
        <Choice
          id="status"
          label="Status filter"
          value={filters.status}
          onChange={(status) => session.setFilters({ status })}
          options={[
            { value: "all", label: "All", count: facets.status.all },
            ...reviewStatusOrder.map((status) => ({
              value: status,
              label: reviewStatusLabels[status].short,
              count: facets.status[status],
            })),
          ]}
        />
        <Action id="reset-filters" disabled={!session.filtered} onClick={session.resetFilters}>
          Reset
        </Action>
      </Row>
      <Row label="Kind">
        <Choice
          id="kind"
          label="Kind filter"
          value={filters.kind}
          onChange={(kind) => session.setFilters({ kind })}
          options={[
            { value: "all", label: "All", count: facets.kind.all },
            { value: "changed", label: "Changed", count: facets.kind.changed },
            { value: "added", label: "New", count: facets.kind.added },
            { value: "removed", label: "Removed", count: facets.kind.removed },
            { value: "unchanged", label: "Same", count: facets.kind.unchanged },
          ]}
        />
        <Choice
          id="browser"
          label="Browser filter"
          value={filters.browser}
          onChange={(browser) => session.setFilters({ browser })}
          options={browserOptions.map((browser) => ({
            value: browser,
            count: facets.browser[browser],
          }))}
        />
      </Row>
    </>
  );
}

const highlights: ViewerHighlight[] = ["none", "mask", "regions"];

function ViewerControls({ session }: SessionProps) {
  const { viewer } = session;
  return (
    <Row label="Viewer">
      <Choice
        id="mode"
        label="Mode"
        value={viewer.effectiveMode}
        onChange={viewer.setMode}
        options={viewerModes.map((mode) => ({ value: mode, disabled: !viewer.available[mode] }))}
      />
      <Choice
        id="zoom"
        label="Zoom"
        value={viewer.zoom}
        onChange={viewer.setZoom}
        options={viewerZooms.map((zoom) => ({
          value: zoom,
          label: zoom === "fit" ? "Fit" : `${zoom * 100}%`,
        }))}
      />
      <Choice
        id="highlight"
        label="Highlight"
        value={viewer.highlight}
        onChange={viewer.setHighlight}
        options={highlights.map((highlight) => ({ value: highlight }))}
      />
      <Action
        id="opacity-down"
        onClick={() => viewer.setOverlayOpacity(viewer.overlayOpacity - 0.2)}
      >
        Opacity −
      </Action>
      <Action id="opacity-up" onClick={() => viewer.setOverlayOpacity(viewer.overlayOpacity + 0.2)}>
        Opacity +
      </Action>
      <Action id="swipe-start" onClick={() => viewer.setSwipePosition(viewer.swipePosition - 0.25)}>
        Swipe −
      </Action>
      <Action id="swipe-end" onClick={() => viewer.setSwipePosition(viewer.swipePosition + 0.25)}>
        Swipe +
      </Action>
      <Action
        id="blink-pause"
        pressed={viewer.blinkPaused}
        onClick={() => viewer.setBlinkPaused(!viewer.blinkPaused)}
      >
        Pause blink
      </Action>
      <Action id="next-region" disabled={!viewer.regionCount} onClick={viewer.nextRegion}>
        Next region
      </Action>
    </Row>
  );
}

// A production run has 626 items. The debug list shows the start of each
// group and always the selected item. A real list must virtualize its rows,
// or keep the groups without changes closed.
const itemLimit = 24;

function ReviewItems({ session }: SessionProps) {
  const selectedKey = session.item?.key;
  return (
    <div
      className="grid max-h-[36rem] grid-cols-1 content-start gap-4 overflow-auto pe-1"
      data-part="items"
    >
      {!session.visibleItems.length && <Text className="text-sm ak-ink-60">No match</Text>}
      {session.groups.map((group) => {
        if (!group.items.length) return null;
        const shown = group.items.filter((item, index) => {
          return index < itemLimit || item.key === selectedKey;
        });
        return (
          <div key={group.id} className="grid grid-cols-1 gap-1" data-group={group.id}>
            <Text className="text-xs font-medium ak-ink-60">
              {reviewStatusLabels[group.id].plain} · {group.items.length} of {group.total}
            </Text>
            {shown.map((item) => (
              <Button
                key={item.key}
                data-item={item.key}
                aria-current={item.key === selectedKey ? "true" : undefined}
                $lightnessOffset={item.key === selectedKey ? 2 : undefined}
                $size="sm"
                className="w-full min-w-0 justify-start text-start"
                onClick={() => session.selectItem(item.key)}
              >
                <ButtonLabel className="min-w-0 flex-1 truncate" title={item.name}>
                  {item.label}
                </ButtonLabel>
                <ButtonSlot $kind="badge" $p="md">
                  {item.counts.undecided}/{item.counts.reviewable}
                </ButtonSlot>
              </Button>
            ))}
            {group.items.length > shown.length && (
              <Text className="text-xs ak-ink-50">
                {formatCount(group.items.length - shown.length)} more
              </Text>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The families of the run as a filter. A family with changes comes first. */
function ReviewFamilies({ session }: SessionProps) {
  const { family } = session.filters;
  const families = session.families.toSorted((first, second) => {
    return second.counts.changedItems - first.counts.changedItems;
  });
  return (
    <Row label="Family">
      <Action
        id="family:all"
        pressed={family === "all"}
        onClick={() => session.setFilters({ family: "all" })}
      >
        All {session.facets.family.all}
      </Action>
      {families.slice(0, 8).map((group) => (
        <Action
          key={group.family}
          id={`family:${group.family}`}
          pressed={family === group.family}
          onClick={() => session.setFilters({ family: group.family })}
        >
          {group.label} · {group.counts.changedItems} of {group.counts.items}
        </Action>
      ))}
      <Fact name="families" value={session.families.length} />
    </Row>
  );
}

/** The variants of the selected item. A dim variant does not pass the filters. */
function ReviewVariants({ session }: SessionProps) {
  const { item, variant: selected } = session;
  if (!item) return null;
  return (
    <div className="flex flex-wrap gap-1" data-part="variants">
      {item.variants.map((variant) => (
        <Button
          key={variant.key}
          data-variant={variant.key}
          aria-current={variant.key === selected?.key ? "true" : undefined}
          $size="xs"
          $layer={toLayer(reviewStatusRoles[variant.status])}
          $mix={variant.key === selected?.key ? 45 : 15}
          $border={variant.key === selected?.key ? 2 : false}
          className={item.matches.includes(variant) ? "" : "opacity-40"}
          onClick={() => session.select(variant)}
        >
          <ButtonLabel>
            {variant.index + 1}. {variant.name}
          </ButtonLabel>
        </Button>
      ))}
    </div>
  );
}

interface ScenarioProps {
  scenario: string;
}

function ReviewSection({ scenario }: ScenarioProps) {
  const [order, setOrder] = useState<ReviewOrder>("status");
  const [autoAdvance, setAutoAdvance] = useState(true);
  const session = useReviewSession(scenario, { order, autoAdvance });
  useReviewShortcuts(session);
  return (
    <Section
      id="review"
      title="useReviewSession"
      signature="useReviewSession(scenario, options?) · useReviewShortcuts(session, options?)"
    >
      <Row label="Scenario">
        <ScenarioPicker name="review" scenarios={reviewScenarios} value={scenario} />
      </Row>
      <Row label="Options">
        <Choice<ReviewOrder>
          id="order"
          label="Order"
          value={order}
          onChange={setOrder}
          options={[{ value: "status" }, { value: "declared" }]}
        />
        <Action
          id="auto-advance"
          pressed={autoAdvance}
          onClick={() => setAutoAdvance(!autoAdvance)}
        >
          Auto advance
        </Action>
        <Fact name="status" value={session.status} />
      </Row>
      {session.status === "error" && (
        <Failure message={session.message} reference={session.reference} />
      )}
      {session.status !== "ready" && (
        <Row label="Load">
          <Action id="refresh" disabled={session.refreshing} onClick={session.refresh}>
            {session.refreshing ? "Refreshing" : "Refresh"}
          </Action>
        </Row>
      )}
      {session.status === "ready" && (
        <>
          <ReviewFacts session={session} />
          <ReviewDecisions session={session} />
          <ReviewNavigation session={session} />
          <ReviewFilterControls session={session} />
          <ReviewFamilies session={session} />
          <ViewerControls session={session} />
          {session.readOnlyReason && (
            <Frame $layer="warning" $mix={15} $border $rounded="lg" $p={3} role="status">
              <Text className="text-sm">{session.readOnlyReason}</Text>
            </Frame>
          )}
          <Text className="sr-only" role="status" aria-live="polite" data-part="announcement">
            {session.announcement}
          </Text>
        </>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-[18rem_minmax(0,1fr)_26rem]">
        {session.status === "ready" && (
          <>
            <ReviewItems session={session} />
            <div className="grid min-w-0 content-start gap-3">
              <ReviewVariants session={session} />
              {session.variant ? (
                <ViewerPreview variant={session.variant} viewer={session.viewer} />
              ) : (
                <Text className="text-sm ak-ink-60">No selection</Text>
              )}
            </div>
          </>
        )}
        <Dump id="review-state" value={getSessionDump(session)} />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// useInbox
// ---------------------------------------------------------------------------

const inboxScenarios = ["busy", "single", "empty", "first-run", "loading", "error"];

function InboxSection({ scenario }: ScenarioProps) {
  const inbox = useInbox(scenario);
  const loaded = inbox.status !== "loading" && inbox.status !== "error";
  return (
    <Section id="inbox" title="useInbox" signature="useInbox(scenario, options?)">
      <Row label="Scenario">
        <ScenarioPicker name="inbox" scenarios={inboxScenarios} value={scenario} />
      </Row>
      <Row label="State">
        <Fact name="status" value={inbox.status} />
        <Fact name="refreshing" value={inbox.refreshing} />
        <Fact name="refreshes" value={inbox.refreshCount} />
        <Action id="refresh" disabled={inbox.refreshing} onClick={inbox.refresh}>
          Refresh
        </Action>
        {loaded && (
          <Input
            $size="sm"
            aria-label="Filter runs"
            placeholder="Filter"
            data-action="query"
            value={inbox.query}
            onChange={(event) => inbox.setQuery(event.target.value)}
            className="w-44"
          />
        )}
      </Row>
      {inbox.status === "error" && <Failure message={inbox.message} reference={inbox.reference} />}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          {loaded &&
            inbox.groups.map((group) => {
              if (!group.total) return null;
              return (
                <div key={group.id} className="grid gap-1.5" data-group={group.id}>
                  <Text className="text-xs font-medium ak-ink-60">
                    {inboxGroupLabels[group.id].plain} · {group.runs.length} of {group.total}
                  </Text>
                  {group.runs.map((run) => (
                    <RunLine key={run.id} run={run} />
                  ))}
                </div>
              );
            })}
          {loaded && inbox.status !== "ready" && (
            <Text className="text-sm ak-ink-60">
              {inbox.status === "empty" ? "No runs to review" : "No baseline and no runs yet"}
            </Text>
          )}
        </div>
        <Dump
          id="inbox-state"
          value={
            loaded
              ? {
                  status: inbox.status,
                  refreshing: inbox.refreshing,
                  refreshCount: inbox.refreshCount,
                  query: inbox.query,
                  filtered: inbox.filtered,
                  counts: inbox.counts,
                  groups: Object.fromEntries(
                    inbox.groups.map((group) => [
                      group.id,
                      group.runs.map((run) => `${run.state}: ${getRunTitle(run)}`),
                    ]),
                  ),
                  baselineRevision: inbox.baseline.revision,
                  alertCount: inbox.alertCount,
                  recentRuns: inbox.recentRuns.length,
                }
              : {
                  status: inbox.status,
                  refreshing: inbox.refreshing,
                  refreshCount: inbox.refreshCount,
                }
          }
        />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// useHistory
// ---------------------------------------------------------------------------

const historyScenarios = ["full", "no-match", "empty", "loading", "error"];

const sortKeys: HistorySortKey[] = ["created", "title", "state", "changes", "duration"];

type HistoryColumn = "run" | "state" | "changes" | "created";

function HistorySection({ scenario }: ScenarioProps) {
  const history = useHistory(scenario);
  const loaded = history.status !== "loading" && history.status !== "error";
  const rows: TableRows<HistoryColumn> = loaded
    ? [
        {
          group: "head",
          run: { children: "Run", $grow: true },
          state: { children: "Result", $fit: true },
          changes: { children: "Changes", numeric: true, $fit: true },
          created: { children: "Created", $fit: true },
        },
        ...history.visibleRuns.slice(0, 8).map((run) => ({
          key: run.id,
          run: (
            <Text className="line-clamp-1 text-sm whitespace-normal">
              {run.pullRequestNumber ? `#${run.pullRequestNumber} ` : ""}
              {getRunTitle(run)}
            </Text>
          ),
          state: (
            <Badge $layer={toLayer(runStateRoles[run.state])} $forceRounded>
              <BadgeLabel>{runStateLabels[run.state].short}</BadgeLabel>
            </Badge>
          ),
          changes: run.counts ? run.counts.changed + run.counts.added + run.counts.removed : "–",
          created: (
            <Text className="text-xs whitespace-nowrap ak-ink-60">
              {formatRelativeTime(run.createdAt)}
            </Text>
          ),
        })),
      ]
    : [];
  const stateOptions: Array<ChoiceOption<RunState | "all">> = loaded
    ? [
        { value: "all", label: "All", count: history.counts.all },
        ...history.states.map((state) => ({
          value: state,
          label: runStateLabels[state].short,
          count: history.counts[state],
        })),
      ]
    : [];
  return (
    <Section id="history" title="useHistory" signature="useHistory(scenario, options?)">
      <Row label="Scenario">
        <ScenarioPicker name="history" scenarios={historyScenarios} value={scenario} />
      </Row>
      <Row label="State">
        <Fact name="status" value={history.status} />
        {loaded && <Fact name="visible" value={history.visibleRuns.length} />}
        {loaded && <Fact name="no-match" value={history.noMatch} />}
        {loaded && <Fact name="sort" value={`${history.sort.key} ${history.sort.direction}`} />}
        <Action id="refresh" disabled={history.refreshing} onClick={history.refresh}>
          {history.refreshing ? "Refreshing" : "Refresh"}
        </Action>
      </Row>
      {history.status === "error" && (
        <Failure message={history.message} reference={history.reference} />
      )}
      {loaded && (
        <>
          <Row label="Filter">
            <Input
              $size="sm"
              aria-label="Search runs"
              placeholder="Search"
              data-action="query"
              value={history.query}
              onChange={(event) => history.setQuery(event.target.value)}
              className="w-44"
            />
            <Choice
              id="filter"
              label="Result filter"
              value={history.filter}
              onChange={history.setFilter}
              options={stateOptions}
            />
            <Action id="reset-filters" disabled={!history.filtered} onClick={history.resetFilters}>
              Reset
            </Action>
          </Row>
          <Row label="Sort">
            {sortKeys.map((key) => (
              <Action
                key={key}
                id={`sort:${key}`}
                pressed={history.sort.key === key}
                onClick={() => history.toggleSort(key)}
              >
                {key}
              </Action>
            ))}
          </Row>
        </>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-2">
          {loaded && history.visibleRuns.length > 0 && (
            <Table
              aria-label="Visible runs"
              rows={rows}
              container={{ $border: true, $rounded: "lg" }}
              $borderInline={false}
              $p={2}
              className="w-full text-sm"
            />
          )}
          {loaded && history.noMatch && <Text className="text-sm ak-ink-60">No match</Text>}
          {loaded && history.status === "empty" && (
            <Text className="text-sm ak-ink-60">No runs yet</Text>
          )}
        </div>
        <Dump
          id="history-state"
          value={
            loaded
              ? {
                  status: history.status,
                  query: history.query,
                  filter: history.filter,
                  sort: history.sort,
                  filtered: history.filtered,
                  noMatch: history.noMatch,
                  runs: history.runs.length,
                  visibleRuns: history.visibleRuns.length,
                  counts: history.counts,
                  states: history.states,
                  firstVisible: history.visibleRuns
                    .slice(0, 3)
                    .map((run) => `${run.state}: ${getRunTitle(run)}`),
                  days: groupRunsByDay(history.visibleRuns).map(
                    (day) => `${day.label}: ${day.runs.length}`,
                  ),
                  refreshing: history.refreshing,
                  refreshCount: history.refreshCount,
                }
              : { status: history.status, refreshing: history.refreshing }
          }
        />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// useStatus
// ---------------------------------------------------------------------------

const statusScenarios = ["alerts", "healthy", "overflow", "loading", "error"];

function StatusSection({ scenario }: ScenarioProps) {
  const status = useStatus(scenario);
  const ready = status.status === "ready";
  return (
    <Section id="status" title="useStatus" signature="useStatus(scenario, options?)">
      <Row label="Scenario">
        <ScenarioPicker name="status" scenarios={statusScenarios} value={scenario} />
      </Row>
      <Row label="State">
        <Fact name="status" value={status.status} />
        {ready && (
          <>
            <Fact name="health" value={status.health} role={serviceHealthRoles[status.health]} />
            <Fact name="checked" value={formatRelativeTime(status.checkedAt)} />
            <Fact name="open" value={status.counts.open} />
            <Fact name="dismissed" value={status.counts.dismissed} />
          </>
        )}
        <Action id="refresh" disabled={status.refreshing} onClick={status.refresh}>
          {status.refreshing ? "Refreshing" : "Refresh"}
        </Action>
        {ready && (
          <>
            <Action
              id="acknowledge-all"
              disabled={!status.counts.open}
              onClick={status.acknowledgeAll}
            >
              Acknowledge all
            </Action>
            <Action
              id="restore"
              disabled={!status.counts.dismissed}
              onClick={() => status.restore()}
            >
              Restore
            </Action>
          </>
        )}
      </Row>
      {status.status === "error" && (
        <Failure message={status.message} reference={status.reference} />
      )}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-1.5">
          {ready && !status.alerts.length && (
            <Text className="text-sm ak-ink-60">No unresolved alerts</Text>
          )}
          {ready &&
            status.alerts.slice(0, 6).map((alert) => (
              <Frame
                key={alert.id}
                $lighten
                $border
                $rounded="lg"
                $forceRounded
                $p={2}
                data-alert={alert.id}
                className="flex flex-wrap items-center gap-2"
              >
                <Badge $layer={toLayer(alert.role)} $forceRounded>
                  <BadgeLabel>
                    {alert.severity ? alertSeverityLabels[alert.severity].short : "No severity"}
                  </BadgeLabel>
                </Badge>
                <Text
                  className={`min-w-0 flex-1 truncate text-sm ${alert.acknowledged ? "ak-ink-50" : ""}`}
                >
                  {alert.title}
                </Text>
                <Text className="text-xs whitespace-nowrap ak-ink-60">
                  {formatRelativeTime(alert.lastSeenAt)}
                </Text>
                <Action
                  id="acknowledge"
                  pressed={alert.acknowledged}
                  onClick={() => status.acknowledge(alert.id, !alert.acknowledged)}
                >
                  Acknowledge
                </Action>
                <Action id="dismiss" onClick={() => status.dismiss(alert.id)}>
                  Dismiss
                </Action>
              </Frame>
            ))}
        </div>
        <Dump
          id="status-state"
          value={
            ready
              ? {
                  status: status.status,
                  health: status.health,
                  counts: status.counts,
                  hasMore: status.hasMore,
                  checkedAt: formatRelativeTime(status.checkedAt),
                  alerts: status.alerts
                    .slice(0, 6)
                    .map(
                      (alert) =>
                        `${alert.severity}${alert.acknowledged ? " (acknowledged)" : ""}: ${alert.title}`,
                    ),
                  dismissed: status.dismissed.map((alert) => alert.title),
                  refreshing: status.refreshing,
                  refreshCount: status.refreshCount,
                }
              : { status: status.status, refreshing: status.refreshing }
          }
        />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// usePull
// ---------------------------------------------------------------------------

const pullScenarios = [
  "attempts",
  "single",
  "no-runs",
  "waiting",
  "capture-failed",
  "loading",
  "error",
];

function PullSection({ scenario }: ScenarioProps) {
  const pull = usePull(scenario);
  const ready = pull.status === "ready";
  return (
    <Section id="pull" title="usePull" signature="usePull(scenario, options?)">
      <Row label="Scenario">
        <ScenarioPicker name="pull" scenarios={pullScenarios} value={scenario} />
      </Row>
      <Row label="State">
        <Fact name="status" value={pull.status} />
        {ready && (
          <>
            <Fact
              name="outcome"
              value={pullOutcomeLabels[pull.outcome].plain}
              role={pullOutcomeRoles[pull.outcome]}
            />
            <Fact name="runs" value={pull.runs.length} />
            <Fact
              name="to review"
              value={pull.reviewRun ? `attempt ${pull.reviewRun.attempt}` : null}
            />
          </>
        )}
        <Action id="refresh" disabled={pull.refreshing} onClick={pull.refresh}>
          {pull.refreshing ? "Refreshing" : "Refresh"}
        </Action>
      </Row>
      {pull.status === "error" && <Failure message={pull.message} reference={pull.reference} />}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          {ready && (
            <Text className="text-sm font-medium">
              #{pull.pull.number} {pull.pull.title ?? "(the API today sends no title)"}
            </Text>
          )}
          {ready &&
            pull.commits.map((commit) => (
              <div key={commit.sha} className="grid gap-1.5" data-commit={commit.sha}>
                <Text className="text-xs font-medium ak-ink-60">
                  <Code>{shortSha(commit.sha)}</Code> {commit.head ? "· head " : ""}·{" "}
                  {formatCount(commit.attempts.length, "attempt")}
                </Text>
                {commit.attempts.map((run) => (
                  <RunLine key={run.id} run={run} />
                ))}
              </div>
            ))}
        </div>
        <Dump
          id="pull-state"
          value={
            ready
              ? {
                  status: pull.status,
                  outcome: pull.outcome,
                  capture: pull.pull.capture,
                  runs: pull.runs.map((run) => `${run.state} (attempt ${run.attempt})`),
                  commits: pull.commits.map((commit) => ({
                    sha: shortSha(commit.sha),
                    head: commit.head,
                    attempts: commit.attempts.length,
                  })),
                  latestRun: pull.latestRun?.state ?? null,
                  reviewRun: pull.reviewRun?.state ?? null,
                  earlierRuns: pull.earlierRuns.length,
                  refreshing: pull.refreshing,
                }
              : { status: pull.status, refreshing: pull.refreshing }
          }
        />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// useSignIn
// ---------------------------------------------------------------------------

const signInScenarios = ["guest", "signing-in", "forbidden", "error"];

function SignInSection({ scenario }: ScenarioProps) {
  const [redirects, setRedirects] = useState(0);
  const signIn = useSignIn(scenario, { onRedirect: () => setRedirects((count) => count + 1) });
  const { status, repository, message, reference, user, redirected, retrying } = signIn;
  return (
    <Section id="sign-in" title="useSignIn" signature="useSignIn(scenario, options?)">
      <Row label="Scenario">
        <ScenarioPicker name="signIn" scenarios={signInScenarios} value={scenario} />
      </Row>
      <Row label="State">
        <Fact name="status" value={status} />
        <Fact name="redirected" value={redirected} />
        <Fact name="retrying" value={retrying} />
        <Action id="sign-in" disabled={status !== "guest"} onClick={signIn.signIn}>
          Sign in
        </Action>
        <Action
          id="switch-account"
          disabled={status !== "forbidden"}
          onClick={signIn.switchAccount}
        >
          Use another account
        </Action>
        <Action id="retry" disabled={status !== "error" || retrying} onClick={signIn.retry}>
          Retry
        </Action>
        <Action id="reset" onClick={signIn.reset}>
          Reset
        </Action>
      </Row>
      <Dump
        id="sign-in-state"
        value={{
          status,
          repository,
          message,
          reference,
          user: user?.login,
          redirected,
          retrying,
          redirects,
        }}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// useSimulatedLoad
// ---------------------------------------------------------------------------

const loadRoles: Record<ReturnType<typeof useSimulatedLoad>["status"], ColorRole> = {
  idle: "neutral",
  loading: "warning",
  ready: "success",
  error: "danger",
};

function LoadSection() {
  const [latency, setLatency] = useState(800);
  const [fail, setFail] = useState(false);
  const load = useSimulatedLoad({ latency, fail });
  return (
    <Section id="load" title="useSimulatedLoad" signature="useSimulatedLoad(options?)">
      <Row label="State">
        <Fact name="status" value={load.status} role={loadRoles[load.status]} />
        <Fact name="attempt" value={load.attempt} />
        <Choice<number>
          id="latency"
          label="Latency"
          value={latency}
          onChange={setLatency}
          options={[
            { value: 300, label: "300 ms" },
            { value: 800, label: "800 ms" },
            { value: 2500, label: "2.5 s" },
          ]}
        />
        <Action id="fail" pressed={fail} onClick={() => setFail(!fail)}>
          Fail
        </Action>
        <Action id="restart" onClick={load.restart}>
          Restart
        </Action>
        <Action id="reset" onClick={load.reset}>
          Reset
        </Action>
      </Row>
      <Dump id="load-state" value={{ status: load.status, attempt: load.attempt, latency, fail }} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface LabelRow {
  id: string;
  label: StateLabel;
  role?: ColorRole;
}

type LabelColumn = "id" | "short" | "plain" | "role";

interface LabelTableProps {
  title: string;
  entries: LabelRow[];
}

function LabelTable({ title, entries }: LabelTableProps) {
  const rows: TableRows<LabelColumn> = [
    {
      group: "head",
      id: { children: title, $fit: true },
      short: { children: "Short", $fit: true },
      plain: { children: "Plain", $grow: true },
      role: { children: "Role", $fit: true },
    },
    ...entries.map((entry) => ({
      key: entry.id,
      id: <Code>{entry.id}</Code>,
      short: (
        <Badge $layer={toLayer(entry.role ?? "neutral")} $forceRounded>
          <BadgeLabel>{entry.label.short}</BadgeLabel>
        </Badge>
      ),
      plain: entry.label.plain,
      role: <Text className="text-xs ak-ink-60">{entry.role ?? "–"}</Text>,
    })),
  ];
  return (
    <Table
      aria-label={title}
      rows={rows}
      container={{ $border: true, $rounded: "lg" }}
      $borderInline={false}
      $p={2}
      className="w-full text-sm"
    />
  );
}

const samples = [
  ["formatCount(1234)", formatCount(1234)],
  ['formatCount(1, "variant")', formatCount(1, "variant")],
  ['formatCount(22, "variant")', formatCount(22, "variant")],
  ['formatCount(2, "match", "matches")', formatCount(2, "match", "matches")],
  ['shortSha("9f8e7d6c5b4a…")', shortSha("9f8e7d6c5b4a39281706f5e4d3c2b1a098765432")],
];

function HelpersSection() {
  return (
    <Section id="helpers" title="Helpers" signature="labels, roles, and formatters">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {samples.map(([call, result]) => (
          <Text key={call} className="text-sm">
            <Code>{call}</Code> <span className="ak-ink-60">gives</span> {result}
          </Text>
        ))}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <LabelTable
          title="runStateLabels"
          entries={runStateOrder.map((state) => ({
            id: state,
            label: runStateLabels[state],
            role: runStateRoles[state],
          }))}
        />
        <LabelTable
          title="reviewStatusLabels"
          entries={reviewStatusOrder.map((status) => ({
            id: status,
            label: reviewStatusLabels[status],
            role: reviewStatusRoles[status],
          }))}
        />
        <LabelTable
          title="variantKindLabels"
          entries={(["changed", "added", "removed", "unchanged", "pending", "error"] as const).map(
            (kind) => ({ id: kind, label: variantKindLabels[kind], role: variantKindRoles[kind] }),
          )}
        />
        <LabelTable
          title="runKindLabels"
          entries={(["pull_request", "merge_group", "main"] as const).map((kind) => ({
            id: kind,
            label: runKindLabels[kind],
          }))}
        />
      </div>
    </Section>
  );
}

// `group` is the row group of a table row, so the column has another name.
type ShortcutColumn = "keys" | "label" | "kind" | "origin";

function ShortcutsSection() {
  const rows: TableRows<ShortcutColumn> = [
    {
      group: "head",
      keys: { children: "Keys", $fit: true },
      label: { children: "Action", $grow: true },
      kind: { children: "Group", $fit: true },
      origin: { children: "Bound by", $fit: true },
    },
    ...reviewShortcuts.map((shortcut) => ({
      key: shortcut.id,
      keys: (
        <span className="flex gap-1">
          {shortcut.keys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </span>
      ),
      label: shortcut.label,
      kind: <Text className="text-xs ak-ink-60">{shortcut.group}</Text>,
      origin: (
        <Badge $layer={shortcut.origin === "app" ? "success" : true} $forceRounded>
          <BadgeLabel>{shortcut.origin === "app" ? "App and lab" : "Lab only"}</BadgeLabel>
        </Badge>
      ),
    })),
  ];
  return (
    <Section id="shortcuts" title="Keys" signature="reviewShortcuts">
      <Table
        aria-label="Review keys"
        rows={rows}
        container={{ $border: true, $rounded: "lg" }}
        $borderInline={false}
        $p={2}
        className="w-full max-w-3xl text-sm"
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const sections = [
  { id: "review", title: "Review" },
  { id: "inbox", title: "Inbox" },
  { id: "history", title: "History" },
  { id: "status", title: "Status" },
  { id: "pull", title: "Pull request" },
  { id: "sign-in", title: "Sign in" },
  { id: "load", title: "Load" },
  { id: "helpers", title: "Helpers" },
  { id: "shortcuts", title: "Keys" },
];

interface ModeLinksProps {
  value: DataMode | undefined;
}

/** Pins the data mode of this page in its URL. Every hook then follows it. */
function ModeLinks({ value }: ModeLinksProps) {
  const options: Array<{ id: DataMode | undefined; label: string }> = [
    { id: undefined, label: "Follow the Look menu" },
    ...dataModes.map((mode) => ({ id: mode, label: dataModeLabels[mode] })),
  ];
  return (
    <ButtonGroup aria-label="Data mode" $border $size="sm" $layout="wrap">
      {options.map((option) => (
        <Button
          key={option.label}
          data-mode={option.id ?? "follow"}
          aria-current={option.id === value ? "true" : undefined}
          render={
            <Link
              to="/dev/hooks"
              search={(previous) => ({ ...previous, data: option.id })}
              replace
              resetScroll={false}
            />
          }
        >
          <ButtonLabel>{option.label}</ButtonLabel>
        </Button>
      ))}
      <ButtonGlider $kind="bevel" />
    </ButtonGroup>
  );
}

const modeRoles: Record<DataMode, ColorRole> = {
  decided: "success",
  today: "warning",
  improved: "neutral",
};

function CurrentMode() {
  const mode = useDataMode();
  return <Fact name="data" value={mode} role={modeRoles[mode]} />;
}

function HooksPage() {
  const search = Route.useSearch();
  const dataGate = useDataGate();
  return (
    <DataModeProvider mode={search.data}>
      <HeadingLevel>
        {/* A pinned mode is the same on the server and on the client. A mode
            that follows the Look menu stays hidden until the client has
            rendered the saved mode. */}
        <div className={search.data ? "contents" : dataGate}>
          <div className="mx-auto grid max-w-[120rem] grid-cols-[minmax(0,1fr)] gap-12 p-6">
            <header className="grid gap-3">
              <Heading className="text-2xl font-semibold">State hooks</Heading>
              <div className="flex flex-wrap items-center gap-3">
                <CurrentMode />
                <ModeLinks value={search.data} />
              </div>
              <nav aria-label="Sections" className="flex flex-wrap gap-2">
                {sections.map((section) => (
                  <Button key={section.id} $lightnessOffset render={<a href={`#${section.id}`} />}>
                    <ButtonLabel>{section.title}</ButtonLabel>
                  </Button>
                ))}
              </nav>
            </header>
            <HeadingLevel>
              <ReviewSection scenario={search.review ?? "changes"} />
              <InboxSection scenario={search.inbox ?? "busy"} />
              <HistorySection scenario={search.history ?? "full"} />
              <StatusSection scenario={search.status ?? "alerts"} />
              <PullSection scenario={search.pull ?? "attempts"} />
              <SignInSection scenario={search.signIn ?? "guest"} />
              <LoadSection />
              <HelpersSection />
              <ShortcutsSection />
            </HeadingLevel>
          </div>
        </div>
      </HeadingLevel>
    </DataModeProvider>
  );
}
