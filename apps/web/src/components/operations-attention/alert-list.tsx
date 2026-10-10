import { Heading } from "@ariakit/react";
import { cx } from "clava";
import { ArrowUpRight, CircleAlert } from "lucide-react";
import { Button, ButtonLabel, ButtonSlot } from "../ariakit/components/button.ariakit.react.tsx";
import {
  Disclosure,
  DisclosureButton,
  DisclosureContent,
  DisclosureGroup,
} from "../ariakit/components/disclosure.ariakit.react.tsx";
import { Text } from "../ariakit/components/text.ariakit.react.tsx";
import { formatDateTime, formatRelativeTime } from "../kit/format.ts";
import { getExternalLinkProps } from "../kit/shell.tsx";
import { iconStroke, markStroke, mono, secondary, tertiary } from "../kit/tokens.ts";
import { getGuideUrl } from "./alert-texts.ts";
import { formatAge, formatSubject } from "./format.ts";
import type { StatusAlert } from "./status-data.ts";

export interface AlertListProps {
  alerts: readonly StatusAlert[];
  className?: string;
}

/**
 * One disclosure for each alert: the row shows the title, the affected
 * record, and when the service saw the cause. The content says what to do. It
 * has a link to the operations guide only when the guide has a procedure for
 * the alert. The list is read-only, so Tab, Enter, and Space are the whole
 * interaction.
 */
export function AlertList({ alerts, className }: AlertListProps) {
  return (
    <DisclosureGroup $cover $p="1rem" className={className}>
      {alerts.map((alert) => (
        <AlertRow key={alert.id} alert={alert} />
      ))}
    </DisclosureGroup>
  );
}

interface AlertRowProps {
  alert: StatusAlert;
}

function AlertRow({ alert }: AlertRowProps) {
  const subject = alert.subject == null ? null : formatSubject(alert.subject);
  const lastSeen = alert.seenAt == null ? null : formatRelativeTime(alert.seenAt);
  return (
    // The heading is between the root and the button, so the root cannot
    // find the leading icon by itself.
    <Disclosure $leadingIcon>
      {/* A button hides the role of its content, so the heading is around
          the button. It is a grid, so the button keeps the row width. */}
      <Heading className="grid min-w-0">
        <DisclosureButton
          icon={
            <Text
              $text="warning"
              role="img"
              aria-label="Warning"
              render={<CircleAlert strokeWidth={markStroke} />}
            />
          }
          label={{
            className: "min-w-0 flex-1",
            children: (
              <span className="grid">
                {alert.title}
                {/* On a narrow page the facts go under the title. */}
                <span className={cx(secondary, "@3xl/shell:hidden")}>
                  {[subject, lastSeen].filter(Boolean).join(" · ")}
                </span>
              </span>
            ),
          }}
        >
          {subject != null && (
            <Text
              title={alert.subject}
              className={cx(mono, tertiary, "flex-none whitespace-nowrap @max-3xl/shell:hidden")}
            >
              {subject}
            </Text>
          )}
          {alert.seenAt != null && (
            <Text
              className={cx(
                tertiary,
                "w-[6ch] flex-none text-end whitespace-nowrap tabular-nums @max-3xl/shell:hidden",
              )}
              render={
                <time
                  dateTime={new Date(alert.seenAt).toISOString()}
                  title={formatDateTime(alert.seenAt)}
                />
              }
            >
              {formatAge(alert.seenAt)}
            </Text>
          )}
        </DisclosureButton>
      </Heading>
      <DisclosureContent>
        <div className="grid justify-items-start gap-2">
          <Text className={secondary}>{alert.action}</Text>
          {alert.firstSeenAt != null && (
            <Text className={cx(tertiary, "text-xs")}>
              First seen {formatDateTime(alert.firstSeenAt)}
            </Text>
          )}
          {/* The words that find the alert in the database and in the guide. */}
          {alert.record && (
            <Text className={cx(mono, tertiary, "text-xs wrap-anywhere")}>{alert.record}</Text>
          )}
          {alert.guide && (
            <Button
              $size="sm"
              $border
              render={<a {...getExternalLinkProps(getGuideUrl(alert.guide))} />}
            >
              <ButtonLabel>Open guide</ButtonLabel>
              <ButtonSlot>
                <ArrowUpRight strokeWidth={iconStroke} />
              </ButtonSlot>
            </Button>
          )}
        </div>
      </DisclosureContent>
    </Disclosure>
  );
}
