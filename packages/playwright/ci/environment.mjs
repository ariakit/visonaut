import { readdir, readFile, realpath, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, firefox, webkit, devices } from "@playwright/test";
import { digestJson, sha256 } from "./identity.mjs";

async function fontFiles(directory, relative = "") {
  let entries;
  try {
    entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await fontFiles(directory, file)));
    else if (/\.(ttf|otf|ttc|woff2?)$/i.test(entry.name)) {
      files.push({
        file: file.split(path.sep).join("/"),
        digest: sha256(await readFile(path.join(directory, file))),
      });
    }
  }
  return files.sort((left, right) => left.file.localeCompare(right.file, "en"));
}

export async function measureEnvironment({
  appPackageFile,
  outputDirectory,
  browserName,
  device,
  viewports,
  comparisonPolicy,
  comparisonEngineVersion,
  applicationFontPackage,
  systemFontRoots,
}) {
  const engine = { chromium, firefox, webkit }[browserName];
  if (!engine || !devices[device] || !Array.isArray(viewports) || !viewports.length) {
    throw new Error("Trusted environment probe needs a fixed browser, device, and viewports");
  }
  const require = createRequire(appPackageFile);
  const fontSource = await realpath(
    path.dirname(require.resolve(`${applicationFontPackage}/package.json`)),
  );
  const roots = [
    ...(systemFontRoots ??
      (process.platform === "darwin"
        ? ["/System/Library/Fonts", "/Library/Fonts"]
        : ["/usr/share/fonts", "/usr/local/share/fonts"])),
    fontSource,
  ];
  const fonts = [];
  for (const [index, root] of roots.entries()) {
    for (const file of await fontFiles(root)) fonts.push({ root: index, ...file });
  }
  if (!fonts.length) throw new Error("No system or application fonts were measured");
  const osImage = {
    os: process.env.ImageOS ?? process.platform,
    imageVersion: process.env.ImageVersion ?? "local-probe-only",
    architecture: process.arch,
  };
  const profile = {
    osImageDigest: digestJson(osImage),
    fontsDigest: digestJson(fonts),
    comparisonPolicyDigest: digestJson(comparisonPolicy),
    comparisonEngineVersion,
  };
  const browser = await engine.launch(browserName === "chromium" ? { channel: "chromium" } : {});
  const profiles = new Map();
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        ...devices[device],
        viewport,
        locale: "en-US",
        timezoneId: "UTC",
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        for (const colorScheme of ["light", "dark"]) {
          for (const contrast of ["no-preference", "more"]) {
            for (const forcedColors of ["none", "active"]) {
              await page.emulateMedia({ colorScheme, contrast, forcedColors });
              const media = await page.evaluate(() => ({
                viewport: { width: innerWidth, height: innerHeight },
                deviceScaleFactor: devicePixelRatio,
                locale: navigator.language,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? "reduce"
                  : "no-preference",
                colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
                contrast: matchMedia("(prefers-contrast: more)").matches ? "more" : "no-preference",
                forcedColors: matchMedia("(forced-colors: active)").matches ? "active" : "none",
              }));
              for (const fullPage of [false, true]) {
                const value = {
                  ...profile,
                  browser: browserName,
                  browserVersion: browser.version(),
                  ...media,
                  animationPolicy: "disabled",
                  captureOptions: {
                    type: "png",
                    animations: "disabled",
                    caret: "hide",
                    scale: "css",
                    fullPage,
                    omitBackground: false,
                  },
                };
                profiles.set(digestJson(value), value);
              }
            }
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  const result = {
    browser: browserName,
    osImage,
    profile,
    fonts,
    environmentProfiles: [...profiles].map(([digest, value]) => ({ digest, profile: value })),
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, `environment-${browserName}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return result;
}
