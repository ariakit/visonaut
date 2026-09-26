import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type {} from "./fixture-api.ts";

async function focusWorkspace(page: Page) {
  await page.getByLabel("Review workspace", { exact: true }).focus();
}

async function ready(page: Page) {
  await expect(page.locator('[data-evidence="ready"]')).toBeVisible();
}

async function callCount(page: Page, count: number) {
  await expect.poll(() => page.evaluate(() => window.reviewFixture.calls.length)).toBe(count);
}

function selected(page: Page) {
  return page.getByRole("tab", { selected: true });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/src/review/__tests__/index.html");
  await ready(page);
  await focusWorkspace(page);
});

test("review surfaces remain dark when the system uses dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "Keyboard help" }).click();
  const surfaces = await page.evaluate(() => {
    const sample = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const context = document.createElement("canvas").getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
    };
    return {
      workspace: sample(".review-workspace"),
      sidebar: sample(".review-sidebar"),
      dialog: sample(".review-help-dialog"),
    };
  });
  for (const channels of Object.values(surfaces)) {
    expect(channels.every((channel) => channel < 120)).toBe(true);
  }
});

test("comparison errors stay visible ahead of accepted items", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variant = model.items[2]?.variants[0];
    if (!variant) throw new Error("Missing comparison fixture");
    variant.kind = "error";
    variant.verdict = null;
    window.reviewFixture.update(model);
  });
  await expect(page.locator(".review-item")).toHaveCount(3);
  await expect(page.locator("#review-item-2")).toContainText("1 comparison error");
  await expect(page.getByRole("button", { name: "Accepted (1)" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("an accepted first item does not hide the initial attention selection", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.run.id = "run-43";
    const first = model.items[0];
    if (!first) throw new Error("Missing first fixture item");
    for (const variant of first.variants) variant.verdict = "approved";
    window.reviewFixture.update(model);
  });
  const accepted = page.getByRole("button", { name: "Accepted (3)" });
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#review-item-1")).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#review-item-0")).toHaveCount(0);
  await focusWorkspace(page);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#review-item-0")).toHaveAttribute("aria-current", "true");
  await expect(accepted).toHaveAttribute("aria-expanded", "true");
});

test("a pending comparison stays visible without an evidence error", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const first = model.items[0];
    if (!first) throw new Error("Missing first fixture item");
    for (const variant of first.variants) variant.verdict = "approved";
    const comparing = first.variants[0];
    if (!comparing) throw new Error("Missing comparison fixture");
    comparing.kind = "pending";
    window.reviewFixture.update(model);
  });
  await expect(page.locator("#review-item-0")).toContainText("1 comparison running");
  await expect(page.getByRole("button", { name: "Accepted (2)" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.getByText("Comparison is still running…")).toBeVisible();
  await expect(page.getByText("Image evidence unavailable")).not.toBeVisible();
  await expect(page.locator(".review-actions button").first()).toBeDisabled();
});

test("keyboard item navigation follows attention items before accepted items", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const index of [1, 3]) {
      const item = model.items[index];
      if (!item) throw new Error("Missing accepted fixture item");
      for (const variant of item.variants) variant.verdict = "approved";
    }
    const error = model.items[2]?.variants[0];
    if (!error) throw new Error("Missing error fixture variant");
    error.kind = "error";
    error.verdict = null;
    window.reviewFixture.update(model);
  });
  const accepted = page.getByRole("button", { name: "Accepted (2)" });
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  await page.locator("#review-item-0").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#review-item-2")).toBeFocused();
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Home");
  await expect(page.locator("#review-item-0")).toBeFocused();
  await page.getByLabel("Review workspace", { exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#review-item-2")).toHaveAttribute("aria-current", "true");
  await expect(accepted).toHaveAttribute("aria-expanded", "false");
  await page.locator("#review-item-2").focus();
  await page.keyboard.press("End");
  await expect(page.locator("#review-item-3")).toBeFocused();
  await expect(accepted).toHaveAttribute("aria-expanded", "true");
});

