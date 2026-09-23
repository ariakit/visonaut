import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { digestJson, sha256 } from "./identity.mjs";

function expectedDigest(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Invalid ${label} digest`);
  }
  return value;
}

export async function executorDigest(directory) {
  const source = [];
  for (const file of (await readdir(directory)).sort()) {
    if (!/\.(mjs|json|pem)$/.test(file)) continue;
    const bytes = await readFile(path.join(directory, file));
    source.push({ file, digest: sha256(bytes) });
  }
  const lock = JSON.parse(await readFile(path.join(directory, "package-lock.json"), "utf8"));
  const names = ["@visonaut/playwright", "visonaut"];
  const locked = names.map((name) => lock.packages?.[`node_modules/${name}`]);
  const settings = JSON.parse(await readFile(path.join(directory, "settings.json"), "utf8"));
  if (locked.every(Boolean) && !settings.packages) {
    for (const [index, dependency] of locked.entries()) {
      if (!dependency.version || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(dependency.integrity)) {
        throw new Error(`The trusted executor must lock ${names[index]} by npm integrity`);
      }
    }
  } else if (locked.every((dependency) => !dependency) && settings.packages) {
    const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    if (names.some((name) => manifest.dependencies?.[name])) {
      throw new Error("Temporary bootstrap packages must not appear in the npm manifest");
    }
    for (const name of names) {
      const key = name === "visonaut" ? "cli" : "playwright";
      expectedDigest(settings.packages[key]?.sha256, `${name} bootstrap tarball`);
    }
  } else {
    throw new Error("The trusted executor needs one complete package integrity mode");
  }
  return digestJson(source);
}

export async function createTrustedPlan({
  directory,
  settings,
  shards,
  environmentProfileDigests,
}) {
  if (
    !/^[1-9][0-9]*$/.test(settings.repositoryId ?? "") ||
    !/^\.github\/workflows\/[a-z0-9-]+\.yml$/.test(settings.workflow ?? "")
  ) {
    throw new Error("Trusted plan requires a fixed repository ID and caller workflow");
  }
  if (!Array.isArray(shards) || !shards.length) throw new Error("Trusted plan requires shards");
  const keys = new Set();
  const plan = {
    schemaVersion: "1.0",
    repositoryId: settings.repositoryId,
    workflow: settings.workflow,
    invocation: ["playwright", "test", "--config", "playwright.config.mjs"],
    discovery: { executorDigest: await executorDigest(directory) },
    shards: shards.map(({ key, jobName, collection }) => {
      if (!/^[a-z0-9-]+$/.test(key) || keys.has(key) || !jobName || !collection) {
        throw new Error("Trusted plan has an invalid or duplicate shard");
      }
      keys.add(key);
      const digests = environmentProfileDigests[key];
      if (!Array.isArray(digests) || !digests.length) {
        throw new Error(`Register measured ${key} environment profiles`);
      }
      for (const digest of digests) expectedDigest(digest, key);
      if (new Set(digests).size !== digests.length) {
        throw new Error(`Duplicate ${key} environment profile`);
      }
      return { key, jobName, collection, environmentProfileDigests: digests };
    }),
  };
  return { plan, planDigest: digestJson(plan) };
}

export async function verifyTrustedPlan({ directory, planFile }) {
  const plan = JSON.parse(await readFile(planFile, "utf8"));
  const actual = await executorDigest(directory);
  if (plan.discovery?.executorDigest !== actual) {
    throw new Error("Trusted executor source does not match the plan");
  }
  return { plan, planDigest: digestJson(plan) };
}

export async function writeTrustedPlan(destination, options) {
  const result = await createTrustedPlan(options);
  await writeFile(destination, `${JSON.stringify(result.plan, null, 2)}\n`);
  return result;
}
