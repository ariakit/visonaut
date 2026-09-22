import path from "node:path";
import { canonicalJson, digestJson } from "@ariviso/protocol";
import type {
  CandidateDiscovery,
  TestOutcome,
  TrustedCollection,
  TrustedPlan,
} from "@ariviso/protocol";
import type { FullConfig, Suite } from "@playwright/test/reporter";

interface DiscoverParams {
  config: FullConfig;
  suite: Suite;
  plan: TrustedPlan;
  shardKey: string;
  repositoryRoot: string;
}

function expressions(value: RegExp | RegExp[] | null) {
  const patterns = value === null ? [] : Array.isArray(value) ? value : [value];
  return patterns.map((pattern) => ({ source: pattern.source, flags: pattern.flags }));
}

function patterns(value: string | RegExp | (string | RegExp)[]): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map((pattern) => {
    if (typeof pattern !== "string") {
      throw new Error("Trusted discovery requires explicit string file patterns");
    }
    return pattern;
  });
}

export function repositoryPath(file: string, repositoryRoot: string): string {
  const relative = path.relative(repositoryRoot, file).split(path.sep).join("/");
  if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error("Trusted discovery cannot collect files outside the candidate repository");
  }
  return relative || ".";
}

function assertFullInvocation(config: FullConfig) {
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
  plan,
  shardKey,
  repositoryRoot,
}: DiscoverParams): Promise<CandidateDiscovery> {
  const policy = plan.discovery;
  const plannedShard = plan.shards.find((entry) => entry.key === shardKey);
  const expected = plannedShard?.collection;
  if (!policy || !expected) {
    throw new Error("Trusted discovery policy is missing");
  }
  assertFullInvocation(config);
  if (config.projects.length !== 1) {
    throw new Error("A trusted discovery shard must select one fixed project");
  }
  const project = config.projects[0];
  if (!project) {
    throw new Error("Trusted discovery project is missing");
  }
  const collection: TrustedCollection = {
    projectName: project.name,
    testDir: repositoryPath(project.testDir, repositoryRoot),
    testMatch: patterns(project.testMatch),
    testIgnore: patterns(project.testIgnore),
    grep: expressions(project.grep),
    grepInvert: expressions(project.grepInvert),
    shard: config.shard,
    repeatEach: 1,
  };
  if (project.repeatEach !== 1 || canonicalJson(collection) !== canonicalJson(expected)) {
    throw new Error("Discovered suite does not use the trusted full collection configuration");
  }
  return {
    executorDigest: policy.executorDigest,
    configurationDigest: await digestJson(collection),
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