test("item and variant navigation stops at ends and remembers each item", async ({ page }) => {
  await page.keyboard.press("ArrowUp");
  await expect(selected(page)).toContainText("React");
  await page.keyboard.press("6");
  await expect(selected(page)).toContainText("WebKit");
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toContainText("Wide");
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toContainText("Wide");
  await page.keyboard.press("ArrowDown");
  await expect(selected(page)).toContainText("Menu");
  await page.keyboard.press("2");
  await expect(selected(page)).toContainText("Menu-dark");
  await page.keyboard.press("6");
  await expect(selected(page)).toContainText("Menu-dark");
  await page.keyboard.press("ArrowUp");
  await expect(selected(page)).toContainText("Wide");
  await page.keyboard.press("ArrowDown");
  await expect(selected(page)).toContainText("Menu-dark");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(selected(page)).toContainText("Removal");
});

test("a missing remembered key falls back and announces the first variant", async ({ page }) => {
  await page.keyboard.press("2");
  await page.keyboard.press("ArrowDown");
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const item = model.items[0];
    if (item) item.variants = item.variants.filter((variant) => variant.key !== "Solid");
    window.reviewFixture.update(model);
  });
  await page.keyboard.press("ArrowUp");
  await expect(selected(page)).toContainText("React");
  await expect(
    page.getByText("The remembered variant is unavailable. Selected React", { exact: false }),
  ).toBeVisible();
});

test("save confirmation gates verdicts and navigation, and repeat keys do nothing", async ({
  page,
}) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.keyboard.press("a");
  await callCount(page, 1);
  await expect(selected(page)).toContainText("React");
  await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeDisabled();
  await page
    .getByLabel("Review workspace", { exact: true })
    .dispatchEvent("keydown", { key: "a", repeat: true });
  await page.keyboard.press("x");
  await callCount(page, 1);
  await page.evaluate(() => {
    window.reviewFixture.setBehavior("normal");
    window.reviewFixture.resolve();
  });
  await expect(selected(page)).toContainText("Solid");
  await ready(page);
  await page.keyboard.press("x");
  await expect(selected(page)).toContainText("Dark");
  await expect(page.getByRole("tab", { name: /Solid.*Rejected/ })).toBeVisible();
});

test("whole item freezes all changed IDs in one undoable command", async ({ page }) => {
  await page.keyboard.press("Shift+A");
  await callCount(page, 1);
  expect(await page.evaluate(() => window.reviewFixture.calls[0])).toMatchObject({
    comparisonId: "comparison-2",
    wholeItemKey: "dialog/open",
    verdict: "approved",
    selection: { itemKey: "dialog/open", variantKey: "React" },
    targets: ["React", "Solid", "Dark", "Contrast", "Firefox", "WebKit", "Wide"].map((key) => ({
      id: `row-${key}`,
      expectedRevision: 0,
    })),
  });
  await expect(selected(page)).toContainText("Menu");
  await page.keyboard.press("Control+z");
  await expect(selected(page)).toContainText("React");
  await expect(page.getByRole("tab", { name: /Solid.*Needs review/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
});

test("next pending wraps, skips automatic verdicts and reviewed rejections", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    for (const item of model.items) {
      for (const variant of item.variants) {
        if (variant.key !== "React" && variant.key !== "Menu-dark") variant.verdict = "approved";
      }
    }
    window.reviewFixture.update(model);
  });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("2");
  await ready(page);
  await page.keyboard.press("x");
  await expect(selected(page)).toContainText("React");
  await ready(page);
  await page.keyboard.press("a");
  await expect(
    page.getByText("Review complete. No variants need review.", { exact: true }),
  ).toBeVisible();
  await expect(selected(page)).toContainText("React");
});

test("undo restores automatic acceptance and the original selection", async ({ page }) => {
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await ready(page);
  await page.keyboard.press("x");
  await expect(selected(page)).toContainText("React");
  await page.keyboard.press("Control+z");
  await expect(selected(page)).toContainText("Addition");
  await expect(selected(page)).toContainText("Accepted automatically");
});

test("protected whole-item rejection refuses every target, while individual actions stay usable", async ({
  page,
}) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variant = model.items[0]?.variants[1];
    if (variant) {
      variant.rejectDisabledReason =
        "This automatic promoted acceptance is protected. Correct the code and capture a new main run.";
      variant.label = "Protected Solid";
    }
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("tab", { name: /Protected Solid/ })).toBeVisible();
  await page.keyboard.press("Shift+X");
  await callCount(page, 0);
  await expect(
    page.getByText(/No variants were changed.*Select an eligible variant/),
  ).toBeVisible();
  await page.keyboard.press("x");
  await callCount(page, 1);
});

