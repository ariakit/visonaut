import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, Profiler, useMemo } from "react";
import type { ProfilerOnRenderCallback, ReactNode } from "react";
import { Badge, BadgeLabel } from "../components/ariakit/components/badge.ariakit.react.tsx";
import {
  Button,
  ButtonGlider,
  ButtonGroup,
  ButtonLabel,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import { Code } from "../components/ariakit/components/code.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Heading, HeadingLevel } from "../components/ariakit/components/heading.ariakit.react.tsx";
import { Table } from "../components/ariakit/components/table.ariakit.react.tsx";
import type { TableRows } from "../components/ariakit/components/table.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { getRunTitle, groupRunsByPullRequest, useReviewSession } from "../fixtures/hooks/index.ts";
import {
  DataModeProvider,
  NOW,
  countVariants,
  currentUser,
  dataModeLabels,
  dataModes,
  formatAxisValue,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatRatio,
  formatRelativeTime,
  getHistoryData,
  getInboxData,
  getItemLabel,
  getPullData,
  getReviewRun,
  getScreenshot,
  getScreenshotSet,
  getSignInData,
  getSizeClass,
  getStatusData,
  getVariantLabel,
  getVariantMatrix,
  groupItemsByFamily,
  hasConsistentCounts,
  isSizeChange,
  repository,
  reviewSampleIds,
  runKindLabel,
  runStateLabel,
  scenes,
  shortSha,
  sizeClasses,
  splitItemKey,
  useDataMode,
  useReviewSample,
  variantStatusLabel,
} from "../fixtures/index.ts";
import type {
  Appearance,
  ChangedRegion,
  ColorScheme,
  DataMode,
  ReviewItem,
  ReviewSampleId,
  ReviewVariant,
  Run,
  RunCounts,
  RunState,
  SceneDefinition,
  SizeClass,
} from "../fixtures/index.ts";
import { catalog } from "../lab/catalog.ts";
import { useDataGate } from "../lab/knob-store.ts";
import { isDataMode } from "../lab/knobs.ts";

interface FixturesSearch {
  /** Shows one lab-only scene at its natural size. */
  scene?: string;
  /** Limits the scene view to one color scheme. */
  scheme?: ColorScheme;
  /** Limits the scene view to one image state. */
  state?: string;
  /** Pins the data mode of the page. Without it, the Look menu decides. */
  data?: DataMode;
  /** `list` shows a plain list of one run, to measure the fixture hooks. */
  view?: "list";
  /** The review scenario of the `list` view. */
  scenario?: string;
}

export const Route = createFileRoute("/dev/fixtures")({
  validateSearch: (search: Record<string, unknown>): FixturesSearch => ({
    scene: typeof search.scene === "string" ? search.scene : undefined,
    scheme: search.scheme === "light" || search.scheme === "dark" ? search.scheme : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    data: isDataMode(search.data) ? search.data : undefined,
    view: search.view === "list" ? "list" : undefined,
    scenario: typeof search.scenario === "string" ? search.scenario : undefined,
  }),
  head: () => ({ meta: [{ title: "Fixtures · Visonaut design lab" }] }),
  component: FixturesPage,
});

type Tone = "success" | "warning" | "danger" | "brand" | undefined;

const stateTones: Record<RunState, Tone> = {
  incomplete: "brand",
  comparing: "brand",
  "needs-review": "warning",
  rejected: "danger",
  passed: "success",
  failed: "danger",
  superseded: undefined,
  "needs-recompare": "danger",
};

interface TagProps {
  tone?: Tone;
  children: ReactNode;
}

/** A badge that keeps its pill shape inside a table cell or a small frame. */
function Tag({ tone, children }: TagProps) {
  return (
    <Badge $layer={tone ?? true} $forceRounded>
      <BadgeLabel>{children}</BadgeLabel>
    </Badge>
  );
}

interface SectionProps {
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
}

function Section({ id, title, note, children }: SectionProps) {
  return (
    <section id={id} className="grid scroll-mt-16 gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Heading className="mt-0 mb-0 text-lg font-semibold">{title}</Heading>
        {note && <Text className="text-sm ak-ink-60">{note}</Text>}
      </div>
      <HeadingLevel>{children}</HeadingLevel>
    </section>
  );
}

const tableProps = {
  container: { $border: true, $rounded: "lg" },
  $borderInline: false,
  $p: 2,
  className: "w-full text-sm",
} as const;

/** The middle value of a sorted list, or another quantile from 0 to 1. */
function quantile(sorted: number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
}

function describeLengths(values: number[]): string {
  const sorted = values.toSorted((first, second) => first - second);
  return `minimum ${sorted[0]}, median ${quantile(sorted, 0.5)}, 90th percentile ${quantile(sorted, 0.9)}, maximum ${sorted.at(-1)}`;
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

interface DatasetSummary {
  status: string;
  detail: string;
}

interface DatasetSource {
  getter: string;
  hook: string;
  /** Scenarios that the getter accepts but the catalog does not list. */
  extras: string[];
  summarize(scenario: string, mode: DataMode): DatasetSummary;
}

function countStates(runs: Run[]): string {
  const totals = new Map<RunState, number>();
  for (const run of runs) {
    totals.set(run.state, (totals.get(run.state) ?? 0) + 1);
  }
  return [...totals].map(([state, total]) => `${state} ${total}`).join(", ");
}

function describeCounts(counts: RunCounts): string {
  const parts = [
    `${counts.items} items`,
    `${counts.total} variants`,
    `changed ${counts.changed}`,
    `added ${counts.added}`,
    `removed ${counts.removed}`,
    `unchanged ${counts.unchanged}`,
    `error ${counts.error}`,
    `comparing ${counts.comparing}`,
    `approved ${counts.approved}`,
    `rejected ${counts.rejected}`,
    `undecided ${counts.undecided}`,
  ];
  return parts.join(" · ");
}

function describeRun(run: Run): string {
  const number = run.pullRequestNumber ? `#${run.pullRequestNumber} · ` : "";
  return `${number}${getRunTitle(run)}`;
}

const sources: Record<string, DatasetSource> = {
  "sign-in": {
    getter: "getSignInData",
    hook: "useSignInData",
    extras: [],
    summarize(scenario, mode) {
      const data = getSignInData(scenario, mode);
      if (data.status === "error") return { status: data.status, detail: data.message };
      const repositoryName = data.repository ?? "no repository";
      if (data.status === "forbidden") {
        const login = data.user ? `@${data.user.login}` : "no identity";
        return { status: data.status, detail: `${login} · ${repositoryName} · ${data.message}` };
      }
      return { status: data.status, detail: repositoryName };
    },
  },
  inbox: {
    getter: "getInboxData",
    hook: "useInboxData",
    extras: [],
    summarize(scenario, mode) {
      const data = getInboxData(scenario, mode);
      if (data.status === "loading") return { status: data.status, detail: "" };
      if (data.status === "error") return { status: data.status, detail: data.message };
      const [first] = data.runs;
      const detail = [
        `${data.runs.length} actionable`,
        `${data.recentRuns.length} recent`,
        `baseline ${data.baseline.revision}`,
        `${data.alertCount} alerts`,
        countStates(data.runs),
        first ? `first row “${describeRun(first)}”` : "",
      ];
      return { status: data.status, detail: detail.filter(Boolean).join(" · ") };
    },
  },
  history: {
    getter: "getHistoryData",
    hook: "useHistoryData",
    extras: ["error"],
    summarize(scenario, mode) {
      const data = getHistoryData(scenario, mode);
      if (data.status === "loading") return { status: data.status, detail: "" };
      if (data.status === "error") return { status: data.status, detail: data.message };
      const groups = groupRunsByPullRequest(data.runs);
      const pulls = groups.filter((group) => group.pullRequestNumber != null);
      const titled = data.runs.filter((run) => run.title != null);
      const closed = data.runs.filter((run) => run.closedReason != null);
      const detail = [
        `${data.runs.length} runs`,
        data.runs.length ? `${pulls.length} pull requests` : "",
        `${data.visibleRuns.length} visible`,
        data.query ? `query “${data.query}”` : "",
        data.runs.length ? `${titled.length} with a title` : "",
        data.runs.length ? `${closed.length} with a closed reason` : "",
        countStates(data.runs),
      ];
      return { status: data.status, detail: detail.filter(Boolean).join(" · ") };
    },
  },
  status: {
    getter: "getStatusData",
    hook: "useStatusData",
    extras: ["overflow"],
    summarize(scenario, mode) {
      const data = getStatusData(scenario, mode);
      if (data.status === "loading") return { status: data.status, detail: "" };
      if (data.status === "error") return { status: data.status, detail: data.message };
      const detail = [
        `${data.alerts.length}${data.hasMore ? "+" : ""} alerts`,
        data.alerts
          .slice(0, 3)
          .map((alert) => `${alert.kind}/${alert.code} (${alert.severity ?? "no severity"})`)
          .join(", "),
      ];
      if (data.capacity) {
        const { databaseBytes, databaseAdmissionBytes, activeRuns, maximumActiveRuns } =
          data.capacity;
        detail.push(
          `database ${formatBytes(databaseBytes)} of ${formatBytes(databaseAdmissionBytes)}`,
          `${activeRuns} of ${maximumActiveRuns} active runs`,
        );
      }
      return { status: data.status, detail: detail.filter(Boolean).join(" · ") };
    },
  },
  pull: {
    getter: "getPullData",
    hook: "usePullData",
    extras: ["error"],
    summarize(scenario, mode) {
      const data = getPullData(scenario, mode);
      if (data.status === "loading") return { status: data.status, detail: "" };
      if (data.status === "error") return { status: data.status, detail: data.message };
      const { pull, runs } = data;
      const detail = [
        `#${pull.number} ${pull.title ?? "(no title)"}`,
        pull.headSha ? `head ${shortSha(pull.headSha)}` : "no head commit",
        `capture ${pull.capture}`,
        `${runs.length} runs`,
        runs.map((run) => `${run.state} (attempt ${run.attempt})`).join(", "),
      ];
      return { status: data.status, detail: detail.filter(Boolean).join(" · ") };
    },
  },
  review: {
    getter: "getReviewRun",
    hook: "useReviewData",
    extras: ["error", "expired"],
    summarize(scenario, mode) {
      const data = getReviewRun(scenario, mode);
      if (data.status === "loading") return { status: data.status, detail: "" };
      if (data.status === "error") return { status: data.status, detail: data.message };
      const { review } = data;
      // Production sends no totals, so the page counts them from the items.
      const detail = [
        review.run.title,
        `attempt ${review.run.attempt}`,
        review.run.status,
        review.reviewReady ? "review ready" : "no review actions",
        review.counts ? "counts in the response" : "no counts in the response",
        describeCounts(countVariants(review.items)),
        hasConsistentCounts(scenario, mode) ? "" : "THE RUN LIST HAS OTHER COUNTS",
      ];
      return { status: data.status, detail: detail.filter(Boolean).join(" · ") };
    },
  },
};

type DatasetColumn = "scenario" | "status" | DataMode;

interface DatasetDetailProps {
  children: string;
}

/** A cell with a width of its own, so the three mode columns share the table. */
function DatasetDetail({ children }: DatasetDetailProps) {
  return (
    <Text className="block w-[25vw] max-w-[36rem] min-w-60 text-xs whitespace-normal ak-ink-70">
      {children}
    </Text>
  );
}

function DatasetTables() {
  const pages = catalog.surfaces.filter((surface) => surface.kind === "page");
  return (
    <div className="grid gap-6">
      {pages.map((surface) => {
        const source = sources[surface.id];
        if (!source) return null;
        const listed = surface.scenarios.map((scenario) => ({ id: scenario.id, extra: false }));
        const extras = source.extras.map((id) => ({ id, extra: true }));
        const rows: TableRows<DatasetColumn> = [
          {
            group: "head",
            scenario: { children: "Scenario", $fit: true },
            status: { children: "Status", $fit: true },
            decided: { children: dataModeLabels.decided, $grow: true },
            today: { children: dataModeLabels.today, $grow: true },
            improved: { children: dataModeLabels.improved, $grow: true },
          },
          ...[...listed, ...extras].map(({ id, extra }) => {
            const decided = source.summarize(id, "decided");
            const today = source.summarize(id, "today");
            const improved = source.summarize(id, "improved");
            const tone =
              decided.status === "ready"
                ? "success"
                : decided.status === "error"
                  ? "danger"
                  : undefined;
            return {
              key: id,
              scenario: (
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <Code>{id}</Code>
                  {extra && <Text className="text-xs ak-ink-50">extra</Text>}
                </span>
              ),
              status: <Tag tone={tone}>{decided.status}</Tag>,
              decided: <DatasetDetail>{decided.detail}</DatasetDetail>,
              today: <DatasetDetail>{today.detail}</DatasetDetail>,
              improved: <DatasetDetail>{improved.detail}</DatasetDetail>,
            };
          }),
        ];
        return (
          <div key={surface.id} className="grid content-start gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <Heading className="mt-0 mb-0 text-sm font-semibold">{surface.title}</Heading>
              <Code className="text-xs">{source.hook}(scenario)</Code>
              <Code className="text-xs">{source.getter}(scenario, mode)</Code>
            </div>
            <Table aria-label={surface.title} rows={rows} {...tableProps} />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

type RunColumn = "created" | "kind" | "run" | "author" | "state" | "numbers" | "previews";

interface RunTableProps {
  label: string;
  runs: Run[];
  /** Shows the first rows only. */
  limit?: number;
}

function RunTable({ label, runs, limit }: RunTableProps) {
  const visible = limit ? runs.slice(0, limit) : runs;
  const rows: TableRows<RunColumn> = [
    {
      group: "head",
      created: { children: "Created", $fit: true },
      kind: { children: "Kind", $fit: true },
      run: { children: "Run", $grow: true },
      author: { children: "Author", $fit: true },
      state: { children: "State", $fit: true },
      numbers: { children: "Pending, rejected, total", $fit: true },
      previews: { children: "Previews", $fit: true },
    },
    ...visible.map((run) => ({
      key: run.id,
      created: (
        <Text className="text-xs whitespace-nowrap tabular-nums ak-ink-70">
          {formatRelativeTime(run.createdAt)}
          {run.durationMs ? ` · ${formatDuration(run.durationMs)}` : ""}
        </Text>
      ),
      kind: <Text className="text-xs whitespace-nowrap">{runKindLabel(run.kind)}</Text>,
      run: (
        <div className="grid min-w-56 gap-0.5 whitespace-normal">
          <Text className="line-clamp-2 text-sm font-medium">{describeRun(run)}</Text>
          <Text className="line-clamp-1 text-xs break-all ak-ink-60">
            <Code>{shortSha(run.testedSha)}</Code> · attempt {run.attempt}
            {run.branch ? ` · ${run.branch}` : ""}
            {run.closedReason ? ` · closed: ${run.closedReason}, was ${run.closedState}` : ""}
            {run.error ? ` · ${run.error}` : ""}
          </Text>
        </div>
      ),
      author: run.author ? (
        <span className="flex items-center gap-2 whitespace-nowrap">
          {run.author.avatarUrl && (
            <img src={run.author.avatarUrl} alt="" className="size-5 rounded-full" />
          )}
          <Text className="text-xs">{run.author.login}</Text>
        </span>
      ) : (
        <Text className="text-xs ak-ink-50">–</Text>
      ),
      state: <Tag tone={stateTones[run.state]}>{runStateLabel(run.state)}</Tag>,
      numbers: (
        <Text className="text-xs whitespace-nowrap tabular-nums">
          {run.pending} / {run.rejected} / {run.counts?.total ?? "–"}
          {run.progress ? ` · captured ${run.progress.captured} of ${run.progress.expected}` : ""}
        </Text>
      ),
      previews: (
        <span className="flex gap-1">
          {run.previews?.map((preview) => (
            <img
              key={preview.itemKey}
              src={preview.thumbnail}
              alt={preview.itemName}
              title={preview.itemKey}
              loading="lazy"
              className="h-7 w-10 rounded-sm object-cover object-top"
            />
          ))}
        </span>
      ),
    })),
  ];
  return (
    <div className="grid gap-2">
      <Heading className="mt-0 mb-0 text-sm font-semibold">
        {label}
        {limit && runs.length > limit ? ` · first ${limit} of ${runs.length} rows` : ""}
      </Heading>
      <Table aria-label={label} rows={rows} {...tableProps} />
    </div>
  );
}

function RunTables() {
  const mode = useDataMode();
  const inbox = getInboxData("busy", mode);
  const history = getHistoryData("full", mode);
  const pull = getPullData("attempts", mode);
  return (
    <div className="grid gap-6">
      {inbox.status === "ready" && <RunTable label="Inbox, busy" runs={inbox.runs} />}
      {pull.status === "ready" && <RunTable label="Pull request, attempts" runs={pull.runs} />}
      {history.status === "ready" && (
        <RunTable label="History, full" runs={history.runs} limit={24} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Facts of the production shape
// ---------------------------------------------------------------------------

const changeScenarios = ["changes", "large", "one-browser", "problems"] as const;

type FamilyColumn =
  | "family"
  | "label"
  | "items"
  | "variants"
  | "sections"
  | (typeof changeScenarios)[number];

function getItems(scenario: string, mode: DataMode): ReviewItem[] {
  const data = getReviewRun(scenario, mode);
  return data.status === "ready" ? data.review.items : [];
}

function FamilyTable() {
  const mode = useDataMode();
  const groups = groupItemsByFamily(getItems("clean", mode));
  // Changed screenshots and changed variants of each family in four runs.
  const changes = new Map<string, string>();
  for (const scenario of changeScenarios) {
    for (const group of groupItemsByFamily(getItems(scenario, mode))) {
      const { changedItems, changed, added, removed } = group.counts;
      if (!changedItems) continue;
      changes.set(
        `${scenario}:${group.family}`,
        `${changedItems} items, ${changed + added + removed} variants`,
      );
    }
  }
  const rows: TableRows<FamilyColumn> = [
    {
      group: "head",
      family: { children: "Family", $fit: true },
      label: { children: "Label", $fit: true },
      items: { children: "Items", numeric: true, $fit: true },
      variants: { children: "Variants", numeric: true, $fit: true },
      sections: { children: "Key groups", $grow: true },
      changes: { children: "changes", $fit: true },
      large: { children: "large", $fit: true },
      "one-browser": { children: "one-browser", $fit: true },
      problems: { children: "problems", $fit: true },
    },
    ...groups.map((group) => ({
      key: group.family,
      family: <Code>{group.family}</Code>,
      label: group.label,
      items: group.counts.items,
      variants: group.counts.variants,
      sections: (
        <Text className="text-xs whitespace-normal ak-ink-70">
          {group.sections
            .map((section) => `${section.group ?? "(none)"} ${section.items.length}`)
            .join(" · ")}
        </Text>
      ),
      changes: changes.get(`changes:${group.family}`) ?? "",
      large: changes.get(`large:${group.family}`) ?? "",
      "one-browser": changes.get(`one-browser:${group.family}`) ?? "",
      problems: changes.get(`problems:${group.family}`) ?? "",
    })),
  ];
  return <Table aria-label="Families" rows={rows} {...tableProps} />;
}

interface Fact {
  name: string;
  value: string;
}

/** Measured facts of the run that every review scenario has. */
function getShapeFacts(items: ReviewItem[]): Fact[] {
  const keyLengths = items.map((item) => item.key.length);
  const leafLengths = items.map((item) => splitItemKey(item.key).leaf.length);
  const segments = new Map<number, number>();
  const variantCounts = new Map<number, number>();
  const varying = new Map<string, number>();
  const sizes = new Map<SizeClass, number>();
  const widths = new Map<number, number>();
  const variantKeys = new Set<string>();
  let prefixCharacters = 0;
  let characters = 0;
  let variants = 0;
  for (const item of items) {
    const parts = splitItemKey(item.key);
    characters += item.key.length;
    prefixCharacters += item.key.length - parts.leaf.length;
    segments.set(parts.segments.length, (segments.get(parts.segments.length) ?? 0) + 1);
    variantCounts.set(item.variants.length, (variantCounts.get(item.variants.length) ?? 0) + 1);
    const axes = getVariantMatrix(item).varying.join(" × ");
    varying.set(axes, (varying.get(axes) ?? 0) + 1);
    variants += item.variants.length;
    const image = item.variants[0]?.reference;
    if (image) {
      const sizeClass = getSizeClass(image);
      sizes.set(sizeClass, (sizes.get(sizeClass) ?? 0) + 1);
      widths.set(image.width, (widths.get(image.width) ?? 0) + 1);
    }
    for (const variant of item.variants) {
      variantKeys.add(variant.key);
    }
  }
  const list = (entries: Map<string | number, number>) =>
    [...entries]
      .toSorted((first, second) => second[1] - first[1])
      .map(([name, count]) => `${name}: ${count}`)
      .join(" · ");
  const prefixShare = ((prefixCharacters / characters) * 100).toFixed(1);
  return [
    { name: "Screenshots and variants", value: `${items.length} and ${variants}` },
    { name: "Key length in characters", value: describeLengths(keyLengths) },
    { name: "Leaf length in characters", value: describeLengths(leafLengths) },
    { name: "Share of key characters before the leaf", value: `${prefixShare}%` },
    { name: "Key segments: screenshots", value: list(segments) },
    { name: "Variants for each screenshot: screenshots", value: list(variantCounts) },
    { name: "Axes that differ inside a screenshot", value: list(varying) },
    {
      name: "Distinct variant keys",
      value: `${variantKeys.size}, length ${describeLengths([...variantKeys].map((key) => key.length))}`,
    },
    { name: "Size class of the first variant", value: list(sizes) },
    { name: "Image width of the first variant", value: list(widths) },
  ];
}

function ShapeFacts() {
  const mode = useDataMode();
  const items = getItems("clean", mode);
  const facts = useMemo(() => getShapeFacts(items), [items]);
  const rows: TableRows<"name" | "value"> = [
    {
      group: "head",
      name: { children: "Fact", $fit: true },
      value: { children: "Value", $grow: true },
    },
    ...facts.map((fact) => ({
      key: fact.name,
      name: <Text className="text-sm whitespace-nowrap">{fact.name}</Text>,
      value: <Text className="text-xs whitespace-normal ak-ink-70">{fact.value}</Text>,
    })),
  ];
  return <Table aria-label="Shape of a production run" rows={rows} {...tableProps} />;
}

// ---------------------------------------------------------------------------
// Review items
// ---------------------------------------------------------------------------

function variantTone(variant: ReviewVariant): Tone {
  if (variant.kind === "error" || variant.verdict === "rejected") return "danger";
  if (variant.verdict === "approved") return "success";
  if (variant.kind === "unchanged") return undefined;
  if (variant.kind === "pending") return "brand";
  return "warning";
}

function isChangedItem(item: ReviewItem): boolean {
  return item.variants.some((variant) => variant.kind !== "unchanged" || variant.candidateOmitted);
}

type ItemColumn = "thumbnail" | "item" | "variants";

interface ItemTableProps {
  scenario: string;
  /** The largest number of changed items to show. */
  limit?: number;
}

/** The changed items of a run, then its first unchanged item. */
function ItemTable({ scenario, limit = 8 }: ItemTableProps) {
  const mode = useDataMode();
  const data = getReviewRun(scenario, mode);
  if (data.status !== "ready") return null;
  const { review } = data;
  const changed = review.items.filter(isChangedItem);
  const unchanged = review.items.find((item) => !isChangedItem(item));
  const items = [...changed.slice(0, limit), ...(unchanged ? [unchanged] : [])];
  const rows: TableRows<ItemColumn> = [
    {
      group: "head",
      thumbnail: { children: "Thumbnail", $fit: true },
      item: { children: "Item", $fit: true },
      variants: { children: "Variants: short label · kind · status", $grow: true },
    },
    ...items.map((item) => {
      const thumbnail = item.variants.find((variant) => variant.kind !== "unchanged")?.thumbnail;
      const picture = thumbnail ?? item.variants[0]?.thumbnail;
      return {
        key: item.key,
        thumbnail: picture ? (
          <img
            src={picture}
            alt=""
            loading="lazy"
            className="h-9 w-14 rounded-sm object-cover object-top"
          />
        ) : (
          <Text className="text-xs ak-ink-50">none</Text>
        ),
        item: (
          <div className="grid w-72 gap-0.5 whitespace-normal">
            <Text className="text-sm font-medium">{getItemLabel(item)}</Text>
            <Text className="text-xs break-all ak-ink-60">{item.name}</Text>
            <Text className="text-xs ak-ink-50">
              {item.displayName ? `displayName “${item.displayName}”` : "no displayName"} ·{" "}
              {getVariantMatrix(item).caption}
            </Text>
          </div>
        ),
        variants: (
          <span className="flex flex-wrap gap-1 whitespace-normal">
            {item.variants.map((variant) => (
              <Tag key={variant.key} tone={variantTone(variant)}>
                {getVariantLabel(variant, item)} · {variant.kind} · {variantStatusLabel(variant)}
                {isSizeChange(variant) ? " · size change" : ""}
                {variant.kind === "changed" && variant.ratio != null && !isSizeChange(variant)
                  ? ` · ${variant.changedPixels} px (${formatRatio(variant.ratio)})`
                  : ""}
                {variant.candidateOmitted ? " · candidate omitted" : ""}
              </Tag>
            ))}
          </span>
        ),
      };
    }),
  ];
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <Heading className="mt-0 mb-0 text-sm font-semibold">Review, {scenario}</Heading>
        <Text className="text-xs ak-ink-60">
          {review.run.title} · {review.run.status} · {changed.length} changed of{" "}
          {review.items.length} items
          {changed.length > limit ? ` · first ${limit} changed items` : ""}
        </Text>
      </div>
      <Table aria-label={`Review, ${scenario}`} rows={rows} {...tableProps} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant matrix
// ---------------------------------------------------------------------------

// One screenshot for each matrix shape of production.
const matrixSamples = [
  "ariakit-ui-button/page/default",
  "ariakit-tailwind-7466/applied-light-week-hover",
  "ariakit-ui-badge/forced-colors/default",
  "ariakit-ui-combobox/page/default",
  "ariakit-ui-shell/docs-responsive",
  "previews/separator/_component",
];

interface MatrixCardProps {
  item: ReviewItem;
}

function MatrixCard({ item }: MatrixCardProps) {
  const matrix = getVariantMatrix(item);
  const [first] = item.variants;
  return (
    <Frame $lighten $border $rounded="xl" $p="1rem" className="grid content-start gap-2">
      <Text className="text-sm font-medium break-all">{item.key}</Text>
      <Text className="text-xs ak-ink-60">
        {item.variants.length} variants · differ in {matrix.varying.join(", ") || "nothing"} ·
        caption “{matrix.caption}”
      </Text>
      <div
        role="img"
        aria-label={`Matrix of ${item.key}`}
        className="grid items-center justify-start gap-x-4 gap-y-1 text-xs"
        style={{ gridTemplateColumns: `auto repeat(${matrix.columns.length}, auto)` }}
      >
        <span />
        {matrix.columns.map((column) => (
          <Text key={column} className="ak-ink-60">
            {formatAxisValue("browser", column)}
          </Text>
        ))}
        {matrix.rows.map((row) => (
          <Fragment key={row.id}>
            <Text className="whitespace-nowrap ak-ink-70">{row.label || "(one row)"}</Text>
            {row.cells.map((variant, index) => {
              const column = matrix.columns[index];
              if (!variant) return <span key={column}>–</span>;
              return (
                <Tag key={column} tone={variantTone(variant)}>
                  {item.variants.indexOf(variant) + 1}
                </Tag>
              );
            })}
          </Fragment>
        ))}
      </div>
      {first && (
        <Text className="text-xs break-all ak-ink-60">
          Short label “{getVariantLabel(first, item)}”. Production label “{first.label}”.
        </Text>
      )}
    </Frame>
  );
}

function MatrixSamples() {
  const mode = useDataMode();
  const items = getItems("changes", mode);
  return (
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      {matrixSamples.map((key) => {
        const item = items.find((entry) => entry.key === key);
        return item ? <MatrixCard key={key} item={item} /> : null;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

const checkerboard = "bg-[repeating-conic-gradient(#8883_0_25%,#0000_0_50%)] bg-size-[16px_16px]";

interface Picture {
  url: string;
  width: number;
  height: number;
}

interface ShotProps {
  label: string;
  image: Picture | null;
  regions?: ChangedRegion[];
  /** Shows the image at its natural size instead of the column width. */
  natural?: boolean;
  /** The text of the empty state. */
  empty?: string;
}

function Shot({ label, image, regions, natural = false, empty = "No image" }: ShotProps) {
  return (
    <figure className="grid min-w-0 content-start gap-1.5">
      <Text render={<figcaption />} className="text-xs ak-ink-60">
        {label}
        {image ? ` · ${image.width} × ${image.height}` : ""}
      </Text>
      {image ? (
        // The checkerboard shows through the transparent parts of a mask. The
        // content box has the image width, so a natural image is not scaled.
        <Frame
          $border
          $rounded="md"
          $forceRounded
          className={`relative box-content overflow-clip ${checkerboard}`}
          style={natural ? { width: image.width } : { maxWidth: image.width }}
        >
          <img
            src={image.url}
            width={image.width}
            height={image.height}
            alt={label}
            loading="lazy"
            className="block h-auto w-full"
          />
          {regions?.map((region, index) => (
            <span
              key={index}
              className="absolute outline-2 outline-offset-2 outline-fuchsia-500"
              style={{
                left: `${(region.x / image.width) * 100}%`,
                top: `${(region.y / image.height) * 100}%`,
                width: `${(region.width / image.width) * 100}%`,
                height: `${(region.height / image.height) * 100}%`,
              }}
            />
          ))}
        </Frame>
      ) : (
        <Frame $border $borderType="dashed" $rounded="md" $forceRounded $p={4}>
          <Text className="text-xs ak-ink-60">{empty}</Text>
        </Frame>
      )}
    </figure>
  );
}

interface SampleCardProps {
  id: ReviewSampleId;
}

/** One named sample with its images, as `useReviewSample(id)` returns it. */
function SampleCard({ id }: SampleCardProps) {
  const { title, scenario, item, variant, labOnly } = useReviewSample(id);
  const { reference, candidate, diff, diffPreview, regions } = variant;
  const picture = candidate ?? reference;
  const sizeClass = picture ? sizeClasses[getSizeClass(picture)] : undefined;
  return (
    <Frame $lighten $border $rounded="xl" $p="1rem" render={<section />} className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Code>{id}</Code>
        <Heading className="mt-0 mb-0 text-sm font-semibold">{title}</Heading>
        <Text className="text-xs break-all ak-ink-60">
          {scenario} · {item.key} · {getVariantLabel(variant, item)}
        </Text>
        <Tag tone={variantTone(variant)}>{variantStatusLabel(variant)}</Tag>
        {sizeClass && <Tag tone={labOnly ? "brand" : undefined}>{sizeClass.label}</Tag>}
        <Text className="text-xs ak-ink-60">
          {variant.changedPixels == null
            ? "no pixel count"
            : `${variant.changedPixels} changed pixels`}
          {variant.ratio == null ? "" : ` · ratio ${formatRatio(variant.ratio)}`}
          {regions ? ` · ${regions.length} regions` : " · no regions field"}
        </Text>
      </div>
      <div className="grid grid-cols-2 items-start gap-4 xl:grid-cols-5">
        <Shot label="reference" image={reference} empty="No reference: a new screenshot" />
        <Shot label="candidate" image={candidate} empty="No candidate" />
        <Shot label="diff (mask)" image={diff} empty="No mask" />
        <Shot
          label="diffPreview"
          image={diffPreview ?? null}
          empty={diffPreview === undefined ? "Not in the API today" : "No mask"}
        />
        <Shot
          label="regions"
          image={regions?.length ? candidate : null}
          regions={regions}
          empty={regions ? "No regions" : "Not in the API today"}
        />
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Lab-only scenes
// ---------------------------------------------------------------------------

const schemes: ColorScheme[] = ["light", "dark"];

const appearances: Array<{ label: string; appearance: Appearance }> = [
  { label: "light", appearance: { scheme: "light" } },
  { label: "dark", appearance: { scheme: "dark" } },
  { label: "light · more contrast", appearance: { scheme: "light", contrast: "more" } },
  { label: "dark · more contrast", appearance: { scheme: "dark", contrast: "more" } },
  { label: "light · forced colors", appearance: { scheme: "light", forcedColors: "active" } },
  { label: "dark · forced colors", appearance: { scheme: "dark", forcedColors: "active" } },
];

function AppearanceGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-3 2xl:grid-cols-6">
      {appearances.map(({ label, appearance }) => (
        <div key={label} className="grid content-start gap-3">
          <Shot label={label} image={getScreenshot({ scene: "checkbox", ...appearance })} />
          <Shot
            label={`${label} · current`}
            image={getScreenshot({ scene: "popover", state: "current", ...appearance })}
          />
        </div>
      ))}
    </div>
  );
}

interface SceneCardProps {
  scene: SceneDefinition;
  natural: boolean;
  scheme?: ColorScheme;
  state?: string;
}

function SceneCard({ scene, natural, scheme: onlyScheme, state: onlyState }: SceneCardProps) {
  return (
    <Frame $lighten $border $rounded="xl" $p="1rem" render={<section />} className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Heading className="mt-0 mb-0 text-sm font-semibold">{scene.title}</Heading>
        <Link to="/dev/fixtures" search={{ scene: scene.id }}>
          <Code>{scene.id}</Code>
        </Link>
        <Tag>
          {scene.size} · {scene.width} × {scene.height}
          {scene.changedHeight ? ` → ${scene.width} × ${scene.changedHeight}` : ""}
        </Tag>
        <Tag tone="warning">{scene.change.kind}</Tag>
        <Text className="text-sm ak-ink-60">{scene.change.summary}</Text>
      </div>
      {schemes.map((scheme) => {
        if (onlyScheme && onlyScheme !== scheme) return null;
        const set = getScreenshotSet({ scene: scene.id, scheme });
        const shots: Array<ShotProps & { state: string }> = [
          { state: "baseline", label: `${scheme} · baseline`, image: set.baseline },
          { state: "current", label: `${scheme} · current`, image: set.current },
          { state: "diff", label: `${scheme} · diff`, image: set.diff },
          { state: "diffPreview", label: `${scheme} · diffPreview`, image: set.diffPreview },
          {
            state: "regions",
            label: `${scheme} · ${set.regions.length} regions · ${set.changedPixels} px · ${formatRatio(set.ratio)}`,
            image: set.current,
            regions: set.regions,
          },
        ];
        return (
          <div
            key={scheme}
            className={
              natural ? "flex flex-wrap items-start gap-4" : "grid grid-cols-2 gap-4 xl:grid-cols-5"
            }
          >
            {shots.map(({ state, ...shot }) => {
              if (onlyState && onlyState !== state) return null;
              return <Shot key={state} natural={natural} empty="No visible change" {...shot} />;
            })}
          </div>
        );
      })}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// A plain list of one run, to measure the fixture hooks
// ---------------------------------------------------------------------------

interface BenchEntry {
  phase: string;
  /** Milliseconds that React spent in the render of the list. */
  duration: number;
}

declare global {
  interface Window {
    /** The render times of the list view, for the measurement script. */
    labBench?: BenchEntry[];
  }
}

const recordRender: ProfilerOnRenderCallback = (_id, phase, duration) => {
  if (typeof window === "undefined") return;
  window.labBench ??= [];
  window.labBench.push({ phase, duration });
};

interface ListViewProps {
  scenario: string;
}

/**
 * The simplest page that a builder can make with the session hook: one row
 * for each screenshot. It renders no image, so its time is the time of the
 * fixture layer and of 626 plain rows.
 */
function ListView({ scenario }: ListViewProps) {
  const session = useReviewSession(scenario);
  if (session.status !== "ready") return <Text>{session.status}</Text>;
  const { item, variant, progress } = session;
  return (
    <div className="grid gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Heading className="mt-0 mb-0 text-lg font-semibold">{session.run.title}</Heading>
        <Text className="text-sm ak-ink-60" data-bench="progress">
          {progress.decided} of {progress.total} decided · {session.items.length} items ·{" "}
          {session.counts.total} variants
        </Text>
        <Button
          data-bench="approve"
          $layer="brand"
          disabled={!session.can.approve}
          onClick={() => session.approve()}
        >
          Approve
        </Button>
        <Button data-bench="next" $lightnessOffset onClick={() => session.next()}>
          Next
        </Button>
        <Button
          data-bench="filter"
          $lightnessOffset
          onClick={() => {
            session.setFilters({ browser: session.filters.browser === "all" ? "webkit" : "all" });
          }}
        >
          Filter WebKit
        </Button>
        <Button
          data-bench="undo"
          $lightnessOffset
          disabled={!session.can.undo}
          onClick={session.undo}
        >
          Undo
        </Button>
        <Text className="text-sm" data-bench="selection">
          {item?.label} · {variant?.name}
        </Text>
      </div>
      <ul className="grid gap-px text-sm">
        {session.visibleItems.map((entry) => (
          <li
            key={entry.key}
            aria-current={entry.key === item?.key ? "true" : undefined}
            className="flex gap-3 px-2 py-0.5 aria-[current]:font-semibold"
          >
            <span className="w-24 ak-ink-60">{entry.status}</span>
            <span className="flex-1 truncate">{entry.name}</span>
            <span className="tabular-nums ak-ink-60">
              {entry.counts.undecided} of {entry.matches.length}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const sections = [
  { id: "datasets", title: "Datasets" },
  { id: "runs", title: "Runs" },
  { id: "shape", title: "Production shape" },
  { id: "review", title: "Review items" },
  { id: "matrix", title: "Variant matrix" },
  { id: "images", title: "Real images" },
  { id: "scenes", title: "Lab-only scenes" },
];

interface ModeLinksProps {
  value: DataMode | undefined;
}

/** Pins the data mode of this page in its URL. */
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
          aria-current={option.id === value ? "true" : undefined}
          render={
            <Link
              to="/dev/fixtures"
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

const modeTones: Record<DataMode, Tone> = {
  decided: "success",
  today: "warning",
  improved: "brand",
};

function CurrentMode() {
  const mode = useDataMode();
  return <Tag tone={modeTones[mode]}>Data: {dataModeLabels[mode]}</Tag>;
}

function FixturesPage() {
  const { scene: selected, scheme, state, data, view, scenario } = Route.useSearch();
  const selectedScenes = scenes.filter((scene) => scene.id === selected);
  const followGate = useDataGate();
  // A pinned mode is the same on the server and on the client. A mode that
  // follows the Look menu stays hidden until the client has rendered the
  // saved mode.
  const dataGate = data ? "contents" : followGate;
  if (view === "list") {
    return (
      <DataModeProvider mode={data}>
        <div className={dataGate}>
          <Profiler id="list" onRender={recordRender}>
            <ListView scenario={scenario ?? "changes"} />
          </Profiler>
        </div>
      </DataModeProvider>
    );
  }
  if (selectedScenes.length) {
    return (
      <HeadingLevel>
        <div className="grid gap-4 p-6">
          <Button
            $lightnessOffset
            className="justify-self-start"
            render={<Link to="/dev/fixtures" />}
          >
            <ButtonLabel>All fixtures</ButtonLabel>
          </Button>
          {selectedScenes.map((scene) => (
            <SceneCard key={scene.id} scene={scene} natural scheme={scheme} state={state} />
          ))}
        </div>
      </HeadingLevel>
    );
  }
  return (
    <DataModeProvider mode={data}>
      <HeadingLevel>
        <div className={dataGate}>
          <div className="mx-auto grid max-w-[120rem] grid-cols-[minmax(0,1fr)] gap-10 p-6">
            <header className="grid gap-3">
              <Heading className="text-2xl font-semibold">Fixtures</Heading>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <Text className="ak-ink-70">
                  <Code>NOW</Code> {formatDateTime(NOW)} UTC
                </Text>
                <Text className="ak-ink-70">
                  <Code>repository</Code> {repository}
                </Text>
                <span className="flex items-center gap-2">
                  <Code>currentUser</Code>
                  {currentUser.avatarUrl && (
                    <img src={currentUser.avatarUrl} alt="" className="size-5 rounded-full" />
                  )}
                  <Text className="ak-ink-70">{currentUser.login}</Text>
                </span>
                <CurrentMode />
                <ModeLinks value={data} />
              </div>
              <nav aria-label="Sections" className="flex flex-wrap gap-2">
                {sections.map((section) => (
                  <Button key={section.id} $lightnessOffset render={<a href={`#${section.id}`} />}>
                    <ButtonLabel>{section.title}</ButtonLabel>
                  </Button>
                ))}
                <Button
                  $lightnessOffset
                  render={<Link to="/dev/fixtures" search={{ view: "list", data }} />}
                >
                  <ButtonLabel>Plain list of one run</ButtonLabel>
                </Button>
              </nav>
            </header>
            <HeadingLevel>
              <Section
                id="datasets"
                title="Datasets"
                note="One row for each scenario of each getter, in the three data modes."
              >
                <DatasetTables />
              </Section>
              <Section
                id="runs"
                title="Runs"
                note="The run rows of the inbox, a pull request, and the history, in the data mode of this page."
              >
                <RunTables />
              </Section>
              <Section
                id="shape"
                title="Production shape"
                note="Every review run has these 626 screenshots. The numbers are computed from the fixtures."
              >
                <ShapeFacts />
                <FamilyTable />
              </Section>
              <Section
                id="review"
                title="Review items"
                note="The changed items of each run, then one unchanged item. Each badge is one variant."
              >
                <ItemTable scenario="changes" />
                <ItemTable scenario="one-browser" limit={3} />
                <ItemTable scenario="large" limit={3} />
                <ItemTable scenario="problems" />
                <ItemTable scenario="read-only" limit={4} />
                <ItemTable scenario="comparing" limit={3} />
              </Section>
              <Section
                id="matrix"
                title="Variant matrix"
                note="getVariantMatrix(item): browsers as columns, and one row for each combination of the other axes that differ. A number is the position of the variant."
              >
                <MatrixSamples />
              </Section>
              <Section
                id="images"
                title="Real images"
                note="useReviewSample(id): one real Ariakit capture for each case, with its pixelmatch mask. The diff preview and the regions exist in the mode All proposed fields only."
              >
                {reviewSampleIds.map((id) => (
                  <SampleCard key={id} id={id} />
                ))}
              </Section>
              <Section
                id="scenes"
                title="Lab-only scenes"
                note="Synthetic SVG screenshots for sizes that production does not have. No page scenario uses them. Select a scene identifier to see it at its natural size."
              >
                <AppearanceGrid />
                {scenes.map((scene) => (
                  <SceneCard key={scene.id} scene={scene} natural={false} />
                ))}
              </Section>
            </HeadingLevel>
          </div>
        </div>
      </HeadingLevel>
    </DataModeProvider>
  );
}
