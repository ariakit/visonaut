import { cx } from "clava";
import type { ReactNode } from "react";
import { Frame } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import { Progress } from "../../../../components/ariakit/components/progress.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import type { ServiceCapacity } from "../../../../fixtures/index.ts";
import { Sheet } from "../../../kits/ariakit/surfaces.tsx";
import { secondary, tertiary } from "../../../kits/ariakit/tokens.ts";
import { formatLimit, formatMebibytes } from "./format.ts";

export interface MetersProps {
  capacity: ServiceCapacity;
}

/**
 * The two numbers that explain most alerts: how full the database is, and how
 * many captures run. Each is a stat card with one `Progress`. The database bar
 * turns warning color above its warning size, and a 2 px marker shows where
 * that size is.
 */
export function Meters({ capacity }: MetersProps) {
  const databaseRatio = capacity.databaseBytes / capacity.databaseAdmissionBytes;
  const warningRatio = capacity.databaseWarningBytes / capacity.databaseAdmissionBytes;
  const aboveWarning = capacity.databaseBytes >= capacity.databaseWarningBytes;
  return (
    <div className="grid gap-4 @3xl/shell:grid-cols-2">
      <Meter
        label="Database"
        value={
          <>
            {formatMebibytes(capacity.databaseBytes)} of{" "}
            {formatLimit(capacity.databaseAdmissionBytes)} MiB
          </>
        }
        ratio={databaseRatio}
        marker={warningRatio}
        tone={aboveWarning ? "warning" : "brand"}
        note={`Warns at ${formatLimit(capacity.databaseWarningBytes)} MiB`}
      />
      <Meter
        label="Captures"
        value={
          <>
            {capacity.activeRuns} of {capacity.maximumActiveRuns} running
          </>
        }
        ratio={capacity.activeRuns / capacity.maximumActiveRuns}
        tone="brand"
      />
    </div>
  );
}

interface MeterProps {
  label: string;
  value: ReactNode;
  /** 0 to 1. */
  ratio: number;
  /** The place of a threshold on the track, 0 to 1. */
  marker?: number;
  tone: "brand" | "warning";
  note?: string;
}

function Meter({ label, value, ratio, marker, tone, note }: MeterProps) {
  return (
    <Sheet render={<section aria-label={label} />} className="grid content-start gap-3">
      {/* The note shares the line of the label, so the two cards have the
          same height with and without a note. */}
      <div className="flex items-baseline justify-between gap-3">
        <Text className={cx(tertiary, "text-xs font-medium")}>{label}</Text>
        {note && <Text className={cx(secondary, "text-xs tabular-nums")}>{note}</Text>}
      </div>
      <Text className="text-lg font-semibold tabular-nums">{value}</Text>
      <div className="relative">
        <Progress aria-label={label} value={Math.min(1, ratio)} fill={{ $layer: tone }} />
        {marker != null && (
          <Frame
            $invert
            aria-hidden
            className="absolute -top-0.5 -bottom-0.5 w-0.5"
            style={{ insetInlineStart: `${marker * 100}%` }}
          />
        )}
      </div>
    </Sheet>
  );
}
