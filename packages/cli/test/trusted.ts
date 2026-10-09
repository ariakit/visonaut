import { join } from "node:path";
import { runCli } from "../src/index.js";
import type { Bundle, Prepared } from "./page-service.js";

/**
 * Run `submit --shard` through the public entry point on capture bundles. The step output of
 * GitHub goes to `output.txt` in the directory of the first bundle.
 */
export async function submitShard(
  prepared: Prepared,
  bundles: Bundle[],
  environment: Record<string, string | undefined>,
) {
  prepared.bundles = bundles;
  let stdout = "";
  let stderr = "";
  const code = await runCli({
    argv: ["submit", ...bundles.flatMap(({ manifest }) => ["--shard", manifest.shard.key])],
    environment: {
      ...environment,
      GITHUB_OUTPUT: join(bundles[0]?.directory ?? "", "output.txt"),
    },
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    },
  });
  return { code, stdout, stderr };
}

/** The text counts of the progress line: `Visonaut staged 3 originals (1 reused, 2 uploaded)`. */
export function stagedCounts(stdout: string) {
  const match = /Visonaut staged (\d+) originals \((\d+) reused, (\d+) uploaded\)/.exec(stdout);
  if (!match) return undefined;
  return { originals: Number(match[1]), reused: Number(match[2]), uploaded: Number(match[3]) };
}

/** The numbers of the line `Image PUTs: …ms aggregate request time, N attempted bytes, …`. */
export function imagePutNumbers(stdout: string) {
  const match =
    /Image PUTs: (\d+)ms aggregate request time, (\d+) attempted bytes, (\d+)ms retry wait\./.exec(
      stdout,
    );
  if (!match) return undefined;
  return { elapsedMs: Number(match[1]), bytes: Number(match[2]), retryWaitMs: Number(match[3]) };
}
