import { createReadStream } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { compareCaptureIdentity } from "@visonaut/protocol";
import type {
  CaptureComparison,
  CapturePageTest,
  CaptureProfile,
  CaptureRowImage,
  CaptureSource,
  Manifest,
  RunProvenance,
  Variant,
} from "@visonaut/protocol";
import { captureLabel, CliError, record } from "./errors.js";

/** One capture of a capture job, as one line of a record file. */
export interface CaptureRecord {
  itemKey: string;
  name: string | null;
  variant: Variant;
  test: CapturePageTest;
  profile: CaptureProfile;
  profileDigest: string;
  comparison: CaptureComparison;
  image: CaptureRowImage;
}

/**
 * The input of one Submit in the prepared directory. It holds no capture: the
 * captures are in the record files, one file for each capture job, each in the
 * order of the item key and then the variant key.
 */
export interface Submission {
  producer: Manifest["producer"];
  run: RunProvenance;
  /** The signed Submit job. */
  job: { id: string; attempt: number };
  sources: CaptureSource[];
  /** Paths of the record files, relative to the directory. */
  files: string[];
}

const SUBMISSION_FILE = "submission.json";

export function imagePath(digest: string): string {
  return `images/${digest}.png`;
}

export async function writeSubmission(directory: string, submission: Submission) {
  const file = join(directory, SUBMISSION_FILE);
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(submission)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, file);
}

/** The Submit job wrote this file itself, so only the form of its top level is checked. */
function isSubmission(value: unknown): value is Submission {
  if (!record(value)) return false;
  if (!record(value.producer) || !record(value.run)) return false;
  if (!record(value.job)) return false;
  if (typeof value.job.id !== "string" || typeof value.job.attempt !== "number") return false;
  if (!Array.isArray(value.sources) || !Array.isArray(value.files)) return false;
  return value.files.every((file) => typeof file === "string");
}

export async function loadSubmission(directory: string): Promise<Submission> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(directory, SUBMISSION_FILE), "utf8"));
  } catch {
    throw new CliError("The prepared submission cannot be read. Run Submit again.");
  }
  if (!isSubmission(value)) {
    throw new CliError("The prepared submission is invalid. Run Submit again.");
  }
  return value;
}

/** Write the captures of one capture job in the order of the format. */
export async function writeCaptureRecords(file: string, records: CaptureRecord[]) {
  const sorted = [...records].sort((first, second) =>
    compareCaptureIdentity(
      [first.itemKey, first.variant.key],
      [second.itemKey, second.variant.key],
    ),
  );
  // The reader takes U+2028 and U+2029 as the end of a line, and a test title can hold them.
  const lines = sorted.map(
    (entry) =>
      `${JSON.stringify(entry).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029")}\n`,
  );
  await writeFile(file, lines.join(""), { flag: "wx", mode: 0o600 });
}

/**
 * Read the record files together, in the order of the item key and then the
 * variant key. Only one record of each file is in memory, so the count of
 * captures of a run has no limit here.
 */
export async function* mergeCaptureRecords(
  directory: string,
  files: string[],
): AsyncGenerator<CaptureRecord> {
  const readers = files.map((file) => {
    const lines = createInterface({
      input: createReadStream(join(directory, file), "utf8"),
      crlfDelay: Infinity,
    });
    return lines[Symbol.asyncIterator]();
  });
  const next = async (reader: AsyncIterator<string>): Promise<CaptureRecord | undefined> => {
    const line = await reader.next();
    if (line.done) return;
    // The Submit job wrote each line itself, from a validated capture.
    const value: CaptureRecord = JSON.parse(line.value);
    return value;
  };
  try {
    const heads = await Promise.all(readers.map(next));
    let previous: [string, string] | undefined;
    while (true) {
      let selected = -1;
      let identity: [string, string] | undefined;
      for (const [index, head] of heads.entries()) {
        if (!head) continue;
        const candidate: [string, string] = [head.itemKey, head.variant.key];
        if (identity && compareCaptureIdentity(candidate, identity) >= 0) continue;
        selected = index;
        identity = candidate;
      }
      const head = heads[selected];
      const reader = readers[selected];
      if (!head || !reader || !identity) return;
      if (previous && compareCaptureIdentity(previous, identity) === 0) {
        throw new CliError(
          `${captureLabel(identity[0], identity[1])}: Two captures have this item key and variant key. Give each screenshot its own keys.`,
        );
      }
      previous = identity;
      yield head;
      heads[selected] = await next(reader);
    }
  } finally {
    for (const reader of readers) {
      await reader.return?.();
    }
  }
}
