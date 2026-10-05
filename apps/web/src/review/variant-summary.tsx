import { BanIcon, ContrastIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  ButtonContent,
  ButtonLabel,
  ButtonSlot,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import chromeIcon from "./icons/chrome.svg";
import firefoxIcon from "./icons/firefox.svg";
import reactIcon from "./icons/react.svg";
import safariIcon from "./icons/safari.svg";
import solidIcon from "./icons/solid.svg";
import type { ReviewVariant, ReviewVariantPart } from "./model.ts";

const icons: Record<string, ReactNode> = {
  react: <img src={reactIcon} alt="" className="size-full object-contain" />,
  solid: <img src={solidIcon} alt="" className="size-full object-contain" />,
  chrome: <img src={chromeIcon} alt="" className="size-full object-contain" />,
  chromium: <img src={chromeIcon} alt="" className="size-full object-contain" />,
  firefox: <img src={firefoxIcon} alt="" className="size-full object-contain" />,
  safari: <img src={safariIcon} alt="" className="size-full object-contain" />,
  webkit: <img src={safariIcon} alt="" className="size-full object-contain" />,
  light: <SunIcon />,
  dark: <MoonIcon />,
  "no-preference": <MonitorIcon />,
  contrast: <ContrastIcon />,
  none: <BanIcon />,
};

const iconValuesByKind: Record<ReviewVariantPart["kind"], readonly string[]> = {
  framework: ["react", "solid"],
  browser: ["chrome", "chromium", "firefox", "safari", "webkit"],
  colorScheme: ["light", "dark", "no-preference"],
  contrast: ["no-preference"],
  forcedColors: ["none"],
  key: [],
};

function iconForPart(part: { value: string; kind?: ReviewVariantPart["kind"] }) {
  const key = part.value.toLowerCase();
  if (part.kind && !iconValuesByKind[part.kind].includes(key)) return;
  return Object.hasOwn(icons, key) ? icons[key] : undefined;
}

function tooltipForPart(part: string, kind?: ReviewVariantPart["kind"]) {
  const key = part.toLowerCase();
  if (key === "none" && kind === "forcedColors") return "Forced colors: none";
  if (key === "no-preference" && kind === "colorScheme") return "Color scheme: no preference";
  if (key === "no-preference" && kind === "contrast") return "Contrast: no preference";
  return part;
}

function labelForPart(part: string) {
  const key = part.toLowerCase();
  if (key === "webkit") return "WebKit";
  if (key === "no-preference") return "System";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

interface VariantSummaryProps {
  variant: ReviewVariant;
  index: number;
  showFramework?: boolean;
}

export function VariantSummary({ variant, index, showFramework = true }: VariantSummaryProps) {
  const sourceParts =
    variant.labelParts ?? variant.label.split(" · ").map((value) => ({ value, kind: undefined }));
  const seen = new Set<string>();
  const parts = sourceParts.filter((part) => {
    const identity = `${part.kind}:${part.value.toLowerCase()}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    if (!showFramework && part.kind === "framework" && iconForPart(part)) return false;
    return true;
  });
  const visibleLabels = new Set(
    parts
      .filter(
        (part) => iconForPart(part) && part.kind !== "contrast" && part.kind !== "forcedColors",
      )
      .map((part) => labelForPart(part.value).toLowerCase()),
  );
  const title = parts
    .filter((part) => !iconForPart(part) && !visibleLabels.has(part.value.toLowerCase()))
    .map((part) => part.value)
    .join(" · ");
  return (
    <ButtonContent
      $orientation="horizontal"
      className="review-variant-summary flex-nowrap! items-center gap-3! min-w-0"
    >
      <span
        className="review-variant-icons inline-flex shrink-0 items-center gap-2.5 empty:hidden [--control-inline:0]"
        aria-hidden="true"
      >
        {parts.map((part, partIndex) => {
          const icon = iconForPart(part);
          return icon ? (
            <span
              key={partIndex}
              title={tooltipForPart(part.value, part.kind)}
              className="inline-flex shrink-0 items-center gap-1.5"
            >
              <ButtonSlot $size="md">{icon}</ButtonSlot>
              {part.kind !== "contrast" && part.kind !== "forcedColors" && (
                <ButtonLabel $truncate={false} className="text-xs">
                  {labelForPart(part.value)}
                </ButtonLabel>
              )}
            </span>
          ) : null;
        })}
      </span>
      {title && (
        <ButtonLabel
          className="review-variant-title min-w-0 max-w-48 truncate text-xs"
          aria-hidden="true"
          title={title}
        >
          {title}
        </ButtonLabel>
      )}
      {index < 6 && (
        <ButtonSlot
          $kind="shortcut"
          $size="sm"
          className="review-variant-index shrink-0 text-[10px] tabular-nums ak-ink-40"
          aria-hidden="true"
        >
          {index + 1}
        </ButtonSlot>
      )}
      <span className="sr-only">{variant.label}</span>
    </ButtonContent>
  );
}
