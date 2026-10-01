import { jwtVerify, SignJWT } from "jose";
import { numericId, record, SecurityError, textField } from "./errors.js";
import {
  validateLocalReference,
  LOCAL_COMPARISON_MODE,
  type LocalReferenceBinding,
} from "@visonaut/protocol";

export interface CapabilityConfiguration {
  secret: string;
  issuer: string;
  environment: "production" | "preview" | "local";
}

export interface IngestCapability {
  runId: string;
  repositoryId: string;
  workflowRunId: string;
  workflowAttempt: number;
  testedSha: string;
  planDigest: string;
  shardKey: string;
  jobId: string;
  maximumBytes: number;
  maximumImages: number;
  comparisonMode?: typeof LOCAL_COMPARISON_MODE;
  reference?: LocalReferenceBinding;
}

export interface UploadTicketClaims {
  runId: string;
  shardKey: string;
  objectKey: string;
  imageDigest: string;
  mediaType: "image/png" | "image/webp";
  maximumBytes: number;
}

export interface ReuseChallengeClaims {
  runId: string;
  jobId: string;
  shardKey: string;
  manifestDigest: string;
  nonce: string;
}

function signingKey(configuration: CapabilityConfiguration): Uint8Array<ArrayBuffer> {
  if (configuration.secret.length < 32) {
    throw new Error("A capability secret must contain at least 32 characters.");
  }
  return new TextEncoder().encode(configuration.secret);
}

function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new SecurityError("invalid_capability", 401, "The ingest credential is invalid.");
  }
  return value;
}

function parseCapability(value: unknown): IngestCapability {
  const data = record(value);
  if (data.comparisonMode !== undefined && data.comparisonMode !== LOCAL_COMPARISON_MODE)
    throw new SecurityError("invalid_capability", 401, "The comparison mode is invalid.");
  if (data.reference !== undefined) {
    if (data.comparisonMode !== LOCAL_COMPARISON_MODE)
      throw new SecurityError(
        "invalid_capability",
        401,
        "The reference is not scoped to local comparison.",
      );
    validateLocalReference(data.reference);
  }
  return {
    runId: textField(data.runId),
    repositoryId: numericId(data.repositoryId),
    workflowRunId: numericId(data.workflowRunId),
    workflowAttempt: positiveInteger(data.workflowAttempt),
    testedSha: textField(data.testedSha),
    planDigest: textField(data.planDigest),
    shardKey: textField(data.shardKey),
    jobId: numericId(data.jobId),
    maximumBytes: positiveInteger(data.maximumBytes),
    maximumImages: positiveInteger(data.maximumImages),
    ...(data.comparisonMode === LOCAL_COMPARISON_MODE
      ? { comparisonMode: LOCAL_COMPARISON_MODE }
      : {}),
    ...(data.reference ? { reference: data.reference as LocalReferenceBinding } : {}),
  };
}

async function issueToken(
  configuration: CapabilityConfiguration,
  kind: "ingest" | "upload" | "reuse",
  claims: object,
  expiresIn: number,
): Promise<string> {
  if (!Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > 900) {
    throw new Error("Ingest credentials must expire within 15 minutes.");
  }
  return new SignJWT({ ...claims, kind, environment: configuration.environment })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(configuration.issuer)
    .setAudience(`visonaut:${kind}:${configuration.environment}`)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(signingKey(configuration));
}

async function verifyToken(
  configuration: CapabilityConfiguration,
  kind: "ingest" | "upload" | "reuse",
  token: string,
) {
  try {
    const result = await jwtVerify(token, signingKey(configuration), {
      algorithms: ["HS256"],
      issuer: configuration.issuer,
      audience: `visonaut:${kind}:${configuration.environment}`,
      typ: "JWT",
      requiredClaims: ["exp", "iat", "jti"],
      maxTokenAge: "15m",
    });
    if (result.payload.kind !== kind || result.payload.environment !== configuration.environment) {
      throw new Error("Wrong credential kind.");
    }
    return result.payload;
  } catch {
    throw new SecurityError(
      "invalid_capability",
      401,
      "The ingest credential is invalid or expired.",
    );
  }
}

