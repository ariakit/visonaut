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

function projectComparisonDefaults(info: TestInfo): Record<string, unknown> | undefined {
  if (!Object.hasOwn(info.project.metadata, "visonaut")) return;
  const metadata: unknown = info.project.metadata.visonaut;
  if (!metadata || typeof metadata !== "object") return;
  if (!Object.hasOwn(metadata, "comparisonDefaults")) return;
  if (!("comparisonDefaults" in metadata)) return;
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

function screenshotDefaults(info: TestInfo): Record<string, unknown> {
  const explicit = projectComparisonDefaults(info);
  if (explicit !== undefined) {
    return explicit;
  }
  const unsupported = () =>
    new Error(
      "Cannot read resolved screenshot defaults; @visonaut/playwright requires Playwright 1.63.0",
    );
  // Keep unchanged clients on the tested 1.63.0 bridge until adoption permits
  // its removal in the declared breaking release.
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
