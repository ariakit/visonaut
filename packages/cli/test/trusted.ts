import { join } from "node:path";
import { digestJson, LOCAL_COMPARISON_MODE } from "@visonaut/protocol";
import { runCli } from "../src/index.js";

/** The mocked workflow of a test file returns this object: the verified capture and the service. */
export interface Prepared {
  directory: string;
  server: string;
}

/**
 * Run `submit --shard` through the public entry point. The test file mocks the workflow module
 * with `prepared`, so the run starts at the verified manifest and uses the trusted engine.
 */
export async function submitShard(
  prepared: Prepared,
  directory: string,
  environment: Record<string, string | undefined>,
) {
  prepared.directory = directory;
  let stdout = "";
  let stderr = "";
  const code = await runCli({
    argv: ["submit", "--shard", "chrome-1"],
    environment: { ...environment, GITHUB_OUTPUT: join(directory, "output.txt") },
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    },
  });
  return { code, stdout, stderr };
}

/** A trusted Submit refuses a reserve answer without the comparison mode. */
export function reserveAnswer(answer: object) {
  return { comparisonMode: LOCAL_COMPARISON_MODE, ...answer };
}

interface Reservation {
  capability: string;
  expiresAt: string;
}

/**
 * The reference page of a service that holds no accepted capture. Each capture is new, so Submit
 * stages every original. The page keeps the capability and the expiry of the last reservation.
 */
export async function emptyReferencePage(init: RequestInit | undefined, reservation: Reservation) {
  const body: { manifestDigest: string } = JSON.parse(String(init?.body));
  const captures: never[] = [];
  return {
    schemaVersion: "1.0",
    comparisonMode: LOCAL_COMPARISON_MODE,
    reference: {
      manifestDigest: body.manifestDigest,
      snapshotId: "accepted",
      baselineRevision: 1,
      inventoryDigest: await digestJson(captures),
      captureCount: 0,
    },
    captures,
    nextCursor: null,
    ...reservation,
  };
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
