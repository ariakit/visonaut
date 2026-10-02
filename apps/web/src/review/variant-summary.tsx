import { BanIcon, ContrastIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import type { ReactNode } from "react";
import { NavIcon } from "../components/ariakit/components/nav.ariakit.react.tsx";
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
      <span
        className="review-variant-index text-xs tabular-nums shrink-0 ak-ink-60"
        aria-hidden="true"
      >
        {index + 1}
      </span>
      <span
        className="review-variant-icons inline-flex items-center shrink-0 gap-1 [--control-inline:0]"
        aria-hidden="true"
      >
        {parts.map((part, partIndex) => {
          const icon = iconForPart(part);
          return icon ? (
            <NavIcon key={partIndex} title={tooltipForPart(part.value, part.kind)}>
              {icon}
            </NavIcon>
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
