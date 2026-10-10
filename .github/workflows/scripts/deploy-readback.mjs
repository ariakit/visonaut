import assert from "node:assert/strict";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

/** Read the version that production serves. It throws when `/health` gives no usable answer. */
export async function readHealthVersion(request = fetch) {
  const response = await request("https://visonaut.com/health", {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const health = await response.json();
  return health?.version;
}

/**
 * Read the version until it is `commit`. A new version needs some seconds to
 * reach each location, so an old version or a failed read is tried again.
 * It throws after the last attempt, and it changes nothing in production.
 */
export async function readBack({ commit, read, wait, attempts = 20, delay = 5_000, log }) {
  let last = "no answer";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const version = await read();
      if (version === commit) {
        log(`Production /health serves the version ${commit} (attempt ${attempt}).`);
        return;
      }
      last = `version ${JSON.stringify(version) ?? "missing"}`.slice(0, 120);
    } catch (error) {
      last = (error instanceof Error ? error.message : String(error)).slice(0, 120);
    }
    log(`Attempt ${attempt} of ${attempts}: ${last}`);
    if (attempt < attempts) {
      await wait(delay);
    }
  }
  throw new Error(
    `Production /health does not serve the version ${commit} after ${attempts} attempts. ` +
      `Last answer: ${last}. The deploy command finished before this check, ` +
      "so production can run another version. This check starts no rollback.",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const commit = process.env.GITHUB_SHA;
  assert(/^[a-f0-9]{40}$/.test(commit ?? ""), "GITHUB_SHA is not a commit");
  await readBack({ commit, read: readHealthVersion, wait: sleep, log: console.log });
}
