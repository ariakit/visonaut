import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "source-id": { type: "string" },
    "source-name": { type: "string" },
    "target-id": { type: "string" },
    "target-name": { type: "string" },
    "source-images": { type: "string" },
    "target-images": { type: "string" },
    "source-quarantine": { type: "string" },
    "target-quarantine": { type: "string" },
    project: { type: "string" },
  },
});
for (const [key, value] of Object.entries(values)) {
  if (!value?.trim()) {
    throw new Error(`A value is required for --${key}.`);
  }
}
const required = [
  "source-id",
  "source-name",
  "target-id",
  "target-name",
  "source-images",
  "target-images",
  "project",
];
for (const key of required) {
  if (!values[key]) {
    throw new Error(`--${key} is required.`);
  }
}
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
if (!uuid.test(values["source-id"]) || !uuid.test(values["target-id"])) {
  throw new Error("Source and target must have explicit D1 UUIDs.");
}
if (values["source-id"] === values["target-id"]) {
  throw new Error("Source and target databases must differ.");
}
if (Boolean(values["source-quarantine"]) !== Boolean(values["target-quarantine"])) {
  throw new Error("Provide both quarantine bucket names or neither.");
}
const quarantineBindings = values["source-quarantine"]
  ? [
      { binding: "SOURCE_QUARANTINE", bucket_name: values["source-quarantine"], remote: true },
      { binding: "TARGET_QUARANTINE", bucket_name: values["target-quarantine"], remote: true },
    ]
  : [];
const config = {
  name: "visonaut-local-baseline-reset",
  main: "worker.ts",
  compatibility_date: "2026-09-22",
  workers_dev: false,
  preview_urls: false,
  routes: [],
  dev: { ip: "127.0.0.1", port: 8790 },
  vars: {
    SOURCE_DATABASE_ID: values["source-id"],
    TARGET_DATABASE_ID: values["target-id"],
    RESET_PROJECT_ID: values.project,
  },
  d1_databases: [
    {
      binding: "SOURCE_DB",
      database_name: values["source-name"],
      database_id: values["source-id"],
      remote: true,
    },
    {
      binding: "TARGET_DB",
      database_name: values["target-name"],
      database_id: values["target-id"],
      migrations_dir: "../../migrations",
      remote: true,
    },
  ],
  r2_buckets: [
    { binding: "SOURCE_IMAGES", bucket_name: values["source-images"], remote: true },
    { binding: "TARGET_IMAGES", bucket_name: values["target-images"], remote: true },
    ...quarantineBindings,
  ],
};
writeFileSync(
  new URL("wrangler.local.json", import.meta.url),
  `${JSON.stringify(config, null, 2)}\n`,
  { flag: "wx" },
);
console.log("Created the ignored local configuration. Review its bindings before use.");
