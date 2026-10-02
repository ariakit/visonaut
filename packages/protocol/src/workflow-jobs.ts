import { ProtocolError, validateKey } from "./validate.js";

/** Bind shard keys to complete workflow names with one literal {shard} slot. */
export function captureJobNames(template: string) {
  const parts = template.split("{shard}");
  const [before, after] = parts;
  if (
    parts.length !== 2 ||
    before === undefined ||
    after === undefined ||
    before.length + after.length === 0 ||
    template.length > 256 ||
    Array.from(template).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    throw new ProtocolError(
      "INVALID_WORKFLOW_JOB_NAME",
      "Capture job names require one {shard} slot and a literal job name.",
    );
  }
  const name = (shardKey: string) => {
    validateKey(shardKey, "shardKey");
    const result = `${before}${shardKey}${after}`;
    if (result.length > 256) {
      throw new ProtocolError("INVALID_WORKFLOW_JOB_NAME", "The capture job name is too long.");
    }
    return result;
  };
  const shard = (jobName: string) => {
    if (!jobName.startsWith(before)) return;
    if (!jobName.endsWith(after)) return;
    const key = jobName.slice(before.length, jobName.length - after.length);
    if (name(key) !== jobName) {
      throw new ProtocolError("INVALID_WORKFLOW_JOB_NAME", "The capture job name is invalid.");
    }
    return key;
  };
  return { name, shard };
}
