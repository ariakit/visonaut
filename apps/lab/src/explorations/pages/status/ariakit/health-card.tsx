import { cx } from "clava";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Frame } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import { Heading } from "../../../../components/ariakit/components/heading.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import { serviceHealthRoles } from "../../../../fixtures/hooks/index.ts";
import type { ServiceHealth, StatusReady } from "../../../../fixtures/hooks/index.ts";
import { formatCount, formatDateTime } from "../../../../fixtures/index.ts";
import { MoreInfo } from "../../../kits/ariakit/controls.tsx";
import { getRoleLayer } from "../../../kits/ariakit/status.tsx";
import { markStroke, tertiary } from "../../../kits/ariakit/tokens.ts";
import { AlertList } from "./alert-list.tsx";
import { formatCheckAge, sortAlerts } from "./format.ts";

const healthIcons = {
  healthy: CircleCheck,
  warning: CircleAlert,
  critical: TriangleAlert,
} as const;

const healthNames: Record<ServiceHealth, string> = {
  healthy: "Healthy",
  warning: "Warning",
  critical: "Critical",
};

export interface HealthCardProps {
  status: StatusReady;
}

/**
 * The whole page in one card: a tint of the health color with the verdict, the
 * time of the last check, and the alerts as disclosures. A healthy service
 * shows the verdict alone. The card has no refresh button: the page reads the
 * alerts again each minute.
 */
export function HealthCard({ status }: HealthCardProps) {
  const { health, alerts, checkedAt, hasMore, guideUrl } = status;
  const role = serviceHealthRoles[health];
  const Icon = healthIcons[health];
  const sorted = sortAlerts(alerts);
  return (
    <Frame
      $layer={getRoleLayer(role)}
      $mix={15}
      $border
      $edge={role === "neutral" ? undefined : role}
      $rounded="2xl"
      $p="1rem"
      render={<section aria-label="Service health" />}
      className="grid min-w-0 gap-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Text
          $text={role === "neutral" ? undefined : role}
          role="img"
          aria-label={healthNames[health]}
          className="flex"
        >
          <Icon strokeWidth={markStroke} className="size-[1.5em]" />
        </Text>
        <Heading className="mt-0 mb-0 min-w-0 flex-1 text-lg font-semibold">
          {sorted.length ? formatCount(sorted.length, "alert") : "All systems normal"}
        </Heading>
        <Text
          className={cx(
            tertiary,
            "text-xs tabular-nums @max-3xl/shell:order-last @max-3xl/shell:basis-full",
          )}
          render={
            <time dateTime={new Date(checkedAt).toISOString()} title={formatDateTime(checkedAt)} />
          }
        >
          Checked {formatCheckAge(checkedAt)}
        </Text>
        <MoreInfo heading="About this page" placement="bottom-end">
          Alerts refresh each minute while this page is open. No notifications are sent. The list
          shows open alerts only; it does not certify every dependency.
        </MoreInfo>
      </div>
      {sorted.length > 0 && (
        <AlertList
          alerts={sorted}
          guideUrl={guideUrl}
          className={cx(hasMore && "max-h-96 overflow-auto")}
        />
      )}
      {hasMore && (
        <Text className={cx(tertiary, "text-xs")}>
          {formatCount(sorted.length)} shown · more exist
        </Text>
      )}
    </Frame>
  );
}
