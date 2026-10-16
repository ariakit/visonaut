import { expect, test } from "vitest";
import { formatRatio } from "../format.ts";
import { getVariantWords, isSizeChange } from "../session.ts";
import { getFullName } from "../variants/model.ts";
import { createVariant } from "./session-fixtures.ts";

test("the words of a variant leave out the axes that have their normal value", () => {
  const variant = createVariant("button/page", 0, {
    status: "needs-review",
    axes: { browser: "webkit", colorScheme: "dark", contrast: "more", viewport: "desktop" },
  });
  expect(getVariantWords(variant)).toEqual(["React", "WebKit", "Desktop", "Dark", "More contrast"]);
  expect(getVariantWords(variant, ["browser", "colorScheme"])).toEqual(["WebKit", "Dark"]);
  expect(getFullName(variant)).toBe("React · WebKit · Desktop · Dark · More contrast");
});

test("the style adds a word only when it differs from the color scheme", () => {
  const same = createVariant("button/page", 0, {
    status: "needs-review",
    axes: { colorScheme: "dark", style: "dark" },
  });
  expect(getVariantWords(same)).toEqual(["React", "Chromium", "Dark"]);
  const other = createVariant("previews/page", 0, {
    status: "needs-review",
    axes: { colorScheme: "light", style: "dark" },
  });
  expect(getVariantWords(other)).toEqual(["React", "Chromium", "Light", "Dark style"]);
});

test("a size change has two images of different sizes", () => {
  const image = { id: "a", url: "/a.png", digest: "a", width: 100, height: 50 };
  expect(isSizeChange({ reference: image, candidate: { ...image, height: 60 } })).toBe(true);
  expect(isSizeChange({ reference: image, candidate: { ...image } })).toBe(false);
  expect(isSizeChange({ reference: null, candidate: image })).toBe(false);
});

test("a changed pixel ratio reads as a percentage", () => {
  expect(formatRatio(0)).toBe("0%");
  expect(formatRatio(0.00005)).toBe("<0.01%");
  expect(formatRatio(0.0015)).toBe("0.15%");
  expect(formatRatio(0.5)).toBe("50%");
});
