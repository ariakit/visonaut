import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
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
}

export interface VisualOptions {
  item: string;
  name?: string;
  variant: Variant;
  /** Set here or in project.metadata.visonaut.profile. */
  profile?: EnvironmentProfile;
  /** Total capture deadline, including fonts and consecutive stable images. */
  timeout?: number;
  screenshot?: Partial<
    Pick<
      PageScreenshotOptions,
      "fullPage" | "clip" | "omitBackground" | "scale" | "caret" | "style"
    >
  >;
}

export interface VisualBatchOptions extends Pick<VisualOptions, "variant" | "profile" | "timeout"> {
  /** Each clip uses integer CSS-pixel coordinates in the document. */
  items: Array<
    Pick<VisualOptions, "item" | "name"> & { clip: NonNullable<PageScreenshotOptions["clip"]> }
  >;
  screenshot?: Partial<Pick<PageScreenshotOptions, "omitBackground" | "caret" | "style">>;
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
  for (const key of ["osImageDigest", "fontsDigest"]) {
    if (!Object.hasOwn(profile, key)) {
      throw new Error(`Missing Visonaut environment profile ${key}`);
    }
  }
  if (
    !("osImageDigest" in profile) ||
    typeof profile.osImageDigest !== "string" ||
    !("fontsDigest" in profile) ||
    typeof profile.fontsDigest !== "string"
  ) {
    throw new Error("Visonaut environment profile values must be strings");
  }
  return {
    osImageDigest: profile.osImageDigest,
    fontsDigest: profile.fontsDigest,
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
  await markCaptureStarted(info, attemptToken);
  await capturePrepared({ page, options, info, attemptToken });
}

/** Capture several document clips from one stable full-page screenshot pair. */
export async function visualBatch(page: Page, options: VisualBatchOptions): Promise<void> {
  const info = test.info();
  const attemptTokens = options.items.length
    ? options.items.map(() => randomUUID())
    : [randomUUID()];
  for (const attemptToken of attemptTokens) {
    await markCaptureStarted(info, attemptToken);
  }
  const first = options.items[0];
  if (!first) {
    throw new Error("A visual batch needs at least one item");
  }
  const ordinals = options.items.map((item) =>
    reserveIdentity(info, { item: item.item, variant: options.variant }),
  );
  const deadline = getDeadline(options.timeout);
  await waitForPreparedPage(page, deadline);
  for (const item of options.items) {
    validateClip(item.clip);
  }
  const sourceOptions = screenshotOptions({
    item: first.item,
    variant: options.variant,
    screenshot: { ...options.screenshot, fullPage: true },
  });
  const baseProfile = await beforeDeadline(
    getProfile(
      page,
      {
        item: first.item,
        variant: options.variant,
        profile: options.profile,
        screenshot: { ...options.screenshot, fullPage: true, clip: first.clip },
      },
      info,
    ),
    deadline,
  );
  const preparedItems = options.items.map((item) => {
    const itemOptions: VisualOptions = {
      item: item.item,
      name: item.name,
      variant: options.variant,
      profile: options.profile,
      screenshot: { ...options.screenshot, fullPage: true, clip: item.clip },
    };
    const captureOptions: Record<string, Json> = screenshotOptions(itemOptions);
    captureOptions.captureMethod = "shared-full-page-crop-v1";
    const profile: CaptureProfile = { ...baseProfile, captureOptions };
    validateProfile(profile);
    return { options: itemOptions, profile };
  });
  const source = await getStableScreenshot(page, sourceOptions, deadline);
  for (const [index, item] of options.items.entries()) {
    const attemptToken = attemptTokens[index];
    const ordinal = ordinals[index];
    const prepared = preparedItems[index];
    if (attemptToken == null || ordinal == null || prepared == null) {
      throw new Error("Visual batch item is missing its capture identity");
    }
    const image = cropScreenshot(source.pixels, item.clip);
    if (performance.now() >= deadline) {
      throw new Error("Visual capture timed out before pixels stabilized");
    }
    await attachCapture({
      info,
      attemptToken,
      options: prepared.options,
      ordinal,
      bytes: image.bytes,
      decoded: image.pixels,
      profile: prepared.profile,
    });
  }
}

interface CapturePreparedParams {
  page: Page;
  options: VisualOptions;
  info: TestInfo;
  attemptToken: string;
}

function getDeadline(timeout = 5000) {
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 120_000) {
    throw new Error("Visual timeout must be greater than zero and at most 120000 ms");
  }
  return performance.now() + timeout;
}

async function markCaptureStarted(info: TestInfo, attemptToken: string) {
  await info.attach(`visonaut-started-${attemptToken}`, {
    body: Buffer.from(JSON.stringify({ attemptToken })),
    contentType: CAPTURE_STARTED_CONTENT_TYPE,
  });
}

function reserveIdentity(info: TestInfo, options: Pick<VisualOptions, "item" | "variant">) {
  validateKey(options.item, "item");
  validateKey(options.variant.key, "variant.key");
  const identities = captureIdentities.get(info) ?? new Set<string>();
  captureIdentities.set(info, identities);
  const identity = identityKey({ itemKey: options.item, variantKey: options.variant.key });
  if (identities.has(identity)) {
    throw new Error("Duplicate item/variant capture in this test attempt");
  }
  identities.add(identity);
  return identities.size - 1;
}

