import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { unstable_readConfig } from "wrangler";
import { readBack, readHealthVersion } from "./deploy-readback.mjs";

const commit = "a".repeat(40);
const older = "b".repeat(40);
const workflow = readFileSync(new URL("../deploy.yml", import.meta.url), "utf8");
const deploy = workflow.slice(
  workflow.indexOf("\n  deploy:\n"),
  // The line break before the next job key is the end of the last line of this job.
  workflow.indexOf("\n  schema-migration:\n") + 1,
);

/** Run the readback with a list of answers. An `Error` in the list is a failed read. */
function run(answers, attempts = answers.length) {
  const lines = [];
  const waits = [];
  let reads = 0;
  const result = readBack({
    commit,
    attempts,
    delay: 5_000,
    read: async () => {
      const answer = answers[Math.min(reads, answers.length - 1)];
      reads += 1;
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
    wait: async (delay) => {
      waits.push(delay);
    },
    log: (line) => lines.push(line),
  });
  return { result, lines, waits, reads: () => reads };
}

test("the readback passes at once when production serves the commit", async () => {
  const { result, lines, waits, reads } = run([commit]);
  await result;
  assert.equal(reads(), 1);
  assert.deepEqual(waits, []);
  assert.deepEqual(lines, [`Production /health serves the version ${commit} (attempt 1).`]);
});

test("the readback tries again after an old version and a failed read", async () => {
  const { result, lines, waits, reads } = run([older, new Error("HTTP 503"), commit]);
  await result;
  assert.equal(reads(), 3);
  assert.deepEqual(waits, [5_000, 5_000]);
  assert.deepEqual(lines, [
    `Attempt 1 of 3: version "${older}"`,
    "Attempt 2 of 3: HTTP 503",
    `Production /health serves the version ${commit} (attempt 3).`,
  ]);
});

for (const [name, answer, last] of [
  ["an older commit", older, `version "${older}"`],
  ["no version", undefined, "version missing"],
  ["a version of null", null, "version null"],
  ["a failed read", new Error("HTTP 500"), "HTTP 500"],
]) {
  test(`the readback fails when production still serves ${name}`, async () => {
    const { result, waits, reads } = run([answer], 3);
    await assert.rejects(result, (error) => {
      assert.match(
        error.message,
        new RegExp(`does not serve the version ${commit} after 3 attempts`),
      );
      assert.ok(error.message.includes(`Last answer: ${last}.`), error.message);
      assert.match(error.message, /starts no rollback/);
      return true;
    });
    assert.equal(reads(), 3);
    // No wait follows the last attempt.
    assert.deepEqual(waits, [5_000, 5_000]);
  });
}

test("the read of the version asks production for /health and returns the version field", async () => {
  const calls = [];
  const version = await readHealthVersion(async (url, options) => {
    calls.push({ url, options });
    return Response.json({ service: "visonaut", version: commit });
  });
  assert.equal(version, commit);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://visonaut.com/health");
  assert.equal(calls[0].options.redirect, "error");
  // The request carries no credential.
  assert.deepEqual(calls[0].options.headers, { Accept: "application/json" });
});

test("the read of the version fails for a failed status and for an answer that is not JSON", async () => {
  await assert.rejects(
    readHealthVersion(async () => new Response(null, { status: 403 })),
    /HTTP 403/,
  );
  await assert.rejects(readHealthVersion(async () => new Response("<html>")));
});

test("the production deploy tags the version with the commit and reads it back as the last step", () => {
  const upload =
    '        run: pnpm exec wrangler deploy --config apps/web/dist/server/wrangler.json --tag "$GITHUB_SHA"\n';
  assert.ok(deploy.includes(upload));
  const readback =
    "      - name: Read the deployed version back from production\n" +
    "        run: node .github/workflows/scripts/deploy-readback.mjs\n";
  assert.ok(
    deploy.endsWith(upload + readback),
    "The readback is not the last step of the deploy job",
  );
});

test("only production binds the version metadata", () => {
  const config = fileURLToPath(new URL("../../../apps/web/wrangler.jsonc", import.meta.url));
  assert.deepEqual(unstable_readConfig({ config, env: "production" }).version_metadata, {
    binding: "CF_VERSION_METADATA",
  });
  // The preview and the local environment get no tag, so they need no binding.
  assert.equal(unstable_readConfig({ config }).version_metadata, undefined);
  assert.equal(unstable_readConfig({ config, env: "local" }).version_metadata, undefined);
});

test("a failed queue message waits 60 seconds before each retry", () => {
  const config = fileURLToPath(new URL("../../../apps/web/wrangler.jsonc", import.meta.url));
  const [consumer] = unstable_readConfig({ config, env: "production" }).queues.consumers;
  assert.equal(consumer.retry_delay, 60);
  // The copy that the production fence compares before it removes the consumer.
  assert.match(workflow, /\n {12}max_retries: 5,\n {12}retry_delay: 60,\n/);
});
