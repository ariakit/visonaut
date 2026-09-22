import { readFileSync } from "node:fs";
import { summarize } from "./run.mjs";

const defaultFile = new URL(
  "../../../../docs/evidence/review-scale/measurements.json",
  import.meta.url,
);
const data = JSON.parse(readFileSync(process.argv[2] || defaultFile, "utf8"));

function cell(values) {
  const statistics = summarize(values);
  if (!statistics) return "No completed samples";
  return [statistics.p50, statistics.p95, statistics.max]
    .map((value) => value.toFixed(1))
    .join(" / ");
}

console.log("| Captures | Items | List | Current images | Cached next variant |");
console.log("| ---: | ---: | ---: | ---: | ---: |");
for (const record of data.cases) {
  const first = record.samples[0];
  const list = cell(record.samples.map((sample) => sample.renderToListPaintOpportunityMs));
  const images = cell(record.samples.map((sample) => sample.renderToImagePaintOpportunityMs));
  const next = cell(
    record.navigation
      .filter((entry) => entry.key === "ArrowRight")
      .map((entry) => entry.paintOpportunityMs),
  );
  console.log(
    `| ${record.count.toLocaleString("en-US")} | ${first?.items.toLocaleString("en-US") ?? "—"} | ${list} | ${images} | ${next} |`,
  );
}
