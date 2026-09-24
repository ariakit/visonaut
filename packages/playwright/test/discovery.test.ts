import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverInventory } from "../src/discovery.js";

const root = "/candidate";
const expectedInvocation = [
  "--project",
  "chrome",
  "firefox",
  "--grep",
  "@visual",
  "--output",
  "test-results/test-visual",
];

function fixture(args = expectedInvocation, names = ["chrome", "firefox"]) {
  const config = {
    argv: ["playwright", "ignored", "test", ...args],
    configFile: undefined,
    forbidOnly: true,
    shard: null,
    projects: names.map((name) => ({
      name,
      testDir: path.join(root, "app/src"),
      testMatch: [/test.*-browser/],
      testIgnore: [],
      grep: [/@visual/],
      grepInvert: [],
      repeatEach: 1,
    })),
  };
  const suite = {
    allTests: () =>
      names.map((name) => ({
        id: name,
        location: { file: path.join(root, `app/src/${name}/test-browser.ts`) },
        titlePath: () => ["capture @visual"],
      })),
  };
  return { config, suite };
}

describe("workflow-owned visual discovery", () => {
  it("records the complete Chrome and Firefox collection in one shard", async () => {
    const { config, suite } = fixture();
    const result = await discoverInventory({
      config,
      suite,
      executorDigest: "a".repeat(64),
      repositoryRoot: root,
      expectedInvocation,
      expectedProjects: ["chrome", "firefox"],
    });
    expect(result.inventoryDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.configurationDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a project subset or changed visual command", async () => {
    for (const value of [
      fixture(expectedInvocation, ["chrome"]),
      fixture(expectedInvocation.slice(0, -2)),
    ]) {
      await expect(
        discoverInventory({
          ...value,
          executorDigest: "a".repeat(64),
          repositoryRoot: root,
          expectedInvocation,
          expectedProjects: ["chrome", "firefox"],
        }),
      ).rejects.toThrow("workflow's full visual invocation");
    }
  });
});
