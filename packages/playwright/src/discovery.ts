import path from "node:path";
import { digestJson } from "@visonaut/protocol";
import type { CandidateDiscovery, TestOutcome, TrustedCollection } from "@visonaut/protocol";
import type { FullConfig } from "@playwright/test/reporter";

interface DiscoveryConfig extends Pick<FullConfig, "argv" | "configFile" | "forbidOnly" | "shard"> {
  projects: Array<
    Pick<
      FullConfig["projects"][number],
      "name" | "testDir" | "testMatch" | "testIgnore" | "grep" | "grepInvert" | "repeatEach"
    >
  >;
}

interface DiscoverySuite {
  allTests(): Array<Parameters<typeof inventoryEntry>[0]>;
}

interface DiscoverParams {
  config: DiscoveryConfig;
  suite: DiscoverySuite;
  executorDigest: string;
  repositoryRoot: string;
  expectedInvocation?: string[];
  expectedProjects?: string[];
}

function expressions(value: RegExp | RegExp[] | null) {
  const patterns = value === null ? [] : Array.isArray(value) ? value : [value];
  return patterns.map((pattern) => ({ source: pattern.source, flags: pattern.flags }));
}

function patterns(value: string | RegExp | (string | RegExp)[]): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map((pattern) => {
    return typeof pattern === "string" ? pattern : `regex:${pattern.source}/${pattern.flags}`;
  });
}

export function repositoryPath(file: string, repositoryRoot: string): string {
  const relative = path.relative(repositoryRoot, file).split(path.sep).join("/");
  if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error("Trusted discovery cannot collect files outside the candidate repository");
  }
  return relative || ".";
}

function assertFullInvocation(config: DiscoveryConfig) {
  const args = config.argv.slice(2);
  if (args.shift() !== "test") {
    throw new Error("Trusted discovery requires the full Playwright test invocation");
  }
  // Selection belongs in the immutable config. Extra CLI flags can create subsets.
  while (args.length) {
    const argument = args.shift();
    if (argument === "--config" || argument === "-c") {
      if (path.resolve(args.shift() ?? "") !== config.configFile) {
        throw new Error("Trusted discovery configuration path does not match");
      }
      continue;
    }
    if (argument?.startsWith("--config=")) {
      if (path.resolve(argument.slice("--config=".length)) !== config.configFile) {
        throw new Error("Trusted discovery configuration path does not match");
      }
      continue;
    }
    throw new Error(`Trusted discovery refuses command-line selection: ${argument}`);
  }
  if (!config.forbidOnly) {
    throw new Error("Trusted discovery requires forbidOnly: true");
  }
}

/** Called by the reporter injected from the immutable trusted-main executor. */
export async function discoverInventory({
  config,
  suite,
  executorDigest,
  repositoryRoot,
  expectedInvocation,
  expectedProjects,
}: DiscoverParams): Promise<CandidateDiscovery> {
  if (!/^[a-f0-9]{64}$/.test(executorDigest)) {
    throw new Error("Capture needs a verified package digest");
  }
  if (expectedInvocation) {
    if (
      config.argv[2] !== "test" ||
      JSON.stringify(config.argv.slice(3)) !== JSON.stringify(expectedInvocation) ||
      !expectedProjects?.length ||
      JSON.stringify(config.projects.map((project) => project.name)) !==
        JSON.stringify(expectedProjects) ||
      !config.forbidOnly
    ) {
      throw new Error("Trusted discovery requires the workflow's full visual invocation");
    }
  } else {
    assertFullInvocation(config);
    if (config.projects.length !== 1) {
      throw new Error("A trusted discovery shard must select one fixed project");
    }
  }
  const collections = config.projects.map((project): TrustedCollection => {
    if (project.repeatEach !== 1) {
      throw new Error("Discovered suite must run every selected test once");
    }
    return {
      projectName: project.name,
      testDir: repositoryPath(project.testDir, repositoryRoot),
      testMatch: patterns(project.testMatch),
      testIgnore: patterns(project.testIgnore),
      grep: expressions(project.grep),
      grepInvert: expressions(project.grepInvert),
      shard: config.shard,
      repeatEach: 1,
    };
  });
  const collection = collections[0];
  if (!collection) {
    throw new Error("Trusted discovery project is missing");
  }
  return {
    executorDigest,
    configurationDigest: await digestJson(expectedInvocation ? collections : collection),
    inventoryDigest: await digestJson(
      suite.allTests().map((test) => inventoryEntry(test, repositoryRoot)),
    ),
  };
}

export function inventoryEntry(
  test: { id: string; location: { file: string }; titlePath(): string[] },
  repositoryRoot?: string,
): Pick<TestOutcome, "id" | "file" | "titlePath"> {
  return {
    id: test.id,
    file: repositoryRoot ? repositoryPath(test.location.file, repositoryRoot) : test.location.file,
    titlePath: test.titlePath().filter(Boolean),
  };
}
