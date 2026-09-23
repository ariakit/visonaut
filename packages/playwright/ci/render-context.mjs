import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeRenderContext({ directory, workflowRunId, workflowAttempt, testedSha }) {
  if (
    !/^[1-9][0-9]*$/.test(workflowRunId ?? "") ||
    !Number.isSafeInteger(workflowAttempt) ||
    workflowAttempt < 1 ||
    !/^[a-f0-9]{40}$/.test(testedSha ?? "")
  ) {
    throw new Error("The candidate render needs a GitHub run and tested commit");
  }
  await mkdir(directory, { recursive: true });
  const context = { workflowRunId, workflowAttempt, testedSha, jobId: "1" };
  await writeFile(path.join(directory, "context.json"), `${JSON.stringify(context, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return context;
}
