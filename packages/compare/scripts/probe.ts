import { readFile, writeFile, mkdir } from "node:fs/promises";

const base = process.env.CODEC_PROBE_URL;
const token = process.env.CODEC_PROBE_TOKEN;
if (!base || !token) {
  throw new Error(
    "Set CODEC_PROBE_URL and CODEC_PROBE_TOKEN; optional first argument is a maximum-size corpus image.",
  );
}
const endpoint = new URL("/probe", base);
const expectedDigest = "ba55437d5e0f101d9f864700fe816e2a128ca2612e7693942cb21d7fe3c229a0";
const reports: unknown[] = [];

async function send(
  bytes: Uint8Array<ArrayBuffer>,
  expectedStatus: number,
  label: string,
  requireDigest = false,
) {
  const response = await fetch(endpoint, {
    method: "POST",
    body: bytes,
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
  });
  const result: unknown = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(`${label}: expected HTTP ${expectedStatus}, received ${response.status}`);
  }
  if (
    requireDigest &&
    (!result ||
      typeof result !== "object" ||
      !("rgbaDigest" in result) ||
      result.rgbaDigest !== expectedDigest)
  ) {
    throw new Error(`${label}: RGBA fixture digest mismatch`);
  }
  reports.push({ label, status: response.status, result });
}

for (const name of ["rgba.png", "rgba.webp", "rgba-profiled.png", "rgba-profiled.webp"]) {
  await send(
    Uint8Array.from(await readFile(new URL(`../test/fixtures/${name}`, import.meta.url))),
    200,
    name,
    true,
  );
}
await send(
  Uint8Array.from(await readFile(new URL("../test/fixtures/lossy.webp", import.meta.url))),
  422,
  "lossy-rejected",
);
const corrupt = Uint8Array.from(
  await readFile(new URL("../test/fixtures/rgba.png", import.meta.url)),
);
corrupt[29] = (corrupt[29] ?? 0) ^ 1;
await send(corrupt, 422, "bad-crc-rejected");
const unknown = Uint8Array.from(
  await readFile(new URL("../test/fixtures/rgba-profiled.webp", import.meta.url)),
);
unknown[65] = (unknown[65] ?? 0) ^ 1;
await send(unknown, 422, "unknown-profile-rejected");
await send(new Uint8Array(2 * 1024 * 1024 + 1), 422, "oversized-rejected");
const unauthorized = await fetch(endpoint, {
  method: "POST",
  body: new Uint8Array(12),
  redirect: "error",
});
if (unauthorized.status !== 401) {
  throw new Error("Probe accepted an unauthenticated request");
}
reports.push({ label: "unauthenticated-rejected", status: unauthorized.status });
if (process.argv[2]) {
  const largest = Uint8Array.from(await readFile(process.argv[2]));
  for (let i = 0; i < 3; i += 1) {
    await send(largest, 200, `maximum-pair-${i + 1}`);
  }
}
const evidence = {
  date: new Date().toISOString(),
  endpoint: endpoint.toString(),
  node: process.version,
  results: reports,
  limitation:
    "Elapsed wall time and WASM linear memory are not peak isolate memory or Worker CPU; attach deployed Worker trace measurements separately.",
};
await mkdir(new URL("../evidence/", import.meta.url), { recursive: true });
const filename =
  endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost"
    ? "local-worker-probe.json"
    : "hosted-worker-probe.json";
await writeFile(
  new URL(`../evidence/${filename}`, import.meta.url),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(JSON.stringify(evidence, null, 2));
