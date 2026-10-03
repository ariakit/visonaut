import type { PageAssertionsToHaveScreenshotOptions, TestInfo } from "@playwright/test";
import { validateCaptureComparison } from "@visonaut/protocol";
import type { CaptureComparison } from "@visonaut/protocol";

export interface ComparisonOptions extends Pick<
  PageAssertionsToHaveScreenshotOptions,
  "threshold" | "maxDiffPixels" | "maxDiffPixelRatio"
> {}

const comparisonKeys = ["threshold", "maxDiffPixels", "maxDiffPixelRatio"] as const;

function isComparisonRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function projectComparisonDefaults(info: TestInfo): Record<string, unknown> {
  const metadata: unknown = Object.hasOwn(info.project.metadata, "visonaut")
    ? info.project.metadata.visonaut
    : undefined;
  if (!isComparisonRecord(metadata) || !Object.hasOwn(metadata, "comparisonDefaults")) {
    throw new Error(
      "project.metadata.visonaut.comparisonDefaults is required; set an object, including {} for threshold 0.2 and zero allowed pixels",
    );
  }
  const defaults = metadata.comparisonDefaults;
  if (!isComparisonRecord(defaults)) {
    throw new Error("project.metadata.visonaut.comparisonDefaults must be an object, including {}");
  }
  const settings: Record<string, unknown> = {};
  for (const key of comparisonKeys) {
    if (Object.hasOwn(defaults, key)) {
      settings[key] = defaults[key];
    }
  }
  // Invalid explicit defaults must fail even when a capture overrides them.
  try {
    resolveComparison(settings);
  } catch (cause) {
    throw new Error("Invalid project.metadata.visonaut.comparisonDefaults", { cause });
  }
  return settings;
}

export function comparisonOptions(
  info: TestInfo,
  options: ComparisonOptions,
  batchOptions: ComparisonOptions = {},
): CaptureComparison {
  const effective: Record<string, unknown> = {};
  for (const source of [projectComparisonDefaults(info), batchOptions, options]) {
    for (const key of comparisonKeys) {
      // An explicit undefined clears an inherited setting, as in Playwright.
      if (Object.hasOwn(source, key)) {
        effective[key] = source[key];
      }
    }
  }
  return resolveComparison(effective);
}

function resolveComparison(effective: Record<string, unknown>): CaptureComparison {
  const comparison = {
    threshold: effective.threshold === undefined ? 0.2 : effective.threshold,
    ...(effective.maxDiffPixels === undefined ? {} : { maxDiffPixels: effective.maxDiffPixels }),
    ...(effective.maxDiffPixelRatio === undefined
      ? {}
      : { maxDiffPixelRatio: effective.maxDiffPixelRatio }),
    ...(effective.maxDiffPixels === undefined && effective.maxDiffPixelRatio === undefined
      ? { maxDiffPixels: 0 }
      : {}),
  };
  validateCaptureComparison(comparison);
  return comparison;
}
