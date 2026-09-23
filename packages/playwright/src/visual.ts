import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { digestJson, identityKey, sha256, validateKey, validateProfile } from "@visonaut/protocol";
import type { Capture, CaptureProfile, Json, ProfileRecord, Variant } from "@visonaut/protocol";
import { test } from "@playwright/test";
import type { Page, PageScreenshotOptions, TestInfo } from "@playwright/test";
import { PNG } from "pngjs";

export interface EnvironmentProfile {
  osImageDigest: string;
  fontsDigest: string;
  comparisonPolicyDigest: string;
  comparisonEngineVersion: string;
}

export interface VisualOptions {
  item: string;
  name?: string;
  variant: Variant;
  /** Set here or in project.metadata.visonaut.profile. */
  profile?: EnvironmentProfile;
  /** Total capture deadline, including fonts and consecutive stable images. */
  timeout?: number;
  screenshot?: Pick<
    PageScreenshotOptions,
    "fullPage" | "clip" | "omitBackground" | "scale" | "caret" | "style"
  >;
}

export interface CaptureAttachment {
  attemptToken: string;
  capture: Omit<Capture, "ordinal" | "image">;
  profile: ProfileRecord;
  image: Omit<Capture["image"], "path">;
  imageAttachment: string;
  ordinal: number;
}

export const CAPTURE_STARTED_CONTENT_TYPE = "application/vnd.visonaut.capture-started+json";
export const CAPTURE_CONTENT_TYPE = "application/vnd.visonaut.capture+json";
const captureIdentities = new WeakMap<TestInfo, Set<string>>();

function getEnvironmentProfile(options: VisualOptions, info: TestInfo): EnvironmentProfile {
  if (options.profile) {
    return options.profile;
  }
  const metadata: unknown = info.project.metadata.visonaut;
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !Object.hasOwn(metadata, "profile") ||
    !("profile" in metadata)
  ) {
    throw new Error("Set profile in visual options or project.metadata.visonaut.profile");
  }
  const profile = metadata.profile;
  if (!profile || typeof profile !== "object") {
    throw new Error("Invalid Visonaut environment profile");
  }
  for (const key of [
    "osImageDigest",
    "fontsDigest",
    "comparisonPolicyDigest",
    "comparisonEngineVersion",
  ]) {
    if (!Object.hasOwn(profile, key)) {
      throw new Error(`Missing Visonaut environment profile ${key}`);
    }
  }
  if (
    !("osImageDigest" in profile) ||
    typeof profile.osImageDigest !== "string" ||
    !("fontsDigest" in profile) ||
    typeof profile.fontsDigest !== "string" ||
    !("comparisonPolicyDigest" in profile) ||
    typeof profile.comparisonPolicyDigest !== "string" ||
    !("comparisonEngineVersion" in profile) ||
    typeof profile.comparisonEngineVersion !== "string"
  ) {
    throw new Error("Visonaut environment profile values must be strings");
  }
  return {
    osImageDigest: profile.osImageDigest,
    fontsDigest: profile.fontsDigest,
    comparisonPolicyDigest: profile.comparisonPolicyDigest,
    comparisonEngineVersion: profile.comparisonEngineVersion,
  };
}

async function beforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - performance.now();
  if (remaining <= 0) {
    throw new Error("Visual capture timed out before pixels stabilized");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Visual capture timed out before pixels stabilized")),
          remaining,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function getProfile(
  page: Page,
  options: VisualOptions,
  info: TestInfo,
): Promise<CaptureProfile> {
  const browser = page.context().browser();
  if (!browser) {
    throw new Error("Visonaut requires a connected Playwright browser");
  }
  const browserName = browser.browserType().name();
  if (browserName !== options.variant.browser) {
    throw new Error("Variant browser does not match the prepared page");
  }
  const environment = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    deviceScaleFactor: devicePixelRatio,
    locale: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    dark: matchMedia("(prefers-color-scheme: dark)").matches,
    contrast: matchMedia("(prefers-contrast: more)").matches,
    forcedColors: matchMedia("(forced-colors: active)").matches,
  }));
  const profile: CaptureProfile = {
    ...getEnvironmentProfile(options, info),
    browser: options.variant.browser,
    browserVersion: browser.version(),
    viewport: environment.viewport,
    deviceScaleFactor: environment.deviceScaleFactor,
    locale: environment.locale,
    timezone: environment.timezone,
    reducedMotion: environment.reducedMotion ? "reduce" : "no-preference",
    colorScheme: environment.dark ? "dark" : "light",
    contrast: environment.contrast ? "more" : "no-preference",
    forcedColors: environment.forcedColors ? "active" : "none",
    animationPolicy: "disabled",
    captureOptions: screenshotOptions(options),
  };
  for (const key of ["colorScheme", "contrast", "forcedColors"] as const) {
    if (options.variant[key] !== undefined && options.variant[key] !== profile[key]) {
      throw new Error(`Variant ${key} does not match the prepared page`);
    }
  }
  validateProfile(profile);
  return profile;
}

