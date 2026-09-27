import {
  AppWindowIcon,
  AtomIcon,
  BanIcon,
  ContrastIcon,
  GlobeIcon,
  LayersIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ReviewVariant } from "./model.ts";

const icons: Record<string, ReactNode> = {
  react: <AtomIcon />,
  solid: <LayersIcon />,
  chromium: <ChromiumIcon />,
  firefox: <GlobeIcon />,
  webkit: <AppWindowIcon />,
  light: <SunIcon />,
  dark: <MoonIcon />,
  "no-preference": <MonitorIcon />,
  contrast: <ContrastIcon />,
  none: <BanIcon />,
};

function iconForPart(part: string) {
  const key = part.toLowerCase();
  return Object.hasOwn(icons, key) ? icons[key] : undefined;
}

function ChromiumIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#4285f4" />
      <circle cx="12" cy="12" r="5.2" fill="#8ab4f8" stroke="white" strokeWidth="1.5" />
      <path
        d="M12 2a10 10 0 0 1 8.7 5.1H12M3.3 7.1 7.7 15M12 22l4.4-7"
        stroke="white"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function VariantSummary({ variant, index }: { variant: ReviewVariant; index: number }) {
  const parts = variant.label.split(" · ");
  const title = parts.filter((part) => !iconForPart(part)).join(" · ");
  return (
    <span className="review-variant-summary">
      {variant.thumbnail && (
        <img className="review-variant-thumbnail" src={variant.thumbnail} alt="" loading="lazy" />
      )}
      <span className="review-variant-index" aria-hidden="true">
        {index + 1}
      </span>
      <span className="review-variant-icons" aria-hidden="true">
        {parts.map((part, partIndex) => {
          const icon = iconForPart(part);
          return icon ? (
            <span key={partIndex} title={part}>
              {icon}
            </span>
          ) : null;
        })}
      </span>
      {title && (
        <span className="review-variant-title" aria-hidden="true" title={title}>
          {title}
        </span>
      )}
      <span className="sr-only">{variant.label}</span>
    </span>
  );
}
