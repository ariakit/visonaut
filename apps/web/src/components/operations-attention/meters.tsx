import { cx } from "clava";
import { Frame } from "../ariakit/components/frame.ariakit.react.tsx";
import { Progress } from "../ariakit/components/progress.ariakit.react.tsx";
import { Text } from "../ariakit/components/text.ariakit.react.tsx";
import { formatCount, formatDateTime, formatRelativeTime } from "../kit/format.ts";
import { Sheet } from "../kit/surfaces.tsx";
import { secondary, tertiary } from "../kit/tokens.ts";
import { formatLimit, formatMebibytes } from "./format.ts";
import { captureWarningRatio, staleSampleAge, type OperationsStatus } from "./status-data.ts";

export interface MetersProps {
  status: Pick<OperationsStatus, "capacity" | "captures" | "checkedAt">;
}

/**
 * The numbers that explain most alerts: how full the database is, how many
 * captures run, and how near the largest run is to the screenshot limit. Each
 * is a stat card with one `Progress`. A bar turns warning color above its
 * warning value, and a 2 px marker shows where that value is.
 *
 * The first two numbers are the sample of the last scheduled pass. The line
 * under the cards has its time: an old sample shows a stopped scheduler.
 */
export function Meters({ status }: MetersProps) {
  const { capacity, captures, checkedAt } = status;
  if (!capacity && !captures) return null;
  const stale = capacity ? checkedAt - capacity.observedAt > staleSampleAge : false;
  // The sample has two numbers, and the largest run is the third.
  const columns = capacity
    ? captures
      ? "@3xl/shell:grid-cols-3"
      : "@3xl/shell:grid-cols-2"
    : undefined;
  return (
    <div className="grid min-w-0 gap-2">
      <div className={cx("grid gap-4", columns)}>
        {capacity && (
          <>
            <Meter
              label="Database"
              value={`${formatMebibytes(capacity.databaseBytes)} of ${formatLimit(capacity.databaseAdmissionBytes)} MiB`}
              ratio={capacity.databaseBytes / capacity.databaseAdmissionBytes}
              marker={capacity.databaseWarningBytes / capacity.databaseAdmissionBytes}
              tone={capacity.databaseBytes >= capacity.databaseWarningBytes ? "warning" : "brand"}
              note={`Warns at ${formatLimit(capacity.databaseWarningBytes)} MiB`}
            />
            <Meter
              label="Captures"
              value={`${formatCount(capacity.activeRuns)} of ${formatCount(capacity.maximumActiveRuns)} running`}
              ratio={capacity.activeRuns / capacity.maximumActiveRuns}
              tone="brand"
            />
          </>
        )}
        {captures && (
          <Meter
            label="Largest run"
            value={`${formatCount(captures.count)} of ${formatCount(captures.limit)}`}
            valueText={`${formatCount(captures.count)} of ${formatCount(captures.limit, "screenshot")}`}
            ratio={captures.count / captures.limit}
            marker={captureWarningRatio}
            tone={captures.count >= captures.limit * captureWarningRatio ? "warning" : "brand"}
            note={`Warns at ${formatCount(Math.ceil(captures.limit * captureWarningRatio), "screenshot")}`}
          />
        )}
      </div>
      {capacity && (
        <Text
          render={<p />}
          $text={stale ? "warning" : undefined}
          className={cx(!stale && tertiary, "text-xs")}
        >
          Database and captures sampled{" "}
          <time
            dateTime={new Date(capacity.observedAt).toISOString()}
            title={formatDateTime(capacity.observedAt)}
          >
            {formatRelativeTime(capacity.observedAt)}
          </time>
        </Text>
      )}
    </div>
  );
}

interface MeterProps {
  label: string;
  value: string;
  /** The value for a screen reader, when the card has the unit in its note. */
  valueText?: string;
  /** 0 to 1. */
  ratio: number;
  /** The place of a threshold on the track, 0 to 1. */
  marker?: number;
  tone: "brand" | "warning";
  note?: string;
}

function Meter({ label, value, valueText, ratio, marker, tone, note }: MeterProps) {
  return (
    <Sheet render={<section aria-label={label} />} className="grid content-start gap-3">
      {/* The note shares the line of the label, so the cards have the same
          height with and without a note. */}
      <div className="flex items-baseline justify-between gap-3">
        <Text className={cx(tertiary, "text-xs font-medium")}>{label}</Text>
        {note && <Text className={cx(secondary, "text-xs tabular-nums")}>{note}</Text>}
      </div>
      <Text className="text-lg font-semibold tabular-nums">{value}</Text>
      <div className="relative">
        <Progress
          aria-label={label}
          aria-valuetext={valueText ?? value}
          value={Math.min(1, ratio)}
          fill={{ $layer: tone }}
        />
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
