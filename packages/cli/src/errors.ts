export type ExitCode = 0 | 1 | 2 | 3 | 4;

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode = 1,
  ) {
    super(message);
  }
}

/**
 * The only text that names a screenshot in a log. Both keys passed the protocol
 * key check (letters, digits, and . _ / -, 256 characters at most), so they
 * cannot hold a line break. Never add a display title or the result of a
 * comparison here.
 */
export function captureLabel(itemKey: string, variantKey: string): string {
  return `${itemKey} (${variantKey})`;
}

/** An error that is not a CliError gets the fallback message. */
export function cliError(error: unknown, fallback: string): CliError {
  return error instanceof CliError ? error : new CliError(fallback);
}

/**
 * Start the message of a failure about one file with the name of its
 * screenshot, if the file has one.
 */
export function nameFile(label: string | undefined, error: CliError): CliError {
  return label ? new CliError(`${label}: ${error.message}`, error.exitCode) : error;
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
