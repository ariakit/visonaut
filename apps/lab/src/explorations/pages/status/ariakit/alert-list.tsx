import { cx } from "clava";
import { ArrowUpRight, CircleAlert, TriangleAlert } from "lucide-react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import {
  Disclosure,
  DisclosureButton,
  DisclosureButtonSlot,
  DisclosureGroup,
} from "../../../../components/ariakit/components/disclosure.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import type { StatusAlert } from "../../../../fixtures/hooks/index.ts";
import { formatDateTime, formatRelativeTime } from "../../../../fixtures/index.ts";
import { formatAge } from "../../../kits/ariakit/runs.tsx";
import { getExternalLinkProps } from "../../../kits/ariakit/shell.tsx";
import { iconStroke, markStroke, mono, secondary, tertiary } from "../../../kits/ariakit/tokens.ts";
import { formatSubject } from "./format.ts";

export interface AlertListProps {
  /** Sorted by severity, then by the last time that the service saw them. */
  alerts: readonly StatusAlert[];
  guideUrl: string;
  className?: string;
}

/**
 * One native disclosure for each alert: the row shows the title, the affected
 * record, how often, and when. The content gives what a maintainer loses, what
 * to do, and the guide. The list is read-only, so Tab, Enter, and Space are
 * the whole interaction.
 */
export function AlertList({ alerts, guideUrl, className }: AlertListProps) {
  return (
    <DisclosureGroup $cover $p="1rem" className={className}>
      {alerts.map((alert) => (
        <AlertRow key={alert.id} alert={alert} guideUrl={guideUrl} />
      ))}
    </DisclosureGroup>
  );
}

interface AlertRowProps {
  alert: StatusAlert;
  guideUrl: string;
}

function AlertRow({ alert, guideUrl }: AlertRowProps) {
  const critical = alert.severity === "critical";
  const Icon = critical ? TriangleAlert : CircleAlert;
  const subject = formatSubject(alert.subject);
  const lastSeen = formatRelativeTime(alert.lastSeenAt);
  const occurrences = alert.occurrences == null ? null : `${alert.occurrences}×`;
  return (
    <Disclosure
      button={
        <DisclosureButton
          icon={
            <Text
              $text={critical ? "danger" : "warning"}
              role="img"
              aria-label={critical ? "Critical" : "Warning"}
              render={<Icon strokeWidth={markStroke} />}
            />
          }
          label={{
            className: "min-w-0 flex-1",
            children: (
              <span className="grid">
                {alert.title}
                {/* On a narrow page the facts go under the title. */}
                <span className={cx(secondary, "@3xl/shell:hidden")}>
                  {[subject, occurrences, lastSeen].filter(Boolean).join(" · ")}
                </span>
              </span>
            ),
          }}
        >
          <Text
            title={alert.subject}
            className={cx(mono, tertiary, "flex-none whitespace-nowrap @max-3xl/shell:hidden")}
          >
            {subject}
          </Text>
          {/* The count and the time have a width of their own, so the three
              facts of every row end in three lines. */}
          {occurrences && (
            <span className="flex w-[3.75em] flex-none justify-end @max-3xl/shell:hidden">
              <DisclosureButtonSlot
                $kind="badge"
                $p="md"
                $layer
                $lightnessOffset={2}
                aria-label={`${alert.occurrences} occurrences`}
                className="flex-none tabular-nums"
              >
                {occurrences}
              </DisclosureButtonSlot>
            </span>
          )}
          <Text
            className={cx(
              tertiary,
              "w-[6ch] flex-none text-end whitespace-nowrap tabular-nums @max-3xl/shell:hidden",
            )}
            render={
              <time
                dateTime={new Date(alert.lastSeenAt).toISOString()}
                title={formatDateTime(alert.lastSeenAt)}
              />
            }
          >
            {formatAge(alert.lastSeenAt)}
          </Text>
        </DisclosureButton>
      }
    >
      <div className="grid justify-items-start gap-2">
        {alert.impact && <Text className="font-medium">{alert.impact}</Text>}
        <Text className={secondary}>{alert.action}</Text>
        <Text className={cx(tertiary, "text-xs")}>
          First seen {formatDateTime(alert.firstSeenAt)}
        </Text>
        <Button $size="sm" $border render={<a {...getExternalLinkProps(guideUrl)} />}>
          <ButtonLabel>Open guide</ButtonLabel>
          <ButtonSlot>
            <ArrowUpRight strokeWidth={iconStroke} />
          </ButtonSlot>
        </Button>
      </div>
    </Disclosure>
  );
}
