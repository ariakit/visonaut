import type { PageAssertionsToHaveScreenshotOptions, TestInfo } from "@playwright/test";
import { validateCaptureComparison } from "@visonaut/protocol";
import type { CaptureComparison } from "@visonaut/protocol";

export interface ComparisonOptions extends Pick<
  PageAssertionsToHaveScreenshotOptions,
  "threshold" | "maxDiffPixels" | "maxDiffPixelRatio"
> {}

const comparisonKeys = ["threshold", "maxDiffPixels", "maxDiffPixelRatio"] as const;

function screenshotDefaults(info: TestInfo): Record<string, unknown> {
  const unsupported = () =>
    new Error(
      "Cannot read resolved screenshot defaults; @visonaut/playwright requires Playwright 1.63.0",
    );
  // FullProject omits expect. Keep the bridge to the pinned worker in one place.
  if (!Object.hasOwn(info, "_projectInternal") || !("_projectInternal" in info)) {
    throw unsupported();
  }
  const project = info._projectInternal;
  if (
    !project ||
    typeof project !== "object" ||
    !Object.hasOwn(project, "expect") ||
    !("expect" in project)
  ) {
    throw unsupported();
  }
  const expectation = project.expect;
  if (!expectation || typeof expectation !== "object" || Array.isArray(expectation)) {
    throw unsupported();
  }
  if (!Object.hasOwn(expectation, "toHaveScreenshot")) return {};
  if (!("toHaveScreenshot" in expectation)) return {};
  const screenshot = expectation.toHaveScreenshot;
  if (screenshot === undefined) return {};
  if (!screenshot || typeof screenshot !== "object" || Array.isArray(screenshot)) {
    throw unsupported();
  }
  return { ...screenshot };
}

export function comparisonOptions(
  info: TestInfo,
  options: ComparisonOptions,
  batchOptions: ComparisonOptions = {},
): CaptureComparison {
  const effective: Record<string, unknown> = {};
  for (const source of [screenshotDefaults(info), batchOptions, options]) {
    for (const key of comparisonKeys) {
      // An explicit undefined clears an inherited setting, as in Playwright.
      if (Object.hasOwn(source, key)) {
        effective[key] = source[key];
      }
    }
  }
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
