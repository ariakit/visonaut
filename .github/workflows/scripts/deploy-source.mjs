import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

assert.equal(process.env.GITHUB_REPOSITORY_ID, "1380751023");
assert.equal(process.env.GITHUB_REF, "refs/heads/main");
const response = await fetch("https://api.github.com/repos/ariakit/ariviso/git/ref/heads/main", {
  headers: {
    Authorization: `Bearer ${process.env.GH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  },
  redirect: "error",
  signal: AbortSignal.timeout(15000),
});
assert(response.ok, "Cannot verify the current main commit");
const reference = await response.json();
assert.equal(
  reference.object?.sha,
  process.env.GITHUB_SHA,
  "A newer main commit supersedes this deployment",
);
const configuration = JSON.parse(await readFile("apps/web/dist/server/wrangler.json", "utf8"));
assert.equal(configuration.name, "ariviso", "Web build targets the wrong Worker");
assert.equal(configuration.vars?.ARIVISO_ENVIRONMENT, "production");
assert.equal(configuration.vars?.ARIVISO_ALLOW_MAIN_DISPATCH, "false");
