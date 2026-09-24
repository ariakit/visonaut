import { join } from "node:path";
import { loadCapture, validateImages } from "./files.js";
import { CliError } from "./errors.js";

function required(environment: Record<string, string | undefined>, name: string): string {
  const value = environment[name];
  if (!value) {
    throw new CliError(`${name} is required for workflow capture.`, 2);
  }
  return value;
}

/** Handle encrypted Actions artifacts without exposing OIDC to candidate tests. */
export async function runWorkflowCommand(
  argv: string[],
  environment: Record<string, string | undefined>,
): Promise<"packed" | { directory: string; server: string } | undefined> {
  if (argv[0] === "pack") {
    if (argv.length !== 5 || argv[1] !== "--dir" || argv[3] !== "--output") {
      throw new CliError("Pack requires --dir <capture-directory> --output <encrypted-file>.", 2);
    }
    const directory = argv[2];
    const output = argv[4];
    if (!directory || !output) {
      throw new CliError("Pack needs both paths.", 2);
    }
    if (environment.ACTIONS_ID_TOKEN_REQUEST_URL || environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
      throw new CliError("The candidate visual job must not receive GitHub OIDC permission.", 4);
    }
    const capture = await loadCapture(directory);
    await validateImages(capture);
    if (
      capture.manifest.run.workflowRunId !== environment.GITHUB_RUN_ID ||
      capture.manifest.run.workflowAttempt !== Number(environment.GITHUB_RUN_ATTEMPT) ||
      capture.manifest.run.testedSha !== environment.GITHUB_SHA
    ) {
      throw new CliError("The capture does not match this GitHub workflow attempt.", 4);
    }
    const { encryptTransferWithPublicKey, loadTransferPublicKey } =
      await import("@visonaut/playwright/ci");
    const publicKey = await loadTransferPublicKey(environment);
    await encryptTransferWithPublicKey(
      capture.directory,
      capture.manifest.shard.key,
      output,
      publicKey,
      environment,
    );
    return "packed";
  }
  if (argv[0] !== "upload" || !argv.includes("--bundle")) return;
  if (argv.length !== 3 || argv[1] !== "--bundle" || !argv[2]) {
    throw new CliError("Upload --bundle requires one encrypted file.", 2);
  }
  const shard = required(environment, "VISONAUT_SHARD");
  const { uploadEncryptedTransfer } = await import("@visonaut/playwright/ci");
  return uploadEncryptedTransfer({
    options: {
      "--shard": shard,
      "--comparison-policy-digest": required(environment, "VISONAUT_COMPARISON_POLICY_DIGEST"),
      "--bundle-sha256": required(environment, "VISONAUT_PACKAGE_SHA256"),
      "--input": argv[2],
      "--output-directory": join(required(environment, "RUNNER_TEMP"), `visonaut-upload-${shard}`),
      ...(environment.VISONAUT_FONT_PACKAGE
        ? { "--font-package": environment.VISONAUT_FONT_PACKAGE }
        : {}),
    },
    environment,
  });
}
