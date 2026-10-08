// The layout around the marks of the legend: the cell of a scenario, the
// table of the two forms, and the five surfaces of the product.

import { cx } from "clava";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import {
  Table,
  TableCell,
  TableRow,
  TableRowGroup,
} from "../../../../components/ariakit/components/table.ariakit.react.tsx";
import { TextFrame } from "../../../../components/ariakit/components/text-frame.ariakit.react.tsx";
import type { TextFrameProps } from "../../../../components/ariakit/components/text-frame.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import {
  Tooltip,
  TooltipAnchor,
  TooltipProvider,
} from "../../../../components/ariakit/components/tooltip.ariakit.react.tsx";
import { focus } from "../../../../components/ariakit/styles/focus.ts";
import { StatusGlyph, StatusPill, statusStyles } from "../../../kits/ariakit/status.tsx";
import type { StatusName } from "../../../kits/ariakit/status.tsx";
import { Sheet } from "../../../kits/ariakit/surfaces.tsx";
import { overlayRoot, tertiary } from "../../../kits/ariakit/tokens.ts";

export interface CellProps extends ComponentProps<"div"> {
  /** Two cells wide, for a part that needs the room that it has in a page. */
  wide?: boolean;
}

/** The box of one scenario. The explorer puts these cells side by side. */
export function Cell({ wide, className, ...props }: CellProps) {
  return (
    <div
      {...props}
      className={cx(
        "grid max-w-full grid-cols-[minmax(0,1fr)] gap-4 text-sm",
        wide ? "w-180" : "w-90",
        className,
      )}
    />
  );
}

/** A caption above a part of a cell. */
export function Caption({ className, ...props }: ComponentProps<"span">) {
  return <Text {...props} className={cx(tertiary, "text-xs", className)} />;
}

export interface FormsTableProps {
  /** The name of the list, for example `Run states`. */
  label: string;
  states: readonly StatusName[];
}

/**
 * The two forms of each state side by side: the pill, and the bare glyph of
 * a strip. The glyph is the icon of the pill without its circle.
 */
export function FormsTable({ label, states }: FormsTableProps) {
  return (
    <div className="grid grid-cols-[10rem_auto] items-center justify-start gap-x-4 gap-y-2">
      <Caption aria-hidden>Pill</Caption>
      <Caption aria-hidden>Glyph</Caption>
      <ul aria-label={label} className="contents">
        {states.map((status) => (
          <li key={status} className="col-span-2 grid grid-cols-subgrid items-center">
            <span className="flex">
              <StatusPill status={status} />
            </span>
            {/* The pill beside the glyph names the state. */}
            <span className="flex h-lh items-center">
              <StatusGlyph status={status} decorative />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface GlyphWordsProps {
  states: readonly StatusName[];
}

/** Glyphs that have no pill of their own, each with its word. */
export function GlyphWords({ states }: GlyphWordsProps) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
      {states.map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <StatusGlyph status={status} decorative />
          {statusStyles[status].label}
        </li>
      ))}
    </ul>
  );
}

interface MarkTooltipProps {
  label: ReactNode;
  /**
   * A mark that shows no word is a tab stop, so that a keyboard user can read
   * the word. A mark beside its word, or inside a control, is not.
   */
  focusable?: boolean;
  /** The element that the tooltip describes. */
  children: ReactElement;
}

/** The state word of a mark that shows no word, on hover and on focus. */
export function MarkTooltip({ label, focusable = false, children }: MarkTooltipProps) {
  const ring = focusable ? focus.class({ $focus: true, $focusOffset: 2 }) : undefined;
  return (
    <TooltipProvider>
      <TooltipAnchor focusable={focusable} render={children} className={ring} />
      <Tooltip className={overlayRoot}>{label}</Tooltip>
    </TooltipProvider>
  );
}

/** A stack of marks, one for each line. */
export function Stack({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cx("grid justify-items-start gap-2", className)} />;
}

export type SurfaceName = "canvas" | "sheet" | "cell" | "selected" | "brand";

interface SurfacesProps {
  /** Needs review and Failed. */
  states: readonly StatusName[];
  renderMark: (status: StatusName, surface: SurfaceName) => ReactNode;
}

interface SurfaceBlockProps {
  caption: string;
  children: ReactNode;
}

function SurfaceBlock({ caption, children }: SurfaceBlockProps) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
      <Caption>{caption}</Caption>
      {children}
    </div>
  );
}

// The row takes the side padding of a table cell with the same `$p`, and the
// marks stand two side paddings apart, as the cells of a table do. So the
// marks of the boxed surfaces make two columns.
function SurfaceRow({ className, ...props }: TextFrameProps) {
  return (
    <TextFrame
      $p={2}
      {...props}
      className={cx("flex items-center gap-[calc(var(--px)*2)]", className)}
    />
  );
}

/**
 * The same two marks on the five surfaces of the product. The table is one
 * grid with a plain row and a selected row.
 */
export function Surfaces({ states, renderMark }: SurfacesProps) {
  const [first, second] = states;
  const renderMarks = (surface: SurfaceName) =>
    states.map((status) => <span key={status}>{renderMark(status, surface)}</span>);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <SurfaceBlock caption="Canvas">
        {/* On the canvas, the marks start at the edge of the content. */}
        <div className="flex items-center gap-6 py-1">{renderMarks("canvas")}</div>
      </SurfaceBlock>
      <SurfaceBlock caption="Sheet">
        <Sheet $p={2} className="flex items-center gap-4 ps-4">
          {renderMarks("sheet")}
        </Sheet>
      </SurfaceBlock>
      <SurfaceBlock caption="Table, second row selected">
        <Table
          role="grid"
          aria-label="Marks in a table"
          container={{ $border: true, $rounded: "lg" }}
          $borderInline={false}
          $p={2}
        >
          <TableRowGroup>
            <TableRow>
              <TableCell $fit>{first && renderMark(first, "cell")}</TableCell>
              <TableCell $grow>{second && renderMark(second, "cell")}</TableCell>
            </TableRow>
            <TableRow selected>
              <TableCell $fit>{first && renderMark(first, "selected")}</TableCell>
              <TableCell $grow>{second && renderMark(second, "selected")}</TableCell>
            </TableRow>
          </TableRowGroup>
        </Table>
      </SurfaceBlock>
      <SurfaceBlock caption="Brand">
        <SurfaceRow $layer="brand" $rounded="lg">
          {renderMarks("brand")}
        </SurfaceRow>
      </SurfaceBlock>
    </div>
  );
}
