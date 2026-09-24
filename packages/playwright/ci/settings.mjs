export const settings = {
  comparisonEngineVersion: "rgba-visible-1",
};

const servers = new Set([
  "https://visonaut.com",
  "https://preview.visonaut.com",
  "https://diagnostics.visonaut.com",
]);

export function trustedServer(environment) {
  const server = environment.VISONAUT_SERVER ?? "https://visonaut.com";
  if (!servers.has(server)) {
    throw new Error("The upload job has an untrusted Visonaut server origin");
  }
  return server;
}
