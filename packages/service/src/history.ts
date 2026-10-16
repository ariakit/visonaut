export { affectedHistoryOwners, pruneArchivedImageMetadataStatements } from "./prune.ts";

/** The receipt identifies expired command detail for the authorized history reader. */
export class ArchivedCommandResultError extends Error {
  readonly runId: string;
  readonly commandId: string;

  constructor(runId: string, commandId: string) {
    super("The saved command result is in the private run archive.");
    this.name = "ArchivedCommandResultError";
    this.runId = runId;
    this.commandId = commandId;
  }
}

export async function commandRequestDigest(request: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}
