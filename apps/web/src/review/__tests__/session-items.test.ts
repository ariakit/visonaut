import { expect, test } from "vitest";
import type { ReviewItem, ReviewVariant, ReviewVariantPart } from "../model.ts";
import { getFamilyLabels, getSessionItem, pickItem, pickVariant } from "../session-items.ts";

function parts(framework: string, browser: string, colorScheme: string): ReviewVariantPart[] {
  return [
    { kind: "framework", value: framework },
    { kind: "browser", value: browser },
    { kind: "colorScheme", value: colorScheme },
    { kind: "contrast", value: "no-preference" },
    { kind: "forcedColors", value: "none" },
  ];
}

function variant(key: string, fields: Partial<ReviewVariant> = {}): ReviewVariant {
  return {
    id: `row-${key}`,
    key,
    label: key,
    kind: "changed",
    revision: 0,
    verdict: null,
    source: null,
    reference: null,
    candidate: null,
    diff: null,
    ...fields,
  };
}

function item(key: string, variants: ReviewVariant[], name = key): ReviewItem {
  return { key, name, variants };
}

test("a variant is named by the axes that differ in its screenshot", () => {
  const screenshot = getSessionItem(
    item("ariakit-ui-button/page/segmented-control", [
      variant("react-app-desktop-light-light-no-preference-none", {
        labelParts: parts("react", "chromium", "light"),
      }),
      variant("react-app-desktop-dark-dark-no-preference-none", {
        labelParts: parts("react", "firefox", "dark"),
        verdict: "approved",
      }),
    ]),
  );
  expect(screenshot).toMatchObject({
    label: "Segmented control",
    family: "ariakit-ui-button",
    group: "page",
    status: "needs-review",
  });
  expect(screenshot.variants.map((entry) => entry.name)).toEqual([
    "Chromium · Light",
    "Firefox · Dark",
  ]);
  expect(screenshot.variants[1]).toMatchObject({
    index: 1,
    itemKey: "ariakit-ui-button/page/segmented-control",
    status: "approved",
    automatic: false,
    axes: { browser: "firefox", colorScheme: "dark", viewport: "desktop", style: "dark" },
  });
});

test("a declared screenshot name is the label, and variants with the same axes keep their keys", () => {
  const screenshot = getSessionItem(
    item("dialog/open", [variant("React"), variant("Solid")], "Success dialog"),
  );
  expect(screenshot.label).toBe("Success dialog");
  expect(screenshot.variants.map((entry) => entry.name)).toEqual(["React", "Solid"]);
});

test("an axis value that is a property name of each object is a word of its own", () => {
  const screenshot = getSessionItem(
    item("prototype/page", [
      variant("react-app-constructor-light-light-no-preference-none", {
        labelParts: parts("react", "chromium", "light"),
      }),
      variant("react-app-toString-light-light-no-preference-none", {
        labelParts: parts("react", "chromium", "light"),
      }),
    ]),
  );
  expect(screenshot.variants.map((entry) => entry.name)).toEqual(["Constructor", "ToString"]);
});

test("a screenshot opens on its first variant to review, else its first change", () => {
  const unchanged = variant("unchanged", { kind: "unchanged" });
  const approved = variant("approved", { verdict: "approved" });
  const open = variant("open");
  expect(pickVariant(item("a", [unchanged, approved, open]))?.key).toBe("open");
  expect(pickVariant(item("b", [unchanged, approved]))?.key).toBe("approved");
  expect(pickVariant(item("c", [unchanged]))?.key).toBe("unchanged");
});

test("a page opens on the first screenshot to review, else the first change", () => {
  const unchanged = item("a", [variant("light", { kind: "unchanged" })]);
  const approved = item("b", [variant("light", { verdict: "approved" })]);
  const open = item("c", [variant("light")]);
  expect(pickItem([unchanged, approved, open])?.key).toBe("c");
  expect(pickItem([unchanged, approved])?.key).toBe("b");
  expect(pickItem([unchanged])?.key).toBe("a");
  expect(pickItem([])).toBeUndefined();
});

test("a family label drops the prefix that most families share", () => {
  const labels = getFamilyLabels([
    "ariakit-ui-button",
    "ariakit-ui-dialog",
    "ariakit-ui-",
    "ariakit-ui-button",
    "menu",
  ]);
  expect(Object.fromEntries(labels)).toEqual({
    "ariakit-ui-button": "button",
    "ariakit-ui-dialog": "dialog",
    // A family that is only the prefix keeps its name.
    "ariakit-ui-": "ariakit-ui-",
    menu: "menu",
  });
  // With no prefix that most families share, each family keeps its name.
  expect(Object.fromEntries(getFamilyLabels(["ariakit-button", "dialog"]))).toEqual({
    "ariakit-button": "ariakit-button",
    dialog: "dialog",
  });
});
