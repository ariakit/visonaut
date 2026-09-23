import { SecurityError, readBoundedBody } from "@visonaut/security";

export async function jsonBody(request: Request, limit: number): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new SecurityError("invalid_content_type", 415, "Send an application/json body.");
  }
  try {
    return object(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBody(request, limit)),
      ),
    );
  } catch (error) {
    if (error instanceof SecurityError) throw error;
    throw new SecurityError("invalid_json", 400, "The JSON body is invalid.");
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SecurityError("invalid_body", 400, "The request body is invalid.");
  }
  return value as Record<string, unknown>;
}

export function string(value: unknown, maximum = 512): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new SecurityError("invalid_body", 400, "A required string is invalid.");
  }
  return value;
}

export function integer(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new SecurityError("invalid_body", 400, "A required integer is invalid.");
  }
  return value;
}

export function uuid(value: unknown): string {
  const id = string(value, 36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) {
    throw new SecurityError("invalid_id", 400, "The resource identity is invalid.");
  }
  return id;
}

export function matchPath(request: Request, expression: RegExp): RegExpExecArray | null {
  return expression.exec(new URL(request.url).pathname);
}
