import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const source = fileURLToPath(new URL(".", import.meta.url));

// The copy of Ariakit UI is upstream code and has its own sizes.
const files = globSync("**/*.{ts,tsx,css}", { cwd: source }).filter(
  (file) => !file.startsWith("components/ariakit/") && file !== "ui-sizes.test.ts",
);

function find(pattern: RegExp) {
  return files.filter((file) => pattern.test(readFileSync(join(source, file), "utf8")));
}

test("no class sets a fixed text size", () => {
  expect(find(/\btext-\[(length:)?[\d.]+(px|rem|em)\]|\[font-size:|fontSize:/)).toEqual([]);
});

test("each page shell sets the one base text size", () => {
  const shells = [
    "review/review-workspace.tsx",
    "dashboard/dashboard-page.tsx",
    "routes/_app/pulls.$pullNumber.tsx",
    "routes/_app/runs.$runId.tsx",
  ];
  for (const file of shells) {
    const content = readFileSync(join(source, file), "utf8");
    expect(content, file).toMatch(/<Shell\b[^>]*className="[^"]*\btext-sm\b/s);
  }
});

test("the style sheet that has the theme is imported once", () => {
  expect(find(/(?<!@)\bimport\s+["'][./]*\/?review\.css["']/)).toEqual([]);
  expect(find(/@import\s+["']\.\/review\.css["']/)).toEqual(["styles.css"]);
});

test("text and icons take their color from the text system", () => {
  // opacity-N dims the whole element. ak-ink-N changes only the text color.
  expect(find(/\bopacity-/)).toEqual([]);
  // A color-named ink class is not a rule: use $text. Only ak-ink-N exists.
  expect(find(/\bak-ink-[a-z]/)).toEqual([]);
});
