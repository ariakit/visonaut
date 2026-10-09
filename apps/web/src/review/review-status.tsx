import { Check, Circle, CircleAlert, Clock3, Minus, X } from "lucide-react";
import {
  Badge,
  BadgeLabel,
  BadgeSlot,
} from "../components/ariakit/components/badge.ariakit.react.tsx";
import type { ReviewVariant } from "./model.ts";
import { verdictLabel } from "./navigation.ts";

export function ReviewStatus({ variant }: { variant: ReviewVariant }) {
  const color =
    variant.kind === "error" || variant.verdict === "rejected"
      ? "danger"
      : variant.verdict === "approved"
        ? "success"
        : variant.kind === "unchanged"
          ? true
          : "warning";
  const Icon =
    variant.kind === "error"
      ? CircleAlert
      : variant.kind === "pending"
        ? Clock3
        : variant.kind === "unchanged"
          ? Minus
          : variant.verdict === "approved"
            ? Check
            : variant.verdict === "rejected"
              ? X
              : Circle;
  return (
    <Badge $layer={color} $p={2} $rounded="full" $forceRounded className="whitespace-nowrap">
      <BadgeSlot>
        <Icon />
      </BadgeSlot>
      <BadgeLabel>{verdictLabel(variant)}</BadgeLabel>
    </Badge>
  );
}
