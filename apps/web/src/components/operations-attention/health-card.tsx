import { cx } from "clava";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Frame } from "../ariakit/components/frame.ariakit.react.tsx";
import { Heading, HeadingLevel } from "../ariakit/components/heading.ariakit.react.tsx";
import { Text } from "../ariakit/components/text.ariakit.react.tsx";
import { MoreInfo } from "../kit/controls.tsx";
import { formatCount, formatDateTime } from "../kit/format.ts";
import { markStroke, tertiary } from "../kit/tokens.ts";
import { AlertList } from "./alert-list.tsx";
import { formatCheckAge } from "./format.ts";
import type { StatusAlert } from "./status-data.ts";

interface CheckAgeProps {
  /** The time of the read, on the clock of this machine. */
  readAt: number;
}

// The age of the last read. It counts seconds, so it renders each second.
// Give it the read time as its key: a new read then starts at the present.
function CheckAge({ readAt }: CheckAgeProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Text
      className={cx(
        tertiary,
        "text-xs tabular-nums @max-3xl/shell:order-last @max-3xl/shell:basis-full",
      )}
      render={<time dateTime={new Date(readAt).toISOString()} title={formatDateTime(readAt)} />}
    >
      Checked {formatCheckAge(readAt, now)}
    </Text>
  );
}

export interface HealthCardProps {
  alerts: readonly StatusAlert[];
  /** True when the service has more alerts than it returned. */
  hasMore: boolean;
  /** The time of the read, on the clock of this machine. */
  readAt: number;
}

/**
 * The whole page in one card: a tint of the health color with the verdict, the
 * time of the last check, and the alerts as disclosures. A healthy service
 * shows the verdict alone. The card has no refresh button: the page reads the
 * alerts again each minute.
 *
 * The API has no severity, so each alert is a warning, and the card is never
 * in the danger color.
 */
export function HealthCard({ alerts, hasMore, readAt }: HealthCardProps) {
  const healthy = alerts.length === 0;
  const role = healthy ? "success" : "warning";
  const Icon = healthy ? CircleCheck : CircleAlert;
  return (
    <Frame
      $layer={role}
      $mix={15}
      $border
      $edge={role}
      $rounded="2xl"
      $p="1rem"
      render={<section aria-label="Service health" />}
      className="grid min-w-0 gap-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Text $text={role} role="img" aria-label={healthy ? "Healthy" : "Warning"} className="flex">
          <Icon strokeWidth={markStroke} className="size-[1.5em]" />
        </Text>
        <Heading className="mt-0 mb-0 min-w-0 flex-1 text-lg font-semibold">
          {healthy ? "All systems normal" : formatCount(alerts.length, "alert")}
        </Heading>
        <CheckAge key={readAt} readAt={readAt} />
        <MoreInfo heading="About this page" placement="bottom-end">
          Alerts refresh each minute while this page is open. No notifications are sent. The list
          shows open alerts only; it does not certify every dependency.
        </MoreInfo>
      </div>
      {!healthy && (
        // The verdict is the heading of the page, and each alert is one level
        // below it.
        <HeadingLevel>
          <AlertList alerts={alerts} className={cx(hasMore && "max-h-96 overflow-auto")} />
        </HeadingLevel>
      )}
      {hasMore && (
        <Text className={cx(tertiary, "text-xs")}>
          {formatCount(alerts.length)} shown · more exist
        </Text>
      )}
    </Frame>
  );
}
