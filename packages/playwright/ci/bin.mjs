#!/usr/bin/env node
import { parseArguments, render } from "./runner.mjs";

const help = `Usage:
  visonaut-capture render --repository-root <workspace> --test-dir <directory> --test-patterns <json-regex-sources> --project <name> --browser <engine> --device <Playwright-device> --base-url <loopback-origin> --shard <opaque-key> --comparison-policy-digest <approved-sha256> --bundle-sha256 <verified-tarball-sha256> --output <encrypted-shard> [--font-package <name>] [--retries <0-3>] [--workers <1-16>]

Use visonaut upload --bundle for a signed upload. Render has no OIDC permission.
`;

if (process.argv.length === 3 && process.argv[2] === "--help") {
  process.stdout.write(help);
} else {
  try {
    const parsed = parseArguments(process.argv.slice(2));
    await render(parsed);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Capture failed"}\n`);
    process.exitCode = 1;
  }
}
