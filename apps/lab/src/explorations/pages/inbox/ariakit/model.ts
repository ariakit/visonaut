// The words of the next run card. Nothing here reads the document or the
// time.

import { getRunTitle, shortSha } from "../../../../fixtures/index.ts";
import type { Run } from "../../../../fixtures/index.ts";
import { getRunNumber, hasRunWords } from "../../../kits/ariakit/runs.tsx";

export interface RunHeading {
  /** The number for the line above the heading. Absent when the heading has it. */
  number?: string;
  title: string;
}

/**
 * The words of the next run card. A run with a title has its number on the
 * line above. Without a title, `Pull request` alone names nothing, so the
 * heading then takes the number: `Pull request #7754`.
 */
export function getRunHeading(
  run: Pick<Run, "kind" | "pullRequestNumber" | "testedSha" | "title" | "commitMessage">,
): RunHeading {
  const title = getRunTitle(run);
  if (hasRunWords(run)) return { number: getRunNumber(run), title };
  if (run.pullRequestNumber != null) return { title: `${title} #${run.pullRequestNumber}` };
  return { title: `${title} ${shortSha(run.testedSha)}` };
}
