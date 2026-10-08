import { cx } from "clava";
import type { MouseEvent } from "react";
import {
  Button,
  ButtonGlider,
  ButtonGroup,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import type { SessionItem, SessionVariant } from "../../../../fixtures/hooks/index.ts";
import { useShortcuts } from "../../../kits/ariakit/keys.tsx";
import { PlaceLink } from "../../../kits/ariakit/place.tsx";
import { useRegionLookup } from "../../../kits/ariakit/regions.ts";
import { StateChip } from "../../../kits/ariakit/stage/chip.tsx";
import { CoverPicture } from "../../../kits/ariakit/stage/cover-picture.tsx";
import type { ImageSide } from "../../../kits/ariakit/stage/model.ts";
import { StatusGlyph, getStripStatusName } from "../../../kits/ariakit/status.tsx";
import { Well } from "../../../kits/ariakit/surfaces.tsx";
import { tertiary } from "../../../kits/ariakit/tokens.ts";
import { getVariantKey, getVariantName } from "../../../kits/ariakit/variants/model.ts";
import {
  getCellNote,
  getCellSubject,
  getCoverColumns,
  getCoverVariants,
  getDefaultColumns,
} from "./model.ts";
import { useElementSize } from "./use-element-size.ts";

// The columns of the grid before the browser measures it, and for a narrow
// grid: two cells side by side, four as two by two, and three in a row for
// up to nine. A measured grid takes the columns of `getCoverColumns`.
const columnClasses: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 @2xl:grid-cols-2",
  3: "grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-3",
  4: "grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-4",
};

// Below this width the grid is one column that scrolls: 36rem, the `@xl`
// container size of the classes above.
const narrowGrid = 576;

// The room that a cell takes around its picture at the default density: its
// padding and the gutter of its well at the sides, and the same with its
// name line above. In screen pixels, as is the space between two cells.
const cellChrome = { width: 34, height: 50 };
const cellGap = 3.5;
const narrowestCell = 240;

// The height that the bar covers, as `gutterBottom` of the stage: the cells
// end above the bar.
const barClearance = "pb-[4rem]";

