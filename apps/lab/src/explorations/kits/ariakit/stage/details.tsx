// The Details button of the variant row: every other fact of the selected
// variant in one popover, with the lines of a bug report to copy.

import * as ak from "@ariakit/react";
import { cx } from "clava";
import { ArrowUpRight, Check, Copy, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { Link } from "../../../../components/ariakit/components/link.ariakit.react.tsx";
import {
  Popover,
  PopoverDisclosure,
  PopoverProvider,
} from "../../../../components/ariakit/components/popover.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import type { ReviewItem, ReviewRun, ReviewVariant } from "../../../../fixtures/index.ts";
import { getExternalLinkProps } from "../shell.tsx";
import { statusStyles, StatusGlyph } from "../status.tsx";
import { iconStroke, mono, overlayRoot, tertiary } from "../tokens.ts";
import { getDetails } from "./details-model.ts";
import type { DecisionFacts, DetailsFacts } from "./details-model.ts";

/** Milliseconds that the copy button shows its result. */
const resultDuration = 1600;

type CopyResult = "copied" | "failed";

const resultLabels: Record<CopyResult, string> = {
  copied: "Copied",
  failed: "Copy failed",
};

async function writeText(text: string): Promise<CopyResult> {
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    // The browser blocks the clipboard without permission, and it has none on
    // a page that is not served over a secure connection.
    return "failed";
  }
}

interface CopyButtonProps {
  /** Runs at the click, because the text is long. */
  getText(): string;
  children: string;
}

/**
 * A neutral button that copies a text. The label becomes the result for
 * 1.6 s, and the button keeps the width of its longest label.
 */
function CopyButton({ getText, children }: CopyButtonProps) {
  const [result, setResult] = useState<CopyResult | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const copy = () => {
    void writeText(getText()).then((next) => {
      if (!mounted.current) return;
      setResult(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setResult(null), resultDuration);
    });
  };
  let icon = <Copy strokeWidth={iconStroke} />;
  if (result === "copied") {
    icon = <Check strokeWidth={iconStroke} />;
  } else if (result === "failed") {
    icon = <X strokeWidth={iconStroke} />;
  }
  let color: "success" | "danger" | undefined;
  if (result) {
    color = result === "copied" ? "success" : "danger";
  }
  return (
    <>
      <Button
        $size="sm"
        $lightnessOffset
        $forceRounded
        $text={color}
        onClick={copy}
        className="justify-self-start"
      >
        <ButtonSlot>{icon}</ButtonSlot>
        <ButtonLabel className="grid text-start">
          <span className={cx("col-start-1 row-start-1", result && "invisible")}>{children}</span>
          <span className={cx("col-start-1 row-start-1", !result && "invisible")}>
            {resultLabels[result ?? "copied"]}
          </span>
        </ButtonLabel>
      </Button>
      <span role="status" className="sr-only">
        {result ? resultLabels[result] : ""}
      </span>
    </>
  );
}

interface FactProps {
  label: string;
  children: ReactNode;
}

function Fact({ label, children }: FactProps) {
  return (
    <>
      <Text render={<dt />} className={tertiary}>
        {label}
      </Text>
      <dd className="min-w-0 wrap-anywhere tabular-nums">{children}</dd>
    </>
  );
}

interface FactsProps {
  details: DetailsFacts;
}

function SizeValue({ details }: FactsProps) {
  const { size } = details;
  if (!size) return null;
  if (!size.from) {
    return (
      <>
        {size.text}
        {size.baselineOnly && <Text className={tertiary}> (baseline)</Text>}
      </>
    );
  }
  // The new size and its difference stay together, so a narrow popover breaks
  // the value before the arrow.
  return (
    <>
      {size.from}{" "}
      <span className="whitespace-nowrap">
        → {size.text} <Text $text="warning">({size.delta})</Text>
      </span>
    </>
  );
}

