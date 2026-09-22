import { jwtVerify, SignJWT } from "jose";
import { numericId, record, SecurityError, textField } from "./errors.js";

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
}

export interface UploadTicketClaims {
  runId: string;
  shardKey: string;
  objectKey: string;
  imageDigest: string;
  mediaType: "image/png" | "image/webp";
  maximumBytes: number;
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
  };
}

async function issueToken(
  configuration: CapabilityConfiguration,
  kind: "ingest" | "upload",
  claims: object,
  expiresIn: number,
): Promise<string> {
  if (!Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > 900) {
    throw new Error("Ingest credentials must expire within 15 minutes.");
  }
  return new SignJWT({ ...claims, kind, environment: configuration.environment })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(configuration.issuer)
    .setAudience(`ariviso:${kind}:${configuration.environment}`)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(signingKey(configuration));
}

async function verifyToken(
  configuration: CapabilityConfiguration,
  kind: "ingest" | "upload",
  token: string,
) {
  try {
    const result = await jwtVerify(token, signingKey(configuration), {
      algorithms: ["HS256"],
      issuer: configuration.issuer,
      audience: `ariviso:${kind}:${configuration.environment}`,
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

export function bearerToken(request: Request): string {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  const token = match?.[1];
  if (!token) {
    throw new SecurityError("credential_required", 401, "A bearer credential is required.");
  }
  return token;
}
