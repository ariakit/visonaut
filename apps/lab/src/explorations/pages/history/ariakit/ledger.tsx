import { cx } from "clava";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useId, useState } from "react";
import type { CSSProperties } from "react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import { formatCount } from "../../../../fixtures/index.ts";
import { RunRow, RunRowList, RunRowSkeleton } from "../../../kits/ariakit/run-row.tsx";
import { SkeletonLine } from "../../../kits/ariakit/skeleton-line.tsx";
import { iconStroke, tertiary } from "../../../kits/ariakit/tokens.ts";
import type { LedgerDay, LedgerRow } from "./model.ts";

/** The blocks of the page are six steps apart. */
export const pageStack = "grid min-w-0 gap-6";
// A label is two steps above its sheet, and it starts where the status discs
// of the rows start.
const dayStack = "grid min-w-0 gap-2";
const labelClassName = cx(tertiary, "px-5");

// The fold button follows the age of its row, at the end of the identity
// line. A row is one link, so the button is not inside it. The age of the row
// is the anchor of the button, and CSS anchor positioning puts the button
// after it, so the button needs no copy of the geometry of the row.
const foldAnchor = "[&_time]:[anchor-name:var(--fold-anchor)]";
const foldPlace = "absolute start-[anchor(end)] top-[anchor(center)] ms-2 -translate-y-1/2";
// The disc of an earlier run starts where the title of the newest run
// starts: one disc (2.5em) further in, and the space between a disc and its
// title. That space is the padding of a row (three steps) and one line, less
// half a disc and the side bearing of the text (0.15em).
const earlierIndent = "ms-[calc(--spacing(3)+1lh+1.1em)] w-auto!";

interface FoldProps {
  row: LedgerRow;
  expanded: boolean;
  /** The anchor name of the age of the row. */
  anchor: string;
  /** The identifier of the first earlier run, which the button controls. */
  controls: string;
  onToggle(key: string): void;
}

// The button that shows the earlier runs of a pull request. It follows its
// row in a box without height.
function Fold({ row, expanded, anchor, controls, onToggle }: FoldProps) {
  const count = row.earlier.length;
  return (
    <span className="block h-0 @max-3xl:h-auto">
      <span
        style={{ positionAnchor: anchor }}
        className={cx(
          "flex items-center",
          foldPlace,
          // A list below 48rem has no room beside the identity line, so the
          // button takes a line of its own under the row.
          "@max-3xl:static @max-3xl:ms-0 @max-3xl:translate-y-0 @max-3xl:justify-end @max-3xl:px-3 @max-3xl:pb-2",
        )}
      >
        <Button
          $size="xs"
          // The button is as tall as the identity line allows: a taller one
          // lies over the title of the row.
          $p={0.5}
          $ink={70}
          aria-expanded={expanded}
          aria-controls={expanded ? controls : undefined}
          aria-label={`${formatCount(count, "earlier run")}${
            row.run.pullRequestNumber == null ? "" : ` of #${row.run.pullRequestNumber}`
          }`}
          onClick={() => onToggle(row.key)}
        >
          <ButtonLabel className="tabular-nums">{`${formatCount(count)} earlier`}</ButtonLabel>
          <ButtonSlot $size="sm">
            {expanded ? (
              <ChevronDown strokeWidth={iconStroke} />
            ) : (
              <ChevronRight strokeWidth={iconStroke} />
            )}
          </ButtonSlot>
        </Button>
      </span>
    </span>
  );
}

interface LedgerRowsProps {
  row: LedgerRow;
  expanded: boolean;
  onToggle(key: string): void;
}

// One pull request: its newest run, the fold button, and the earlier runs
// while the fold is open. All are children of the list, so the gliders of
// the list follow every row.
function LedgerRows({ row, expanded, onToggle }: LedgerRowsProps) {
  const id = useId();
  if (!row.earlier.length) return <RunRow run={row.run} />;
  // An anchor name is an identifier, and the identifier of React has other
  // characters.
  const anchor = `--fold-${id.replace(/\W/g, "")}`;
  const anchorStyle = { "--fold-anchor": anchor } as CSSProperties;
  return (
    <>
      <RunRow run={row.run} style={anchorStyle} className={foldAnchor} />
      <Fold
        row={row}
        expanded={expanded}
        anchor={anchor}
        controls={`${id}-0`}
        onToggle={onToggle}
      />
      {expanded &&
        row.earlier.map((run, index) => (
          <RunRow key={run.id} id={`${id}-${index}`} run={run} soft className={earlierIndent} />
        ))}
    </>
  );
}

export interface LedgerProps {
  /** The rows by day. One group without a label for a list with no days. */
  days: readonly LedgerDay[];
  /** Opens every fold, for a filter that shows replaced runs. */
  autoExpand: boolean;
  /** The line under the last sheet, for example `Latest 100 runs`. */
  footer?: string;
}

/**
 * The run history as a day ledger: a label and one sheet of run rows for
 * each day. The runs of one pull request are one row, and its earlier runs
 * fold under it.
 */
export function Ledger({ days, autoExpand, footer }: LedgerProps) {
  // The folds that a person turned around. A fold is open when the filter
  // opens it, or when a person opened it, and not both.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const onToggle = useCallback((key: string) => {
    setToggled((current) => {
      const next = new Set(current);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }, []);
  return (
    <>
      {days.map((day) => (
        <section key={day.id} aria-label={day.label ?? "Runs"} className={dayStack}>
          {day.label && (
            // The page has a hidden `h1`. A `Heading` has full ink and a
            // weight of its own, and a label is plain soft text.
            <Text render={<h2 />} className={labelClassName}>
              {day.label}
            </Text>
          )}
          <RunRowList aria-label={day.label ?? "Runs"}>
            {day.rows.map((row) => (
              <LedgerRows
                key={row.key}
                row={row}
                expanded={row.earlier.length > 0 && toggled.has(row.key) !== autoExpand}
                onToggle={onToggle}
              />
            ))}
          </RunRowList>
        </section>
      ))}
      {footer && (
        <Text render={<p />} className={cx(labelClassName, "text-xs tabular-nums")}>
          {footer}
        </Text>
      )}
    </>
  );
}

export interface LedgerSkeletonProps {
  rows?: number;
  /** A still shape under an `ErrorBand`. */
  still?: boolean;
}

/**
 * The shape of the ledger before the runs load: one day label and one sheet
 * with rows of the size of run rows.
 */
export function LedgerSkeleton({ rows = 8, still }: LedgerSkeletonProps) {
  return (
    <div aria-hidden className={dayStack}>
      <SkeletonLine soft still={still} className={cx(labelClassName, "w-24")} />
      <RunRowSkeleton count={rows} still={still} />
    </div>
  );
}
