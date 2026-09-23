export type ExitCode = 0 | 1 | 2 | 3 | 4;

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode = 1,
  ) {
    super(message);
  }
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function text(value: unknown): value is string {
  if (typeof value !== "string" || !value.length || value.length > 4096) return false;
  for (const character of value) {
    const codePoint = character.charCodeAt(0);
    if (codePoint < 32 || (codePoint >= 127 && codePoint <= 159)) return false;
  }
  return true;
}

export function protocolVersion(value: unknown): void {
  if (
    !record(value) ||
    typeof value.schemaVersion !== "string" ||
    !/^1\.\d+$/u.test(value.schemaVersion)
  ) {
    throw new CliError("The service returned an unsupported response schema.");
  }
}