test("already accepted history creates no session undo command", async ({ page }) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("noop"));
  await page.keyboard.press("a");
  await callCount(page, 1);
  await expect(page.getByText("This acceptance is already saved.")).toBeVisible();
  await expect(selected(page)).toContainText("React");
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
});

test("current evidence must load before review and stale pixels disappear immediately", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  await page.route("**/slow.svg", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="blue"/></svg>',
    });
  });
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const candidate = model.items[0]?.variants[1]?.candidate;
    if (candidate) candidate.url = "/slow.svg";
    window.reviewFixture.update(model);
  });
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-evidence="loading"]')).toBeVisible();
  await expect(page.locator(".review-viewer")).toHaveCSS("visibility", "hidden");
  await page.keyboard.press("a");
  await callCount(page, 0);
  await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeDisabled();
  await expect.poll(() => !!release).toBe(true);
  release?.();
  await ready(page);
  await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeEnabled();
});

test("load errors block review and retry loads the same evidence", async ({ page }) => {
  let failing = true;
  await page.route("**/retry.svg", async (route) => {
    if (failing) await route.abort();
    else
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"/>',
      });
  });
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const candidate = model.items[0]?.variants[0]?.candidate;
    if (candidate) candidate.url = "/retry.svg";
    window.reviewFixture.update(model);
  });
  await expect(page.getByText("Image evidence unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeDisabled();
  failing = false;
  await page.getByRole("button", { name: "Retry images" }).click();
  await ready(page);
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "New image", exact: true })
        .evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBe(600);
  await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeEnabled();
});

