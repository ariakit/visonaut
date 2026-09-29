import { readdir, readFile, realpath, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { digestJson, sha256 } from "@visonaut/protocol";

interface FontFile {
  file: string;
  digest: string;
}
interface FontRecord extends FontFile {
  root: number;
}

export interface MeasureEnvironmentOptions {
  appPackageFile?: string;
  outputDirectory?: string;
  applicationFontPackage?: string;
  systemFontRoots?: string[];
}

export interface MeasuredEnvironment {
  osImage: { os: string; imageVersion: string; architecture: string };
  profile: { osImageDigest: string; fontsDigest: string };
  fonts: FontRecord[];
  systemFontRootCount: number;
  fontPackage: string | null;
}

async function fontFiles(directory: string, relative = ""): Promise<FontFile[]> {
  let entries;
  try {
    entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const files: FontFile[] = [];
  for (const entry of entries) {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await fontFiles(directory, file)));
    } else if (/\.(ttf|otf|ttc|woff2?)$/i.test(entry.name)) {
      files.push({
        file: file.split(path.sep).join("/"),
        digest: await sha256(await readFile(path.join(directory, file))),
      });
    }
  }
  return files.sort((left, right) => left.file.localeCompare(right.file, "en"));
}

export async function measureEnvironment({
  appPackageFile,
  outputDirectory,
  applicationFontPackage,
  systemFontRoots,
}: MeasureEnvironmentOptions): Promise<MeasuredEnvironment> {
  const systemRoots =
    systemFontRoots ??
    (process.platform === "darwin"
      ? ["/System/Library/Fonts", "/Library/Fonts"]
      : ["/usr/share/fonts", "/usr/local/share/fonts"]);
  const roots = [...systemRoots];
  if (applicationFontPackage) {
    if (!appPackageFile) {
      throw new Error("Application fonts need an app package file");
    }
    const require = createRequire(appPackageFile);
    roots.push(
      await realpath(path.dirname(require.resolve(`${applicationFontPackage}/package.json`))),
    );
  }
  const fonts = [];
  for (const [index, root] of roots.entries()) {
    for (const file of await fontFiles(root)) {
      fonts.push({ root: index, ...file });
    }
  }
  if (!fonts.length) throw new Error("No system or application fonts were measured");
  const osImage = {
    os: process.env.ImageOS ?? process.platform,
    imageVersion: process.env.ImageVersion ?? "local-probe-only",
    architecture: process.arch,
  };
  const profile = {
    osImageDigest: await digestJson(osImage),
    fontsDigest: await digestJson(fonts),
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
