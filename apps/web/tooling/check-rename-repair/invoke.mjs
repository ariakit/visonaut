import { readFile } from "node:fs/promises";

const [mode, expectedWorkerVersion] = process.argv.slice(2);
if (mode !== "inspect" && mode !== "settle") {
  throw new Error("Use inspect or settle as the first argument");
}
if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(expectedWorkerVersion ?? "")) {
  throw new Error("Pass the deployed fixed Worker version ID as the second argument");
}

const vars = await readFile(new URL(".dev.vars", import.meta.url), "utf8");
const line = vars.split(/\r?\n/).find((value) => value.startsWith("REPAIR_AUTH_TOKEN="));
if (!line) {
  throw new Error("The local repair authorization token is unavailable");
}
const raw = line.slice("REPAIR_AUTH_TOKEN=".length).trim();
const token = raw.startsWith('"') ? JSON.parse(raw) : raw;
if (typeof token !== "string" || token.length < 32) {
  throw new Error("The local repair authorization token is invalid");
}

const response = await fetch("http://127.0.0.1:8788/repair", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ mode, expectedWorkerVersion }),
  signal: AbortSignal.timeout(120000),
});
const result = await response.json();
console.log(JSON.stringify({ status: response.status, result }, null, 2));
if (!response.ok) {
  process.exitCode = 1;
}
