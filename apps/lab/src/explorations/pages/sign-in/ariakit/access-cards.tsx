import { cx } from "clava";
import { ArrowUpRight, Check, Copy, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Badge,
  BadgeLabel,
  BadgeSlot,
} from "../../../../components/ariakit/components/badge.ariakit.react.tsx";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { Code } from "../../../../components/ariakit/components/code.ariakit.react.tsx";
import { Heading } from "../../../../components/ariakit/components/heading.ariakit.react.tsx";
import { ProgressCircular } from "../../../../components/ariakit/components/progress.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import type { User } from "../../../../fixtures/index.ts";
import { AvatarContent, IconButton } from "../../../kits/ariakit/controls.tsx";
import { ShortcutSlot } from "../../../kits/ariakit/keys.tsx";
import { getExternalLinkProps } from "../../../kits/ariakit/shell.tsx";
import { Sheet } from "../../../kits/ariakit/surfaces.tsx";
import { iconStroke, secondary, tertiary } from "../../../kits/ariakit/tokens.ts";
import { cardClassName } from "./guest-card.tsx";

export interface ForbiddenCardProps {
  /** The refused account. Absent in the `today` data mode. */
  user?: User;
  repository?: string;
  /** The message of the service. */
  message?: string;
  onSwitchAccount(): void;
}

/**
 * The account has no write access. The refused account is named first, so
 * that the person sees which one GitHub gave. The main action is to use
 * another account. Its button has the focus, so Enter presses it.
 */
export function ForbiddenCard({ user, repository, message, onSwitchAccount }: ForbiddenCardProps) {
  const githubUrl = repository ? `https://github.com/${repository}` : "https://github.com";
  return (
    <Sheet $p="1.5rem" render={<main />} className={cardClassName}>
      {user && (
        <Badge $forceRounded className="justify-self-start">
          <BadgeSlot $kind="avatar" $layer="brand">
            <AvatarContent user={user} />
          </BadgeSlot>
          <BadgeLabel>@{user.login}</BadgeLabel>
        </Badge>
      )}
      <div className="grid gap-1">
        <Heading className="mt-0 mb-0 text-xl font-semibold">No write access</Heading>
        {message && (
          <Text className={secondary} render={<p />}>
            {message}
          </Text>
        )}
      </div>
      <div className="grid gap-2">
        <Button
          $kind="bevel"
          $layer="brand"
          $rounded="lg"
          $p={3}
          autoFocus
          onClick={onSwitchAccount}
          className="w-full"
        >
          <ButtonLabel className="flex-1 text-start">Use another account</ButtonLabel>
          <ShortcutSlot keys={["↵"]} />
        </Button>
        <Button
          $rounded="lg"
          $p={3}
          render={<a {...getExternalLinkProps(githubUrl)} />}
          className="w-full"
        >
          <ButtonLabel className="flex-1 text-start">Back to GitHub</ButtonLabel>
          <ButtonSlot $size="sm">
            <ArrowUpRight strokeWidth={iconStroke} />
          </ButtonSlot>
        </Button>
      </div>
    </Sheet>
  );
}

export interface ErrorCardProps {
  message?: string;
  /** The support reference of the failed request. */
  reference?: string;
  retrying: boolean;
  onRetry(): void;
}

/**
 * The service did not answer. The message of the server, the reference as a
 * copyable chip, and one action that tries again.
 */
export function ErrorCard({ message, reference, retrying, onRetry }: ErrorCardProps) {
  return (
    <Sheet $p="1.5rem" render={<main />} className={cardClassName}>
      <Text $text="danger" className="flex" aria-hidden>
        <TriangleAlert strokeWidth={iconStroke} className="size-6" />
      </Text>
      <div className="grid gap-1">
        <Heading className="mt-0 mb-0 text-xl font-semibold">Sign-in is unavailable</Heading>
        {message && (
          <Text className={secondary} render={<p />}>
            {message}
          </Text>
        )}
      </div>
      {reference && <ErrorReference reference={reference} />}
      <Button
        $kind="bevel"
        $layer="brand"
        $rounded="lg"
        $p={3}
        autoFocus
        // Busy, not disabled: the button keeps its surface while it retries.
        aria-busy={retrying || undefined}
        onClick={retrying ? undefined : onRetry}
        className="w-full"
      >
        <ButtonSlot>
          {retrying ? (
            <ProgressCircular aria-label="Retrying" />
          ) : (
            <RefreshCw strokeWidth={iconStroke} />
          )}
        </ButtonSlot>
        <ButtonLabel className="flex-1 text-start">Try again</ButtonLabel>
        {!retrying && <ShortcutSlot keys={["↵"]} />}
      </Button>
    </Sheet>
  );
}

interface ErrorReferenceProps {
  reference: string;
}

function ErrorReference({ reference }: ErrorReferenceProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timeout);
  }, [copied]);
  const copy = () => {
    // The clipboard needs a secure context. Without it nothing is copied and
    // the button keeps its icon.
    navigator.clipboard?.writeText(reference).then(
      () => setCopied(true),
      () => {},
    );
  };
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Text className={cx(tertiary, "flex-none text-xs")}>Error ID</Text>
      <Code className="min-w-0 truncate">{reference}</Code>
      <IconButton
        label={copied ? "Copied" : "Copy Error ID"}
        $size="sm"
        icon={copied ? <Check strokeWidth={iconStroke} /> : <Copy strokeWidth={iconStroke} />}
        onClick={copy}
      />
    </div>
  );
}
