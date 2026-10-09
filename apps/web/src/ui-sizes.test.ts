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
  // The review workspace renders its own shell root.
  const workspace = readFileSync(join(source, "review/review-workspace.tsx"), "utf8");
  expect(workspace).toMatch(/<Shell\b[^>]*className="[^"]*\btext-sm\b/s);
  // The shell of each other page takes the size from one token.
  const tokens = readFileSync(join(source, "components/kit/tokens.ts"), "utf8");
  expect(tokens).toMatch(/export const pageRoot = "text-sm";/);
  const shell = readFileSync(join(source, "components/kit/shell.tsx"), "utf8");
  expect(shell).toMatch(/<Shell\b[^>]*className=\{cx\(pageRoot,/s);
  // No other file renders a shell root.
  expect(find(/<Shell\b/).toSorted()).toEqual([
    "components/kit/shell.tsx",
    "review/review-workspace.tsx",
  ]);
});

test("the style sheet that has the theme is imported once", () => {
  expect(find(/(?<!@)\bimport\s+["'][./]*\/?review\.css["']/)).toEqual([]);
  expect(find(/@import\s+["']\.\/review\.css["']/)).toEqual(["styles.css"]);
});

test("text and icons take their color from the text system", () => {
  // opacity-N dims the whole element. ak-ink-N changes only the text color.
  // The start state of a fade (`starting:opacity-0`) is motion, not a color.
  expect(find(/(?<!starting:)\bopacity-/)).toEqual([]);
  // A color-named ink class is not a rule: use $text. Only ak-ink-N exists.
  expect(find(/\bak-ink-[a-z]/)).toEqual([]);
});
