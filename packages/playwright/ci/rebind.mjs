import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { digestJson } from "./identity.mjs";

/** Verify that every rendered profile uses the pinned, measured capture environment. */
export async function verifyMeasuredProfiles({ directory, signedEnvironment, fontPackage = null }) {
  const rendered = JSON.parse(await readFile(path.join(directory, "environment.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  const systemRoots = signedEnvironment.systemFontRootCount;
  if (
    !Number.isSafeInteger(systemRoots) ||
    systemRoots < 1 ||
    rendered.systemFontRootCount !== systemRoots ||
    rendered.fontPackage !== fontPackage ||
    digestJson(rendered.osImage) !== digestJson(signedEnvironment.osImage) ||
    !rendered.profile ||
    rendered.profile.osImageDigest !== signedEnvironment.profile.osImageDigest ||
    rendered.profile.comparisonPolicyDigest !== signedEnvironment.profile.comparisonPolicyDigest ||
    rendered.profile.comparisonEngineVersion !==
      signedEnvironment.profile.comparisonEngineVersion ||
    !Array.isArray(rendered.fonts) ||
    !rendered.fonts.length ||
    rendered.fonts.some(
      (entry) =>
        !Number.isSafeInteger(entry?.root) ||
        entry.root < 0 ||
        entry.root > (fontPackage ? systemRoots : systemRoots - 1) ||
        typeof entry.file !== "string" ||
        !entry.file ||
        !/^[a-f0-9]{64}$/.test(entry.digest),
    ) ||
    (fontPackage && !rendered.fonts.some((entry) => entry.root === systemRoots)) ||
    digestJson(rendered.fonts.filter((entry) => entry.root < systemRoots)) !==
      digestJson(signedEnvironment.fonts) ||
    rendered.profile.fontsDigest !== digestJson(rendered.fonts) ||
    !Array.isArray(manifest.profiles) ||
    !manifest.profiles.length ||
    manifest.profiles.some(
      (entry) =>
        !entry?.profile ||
        ["osImageDigest", "fontsDigest", "comparisonPolicyDigest", "comparisonEngineVersion"].some(
          (key) => entry.profile[key] !== rendered.profile[key],
        ),
    )
  ) {
    throw new Error("The captured profile differs from the signed job's measured environment");
  }
}

export async function rebindManifest({
  directory,
  shard,
  repository,
  repositoryId,
  bundleSha256,
  context,
}) {
  const file = path.join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  if (
    manifest.run?.repository !== repository ||
    manifest.run?.repositoryId !== repositoryId ||
    manifest.run?.workflowRunId !== context.workflowRunId ||
    manifest.run?.testedSha !== context.testedSha ||
    manifest.shard?.key !== shard ||
    !Number.isSafeInteger(manifest.run?.workflowAttempt) ||
    manifest.run.workflowAttempt < 1 ||
    manifest.run.workflowAttempt > context.workflowAttempt ||
    manifest.run.planDigest !== bundleSha256 ||
    manifest.discovery?.executorDigest !== bundleSha256 ||
    !Array.isArray(manifest.captures) ||
    !manifest.captures.length
  ) {
    throw new Error("The captured shard does not match the trusted submission job");
  }
  manifest.run.workflowAttempt = context.workflowAttempt;
  manifest.run.planDigest = digestJson({
    schemaVersion: "1.0",
    source: "workflow",
    reusableWorkflowSha: context.workflowSha,
  });
  manifest.shard.jobId = context.jobId;
  manifest.shard.sourceAttempt = context.workflowAttempt;
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, file);
  const manifestDigest = digestJson(manifest);
  const artifactName = `visonaut-discovery-${context.workflowAttempt}-${context.jobId}-${shard}-${manifestDigest}`;
  const receipt = {
    schemaVersion: "1.0",
    workflowAttempt: context.workflowAttempt,
    jobId: context.jobId,
    sourceAttempt: context.workflowAttempt,
    shardKey: shard,
    ...manifest.discovery,
    workflowRunId: context.workflowRunId,
    testedSha: context.testedSha,
    manifestDigest,
    artifactName,
  };
  await writeFile(path.join(directory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return receipt;
}