for (const kind of ["unchanged", "changed"] as const) {
  test(`${kind} comparisons with zero changed pixels show diff without a mask`, async ({
    page,
  }) => {
    await page.evaluate((kind) => {
      const model = window.reviewFixture.model();
      const variant = model.items[0]?.variants[0];
      if (!variant?.reference) throw new Error("Expected a paired comparison.");
      variant.kind = kind;
      variant.candidate = { ...variant.reference, id: "same-pixels-candidate" };
      variant.diff = null;
      variant.changedPixels = 0;
      variant.ratio = 0;
      variant.referenceProfile = "profile-before";
      variant.candidateProfile = kind === "changed" ? "profile-after" : "profile-before";
      window.reviewFixture.update(model);
    }, kind);
    await ready(page);
    await page.keyboard.press("d");
    await expect(page.getByRole("button", { name: "Pixel diff D" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await ready(page);
    await expect(page.getByText("No pixels changed.", { exact: true })).toBeVisible();
    await expect(page.getByText("Image evidence unavailable")).not.toBeVisible();
    await callCount(page, 0);
    if (kind === "changed") {
      await page.keyboard.press("a");
      await callCount(page, 1);
    }
  });
}

for (const kind of ["unchanged", "changed"] as const) {
  test(`${kind} comparisons with tolerated pixels show intentional mask absence`, async ({
    page,
  }) => {
    await page.evaluate((kind) => {
      const model = window.reviewFixture.model();
      const variant = model.items[0]?.variants[0];
      if (!variant) throw new Error("Expected a paired comparison.");
      variant.kind = kind;
      variant.diff = null;
      variant.changedPixels = 1;
      variant.ratio = 0.001;
      variant.maskExpected = false;
      variant.referenceProfile = "profile-before";
      variant.candidateProfile = kind === "changed" ? "profile-after" : "profile-before";
      window.reviewFixture.update(model);
    }, kind);
    await ready(page);
    await page.keyboard.press("d");
    await expect(page.getByRole("button", { name: "Pixel diff D" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await ready(page);
    await expect(
      page.getByText("Pixel changes are within the comparison tolerance.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No pixels changed.", { exact: true })).not.toBeVisible();
    await expect(page.getByText("Image evidence unavailable")).not.toBeVisible();
    if (kind === "changed") {
      await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeEnabled();
      await page.keyboard.press("a");
      await callCount(page, 1);
    }
  });
}

test("an explicitly required mask fails closed even with zero changed pixels", async ({ page }) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    const variant = model.items[0]?.variants[0];
    if (!variant) throw new Error("Expected a comparison.");
    variant.diff = null;
    variant.changedPixels = 0;
    variant.maskExpected = true;
    window.reviewFixture.update(model);
  });
  await ready(page);
  await page.keyboard.press("d");
  await expect(page.getByText(/Required diff evidence is unavailable/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeDisabled();
});

for (const changedPixels of [120, undefined]) {
  test(`a missing diff mask blocks review when changed pixels are ${changedPixels}`, async ({
    page,
  }) => {
    await page.evaluate((changedPixels) => {
      const model = window.reviewFixture.model();
      const variant = model.items[0]?.variants[0];
      if (!variant) throw new Error("Expected a comparison.");
      variant.diff = null;
      variant.changedPixels = changedPixels;
      window.reviewFixture.update(model);
    }, changedPixels);
    await ready(page);
    await page.keyboard.press("d");
    await expect(page.getByText("Image evidence unavailable")).toBeVisible();
    await expect(page.getByText(/Required diff evidence is unavailable/)).toBeVisible();
    await expect(page.locator(".review-viewer")).toHaveCSS("visibility", "hidden");
    await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeDisabled();
    await page.keyboard.press("a");
    await page.keyboard.press("x");
    await callCount(page, 0);
  });
}

for (const changedPixels of [0, 1]) {
  test(`${changedPixels}-pixel diff still waits for original images and blocks failed evidence`, async ({
    page,
  }) => {
    let release: (() => void) | undefined;
    await page.route("**/zero-pixel-reference.svg", async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.abort();
    });
    await page.evaluate((changedPixels) => {
      const model = window.reviewFixture.model();
      const variant = model.items[0]?.variants[0];
      if (!variant?.reference) throw new Error("Expected a paired comparison.");
      variant.reference.url = "/zero-pixel-reference.svg";
      variant.diff = null;
      variant.changedPixels = changedPixels;
      variant.ratio = changedPixels / 1000;
      if (changedPixels > 0) {
        variant.maskExpected = false;
      }
      window.reviewFixture.update(model);
    }, changedPixels);
    await page.keyboard.press("d");
    await expect(page.locator('[data-evidence="loading"]')).toBeVisible();
    await expect(page.locator(".review-viewer")).toHaveCSS("visibility", "hidden");
    await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeDisabled();
    await page.keyboard.press("a");
    await callCount(page, 0);
    await expect.poll(() => !!release).toBe(true);
    release?.();
    await expect(page.getByText("Image evidence unavailable")).toBeVisible();
    await expect(page.getByText(/The image could not be loaded/)).toBeVisible();
    await expect(page.getByText("No pixels changed.", { exact: true })).not.toBeVisible();
    await page.keyboard.press("x");
    await callCount(page, 0);
  });
}

test("addition and removal empty panes remain distinct and D keeps the current view", async ({
  page,
}) => {
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await ready(page);
  await expect(page.getByText("New image, no reference", { exact: true })).toBeVisible();
  await page.keyboard.press("f");
  await page.keyboard.press("d");
  await expect(page.getByRole("button", { name: "New only F" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText(/The current view has not changed/)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await ready(page);
  await expect(page.getByText("Removed, no new image", { exact: true })).toBeVisible();
  await page.keyboard.press("s");
  await expect(page.getByRole("img", { name: "Reference", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pixel diff D" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("shortcut scope, native modifiers, editing exclusions, and toggle", async ({ page }) => {
  await page.getByRole("textbox", { name: "Outside search" }).fill("hello");
  await page.keyboard.press("a");
  await callCount(page, 0);
  await focusWorkspace(page);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+x");
  await page
    .getByLabel("Review workspace", { exact: true })
    .dispatchEvent("keydown", { key: "a", repeat: true });
  await callCount(page, 0);
  for (const markup of [
    '<input aria-label="Exclusion input">',
    '<textarea aria-label="Exclusion textarea"></textarea>',
    '<div contenteditable="true" aria-label="Exclusion editable">Text</div>',
    '<div role="menu"><button>Menu item</button></div>',
    '<div role="dialog"><button>Dialog item</button></div>',
  ]) {
    await page.evaluate((markup) => {
      const holder = document.createElement("div");
      holder.id = "exclusion-fixture";
      holder.innerHTML = markup;
      document.querySelector(".review-workspace")?.appendChild(holder);
      const target = holder.querySelector<HTMLElement>("input,textarea,[contenteditable],button");
      target?.focus();
    }, markup);
    await page.keyboard.press("a");
    await page.keyboard.press("x");
    await page.keyboard.press("Control+z");
    await callCount(page, 0);
    await page.locator("#exclusion-fixture").evaluate((node) => node.remove());
  }
  await page.getByRole("button", { name: "Shortcuts on" }).click();
  await focusWorkspace(page);
  await page.keyboard.press("a");
  await page.keyboard.press("ArrowRight");
  await callCount(page, 0);
  await expect(selected(page)).toContainText("React");
  await page.getByRole("button", { name: "Approve A", exact: true }).click();
  await callCount(page, 1);
});

test("conflict identifies reviewer and does not advance or save a partial item", async ({
  page,
}) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("conflict"));
  await page.keyboard.press("Shift+A");
  await expect(page.getByRole("alert")).toContainText("Updated by octocat");
  await expect(selected(page)).toContainText("React");
  await expect(page.getByRole("tab", { name: /Solid.*Needs review/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
});

test("disconnect shows unsaved state and retries the same frozen command", async ({ page }) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.keyboard.press("a");
  await expect(page.getByRole("alert")).toContainText("Not saved");
  await expect(selected(page)).toContainText("React");
  await page.keyboard.press("x");
  await callCount(page, 1);
  await page.evaluate(() => window.reviewFixture.setBehavior("normal"));
  await page.getByRole("button", { name: "Retry same command" }).click();
  await expect(selected(page)).toContainText("Solid");
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[0]).toEqual(calls[1]);
});

test("Undo conflict preserves the selection and later reviewer state", async ({ page }) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Solid");
  await page.evaluate(() => window.reviewFixture.setBehavior("conflict"));
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("alert")).toContainText("A later promotion is current");
  await expect(selected(page)).toContainText("Solid");
});

test("help closes with Escape and keeps native focus without rejecting", async ({ page }) => {
  await page.getByRole("button", { name: "Keyboard help" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("x");
  await callCount(page, 0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Keyboard help" })).toBeFocused();
});

test("fit, 100%, 200%, and narrow layout preserve inspectable original images", async ({
  page,
}) => {
  await page.getByRole("button", { name: "100%", exact: true }).click();
  await expect(page.getByRole("img", { name: "New image", exact: true })).toHaveCSS(
    "width",
    "600px",
  );
  await page.getByRole("button", { name: "200%", exact: true }).click();
  await expect(page.getByRole("img", { name: "New image", exact: true })).toHaveCSS(
    "width",
    "1200px",
  );
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const panes = await page.locator(".review-pane").all();
  const first = await panes[0]?.boundingBox();
  const second = await panes[1]?.boundingBox();
  expect(second?.y).toBeGreaterThan(first?.y ?? 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 640, height: 480 });
  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("zoom-200.png"), fullPage: true });
});

test("stale decode completion cannot make a returned selection ready", async ({ page }) => {
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    const pending: Array<() => void> = [];
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      if (this.alt === "New image") await new Promise<void>((resolve) => pending.push(resolve));
    };
    Object.assign(window, {
      releaseOldDecode() {
        pending.shift()?.();
      },
      releaseCurrentDecode() {
        for (const resolve of pending) resolve();
        pending.length = 0;
      },
      queuedDecodes() {
        return pending.length;
      },
    });
  });
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() =>
      page.evaluate(() =>
        "queuedDecodes" in window && typeof window.queuedDecodes === "function"
          ? window.queuedDecodes()
          : 0,
      ),
    )
    .toBe(1);
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() =>
      page.evaluate(() =>
        "queuedDecodes" in window && typeof window.queuedDecodes === "function"
          ? window.queuedDecodes()
          : 0,
      ),
    )
    .toBe(2);
  await page.evaluate(() => {
    if ("releaseOldDecode" in window && typeof window.releaseOldDecode === "function")
      window.releaseOldDecode();
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.locator('[data-evidence="loading"]')).toBeVisible();
  await page.keyboard.press("a");
  await callCount(page, 0);
  await page.evaluate(() => {
    if ("releaseCurrentDecode" in window && typeof window.releaseCurrentDecode === "function")
      window.releaseCurrentDecode();
  });
  await ready(page);
});

test("keyboard pan preserves image position across modes and item thumbnails stay stable", async ({
  page,
}) => {
  const thumbnail = page.locator(".review-item").first().locator("img");
  const source = await thumbnail.getAttribute("src");
  await page.getByRole("button", { name: "200%", exact: true }).click();
  await page.getByRole("button", { name: "Pan New image right", exact: true }).focus();
  await page.keyboard.press("Enter");
  const viewport = page.getByLabel("New image. Use pan controls or scroll to inspect the image.", {
    exact: true,
  });
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await viewport.evaluate((element) => {
    element.scrollLeft = 100;
  });
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBe(100);
  const position = await viewport.evaluate((element) => element.scrollLeft);
  await focusWorkspace(page);
  await page.keyboard.press("f");
  await page.keyboard.press("s");
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBe(position);
  await page.keyboard.press("ArrowRight");
  await ready(page);
  await expect(thumbnail).toHaveAttribute("src", source ?? "");
});

test("session Undo ends on reload", async ({ page }) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Solid");
  await expect(page.getByRole("button", { name: /Undo/ })).toBeEnabled();
  await page.reload();
  await ready(page);
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
});

test("a stale latest Undo does not block an older independent session command", async ({
  page,
}) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Solid");
  await ready(page);
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Dark");
  await page.evaluate(() => window.reviewFixture.setBehavior("conflict"));
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("alert")).toContainText("A later promotion is current");
  await page.evaluate(() => window.reviewFixture.setBehavior("normal"));
  await page.keyboard.press("Control+z");
  await expect(selected(page)).toContainText("React");
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[3]?.commandId).toBe(calls[0]?.commandId);
  expect(calls[2]?.commandId).toBe(calls[1]?.commandId);
});