function screenshotOptions(options: VisualOptions): Record<string, Json> & PageScreenshotOptions {
  return {
    type: "png",
    animations: "disabled",
    caret: options.screenshot?.caret ?? "hide",
    scale: options.screenshot?.scale ?? "css",
    fullPage: options.screenshot?.fullPage ?? false,
    omitBackground: options.screenshot?.omitBackground ?? false,
    ...(options.screenshot?.clip ? { clip: { ...options.screenshot.clip } } : {}),
    ...(options.screenshot?.style ? { style: options.screenshot.style } : {}),
  };
}

/** Capture one prepared variant. The caller owns media, viewport, and cleanup. */
export async function visual(page: Page, options: VisualOptions): Promise<void> {
  const info = test.info();
  const attemptToken = randomUUID();
  await info.attach(`visonaut-started-${attemptToken}`, {
    body: Buffer.from(JSON.stringify({ attemptToken })),
    contentType: CAPTURE_STARTED_CONTENT_TYPE,
  });
  await capturePrepared({ page, options, info, attemptToken });
}

interface CapturePreparedParams {
  page: Page;
  options: VisualOptions;
  info: TestInfo;
  attemptToken: string;
}

async function capturePrepared({
  page,
  options,
  info,
  attemptToken,
}: CapturePreparedParams): Promise<void> {
  validateKey(options.item, "item");
  validateKey(options.variant.key, "variant.key");
  const identities = captureIdentities.get(info) ?? new Set<string>();
  captureIdentities.set(info, identities);
  const identity = identityKey({ itemKey: options.item, variantKey: options.variant.key });
  if (identities.has(identity)) {
    throw new Error("Duplicate item/variant capture in this test attempt");
  }
  identities.add(identity);
  const ordinal = identities.size - 1;
  const timeout = options.timeout ?? 5000;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 120_000) {
    throw new Error("Visual timeout must be greater than zero and at most 120000 ms");
  }
  const deadline = performance.now() + timeout;
  await beforeDeadline(page.waitForLoadState("domcontentloaded", { timeout }), deadline);
  // Firefox can leave fonts.ready pending after navigation even when no font
  // face is loading. Observe the faces instead of waiting for that promise.
  const fontWait = await beforeDeadline(
    page.waitForFunction(
      () => {
        document.documentElement.getBoundingClientRect();
        return [...document.fonts].every((face) => face.status !== "loading");
      },
      undefined,
      { timeout: Math.max(1, deadline - performance.now()) },
    ),
    deadline,
  );
  await fontWait.dispose();
  const profile = await beforeDeadline(getProfile(page, options, info), deadline);
  const profileDigest = await digestJson(profile);
  let previous: ReturnType<typeof PNG.sync.read> | undefined;
  let bytes: Buffer | undefined;
  let decoded: ReturnType<typeof PNG.sync.read> | undefined;
  while (performance.now() < deadline) {
    const currentBytes = await beforeDeadline(
      page.screenshot({
        ...screenshotOptions(options),
        timeout: Math.max(1, deadline - performance.now()),
      }),
      deadline,
    );
    // Read the PNG header before allocating decoded pixel buffers.
    if (currentBytes.byteLength > 20 * 1024 * 1024 || currentBytes.byteLength < 24) {
      throw new Error("Capture exceeds the encoded image limit or has no PNG header");
    }
    const pixels = currentBytes.readUInt32BE(16) * currentBytes.readUInt32BE(20);
    if (pixels > 32_000_000) {
      throw new Error("Capture exceeds the 32 million decoded pixel limit");
    }
    const current = PNG.sync.read(currentBytes, { checkCRC: true });
    // Equal dimensions do not prove stability. Compare consecutive RGBA pixels.
    if (
      previous &&
      previous.width === current.width &&
      previous.height === current.height &&
      previous.data.equals(current.data)
    ) {
      bytes = currentBytes;
      decoded = current;
      break;
    }
    previous = current;
    await beforeDeadline(new Promise<void>((resolve) => setTimeout(resolve, 100)), deadline);
  }
  if (!bytes || !decoded || performance.now() >= deadline) {
    throw new Error("Visual capture timed out before pixels stabilized");
  }
  const imageAttachment = `visonaut-image-${ordinal}`;
  const attachment: CaptureAttachment = {
    attemptToken,
    capture: {
      itemKey: options.item,
      ...(options.name ? { name: options.name } : {}),
      variant: options.variant,
      testId: info.testId,
      testRetry: info.retry,
      profileDigest,
    },
    profile: { digest: profileDigest, profile },
    image: {
      digest: await sha256(bytes),
      mediaType: "image/png",
      width: decoded.width,
      height: decoded.height,
      bytes: bytes.byteLength,
    },
    imageAttachment,
    ordinal,
  };
  await info.attach(imageAttachment, { body: bytes, contentType: "image/png" });
  await info.attach(`visonaut-capture-${ordinal}`, {
    body: Buffer.from(JSON.stringify(attachment)),
    contentType: CAPTURE_CONTENT_TYPE,
  });
}