interface DecisionLineProps {
  decision: DecisionFacts;
}

/** The decision as its glyph and its word, with the reviewer and the time. */
function DecisionLine({ decision }: DecisionLineProps) {
  return (
    <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-1.5">
      <span className="flex h-lh items-center">
        <StatusGlyph status={decision.status} decorative />
      </span>
      <span>{statusStyles[decision.status].label}</span>
      {decision.attribution && (
        <Text className={cx(tertiary, "col-start-2")}>{decision.attribution}</Text>
      )}
    </span>
  );
}

function FactList({ details }: FactsProps) {
  const { state, size, tolerance, engine, decision, run } = details;
  const measured = state !== "failed" && state !== "expired";
  return (
    // The label column is as wide as `Compared with` in every state, also in
    // a state without that row, so the values stay in place when the
    // selection changes.
    <dl className="grid grid-cols-[minmax(7.25em,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
      {measured && <Fact label="Changed">{details.changed}</Fact>}
      {state === "expired" && <Fact label="Images">Deleted</Fact>}
      {size && (
        <Fact label="Size">
          <SizeValue details={details} />
        </Fact>
      )}
      {details.notUploaded && <Fact label="Current">Not uploaded</Fact>}
      {tolerance && <Fact label="Tolerance">{tolerance.join(" · ")}</Fact>}
      {/* The version is in the copied text. The name answers the reviewer. */}
      {engine && <Fact label="Compared with">{engine}</Fact>}
      {decision && (
        <Fact label="Decision">
          <DecisionLine decision={decision} />
        </Fact>
      )}
      <Fact label="Commit">
        <Link
          {...getExternalLinkProps(run.commitUrl)}
          aria-label={`Commit ${run.shortSha} on GitHub`}
          className={cx(mono, "inline-flex items-center gap-0.5")}
        >
          {run.shortSha}
          <ArrowUpRight aria-hidden strokeWidth={iconStroke} className="size-[1.1em] flex-none" />
        </Link>
      </Fact>
    </dl>
  );
}

export interface DetailsButtonProps {
  /** The run of the variant, for its commit and for the state of its images. */
  review: Pick<ReviewRun, "run" | "imagesExpired">;
  item: Pick<ReviewItem, "key">;
  variant: ReviewVariant;
}

/**
 * The button `Details` with its popover: how much changed, the size, the
 * tolerance, the engine, the decision, and the commit, with `Copy debug
 * info`. Every fact that the variant row and the stage do not show is here.
 * It has no key.
 * @example
 * <DetailsButton review={session.review} item={session.item} variant={session.variant} />
 */
export function DetailsButton({ review, item, variant }: DetailsButtonProps) {
  const store = ak.usePopoverStore({ placement: "bottom-end" });
  const open = ak.useStoreState(store, "open");
  const details = getDetails({ review, item, variant });
  return (
    <PopoverProvider store={store}>
      <PopoverDisclosure $size="sm" $lightnessOffset={open ? 2 : true}>
        <ButtonSlot>
          <Info strokeWidth={iconStroke} />
        </ButtonSlot>
        <ButtonLabel>Details</ButtonLabel>
      </PopoverDisclosure>
      <Popover
        portal
        unmountOnHide
        $rounded="xl"
        $p={3}
        aria-label="Details"
        className={cx(overlayRoot, "grid w-88 max-w-[calc(100vw-2rem)] gap-3")}
      >
        {details.failure && (
          <div className="flex gap-2">
            <Text $text="danger" className="flex h-lh flex-none items-center">
              <TriangleAlert aria-hidden strokeWidth={iconStroke} className="size-[1.15em]" />
            </Text>
            <Text render={<p />}>{details.failure.join(" ")}</Text>
          </div>
        )}
        <FactList details={details} />
        <CopyButton getText={details.getDebugText}>Copy debug info</CopyButton>
      </Popover>
    </PopoverProvider>
  );
}
