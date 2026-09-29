import { CliError } from "./errors.js";
import { prepareBundleSubmission } from "./bundle-submit.js";

/** The only capture submission path downloads the verified required shard artifacts. */
export async function runWorkflowCommand(
  argv: string[],
  environment: Record<string, string | undefined>,
): Promise<{ command: "submit"; directory: string; server: string } | undefined> {
  if (argv[0] !== "submit" || !argv.includes("--shard")) {
    return;
  }
  const shards: string[] = [];
  let server: string | undefined;
  if (argv.length < 3 || argv.length > 35 || argv.length % 2 !== 1) {
    throw new CliError("Submit requires 1–16 --shard pairs and an optional --server.", 2);
  }
  for (let index = 1; index < argv.length; index += 2) {
    const value = argv[index + 1] ?? "";
    if (argv[index] === "--server") {
      if (server || !value) {
        throw new CliError("Submit accepts one --server origin.", 2);
      }
      server = value;
      continue;
    }
    if (
      argv[index] !== "--shard" ||
      !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value) ||
      shards.includes(value)
    ) {
      throw new CliError("Each required shard must be a unique stable key.", 2);
    }
    shards.push(value);
  }
  const prepared = await prepareBundleSubmission(
    shards,
    server ? { ...environment, VISONAUT_SERVER: server } : environment,
  );
  return { command: "submit", ...prepared };
}
