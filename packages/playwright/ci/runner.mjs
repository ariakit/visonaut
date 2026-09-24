import { spawn } from "node:child_process";
import { appendFile, realpath, symlink } from "node:fs/promises";
import path from "node:path";
import { createPublicKey } from "node:crypto";
import { fileURLToPath } from "node:url";
import { bindSignedJob, githubOidcRequestUrl } from "./context.mjs";
import { measureEnvironment } from "./environment.mjs";
import { rebindManifest, verifyMeasuredProfiles } from "./rebind.mjs";
import { writeRenderContext } from "./render-context.mjs";
import { settings, trustedServer } from "./settings.mjs";
import { decryptTransfer, encryptTransferWithPublicKey } from "./transfer.mjs";

const directory = import.meta.dirname;
const playwrightCli = fileURLToPath(
  new URL("./node_modules/@playwright/test/cli.js", import.meta.url),
);
const shardPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const renderFlags = [
  "--repository-root",
  "--test-dir",
  "--test-patterns",
  "--project",
  "--browser",
  "--device",
  "--base-url",
  "--shard",
  "--comparison-policy-digest",
  "--bundle-sha256",
  "--output",
];
const uploadFlags = [
  "--shard",
  "--comparison-policy-digest",
  "--bundle-sha256",
  "--input",
  "--output-directory",
];

export function parseArguments(argv) {
  const [command, ...args] = argv;
  if (command !== "render" && command !== "upload") {
    throw new Error("Choose render or upload. Use --help for usage.");
  }
  const requiredFlags = command === "render" ? renderFlags : uploadFlags;
  const allowedFlags =
    command === "render"
      ? [...renderFlags, "--font-package", "--retries", "--workers"]
      : [...uploadFlags, "--font-package"];
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !allowedFlags.includes(flag) ||
      !value ||
      value.startsWith("--") ||
      Object.hasOwn(options, flag)
    ) {
      throw new Error("Capture options must be complete, unique, and known");
    }
    options[flag] = value;
  }
  if (requiredFlags.some((flag) => !Object.hasOwn(options, flag))) {
    throw new Error("The workflow capture command is missing an option");
  }
  if (
    !shardPattern.test(options["--shard"]) ||
    !/^[a-f0-9]{64}$/.test(options["--bundle-sha256"]) ||
    !/^[a-f0-9]{64}$/.test(options["--comparison-policy-digest"])
  ) {
    throw new Error("A capture identity or verified digest is invalid");
  }
  return { command, options };
}

