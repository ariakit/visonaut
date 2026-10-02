const configuredPort = process.env.VISONAUT_TEST_PORT ?? "4179";

export const testPort = Number(configuredPort);

if (!Number.isInteger(testPort) || testPort < 1 || testPort > 65535) {
  throw new Error("VISONAUT_TEST_PORT must be an integer from 1 to 65535.");
}
