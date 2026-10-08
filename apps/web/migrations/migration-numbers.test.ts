import { readdirSync } from "node:fs";
import { expect, it } from "vitest";

// Wrangler applies migrations in file name order. Two files with the same
// number merge without a Git conflict, so only this test catches them. The
// 0030 pair already ran in production and cannot be renamed.
const knownDuplicates = ["0030_local_zero_pixel_reviews.sql", "0030_review_queue_index.sql"];

it("has no migration number twice except the known pair", () => {
  const names = readdirSync(new URL(".", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  expect(names.filter((name) => !/^\d{4}_.+\.sql$/u.test(name))).toEqual([]);
  const numbers = names.map((name) => name.slice(0, 4));
  const duplicates = names.filter(
    (name) => numbers.indexOf(name.slice(0, 4)) !== numbers.lastIndexOf(name.slice(0, 4)),
  );
  expect(duplicates).toEqual(knownDuplicates);
});
