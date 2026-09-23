import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const secrets = Object.fromEntries(
  ["DRILL_TOKEN", "AUTH_SECRET", "INGEST_CAPABILITY_SECRET"].map((key) => [
    key,
    randomBytes(32).toString("hex"),
  ]),
);
for (const [name, value] of [
  ["drill-token", secrets.DRILL_TOKEN],
  ["auth-secret", secrets.AUTH_SECRET],
  ["ingest-secret", secrets.INGEST_CAPABILITY_SECRET],
  ["secrets-before.json", JSON.stringify(secrets)],
]) {
  writeFileSync(new URL(name, import.meta.url), value, { flag: "wx", mode: 0o600 });
}
