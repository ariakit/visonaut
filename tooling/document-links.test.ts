import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

const documentPatterns = [
  "README.md",
  ".github/workflows/README.md",
  "apps/web/src/operations/README.md",
  "packages/*/README.md",
  "docs/**/*.md",
];

// A dated record below docs/history can name a file that a later commit
// removed. Each entry is "<document> -> <target>", with paths from the root.
// Keep the entries sorted, because brokenLinks() sorts its result.
const removedTargets = [
  "docs/history/evidence/diagnostic-check-rename-repair.md -> apps/web/tooling/check-rename-repair/README.md",
  "docs/history/evidence/issue-204-ci/README.md -> .github/workflows/scripts/packages.test.mjs",
  "docs/history/evidence/visonaut-hosted-topology.md -> apps/webhook/src/index.test.ts",
];

// Each pattern captures one link target: a Markdown inline link, a Markdown
// reference definition (but not a footnote), and an HTML `href` or `src`
// attribute.
const linkPatterns = [
  /\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*)?\)/g,
  /^\s{0,3}\[(?!\^)[^\]]+\]:\s*<?([^\s>]+)>?/g,
  /\b(?:href|src)\s*=\s*["']([^"']+)["']/g,
];

// Matches a code span: text between two equal runs of backticks.
const codeSpan = /(`+)(?:(?!\1).)+?\1/g;

// Matches a line that can open or close a code fence.
const fenceLine = /^\s*(`{3,}|~{3,})(.*)$/;

/**
 * Returns the target of each link in a Markdown text. Text in a code fence or
 * in a code span is not a link.
 */
function linkTargets(markdown: string): string[] {
  const targets: string[] = [];
  let fence: string | undefined;
  for (const line of markdown.split("\n")) {
    const match = fenceLine.exec(line);
    if (match) {
      const [, marker = "", rest = ""] = match;
      if (!fence) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length && !rest.trim()) {
        // Only a fence of the same character, at least as long, and with no
        // text after it closes the block.
        fence = undefined;
      }
      continue;
    }
    if (fence) continue;
    const text = line.replace(codeSpan, "");
    for (const pattern of linkPatterns) {
      for (const linkMatch of text.matchAll(pattern)) {
        const target = linkMatch[1];
        if (target) {
          targets.push(target);
        }
      }
    }
  }
  return targets;
}

// A relative link has no scheme, is not only a fragment, and does not start
// at the root of a site or of a disk.
function isRelative(target: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false;
  if (target.startsWith("#")) return false;
  if (target.startsWith("/")) return false;
  return true;
}

function brokenLinks(): string[] {
  const broken: string[] = [];
  for (const document of globSync(documentPatterns, { cwd: root })) {
    const markdown = readFileSync(resolve(root, document), "utf8");
    for (const target of linkTargets(markdown)) {
      if (!isRelative(target)) continue;
      const [path = ""] = target.split(/[?#]/);
      const file = resolve(root, dirname(document), decodeURIComponent(path));
      if (existsSync(file)) continue;
      broken.push(`${document} -> ${relative(root, file)}`);
    }
  }
  return broken.sort();
}

test("each relative link of the repository documents names a file that exists", () => {
  expect(brokenLinks()).toEqual(removedTargets);
});

test("reads links outside code, and a nested fence does not end a code block", () => {
  const markdown = [
    "[inline](a.md) and `[span](skipped.md)`",
    "````md",
    "```ts",
    "[nested](skipped.md)",
    "```",
    "````",
    "```",
    "```ts",
    "[text after the marker](skipped.md)",
    "```",
    "[reference]: b.md",
    "[^1]: A footnote.",
    '<a href="c.html">after the code</a>',
  ].join("\n");
  expect(linkTargets(markdown)).toEqual(["a.md", "b.md", "c.html"]);
});

test("a shorter marker or a marker of another character does not close a code fence", () => {
  const markdown = [
    "````md",
    "```",
    "[after a shorter marker](skipped.md)",
    "````",
    "```",
    "~~~",
    "[after a marker of the other character](skipped.md)",
    "```",
    "[after the code](a.md)",
  ].join("\n");
  expect(linkTargets(markdown)).toEqual(["a.md"]);
});
