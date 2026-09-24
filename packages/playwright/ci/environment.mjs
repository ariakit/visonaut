import { readdir, readFile, realpath, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { digestJson, sha256 } from "./identity.mjs";

async function fontFiles(directory, relative = "") {
  let entries;
  try {
    entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await fontFiles(directory, file)));
    else if (/\.(ttf|otf|ttc|woff2?)$/i.test(entry.name)) {
      files.push({
        file: file.split(path.sep).join("/"),
        digest: sha256(await readFile(path.join(directory, file))),
      });
    }
  }
  return files.sort((left, right) => left.file.localeCompare(right.file, "en"));
}

export async function measureEnvironment({
  appPackageFile,
  outputDirectory,
  comparisonPolicyDigest,
  comparisonEngineVersion,
  applicationFontPackage,
  systemFontRoots,
}) {
  if (
    !/^[a-f0-9]{64}$/.test(comparisonPolicyDigest) ||
    typeof comparisonEngineVersion !== "string" ||
    !comparisonEngineVersion
  ) {
    throw new Error("Capture needs an approved comparator digest and engine version");
  }
  const systemRoots =
    systemFontRoots ??
    (process.platform === "darwin"
      ? ["/System/Library/Fonts", "/Library/Fonts"]
      : ["/usr/share/fonts", "/usr/local/share/fonts"]);
  const roots = [...systemRoots];
  if (applicationFontPackage) {
    const require = createRequire(appPackageFile);
    roots.push(
      await realpath(path.dirname(require.resolve(`${applicationFontPackage}/package.json`))),
    );
  }
  const fonts = [];
  for (const [index, root] of roots.entries()) {
    for (const file of await fontFiles(root)) fonts.push({ root: index, ...file });
  }
  if (!fonts.length) throw new Error("No system or application fonts were measured");
  const osImage = {
    os: process.env.ImageOS ?? process.platform,
    imageVersion: process.env.ImageVersion ?? "local-probe-only",
    architecture: process.arch,
  };
  const profile = {
    osImageDigest: digestJson(osImage),
    fontsDigest: digestJson(fonts),
    comparisonPolicyDigest,
    comparisonEngineVersion,
  };
  const result = {
    osImage,
    profile,
    fonts,
    systemFontRootCount: systemRoots.length,
    fontPackage: applicationFontPackage ?? null,
  };
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(path.join(outputDirectory, "environment.json"), `${JSON.stringify(result)}\n`);
  }
  return result;
}