function required(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function githubContext(environment) {
  if (
    environment.CI !== "true" ||
    environment.GITHUB_ACTIONS !== "true" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(environment.GITHUB_REPOSITORY ?? "") ||
    !/^[1-9][0-9]*$/.test(environment.GITHUB_REPOSITORY_ID ?? "")
  ) {
    throw new Error("Capture requires a GitHub Actions repository");
  }
  const event = required(environment, "GITHUB_EVENT_NAME");
  const workflowRunId = required(environment, "GITHUB_RUN_ID");
  const workflowAttempt = Number(required(environment, "GITHUB_RUN_ATTEMPT"));
  const testedSha = required(environment, "GITHUB_SHA");
  if (
    !["push", "pull_request", "merge_group"].includes(event) ||
    !/^[1-9][0-9]*$/.test(workflowRunId) ||
    !Number.isSafeInteger(workflowAttempt) ||
    workflowAttempt < 1 ||
    !/^[a-f0-9]{40}$/.test(testedSha)
  ) {
    throw new Error("The GitHub event, run, attempt, or tested commit is invalid");
  }
  return {
    event,
    repository: environment.GITHUB_REPOSITORY,
    repositoryId: environment.GITHUB_REPOSITORY_ID,
    workflowRunId,
    workflowAttempt,
    testedSha,
  };
}

function runPlaywright(environment) {
  return new Promise((resolve, reject) => {
    const command = process.platform === "linux" ? "xvfb-run" : process.execPath;
    const args =
      process.platform === "linux"
        ? [process.execPath, playwrightCli, "test", "--config", "playwright.config.mjs"]
        : [playwrightCli, "test", "--config", "playwright.config.mjs"];
    const child = spawn(command, args, { cwd: directory, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Playwright capture failed (${signal ?? code})`));
    });
  });
}

async function linkRuntimeDependencies() {
  const packageModules = path.resolve(directory, "../node_modules");
  try {
    await symlink("ci/node_modules", packageModules, "dir");
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    if (
      (await realpath(packageModules)) !== (await realpath(path.join(directory, "node_modules")))
    ) {
      throw new Error("The isolated package has unexpected runtime dependencies");
    }
  }
}

export async function loadTransferPublicKey(environment, fetchImpl = fetch) {
  const server = trustedServer(environment);
  const response = await fetchImpl(new URL("/v1/transfer/public-key", server), {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Visonaut public key request failed: ${response.status}`);
  const key = await response.text();
  if (key.length > 4096 || !key.startsWith("-----BEGIN PUBLIC KEY-----\n")) {
    throw new Error("Visonaut returned an invalid transfer public key");
  }
  const parsed = createPublicKey(key);
  if (
    parsed.asymmetricKeyType !== "rsa" ||
    (parsed.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
  ) {
    throw new Error("Visonaut returned an invalid transfer public key");
  }
  return key;
}

export async function render({ options, environment = process.env, fetchImpl = fetch }) {
  if (environment.ACTIONS_ID_TOKEN_REQUEST_URL || environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error("The candidate render job must not receive GitHub OIDC permission");
  }
  const context = githubContext(environment);
  // Fetch before candidate code runs; it must not choose or replace the transfer key.
  const publicKey = await loadTransferPublicKey(environment, fetchImpl);
  const root = await realpath(options["--repository-root"]);
  if (root !== (await realpath(required(environment, "GITHUB_WORKSPACE")))) {
    throw new Error("The candidate root must be the current GitHub workspace");
  }
  const results = path.join(root, ".visonaut-results");
  const { fonts } = await measureEnvironment({
    appPackageFile: path.join(
      path.dirname(path.resolve(root, options["--test-dir"])),
      "package.json",
    ),
    outputDirectory: results,
    comparisonPolicyDigest: options["--comparison-policy-digest"],
    comparisonEngineVersion: settings.comparisonEngineVersion,
    applicationFontPackage: options["--font-package"],
  });
  process.stdout.write(`Measured ${fonts.length} font files for ${options["--shard"]}\n`);
  await writeRenderContext({
    directory: results,
    workflowRunId: context.workflowRunId,
    workflowAttempt: context.workflowAttempt,
    testedSha: context.testedSha,
  });
  await linkRuntimeDependencies();
  await runPlaywright({
    ...environment,
    GITHUB_WORKSPACE: root,
    VISONAUT_TEST_DIR: options["--test-dir"],
    VISONAUT_TEST_PATTERNS: options["--test-patterns"],
    VISONAUT_PROJECT: options["--project"],
    VISONAUT_BROWSER: options["--browser"],
    VISONAUT_DEVICE: options["--device"],
    VISONAUT_BASE_URL: options["--base-url"],
    VISONAUT_SHARD: options["--shard"],
    VISONAUT_BUNDLE_SHA256: options["--bundle-sha256"],
    VISONAUT_RETRIES: options["--retries"] ?? "1",
    VISONAUT_WORKERS: options["--workers"] ?? "4",
    VISONAUT_WEB_SERVERS: required(environment, "VISONAUT_WEB_SERVERS"),
  });
  await encryptTransferWithPublicKey(results, options["--shard"], options["--output"], publicKey);
}

async function identityToken(environment, audience, fetchImpl) {
  const url = githubOidcRequestUrl(required(environment, "ACTIONS_ID_TOKEN_REQUEST_URL"), audience);
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${required(environment, "ACTIONS_ID_TOKEN_REQUEST_TOKEN")}` },
    redirect: "error",
  });
  if (!response.ok) throw new Error(`GitHub identity request failed: ${response.status}`);
  const body = await response.json();
  if (typeof body.value !== "string" || !body.value) {
    throw new Error("GitHub did not return an identity token");
  }
  return body.value;
}

/** Stage one signed upload job; run submission belongs to the final workflow job. */
export async function upload({ options, environment = process.env, fetchImpl = fetch }) {
  const context = githubContext(environment);
  const server = trustedServer(environment);
  const outputDirectory = path.resolve(options["--output-directory"]);
  const audience = new URL("/transfer-key", server).href;
  const keyToken = await identityToken(environment, audience, fetchImpl);
  const response = await fetchImpl(new URL("/v1/transfer/private-key", server), {
    method: "POST",
    headers: { Authorization: `Bearer ${keyToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      shardKey: options["--shard"],
      workflowRunId: context.workflowRunId,
      workflowAttempt: context.workflowAttempt,
      testedSha: context.testedSha,
    }),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Visonaut transfer key request failed: ${response.status}`);
  const privateKey = await response.text();
  if (!privateKey.startsWith("-----BEGIN PRIVATE KEY-----\n")) {
    throw new Error("Visonaut returned an invalid transfer key");
  }
  await decryptTransfer(options["--input"], outputDirectory, options["--shard"], privateKey);
  const signedEnvironment = await measureEnvironment({
    comparisonPolicyDigest: options["--comparison-policy-digest"],
    comparisonEngineVersion: settings.comparisonEngineVersion,
  });
  await verifyMeasuredProfiles({
    directory: outputDirectory,
    signedEnvironment,
    fontPackage: options["--font-package"] ?? null,
  });
  const signedJob = await bindSignedJob({
    directory: outputDirectory,
    repository: context.repository,
    server,
    shard: options["--shard"],
    workflowRunId: context.workflowRunId,
    workflowAttempt: context.workflowAttempt,
    testedSha: context.testedSha,
    tokenRequestUrl: required(environment, "ACTIONS_ID_TOKEN_REQUEST_URL"),
    tokenRequestToken: required(environment, "ACTIONS_ID_TOKEN_REQUEST_TOKEN"),
    githubToken: required(environment, "GH_TOKEN"),
    trustedWorkflowSha: environment.VISONAUT_WORKFLOW_SOURCE_SHA,
    fetchImpl,
  });
  const receipt = await rebindManifest({
    directory: outputDirectory,
    shard: options["--shard"],
    repository: context.repository,
    repositoryId: context.repositoryId,
    bundleSha256: options["--bundle-sha256"],
    context: signedJob,
  });
  const { runCli } = await import("visonaut");
  const code = await runCli({
    argv: ["upload", "--dir", outputDirectory],
    environment: { ...environment, VISONAUT_SERVER: server },
  });
  if (code !== 0) throw new Error(`Visonaut upload failed with exit ${code}`);
  await appendFile(required(environment, "GITHUB_OUTPUT"), `name=${receipt.artifactName}\n`);
}
