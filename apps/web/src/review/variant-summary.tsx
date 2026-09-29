import { BanIcon, ContrastIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import type { ReactNode } from "react";
import chromeIcon from "./icons/chrome.svg";
import firefoxIcon from "./icons/firefox.svg";
import reactIcon from "./icons/react.svg";
import safariIcon from "./icons/safari.svg";
import solidIcon from "./icons/solid.svg";
import type { ReviewVariant, ReviewVariantPart } from "./model.ts";

const icons: Record<string, ReactNode> = {
  react: <img src={reactIcon} alt="" width={14} height={14} />,
  solid: <img src={solidIcon} alt="" width={14} height={14} />,
  chrome: <img src={chromeIcon} alt="" width={14} height={14} />,
  chromium: <img src={chromeIcon} alt="" width={14} height={14} />,
  firefox: <img src={firefoxIcon} alt="" width={14} height={14} />,
  safari: <img src={safariIcon} alt="" width={14} height={14} />,
  webkit: <img src={safariIcon} alt="" width={14} height={14} />,
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

export function VariantSummary({ variant, index }: { variant: ReviewVariant; index: number }) {
  const parts =
    variant.labelParts ?? variant.label.split(" · ").map((value) => ({ value, kind: undefined }));
  const title = parts
    .filter((part) => !iconForPart(part))
    .map((part) => part.value)
    .join(" · ");
  return (
    <span className="review-variant-summary flex items-center gap-1.5 min-w-0">
      {variant.thumbnail && (
        <img className="review-variant-thumbnail" src={variant.thumbnail} alt="" loading="lazy" />
      )}
      <span className="review-variant-index text-xs tabular-nums" aria-hidden="true">
        {index + 1}
      </span>
      <span
        className="review-variant-icons inline-flex shrink-0 gap-1 [&_span]:inline-flex [&_svg]:size-3.5"
        aria-hidden="true"
      >
        {parts.map((part, partIndex) => {
          const icon = iconForPart(part);
          return icon ? (
            <span key={partIndex} title={tooltipForPart(part.value, part.kind)}>
              {icon}
            </span>
          ) : null;
        })}
      </span>
      {title && (
        <span
          className="review-variant-title min-w-0 truncate text-xs"
          aria-hidden="true"
          title={title}
        >
          {title}
        </span>
      )}
      <span className="sr-only">{variant.label}</span>
    </span>
  );
}
