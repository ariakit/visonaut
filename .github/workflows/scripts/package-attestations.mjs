import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempDisposable, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export const npmVerifierVersion = "11.20.0";
const repository = "https://github.com/ariakit/visonaut";
const workflowPath = ".github/workflows/release.yml";
const workflowRef = "refs/heads/main";
const predicateType = "https://slsa.dev/provenance/v1";
const registry = "https://registry.npmjs.org/";

function subjectIntegrity(integrity) {
  assert(typeof integrity === "string" && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity));
  const encoded = integrity.slice("sha512-".length);
  const bytes = Buffer.from(encoded, "base64");
  assert.equal(bytes.length, 64, "Invalid registry SHA-512 integrity");
  assert.equal(bytes.toString("base64"), encoded, "Invalid registry integrity encoding");
  return bytes.toString("hex");
}

function validateRecords(records) {
  assert(Array.isArray(records) && records.length <= 2, "Invalid release package set");
  const names = new Set();
  for (const record of records) {
    assert(["visonaut", "@visonaut/playwright"].includes(record.name), "Unknown release package");
    assert(!names.has(record.name), "Repeated release package");
    names.add(record.name);
    assert(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(record.version), "Invalid release version");
    subjectIntegrity(record.integrity);
  }
}

/** Accept only npm's verified bundle, then apply the selected release source policy. */
export async function assertReleaseProvenance({ audit, records, expectedSourceSha, verifyBundle }) {
  validateRecords(records);
  if (expectedSourceSha !== undefined)
    assert(/^[a-f0-9]{40}$/.test(expectedSourceSha), "Invalid checked release source");
  assert.equal(typeof verifyBundle, "function", "The supported Sigstore verifier is required");
  assert(Array.isArray(audit?.invalid) && audit.invalid.length === 0, "Invalid npm signatures");
  assert(Array.isArray(audit?.missing) && audit.missing.length === 0, "Missing npm signatures");
  assert(Array.isArray(audit?.verified), "npm did not return verified attestation bundles");
  const result = [];
  for (const record of records) {
    const matches = audit.verified.filter(
      (entry) => entry.name === record.name && entry.version === record.version,
    );
    assert.equal(matches.length, 1, "The expected package has no unique verified attestation");
    const verified = matches[0];
    assert.equal(verified.registry, registry, "Attestation comes from another registry");
    assert(Array.isArray(verified.attestationBundles), "npm omitted the verified bundles");
    const provenances = verified.attestationBundles.filter(
      (attestation) => attestation.predicateType === predicateType,
    );
    assert.equal(provenances.length, 1, "The package has no unique SLSA v1 provenance");
    const { bundle } = provenances[0];
    assert.equal(bundle?.dsseEnvelope?.payloadType, "application/vnd.in-toto+json");
    const payload = bundle.dsseEnvelope.payload;
    assert(
      typeof payload === "string" && payload.length <= 1024 * 1024,
      "Invalid provenance payload",
    );
    const statement = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    assert.equal(statement._type, "https://in-toto.io/Statement/v1");
    assert.equal(statement.predicateType, predicateType);
    assert.deepEqual(
      statement.subject,
      [
        {
          name: `pkg:npm/${record.name.replace(/^@/, "%40")}@${record.version}`,
          digest: { sha512: subjectIntegrity(record.integrity) },
        },
      ],
      "Provenance does not identify the expected registry package bytes",
    );
    const definition = statement.predicate?.buildDefinition;
    assert.equal(
      definition?.buildType,
      "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
    );
    assert.deepEqual(
      definition.externalParameters?.workflow,
      {
        repository,
        path: workflowPath,
        ref: workflowRef,
      },
      "Published package used another release workflow",
    );
    assert.equal(definition.internalParameters?.github?.repository_id, "1380751023");
    assert(
      ["push", "workflow_dispatch"].includes(definition.internalParameters?.github?.event_name),
      "Published package used another release event",
    );
    const dependencies = definition.resolvedDependencies;
    assert(Array.isArray(dependencies) && dependencies.length === 1, "Ambiguous source dependency");
    const sourceSha = dependencies[0]?.digest?.gitCommit;
    assert(/^[a-f0-9]{40}$/.test(sourceSha ?? ""), "Invalid published source commit");
    assert.deepEqual(
      dependencies,
      [{ uri: `git+${repository}@${workflowRef}`, digest: { gitCommit: sourceSha } }],
      "Published package came from another source repository or ref",
    );
    if (expectedSourceSha !== undefined)
      assert.equal(
        sourceSha,
        expectedSourceSha,
        "Published package came from another source commit",
      );
    assert.equal(
      statement.predicate.runDetails?.builder?.id,
      "https://github.com/actions/runner/github-hosted",
    );
    assert(
      /^https:\/\/github\.com\/ariakit\/visonaut\/actions\/runs\/[1-9]\d*\/attempts\/[1-9]\d*$/.test(
        statement.predicate.runDetails?.metadata?.invocationId ?? "",
      ),
      "Published package has no trusted release invocation",
    );
    // npm verifies subjects and integrity. Its public Sigstore API adds our issuer/SAN policy.
    await verifyBundle(bundle, {
      certificateIssuer: "https://token.actions.githubusercontent.com",
      certificateIdentityURI: `^${`${repository}/${workflowPath}@${workflowRef}`.replaceAll(".", "\\.")}$`,
      certificateOIDs: {
        "1.3.6.1.4.1.57264.1.3": sourceSha,
      },
    });
    result.push({
      name: record.name,
      version: record.version,
      integrity: record.integrity,
      sourceSha,
    });
  }
  return result;
}

