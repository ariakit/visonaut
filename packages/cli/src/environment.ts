import { join } from "node:path";
import { digestJson, type Manifest } from "@visonaut/protocol";
import { CliError, record } from "./errors.js";
import { readBounded } from "./files.js";

/** A plain bundle retains measured rendering evidence, separate from comparison policy. */
export async function validateEnvironment(directory: string, manifest: Manifest) {
  const bytes = await readBounded(join(directory, "environment.json"), 8 * 1024 * 1024);
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  if (
    !record(value) ||
    !record(value.profile) ||
    !record(value.osImage) ||
    !Array.isArray(value.fonts) ||
    !value.fonts.length ||
    !Number.isSafeInteger(value.systemFontRootCount) ||
    Number(value.systemFontRootCount) < 1 ||
    value.profile.osImageDigest !== (await digestJson(value.osImage)) ||
    value.profile.fontsDigest !== (await digestJson(value.fonts)) ||
    Object.hasOwn(value.profile, "comparisonPolicyDigest") ||
    Object.hasOwn(value.profile, "comparisonEngineVersion")
  ) {
    throw new CliError("The measured rendering environment is invalid.", 4);
  }
  for (const font of value.fonts) {
    if (
      !record(font) ||
      !Number.isSafeInteger(font.root) ||
      Number(font.root) < 0 ||
      Number(font.root) > Number(value.systemFontRootCount) ||
      typeof font.file !== "string" ||
      !font.file ||
      typeof font.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(font.digest)
    ) {
      throw new CliError("The measured font inventory is invalid.", 4);
    }
  }
  for (const { profile } of manifest.profiles) {
    if (
      profile.osImageDigest !== value.profile.osImageDigest ||
      profile.fontsDigest !== value.profile.fontsDigest ||
      Object.hasOwn(profile, "comparisonPolicyDigest") ||
      Object.hasOwn(profile, "comparisonEngineVersion")
    ) {
      throw new CliError("A capture profile differs from its measured rendering environment.", 4);
    }
  }
}