test("failed Undo retries its original command identity", async ({ page }) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Solid");
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("alert")).toContainText("Not saved");
  await page.evaluate(() => window.reviewFixture.setBehavior("normal"));
  await page.getByRole("button", { name: "Retry Undo", exact: true }).click();
  await expect(selected(page)).toContainText("React");
  const calls = await page.evaluate(() => window.reviewFixture.calls);
  expect(calls[1]).toEqual(calls[2]);
});

test("recompare keeps prior evidence visible and blocks review until the new comparison is ready", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Recompare stored run" }).click();
  await expect(page.getByText("Comparison 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "New image", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Recompare stored run" })).toBeDisabled();
  await page.evaluate(() => window.reviewFixture.completeComparison());
  await expect(page.getByText("Comparison 3", { exact: true })).toBeVisible();
  await ready(page);
  await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeEnabled();
});

test("archived history keeps navigation and export while blocking review, Undo, and recompare", async ({
  page,
}) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Solid");
  await callCount(page, 1);
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.archived = true;
    model.readOnlyReason = "This closed run is read-only. Its review history remains available.";
    model.reviewReady = false;
    window.reviewFixture.update(model);
  });
  await expect(page.getByText("This closed run is read-only.", { exact: false })).toBeVisible();
  await expect(
    page.getByText("Review is unavailable until the run is sealed", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reject X", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Undo", exact: false })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Recompare stored run" })).toBeDisabled();
  await focusWorkspace(page);
  await page.keyboard.press("a");
  await page.keyboard.press("x");
  await page.keyboard.press("Control+z");
  await callCount(page, 1);
  await page.keyboard.press("ArrowRight");
  await expect(selected(page)).toContainText("Dark");
  await page.getByRole("button", { name: "Export run" }).click();
  await expect(
    page.getByText("Export prepared. The download was requested.", { exact: true }),
  ).toBeVisible();
});

