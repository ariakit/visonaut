import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const token = randomBytes(32).toString("hex");
writeFileSync(new URL(".probe-token", import.meta.url), token, { mode: 0o600, flag: "wx" });
writeFileSync(
  new URL(".probe-secrets.json", import.meta.url),
  JSON.stringify({ PROBE_TOKEN: token }),
  { mode: 0o600, flag: "wx" },
);
