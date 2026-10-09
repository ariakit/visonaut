// Copies the Ariakit UI primitives from ariakit/ariakit at one pinned commit,
// and checks that the copy in the app is still byte-equal to upstream.
//
//   node tooling/ariakit-ui-copy.ts          copy the files, write NOTICE and the manifest
//   node tooling/ariakit-ui-copy.ts --check  exit 1 when a file differs from the manifest
//
// The manifest `tooling/ariakit-ui-copy.json` lists the git blob hash of each
// upstream file at the pin. The copy mode takes each hash from the upstream
// tree and fails when the downloaded bytes do not match it. So the check mode
// compares the files with upstream without a network request.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = "ariakit/ariakit";
const pin = "643a23aff5a5ac4c0a81022973d5297de004b506";
const sourceDirectory = "packages/ariakit-ui/src";
// The package has no license file. This is the file of the sibling package.
const licenseSource = "packages/ariakit-tailwind/license";
const noticeName = "NOTICE";
const licenseName = "LICENSE";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDirectory = path.join(root, "apps/web/src/components/ariakit");
const defaultManifest = path.join(root, "tooling/ariakit-ui-copy.json");

interface Manifest {
  repository: string;
  commit: string;
  files: Record<string, string>;
}

interface CheckParams {
  directory?: string;
  manifestPath?: string;
}

export function getNotice(commit: string) {
  return [
    `Ariakit UI components and recipes copied from ${repository} commit ${commit}.`,
    `Source: https://github.com/${repository}/tree/${commit}/${sourceDirectory}`,
    "Copyright Diego Haz. Distributed under the MIT license in LICENSE.",
    "The copy is complete and unmodified, except that test files are omitted.",
    `LICENSE is the file ${licenseSource} of the same commit.`,
    "styles/ui.css requires @ariakit/tailwind.",
    "Run `node tooling/ariakit-ui-copy.ts` to copy again, and `--check` to verify.",
    "",
  ].join("\n");
}

// Same hash as `git hash-object`, which the upstream tree lists for each file.
function getBlobHash(content: Uint8Array) {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(directory, prefix), {
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(directory, relative)));
    } else {
      files.push(relative);
    }
  }
  return files.sort();
}

/** Returns one message for each difference between the folder and upstream. */
export async function checkCopy({
  directory = defaultDirectory,
  manifestPath = defaultManifest,
}: CheckParams = {}) {
  const manifest: Manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const problems: string[] = [];
  if (manifest.commit !== pin) {
    problems.push(`manifest: for ${manifest.commit}, not for the pin ${pin}`);
  }
  const expected = new Map(Object.entries(manifest.files));
  const actual = await listFiles(directory).catch(() => [] as string[]);
  for (const file of actual) {
    if (file === noticeName) continue;
    if (!expected.has(file)) {
      problems.push(`${file}: not in upstream`);
    }
  }
  for (const [file, hash] of expected) {
    const content = await readFile(path.join(directory, file)).catch(() => null);
    if (!content) {
      problems.push(`${file}: missing`);
    } else if (getBlobHash(content) !== hash) {
      problems.push(`${file}: differs from upstream`);
    }
  }
  const notice = await readFile(path.join(directory, noticeName), "utf8").catch(() => null);
  if (notice !== getNotice(manifest.commit)) {
    problems.push(`${noticeName}: missing or not the generated text`);
  }
  return problems;
}

function getHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return {
    "user-agent": "visonaut-ariakit-ui-copy",
    ...(token && { authorization: `Bearer ${token}` }),
  };
}

async function fetchOk(url: string) {
  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${response.statusText}`);
  }
  return response;
}

async function fetchTree() {
  const url = `https://api.github.com/repos/${repository}/git/trees/${pin}?recursive=1`;
  const body: {
    truncated: boolean;
    tree: Array<{ path: string; type: string; sha: string }>;
  } = await (await fetchOk(url)).json();
  if (body.truncated) {
    throw new Error("The upstream tree is truncated.");
  }
  return new Map(
    body.tree.filter((item) => item.type === "blob").map((item) => [item.path, item.sha]),
  );
}

async function fetchFile(upstreamPath: string, hash: string) {
  const url = `https://raw.githubusercontent.com/${repository}/${pin}/${upstreamPath}`;
  const content = new Uint8Array(await (await fetchOk(url)).arrayBuffer());
  if (getBlobHash(content) !== hash) {
    throw new Error(`${upstreamPath}: the download does not match the tree.`);
  }
  return content;
}

async function copyUpstream(directory: string, manifestPath: string) {
  const tree = await fetchTree();
  const sources = new Map<string, string>();
  for (const upstreamPath of tree.keys()) {
    if (!upstreamPath.startsWith(`${sourceDirectory}/`)) continue;
    // Tests of upstream need its own test setup.
    if (/\.test\.[cm]?[jt]sx?$/.test(upstreamPath)) continue;
    sources.set(upstreamPath.slice(sourceDirectory.length + 1), upstreamPath);
  }
  sources.set(licenseName, licenseSource);

  const names = [...sources.keys()].sort();
  const copies = await Promise.all(
    names.map(async (name) => {
      const upstreamPath = sources.get(name);
      const hash = upstreamPath && tree.get(upstreamPath);
      if (!upstreamPath || !hash) throw new Error(`${name}: not in the tree.`);
      return { name, hash, content: await fetchFile(upstreamPath, hash) };
    }),
  );

  await rm(directory, { recursive: true, force: true });
  for (const { name, content } of copies) {
    const target = path.join(directory, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  await writeFile(path.join(directory, noticeName), getNotice(pin));
  const manifest: Manifest = {
    repository,
    commit: pin,
    // Sorted so that the output does not depend on the download order.
    files: Object.fromEntries(copies.map(({ name, hash }) => [name, hash])),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return names.length;
}

async function main() {
  const args = process.argv.slice(2);
  const [mode, ...rest] = args;
  if (mode === "--check") {
    const directoryArg = rest[0] === "--directory" ? rest[1] : undefined;
    const valid = rest.length === 0 || (directoryArg && rest.length === 2);
    if (!valid) throw new Error("Usage: --check [--directory <path>]");
    const problems = await checkCopy({
      directory: directoryArg ? path.resolve(directoryArg) : defaultDirectory,
    });
    for (const problem of problems) {
      console.error(problem);
    }
    if (problems.length) {
      console.error(`The copy differs from ${repository}@${pin}.`);
      process.exitCode = 1;
      return;
    }
    console.log(`The copy is equal to ${repository}@${pin}.`);
    return;
  }
  // Copy mode takes no flag, so a typo such as `--chek` cannot erase the folder.
  if (args.length) throw new Error("Usage: ariakit-ui-copy.ts [--check]");
  const count = await copyUpstream(defaultDirectory, defaultManifest);
  console.log(`Copied ${count} files from ${repository}@${pin}.`);
}

if (import.meta.main) {
  await main();
}
