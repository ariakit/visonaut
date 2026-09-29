import { runInternalCli } from "./engine.js";
import type { CliOptions } from "./engine.js";
import { CliError } from "./errors.js";
import { runWorkflowCommand } from "./workflow.js";
export type { CliOptions } from "./engine.js";
export type { ExitCode } from "./errors.js";

/** Submit uses only verified GitHub artifacts; status uses a maintainer session. */
export async function runCli(options: CliOptions) {
  const environment = options.environment ?? process.env;
  try {
    if (
      options.argv[0] === "status" ||
      options.argv[0] === "begin" ||
      (options.argv.length === 1 && options.argv[0] === "--help")
    ) {
      return runInternalCli(options);
    }
    const prepared = await runWorkflowCommand(options.argv, environment);
    if (!prepared) {
      throw new CliError("Choose begin, submit --shard, or status. Use --help for usage.", 2);
    }
    return runInternalCli({
      ...options,
      argv: ["submit", "--dir", prepared.directory],
      environment: { ...environment, VISONAUT_SERVER: prepared.server },
    });
  } catch (error) {
    const failure =
      error instanceof CliError ? error : new CliError("The verified capture submission failed.");
    const stderr = options.stderr ?? ((value: string) => process.stderr.write(value));
    if (options.argv.includes("--json")) {
      stderr(`${JSON.stringify({ error: failure.message, exitCode: failure.exitCode })}\n`);
    } else {
      stderr(`visonaut: ${failure.message}\n`);
    }
    return failure.exitCode;
  }
}
