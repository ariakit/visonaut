export class SecurityError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SecurityError";
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SecurityError("invalid_metadata", 503, "Trusted metadata is unavailable.");
  }
  return value as Record<string, unknown>;
}

export function textField(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SecurityError("invalid_metadata", 503, "Trusted metadata is unavailable.");
  }
  return value;
}

export function numericId(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    return value;
  }
  throw new SecurityError("invalid_metadata", 503, "Trusted metadata is unavailable.");
}