async function waitForPreparedPage(page: Page, deadline: number) {
  await beforeDeadline(
    page.waitForLoadState("domcontentloaded", {
      timeout: Math.max(1, deadline - performance.now()),
    }),
    deadline,
  );
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
}

interface DecodedScreenshot {
  bytes: Buffer;
  pixels: PNG;
}

function validateClip(clip: NonNullable<PageScreenshotOptions["clip"]>) {
  const { x, y, width, height } = clip;
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("Visual batch clips need positive integer CSS-pixel bounds");
  }
}

async function readScreenshot(
  page: Page,
  options: Record<string, Json> & PageScreenshotOptions,
  deadline: number,
): Promise<DecodedScreenshot> {
  const bytes = await beforeDeadline(
    page.screenshot({ ...options, timeout: Math.max(1, deadline - performance.now()) }),
    deadline,
  );
  // Read the PNG header before allocating decoded pixel buffers.
  if (bytes.byteLength > 20 * 1024 * 1024 || bytes.byteLength < 24) {
    throw new Error("Capture exceeds the encoded image limit or has no PNG header");
  }
  const pixels = bytes.readUInt32BE(16) * bytes.readUInt32BE(20);
  if (pixels > 32_000_000) {
    throw new Error("Capture exceeds the 32 million decoded pixel limit");
  }
  return { bytes, pixels: PNG.sync.read(bytes, { checkCRC: true }) };
}

async function getStableScreenshot(
  page: Page,
  options: Record<string, Json> & PageScreenshotOptions,
  deadline: number,
): Promise<DecodedScreenshot> {
  let previous: DecodedScreenshot | undefined;
  while (performance.now() < deadline) {
    const current = await readScreenshot(page, options, deadline);
    if (
      previous &&
      previous.pixels.width === current.pixels.width &&
      previous.pixels.height === current.pixels.height &&
      previous.pixels.data.equals(current.pixels.data)
    ) {
      if (performance.now() >= deadline) {
        throw new Error("Visual capture timed out before pixels stabilized");
      }
      return current;
    }
    previous = current;
    await beforeDeadline(new Promise<void>((resolve) => setTimeout(resolve, 100)), deadline);
  }
  throw new Error("Visual capture timed out before pixels stabilized");
}

function cropScreenshot(
  source: PNG,
  clip: NonNullable<PageScreenshotOptions["clip"]>,
): DecodedScreenshot {
  const x = clip.x;
  const y = clip.y;
  if (x < 0 || y < 0 || x + clip.width > source.width || y + clip.height > source.height) {
    throw new Error("Visual batch item clip is outside the source screenshot");
  }
  const pixels = new PNG({ width: clip.width, height: clip.height });
  PNG.bitblt(source, pixels, x, y, clip.width, clip.height, 0, 0);
  const bytes = PNG.sync.write(pixels);
  if (bytes.byteLength > 20 * 1024 * 1024) {
    throw new Error("Capture exceeds the encoded image limit");
  }
  return { bytes, pixels };
}

async function capturePrepared({
  page,
  options,
  info,
  attemptToken,
}: CapturePreparedParams): Promise<void> {
  const ordinal = reserveIdentity(info, options);
  const deadline = getDeadline(options.timeout);
  await waitForPreparedPage(page, deadline);
  const profile = await beforeDeadline(getProfile(page, options, info), deadline);
  const screenshot = await getStableScreenshot(page, screenshotOptions(options), deadline);
  if (performance.now() >= deadline) {
    throw new Error("Visual capture timed out before pixels stabilized");
  }
  await attachCapture({
    info,
    attemptToken,
    options,
    ordinal,
    bytes: screenshot.bytes,
    decoded: screenshot.pixels,
    profile,
  });
}

interface AttachCaptureParams {
  info: TestInfo;
  attemptToken: string;
  options: VisualOptions;
  ordinal: number;
  bytes: Buffer;
  decoded: PNG;
  profile: CaptureProfile;
}

async function attachCapture({
  info,
  attemptToken,
  options,
  ordinal,
  bytes,
  decoded,
  profile,
}: AttachCaptureParams) {
  const profileDigest = await digestJson(profile);
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
  const imageDirectory = await mkdtemp(path.join(tmpdir(), "visonaut-attachment-"));
  const imagePath = path.join(imageDirectory, `${attachment.image.digest}.png`);
  await writeFile(imagePath, bytes, { mode: 0o600 });
  // attach({ path }) copies into test-results and extends artifact retention.
  // The reporter owns this private attempt file and deletes it after reading.
  info.attachments.push({ name: imageAttachment, path: imagePath, contentType: "image/png" });
  await info.attach(`visonaut-capture-${ordinal}`, {
    body: Buffer.from(JSON.stringify(attachment)),
    contentType: CAPTURE_CONTENT_TYPE,
  });
}
