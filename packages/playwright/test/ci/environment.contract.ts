import { measureEnvironment } from "../../ci/index.mjs";

type MeasureOptions = Parameters<typeof measureEnvironment>[0];

const fontOptions: MeasureOptions = {
  appPackageFile: "/app/package.json",
  applicationFontPackage: "@fontsource-variable/inter",
  comparisonPolicyDigest: "a".repeat(64),
  comparisonEngineVersion: "rgba-visible-1",
};

// @ts-expect-error An application font package requires an app package path.
const missingAppPackageFile: MeasureOptions = {
  applicationFontPackage: "@fontsource-variable/inter",
  comparisonPolicyDigest: "a".repeat(64),
  comparisonEngineVersion: "rgba-visible-1",
};

async function probeSignedEnvironment() {
  const environment = await measureEnvironment({
    comparisonPolicyDigest: "a".repeat(64),
    comparisonEngineVersion: "rgba-visible-1",
  });
  const os: string = environment.osImage.os;
  const systemFontRootCount: number = environment.systemFontRootCount;
  const fontPackage: string | null = environment.fontPackage;
  return { os, systemFontRootCount, fontPackage };
}

void fontOptions;
void missingAppPackageFile;
void probeSignedEnvironment;
