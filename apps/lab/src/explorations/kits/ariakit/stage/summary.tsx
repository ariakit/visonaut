// The numbers of a change in one quiet line: `0.19% · 292 px · 1 region`.
// The line has only the numbers of a comparison of pixels. The chip of the
// stage and the label of the image say that a variant is added, removed,
// resized, or still comparing, so the line does not repeat it.

import { cx } from "clava";
import { Fragment } from "react";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import {
  Tooltip,
  TooltipAnchor,
  TooltipProvider,
} from "../../../../components/ariakit/components/tooltip.ariakit.react.tsx";
import { focus } from "../../../../components/ariakit/styles/focus.ts";
import { formatCount } from "../../../../fixtures/index.ts";
import type { ChangedRegion, ReviewVariant } from "../../../../fixtures/index.ts";
import { useRegions } from "../regions.ts";
import { overlayRoot, secondary } from "../tokens.ts";

/** The fields of a variant that the line reads. */
export type ChangeSource = Pick<
  ReviewVariant,
  "kind" | "reference" | "candidate" | "diff" | "ratio" | "changedPixels" | "threshold" | "regions"
>;

export interface ChangeFact {
  id: "ratio" | "pixels" | "regions" | "tolerance";
  /** The short form, for example `292 px`. */
  text: string;
  /** The form for a screen reader, for example `292 pixels`. */
  words: string;
}

/** For example `0.19%`, `0.2%`, `38%`, or `< 0.01%`. */
export function formatChangeRatio(ratio: number) {
  const percent = ratio * 100;
  if (percent < 0.01) return "< 0.01%";
  if (percent >= 10) return `${Math.round(percent)}%`;
  // Two decimals, without the zeros at the end.
  return `${Number(percent.toFixed(2))}%`;
}

function sayRatio(ratio: number) {
  const percent = formatChangeRatio(ratio).replace("%", " percent changed");
  return percent.replace("< ", "less than ");
}

/**
 * At most three facts of a comparison of pixels, with the ratio first. A
 * missing number gives no fact: no dash and no zero stands in for it. The
 * result is empty for a variant without compared pixels: an added one, a
 * removed one, a size change, and one that is not compared yet.
 */
export function getChangeFacts(
  variant: ChangeSource,
  regions: readonly ChangedRegion[] | undefined,
): ChangeFact[] {
  const { kind, reference, candidate, ratio, changedPixels } = variant;
  const changed = kind === "changed" && !!variant.diff;
  // Pixels inside the tolerance are a comparison too, with no mask.
  const tolerated = kind === "unchanged" && !!changedPixels;
  if (!changed && !tolerated) return [];
  if (!reference || !candidate) return [];
  const facts: ChangeFact[] = [];
  if (ratio != null) {
    facts.push({ id: "ratio", text: formatChangeRatio(ratio), words: sayRatio(ratio) });
  }
  if (changedPixels != null) {
    facts.push({
      id: "pixels",
      text: `${formatCount(changedPixels)} px`,
      words: formatCount(changedPixels, "pixel"),
    });
  }
  if (tolerated) {
    facts.push({ id: "tolerance", text: "within tolerance", words: "within tolerance" });
    return facts;
  }
  // A changed pixel is always in a region, so an empty list is no fact.
  if (regions?.length) {
    const count = formatCount(regions.length, "region");
    facts.push({ id: "regions", text: count, words: count });
  }
  return facts;
}

/**
 * What stands behind the ratio, for a tooltip: the exact ratio of all pixels,
 * and the tolerance of the comparison. Each entry is one line.
 */
export function getChangeProof(variant: ChangeSource): string[] {
  const size = variant.candidate ?? variant.reference;
  const lines: string[] = [];
  if (variant.ratio != null && size) {
    const total = `${formatCount(size.width * size.height)} px`;
    lines.push(`${(variant.ratio * 100).toFixed(4)}% of ${total}`);
  }
  // The tolerance of production ends with a separator.
  const threshold = variant.threshold?.trim().replace(/;$/, "");
  if (threshold) {
    lines.push(threshold);
  }
  return lines;
}

interface FactTextProps {
  fact: ChangeFact;
}

/** The short form for the eye, and the words for a screen reader. */
function FactText({ fact }: FactTextProps) {
  return (
    <>
      <span aria-hidden>{fact.text}</span>
      <span className="sr-only">{fact.words}</span>
    </>
  );
}

export interface ChangeLineProps {
  /** The selected variant. Without one, the line renders nothing. */
  variant: ChangeSource | null | undefined;
  className?: string;
}

/**
 * The numbers of the change of one variant: the ratio, the changed pixels,
 * and the regions. The first fact has the exact numbers in a tooltip. It
 * renders nothing for a variant without compared pixels.
 * @example
 * <ChangeLine variant={session.variant} />
 */
export function ChangeLine({ variant, className }: ChangeLineProps) {
  const regions = useRegions(variant);
  if (!variant) return null;
  const [lead, ...rest] = getChangeFacts(variant, regions);
  if (!lead) return null;
  const proof = getChangeProof(variant);
  const leadClass = "ak-ink-100 font-medium whitespace-nowrap";
  return (
    <Text render={<p />} className={cx(secondary, "min-w-0 text-sm tabular-nums", className)}>
      {proof.length ? (
        <TooltipProvider placement="bottom">
          <TooltipAnchor
            render={<Text tabIndex={0} />}
            className={cx(leadClass, focus.class({ $focus: true, $focusOffset: 2 }), "cursor-help")}
          >
            <FactText fact={lead} />
          </TooltipAnchor>
          <Tooltip className={cx(overlayRoot, "grid gap-0.5 tabular-nums")}>
            {proof.map((line, index) => (
              <Text key={line} className={index ? secondary : undefined}>
                {line}
              </Text>
            ))}
          </Tooltip>
        </TooltipProvider>
      ) : (
        <Text className={leadClass}>
          <FactText fact={lead} />
        </Text>
      )}
      {rest.map((fact) => (
        <Fragment key={fact.id}>
          {/* The dot stays with the fact before it when the line wraps. */}
          <span aria-hidden className="ak-ink-40">
            {" · "}
          </span>
          <span className="sr-only">, </span>
          <span className="whitespace-nowrap">
            <FactText fact={fact} />
          </span>
        </Fragment>
      ))}
    </Text>
  );
}
