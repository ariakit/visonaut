import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { alertTexts } from "../components/operations-attention/alert-texts.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    files.push(path);
  }
  return files;
}

/** Each statement that inserts into `operations_events`, up to the end of its string. */
function alertStatements() {
  const statements: [string, string][] = [];
  for (const directory of ["apps/web/src", "packages"]) {
    for (const file of sourceFiles(join(root, directory))) {
      const source = readFileSync(file, "utf8");
      // `INSERT`, `INSERT OR IGNORE`, and the like, up to the quote that ends
      // the SQL string.
      for (const match of source.matchAll(
        /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+operations_events\b[^"`]*/g,
      )) {
        statements.push([relative(root, file), match[0]]);
      }
    }
  }
  return statements;
}

it("binds the kind of each alert that a statement writes", () => {
  const statements = alertStatements();
  // A new statement binds a value of `AlertKind`, so that the Status page has
  // its words. `recordEvent` is the usual way to write an alert.
  expect(statements.map(([file]) => file)).toEqual([
    "apps/web/src/operations/common.ts",
    "apps/web/src/operations/recovery.ts",
    "packages/service/src/run-retirement.ts",
  ]);
  for (const [file, statement] of statements) {
    for (const kind of Object.keys(alertTexts)) {
      expect([file, statement.includes(`'${kind}`)]).toEqual([file, false]);
    }
  }
});
