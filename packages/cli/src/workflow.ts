import { CliError } from "./errors.js";
import { prepareBundleSubmission, submitWithoutVisuals } from "./bundle-submit.js";

/** Submit either binds the native Plan's skip or verifies every capture artifact. */
export async function runWorkflowCommand(
  argv: string[],
  environment: Record<string, string | undefined>,
): Promise<
  | { command: "submit"; directory: string; server: string }
  | { command: "submit"; noVisual: true }
  | undefined
> {
  if (argv[0] !== "submit") return;
  const shards: string[] = [];
  let noVisual = false;
  let server: string | undefined;
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--no-visual") {
      if (noVisual) {
        throw new CliError("Submit accepts --no-visual once.", 2);
      }
      noVisual = true;
      continue;
    }
    const value = argv[++index] ?? "";
    if (flag === "--server") {
      if (server || !value || value.startsWith("--")) {
        throw new CliError("Submit accepts one --server origin.", 2);
      }
      server = value;
      continue;
    }
    if (
      flag !== "--shard" ||
      !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value) ||
      shards.includes(value)
    ) {
      throw new CliError("Each required shard must be a unique stable key.", 2);
    }
    shards.push(value);
  }
  const selectedEnvironment = server ? { ...environment, VISONAUT_SERVER: server } : environment;
  if (noVisual) {
    if (shards.length) {
      throw new CliError("Submit --no-visual does not accept capture shards.", 2);
    }
    await submitWithoutVisuals(selectedEnvironment);
    return { command: "submit", noVisual: true };
  }
  if (!shards.length) {
    throw new CliError("Submit requires --no-visual or at least one --shard pair.", 2);
  }
  const prepared = await prepareBundleSubmission(shards, selectedEnvironment);
  return { command: "submit", ...prepared };
}
