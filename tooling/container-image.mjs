import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import manifest from "../package.json" with { type: "json" };

const result = spawnSync(
  "docker",
  [
    "build",
    "--platform",
    "linux/amd64",
    "--build-arg",
    `NODE_VERSION=${manifest.devEngines.runtime.version}`,
    "--file",
    "apps/compare/container/Dockerfile",
    "--tag",
    "visonaut-compare-check:local",
    ".",
  ],
  { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "inherit" },
);

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