function isPlainClick(event: MouseEvent) {
  if (event.button !== 0) return false;
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

interface CellProps {
  item: SessionItem;
  variant: SessionVariant;
  /** The variant that the variant control names. */
  selected: boolean;
  side: ImageSide;
  mask: boolean;
  /** True for a grid that scrolls: its rows give the cell its height. */
  fixedHeight: boolean;
  onOpen(variantKey: string): void;
}

function Cell({ item, variant, selected, side, mask, fixedHeight, onOpen }: CellProps) {
  const { enabled } = useShortcuts();
  const key = getVariantKey(variant);
  const note = getCellNote(variant);
  const name = getVariantName(variant);
  const shown = side === "baseline" && variant.reference ? "baseline" : "current";
  return (
    <Button
      $p={1.5}
      aria-current={selected ? "true" : undefined}
      aria-label={note ? `${name}. ${note}` : name}
      render={
        <PlaceLink
          itemKey={item.key}
          variantKey={variant.key}
          // The link writes the place, and the page follows it. The cell also
          // opens at once, so a click on the variant that the URL names
          // already still leaves the cover.
          onClick={(event) => {
            if (!isPlainClick(event)) return;
            onOpen(variant.key);
          }}
        />
      }
      className={cx("min-w-0 flex-col items-stretch gap-1.5", !fixedHeight && "min-h-32")}
    >
      <span className="flex min-w-0 flex-none items-center gap-2 px-1">
        <StatusGlyph status={getStripStatusName(variant)} decorative />
        <Text className="min-w-0 truncate text-start font-medium">{variant.name}</Text>
        {note && <Text className={cx(tertiary, "flex-none font-normal tabular-nums")}>{note}</Text>}
        {/* The number key of the variant, as dimmed text at the end, where a
            control has its shortcut. */}
        {enabled && key && (
          <Text
            aria-hidden
            render={<kbd />}
            className={cx(tertiary, "ms-auto flex-none font-normal")}
          >
            {key}
          </Text>
        )}
      </span>
      <Well $p={2} className="flex min-h-0 flex-1">
        <CoverPicture
          variant={variant}
          side={side}
          mask={mask}
          name={`${shown === "baseline" ? "Baseline" : "Current"}: ${variant.name}`}
          className="flex-1"
        />
      </Well>
    </Button>
  );
}

export interface CoverProps {
  item: SessionItem;
  /** The variant that the variant control names. */
  variant: SessionVariant | null;
  /** The image of every cell: the current one, or the baseline in its place. */
  side: ImageSide;
  /** The mask switch: the tint and the boxes on the current image. */
  mask: boolean;
  /** A cell was opened. Its link also writes the place to the URL. */
  onOpen(variantKey: string): void;
  className?: string;
}

/**
 * The cover of a screenshot: every variant that takes a verdict, cropped to
 * its change, with one mask switch for all cells. A decision for the whole
 * screenshot has all its evidence on screen. Each cell is a link to its
 * variant.
 */
export function Cover({ item, variant, side, mask, onOpen, className }: CoverProps) {
  const cells = getCoverVariants(item);
  const getRegions = useRegionLookup(cells);
  const [setGrid, grid] = useElementSize<HTMLDivElement>();
  const scrolls = cells.length > 9;
  // A grid that fits takes the columns that show its pictures largest. The
  // browser measures the grid in the frame in which the pictures arrive, so
  // the columns do not move after that.
  let columns: number | undefined;
  const reading = cells.some((cell) => cell.diff && getRegions(cell) === undefined);
  if (grid && !scrolls && !reading && grid.width >= narrowGrid) {
    const subjects = cells.flatMap((cell) => {
      const image = cell.candidate ?? cell.reference;
      return image ? [getCellSubject(image, getRegions(cell))] : [];
    });
    if (subjects.length === cells.length) {
      columns = getCoverColumns({
        subjects,
        box: grid,
        chrome: cellChrome,
        gap: cellGap,
        narrowest: narrowestCell,
      });
    }
  }
  // A closed run whose images are deleted has nothing to show in a cell: one
  // chip stands for all of them, as on the stage.
  const expired = cells.every((cell) => !cell.candidate && !cell.reference);
  if (expired) {
    return (
      <Well className={cx("grid min-h-0 min-w-0 flex-1 place-items-center", className)}>
        <StateChip state={{ kind: "expired" }} />
      </Well>
    );
  }
  return (
    <div className={cx("@container flex min-h-0 min-w-0 flex-1", barClearance, className)}>
      <div
        ref={setGrid}
        className={cx("flex min-h-0 min-w-0 flex-1", scrolls && "overflow-y-auto")}
      >
        <ButtonGroup
          aria-label="All variants"
          $layout="none"
          $p="none"
          $gap="sm"
          className={cx(
            "grid w-full flex-1",
            columnClasses[getDefaultColumns(cells.length)],
            // More than nine cells scroll. Each row is at least 14em, and the
            // rows share the cover when all of them fit.
            scrolls
              ? "min-h-full auto-rows-[minmax(14em,1fr)]"
              : "min-h-0 auto-rows-fr @max-xl:auto-rows-auto @max-xl:overflow-y-auto",
          )}
          style={
            columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined
          }
        >
          {cells.map((cell) => (
            <Cell
              key={cell.key}
              item={item}
              variant={cell}
              selected={cell.key === variant?.key}
              side={side}
              mask={mask}
              fixedHeight={scrolls}
              onOpen={onOpen}
            />
          ))}
          <ButtonGlider />
          <ButtonGlider $state="hover" />
          <ButtonGlider $state="focus" />
        </ButtonGroup>
      </div>
    </div>
  );
}
