import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { visual } from "../packages/playwright/dist/index.js";

const browserName = process.env.E01_BROWSER;
if (browserName !== "chromium" && browserName !== "firefox" && browserName !== "webkit") {
  throw new Error("Set E01_BROWSER to a tested browser engine");
}
const scenario = process.env.E01_SCENARIO;
const variant = { key: browserName, browser: browserName };
const fixture = `<style>
  body { margin:0; padding:24px; font:16px E01Font, monospace; background:#f8f8f8 }
  section { padding:16px; border:1px solid #777; border-radius:8px; width:300px }
  h1 { font-size:23px; font-weight:600; letter-spacing:.1px }
  small { color:rgba(0,0,0,.65) }
  button { border:1px solid #357; padding:8px 12px; border-radius:5px }
  .dot { width:8px; height:8px; background:#246; animation:pulse .2s infinite alternate }
  @keyframes pulse { from { opacity:1 } to { opacity:.4 } }
</style><section><h1>Stable dialog Aa 123</h1><small>Thin strokes and alpha</small><p><button>Continue</button></p><div class=dot></div></section>`;

if (scenario === "clean") {
  for (let index = 0; index < 10; index += 1) {
    test(`clean prepared capture ${index}`, async ({ page }) => {
      await page.setContent(fixture);
      await visual(page, { item: `clean/${index}`, variant });
      expect(
        await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
      ).toBe(true);
    });
  }
  test("font loading finishes before the first screenshot", async ({ page }) => {
    const font = await readFile("/System/Library/Fonts/Supplemental/Arial.ttf");
    let releaseFont = () => {};
    const released = new Promise<void>((resolve) => {
      releaseFont = resolve;
    });
    let requestSeen = () => {};
    const requested = new Promise<void>((resolve) => {
      requestSeen = resolve;
    });
    await page.route("https://e01.invalid/font.ttf", async (route) => {
      requestSeen();
      await released;
      await route.fulfill({
        body: font,
        contentType: "font/ttf",
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    });
    await page.setContent(
      `<style>@font-face { font-family:E01Font; src:url(https://e01.invalid/font.ttf) }</style>${fixture}`,
      { waitUntil: "domcontentloaded" },
    );
    await requested;
    expect(await page.evaluate(() => document.fonts.status)).toBe("loading");
    const screenshot = page.screenshot.bind(page);
    const statuses: string[] = [];
    page.screenshot = async (options) => {
      statuses.push(await page.evaluate(() => document.fonts.status));
      return screenshot(options);
    };
    const capture = visual(page, { item: "font/ready", variant });
    // Hold a real pending font request across capture startup, then permit it to finish.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(statuses).toEqual([]);
    releaseFont();
    await capture;
    expect(statuses.length).toBeGreaterThanOrEqual(2);
    expect(statuses.every((status) => status === "loaded")).toBe(true);
    expect(await page.evaluate(() => document.fonts.check("16px E01Font"))).toBe(true);
  });
}

if (scenario === "recovered") {
  for (let index = 0; index < 5; index += 1) {
    test(`blue failure then green success ${index}`, async ({ page }, info) => {
      await page.setContent(
        `<style>body { margin:0; background:${info.retry ? "lime" : "blue"} }</style>`,
      );
      await visual(page, { item: `recovered/${index}`, variant });
      expect(info.retry).toBe(1);
    });
  }
}

if (scenario === "exhausted") {
  test("no successful attempt exists", async ({ page }) => {
    await page.setContent("<style>body { background:blue }</style>");
    await visual(page, { item: "exhausted", variant });
    throw new Error("expected later failure on every attempt");
  });
}

if (scenario === "preparation") {
  test("caller preparation fails before capture", async ({ page }) => {
    await page.setContent("<p>Before preparation</p>");
    throw new Error("expected caller preparation failure");
  });
}

if (scenario === "unstable") {
  test("changing pixels cannot pass with unchanged dimensions", async ({ page }) => {
    await page.setContent("<style>body { margin:0; background:blue }</style>");
    const screenshot = page.screenshot.bind(page);
    let alternate = false;
    page.screenshot = async (options) => {
      alternate = !alternate;
      await page.evaluate((red) => {
        document.body.style.background = red ? "red" : "blue";
      }, alternate);
      return screenshot(options);
    };
    await visual(page, { item: "unstable", variant, timeout: 750 });
  });
}
