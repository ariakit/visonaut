import { createCaptureConfig } from "./config.mjs";

const repositoryRoot = process.env.GITHUB_WORKSPACE;
const testDir = process.env.VISONAUT_TEST_DIR;
const patterns = process.env.VISONAUT_TEST_PATTERNS;
const projectName = process.env.VISONAUT_PROJECT;
const browser = process.env.VISONAUT_BROWSER;
const device = process.env.VISONAUT_DEVICE;
const baseUrl = process.env.VISONAUT_BASE_URL;
const shardKey = process.env.VISONAUT_SHARD;
const bundleSha256 = process.env.VISONAUT_BUNDLE_SHA256;
const webServerJson = process.env.VISONAUT_WEB_SERVERS;
if (
  !repositoryRoot ||
  !testDir ||
  !patterns ||
  !projectName ||
  !browser ||
  !device ||
  !baseUrl ||
  !shardKey ||
  !bundleSha256 ||
  !webServerJson
) {
  throw new Error("Capture needs the complete pinned workflow configuration");
}

export default await createCaptureConfig({
  repositoryRoot,
  testDir,
  patterns,
  projectName,
  browser,
  device,
  baseUrl,
  shardKey,
  bundleSha256,
  retries: Number(process.env.VISONAUT_RETRIES ?? "1"),
  workers: Number(process.env.VISONAUT_WORKERS ?? "4"),
  webServerJson,
});