export function issueIngestCapability(
  configuration: CapabilityConfiguration,
  capability: IngestCapability,
  expiresIn = 600,
): Promise<string> {
  return issueToken(configuration, "ingest", parseCapability(capability), expiresIn);
}

/** Only ingest routes call this function; it grants no private read/review access. */
export async function verifyIngestCapability(
  configuration: CapabilityConfiguration,
  token: string,
): Promise<IngestCapability> {
  return parseCapability(await verifyToken(configuration, "ingest", token));
}

function parseTicket(value: unknown): UploadTicketClaims {
  const data = record(value);
  if (data.mediaType !== "image/png" && data.mediaType !== "image/webp") {
    throw new SecurityError("invalid_ticket", 401, "The upload ticket is invalid.");
  }
  const objectKey = textField(data.objectKey);
  if (!/^quarantine\/[A-Za-z0-9/_-]+$/.test(objectKey) || objectKey.includes("..")) {
    throw new SecurityError("invalid_ticket", 401, "The upload ticket is invalid.");
  }
  return {
    runId: textField(data.runId),
    shardKey: textField(data.shardKey),
    objectKey,
    imageDigest: textField(data.imageDigest),
    mediaType: data.mediaType,
    maximumBytes: positiveInteger(data.maximumBytes),
  };
}

export function issueUploadTicket(
  configuration: CapabilityConfiguration,
  ticket: UploadTicketClaims,
  expiresIn = 600,
): Promise<string> {
  return issueToken(configuration, "upload", parseTicket(ticket), expiresIn);
}

export async function verifyUploadTicket(
  configuration: CapabilityConfiguration,
  token: string,
  capability: IngestCapability,
): Promise<UploadTicketClaims> {
  const ticket = parseTicket(await verifyToken(configuration, "upload", token));
  if (
    ticket.runId !== capability.runId ||
    ticket.shardKey !== capability.shardKey ||
    ticket.maximumBytes > capability.maximumBytes
  ) {
    throw new SecurityError(
      "invalid_ticket",
      403,
      "The upload ticket does not belong to this shard.",
    );
  }
  return ticket;
}

function parseReuseChallenge(value: unknown): ReuseChallengeClaims {
  const data = record(value);
  const nonce = textField(data.nonce);
  const manifestDigest = textField(data.manifestDigest);
  if (!/^[a-f0-9]{64}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(manifestDigest)) {
    throw new SecurityError("invalid_challenge", 401, "The reuse challenge is invalid.");
  }
  return {
    runId: textField(data.runId),
    jobId: numericId(data.jobId),
    shardKey: textField(data.shardKey),
    manifestDigest,
    nonce,
  };
}

export function issueReuseChallenge(
  configuration: CapabilityConfiguration,
  claims: Omit<ReuseChallengeClaims, "nonce">,
): Promise<{ nonce: string; token: string; expiresAt: string }> {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const challenge = parseReuseChallenge({ ...claims, nonce });
  return issueToken(configuration, "reuse", challenge, 600).then((token) => ({
    nonce,
    token,
    expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
  }));
}

export async function verifyReuseChallenge(
  configuration: CapabilityConfiguration,
  token: string,
  capability: IngestCapability,
  manifestDigest: string,
): Promise<ReuseChallengeClaims> {
  const challenge = parseReuseChallenge(await verifyToken(configuration, "reuse", token));
  if (
    challenge.runId !== capability.runId ||
    challenge.jobId !== capability.jobId ||
    challenge.shardKey !== capability.shardKey ||
    challenge.manifestDigest !== manifestDigest
  ) {
    throw new SecurityError("invalid_challenge", 403, "The challenge belongs to another shard.");
  }
  return challenge;
}

export function bearerToken(request: Request): string {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  const token = match?.[1];
  if (!token) {
    throw new SecurityError("credential_required", 401, "A bearer credential is required.");
  }
  return token;
}
