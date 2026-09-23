import { mkdir, writeFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "@playwright/test";
import {
  compareImages,
  decodeImage,
  validateImage,
  type ComparisonPolicy,
  type Pixels,
} from "../src/index.ts";
import { nodeCodecs } from "../test/codecs.ts";

const codecs = await nodeCodecs();
const policy: ComparisonPolicy = {
  id: "visible-exact-v1",
  channelThreshold: 0,
  maxChangedPixels: 0,
  maxChangedRatio: 0,
};
const fixture = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Comparison rendering fixture</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#e9edf4;font:16px Arial,sans-serif;color:#192233}
main{margin:40px;padding:24px;border-radius:12px;background:rgba(255,255,255,.8);box-shadow:0 10px 30px #1233;border:1px solid #bac6d8}
h1{font-size:23px;font-weight:600;margin:0 0 12px}p{line-height:1.5;margin:0 0 16px}
button{font:inherit;border-radius:6px;border:1px solid #2458a9;color:white;background:#316bcd;padding:8px 12px}
small{display:block;font-size:13px;color:rgba(20,32,48,.65);margin-top:12px}
.dot{display:inline-block;background:#3172d6;width:12px;height:12px;border-radius:50%;animation:pulse 2s infinite alternate}
@keyframes pulse{from{opacity:1}to{opacity:.4}}
</style><main><h1>Confirm changes <span class="dot"></span></h1><p>Font strokes: I l 1 O 0. Round edges and a translucent background.</p><button>Accept changes</button><small>Alpha, borders, text and disabled animation</small></main></html>`;
const results: unknown[] = [];
await mkdir(new URL("../evidence/browser/", import.meta.url), { recursive: true });
for (const [name, browserType] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 640, height: 360 },
      deviceScaleFactor: 1,
      colorScheme: "light",
      reducedMotion: "reduce",
      locale: "en-US",
      timezoneId: "UTC",
    });
    const page = await context.newPage();
    let reference: Pixels | undefined;
    let unchanged = 0;
    const cleanRatios: number[] = [];
    for (let iteration = 0; iteration < 20; iteration += 1) {
      await page.setContent(fixture);
      await page.evaluate(() => document.fonts.ready);
      const bytes = Uint8Array.from(
        await page.screenshot({ animations: "disabled", caret: "hide", scale: "css" }),
      );
      const image = await decodeImage(await validateImage(bytes), codecs);
      if (!reference) {
        reference = image;
        await writeFile(new URL(`../evidence/browser/${name}.png`, import.meta.url), bytes);
        continue;
      }
      const comparison = compareImages(reference, image, policy);
      cleanRatios.push(comparison.ratio);
      if (comparison.outcome === "unchanged") {
        unchanged += 1;
      }
    }
    if (!reference) {
      throw new Error("Missing browser baseline");
    }
    const defects = [];
    for (const [kind, css] of Object.entries({
      "border-removal": "button{border-color:transparent}",
      "one-pixel-layout": "button{padding-left:13px}",
      "font-weight": "h1{font-weight:500}",
      "subtle-alpha": "small{color:rgba(20,32,48,.64)}",
    })) {
      await page.setContent(fixture);
      await page.addStyleTag({ content: css });
      await page.evaluate(() => document.fonts.ready);
      const bytes = Uint8Array.from(
        await page.screenshot({ animations: "disabled", caret: "hide", scale: "css" }),
      );
      const candidate = await decodeImage(await validateImage(bytes), codecs);
      const comparison = compareImages(reference, candidate, policy);
      defects.push({
        kind,
        changedPixels: comparison.changedPixels,
        ratio: comparison.ratio,
        detected: comparison.outcome === "changed",
      });
    }
    results.push({
      browser: name,
      version: browser.version(),
      cleanCaptures: 20,
      comparedCleanCaptures: 19,
      unchanged,
      cleanRatios,
      defects,
    });
    await context.close();
  } finally {
    await browser.close();
  }
}
const evidence = {
  date: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  playwright: "1.63.0",
  policy,
  options: {
    viewport: "640x360",
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
    animations: "disabled",
    caret: "hide",
    scale: "css",
    fontReadiness: "document.fonts.ready",
    font: "Arial",
    locale: "en-US",
    timezone: "UTC",
  },
  results,
  limitation:
    "Prepared synthetic browser fixture on macOS. This does not establish clean-repeat noise for Ariakit pages, Ubuntu runners, environment drift, or the full capture matrix.",
};
await writeFile(
  new URL("../evidence/browser-study.json", import.meta.url),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(JSON.stringify(evidence, null, 2));