test("export gives pending and failure feedback without changing review verdicts", async ({
  page,
}) => {
  await page.evaluate(() => window.reviewFixture.setBehavior("delay"));
  await page.getByRole("button", { name: "Export run" }).click();
  await expect(page.getByText("Preparing a private export…", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export run" })).toBeDisabled();
  await page.evaluate(() => window.reviewFixture.resolve());
  await expect(
    page.getByText("Export prepared. The download was requested.", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.getByRole("button", { name: "Export run" }).click();
  await expect(
    page.getByText("Export failed. The export service is unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeEnabled();
  await callCount(page, 0);
});

test("closed retained runs can recompare while historical results remain read-only", async ({
  page,
}) => {
  await page.clock.install();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.archived = true;
    model.reviewReady = false;
    model.comparisonState = "ready";
    model.recompareAllowed = true;
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("button", { name: "Recompare stored run" })).toBeEnabled();
  await page.getByRole("button", { name: "Recompare stored run" }).click();
  await expect(page.locator(".review-run-identity")).toContainText("Comparison 2");
  await expect(page.getByRole("img", { name: "New image", exact: true })).toBeVisible();
  await page.clock.runFor(2100);
  await expect(page.locator(".review-run-identity")).toContainText("Comparison 2");
  await expect(
    page.getByText("The previous comparison remains visible", { exact: false }),
  ).toBeVisible();
  await page.evaluate(() => window.reviewFixture.completeComparison());
  await page.clock.runFor(2100);
  await expect(page.locator(".review-run-identity")).toContainText("Comparison 3");
  await expect(page.getByText("The new comparison is ready.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Original comparison" })).toHaveAttribute(
    "href",
    "/runs/run-42",
  );
  await expect(page.getByRole("link", { name: /Historical comparison 3/ })).toHaveAttribute(
    "href",
    "/runs/run-42?comparison=comparison-3",
  );
  await expect(page.getByRole("link", { name: /Historical comparison 3/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reject X", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
  await focusWorkspace(page);
  await page.keyboard.press("a");
  await page.keyboard.press("x");
  await page.keyboard.press("Control+z");
  await callCount(page, 0);
  // A changed service result after completion must not restart the finished poll.
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.clock.runFor(4100);
  await expect(page.getByText("The new comparison is ready.", { exact: true })).toBeVisible();
});

test("expired historical images show the server reason and do not permit recompare", async ({
  page,
}) => {
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.archived = true;
    model.reviewReady = false;
    model.comparisonState = "ready";
    model.recompareAllowed = false;
    model.recompareDisabledReason = "The stored images have expired.";
    window.reviewFixture.update(model);
  });
  await expect(page.getByRole("button", { name: "Recompare stored run" })).toBeDisabled();
  await expect(page.getByText("The stored images have expired.", { exact: true })).toBeVisible();
  await callCount(page, 0);
});

test("a failed historical comparison stops polling and shows its failure reason", async ({
  page,
}) => {
  await page.clock.install();
  await page.evaluate(() => {
    const model = window.reviewFixture.model();
    model.archived = true;
    model.reviewReady = false;
    model.comparisonState = "ready";
    model.recompareAllowed = true;
    window.reviewFixture.update(model);
  });
  await page.getByRole("button", { name: "Recompare stored run" }).click();
  await expect(
    page.getByText("The previous comparison remains visible", { exact: false }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.reviewFixture.setBehavior("comparison-failed");
    window.reviewFixture.completeComparison();
  });
  await page.clock.runFor(2100);
  await expect(page.getByRole("alert")).toHaveText("A stored image could not be read.");
  await expect(
    page.getByText("The previous comparison remains visible", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeDisabled();
  await page.evaluate(() => window.reviewFixture.setBehavior("offline"));
  await page.clock.runFor(4100);
  await expect(page.getByText("Waiting for the new comparison.", { exact: false })).toHaveCount(0);
  await callCount(page, 0);
});

test("a run that closes before recompare also disables the previous Undo while comparing", async ({
  page,
}) => {
  await page.keyboard.press("a");
  await expect(selected(page)).toContainText("Solid");
  await expect(page.getByRole("button", { name: /Undo/ })).toBeEnabled();
  await page.evaluate(() => window.reviewFixture.setBehavior("closed-before-recompare"));
  await page.getByRole("button", { name: "Recompare stored run" }).click();
  await expect(page.locator(".review-run-identity")).toContainText("Comparison 2");
  await expect(page.getByRole("button", { name: /Undo/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Approve A", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reject X", exact: true })).toBeDisabled();
  await focusWorkspace(page);
  await page.keyboard.press("Control+z");
  await callCount(page, 1);
});
