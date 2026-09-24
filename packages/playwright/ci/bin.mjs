#!/usr/bin/env node
import { parseArguments, render, upload } from "./runner.mjs";

const help = `Usage:
  visonaut-capture render --repository-root <workspace> --test-dir <directory> --test-patterns <json-regex-sources> --project <name> --browser <engine> --device <Playwright-device> --base-url <loopback-origin> --shard <opaque-key> --comparison-policy-digest <approved-sha256> --bundle-sha256 <verified-tarball-sha256> --output <encrypted-shard> [--font-package <name>] [--retries <0-3>] [--workers <1-16>]
  visonaut-capture upload --shard <opaque-key> --comparison-policy-digest <approved-sha256> --bundle-sha256 <verified-tarball-sha256> --input <encrypted-shard> --output-directory <private-directory> [--font-package <name>]

The approved app workflow owns the complete matrix, test patterns, preview-server JSON (VISONAUT_WEB_SERVERS), and final visonaut submit --run job. Render has no OIDC permission; only upload and final submit do.
`;

if (process.argv.length === 3 && process.argv[2] === "--help") {
  process.stdout.write(help);
} else {
  try {
    const parsed = parseArguments(process.argv.slice(2));
    await (parsed.command === "render" ? render(parsed) : upload(parsed));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Capture failed"}\n`);
    process.exitCode = 1;
  }
}
