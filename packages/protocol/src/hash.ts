import type { CaptureIdentity, CaptureProfile, DiscoveryReceipt, Json, Manifest } from "./types.js";

/** JSON object keys are sorted; declared array order remains significant. */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  const encode = (item: unknown): string => {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") {
      return JSON.stringify(item);
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      return JSON.stringify(item);
    }
    if (typeof item !== "object" || !item) {
      throw new TypeError("Canonical JSON requires finite JSON values");
    }
    if (seen.has(item)) {
      throw new TypeError("Canonical JSON cannot contain cycles");
    }
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    ) {
      throw new TypeError("Canonical JSON requires plain objects");
    }
    seen.add(item);
    let result: string;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) {
        throw new TypeError("Canonical JSON cannot contain sparse arrays");
      }
      result = `[${item.map(encode).join(",")}]`;
    } else {
      result = `{${Object.entries(item)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => `${JSON.stringify(key)}:${encode(entry)}`)
        .join(",")}}`;
    }
    seen.delete(item);
    return result;
  };
  return encode(value);
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function digestJson(value: unknown): Promise<string> {
  return sha256(new TextEncoder().encode(canonicalJson(value)));
}

export function identityKey(identity: CaptureIdentity): string {
  return JSON.stringify([identity.itemKey, identity.variantKey]);
}

export function isJson(value: unknown, depth = 0): value is Json {
  if (depth > 24) return false;
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJson(item, depth + 1));
  }
  if (!value || typeof value !== "object") return false;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    return false;
  return Object.values(value).every((item) => isJson(item, depth + 1));
}

/** Content clipping can change with a defect without a trusted-plan rollout. */
export async function digestEnvironmentProfile(profile: CaptureProfile): Promise<string> {
  const captureOptions = Object.fromEntries(
    Object.entries(profile.captureOptions).filter(([key]) => key !== "clip"),
  );
  return digestJson({ ...profile, captureOptions });
}

interface DiscoveryArtifactPrefixParams {
  workflowAttempt: number;
  jobId: string;
  shardKey: string;
}

export function discoveryArtifactPrefix({
  workflowAttempt,
  jobId,
  shardKey,
}: DiscoveryArtifactPrefixParams): string {
  return `visonaut-discovery-${workflowAttempt}-${jobId}-${encodeURIComponent(shardKey)}-`;
}

export async function createDiscoveryReceipt(manifest: Manifest): Promise<DiscoveryReceipt> {
  if (!manifest.discovery) {
    throw new TypeError("Manifest has no trusted candidate discovery");
  }
  const manifestDigest = await digestJson(manifest);
  const identity = {
    workflowAttempt: manifest.run.workflowAttempt,
    jobId: manifest.shard.jobId,
    shardKey: manifest.shard.key,
  };
  return {
    schemaVersion: "1.0",
    ...identity,
    ...manifest.discovery,
    workflowRunId: manifest.run.workflowRunId,
    testedSha: manifest.run.testedSha,
    manifestDigest,
    artifactName: `${discoveryArtifactPrefix(identity)}${manifestDigest}`,
  };
}
