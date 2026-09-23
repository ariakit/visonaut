import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { digestJson } from "./identity.mjs";

export async function rebindManifest({ directory, browser, repository, repositoryId, context }) {
  const file = path.join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  if (
    manifest.run?.repository !== repository ||
    manifest.run?.repositoryId !== repositoryId ||
    manifest.run?.workflowRunId !== context.workflowRunId ||
    manifest.run?.testedSha !== context.testedSha ||
    manifest.shard?.key !== browser ||
    !Number.isSafeInteger(manifest.run?.workflowAttempt) ||
    manifest.run.workflowAttempt < 1 ||
    manifest.run.workflowAttempt > context.workflowAttempt ||
    !manifest.discovery ||
    !Array.isArray(manifest.captures) ||
    !manifest.captures.length
  ) {
    throw new Error("The captured shard does not match the trusted submission job");
  }
  manifest.run.workflowAttempt = context.workflowAttempt;
  manifest.shard.jobId = context.jobId;
  manifest.shard.sourceAttempt = context.workflowAttempt;
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, file);
  const manifestDigest = digestJson(manifest);
  const artifactName = `visonaut-discovery-${context.workflowAttempt}-${context.jobId}-${browser}-${manifestDigest}`;
  const receipt = {
    schemaVersion: "1.0",
    workflowAttempt: context.workflowAttempt,
    jobId: context.jobId,
    shardKey: browser,
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