/** Audit exact registry versions in an isolated tree without executing package scripts. */
export async function withVerifiedPackages(records, callback, { expectedSourceSha } = {}) {
  validateRecords(records);
  assert.equal(typeof callback, "function");
  if (records.length === 0) return callback([]);
  assert.equal(
    execFileSync("npm", ["--version"], { encoding: "utf8", timeout: 15_000 }).trim(),
    npmVerifierVersion,
    "Install the pinned npm attestation verifier before release",
  );
  const npmRoot = execFileSync("npm", ["root", "--global"], {
    encoding: "utf8",
    timeout: 15_000,
  }).trim();
  const require = createRequire(resolve(npmRoot, "npm/package.json"));
  const { verify } = require("sigstore");
  assert.equal(typeof verify, "function", "Pinned npm omitted its supported Sigstore verifier");
  await using temporary = await mkdtempDisposable(
    resolve(tmpdir(), "visonaut-release-provenance-"),
  );
  await writeFile(resolve(temporary.path, "package.json"), JSON.stringify({ private: true }));
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--save-exact",
      "--registry=https://registry.npmjs.org/",
      "--cache",
      resolve(temporary.path, "npm-cache"),
      ...records.map((record) => `${record.name}@${record.version}`),
    ],
    { cwd: temporary.path, stdio: "inherit", timeout: 120_000 },
  );
  const audit = JSON.parse(
    execFileSync(
      "npm",
      [
        "audit",
        "signatures",
        "--json",
        "--include-attestations",
        "--registry=https://registry.npmjs.org/",
        "--cache",
        resolve(temporary.path, "npm-cache"),
      ],
      { cwd: temporary.path, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    ),
  );
  const verified = await assertReleaseProvenance({
    audit,
    records,
    expectedSourceSha,
    verifyBundle: (bundle, policy) =>
      verify(bundle, {
        ...policy,
        tufCachePath: resolve(temporary.path, "tuf-cache"),
      }),
  });
  return await callback(
    verified.map((record) => ({
      ...record,
      directory: resolve(temporary.path, "node_modules", record.name),
    })),
  );
}
