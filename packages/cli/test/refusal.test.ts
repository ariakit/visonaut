import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";

const environment = {
  VISONAUT_SERVER: "https://visonaut.example",
  GITHUB_RUN_ID: "456",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_SHA: "a".repeat(40),
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/id-token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
};
const reference = "0b8f2d6e-5c1a-4e0b-9a77-3f6d2c1e8a90";

afterEach(() => vi.unstubAllGlobals());

async function begin() {
  let stdout = "";
  let stderr = "";
  const code = await runCli({
    argv: ["begin", "--run", environment.GITHUB_RUN_ID],
    environment,
    stdout(value) {
      stdout += value;
    },
    stderr(value) {
      stderr += value;
    },
  });
  return { code, stdout, stderr };
}

function answerBegin(respond: () => Response) {
  vi.stubGlobal("fetch", async (input: URL | string) => {
    if (new URL(input).hostname.endsWith(".actions.githubusercontent.com")) {
      return Response.json({ value: "oidc-secret" });
    }
    return respond();
  });
}

function refusal(status: number, error: Record<string, unknown>) {
  return Response.json(
    { schemaVersion: "1.0", error: { message: "server-message-secret", ...error } },
    { status },
  );
}

describe("refused requests print the error code and the reference", () => {
  it("prints both for a 503 and exits as a service failure", async () => {
    answerBegin(() => refusal(503, { code: "check_pending", reference }));
    const result = await begin();
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `visonaut: The service refused the request (HTTP 503, check_pending). Reference: ${reference}. No visual approval was granted.\n`,
    );
  });

  it("reads the body of statuses other than 503 and 409", async () => {
    answerBegin(() => refusal(422, { code: "plan_too_large", reference }));
    const result = await begin();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`(HTTP 422, plan_too_large). Reference: ${reference}.`);
  });

  it("keeps the trust exit code for a permission failure and adds the cause", async () => {
    answerBegin(() => refusal(403, { code: "workflow_mismatch", reference }));
    const result = await begin();
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("Authentication or permission failed");
    expect(result.stderr).toContain(`(HTTP 403, workflow_mismatch). Reference: ${reference}.`);
  });

  it("omits the reference when the answer has none", async () => {
    answerBegin(() => refusal(503, { code: "check_pending" }));
    const result = await begin();
    expect(result.stderr).toBe(
      "visonaut: The service refused the request (HTTP 503, check_pending). No visual approval was granted.\n",
    );
  });

  it.each([
    ["uppercase letters", "Check_Pending"],
    ["a digit", "check_2"],
    ["a hyphen", "check-pending"],
    ["a line break", "check\n::error::pending"],
    ["a space", "check pending"],
    ["65 characters", "a".repeat(65)],
    ["no characters", ""],
    ["a number", 503],
    ["an object", { name: "check_pending" }],
  ])("does not print an error code with %s", async (_name, code) => {
    answerBegin(() => refusal(503, { code, reference }));
    const result = await begin();
    expect(result.stderr).toBe(
      `visonaut: The service refused the request (HTTP 503). Reference: ${reference}. No visual approval was granted.\n`,
    );
  });

  it("prints an error code of 64 characters", async () => {
    const code = "a".repeat(64);
    answerBegin(() => refusal(503, { code, reference }));
    expect((await begin()).stderr).toContain(`(HTTP 503, ${code}).`);
  });

  it.each([
    ["uppercase hexadecimal", reference.toUpperCase()],
    ["35 characters", reference.slice(1)],
    ["37 characters", `${reference}0`],
    ["a letter outside the hexadecimal digits", `g${reference.slice(1)}`],
    ["a line break", `${reference.slice(0, 35)}\n`],
    ["a valid reference, a line break, and a log command", `${reference}\n::error::x`],
    ["a log command", "::add-mask::0b8f2d6e-5c1a-4e0b-9a77-3f6d2c1e8a"],
    ["a number", 123],
    ["null", null],
  ])("does not print a reference with %s", async (_name, invalid) => {
    answerBegin(() => refusal(503, { code: "check_pending", reference: invalid }));
    const result = await begin();
    expect(result.stderr).toBe(
      "visonaut: The service refused the request (HTTP 503, check_pending). No visual approval was granted.\n",
    );
  });

  it.each([
    ["text", "<html>server-message-secret</html>", "text/html"],
    ["JSON that is not an object", '"server-message-secret"', "application/json"],
    [
      "JSON with an error that is not an object",
      '{"error":"server-message-secret"}',
      "application/json",
    ],
    ["invalid JSON", "{server-message-secret", "application/json"],
    ["an empty body", "", "application/json"],
  ])("prints no detail when the body is %s", async (_name, body, type) => {
    answerBegin(() => new Response(body, { status: 503, headers: { "Content-Type": type } }));
    const result = await begin();
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "visonaut: The service refused the request (HTTP 503). No visual approval was granted.\n",
    );
  });

  it("does not read a body that exceeds the error size limit", async () => {
    answerBegin(() =>
      Response.json(
        { error: { code: "check_pending", reference, message: "x".repeat(20 * 1024) } },
        { status: 503 },
      ),
    );
    const result = await begin();
    expect(result.stderr).toBe(
      "visonaut: The service refused the request (HTTP 503). No visual approval was granted.\n",
    );
  });

  it("never prints the server message", async () => {
    answerBegin(() => refusal(503, { code: "check_pending", reference }));
    const result = await begin();
    expect(result.stdout + result.stderr).not.toContain("server-message-secret");
    expect(result.stdout + result.stderr).not.toContain("oidc-secret");
  });
});
